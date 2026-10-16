import Foundation
import Combine

// Hub sync for TVSettings.
//
// Before Phase 2 these preferences lived only in this device's UserDefaults, so
// the only way to change what the living room showed was to walk over with the
// Siri Remote - and reinstalling the app lost them. They now live in the device
// registry on FrameServer, which means the same values are editable from the
// hub dashboard while the on-screen picker keeps working exactly as before.
//
// The on-device UI and the dashboard are two views over one store, so there is
// no sync protocol here and no merge rules: whoever writes last wins, and a
// poll reconciles. UserDefaults remains the offline cache, so a hub outage
// leaves the TV running on its last known settings rather than resetting.
//
// Registry shape for this device:
//   config.slideshow.selectedAlbumIds   shared concept with the web clients, so
//                                       the dashboard has ONE notion of "which
//                                       albums does this screen show"
//   config.tv.*                         everything genuinely TV-only (mats,
//                                       backdrop, art display, dimming, dwell)

private let kHubDeviceID = "living-room-tv"
private let kHubPollSeconds: UInt64 = 30
private let kHubDebounceNanos: UInt64 = 600_000_000   // 0.6s
// Dashboard commands (config.command) older than this are ignored, so a
// relaunch does not replay last week's "Show Photos". Matches the web app.
private let kHubCommandMaxAge: TimeInterval = 120
private let kHubLastCommandKey = "hub.lastCommandTs"

extension Notification.Name {
    /// Posted (on the main actor) when the dashboard asks this TV to show a
    /// view. userInfo["view"] is "photos" | "today" | "music". RootView
    /// listens and switches, once, like a remote press; nothing is pinned.
    static let hubShowView = Notification.Name("hubShowView")
}

private struct HubDevicePayload: Codable {
    struct Config: Codable {
        struct Slideshow: Codable { var selectedAlbumIds: [String]? }
        struct TV: Codable {
            var photoDurationSeconds: Int?
            var photosMatEnabled: Bool?
            var musicMatMode: Int?
            var todayMatEnabled: Bool?
            var autoDim: Bool?
            var manualBrightness: Double?
            var artFacts: Bool?
            var framedBackdrop: Int?
            var artDisplay: Int?
        }
        // One-shot dashboard commands (Reload / Show ...). Read only: never
        // part of what this TV writes back (see currentPayload), or the
        // command would ride out again on the next PATCH.
        struct Command: Codable {
            var action: String?
            var view: String?
            var ts: Double?
        }
        var slideshow: Slideshow?
        var tv: TV?
        var command: Command?
    }
    var id: String?
    var name: String?
    var kind: String?
    var config: Config?
}

@MainActor
extension TVSettings {

    func startHubSync() {
        #if targetEnvironment(simulator)
        // Sim-only: `defaults write <bundle> debug.noHubSync -bool YES` keeps a
        // simulator (which shares the living-room-tv device id) from pulling the
        // real TV's settings over locally forced ones, or pushing its own.
        if UserDefaults.standard.bool(forKey: "debug.noHubSync") { return }
        #endif
        Task { await registerWithHub() }

        // objectWillChange fires just BEFORE a property lands, so the debounce
        // below doubles as the "let the value settle" delay.
        hubChangeSink = objectWillChange.sink { [weak self] _ in
            guard let self, !self.applyingFromHub else { return }
            self.scheduleHubPatch()
        }

        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: kHubPollSeconds * 1_000_000_000)
                guard let self else { return }
                await self.pollHub()
            }
        }
    }

    // MARK: - Outbound

    private var currentPayload: HubDevicePayload.Config {
        .init(
            slideshow: .init(selectedAlbumIds: selectedAlbumIds.map { Array($0).sorted() }),
            tv: .init(
                photoDurationSeconds: photoDurationSeconds,
                photosMatEnabled: photosMatEnabled,
                musicMatMode: musicMatMode.rawValue,
                todayMatEnabled: todayMatEnabled,
                autoDim: autoDim,
                manualBrightness: manualBrightness,
                artFacts: artFacts,
                framedBackdrop: framedBackdrop.rawValue,
                artDisplay: artDisplay.rawValue))
    }

    func scheduleHubPatch() {
        hubPatchTask?.cancel()
        hubPatchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: kHubDebounceNanos)
            guard !Task.isCancelled, let self else { return }
            await self.patchHub()
        }
    }

    private func patchHub() async {
        guard let url = URL(string: "\(AppConfig.photosBase.absoluteString)/api/devices/\(kHubDeviceID)/config"),
              let body = try? JSONEncoder().encode(currentPayload) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        // Best effort: the change is already applied locally and cached in
        // UserDefaults, so a failure costs nothing visible.
        _ = try? await URLSession.shared.data(for: req)
    }

    // MARK: - Inbound

    /// Self-seeding: the hub never overwrites a device that already exists, so
    /// handing it this TV's current values on first contact is what carries the
    /// album selection, brightness, and art-facts choices across the migration.
    /// They live only in this device's UserDefaults and cannot be recovered from
    /// anywhere else, so losing them would mean re-picking by remote.
    func registerWithHub() async {
        guard let url = URL(string: "\(AppConfig.photosBase.absoluteString)/api/devices/register") else { return }
        let payload = HubDevicePayload(
            id: kHubDeviceID, name: "Living Room", kind: "tvos", config: currentPayload)
        guard let body = try? JSONEncoder().encode(payload) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return }
        apply(try? JSONDecoder().decode(HubDevicePayload.self, from: data))
    }

    func pollHub() async {
        guard let url = URL(string: "\(AppConfig.photosBase.absoluteString)/api/devices/\(kHubDeviceID)/config") else { return }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, resp) = try? await URLSession.shared.data(for: req) else { return }
        if let http = resp as? HTTPURLResponse, http.statusCode == 404 {
            await registerWithHub()   // removed from the dashboard; re-seed
            return
        }
        apply(try? JSONDecoder().decode(HubDevicePayload.self, from: data))
    }

    private func apply(_ payload: HubDevicePayload?) {
        guard let c = payload?.config else { return }
        handleCommand(c.command)
        applyingFromHub = true
        defer { applyingFromHub = false }

        if let ids = c.slideshow?.selectedAlbumIds {
            let incoming = Set(ids)
            if selectedAlbumIds != incoming { selectedAlbumIds = incoming }
        }
        guard let t = c.tv else { return }
        if let v = t.photoDurationSeconds, v != photoDurationSeconds { photoDurationSeconds = v }
        if let v = t.photosMatEnabled, v != photosMatEnabled { photosMatEnabled = v }
        if let v = t.musicMatMode, let m = MusicMatMode(rawValue: v), m != musicMatMode { musicMatMode = m }
        if let v = t.todayMatEnabled, v != todayMatEnabled { todayMatEnabled = v }
        if let v = t.autoDim, v != autoDim { autoDim = v }
        if let v = t.manualBrightness, v != manualBrightness { manualBrightness = v }
        if let v = t.artFacts, v != artFacts { artFacts = v }
        // Removed styles in a stale registry decode as Smoke (FramedBackdrop.init(stored:)).
        if let v = t.framedBackdrop {
            let b = FramedBackdrop(stored: v)
            if b != framedBackdrop { framedBackdrop = b }
        }
        if let v = t.artDisplay, let a = ArtDisplay(rawValue: v), a != artDisplay { artDisplay = a }
    }

    /// Dashboard commands, identified by their timestamp (ms since the epoch,
    /// as the dashboard writes them). The last one handled is persisted so a
    /// relaunch inside the freshness window does not run it twice. Only the
    /// view nudge is meaningful on the TV: sleep/wake belong to the kitchen's
    /// panel, and reload has no equivalent for a native app.
    private func handleCommand(_ cmd: HubDevicePayload.Config.Command?) {
        guard let cmd, let ts = cmd.ts, ts > 0 else { return }
        let defaults = UserDefaults.standard
        if defaults.double(forKey: kHubLastCommandKey) == ts { return }
        let age = Date().timeIntervalSince1970 - ts / 1000
        if age > kHubCommandMaxAge { return }   // stale; ignore
        defaults.set(ts, forKey: kHubLastCommandKey)
        guard cmd.action == "view", let view = cmd.view,
              ["photos", "today", "music"].contains(view) else { return }
        NotificationCenter.default.post(name: .hubShowView, object: nil, userInfo: ["view": view])
    }
}
