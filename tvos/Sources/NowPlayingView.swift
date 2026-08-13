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
    let mat: MusicMatMode

    init(controller: SonosController, mat: MusicMatMode) {
        self.sonos = controller
        self.mat = mat
    }

    private var s: SonosState {
        #if targetEnvironment(simulator)
        // Sim-only: `defaults write <bundle> debug.fakeMusic -bool YES` fakes a
        // playing track (with stub cover art) so the Off/Fit/Framed treatments
        // can be verified without a reachable Sonos. Mirrors PhotosView.
        if UserDefaults.standard.bool(forKey: "debug.fakeMusic") {
            return SonosState(
                playing: true, paused: false,
                track: NowPlayingTrack(
                    title: "Landslide", artist: "Fleetwood Mac", album: "Fleetwood Mac",
                    albumArtURL: URL(string: AppConfig.piBase.absoluteString
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
                case .framed: framed(geo.size)
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
