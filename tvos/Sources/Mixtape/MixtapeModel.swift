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
    /// Lamp sprites by key ("play", "pause"), drawn at deck.glows.
    var glows: [String: UIImage] = [:]
    /// The OUTPUT knob's dot alone, turned for volume over the plate's face.
    var knobDot: UIImage? = nil
    /// The door glass's coverage as an opaque mask (1/8 scale, full frame),
    /// for the specular sweep during the swing. Built once from door_glass.
    var glassMask: UIImage? = nil

    /// door_glass is a faint smoke (alpha about 0.25), so its own alpha is too
    /// weak to mask with; this thresholds it to full coverage, downsampled
    /// (the mask is upscaled, which softens its edge by a pixel or two).
    static func coverageMask(_ img: UIImage?) -> UIImage? {
        guard let cg = img?.cgImage else { return nil }
        let w = max(1, cg.width / 8), h = max(1, cg.height / 8)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let data = ctx.data else { return nil }
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        let p = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
        for i in 0..<(w * h) {
            let a: UInt8 = p[i * 4 + 3] > 8 ? 255 : 0
            p[i * 4] = a; p[i * 4 + 1] = a; p[i * 4 + 2] = a; p[i * 4 + 3] = a
        }
        return ctx.makeImage().map { UIImage(cgImage: $0) }
    }
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
    /// Sonos volume 0...100 for the OUTPUT knob; nil until a loaded poll.
    @Published private(set) var volume: Int?
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
        if volume != s.volume { volume = s.volume }

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
                // v2: NIKOLAUS wordmark, PLAY unlit (the lamp is a sprite),
                // knob face without its dot (the dot is a sprite).
                guard let plate = load("deck_empty_v2") ?? load("deck_empty") else { return nil }
                let deck = MixtapeManifest.load()?.deck ?? .fallback
                var caps: [String: UIImage] = [:]
                if let cg = plate.cgImage {
                    let W = Double(cg.width), H = Double(cg.height)
                    for (k, r) in deck.keyCaps {
                        let px = CGRect(x: r.x * W, y: r.y * H, width: r.w * W, height: r.h * H).integral
                        if let c = cg.cropping(to: px) { caps[k] = UIImage(cgImage: c) }
                    }
                }
                let glass = load("door_glass")
                return MixtapeDeckImages(plate: plate, wellOpen: load("well_open"),
                                         glass: glass, frame: load("door_frame"),
                                         caps: caps, pack: load("pack_shared"),
                                         glows: ["play": load("glow_play"), "pause": load("glow_pause")]
                                            .compactMapValues { $0 },
                                         knobDot: load("knob_dot"),
                                         glassMask: MixtapeDeckImages.coverageMask(glass))
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

// MixtapeClock - per-frame integrator for the reels, the lamp, the door
// reflection and the VU needles. A plain class stepped from inside the
// TimelineView, so its mutations never trigger a SwiftUI update of their own.
//
// Every ambient motion here runs on `t`, time accumulated from the frames the
// TimelineView actually draws (dt capped at 0.1 s), not wall time: when the
// timeline pauses while idle, nothing jumps when it resumes.
final class MixtapeClock {
    struct Inputs {
        var driving: Bool       // seated and playing: the capstan pulls tape
        var playing: Bool
        var paused: Bool
        var lampOn: Bool        // the deck lamp behind the window
        var key: String?        // the seated tape's key (VU character)
        var f: Double
        var r0: Double
        var R: Double
    }

    private var last: Date?
    /// Ambient seconds (see above), randomly offset so launches differ.
    private(set) var t = Double.random(in: 0..<1000)
    private(set) var angleL = 0.0      // degrees, clockwise positive
    private(set) var angleR = 0.0
    /// Reel drive 0..1 (fraction of full speed).
    private(set) var drive = 0.0
    private var rampUp = false
    private var rampFrom = 0.0
    private var rampT = 0.0
    private var rockT: Double?         // seconds into the pause rock-back
    private var rockApplied = 0.0
    /// Pack edge jitter, -1...1 per pack (well under a pixel in the view).
    private(set) var packJitter: [Double] = [0, 0]
    /// Deck lamp, 0...1 including the flicker (multiply into the glow).
    private(set) var lamp = 0.0
    private var lampLevel = 0.0
    /// Door reflection drift, -1...1 (times 1.5% of the door width), and
    /// its opacity factor (1 +/- 0.15).
    private(set) var reflectionDrift = 0.0
    private(set) var reflectionOpacity = 1.0
    /// VU needle angles in degrees from vertical (the plate's printed scale).
    private(set) var needleDeg: [Double] = [MixtapeClock.vuAngle(-20), MixtapeClock.vuAngle(-20)]
    private var needleVel: [Double] = [0, 0]
    private var vuKey: String?
    private var vuLevel: [Double] = [-4, -4]
    private var kickT: Double?         // seconds since the song-start swing began
    private var kickedKey: String?
    private var wasDriving = false
    private let phases: [Double] = (0..<16).map { _ in Double.random(in: 0..<(2 * .pi)) }

    struct Reels { var rs: Double; var rt: Double }

    /// Pack radii from conserved tape area (docs/designs/mixtape.md, "Reel
    /// physics"). r0 = empty hub pack, R = full pack, f = wind fraction.
    static func radii(f: Double, r0: Double, R: Double) -> Reels {
        let a = R * R - r0 * r0
        return Reels(rs: sqrt(max(r0 * r0, R * R - f * a)),
                     rt: sqrt(r0 * r0 + f * a))
    }

    // Reel transport timings (a real deck: the capstan grabs, the reels coast).
    static let spinUp = 0.35
    static let spinDown = 0.45
    static let rockStart = 0.36        // into the spin-down, as tension lets go
    static let rockDeg = 4.0
    static let rockTime = 0.3

    func step(now: Date, _ i: Inputs) {
        let dt = min(0.1, max(0, now.timeIntervalSince(last ?? now)))
        last = now
        t += dt
        stepReels(dt, i)
        stepLight(dt, i)
        stepNeedles(dt, i)
    }

    // MARK: Reels

    private func stepReels(_ dt: Double, _ i: Inputs) {
        if i.driving != rampUp {
            rampUp = i.driving
            rampFrom = drive
            rampT = 0
            // PAUSE (not stop, not eject): the supply reel rocks back a few
            // degrees as the tape tension releases at the end of the coast.
            rockT = (!i.driving && i.paused && drive > 0.5) ? -Self.rockStart : nil
            rockApplied = 0
        }
        rampT += dt
        if rampUp {
            // Spin-up: the pinch roller grabs, speed comes in hard then
            // eases onto the capstan (cubic ease-out over 0.35 s).
            let u = min(1, rampT / Self.spinUp)
            drive = rampFrom + (1 - rampFrom) * (1 - pow(1 - u, 3))
        } else {
            // Spin-down: the reels coast to a stop, losing most speed early
            // and creeping at the end (not the symmetric ease of the spin-up).
            let u = min(1, rampT / Self.spinDown)
            drive = rampFrom * pow(1 - u, 1.7)
        }

        // Wow and flutter: the base angular speed micro-varies, a slow 0.6 Hz
        // wow and a faint 7 Hz flutter, each hub on its own phase.
        func wf(_ h: Int) -> Double {
            1 + 0.012 * sin(2 * .pi * 0.6 * t + phases[h])
              + 0.004 * sin(2 * .pi * 7 * t + phases[h + 2])
        }
        if drive > 0 {
            // Constant tape speed: omega = v / r, with v set so the near-empty
            // take-up (r = r0) turns 0.7 rev/s.
            let v = 0.7 * i.r0
            let r = Self.radii(f: i.f, r0: i.r0, R: i.R)
            angleL = (angleL + drive * wf(0) * 360 * (v / r.rs) * dt).truncatingRemainder(dividingBy: 360)
            angleR = (angleR + drive * wf(1) * 360 * (v / r.rt) * dt).truncatingRemainder(dividingBy: 360)
        }

        if let rt = rockT {
            let s = rt + dt
            rockT = s
            if s > 0 {
                // Back about 4 degrees with one small overshoot, settled by 0.3 s.
                let c = min(s, Self.rockTime)
                let target = -Self.rockDeg * (1 - exp(-c / 0.07) * cos(.pi * c / 0.15))
                angleL += target - rockApplied
                rockApplied = target
                if s >= Self.rockTime { rockT = nil }
            }
        }

        // The pack edges breathe by a fraction of a pixel while tape moves.
        for h in 0..<2 {
            let n = 0.5 * sin(2 * .pi * 3.1 * t + phases[4 + h])
                  + 0.35 * sin(2 * .pi * 7.3 * t + phases[6 + h])
                  + 0.15 * sin(2 * .pi * 12.9 * t + phases[8 + h])
            packJitter[h] = drive * n
        }
    }

    // MARK: Lamp and glass

    private func stepLight(_ dt: Double, _ i: Inputs) {
        // On in 0.35 s, out in 0.3 s (the eject dims it to nothing).
        let tau = i.lampOn ? 0.35 : 0.3
        lampLevel += ((i.lampOn ? 1 : 0) - lampLevel) * (1 - exp(-dt / tau))
        // Filament flicker, about 2% between 4 and 8 Hz, on a 0.1 Hz breathe.
        let fl = 0.45 * sin(2 * .pi * 4.3 * t + phases[10])
               + 0.35 * sin(2 * .pi * 6.1 * t + phases[11])
               + 0.20 * sin(2 * .pi * 7.7 * t + phases[12])
        let breathe = sin(2 * .pi * 0.1 * t + phases[13])
        lamp = lampLevel * (1 + 0.02 * fl + 0.03 * breathe)

        // Room light on the door glass: a slow lateral drift, two periods
        // with an irrational ratio (Lissajous), so it never visibly repeats;
        // and a +/- 15% opacity breathe over 30 s.
        reflectionDrift = 0.65 * sin(2 * .pi * t / 40 + phases[14])
                        + 0.35 * sin(2 * .pi * t / (40 * 1.6180339) + phases[15])
        reflectionOpacity = 1 + 0.15 * sin(2 * .pi * t / 30 + phases[3])
    }

    // MARK: VU needles

    // VU NEEDLES ARE CHARACTER, NOT AUDIO. Sonos exposes no audio levels, so
    // nothing here hears the music (same honesty caveat as the `bars`
    // backdrop). Each song gets a loudness level from a stable hash of its
    // tape key (-8 to +1 VU), so the same song always sits at the same place;
    // the needles wander around it on a slow sum of sines, biased so quiet
    // songs stay low and loud ones occasionally kiss the red. The needle
    // itself is a damped spring in angle, with a bounce off the rest peg.
    // Revisit if the BPM lookup (BACKLOG, "Tempo-locked backdrops") lands.

    /// dB -> degrees from vertical, read off the plate's printed scale.
    static func vuAngle(_ db: Double) -> Double {
        let pts: [(Double, Double)] = [(-20, -26.3), (-10, -17.5), (-5, -8.4), (0, 0), (6, 25)]
        if db <= pts[0].0 { return pts[0].1 }
        for i in 1..<pts.count where db <= pts[i].0 {
            let (a, fa) = pts[i - 1], (b, fb) = pts[i]
            return fa + (fb - fa) * (db - a) / (b - a)
        }
        return pts.last!.1
    }

    static let restDeg = vuAngle(-20)
    static let pinDeg = 29.0           // the needle's stop past +6

    /// Hash-driven loudness for a tape key, -8...+1 VU, per channel.
    static func vuCharacter(key: String) -> [Double] {
        let h = fnv1a32("vu:" + key)
        let level = -8 + 9 * Double(h & 0xFFFF) / 65535
        let skew = 1.2 * (Double((h >> 16) & 0xFF) / 255 - 0.5)   // L/R balance
        return [level + skew / 2, level - skew / 2]
    }

    static let kickTime = 1.1          // the song-start swing, then the wander

    private func stepNeedles(_ dt: Double, _ i: Inputs) {
        if let k = i.key, k != vuKey {
            vuKey = k
            vuLevel = Self.vuCharacter(key: k)
            MixtapeManifest.log.info("mixtape vu: \(k, privacy: .public) -> \(String(format: "%.1f / %.1f", self.vuLevel[0], self.vuLevel[1]), privacy: .public) VU (hash character, not audio)")
            kickT = nil
        }
        // Song start: the reels just started on a freshly seated tape.
        // (A resume after a pause just rises back into the wander.)
        if i.driving && !wasDriving, let k = vuKey, k != kickedKey {
            kickedKey = k
            kickT = 0
        }
        wasDriving = i.driving
        if let k = kickT {
            kickT = k + dt
            if k + dt > Self.kickTime || !i.playing { kickT = nil }
        }

        for c in 0..<2 {
            var target: Double, w: Double, zeta: Double, bounce: Double
            if i.playing {
                if let k = kickT, k < Self.kickTime {
                    // Swing up to about 0 VU, two overshoots, then wander.
                    target = Self.vuAngle(c == 0 ? 0 : -0.6)
                    w = 2 * .pi * 1.35; zeta = 0.36; bounce = 0.3
                } else {
                    target = Self.vuAngle(wanderDb(c))
                    w = 2 * .pi * 2.1; zeta = 0.72; bounce = 0.3
                }
            } else {
                // Pause: drop to -20 and bounce a little off the peg.
                // Stop: drop and stay (a softer landing).
                target = Self.restDeg
                w = 2 * .pi * 1.7; zeta = 0.62; bounce = i.paused ? 0.32 : 0.12
            }
            // Semi-implicit Euler, substepped for stability at low frame rates.
            let n = max(1, Int((dt / (1.0 / 240)).rounded(.up)))
            let h = dt / Double(n)
            var x = needleDeg[c], v = needleVel[c]
            for _ in 0..<n {
                v += (w * w * (target - x) - 2 * zeta * w * v) * h
                x += v * h
                if x < Self.restDeg { x = Self.restDeg; if v < 0 { v = -v * bounce } }
                if x > Self.pinDeg { x = Self.pinDeg; if v > 0 { v = -v * 0.3 } }
            }
            needleDeg[c] = x
            needleVel[c] = v
        }
    }

    /// The wander around the song's level, in dB.
    private func wanderDb(_ c: Int) -> Double {
        let level = vuLevel[c]
        let loud = min(1, max(0, (level + 8) / 9))
        let p = phases[c * 3], q = phases[c * 3 + 1], s = phases[c * 3 + 2]
        let n = 0.5 * sin(t * 0.9 + p) + 0.3 * sin(t * 2.3 + q) + 0.2 * sin(t * 4.1 + s)
        // Quiet songs swing further down than up; loud songs reach higher.
        var db = level + (n >= 0 ? n * (1.6 + 2.6 * loud) : n * 3.2)
        // Now and then a loud song's peak kisses the red (a short, sharp
        // excursion about once every 12 s, scaled by how loud the song is).
        let burst = pow(max(0, sin(t * 0.53 + q + Double(c) * 0.4)), 14)
        db += 3.2 * pow(loud, 1.5) * burst
        return db
    }
}
