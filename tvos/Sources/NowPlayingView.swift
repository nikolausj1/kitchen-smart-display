import SwiftUI

// NowPlayingView - native tvOS port of the kitchen Now Playing view
// (figma music-nowPlaying.png). Three picture-frame treatments, chosen from
// Settings (TVSettings.musicMatMode):
//   .off    - full-bleed, no mat: metadata column left, big album art right.
//   .fit    - the same two-column layout shrunk to live inside the mat opening,
//             with the mat border drawn on top so nothing is clipped.
//   .framed - the opening is filled with a blurred album-art wash, the crisp
//             square cover floats centered on top, and the track title/artist
//             are handwritten on the bottom mat band (cohesive with Photos).
//
// Transport (prev/next/play-pause) is driven by the Siri Remote via the shell's
// handler -> Sonos. The TV always targets the "Main" Sonos room.

struct NowPlayingView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var tvSettings: TVSettings
    // The shell owns the SonosController (so its remote handler can drive
    // transport from any view) and injects it here as an observed object.
    @ObservedObject var sonos: SonosController
    @ObservedObject var mixtapeRemote: MixtapeRemoteSignal
    let mat: MusicMatMode
    #if targetEnvironment(simulator)
    @StateObject private var fakeSequence = FakeMusicSequence()
    #endif

    init(controller: SonosController, mat: MusicMatMode,
         mixtapeRemote: MixtapeRemoteSignal = MixtapeRemoteSignal()) {
        self.sonos = controller
        self.mat = mat
        self.mixtapeRemote = mixtapeRemote
    }

    private var s: SonosState {
        #if targetEnvironment(simulator)
        // Sim-only: `defaults write <bundle> debug.fakeMusic -bool YES` fakes a
        // playing track (with stub cover art) so the Off/Fit/Framed treatments
        // can be verified without a reachable Sonos. Mirrors PhotosView.
        // With debug.fakeMusicSequence also YES, it cycles six tracks (see
        // FakeMusicSequence below) so Mixtape's eject / insert / stop show.
        if UserDefaults.standard.bool(forKey: "debug.fakeMusic"),
           UserDefaults.standard.bool(forKey: "debug.fakeMusicSequence") {
            return fakeSequence.state
        }
        if UserDefaults.standard.bool(forKey: "debug.fakeMusic") {
            return SonosState(
                playing: true, paused: false,
                track: NowPlayingTrack(
                    title: "Landslide", artist: "Fleetwood Mac", album: "Fleetwood Mac",
                    albumArtURL: URL(string: AppConfig.photosBase.absoluteString
                        + "/stub-photos/immich-f5eea208-1ab6-4e49-800a-e6458a86fbe1.jpg"),
                    durationMs: 192_000, elapsedMs: 64_000),
                stationName: "", volume: 30, loaded: true)
        }
        #endif
        return sonos.state
    }

    private var stationLabel: String {
        if !s.stationName.isEmpty { return s.stationName }
        if let al = s.track?.album, !al.isEmpty { return al }
        return "Sonos"
    }

    private var titleText: String { s.track?.title ?? (s.loaded ? "Nothing playing" : "Loading...") }

    // Smoothly-interpolated playback position. Sonos is polled only ~every 1.5s,
    // so the raw elapsed value steps in visible jumps. We anchor to the most
    // recent poll and add the wall-clock time since then (while playing), so the
    // progress bar grows continuously instead of hopping.
    @State private var anchorElapsedMs: Int = 0
    @State private var anchorDate: Date = Date()

    private func smoothProgress(_ now: Date) -> Double {
        guard let t = s.track, t.durationMs > 0 else { return 0 }
        let extraMs = s.playing ? max(0, now.timeIntervalSince(anchorDate) * 1000) : 0
        let elapsed = Double(anchorElapsedMs) + extraMs
        return min(1, elapsed / Double(t.durationMs))
    }

    // Transient label shown after the center button cycles the Framed
    // backdrop (RootView.handleSelect), so Still/Drift-style near-twins are
    // distinguishable without a Settings trip.
    @State private var backdropToast: String?
    @State private var backdropToastID = 0

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topTrailing) {
                switch mat {
                case .off:    fullBleed(geo.size)
                case .fit:    fitted(geo.size)
                case .framed:
                    if tvSettings.framedBackdrop == .mixtape {
                        // Mixtape replaces the mat: the deck is its own frame.
                        MixtapeView(state: s, remote: mixtapeRemote)
                    } else {
                        framed(geo.size)
                    }
                }
                if let toast = backdropToast, mat == .framed {
                    Text(toast)
                        .font(.system(size: geo.size.width * 0.018, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.92))
                        .padding(.vertical, geo.size.width * 0.006)
                        .padding(.horizontal, geo.size.width * 0.014)
                        .background(Capsule().fill(Color.black.opacity(0.55)))
                        .padding(MatMetrics.safeInset(geo.size))
                        .transition(.opacity)
                }
            }
        }
        .ignoresSafeArea()
        #if targetEnvironment(simulator)
        .onAppear { fakeSequence.startIfEnabled() }
        #endif
        .animation(.easeInOut(duration: 0.3), value: backdropToast)
        // Center-button backdrop cycling feedback: flash the new mode's name.
        .onChange(of: tvSettings.framedBackdrop) { _, newVal in
            backdropToast = newVal.label
            backdropToastID += 1
            let id = backdropToastID
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if id == backdropToastID { backdropToast = nil }
            }
        }
        // Re-anchor whenever a poll updates elapsed, the track changes, or
        // play/pause toggles (initial: true seeds it on appear).
        .onChange(of: s.track?.elapsedMs, initial: true) { _, newVal in
            anchorElapsedMs = newVal ?? 0
            anchorDate = Date()
        }
        .onChange(of: s.playing) { _, _ in
            anchorElapsedMs = s.track?.elapsedMs ?? 0
            anchorDate = Date()
        }
        // The shell owns start/stop of the shared controller.
    }

    // MARK: - Off: full-bleed two columns (no mat)

    @ViewBuilder
    private func fullBleed(_ size: CGSize) -> some View {
        twoColumn(canvas: size)
    }

    // MARK: - Fit: the SAME layout, uniformly scaled into the mat opening

    @ViewBuilder
    private func fitted(_ size: CGSize) -> some View {
        // Render the full-bleed layout against the opening as its canvas, then
        // center it and draw the mat on top. Because every dimension (type, art,
        // margins) is relative to the canvas, the whole UI shrinks together and
        // keeps its 4% margins clear of the frame - nothing sits tight to the mat
        // or gets clipped.
        let opening = MatMetrics.opening(size)
        ZStack {
            Color.black
            twoColumn(canvas: opening.size)
                .frame(width: opening.width, height: opening.height)
                .position(x: size.width / 2, y: size.height / 2)
            MatBorderOverlay()
        }
    }

    // Metadata-left / art-right layout, sized to the given canvas (full screen
    // for Off, the mat opening for Fit). All metrics are relative to the canvas.
    @ViewBuilder
    private func twoColumn(canvas: CGSize) -> some View {
        let W = canvas.width, H = canvas.height
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: H * 0.02) {
                Spacer()
                Text(stationLabel)
                    .font(.system(size: W * 0.0147, weight: .regular))
                    .lineLimit(1)
                    .padding(.vertical, H * 0.014)
                    .padding(.horizontal, W * 0.02)
                    .background(Color(white: 0.12), in: Capsule())

                Text(titleText)
                    .font(.system(size: W * 0.0242, weight: .bold))
                    .lineLimit(2)
                    .padding(.top, H * 0.01)

                Text(s.track?.artist ?? "")
                    .font(.system(size: W * 0.0242, weight: .regular))
                    .foregroundStyle(Color(white: 0.85))
                    .lineLimit(1)

                if s.track != nil {
                    TimelineView(.animation) { ctx in
                        ProgressBar(progress: smoothProgress(ctx.date), width: W)
                    }
                    .padding(.top, H * 0.02)
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, W * 0.04)
            .padding(.trailing, W * 0.04)
            .padding(.vertical, H * 0.04)

            AlbumArt(url: s.track?.albumArtURL, side: H * 0.92)
                .padding(.trailing, W * 0.04)
                .padding(.vertical, H * 0.04)
        }
        .frame(width: W, height: H)
        .background(Color.black)
    }

    // MARK: - Framed: blurred ambient fill + centered cover + mat metadata

    @ViewBuilder
    private func framed(_ size: CGSize) -> some View {
        let W = size.width, H = size.height
        let opening = MatMetrics.opening(size)
        let coverSide = opening.height * 0.78
        ZStack {
            Color.black

            // Blurred album-art wash filling the opening, synthesized from the
            // same square cover (Sonos gives no wide imagery).
            blurredFill(url: s.track?.albumArtURL, opening: opening)

            // Crisp square cover, centered in the opening, with a hairline
            // progress line riding the very bottom edge of the art.
            AlbumArt(url: s.track?.albumArtURL, side: coverSide)
                .overlay(alignment: .bottom) {
                    if s.track != nil {
                        TimelineView(.animation) { ctx in
                            hairlineProgress(width: coverSide,
                                             height: max(1, H * 0.0015),
                                             progress: smoothProgress(ctx.date))
                        }
                    }
                }
                .position(x: opening.midX, y: opening.midY)

            // Mat border, then handwritten title/artist on the bottom band.
            MatBorderOverlay()
            framedMetadata(size: size)
        }
        .frame(width: W, height: H)
        .background(Color.black)
    }

    // A barely-there progress line that sits flush along the bottom of the cover
    // (no track chrome): a faint full-width base with a brighter elapsed portion.
    @ViewBuilder
    private func hairlineProgress(width: CGFloat, height: CGFloat, progress: Double) -> some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(Color.white.opacity(0.25))
                .frame(width: width, height: height)
            Rectangle().fill(Color.white.opacity(0.9))
                .frame(width: width * progress, height: height)
        }
        .allowsHitTesting(false)
    }

    // "Breathing" drift for the blurred wash: a Lissajous wander (x/y on
    // different ~30s periods, so the path never visibly repeats) plus a scale
    // breathe (~40s). Amplitudes tuned on the real TV - the first pass (1.8%
    // offsets over ~1-minute periods) read as static from the couch. The
    // minimum scale (1.13) always covers the maximum offset (4.5%), so edges
    // never reveal. Framed music mode only.
    private static func drift(_ date: Date, opening: CGRect) -> (scale: CGFloat, offset: CGSize) {
        let t = date.timeIntervalSinceReferenceDate
        let scale = 1.25 + 0.12 * sin(t * 2 * .pi / 40)
        let dx = opening.width * 0.045 * sin(t * 2 * .pi / 28)
        let dy = opening.height * 0.040 * sin(t * 2 * .pi / 34)
        return (CGFloat(scale), CGSize(width: dx, height: dy))
    }

    // The opening fill behind the cover, per the Framed Backdrop setting:
    // Still (original static wash), Drift (wash on a slow wander), Lava
    // (palette blobs, LavaBackdrop.swift), or the Metal fluids Marble / Ink
    // (FluidBackdrop.swift + Backdrop.metal).
    @ViewBuilder
    private func blurredFill(url: URL?, opening: CGRect) -> some View {
        switch tvSettings.framedBackdrop {
        case .still:
            washBody(url: url, opening: opening, scale: 1, offset: .zero)
        case .drift:
            // ~20 updates/s keeps steps sub-pixel at these speeds while
            // costing a fraction of a per-frame timeline. The transform sits
            // AFTER .blur, so the GPU re-composites the cached blurred
            // texture and never re-runs the blur.
            TimelineView(.periodic(from: .now, by: 0.05)) { ctx in
                let d = Self.drift(ctx.date, opening: opening)
                washBody(url: url, opening: opening, scale: d.scale, offset: d.offset)
            }
        case .lava:
            LavaBackdrop(url: url, opening: opening)
        case .smoke:
            FluidBackdrop(url: url, opening: opening, style: .smoke)
        case .caustics:
            FluidBackdrop(url: url, opening: opening, style: .caustics)
        case .ripple:
            FluidBackdrop(url: url, opening: opening, style: .ripple)
        case .bars:
            FluidBackdrop(url: url, opening: opening, style: .bars)
        case .marble:
            FluidBackdrop(url: url, opening: opening, style: .marble)
        case .mixtape:
            // Never reached: Mixtape replaces the whole framed layout (body).
            washBody(url: url, opening: opening, scale: 1, offset: .zero)
        }
    }

    // The blurred-wash fill (shared by Still and Drift; Drift animates the
    // post-blur transform).
    @ViewBuilder
    private func washBody(url: URL?, opening: CGRect, scale: CGFloat, offset: CGSize) -> some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let img = phase.image {
                        img.resizable().scaledToFill()
                    } else {
                        Color(white: 0.08)
                    }
                }
            } else {
                Color(white: 0.08)
            }
        }
        .frame(width: opening.width, height: opening.height)
        .clipped()
        .blur(radius: opening.height * 0.06)
        .scaleEffect(scale)
        .offset(offset)
        .frame(width: opening.width, height: opening.height)
        .clipped()
        .overlay(Color.black.opacity(0.28))
        .position(x: opening.midX, y: opening.midY)
        .allowsHitTesting(false)
    }

    // Track title over artist, handwritten on the bottom mat band. Uses the SAME
    // Figma top-y coordinates (titleTop 2005.57 / dateTop 2077, frame 3840x2160)
    // as the Photos mat, so the title/artist line spacing matches Photos exactly
    // - just centered horizontally instead of right-aligned.
    @ViewBuilder
    private func framedMetadata(size: CGSize) -> some View {
        let sy = size.height / 2160
        ZStack(alignment: .top) {
            handLine(titleText, pt: 64, topY: 2005.57, sy: sy)
            if let artist = s.track?.artist, !artist.isEmpty {
                handLine(artist, pt: 42, topY: 2077, sy: sy)
            }
        }
        .foregroundStyle(HandFont.ink)
        .lineLimit(1)
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(false)
    }

    // One handwritten line, top-anchored at the Figma y and centered horizontally
    // (mirrors HandwrittenMat.line in PhotosView, but center-aligned).
    @ViewBuilder
    private func handLine(_ text: String, pt: CGFloat, topY: CGFloat, sy: CGFloat) -> some View {
        Text(text)
            .font(HandFont.font(pt * sy))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.top, topY * sy)
    }
}

private struct ProgressBar: View {
    let progress: Double
    let width: CGFloat
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(white: 0.25))
                Capsule().fill(Color(white: 0.85))
                    .frame(width: g.size.width * progress)
            }
        }
        .frame(width: width * 0.40, height: width * 0.0073)
    }
}


private struct AlbumArt: View {
    let url: URL?
    let side: CGFloat
    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let img = phase.image {
                        img.resizable().scaledToFit()
                    } else {
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: side, height: side)
        .background(Color(white: 0.12))
        .shadow(color: .black.opacity(0.55), radius: 30, y: 12)
    }

    private var placeholder: some View {
        LinearGradient(colors: [Color(white: 0.10), Color(white: 0.16)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay(Image(systemName: "music.note")
                .font(.system(size: side * 0.18))
                .foregroundStyle(.white.opacity(0.25)))
    }
}

#if targetEnvironment(simulator)
// Sim-only fake Sonos sequence for verifying Mixtape without a Sonos:
//
//   B=com.nikolaus.kitchendisplay.tv; SIM="Apple TV 4K (3rd generation)"
//   xcrun simctl spawn "$SIM" defaults write $B debug.fakeMusic -bool YES
//   xcrun simctl spawn "$SIM" defaults write $B debug.fakeMusicSequence -bool YES
//   xcrun simctl spawn "$SIM" defaults write $B debug.noHubSync -bool YES
//   xcrun simctl spawn "$SIM" defaults write $B tv.musicMatMode -int 2      # framed
//   xcrun simctl spawn "$SIM" defaults write $B tv.framedBackdrop -int 8    # mixtape
//   xcrun simctl spawn "$SIM" defaults write $B debug.view music
//   optional: ... defaults write $B debug.fakeMusicRapid -bool YES
//   (then terminate and relaunch the app)
//
// Cycle (105 s): six tracks of 16 s each, then a 9 s stopped gap. The gap is
// longer than Mixtape's 5 s stop grace so the eject-to-empty actually plays
// (about 5 s of grace, 1 s of eject and door, 3 s of empty well) before track
// one inserts again. Track two pauses for 3 s in the middle (reels ease out,
// PAUSE key latches). Track four is radio (station name, duration 0, no art).
// Durations are 18 s starting at 1 s, so over each 16 s window the packs sweep
// from nearly all on the left reel to nearly all on the right.
//
// Tapes (fnv1a32(key) mod 14, see the manifest): memorex_dbs_blank,
// tdk_sax_printed, sony_hf_blank (long-title shrink test), basf_ce2_printed
// (radio, STATION caption), maxell_udxl2_printed, memorex_dbs_printed.
//
// debug.fakeMusicRapid: at the start of track six, two decoy tracks come
// first, so three track changes land 0.7 s apart (decoy A, decoy B, track
// six). Mixtape must coalesce them: ONE eject of track five and ONE insert,
// of track six's tape. The model logs "mixtape eject:" / "mixtape insert:".
@MainActor
final class FakeMusicSequence: ObservableObject {
    @Published private(set) var state = SonosState.empty
    private var timer: Timer?
    private let epoch = Date()

    private struct Fake {
        let title, artist, album: String
        let art: String?
        var station = ""
        var durationMs = 18_000
        var startMs = 1_000
    }
    private let tracks: [Fake] = [
        Fake(title: "Landslide", artist: "Fleetwood Mac", album: "Fleetwood Mac",
             art: "immich-0069d7ca-ea58-4a45-aa49-4077eec30356.jpg"),
        Fake(title: "Take On Me", artist: "a-ha", album: "Hunting High and Low",
             art: "immich-00ab580d-f6af-45d0-9776-b2421315fc86.jpg"),
        Fake(title: "A Very Long Song Title That Will Not Fit On The Label At All",
             artist: "The Unreasonably Named Orchestra Of Eastern Kentucky",
             album: "Harvest Moon",
             art: "immich-0073a090-1533-49e6-a1c2-e5b5f3cf4c34.jpg"),
        Fake(title: "Morning Edition", artist: "", album: "", art: nil,
             station: "KEXP 90.3 FM", durationMs: 0, startMs: 0),
        Fake(title: "Clair de Lune", artist: "Claude Debussy", album: "Suite bergamasque",
             art: "immich-0069d7ca-ea58-4a45-aa49-4077eec30356.jpg"),
        Fake(title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue",
             art: "immich-0073a090-1533-49e6-a1c2-e5b5f3cf4c34.jpg"),
    ]
    // Rapid-skip decoys (tapes maxell_udxl2_blank, tdk_sax_blank).
    private let decoys: [Fake] = [
        Fake(title: "Superstition", artist: "Stevie Wonder", album: "Talking Book",
             art: "immich-00ab580d-f6af-45d0-9776-b2421315fc86.jpg"),
        Fake(title: "Hey Ya!", artist: "OutKast", album: "Speakerboxxx/The Love Below",
             art: "immich-0069d7ca-ea58-4a45-aa49-4077eec30356.jpg"),
    ]
    private let slot = 16.0
    private let stopGap = 9.0
    private var cycle: Double { slot * Double(tracks.count) + stopGap }

    func startIfEnabled() {
        guard timer == nil,
              UserDefaults.standard.bool(forKey: "debug.fakeMusicSequence") else { return }
        tick()
        // 0.1 s ticks so the rapid-skip changes land on time; the published
        // state only changes when it differs (elapsed is quantised to 0.5 s,
        // about the real 1.5 s poll's granularity or finer).
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        let next = compute()
        if next != state { state = next }
    }

    private func compute() -> SonosState {
        let t = Date().timeIntervalSince(epoch).truncatingRemainder(dividingBy: cycle)
        let n = tracks.count
        let i = Int(t / slot)
        if i >= n {
            // Stopped: Sonos keeps reporting the last track while STOPPED.
            var st = make(tracks[n - 1], elapsedS: slot)
            st.playing = false
            st.paused = false
            return st
        }
        let within = t - Double(i) * slot
        if i == n - 1, within < 1.4, UserDefaults.standard.bool(forKey: "debug.fakeMusicRapid") {
            return make(decoys[within < 0.7 ? 0 : 1], elapsedS: 0)
        }
        if i == 1, within >= 6, within < 9 {
            var st = make(tracks[1], elapsedS: 6)
            st.playing = false
            st.paused = true
            return st
        }
        // Track two's elapsed skips the paused 3 s.
        let e = (i == 1 && within >= 9) ? within - 3 : within
        return make(tracks[i], elapsedS: e)
    }

    private func make(_ f: Fake, elapsedS: Double) -> SonosState {
        let q = (elapsedS * 2).rounded(.down) / 2
        return SonosState(
            playing: true, paused: false,
            track: NowPlayingTrack(
                title: f.title, artist: f.artist, album: f.album,
                albumArtURL: f.art.flatMap { URL(string: AppConfig.photosBase.absoluteString + "/stub-photos/" + $0) },
                durationMs: f.durationMs,
                elapsedMs: f.durationMs == 0 ? 0 : min(f.durationMs, f.startMs + Int(q * 1000))),
            stationName: f.station, volume: 30, loaded: true)
    }
}
#endif
