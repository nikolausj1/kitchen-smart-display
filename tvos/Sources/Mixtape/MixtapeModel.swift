import SwiftUI
import UIKit

// MixtapeModel - the state machine behind MixtapeView (docs/designs/mixtape.md,
// "States" and "Eject and insert"). It turns the polled SonosState into:
//   - which tape is in the well (`current`), chosen by FNV-1a of the tape key,
//   - the transition phase (door opening, eject, empty gap, insert, door close),
//   - the playback anchor the reels integrate against,
//   - the prefetched album art and decoded images.
// The per-frame values (reel angles, VU needles) live in MixtapeClock, a plain
// class the TimelineView steps each frame, so they never publish to SwiftUI.

// Remote -> Mixtape channel, same shape as PhotoRemoteSignal: each press bumps
// `seq` so repeated presses are distinct events. Decoration only (decision 14):
// RootView still sends play/pause to Sonos itself.
final class MixtapeRemoteSignal: ObservableObject {
    @Published private(set) var seq: Int = 0
    func sendPlayPause() { seq += 1 }
}

struct MixtapeLoad: Equatable {
    var key: String
    var title: String
    var artist: String
    var album: String
    var station: String
    var artURL: URL?
    var isRadio: Bool
    var variant: Int = 0
}

struct MixtapeDeckImages {
    var plate: UIImage
    var wellOpen: UIImage?
    var glass: UIImage?
    var frame: UIImage?
    var caps: [String: UIImage]
    /// Wound-tape pack disc (brown, faint spiral, alpha outside), shared by
    /// every tape in place of the per-tape pack.png.
    var pack: UIImage? = nil
}

struct MixtapeTapeImages {
    var sprite: UIImage
    var hub: UIImage?
    var pack: UIImage?
}

@MainActor
final class MixtapeModel: ObservableObject {
    enum Phase: Equatable { case empty, opening, ejecting, gap, inserting, closing, seated }

    // Timings from the design doc (about 2 s total for a song change).
    static let doorTime = 0.5
    static let ejectTime = 0.5
    static let insertTime = 0.6
    static let minGap = 0.25
    static let artCap = 1.5
    static let stopGrace = 5.0
    // Rapid skips: the insert waits until the wanted track has held this long,
    // so a burst of skips lands as one insert of the LAST track. A normal song
    // change has held since before the eject began, so it never waits on this.
    static let settle = 0.8
    // Hard cap on the empty well during a burst that never settles.
    static let gapCap = 4.0

    @Published private(set) var phase: Phase = .empty
    @Published private(set) var phaseStart = Date()
    @Published private(set) var current: MixtapeLoad?
    /// The printed label for `current`, composed once per insert off the
    /// main thread (MixtapeLabelRenderer), so a frame draws one image.
    @Published private(set) var label: MixtapeLabelImage?
    @Published private(set) var deckImages: MixtapeDeckImages?
    @Published private(set) var tapeImages: [String: MixtapeTapeImages] = [:]
    @Published private(set) var pressDate: Date?
    @Published private(set) var timelinePaused = false

    // Playback, for the reels. Mirrors NowPlayingView.smoothProgress: anchor to
    // the last poll and add wall-clock time while playing.
    @Published private(set) var playing = false
    @Published private(set) var paused = false
    private(set) var durationMs = 0
    private(set) var anchorElapsedMs = 0
    private(set) var anchorDate = Date()

    let manifest: MixtapeManifest?
    let clock = MixtapeClock()

    private var desired: MixtapeLoad?
    private var desiredSince = Date.distantPast
    private var lastVariant: Int?
    private var seenFirst = false
    private var running = false
    private var stoppedSince: Date?
    private var lastState: SonosState?
    private var graceTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?
    private var art: [URL: UIImage] = [:]
    private var artFailed: Set<URL> = []
    private var artInFlight: Set<URL> = []
    private var labelTask: Task<Void, Never>?
    private var artOrder: [URL] = []
    private var tapeLoading: Set<String> = []

    init() {
        manifest = MixtapeManifest.load()
        loadDeckImages()
        for line in MixtapeLabelRenderer.fontReport.lines {
            MixtapeManifest.log.info("mixtape fonts: \(line, privacy: .public)")
        }
    }

    var tapes: [MixtapeTape] { manifest?.tapes ?? [] }

    func tape(for load: MixtapeLoad?) -> MixtapeTape? {
        guard let load, !tapes.isEmpty else { return nil }
        return tapes[load.variant % tapes.count]
    }

    // Wind fraction per decision 16: f = 0.15 + 0.7 p. Radio holds 0.5.
    func windFraction(_ now: Date) -> Double {
        guard durationMs > 0 else { return 0.5 }
        let extra = playing ? max(0, now.timeIntervalSince(anchorDate) * 1000) : 0
        let p = min(1, max(0, (Double(anchorElapsedMs) + extra) / Double(durationMs)))
        return 0.15 + 0.7 * p
    }

    // MARK: - Sonos input

    func ingest(_ s: SonosState) {
        // Loading / unreachable: freeze whatever was last shown.
        guard s.loaded else { return }
        lastState = s
        let now = Date()

        // Playback anchor for the reels (re-anchor on any change).
        let elapsed = s.track?.elapsedMs ?? 0
        if elapsed != anchorElapsedMs || s.playing != playing || (s.track?.durationMs ?? 0) != durationMs {
            anchorElapsedMs = elapsed
            anchorDate = now
        }
        durationMs = s.track?.durationMs ?? 0
        if playing != s.playing { playing = s.playing }
        if paused != s.paused { paused = s.paused }

        let active = s.playing || s.paused
        let hasTrack = s.track != nil || !s.stationName.isEmpty
        if active {
            stoppedSince = nil
            graceTask?.cancel()
        } else if stoppedSince == nil {
            // Cold start while stopped counts as long stopped: empty well.
            stoppedSince = seenFirst ? now : .distantPast
            scheduleGraceCheck()
        }
        let inGrace = stoppedSince.map { now.timeIntervalSince($0) < Self.stopGrace } ?? true
        let want: MixtapeLoad? = (hasTrack && (active || inGrace)) ? makeLoad(s) : nil

        if !seenFirst {
            // First appearance: no eject, no insert. Seat the tape (or not).
            seenFirst = true
            desired = want
            if var w = want {
                w.variant = pickVariant(for: w.key)
                lastVariant = w.variant
                current = w
                setPhase(.seated)
                prefetch(w, variant: w.variant)
                // Cold start: the tape is already seated; its label fades in
                // once the art has had its chance to load (cap 1.5 s).
                relabel(w, waitForArt: true, isInsert: true)
            } else {
                setPhase(.empty)
            }
            refreshIdle()
            return
        }

        if want?.key != desired?.key {
            desired = want
            desiredSince = now
            if let w = want { prefetch(w) }
        } else if var w = want {
            // Same tape, but art or album can arrive a poll late.
            w.variant = desired?.variant ?? 0
            desired = w
            if current?.key == w.key, var c = current,
               c.artURL != w.artURL || c.album != w.album {
                c.artURL = w.artURL
                c.album = w.album
                current = c
                prefetch(w, variant: c.variant)
                // Re-print with the late metadata (crossfades in the view).
                relabel(c, waitForArt: true, isInsert: false)
            }
        }
        kick()
        refreshIdle()
    }

    private func makeLoad(_ s: SonosState) -> MixtapeLoad {
        let t = s.track
        let isRadio = (t?.durationMs ?? 0) == 0 && !s.stationName.isEmpty
        return MixtapeLoad(
            key: mixtapeKey(title: t?.title ?? "", artist: t?.artist ?? "", station: s.stationName),
            title: t?.title ?? "", artist: t?.artist ?? "", album: t?.album ?? "",
            station: s.stationName,
            artURL: isRadio ? nil : t?.albumArtURL,
            isRadio: isRadio)
    }

    // variant = fnv1a32(key) mod count; step on a repeat of the previous tape.
    private func pickVariant(for key: String) -> Int {
        let n = max(1, tapes.count)
        var v = Int(fnv1a32(key) % UInt32(n))
        if n > 1, v == lastVariant { v = (v + 1) % n }
        return v
    }

    private func scheduleGraceCheck() {
        graceTask?.cancel()
        graceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((Self.stopGrace + 0.05) * 1e9))
            guard !Task.isCancelled, let self, let s = self.lastState else { return }
            self.ingest(s)
        }
    }

    // MARK: - Transport key

    func press() {
        pressDate = Date()
        timelinePaused = false
        refreshIdle()
    }

    // MARK: - Transitions

    private func setPhase(_ p: Phase) {
        phase = p
        phaseStart = Date()
        timelinePaused = false
    }

    private func hold(_ p: Phase, _ seconds: Double) async {
        setPhase(p)
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
    }

    private func kick() {
        guard !running, current?.key != desired?.key else { return }
        running = true
        Task { await runSequence() }
    }

    // One eject and one insert per burst: the key is re-read at the insert, so
    // rapid skips coalesce onto the latest track.
    private func runSequence() async {
        defer { running = false; refreshIdle() }
        while current?.key != desired?.key {
            if let c = current {
                MixtapeManifest.log.info("mixtape eject: \(c.key, privacy: .public)")
                await hold(.opening, Self.doorTime)
                await hold(.ejecting, Self.ejectTime)
                current = nil
                label = nil
                setPhase(.gap)
            } else if phase == .empty || phase == .closing || phase == .seated {
                guard desired != nil else { break }
                // Music starts from empty: the door has to open for the insert.
                await hold(.opening, Self.doorTime)
                setPhase(.gap)
            }

            guard desired != nil else {
                // Stop: the well stays empty, the door closes over it.
                await hold(.closing, Self.doorTime)
                setPhase(.empty)
                continue
            }

            // Empty well: at least a beat, then until the new art and tape
            // are ready (cap 1.5 s) AND the wanted track has settled (rapid
            // skips coalesce onto the last one; hard cap 4 s).
            let t0 = Date()
            try? await Task.sleep(nanoseconds: UInt64(Self.minGap * 1e9))
            while true {
                guard let d = desired else { break }
                let now = Date()
                let settled = now.timeIntervalSince(desiredSince) >= Self.settle
                let artReady = d.isRadio || (d.artURL.map { art[$0] != nil || artFailed.contains($0) } ?? true)
                let tapeReady = tapeImages[tapes.isEmpty ? "" : tapes[pickVariant(for: d.key) % tapes.count].id] != nil
                let waitedOnAssets = now.timeIntervalSince(max(t0, desiredSince)) >= Self.artCap
                if settled && ((artReady && tapeReady) || waitedOnAssets) { break }
                if now.timeIntervalSince(t0) >= Self.gapCap { break }
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
            guard var next = desired else { continue }
            next.variant = pickVariant(for: next.key)
            lastVariant = next.variant
            if let t = tape(for: next) { await ensureTapeImages(t) }
            // Print the new label while the tape is out of frame.
            labelTask?.cancel()
            let printed = await composeLabel(next)
            logLabel(next, printed)
            current = next
            label = printed
            MixtapeManifest.log.info("mixtape insert: \(next.key, privacy: .public) -> \(self.tape(for: next)?.id ?? "?", privacy: .public)")
            await hold(.inserting, Self.insertTime)
            await hold(.closing, Self.doorTime)
            setPhase(.seated)
        }
    }

    // MARK: - Idle (pause the TimelineView when nothing moves)

    private func refreshIdle() {
        idleTask?.cancel()
        let idle = !playing && (phase == .empty || phase == .seated) && !running
        guard idle else { timelinePaused = false; return }
        // Let the reels ease out and the needles fall to rest first.
        idleTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled, let self else { return }
            if !self.playing && !self.running && (self.phase == .empty || self.phase == .seated) {
                self.timelinePaused = true
            }
        }
    }

    // MARK: - Art (prefetched, gated before the insert)

    // `variant` nil = the tape this load would get if inserted next.
    private func prefetch(_ load: MixtapeLoad, variant: Int? = nil) {
        if !tapes.isEmpty {
            let t = tapes[(variant ?? pickVariant(for: load.key)) % tapes.count]
            Task { await ensureTapeImages(t) }
        }
        guard let url = load.artURL, art[url] == nil, !artInFlight.contains(url) else { return }
        artInFlight.insert(url)
        Task { [weak self] in
            var img: UIImage?
            if let (data, _) = try? await URLSession.shared.data(from: url) {
                img = await Task.detached { UIImage(data: data)?.preparingForDisplay() }.value
            }
            guard let self else { return }
            self.artInFlight.remove(url)
            guard let img else {
                self.artFailed.insert(url)
                MixtapeManifest.log.info("mixtape art failed: \(url.absoluteString, privacy: .public)")
                return
            }
            self.art[url] = img
            // Art that lands after a handwritten label was printed (late poll):
            // re-print the seated tape with its cover.
            if let c = self.current, c.artURL == url, self.label?.handwritten ?? true, self.phase == .seated {
                self.relabel(c, waitForArt: false, isInsert: false)
            }
            self.artOrder.append(url)
            // Small LRU: the current tape, the next one, and a few spares.
            while self.artOrder.count > 8 {
                let old = self.artOrder.removeFirst()
                if old != self.current?.artURL && old != self.desired?.artURL { self.art[old] = nil }
            }
        }
    }

    // MARK: - Label

    /// Composes the label for `load` on a background thread. Needs the tape
    /// sprite; uses the art if it is in the cache (no art = handwritten).
    func composeLabel(_ load: MixtapeLoad) async -> MixtapeLabelImage? {
        guard let t = tape(for: load) else { return nil }
        await ensureTapeImages(t)
        guard let sprite = tapeImages[t.id]?.sprite.cgImage else { return nil }
        let artImg = load.isRadio ? nil : load.artURL.flatMap { art[$0]?.cgImage }
        let album = load.isRadio ? load.station : load.album
        let input = MixtapeLabelInput(tape: t, tapeCount: tapes.count, key: load.key, title: load.title,
                                      artist: load.artist, album: album, art: artImg, sprite: sprite)
        return await Task.detached(priority: .userInitiated) { MixtapeLabelRenderer.render(input) }.value
    }

    private func relabel(_ load: MixtapeLoad, waitForArt: Bool, isInsert: Bool) {
        labelTask?.cancel()
        labelTask = Task { [weak self] in
            guard let self else { return }
            if waitForArt, let url = load.artURL, !load.isRadio {
                let t0 = Date()
                while self.art[url] == nil, !self.artFailed.contains(url),
                      Date().timeIntervalSince(t0) < Self.artCap {
                    try? await Task.sleep(nanoseconds: 50_000_000)
                }
            }
            guard !Task.isCancelled else { return }
            let printed = await self.composeLabel(load)
            guard !Task.isCancelled, self.current?.key == load.key else { return }
            if isInsert || self.loggedKey != load.key { self.logLabel(load, printed) }
            self.label = printed
        }
    }

    // Once per insert: "mixtape label: key -> tape / layout / typeset".
    private var loggedKey: String?

    private func logLabel(_ load: MixtapeLoad, _ l: MixtapeLabelImage?) {
        loggedKey = load.key
        let tapeID = tape(for: load)?.id ?? "?"
        let pick = MixtapeLabelStyle.pick(key: load.key, tapeCount: tapes.count)
        let layout = l?.style.layout.rawValue ?? "none"
        MixtapeManifest.log.info("mixtape label: \(load.key, privacy: .public) -> \(tapeID, privacy: .public) / \(layout, privacy: .public) / \(pick.typeset.rawValue, privacy: .public) (hash layout \(pick.layout.rawValue, privacy: .public), \(Int(l?.millis ?? 0)) ms)")
        for line in l?.inks ?? [] {
            MixtapeManifest.log.info("mixtape ink: \(load.key, privacy: .public): \(line, privacy: .public)")
        }
    }

    // MARK: - Images

    private func loadDeckImages() {
        Task { [weak self] in
            let imgs = await Task.detached(priority: .userInitiated) { () -> MixtapeDeckImages? in
                func load(_ name: String) -> UIImage? {
                    guard let url = MixtapeManifest.fileURL("deck/\(name).png") else { return nil }
                    return UIImage(contentsOfFile: url.path)?.preparingForDisplay()
                }
                guard let plate = load("deck_empty") else { return nil }
                let deck = MixtapeManifest.load()?.deck ?? .fallback
                var caps: [String: UIImage] = [:]
                if let cg = plate.cgImage {
                    let W = Double(cg.width), H = Double(cg.height)
                    for (k, r) in deck.keyCaps {
                        let px = CGRect(x: r.x * W, y: r.y * H, width: r.w * W, height: r.h * H).integral
                        if let c = cg.cropping(to: px) { caps[k] = UIImage(cgImage: c) }
                    }
                }
                return MixtapeDeckImages(plate: plate, wellOpen: load("well_open"),
                                         glass: load("door_glass"), frame: load("door_frame"),
                                         caps: caps, pack: load("pack_shared"))
            }.value
            self?.deckImages = imgs
            if imgs == nil { MixtapeManifest.log.error("Mixtape deck plate failed to load") }
        }
    }

    func ensureTapeImages(_ t: MixtapeTape) async {
        guard tapeImages[t.id] == nil else { return }
        if tapeLoading.contains(t.id) {
            // Another caller is decoding it: wait for that load (cap 5 s), so
            // the label composer never runs without its sprite.
            let t0 = Date()
            while tapeLoading.contains(t.id), Date().timeIntervalSince(t0) < 5 {
                try? await Task.sleep(nanoseconds: 30_000_000)
            }
            return
        }
        tapeLoading.insert(t.id)
        let imgs = await Task.detached(priority: .userInitiated) { () -> MixtapeTapeImages? in
            func load(_ rel: String?) -> UIImage? {
                guard let rel, let url = MixtapeManifest.fileURL(rel) else { return nil }
                return UIImage(contentsOfFile: url.path)?.preparingForDisplay()
            }
            guard let sprite = load(t.tapeFile) else { return nil }
            return MixtapeTapeImages(sprite: sprite, hub: load(t.hubFile), pack: load(t.packFile))
        }.value
        tapeLoading.remove(t.id)
        if let imgs { tapeImages[t.id] = imgs }
        else { MixtapeManifest.log.error("tape images missing for \(t.id)") }
    }
}

// MixtapeClock - per-frame integrator for the reels and the VU needles. A plain
// class stepped from inside the TimelineView, so its mutations never trigger a
// SwiftUI update of their own.
final class MixtapeClock {
    private var last: Date?
    private(set) var angleL = 0.0      // degrees, clockwise positive
    private(set) var angleR = 0.0
    private var run = 0.0              // 0..1 linear ramp of the reel drive
    private(set) var vu: [Double] = [-20, -20]
    private let phases: [Double] = (0..<6).map { _ in Double.random(in: 0..<(2 * .pi)) }

    struct Reels { var rs: Double; var rt: Double }

    /// Pack radii from conserved tape area (docs/designs/mixtape.md, "Reel
    /// physics"). r0 = empty hub pack, R = full pack, f = wind fraction.
    static func radii(f: Double, r0: Double, R: Double) -> Reels {
        let a = R * R - r0 * r0
        return Reels(rs: sqrt(max(r0 * r0, R * R - f * a)),
                     rt: sqrt(r0 * r0 + f * a))
    }

    func step(now: Date, driving: Bool, playing: Bool, f: Double, r0: Double, R: Double) {
        let dt = min(0.1, max(0, now.timeIntervalSince(last ?? now)))
        last = now

        // Reels: ease in and out over 0.3 s (pause spec), smoothstepped.
        let rate = dt / 0.3
        run = driving ? min(1, run + rate) : max(0, run - rate)
        let k = run * run * (3 - 2 * run)
        if k > 0 {
            // Constant tape speed: omega = v / r, with v set so the near-empty
            // take-up (r = r0) turns 0.7 rev/s.
            let v = 0.7 * r0
            let r = Self.radii(f: f, r0: r0, R: R)
            angleL = (angleL + k * 360 * (v / r.rs) * dt).truncatingRemainder(dividingBy: 360)
            angleR = (angleR + k * 360 * (v / r.rt) * dt).truncatingRemainder(dividingBy: 360)
        }

        // VU needles. Sonos exposes no audio levels, so this is ambient motion
        // driven by play state only, NOT the music (same honesty caveat as the
        // `bars` backdrop): a slow wander between -10 and 0 VU while playing,
        // resting at -20 otherwise. Revisit if the BPM lookup ever lands.
        let t = now.timeIntervalSinceReferenceDate
        for i in 0..<2 {
            let p = phases[i * 3], q = phases[i * 3 + 1], s = phases[i * 3 + 2]
            let n = 0.5 * sin(t * 0.9 + p) + 0.3 * sin(t * 2.3 + q) + 0.2 * sin(t * 4.1 + s)
            let target = playing ? (-5 + 5 * n) : -20
            let tau = playing ? 0.18 : 0.45
            vu[i] += (target - vu[i]) * (1 - exp(-dt / tau))
        }
    }
}
