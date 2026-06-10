import SwiftUI

// Apple TV settings rows. Single source of truth shared by SettingsView (render)
// and RootView's remote handler (navigation + value changes).
enum SettingsRow: Int, CaseIterable {
    case photoDuration
    case albums
    case todayMat
    case photosMat
    case musicMat
}

// Selection state for the settings list, owned by the shell so its remote
// handler can move the selection. Mirrors the PhotoRemoteSignal pattern.
//
// The albums row is a 2D exception: it renders the manifest albums as a
// wrapped grid of pills, so left/right moves `albumCursor` across the pills
// (instead of changing a value) and play/pause toggles the highlighted album.
// `albums` is fed from AppModel (by SettingsView on appear/refresh) so render
// and remote handling always agree on pill order.
final class SettingsNav: ObservableObject {
    @Published var selectedRow: Int = 0
    @Published var albumCursor: Int = 0
    @Published var albums: [PhotoAlbum] = []

    func move(_ delta: Int) {
        let n = SettingsRow.allCases.count
        selectedRow = min(n - 1, max(0, selectedRow + delta))
    }

    var current: SettingsRow { SettingsRow(rawValue: selectedRow) ?? .photoDuration }

    func moveAlbumCursor(_ delta: Int) {
        guard !albums.isEmpty else { return }
        albumCursor = min(albums.count - 1, max(0, albumCursor + delta))
    }

    var cursorAlbum: PhotoAlbum? {
        guard !albums.isEmpty else { return nil }
        return albums[min(albumCursor, albums.count - 1)]
    }
}

// SettingsView - TV-local settings, driven by the Siri Remote via the shell
// (NOT the native focus engine), to stay consistent with the app's custom
// remote model. The shell moves `nav.selectedRow` (up/down) and changes the
// highlighted value (left/right); this view just renders TVSettings + the
// current selection. Dark aesthetic matching the other views.
struct SettingsView: View {
    @EnvironmentObject var tvSettings: TVSettings
    @EnvironmentObject var model: AppModel
    @ObservedObject var nav: SettingsNav

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width
            let H = geo.size.height
            VStack(alignment: .leading, spacing: H * 0.018) {
                Text("Apple TV Settings")
                    .font(.system(size: W * 0.030, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.bottom, H * 0.008)

                row(.photoDuration, label: "Photo duration", W: W,
                    value: tvSettings.photoDurationLabel)

                albumsBlock(W: W)

                row(.todayMat, label: "Today Mat", W: W,
                    value: tvSettings.todayMatEnabled ? "On" : "Off")

                row(.photosMat, label: "Photos Mat", W: W,
                    value: tvSettings.photosMatEnabled ? "On" : "Off")

                row(.musicMat, label: "Music Mat", W: W,
                    value: tvSettings.musicMatLabel)

                Text(nav.current == .albums
                     ? "Left/right to highlight an album, play/pause to toggle. Press Menu to exit."
                     : "Use left/right to change. Press Menu to exit.")
                    .font(.system(size: W * 0.016, weight: .regular))
                    .foregroundStyle(.white.opacity(0.45))
                    .padding(.top, H * 0.02)

                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, W * 0.06)
            .padding(.vertical, H * 0.05)
            .background(Color.black)
        }
        .ignoresSafeArea()
        // Keep the nav's album list (and therefore pill order) in sync with
        // the manifest index the remote handler navigates over.
        .onAppear { nav.albums = model.photoAlbums }
        .onChange(of: model.photoAlbums) { _, albums in nav.albums = albums }
    }

    // The albums row: header (label + summary) with the album pills wrapped
    // in a grid beneath - compact regardless of how many albums exist.
    @ViewBuilder
    private func albumsBlock(W: CGFloat) -> some View {
        let selected = nav.current == .albums
        VStack(alignment: .leading, spacing: W * 0.012) {
            HStack {
                Text("Photo albums")
                    .font(.system(size: W * 0.026, weight: selected ? .bold : .regular))
                Spacer()
                Text(albumsSummary)
                    .font(.system(size: W * 0.020, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.55))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: W * 0.165), spacing: W * 0.010)],
                      alignment: .leading, spacing: W * 0.010) {
                ForEach(Array(nav.albums.enumerated()), id: \.element.id) { i, a in
                    pill(a, highlighted: selected && i == nav.albumCursor, W: W)
                }
            }
        }
        .foregroundStyle(selected ? .white : .white.opacity(0.6))
        .padding(.vertical, W * 0.014)
        .padding(.horizontal, W * 0.024)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(selected ? Color.white.opacity(0.10) : .clear)
        )
    }

    private func pill(_ a: PhotoAlbum, highlighted: Bool, W: CGFloat) -> some View {
        let on = tvSettings.isAlbumOn(a.id)
        return HStack(spacing: W * 0.006) {
            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                .font(.system(size: W * 0.016, weight: .semibold))
            Text(a.name)
                .font(.system(size: W * 0.018, weight: .semibold))
                .lineLimit(1)
            Text("\(a.count)")
                .font(.system(size: W * 0.015, weight: .regular))
                .opacity(0.6)
        }
        .padding(.vertical, W * 0.008)
        .padding(.horizontal, W * 0.014)
        .foregroundStyle(on ? .white : .white.opacity(0.45))
        .background(
            Capsule().fill(on ? Color.white.opacity(0.16) : Color.white.opacity(0.05))
        )
        .overlay(
            Capsule().strokeBorder(highlighted ? Color.white : .clear, lineWidth: 3)
        )
    }

    private var albumsSummary: String {
        guard tvSettings.selectedAlbumIds != nil else { return "All albums" }
        let on = nav.albums.filter { tvSettings.isAlbumOn($0.id) }.count
        return "\(on) of \(nav.albums.count)"
    }

    @ViewBuilder
    private func row(_ r: SettingsRow, label: String, W: CGFloat, value: String) -> some View {
        let selected = nav.current == r
        HStack {
            Text(label)
                .font(.system(size: W * 0.026, weight: selected ? .bold : .regular))
            Spacer()
            HStack(spacing: W * 0.012) {
                if selected { chevron("chevron.left", W: W) }
                Text(value)
                    .font(.system(size: W * 0.026, weight: .semibold))
                    .monospacedDigit()
                    .frame(minWidth: W * 0.08)
                if selected { chevron("chevron.right", W: W) }
            }
        }
        .foregroundStyle(selected ? .white : .white.opacity(0.6))
        .padding(.vertical, W * 0.014)
        .padding(.horizontal, W * 0.024)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(selected ? Color.white.opacity(0.10) : .clear)
        )
    }

    private func chevron(_ name: String, W: CGFloat) -> some View {
        Image(systemName: name)
            .font(.system(size: W * 0.022, weight: .semibold))
            .foregroundStyle(.white.opacity(0.8))
    }
}
