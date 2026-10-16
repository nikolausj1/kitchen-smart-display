import SwiftUI
import UIKit

// MusicVideoStates - how every Music Videos state LOOKS, and nothing else.
// The engine (MusicVideoFeed.swift, MusicVideoPlayer.swift, MusicVideosView.swift)
// fills in a MusicVideoScene; this file draws it. That split is decision 17 of
// docs/designs/music-videos.md: the phase 2 nostalgic skin is a different view
// over the same MusicVideoScene, and the engine does not change.
//
// Phase 1 is deliberately plain: black, snow, SMPTE-style bars, a handwritten
// lower-third. Every state stays in the "TV world" (decision 10): no state
// flips to another backdrop.

// MARK: - The inputs

/// The song, in the shape every state needs. Built from the hub's track.
struct MusicVideoTrack: Equatable {
    var key: String
    var title: String
    var artist: String
    var album: String
    var station: String
    var albumArtURL: URL?
    var durationMs: Int
    var elapsedMs: Int
    var playing: Bool
    var isAd: Bool
}

/// The player's own state, as far as drawing is concerned.
struct MusicVideoPlayerState: Equatable {
    var ready = false       // a first frame can be drawn
    var ended = false       // the file ran out before the song did
    var failed = false      // the stream errored or never became ready
    var buffering = false
}

/// Which of the design's six states the scene is in.
enum MusicVideoState: Equatable {
    case idle        // nothing playing
    case resolving   // a song started and the hub has no answer yet
    case playing     // the video, muted
    case held        // the video ended before the song: last frame, dimmed
    case miss        // no official video, denied by station, or errored
    case ad          // Pandora advertisement
    case stopped     // Sonos paused: the frame freezes
}

/// Everything the design's "States" section lists as available to the view:
/// track (title, artist, album, station, art, duration, elapsed), the palette
/// the other backdrops extract, video (status, URL, source, id, channel,
/// duration) and the player's state.
struct MusicVideoScene: Equatable {
    var track: MusicVideoTrack?
    var palette: [Color] = []
    var video: VideoNow.Video?
    var player = MusicVideoPlayerState()
    /// True when the hub has not answered for a while (no video at all).
    var hubUnreachable = false
    /// The lower-third is up (a track change, for four seconds).
    var lowerThirdVisible = false

    var state: MusicVideoState {
        guard let t = track else { return .idle }
        let status = video?.status
        if status == "idle" { return .idle }
        if t.isAd || status == "ad" { return .ad }
        switch status {
        case "ready":
            if player.failed { return .miss }
            if !player.ready { return .resolving }
            if player.ended { return .held }
            return t.playing ? .playing : .stopped
        case "resolving":
            return .resolving
        case nil:
            return hubUnreachable ? .miss : .resolving
        default:   // none, denied, error, and anything the hub invents later
            return .miss
        }
    }

    /// The video layer is the picture in these states.
    var showsPlayer: Bool {
        switch state {
        case .playing, .held, .stopped: return true
        default: return false
        }
    }
}

// MARK: - The scene

/// Draws a MusicVideoScene. The video layer is passed in (it is owned by the
/// engine) and stays in the hierarchy so the AVPlayerLayer is never rebuilt;
/// it is just invisible outside the states that show it.
struct MusicVideoSceneView<VideoLayer: View>: View {
    let scene: MusicVideoScene
    @ViewBuilder var videoLayer: () -> VideoLayer

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width, H = geo.size.height
            ZStack {
                Color.black
                videoLayer()
                    .opacity(scene.showsPlayer ? (scene.state == .held ? 0.7 : 1) : 0)
                    .animation(.easeInOut(duration: 0.8), value: scene.state == .held)
                    .animation(nil, value: scene.showsPlayer)   // a cut, not a fade

                switch scene.state {
                case .idle:
                    IdleStateView(width: W)
                case .resolving:
                    SnowStateView(track: scene.track, width: W, height: H, caption: true)
                case .ad:
                    SnowStateView(track: scene.track, width: W, height: H, caption: false)
                case .miss:
                    TestPatternView(track: scene.track, width: W, height: H)
                case .playing, .held, .stopped:
                    EmptyView()
                }

                if scene.lowerThirdVisible, let t = scene.track,
                   scene.state == .playing || scene.state == .held {
                    LowerThirdView(track: t, width: W, height: H)
                        .transition(.opacity)
                }
            }
            .frame(width: W, height: H)
            .animation(.easeInOut(duration: 0.5), value: scene.lowerThirdVisible)
        }
    }
}

// MARK: - Idle

private struct IdleStateView: View {
    let width: CGFloat
    var body: some View {
        Text("Nothing playing")
            .font(HandFont.font(width * 0.042))
            .foregroundStyle(Color.white.opacity(0.55))
    }
}

// MARK: - Lower-third

/// Title, artist and station, handwritten, bottom-left, over a soft scrim.
struct LowerThirdView: View {
    let track: MusicVideoTrack
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [.clear, .black.opacity(0.62)],
                           startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: height * 0.004) {
                Text(track.title)
                    .font(HandFont.font(width * 0.046))
                    .lineLimit(1)
                if !track.artist.isEmpty {
                    Text(track.artist)
                        .font(HandFont.font(width * 0.032))
                        .opacity(0.9)
                        .lineLimit(1)
                }
                if !track.station.isEmpty {
                    Text(track.station)
                        .font(HandFont.font(width * 0.024))
                        .opacity(0.7)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.8), radius: 6, y: 2)
            .padding(.leading, width * 0.05)
            .padding(.bottom, height * 0.07)
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Snow

/// One frame of static, generated once: 8-bit gray noise, a little contrasty.
/// The snow animation only ever re-positions this image, so it costs a texture
/// upload once and an offset per tick - not a random pixel field per frame.
private enum SnowNoise {
    static let image: UIImage = {
        let w = 480, h = 270
        var px = [UInt8](repeating: 0, count: w * h)
        var rng = SystemRandomNumberGenerator()
        for i in 0..<px.count {
            let v = Double.random(in: 0...1, using: &rng)
            px[i] = UInt8(pow(v, 0.8) * 255)
        }
        let provider = CGDataProvider(data: Data(px) as CFData)!
        let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8,
                         bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(),
                         bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                         provider: provider, decode: nil, shouldInterpolate: false,
                         intent: .defaultIntent)!
        return UIImage(cgImage: cg)
    }()
}

/// Cheap analog snow: the noise image, oversized, at a random offset and
/// mirroring ~15 times a second, under a fixed scanline overlay.
struct SnowView: View {
    var opacity: Double = 1
    private let fps = 15.0

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width, H = geo.size.height
            ZStack {
                TimelineView(.periodic(from: .now, by: 1 / fps)) { ctx in
                    let frame = Int(ctx.date.timeIntervalSinceReferenceDate * fps)
                    let r = Self.randoms(frame)
                    Image(uiImage: SnowNoise.image)
                        .resizable()
                        .interpolation(.none)
                        .frame(width: W * 1.5, height: H * 1.5)
                        .scaleEffect(x: r.flipX ? -1 : 1, y: r.flipY ? -1 : 1)
                        .offset(x: -r.x * W * 0.5, y: -r.y * H * 0.5)
                        .frame(width: W, height: H, alignment: .topLeading)
                        .clipped()
                }
                .opacity(opacity)
                Scanlines(spacing: max(3, H / 270))
            }
            .frame(width: W, height: H)
            .clipped()
        }
        .allowsHitTesting(false)
    }

    // Deterministic per-frame values from a hash of the frame number
    // (splitmix-style), so the view body stays a pure function of the tick.
    private static func randoms(_ frame: Int) -> (x: Double, y: Double, flipX: Bool, flipY: Bool) {
        func mix(_ v: UInt64) -> UInt64 {
            var z = v &+ 0x9E37_79B9_7F4A_7C15
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
        let a = mix(UInt64(bitPattern: Int64(frame)))
        let b = mix(a)
        return (Double(a % 1000) / 1000, Double(b % 1000) / 1000,
                (a >> 20) & 1 == 1, (b >> 20) & 1 == 1)
    }
}

private struct Scanlines: View {
    let spacing: CGFloat
    var body: some View {
        Canvas { ctx, size in
            var y: CGFloat = 0
            while y < size.height {
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: spacing * 0.45)),
                         with: .color(.black.opacity(0.30)))
                y += spacing
            }
        }
    }
}

/// Resolving and Ad: snow, with the album art faint behind it. Resolving also
/// carries the title small in a corner so the room can see what is coming.
private struct SnowStateView: View {
    let track: MusicVideoTrack?
    let width: CGFloat
    let height: CGFloat
    let caption: Bool

    var body: some View {
        ZStack {
            if let url = track?.albumArtURL {
                AsyncImage(url: url) { phase in
                    if let img = phase.image { img.resizable().scaledToFill() } else { Color.clear }
                }
                .frame(width: width, height: height)
                .clipped()
                .blur(radius: height * 0.03)
                .opacity(0.6)
            }
            SnowView(opacity: track?.albumArtURL == nil ? 0.9 : 0.5)
            if caption, let t = track {
                VStack(alignment: .leading, spacing: 0) {
                    Text(t.title).font(HandFont.font(width * 0.026)).lineLimit(1)
                    if !t.artist.isEmpty {
                        Text(t.artist).font(HandFont.font(width * 0.02)).opacity(0.8).lineLimit(1)
                    }
                }
                .foregroundStyle(.white)
                .shadow(color: .black, radius: 4)
                .padding(.leading, width * 0.04)
                .padding(.top, height * 0.05)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .frame(width: width, height: height)
    }
}

// MARK: - Test pattern (Miss)

/// SMPTE-style color bars with a black card in the middle holding the album
/// art, title and artist. For songs with no official video, stations set to No
/// and streams that errored.
struct TestPatternView: View {
    let track: MusicVideoTrack?
    let width: CGFloat
    let height: CGFloat

    private static let top: [Color] = [
        Color(white: 0.75), Color(red: 0.75, green: 0.75, blue: 0), Color(red: 0, green: 0.75, blue: 0.75),
        Color(red: 0, green: 0.75, blue: 0), Color(red: 0.75, green: 0, blue: 0.75),
        Color(red: 0.75, green: 0, blue: 0), Color(red: 0, green: 0, blue: 0.75),
    ]
    private static let middle: [Color] = [
        Color(red: 0, green: 0, blue: 0.75), .black, Color(red: 0.75, green: 0, blue: 0.75), .black,
        Color(red: 0, green: 0.75, blue: 0.75), .black, Color(white: 0.75),
    ]
    private static let bottom: [Color] = [
        Color(red: 0, green: 0.13, blue: 0.30), .white, Color(red: 0.20, green: 0, blue: 0.42),
        .black, Color(white: 0.04), .black, Color(white: 0.12), .black,
    ]

    var body: some View {
        ZStack {
            Canvas { ctx, size in
                let topH = size.height * 0.67, midH = size.height * 0.08
                row(&ctx, Self.top, y: 0, h: topH, w: size.width)
                row(&ctx, Self.middle, y: topH, h: midH, w: size.width)
                // Bottom band: the -I / white / +Q blocks take 5/7, then a
                // PLUGE-ish black-and-near-black run fills the rest.
                let y = topH + midH, h = size.height - y
                let unit = size.width / 7
                let blocks: [(Color, CGFloat)] = [
                    (Self.bottom[0], unit * 1.25), (Self.bottom[1], unit * 1.25),
                    (Self.bottom[2], unit * 1.25), (Self.bottom[3], unit * 1.25),
                    (Self.bottom[4], unit * 0.5), (Self.bottom[5], unit * 0.5),
                    (Self.bottom[6], unit * 0.5), (Self.bottom[7], unit * 0.5),
                ]
                var x: CGFloat = 0
                for (c, w) in blocks {
                    ctx.fill(Path(CGRect(x: x, y: y, width: w + 1, height: h)), with: .color(c))
                    x += w
                }
            }
            card
        }
        .frame(width: width, height: height)
    }

    private func row(_ ctx: inout GraphicsContext, _ colors: [Color], y: CGFloat, h: CGFloat, w: CGFloat) {
        let bw = w / CGFloat(colors.count)
        for (i, c) in colors.enumerated() {
            ctx.fill(Path(CGRect(x: CGFloat(i) * bw, y: y, width: bw + 1, height: h)), with: .color(c))
        }
    }

    private var card: some View {
        let side = height * 0.22
        return HStack(spacing: width * 0.018) {
            Group {
                if let url = track?.albumArtURL {
                    AsyncImage(url: url) { phase in
                        if let img = phase.image { img.resizable().scaledToFill() } else { Color(white: 0.15) }
                    }
                } else {
                    Color(white: 0.15)
                }
            }
            .frame(width: side, height: side)
            .clipped()
            .overlay(Rectangle().stroke(Color.white, lineWidth: 2))

            VStack(alignment: .leading, spacing: height * 0.006) {
                Text("NO SIGNAL")
                    .font(.system(size: width * 0.0115, weight: .bold, design: .monospaced))
                    .tracking(width * 0.003)
                    .foregroundStyle(Color(red: 0.75, green: 0, blue: 0))
                Text(track?.title ?? "")
                    .font(.system(size: width * 0.024, weight: .bold, design: .monospaced))
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                Text(track?.artist ?? "")
                    .font(.system(size: width * 0.0175, weight: .regular, design: .monospaced))
                    .lineLimit(1)
                    .opacity(0.85)
            }
            .foregroundStyle(.white)
            .frame(width: width * 0.26, alignment: .leading)
        }
        .padding(width * 0.018)
        .background(Color.black)
        .overlay(Rectangle().stroke(Color.white, lineWidth: 2))
    }
}
