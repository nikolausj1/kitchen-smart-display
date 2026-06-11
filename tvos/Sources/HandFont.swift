import SwiftUI
import CoreText

// HandFont - the bundled handwriting font (Caveat) used for the "written on the
// mat" photo/music metadata. Centralized so the PostScript name lives in one
// place and a registration failure is easy to spot.
//
// Caveat is bundled as Caveat-Regular.ttf. It's registered both via UIAppFonts
// (Info.plist, generated from project.yml) AND programmatically at launch
// (registerIfNeeded) as a belt-and-suspenders so a UIAppFonts path/name quirk
// can't silently drop us to the system font.
// PostScript name: "Caveat-Regular".
enum HandFont {
    static let postScriptName = "Caveat-Regular"

    static func font(_ size: CGFloat) -> Font {
        .custom(postScriptName, size: size)
    }

    // Pencil-gray ink color from the Figma (#676767).
    static let ink = Color(red: 0x67/255, green: 0x67/255, blue: 0x67/255)

    // Programmatically register every bundled .ttf so Font.custom resolves even
    // if UIAppFonts doesn't pick it up. Safe to call repeatedly (errors when
    // already registered are ignored). Call once at app launch.
    static func registerIfNeeded() {
        guard let urls = Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) else { return }
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
