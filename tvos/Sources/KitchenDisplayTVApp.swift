import SwiftUI
import UIKit

// Kitchen Display TV - native tvOS app.
//
// tvOS ships no WebKit (no UIWebView / WKWebView), so the dashboard is
// reimplemented natively in SwiftUI rather than wrapping the React web app.
// It reads the kitchen-synced settings from the Pi (/api/state) and talks to
// Sonos through the Pi proxy (/api/sonos), reusing the same backend endpoints
// the kitchen uses. See ../Apple-TV-Display-PRD.md.
//
// Phase 1 build order: Today (done) -> Photos -> Now Playing.

@main
struct KitchenDisplayTVApp: App {
    @StateObject private var model = AppModel()
    @StateObject private var tvSettings = TVSettings()

    init() {
        // Register the bundled handwriting font programmatically (belt-and-
        // suspenders alongside UIAppFonts).
        HandFont.registerIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(tvSettings)
                .task { await model.start() }
                .onAppear {
                    // This is a wall display: never let tvOS sleep / show the
                    // screensaver while the app is foreground.
                    UIApplication.shared.isIdleTimerDisabled = true
                }
        }
    }
}

// RootView now lives in RootView.swift (the shell: boot picker, view switcher,
// Siri Remote navigation).
