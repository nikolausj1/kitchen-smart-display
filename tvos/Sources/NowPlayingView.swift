import SwiftUI

// NowPlayingView - native tvOS port of the kitchen Now Playing view
// (figma music-nowPlaying.png). Black background; left column has the station
// pill, bold track title, artist, progress bar, three round transport buttons,
// and a big clock bottom-left; right column is large album art.
//
// Transport is driven both by on-screen focusable buttons (Siri Remote click)
// and by the shell's remote handler (play/pause/skip). The TV always targets
// the "Main" Sonos room.

struct NowPlayingView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var tvSettings: TVSettings
    // The shell owns the SonosController (so its remote handler can drive
    // transport from any view) and injects it here as an observed object.
    @ObservedObject var sonos: SonosController

    init(controller: SonosController) {
        self.sonos = controller
    }

    private var s: SonosState { sonos.state }

    private var stationLabel: String {
        if !s.stationName.isEmpty { return s.stationName }
        if let al = s.track?.album, !al.isEmpty { return al }
        return "Sonos"
    }

    private var progress: Double {
        guard let t = s.track, t.durationMs > 0 else { return 0 }
        return min(1, Double(t.elapsedMs) / Double(t.durationMs))
    }

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width
            let H = geo.size.height
            HStack(spacing: 0) {
                // Left column: metadata + transport
                VStack(alignment: .leading, spacing: H * 0.02) {
                    Spacer()
                    Text(stationLabel)
                        .font(.system(size: W * 0.0147, weight: .regular))
                        .lineLimit(1)
                        .padding(.vertical, H * 0.014)
                        .padding(.horizontal, W * 0.02)
                        .background(Color(white: 0.12), in: Capsule())

                    Text(s.track?.title ?? (s.loaded ? "Nothing playing" : "Loading..."))
                        .font(.system(size: W * 0.0242, weight: .bold))
                        .lineLimit(2)
                        .padding(.top, H * 0.01)

                    Text(s.track?.artist ?? "")
                        .font(.system(size: W * 0.0242, weight: .regular))
                        .foregroundStyle(Color(white: 0.85))
                        .lineLimit(1)

                    if s.track != nil {
                        ProgressBar(progress: progress, width: W)
                            .padding(.top, H * 0.02)
                    }

                    // No on-screen transport controls: prev/next/play-pause are
                    // driven by the Siri Remote (shell handler -> Sonos).

                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // Leading inset clears the mat border when the mat is on so the
                // metadata isn't covered; normal margin otherwise.
                .padding(.leading, tvSettings.matEnabled
                         ? MatMetrics.safeInset(CGSize(width: W, height: H)) : W * 0.04)
                .padding(.trailing, W * 0.04)
                .padding(.vertical, H * 0.04)

                // Right column: album art (its outer edge under the mat is fine).
                AlbumArt(url: s.track?.albumArtURL, side: H * 0.92)
                    .padding(.trailing, W * 0.04)
                    .padding(.vertical, H * 0.04)
            }
            .frame(width: W, height: H)
            .background(Color.black)
        }
        .ignoresSafeArea()
        // The shell owns start/stop of the shared controller.
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
