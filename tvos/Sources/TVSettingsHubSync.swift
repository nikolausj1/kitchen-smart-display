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
        var slideshow: Slideshow?
        var tv: TV?
    }
    var id: String?
    var name: String?
    var kind: String?
    var config: Config?
}

@MainActor
extension TVSettings {

    func startHubSync() {
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
        if let v = t.framedBackdrop, let b = FramedBackdrop(rawValue: v), b != framedBackdrop { framedBackdrop = b }
        if let v = t.artDisplay, let a = ArtDisplay(rawValue: v), a != artDisplay { artDisplay = a }
    }
}
