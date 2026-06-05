import SwiftUI

// Apple TV settings rows. Single source of truth shared by SettingsView (render)
// and RootView's remote handler (navigation + value changes).
enum SettingsRow: Int, CaseIterable {
    case photoDuration
    case album
    case todayMat
    case photosMat
    case musicMat
}

// Selection state for the settings list, owned by the shell so its remote
// handler can move the selection. Mirrors the PhotoRemoteSignal pattern.
final class SettingsNav: ObservableObject {
    @Published var selectedRow: Int = 0
    func move(_ delta: Int) {
        let n = SettingsRow.allCases.count
        selectedRow = min(n - 1, max(0, selectedRow + delta))
    }
    var current: SettingsRow { SettingsRow(rawValue: selectedRow) ?? .photoDuration }
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
            VStack(alignment: .leading, spacing: H * 0.04) {
                Text("Apple TV Settings")
                    .font(.system(size: W * 0.034, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.bottom, H * 0.02)

                row(.photoDuration, label: "Photo duration", W: W,
                    value: tvSettings.photoDurationLabel)

                row(.album, label: "Photo album", W: W,
                    value: tvSettings.albumLabel(albums: model.photoAlbums))

                row(.todayMat, label: "Today Mat", W: W,
                    value: tvSettings.todayMatEnabled ? "On" : "Off")

                row(.photosMat, label: "Photos Mat", W: W,
                    value: tvSettings.photosMatEnabled ? "On" : "Off")

                row(.musicMat, label: "Music Mat", W: W,
                    value: tvSettings.musicMatLabel)

                Text("Use left/right to change. Press Menu to exit.")
                    .font(.system(size: W * 0.016, weight: .regular))
                    .foregroundStyle(.white.opacity(0.45))
                    .padding(.top, H * 0.03)

                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, W * 0.06)
            .padding(.vertical, H * 0.06)
            .background(Color.black)
        }
        .ignoresSafeArea()
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
