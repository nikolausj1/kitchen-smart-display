import SwiftUI

// View selection for the TV shell.
enum TVView: Int, CaseIterable {
    case today, photos, music, settings
}

// AppRouter - current view + boot-picker decision. Mirrors the web AppShell
// boot logic, but a weekday school morning shows Today and WINS over Sonos
// (the kitchen lets Sonos override). The boot picker never auto-selects
// settings - that's reachable only by the user navigating to it.
@MainActor
final class AppRouter: ObservableObject {
    @Published var view: TVView = .photos
    // Where to return when leaving Settings via the Menu button.
    var previousView: TVView = .photos
    private var didBoot = false

    func bootIfNeeded(settings: AppSettings, sonosPlaying: Bool) {
        guard !didBoot else { return }
        didBoot = true
        view = Self.pick(settings: settings, sonosPlaying: sonosPlaying, now: Date())
    }

    static func pick(settings: AppSettings, sonosPlaying: Bool, now: Date) -> TVView {
        let cal = Calendar.current
        let weekday = cal.component(.weekday, from: now) - 1   // 0=Sun
        let nowMin = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        if settings.school.schoolDays.contains(weekday) {
            let start = settings.school.autoShowAt.hour * 60 + settings.school.autoShowAt.minute
            let end = settings.school.morningEndsAt.hour * 60 + settings.school.morningEndsAt.minute
            if nowMin >= start && nowMin < end { return .today }
        }
        if sonosPlaying { return .music }
        return .photos
    }

    func cycle(_ delta: Int) {
        let all = TVView.allCases
        let old = view
        // Linear, non-wrapping: clamp at both ends (Today top, Settings bottom).
        let idx = min(all.count - 1, max(0, view.rawValue + delta))
        let next = all[idx]
        if next == .settings { previousView = old }   // remember where to return
        view = next
    }

    func exitSettings() {
        view = (previousView == .settings) ? .photos : previousView
    }
}

// RootView - the shell. Hosts the current view and captures Siri Remote input
// via SwiftUI's command modifiers on a single focusable root. Remote handling
// is mode-aware: in Settings the d-pad drives the settings list and Menu exits
// back to the prior view; in the other views it switches views / drives
// context actions / Sonos.
//
//   non-settings:  up/down switch view; left/right context (photo or track
//                  prev/next); play-pause -> Sonos
//   settings:      up/down move selection; left/right change value;
//                  Menu -> exit to previous view
struct RootView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var tvSettings: TVSettings
    @StateObject private var router = AppRouter()
    @StateObject private var sonos = SonosController()
    @StateObject private var photoRemote = PhotoRemoteSignal()
    @StateObject private var settingsNav = SettingsNav()
    @FocusState private var focused: Bool

    var body: some View {
        matted
            .background(Color.black.ignoresSafeArea())
            .focusable(true)
            .focused($focused)
            .onMoveCommand { handleMove($0) }
            .onPlayPauseCommand { handlePlayPause() }
            // Menu exits Settings back to the prior view. Only attached while in
            // Settings, so elsewhere Menu keeps its default (exit app) behavior.
            .modifier(ExitToSettingsParent(active: router.view == .settings,
                                           action: { router.exitSettings() }))
            .onAppear {
                sonos.start()
                focused = true
            }
            .task(id: bootKey) {
                router.bootIfNeeded(settings: model.settings, sonosPlaying: sonos.state.playing)
                #if targetEnvironment(simulator)
                // Sim-only: force a view via `defaults write ... debug.view today|photos|music|settings`
                // so the screenshot loop can verify each view without rebuilding.
                if let dv = UserDefaults.standard.string(forKey: "debug.view") {
                    switch dv {
                    case "today": router.view = .today
                    case "photos": router.view = .photos
                    case "music": router.view = .music
                    case "settings": router.view = .settings
                    default: break
                    }
                }
                #endif
            }
    }

    // Each view owns its own mat decision. Photos composes its z-order (photo ->
    // album art -> mat -> handwritten metadata) and reads `photosMatEnabled`.
    // Now Playing renders Off/Fit/Framed itself per `musicMatMode`. Today and
    // Settings are never matted (their content sits at the edges).
    @ViewBuilder
    private var matted: some View {
        switch router.view {
        case .photos:
            PhotosView(remote: photoRemote, sonos: sonos)
        case .today:
            TodayView(matted: tvSettings.todayMatEnabled)
        case .settings:
            SettingsView(nav: settingsNav)
        case .music:
            NowPlayingView(controller: sonos, mat: tvSettings.musicMatMode)
        }
    }

    private var bootKey: String {
        "\(model.settings.school.schoolDays.count)-\(sonos.state.loaded)"
    }

    // MARK: - Remote handling

    private func handleMove(_ direction: MoveCommandDirection) {
        if router.view == .settings {
            switch direction {
            case .up:
                // Up from the top row leaves Settings and returns to Music;
                // otherwise move the row selection up.
                if settingsNav.selectedRow == 0 { router.cycle(-1) }
                else { settingsNav.move(-1) }
            case .down:  settingsNav.move(1)   // clamps; never leaves Settings
            case .left:  adjustSetting(-1)
            case .right: adjustSetting(1)
            default: break
            }
            return
        }
        switch direction {
        case .up:    router.cycle(-1)
        case .down:  router.cycle(1)
        case .left:  contextLeft()
        case .right: contextRight()
        default: break
        }
    }

    private func handlePlayPause() {
        if router.view == .settings {
            // Play/pause advances the highlighted mat row; no-op on numeric rows.
            switch settingsNav.current {
            case .todayMat:  tvSettings.todayMatEnabled.toggle()
            case .photosMat: tvSettings.photosMatEnabled.toggle()
            case .musicMat:  tvSettings.stepMusicMat(1, wrap: true)
            default: break
            }
            return
        }
        sonos.playPause()
    }

    private func adjustSetting(_ dir: Int) {
        switch settingsNav.current {
        case .photoDuration: tvSettings.stepDuration(dir)
        case .album:         tvSettings.cycleAlbum(albums: model.photoAlbums, dir: dir)
        case .todayMat:      tvSettings.todayMatEnabled = (dir > 0)   // left=Off, right=On
        case .photosMat:     tvSettings.photosMatEnabled = (dir > 0)  // left=Off, right=On
        case .musicMat:      tvSettings.stepMusicMat(dir)             // Off/Fit/Framed
        }
    }

    private func contextLeft() {
        switch router.view {
        case .photos: photoRemote.send(.previous)
        case .music:  sonos.previous()
        default:      break
        }
    }
    private func contextRight() {
        switch router.view {
        case .photos: photoRemote.send(.next)
        case .music:  sonos.next()
        default:      break
        }
    }
}

// Conditionally attaches .onExitCommand. When inactive, the view is returned
// unchanged so the Menu button keeps its system default (exit app).
private struct ExitToSettingsParent: ViewModifier {
    let active: Bool
    let action: () -> Void
    func body(content: Content) -> some View {
        if active { content.onExitCommand(perform: action) }
        else { content }
    }
}

// Lightweight channel so the shell's remote can drive the photo slideshow.
// Each press bumps `seq` so repeated same-direction presses are distinct events
// (PhotosView observes `seq`, not the action enum — observing the enum would
// drop a second identical press because SwiftUI's onChange only fires on change).
final class PhotoRemoteSignal: ObservableObject {
    enum Action: Equatable { case next, previous }
    @Published private(set) var seq: Int = 0
    private(set) var action: Action = .next
    func send(_ a: Action) { action = a; seq += 1 }
}
