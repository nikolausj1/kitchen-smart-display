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

    // Local day-stamp (e.g. "2026-6-15") of the morning we last surfaced Today.
    // Persisted so a cold relaunch later the same morning still respects a manual
    // dismissal - Today is auto-shown at most once per calendar day.
    private var lastAutoTodayDay: String {
        get { UserDefaults.standard.string(forKey: "router.lastAutoTodayDay") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "router.lastAutoTodayDay") }
    }

    func bootIfNeeded(settings: AppSettings, sonosPlaying: Bool) {
        guard !didBoot else { return }
        didBoot = true
        let now = Date()
        view = Self.pick(settings: settings, sonosPlaying: sonosPlaying, now: now)
        // pick() only returns .today inside the school-morning window, so this
        // latches the morning as delivered and keeps the runtime auto-show below
        // from pulling the user back if they navigate away afterwards.
        if view == .today { lastAutoTodayDay = Self.dayStamp(now) }
    }

    // Runtime morning auto-show, driven by the foreground/wake hook and a minute
    // timer in RootView. The boot picker only runs on a true cold launch, but
    // tvOS usually just resumes a suspended app - so without this the Today
    // morning switch never fires when the TV simply wakes (the bug we hit).
    // Fires at most once per calendar day (the latch), only inside the
    // school-morning window, and never interrupts Settings - so once Today has
    // been shown it leaves a later manual choice alone for the rest of the day.
    func autoShowTodayIfDue(settings: AppSettings, now: Date = Date()) {
        guard didBoot, view != .settings else { return }
        guard Self.inSchoolMorning(settings: settings, now: now) else { return }
        let stamp = Self.dayStamp(now)
        guard lastAutoTodayDay != stamp else { return }
        lastAutoTodayDay = stamp        // this morning is now delivered
        if view != .today { view = .today }
    }

    // True on a school weekday (mirrored no-school flag honored) when the local
    // clock sits in [autoShowAt, morningEndsAt).
    static func inSchoolMorning(settings: AppSettings, now: Date) -> Bool {
        let cal = Calendar.current
        let weekday = cal.component(.weekday, from: now) - 1   // 0=Sun
        guard !settings.noSchoolToday,
              settings.school.schoolDays.contains(weekday) else { return false }
        let nowMin = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        let start = settings.school.autoShowAt.hour * 60 + settings.school.autoShowAt.minute
        let end = settings.school.morningEndsAt.hour * 60 + settings.school.morningEndsAt.minute
        return nowMin >= start && nowMin < end
    }

    static func dayStamp(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)"
    }

    static func pick(settings: AppSettings, sonosPlaying: Bool, now: Date) -> TVView {
        // A school morning shows Today and WINS over Sonos (the kitchen lets
        // Sonos override; the TV deliberately does not). Never auto-selects
        // Settings - that's reachable only by the user navigating there.
        if inSchoolMorning(settings: settings, now: now) { return .today }
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
    @StateObject private var dim = DimModel()
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase
    // Minute tick so the morning auto-show fires even when the TV is already
    // awake and resident before the school-morning window opens.
    private let morningTick = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        matted
            .background(Color.black.ignoresSafeArea())
            // Software evening/night dimming above everything the app draws
            // (see Dimmer.swift). Never intercepts the remote.
            .overlay(DimOverlay(model: dim,
                                autoDim: tvSettings.autoDim,
                                manualBrightness: tvSettings.manualBrightness,
                                inSettings: router.view == .settings))
            .focusable(true)
            .focused($focused)
            .onMoveCommand { handleMove($0) }
            .onPlayPauseCommand { handlePlayPause() }
            // The Siri Remote center (select) button. SwiftUI's TapGesture
            // does not receive select presses on this custom focusable root
            // (verified on device), so a UIKit window-level recognizer with
            // allowedPressTypes=[.select] catches it instead. In Settings it
            // toggles the highlighted row, same as play/pause - that's the
            // button thumbs reach for.
            .background(SelectPressCatcher(onSelect: { handleSelect() }))
            // Menu exits Settings back to the prior view. Only attached while in
            // Settings, so elsewhere Menu keeps its default (exit app) behavior.
            .modifier(ExitToSettingsParent(active: router.view == .settings,
                                           action: { router.exitSettings() }))
            .onAppear {
                sonos.start()
                dim.start(location: model.settings.location)
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
            // Resuming a suspended app (the common "TV just woke" path) doesn't
            // re-run boot, so re-check the morning auto-show on every wake.
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { router.autoShowTodayIfDue(settings: model.settings) }
            }
            // And catch the already-awake case where the window opens with no wake.
            .onReceive(morningTick) { _ in
                router.autoShowTodayIfDue(settings: model.settings)
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
            SettingsView(nav: settingsNav, dim: dim)
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
            toggleCurrentSettingsRow()
            return
        }
        sonos.playPause()
    }

    // Center (select) button: toggle in Settings; on Now Playing it cycles
    // the Framed backdrop live (no Settings trip needed). Deliberately inert
    // elsewhere (no accidental Sonos transport from a resting thumb).
    private func handleSelect() {
        switch router.view {
        case .settings:
            toggleCurrentSettingsRow()
        case .music:
            // Only meaningful when the backdrop is visible (Framed mat).
            if tvSettings.musicMatMode == .framed {
                tvSettings.stepFramedBackdrop(1, wrap: true)
            }
        case .photos:
            // PhotosView decides: toggles Art Display (Shadow Box / Fill)
            // when an artwork is up, inert on regular photos.
            photoRemote.send(.select)
        default:
            break
        }
    }

    // Shared by select and play/pause: toggle the highlighted row; no-op on
    // numeric rows.
    private func toggleCurrentSettingsRow() {
        switch settingsNav.current {
        case .albums:
            if let a = settingsNav.cursorAlbum {
                tvSettings.toggleAlbum(a.id, albums: settingsNav.albums)
            }
        case .todayMat:  tvSettings.todayMatEnabled.toggle()
        case .photosMat: tvSettings.photosMatEnabled.toggle()
        case .musicMat:  tvSettings.stepMusicMat(1, wrap: true)
        case .musicBackdrop: tvSettings.stepFramedBackdrop(1, wrap: true)
        case .artDisplay: tvSettings.stepArtDisplay(1, wrap: true)
        case .artFacts:  tvSettings.artFacts.toggle()
        case .autoDim:   tvSettings.autoDim.toggle()
        default: break
        }
    }

    private func adjustSetting(_ dir: Int) {
        switch settingsNav.current {
        case .photoDuration: tvSettings.stepDuration(dir)
        case .albums:
            // The albums row is a pill grid: left/right move the highlight,
            // play/pause toggles the highlighted album.
            settingsNav.moveAlbumCursor(dir)
        case .todayMat:      tvSettings.todayMatEnabled = (dir > 0)   // left=Off, right=On
        case .photosMat:     tvSettings.photosMatEnabled = (dir > 0)  // left=Off, right=On
        case .musicMat:      tvSettings.stepMusicMat(dir)             // Off/Fit/Framed
        case .musicBackdrop: tvSettings.stepFramedBackdrop(dir)       // Still/Drift/Lava/...
        case .artDisplay:    tvSettings.stepArtDisplay(dir)               // SB/Fill/Fill+Music
        case .artFacts:      tvSettings.artFacts = (dir > 0)          // left=Off, right=On
        case .autoDim:       tvSettings.autoDim = (dir > 0)           // left=Off, right=On
        case .brightness:
            // Manual level only matters with Auto Dim off; the row reads
            // "Auto" otherwise and stepping is a no-op.
            if !tvSettings.autoDim { tvSettings.stepBrightness(dir) }
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
// Catches the Siri Remote center (select) button via a UIKit gesture
// recognizer on the window. Press events route through the focus system, and
// a window-level recognizer is an ancestor of whatever is focused, so it
// fires no matter how SwiftUI has arranged focus. (SwiftUI's TapGesture on
// the focusable root never fires for select on device; see RemoteLayer.swift
// for the history of remote-input approaches here.)
private struct SelectPressCatcher: UIViewRepresentable {
    let onSelect: () -> Void

    func makeUIView(context: Context) -> CatcherView {
        let v = CatcherView()
        v.onSelect = onSelect
        return v
    }
    func updateUIView(_ v: CatcherView, context: Context) { v.onSelect = onSelect }

    final class CatcherView: UIView {
        var onSelect: (() -> Void)?
        private var recognizer: UITapGestureRecognizer?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let window, recognizer == nil else { return }
            let tap = UITapGestureRecognizer(target: self, action: #selector(fire))
            tap.allowedPressTypes = [NSNumber(value: UIPress.PressType.select.rawValue)]
            window.addGestureRecognizer(tap)
            recognizer = tap
        }

        @objc private func fire() { onSelect?() }
    }
}

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
    enum Action: Equatable { case next, previous, select }
    @Published private(set) var seq: Int = 0
    private(set) var action: Action = .next
    func send(_ a: Action) { action = a; seq += 1 }
}
