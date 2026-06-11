import SwiftUI

// PhotosView - native tvOS port of the kitchen Photo Slideshow.
//
// Loads photos from the Pi manifest, runs the same advance/portrait-pairing
// engine, and renders each item with face-aware smart cropping (fill) or a
// fit-with-blur fallback. Crossfades between items. Overlays an EXIF caption
// and a clock, matching the web slideshow overlays.

struct PhotosView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var tvSettings: TVSettings
    @StateObject private var engine = SlideshowEngine()
    // Optional shell-provided remote channel (Siri Remote left/right -> photo
    // prev/next). nil when PhotosView is used standalone.
    @ObservedObject var remote: PhotoRemoteSignal
    // Shared Sonos controller (owned by the shell) so the photo screen can show
    // the album-art corner + handwritten music line when music is on.
    @ObservedObject var sonos: SonosController

    init(remote: PhotoRemoteSignal = PhotoRemoteSignal(), sonos: SonosController) {
        self.remote = remote
        self.sonos = sonos
    }

    // Current music presence for the album-art corner + handwritten music line.
    private struct MusicMeta { var show: Bool; var art: URL?; var title: String?; var artist: String? }
    private var music: MusicMeta {
        #if targetEnvironment(simulator)
        // Sim-only: `defaults write <bundle> debug.fakeMusic -bool YES` fakes a
        // playing track so the album-art + music-line layout can be verified
        // without touching the real Sonos. Uses a stub image as fake cover art.
        if UserDefaults.standard.bool(forKey: "debug.fakeMusic") {
            return MusicMeta(
                show: true,
                art: URL(string: AppConfig.piBase.absoluteString + "/stub-photos/immich-f5eea208-1ab6-4e49-800a-e6458a86fbe1.jpg"),
                title: "Landslide", artist: "Fleetwood Mac")
        }
        #endif
        return MusicMeta(show: sonos.recentlyPlaying(),
                         art: sonos.state.track?.albumArtURL,
                         title: sonos.state.track?.title,
                         artist: sonos.state.track?.artist)
    }

    // EXIF of the currently shown item (location/date drive the caption). For a
    // portrait pair this is the LEFT photo.
    private var currentExif: PhotoExif? {
        switch engine.current {
        case .landscape(let p): return p.exif
        case .portraitSolo(let p): return p.exif
        case .portraitPair(let a, _): return a.exif
        case nil: return nil
        }
    }

    // EXIF of the RIGHT photo in a portrait pair (nil otherwise), so its caption
    // can be written on the mat starting at the screen center.
    private var rightExif: PhotoExif? {
        if case .portraitPair(_, let b) = engine.current { return b.exif }
        return nil
    }

    // Curated artwork metadata of the current item (nil for regular photos).
    // Art items are always solo (the engine never pairs them).
    private var currentArt: PhotoArt? {
        switch engine.current {
        case .landscape(let p): return p.art
        case .portraitSolo(let p): return p.art
        default: return nil
        }
    }

    // The current photo when (and only when) it is an artwork, for ArtStage.
    private var currentArtPhoto: Photo? {
        switch engine.current {
        case .landscape(let p) where p.art != nil: return p
        case .portraitSolo(let p) where p.art != nil: return p
        default: return nil
        }
    }

    // One curated fun fact for the current artwork, rotated per showing:
    // generation increments on every advance, so the same piece surfaces a
    // different fact on different visits (and the pick is stable while the
    // piece is on screen).
    private var currentArtFact: String? {
        guard tvSettings.artFacts,
              let facts = currentArt?.facts, !facts.isEmpty else { return nil }
        return facts[engine.generation % facts.count]
    }

    var body: some View {
        GeometryReader { geo in
            // Z-order (bottom -> top):
            //   photo -> album art (in opening) -> mat border -> handwritten
            //   metadata (printed on the mat). When the mat is OFF, fall back
            //   to the white caption + a plain corner album art.
            let matOn = tvSettings.photosMatEnabled
            // Via the `music` property (not sonos directly) so the sim-only
            // debug.fakeMusic flag actually fakes the corner + music line.
            // The whole Now Playing presence (album-art corner + handwritten
            // track lines) is suppressed while an ARTWORK is up - a gallery
            // wall has no album covers - so the art placard's year/movement
            // never has to yield the right corner.
            let m = music
            let showMusic = m.show && currentArt == nil
            ZStack {
                Color.black
                if let item = engine.current {
                    if matOn, let artPhoto = currentArtPhoto {
                        // Artworks get the shadow-box stage: blurred wash of
                        // the painting filling the opening, the crisp canvas
                        // floating centered with a soft shadow (the Framed
                        // Now Playing treatment, see docs/designs/art-albums.md).
                        ArtStage(photo: artPhoto, size: geo.size)
                            .id(engine.generation)        // new id per advance
                            .transition(.opacity)         // crossfade
                    } else {
                        // When matted, render the photo INSIDE the opening (inset by
                        // the mat width) so the mat frames the photo instead of
                        // covering its edges and cropping heads. Unmatted = full bleed.
                        let stageSize = matOn ? MatMetrics.opening(geo.size).size : geo.size
                        PhotoStage(item: item, settings: model.settings.slideshow,
                                   size: stageSize)
                            .frame(width: stageSize.width, height: stageSize.height)
                            .position(x: geo.size.width / 2, y: geo.size.height / 2)
                            .id(engine.generation)        // new id per advance
                            .transition(.opacity)         // crossfade
                    }
                }

                // Album art corner (inside the opening), shown when music is on
                // or recently was - but never over an artwork. White inner
                // border + shadow only when matted.
                if showMusic, let art = m.art {
                    AlbumArtCorner(url: art, size: geo.size, matted: matOn)
                }

                // Mat border sits above the photo + album art...
                if matOn { MatBorderOverlay() }

                // ...and the handwritten metadata is printed on top of the mat.
                // Artworks get a museum placard: title + artist bottom-left,
                // year + movement bottom-right. The music block keeps priority
                // over the right corner while something is playing.
                if matOn {
                    HandwrittenMat(size: geo.size,
                                   photoLocation: currentArt?.title ?? currentExif?.location,
                                   photoDate: currentArt != nil ? currentArt?.artist : currentExif?.date,
                                   rightPhotoLocation: rightExif?.location,
                                   rightPhotoDate: rightExif?.date,
                                   musicTitle: showMusic ? m.title : nil,
                                   musicArtist: showMusic ? m.artist : nil,
                                   artYear: currentArt?.year,
                                   artMovement: currentArt?.movement,
                                   artFact: currentArtFact)
                } else if let item = engine.current {
                    // Unmatted fallback: white caption over the photo.
                    ExifCaptionOverlay(item: item,
                                       settings: model.settings.slideshow,
                                       generation: engine.generation,
                                       edgeInset: 40)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .animation(.easeInOut(duration: 0.8), value: engine.generation)
        }
        .ignoresSafeArea()
        .task(id: photosKey) {
            // Fetch now, then re-fetch the manifest every 5 min (matches the
            // web useImmichPhotos refresh) so new albums/photos baked into the
            // manifest by a rebuild+deploy appear without relaunching the app.
            // engine.configure() no-ops when the photo set is unchanged, so a
            // refresh that returns the same photos won't interrupt the show.
            // Cancelled + restarted automatically whenever photosKey changes
            // (album selection / sort / interval).
            while !Task.isCancelled {
                // Album selection is a TV-LOCAL setting (TVSettings, nil = all
                // albums), independent of the kitchen's selection - the TV can
                // show e.g. just an art album while the kitchen shows family
                // photos.
                let photos = await PhotoService().fetch(
                    selectedAlbumIds: tvSettings.selectedAlbumIdList)
                // Photo dwell is a TV-LOCAL setting (TVSettings), independent of
                // the kitchen's interval - the big-screen-across-the-room cadence
                // wants its own value.
                let tvInterval = tvSettings.photoDurationSeconds * 1000
                engine.configure(photos: photos,
                                 sortOrder: model.settings.slideshow.sortOrder,
                                 intervalMs: tvInterval)
                try? await Task.sleep(nanoseconds: 5 * 60 * 1_000_000_000)
            }
        }
        .onDisappear { engine.stop() }
        // Observe the per-press sequence counter so every press advances, even
        // repeated presses in the same direction.
        .onChange(of: remote.seq) { _, _ in
            switch remote.action {
            case .next: engine.next()
            case .previous: engine.previous()
            }
        }
    }

    // Re-run the slideshow task when album selection / sort change, or when the
    // TV-local photo duration changes (so the new interval is applied live).
    private var photosKey: String {
        let s = model.settings.slideshow
        let albums = tvSettings.selectedAlbumIdList?.joined(separator: ",") ?? "all"
        return "\(albums)|\(s.sortOrder)|\(tvSettings.photoDurationSeconds)"
    }
}

// MARK: - Stage (landscape / pair / solo)

private struct PhotoStage: View {
    let item: DisplayItem
    let settings: SlideshowSettings
    let size: CGSize

    var body: some View {
        switch item {
        case .landscape(let p):
            CroppedPhoto(photo: p, settings: settings,
                         containerW: size.width, containerH: size.height)
        case .portraitSolo(let p):
            // Route through the same resolver; portrait into full frame.
            CroppedPhoto(photo: p, settings: settings,
                         containerW: size.width, containerH: size.height)
        case .portraitPair(let a, let b):
            // Thin black divider line between the two portraits (like the
            // kitchen's center seam). Each photo takes half of the width that
            // remains after the divider.
            let divider: CGFloat = 6
            let half = (size.width - divider) / 2
            HStack(spacing: 0) {
                CroppedPhoto(photo: a, settings: settings,
                             containerW: half, containerH: size.height)
                Color.black.frame(width: divider, height: size.height)
                CroppedPhoto(photo: b, settings: settings,
                             containerW: half, containerH: size.height)
            }
        }
    }
}

// MARK: - Art stage (shadow box inside the mat opening)

// One artwork rendered like a shadow box: the mat opening is filled with a
// blurred wash of the same painting, and the crisp canvas floats centered at
// its natural aspect with a soft drop shadow. Ported from the Framed Now
// Playing treatment (NowPlayingView.framed()/blurredFill()).
private struct ArtStage: View {
    let photo: Photo
    let size: CGSize

    var body: some View {
        let opening = MatMetrics.opening(size)
        ZStack {
            AsyncImage(url: photo.url, transaction: Transaction(animation: .none)) { phase in
                if let img = phase.image {
                    img.resizable().scaledToFill()
                } else {
                    Color(white: 0.08)
                }
            }
            .frame(width: opening.width, height: opening.height)
            .clipped()
            .blur(radius: opening.height * 0.06)
            .frame(width: opening.width, height: opening.height)
            .clipped()
            .overlay(Color.black.opacity(0.28))
            .position(x: opening.midX, y: opening.midY)

            AsyncImage(url: photo.url, transaction: Transaction(animation: .none)) { phase in
                if let img = phase.image {
                    img.resizable().scaledToFit()
                        .shadow(color: .black.opacity(0.45),
                                radius: opening.height * 0.025,
                                y: opening.height * 0.008)
                } else {
                    Color.clear
                }
            }
            .frame(width: opening.width * 0.95, height: opening.height * 0.95)
            .position(x: opening.midX, y: opening.midY)
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(false)
    }
}

// MARK: - A single cropped cell

private struct CroppedPhoto: View {
    let photo: Photo
    let settings: SlideshowSettings
    let containerW: CGFloat
    let containerH: CGFloat

    private var plan: CellPlan {
        // Artworks are never cropped, whatever the display mode: when the mat
        // is off they fall through to here, and fit-with-blur is exactly the
        // shadow-box look minus the mat.
        if photo.art != nil {
            return CellPlan(mode: .fit, focusX: 0.5, focusY: 0.5)
        }
        return resolveCell(
            photoW: Double(photo.width), photoH: Double(photo.height),
            containerW: Double(containerW), containerH: Double(containerH),
            displayMode: settings.displayMode,
            smartThreshold: settings.smartCropLossThreshold,
            smartFaces: settings.smartFaces,
            faces: photo.faces ?? []
        )
    }

    var body: some View {
        let W = containerW, H = containerH
        ZStack {
            if plan.mode == .fill {
                fillBody(W: W, H: H)
            } else {
                fitBody(W: W, H: H)
            }
        }
        .frame(width: W, height: H)
        .clipped()
    }

    // Cover-crop with a focus alignment. Uses SwiftUI's idiomatic
    // aspectRatio(.fill) + frame + clipped (the known-good cover form), with
    // an alignment derived from the focus point so faces stay in frame.
    @ViewBuilder
    private func fillBody(W: CGFloat, H: CGFloat) -> some View {
        // Cover-crop: scaledToFill on a framed+clipped AsyncImage. Alignment
        // biases the crop toward the focus point so faces stay in frame.
        AsyncImage(url: photo.url, transaction: Transaction(animation: .none)) { phase in
            switch phase {
            case .success(let img): img.resizable().scaledToFill()
            case .empty: Color.black
            case .failure: Color.black
            @unknown default: Color.black
            }
        }
        .frame(width: W, height: H, alignment: focusAlignment)
        .clipped()
    }

    // Map the focus point (0..1) to a SwiftUI Alignment. Only the cropped axis
    // matters; the other is centered.
    private var focusAlignment: Alignment {
        let h: HorizontalAlignment = plan.focusX < 0.34 ? .leading
            : (plan.focusX > 0.66 ? .trailing : .center)
        let v: VerticalAlignment = plan.focusY < 0.34 ? .top
            : (plan.focusY > 0.66 ? .bottom : .center)
        return Alignment(horizontal: h, vertical: v)
    }

    // Fit (letterbox) with a blurred cover-fill backdrop behind it.
    @ViewBuilder
    private func fitBody(W: CGFloat, H: CGFloat) -> some View {
        AsyncImage(url: photo.url, transaction: Transaction(animation: .none)) { phase in
            switch phase {
            case .success(let img):
                ZStack {
                    img.resizable().aspectRatio(contentMode: .fill)
                        .frame(width: W, height: H)
                        .clipped()
                        .blur(radius: 40)
                        .overlay(Color.black.opacity(0.35))
                    img.resizable().aspectRatio(contentMode: .fit)
                        .frame(width: W, height: H)
                }
            case .empty:   Color.black
            case .failure: Color.black
            @unknown default: Color.black
            }
        }
    }
}

// MARK: - Overlays

// Album art shown in the bottom-right corner of the photo opening. Sized ~22%
// of height (Figma). When matted, it sits inside the opening with a white inner
// border + drop shadow; unmatted, a plain corner widget.
private struct AlbumArtCorner: View {
    let url: URL
    let size: CGSize
    let matted: Bool

    // Exact Figma coords (frame 3840x2160): album_art at (3173,1478), 475x475.
    var body: some View {
        let sx = size.width / 3840, sy = size.height / 2160
        let side = 475 * sy
        // Top-left corner per Figma; when unmatted, nudge toward the corner a
        // little since there's no mat to clear.
        // figY nudged down a touch from the raw Figma 1478 per Justin's eye.
        let figX = 3173.0, figY = 1478.0 + 14.0
        let x = (matted ? figX : figX + 60) * sx
        let y = (matted ? figY : figY + 40) * sy
        AsyncImage(url: url, transaction: Transaction(animation: .none)) { phase in
            if let img = phase.image {
                img.resizable().aspectRatio(contentMode: .fill)
            } else {
                Color(white: 0.12)
            }
        }
        .frame(width: side, height: side)
        .clipped()
        .overlay(
            // Hairline white inner border (was 3px).
            Rectangle().strokeBorder(Color.white.opacity(matted ? 0.9 : 0), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 14, x: 4, y: 4)
        // Absolute placement: pad to the top-left corner, fill the rest.
        .padding(.leading, x)
        .padding(.top, y)
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

// Handwritten metadata printed on the bottom mat band: photo location/date at
// the bottom-left (aligned to the opening's left edge), music title/artist at
// the bottom-right (aligned to the opening's right edge). Pencil-gray Caveat.
private struct HandwrittenMat: View {
    let size: CGSize
    let photoLocation: String?
    let photoDate: String?
    // Right photo of a 2-up portrait pair (nil otherwise): written starting at
    // the screen center (the seam = left edge of the right photo).
    var rightPhotoLocation: String? = nil
    var rightPhotoDate: String? = nil
    let musicTitle: String?
    let musicArtist: String?
    // Artwork placard right block (year over movement), written where the
    // music block goes. Callers pass nil while music is playing so the music
    // metadata keeps the corner.
    var artYear: String? = nil
    var artMovement: String? = nil
    // Curated fun fact, bottom-center of the mat between the placard blocks
    // (up to two lines, smaller hand). nil when Art Facts is off or the
    // current item isn't art.
    var artFact: String? = nil

    // Exact Figma coordinates (frame authored at 3840x2160). Each line is
    // placed by its top-left/top-right corner so it lands exactly where the
    // mock shows it, instead of being centered in the band heuristically.
    private enum Fig {
        static let frameW: CGFloat = 3840
        static let frameH: CGFloat = 2160
        static let leftX: CGFloat = 154          // photo text left edge (= opening left)
        static let centerX: CGFloat = 1920       // seam = left edge of the right photo
        static let openingRight: CGFloat = 3699  // 154 + 3545 (opening right edge)
        static let titleTop: CGFloat = 2005.57   // both titles' top y
        static let dateTop: CGFloat = 2077       // both subtitles' top y
        static let titlePt: CGFloat = 64
        static let datePt: CGFloat = 42
        static let factMaxW: CGFloat = 1400      // keeps clear of both placard blocks
    }

    var body: some View {
        let W = size.width, H = size.height
        let sx = W / Fig.frameW, sy = H / Fig.frameH
        let titleSize = Fig.titlePt * sy
        let dateSize = Fig.datePt * sy
        let leftPad = Fig.leftX * sx
        let centerPad = Fig.centerX * sx
        let rightPad = (Fig.frameW - Fig.openingRight) * sx
        let titleTop = Fig.titleTop * sy
        let dateTop = Fig.dateTop * sy

        ZStack(alignment: .topLeading) {
            // Photo metadata (left), anchored to each line's top-left corner.
            line(photoLocation, size: titleSize, top: titleTop, leadingPad: leftPad, trailing: false)
            line(photoDate, size: dateSize, top: dateTop, leadingPad: leftPad, trailing: false)
            // Right-photo metadata (2-up pairs), left-aligned starting at center.
            line(rightPhotoLocation, size: titleSize, top: titleTop, leadingPad: centerPad, trailing: false)
            line(rightPhotoDate, size: dateSize, top: dateTop, leadingPad: centerPad, trailing: false)
            // Music metadata (right), anchored to each line's top-right corner.
            line(musicTitle, size: titleSize, top: titleTop, trailingPad: rightPad, trailing: true)
            line(musicArtist, size: dateSize, top: dateTop, trailingPad: rightPad, trailing: true)
            // Artwork year + movement (right corner, same slots as music).
            line(artYear, size: titleSize, top: titleTop, trailingPad: rightPad, trailing: true)
            line(artMovement, size: dateSize, top: dateTop, trailingPad: rightPad, trailing: true)
            // Fun fact, bottom-center between the two placard blocks, in the
            // same hand as the artist line. Long facts are pre-broken near
            // their midpoint into two balanced lines (rather than one
            // screen-wide line). The block is vertically CENTERED in the
            // bottom mat band (one- and two-line facts both float with even
            // space above and below) instead of hugging the band's inner
            // edge. Its own lineLimit overrides the ZStack-wide single-line
            // default.
            if let f = artFact, !f.isEmpty {
                let bandH = MatMetrics.matWidth(size)
                Text(Self.balancedFact(f))
                    .font(HandFont.font(dateSize))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(maxWidth: Fig.factMaxW * sx)
                    .frame(width: W, height: bandH)          // band-sized box,
                    // centered in the band, nudged up a touch (per Justin's
                    // eye - optical center sits slightly above geometric).
                    .position(x: W / 2, y: H - bandH / 2 - bandH * 0.08)
            }
        }
        .foregroundStyle(HandFont.ink)
        .lineLimit(1)
        .frame(width: W, height: H)
        .allowsHitTesting(false)
    }

    // Break a long fact near its midpoint at a word boundary so it renders as
    // two balanced handwritten lines instead of one super-wide one. Short
    // facts stay on a single line.
    static func balancedFact(_ s: String) -> String {
        guard s.count > 60 else { return s }
        let chars = Array(s)
        let mid = chars.count / 2
        var best: Int?
        for (i, c) in chars.enumerated() where c == " " {
            if best == nil || abs(i - mid) < abs(best! - mid) { best = i }
        }
        guard let b = best else { return s }
        var out = chars
        out[b] = "\n"
        return String(out)
    }

    // One absolutely-positioned text line (top-anchored at the Figma y).
    @ViewBuilder
    private func line(_ text: String?, size: CGFloat, top: CGFloat,
                      leadingPad: CGFloat = 0, trailingPad: CGFloat = 0,
                      trailing: Bool) -> some View {
        if let t = text, !t.isEmpty {
            // Trailing space so Caveat's slanted final glyph isn't clipped at the
            // Text's tight intrinsic bounds (its ink overhangs the advance width).
            Text(t + " ")
                .font(HandFont.font(size))
                .frame(maxWidth: .infinity, maxHeight: .infinity,
                       alignment: trailing ? .topTrailing : .topLeading)
                .padding(.leading, leadingPad)
                .padding(.trailing, trailingPad)
                .padding(.top, top)
        }
    }
}

private struct ExifCaptionOverlay: View {
    let item: DisplayItem
    let settings: SlideshowSettings
    let generation: Int
    var edgeInset: CGFloat = 40   // distance from screen edge (clears mat when on)
    @State private var visible = true

    private var exif: PhotoExif? {
        switch item {
        case .landscape(let p): return p.exif
        case .portraitSolo(let p): return p.exif
        case .portraitPair(let a, _): return a.exif
        }
    }

    var body: some View {
        let e = exif
        let hasText = (e?.location?.isEmpty == false) || (e?.date?.isEmpty == false)
        return VStack {
            Spacer()
            HStack {
                if hasText, visible {
                    VStack(alignment: .leading, spacing: 6) {
                        if let loc = e?.location, !loc.isEmpty {
                            Text(loc).font(.system(size: 40, weight: .semibold))
                        }
                        if let d = e?.date, !d.isEmpty {
                            Text(d).font(.system(size: 30, weight: .regular))
                                .foregroundStyle(.white.opacity(0.85))
                        }
                    }
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.7), radius: 10, y: 2)
                    .padding(.horizontal, 50)
                    .padding(.vertical, 30)
                    .transition(.opacity)
                }
                Spacer()
            }
            .padding(40)
        }
        .onChange(of: generation) { _, _ in
            visible = true
            if settings.autoDismissExif {
                let secs = Double(settings.exifVisibleSeconds)
                Task {
                    try? await Task.sleep(nanoseconds: UInt64(secs * 1_000_000_000))
                    withAnimation(.easeOut(duration: 0.5)) { visible = false }
                }
            }
        }
        .onAppear {
            if settings.autoDismissExif {
                let secs = Double(settings.exifVisibleSeconds)
                Task {
                    try? await Task.sleep(nanoseconds: UInt64(secs * 1_000_000_000))
                    withAnimation(.easeOut(duration: 0.5)) { visible = false }
                }
            }
        }
    }
}
