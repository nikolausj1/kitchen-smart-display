import Foundation
import CoreGraphics
import os

// MixtapeManifest - the shared geometry file for the Mixtape Now Playing style
// (docs/designs/mixtape.md, "The variant manifest"). It ships inside the bundle
// as a folder reference at Mixtape/mixtape-manifest.json, next to the deck
// plates (Mixtape/deck/) and one folder per tape (Mixtape/tapes/<id>/).
//
// Units: every position is normalised 0..1 of the 3840x2160 frame, origin top
// left, y down. Radii, maxWidth and x are fractions of the frame WIDTH;
// baselineY and xHeight are fractions of the frame HEIGHT.
//
// The parser is deliberately loose (JSONSerialization, not Codable): the asset
// pipeline is still growing keys, so a missing or renamed optional key falls
// back to a default instead of failing the whole file. Rects accept
// {x,y,w,h} or [x,y,w,h]; points accept {x,y} or [x,y]; deck keys accept
// snake_case or camelCase.

struct NRect: Equatable {
    var x: Double, y: Double, w: Double, h: Double
    var midX: Double { x + w / 2 }
    var midY: Double { y + h / 2 }
    var maxX: Double { x + w }
    var maxY: Double { y + h }
}

struct NPoint: Equatable {
    var x: Double, y: Double
}

struct MixtapeTextLine: Equatable {
    var field: String          // "artist" | "album" | "song"
    var x: Double              // left edge, fraction of width
    var baselineY: Double      // fraction of height
    var maxWidth: Double       // fraction of width
    var xHeight: Double        // fraction of height
    // Optional printed-caption placement (printed-field label styles). When
    // absent the caption sits just above the handwritten line.
    var captionX: Double?
    var captionBaselineY: Double?
}

struct MixtapeTape: Equatable, Identifiable {
    var id: String
    var brand: String
    var sku: String
    var labelStyle: String
    var shell: String
    var wear: String
    var tapeFile: String       // relative to the Mixtape folder
    var hubFile: String?
    var packFile: String?
    var spriteRect: NRect
    var hubL: NPoint
    var hubR: NPoint
    var hubRadius: Double
    var packMinRadius: Double
    var packMaxRadius: Double
    var windowRect: NRect?
    var labelRect: NRect?
    var artSlotRect: NRect?
    var textLines: [MixtapeTextLine]
    var printedFields: Bool
    var inkColorHex: String
    var font: String
    /// The shell around each hub (polish_assets.py rims), drawn over the
    /// packs and hubs; nil on a manifest without them.
    var rims: MixtapeRims? = nil
}

/// tapes[i].rims: the shell around each hub opening, cut from the tape's own
/// tape.png. With them the packs are seen only through the clear inner
/// window, so the tape's pack radii come from rims.packMinRadius /
/// packMaxRadius (real cassette proportions) instead of the window fill.
struct MixtapeRims: Equatable {
    var leftRect: NRect
    var leftFile: String
    var rightRect: NRect
    var rightFile: String
    var clearShell: Bool
}

/// deck.counter: the 3-digit mechanical tape counter baked into
/// deck_empty_v3_counter.png. counter_digits.png is `stripCells` cells
/// (0..9 then 0) stacked vertically; each drum shows value v by offsetting
/// the strip up by v cells inside its digitCell. counter_glass.png goes over.
struct MixtapeCounter: Equatable {
    var digitCells: [NRect]
    var stripFile: String
    var stripCells: Int
    var glassFile: String
    var glassRect: NRect
}

/// deck.door_edges.top: the door's top edge strip at full thickness
/// (sin(tilt) = 1), sitting on the door rect's top edge and growing up.
struct MixtapeDoorEdge: Equatable {
    var rect: NRect
    var file: String
}

struct MixtapeDeck: Equatable {
    var well: NRect
    var cassetteSeat: NRect
    var door: NRect
    var doorHingeY: Double
    var doorOpaqueParts: [NRect]
    var keyCaps: [String: NRect]      // rew, play, ff, stop, pause
    var vuFaces: [String: NRect]      // left, right
    var vuPivots: [String: NPoint]
    var vuArcRadiusH: Double          // fraction of height
    var vuDomes: [String: NPoint]
    /// Lamp sprites (glow_play.png / glow_pause.png) drawn source-over at
    /// these rects over deck_empty_v2, whose PLAY is unlit.
    var glows: [String: NRect]
    var knob: MixtapeKnob
    var doorEdgeTop: MixtapeDoorEdge? = nil
    var counter: MixtapeCounter? = nil
    /// The plate file (relative to the Mixtape folder), newest first.
    var plateFile: String? = nil

    // Values from art-src/mixtape/plates/plate-manifest.json (2026-09-23), used
    // for any key the manifest omits.
    static let fallback = MixtapeDeck(
        well: NRect(x: 0.25718, y: 0.11696, w: 0.48445, h: 0.58161),
        cassetteSeat: NRect(x: 0.29785, y: 0.15949, w: 0.40191, h: 0.45401),
        door: NRect(x: 0.26675, y: 0.12759, w: 0.46411, h: 0.5614),
        doorHingeY: 0.689,
        doorOpaqueParts: [],
        keyCaps: [
            "rew":   NRect(x: 0.19557, y: 0.81127, w: 0.08732, h: 0.10101),
            "play":  NRect(x: 0.30622, y: 0.81127, w: 0.10407, h: 0.09995),
            "ff":    NRect(x: 0.44737, y: 0.81127, w: 0.10108, h: 0.10101),
            "stop":  NRect(x: 0.58194, y: 0.81127, w: 0.09569, h: 0.10101),
            "pause": NRect(x: 0.71172, y: 0.81127, w: 0.09151, h: 0.09995),
        ],
        vuFaces: [
            "left":  NRect(x: 0.04366, y: 0.20202, w: 0.19557, h: 0.19351),
            "right": NRect(x: 0.76077, y: 0.20202, w: 0.19498, h: 0.19351),
        ],
        vuPivots: ["left": NPoint(x: 0.14713, y: 0.53057),
                   "right": NPoint(x: 0.85706, y: 0.52951)],
        vuArcRadiusH: 0.24668,
        vuDomes: ["left": NPoint(x: 0.14474, y: 0.39341),
                  "right": NPoint(x: 0.85526, y: 0.39341)],
        glows: ["play":  NRect(x: 0.2987, y: 0.79769, w: 0.12057, h: 0.02963),
                "pause": NRect(x: 0.70286, y: 0.79769, w: 0.10833, h: 0.02963)],
        knob: MixtapeKnob(center: NPoint(x: 0.82773, y: 0.59097), spriteSize: 0.12407,
                          dotAngleDeg: 43.2, minAngleDeg: -147.6, maxAngleDeg: 147.8))
}

/// The OUTPUT knob (scripts/mixtape/README.md, edit_deck_plate). The plate
/// carries the face without its dot; only knob_dot.png turns, so the
/// cone-brushed highlights stay put as on a real knob.
struct MixtapeKnob: Equatable {
    var center: NPoint
    var spriteSize: Double            // fraction of plate HEIGHT
    var dotAngleDeg: Double           // the dot as painted, clockwise from up
    var minAngleDeg: Double           // MIN tick
    var maxAngleDeg: Double           // MAX tick

    /// Clockwise rotation of knob_dot.png for a Sonos volume (0...100); nil
    /// (not loaded) leaves the dot where it was painted.
    func rotation(volume: Int?) -> Double {
        guard let volume else { return 0 }
        let v = min(1, max(0, Double(volume) / 100))
        return (minAngleDeg + v * (maxAngleDeg - minAngleDeg)) - dotAngleDeg
    }
}

struct MixtapeManifest {
    var frameW: Double
    var frameH: Double
    var deck: MixtapeDeck
    var tapes: [MixtapeTape]
    var hashCheckOK: Bool

    static let log = Logger(subsystem: "com.nikolaus.kitchendisplay.tv", category: "Mixtape")

    /// The bundled Mixtape folder (a folder reference, so files keep their paths).
    static var folderURL: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("Mixtape", isDirectory: true)
    }

    static func fileURL(_ relative: String) -> URL? {
        folderURL?.appendingPathComponent(relative)
    }

    /// Loads Mixtape/mixtape-manifest.json from the bundle. Nil only when the
    /// file is missing or not JSON; individual bad tapes are skipped.
    static func load() -> MixtapeManifest? {
        guard let url = Bundle.main.url(forResource: "mixtape-manifest", withExtension: "json",
                                        subdirectory: "Mixtape")
                ?? fileURL("mixtape-manifest.json"),
              let data = try? Data(contentsOf: url),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            log.error("mixtape-manifest.json missing or unreadable")
            return nil
        }
        return parse(root)
    }

    static func parse(_ root: [String: Any]) -> MixtapeManifest {
        let frame = root["frame"] as? [String: Any]
        let fw = num(frame?["w"]) ?? 3840
        let fh = num(frame?["h"]) ?? 2160
        let deck = parseDeck(root["deck"] as? [String: Any] ?? [:])
        // With rims the pack radii are the manifest's real proportions; the
        // window fill only applies to tapes without them.
        let tapes = (root["tapes"] as? [[String: Any]] ?? []).compactMap(parseTape)
            .map { $0.rims == nil ? windowFilledPack($0, aspect: fh / fw) : $0 }

        // Shared FNV-1a test vector: both renderers must pick the same tape.
        var ok = true
        if let hc = root["hashCheck"] as? [String: Any],
           let input = hc["input"] as? String, let expected = num(hc["expected"]) {
            let got = fnv1a32(input)
            ok = UInt32(expected) == got
            if !ok {
                log.warning("FNV-1a self-check FAILED: fnv1a32(\"\(input)\") = \(got), manifest expects \(UInt32(expected))")
            }
        }
        if tapes.isEmpty { log.warning("mixtape manifest has no usable tapes") }
        return MixtapeManifest(frameW: fw, frameH: fh, deck: deck, tapes: tapes, hashCheckOK: ok)
    }

    // The measured packMaxRadius is the pack the tape PHOTO showed (a few
    // percent over the hub), which would barely move as a progress bar. Per
    // design decision 16 the full pack instead reaches the far corner of its
    // own half of the window (hub centre to the corner at the window's
    // centre line), so the pack edge sweeps across the window over one song.
    // Radii are fractions of frame WIDTH; `aspect` = frameH / frameW converts
    // the window's vertical extent.
    static func windowFilledPack(_ t: MixtapeTape, aspect: Double) -> MixtapeTape {
        guard let w = t.windowRect else { return t }
        func far(_ hub: NPoint, x0: Double, x1: Double) -> Double {
            let dx = max(abs(hub.x - x0), abs(hub.x - x1))
            let dy = max(abs(hub.y - w.y), abs(hub.y - w.maxY)) * aspect
            return (dx * dx + dy * dy).squareRoot()
        }
        let left = far(t.hubL, x0: w.x, x1: w.midX)
        let right = far(t.hubR, x0: w.midX, x1: w.maxX)
        // Both packs share one R; the smaller keeps the two full packs from
        // crossing the centre line.
        var out = t
        out.packMaxRadius = max(t.packMaxRadius, min(left, right))
        return out
    }

    // MARK: - Pieces

    private static func parseDeck(_ d: [String: Any]) -> MixtapeDeck {
        var deck = MixtapeDeck.fallback
        func any(_ keys: String...) -> Any? {
            for k in keys { if let v = d[k] { return v } }
            return nil
        }
        if let r = rect(any("well")) { deck.well = r }
        if let r = rect(any("cassette_seat", "cassetteSeat")) { deck.cassetteSeat = r }
        if let r = rect(any("door", "doorRect", "door_rect")) { deck.door = r }
        if let v = num(any("door_hinge_y", "doorHingeY", "hingeY")) { deck.doorHingeY = v }
        if let arr = any("door_opaque_parts", "doorOpaqueParts") as? [Any] {
            deck.doorOpaqueParts = arr.compactMap(rect)
        }
        if let m = any("key_caps", "keyCaps") as? [String: Any] {
            for (k, v) in m { if let r = rect(v) { deck.keyCaps[k.lowercased()] = r } }
        }
        if let m = any("vu_faces", "vuFaces") as? [String: Any] {
            for (k, v) in m { if let r = rect(v) { deck.vuFaces[k] = r } }
        }
        if let m = any("vu_needle_pivots", "vuNeedlePivots", "vuPivots") as? [String: Any] {
            for (k, v) in m { if let p = point(v) { deck.vuPivots[k] = p } }
        }
        if let v = num(any("vu_arc_radius_h", "vuArcRadiusH")) { deck.vuArcRadiusH = v }
        if let m = any("vu_hub_domes", "vuHubDomes") as? [String: Any] {
            for (k, v) in m { if let p = point(v) { deck.vuDomes[k] = p } }
        }
        if let m = any("glows") as? [String: Any] {
            for (k, v) in m { if let r = rect(v) { deck.glows[k.lowercased()] = r } }
        }
        if let k = any("knob") as? [String: Any] {
            if let p = point(k["center"]) { deck.knob.center = p }
            if let v = num(k["spriteSize"] ?? k["sprite_size"]) { deck.knob.spriteSize = v }
            if let v = num(k["dotAngleDeg"] ?? k["dot_angle_deg"]) { deck.knob.dotAngleDeg = v }
            if let v = num(k["minAngleDeg"] ?? k["min_angle_deg"]) { deck.knob.minAngleDeg = v }
            if let v = num(k["maxAngleDeg"] ?? k["max_angle_deg"]) { deck.knob.maxAngleDeg = v }
        }
        if let e = any("door_edges", "doorEdges") as? [String: Any], let r = rect(e["top"]) {
            let file = (e["files"] as? [String: Any])?["top"] as? String ?? "deck/door_edge_top.png"
            deck.doorEdgeTop = MixtapeDoorEdge(rect: r, file: file)
        }
        if let c = any("counter") as? [String: Any] {
            let cells = (c["digitCells"] as? [Any] ?? []).compactMap(rect)
            if cells.count == 3 {
                deck.counter = MixtapeCounter(
                    digitCells: cells,
                    stripFile: c["digitStripFile"] as? String ?? "deck/counter_digits.png",
                    stripCells: Int(num(c["digitStripCells"]) ?? 11),
                    glassFile: c["glassFile"] as? String ?? "deck/counter_glass.png",
                    glassRect: rect(c["glassRect"]) ?? rect(c["window"]) ?? cells[0])
            }
        }
        // plates.deck_v3_counter is a repo path (tvos/Resources/Mixtape/...);
        // keep the part under the Mixtape folder.
        if let p = any("plates") as? [String: Any] {
            for k in ["deck_v3_counter", "deck_v3", "deck_v2"] {
                if let f = p[k] as? String {
                    deck.plateFile = f.components(separatedBy: "Resources/Mixtape/").last
                    break
                }
            }
        }
        return deck
    }

    private static func parseTape(_ t: [String: Any]) -> MixtapeTape? {
        guard let id = t["id"] as? String,
              let files = t["files"] as? [String: Any],
              let tapeFile = files["tape"] as? String,
              let sprite = rect(t["spriteRect"]),
              let hubL = point(t["hubL"]), let hubR = point(t["hubR"]),
              let hubRadius = num(t["hubRadius"])
        else {
            log.warning("skipping malformed tape entry \(String(describing: t["id"]))")
            return nil
        }
        let packMin = num(t["packMinRadius"]) ?? hubRadius * 1.2
        let packMax = num(t["packMaxRadius"]) ?? packMin * 1.4
        let lines: [MixtapeTextLine] = (t["textLines"] as? [[String: Any]] ?? []).compactMap { l in
            guard let field = l["field"] as? String,
                  let x = num(l["x"]), let by = num(l["baselineY"]) else { return nil }
            return MixtapeTextLine(field: field.lowercased(), x: x, baselineY: by,
                                   maxWidth: num(l["maxWidth"]) ?? 0.25,
                                   xHeight: num(l["xHeight"]) ?? 0.01,
                                   captionX: num(l["captionX"]),
                                   captionBaselineY: num(l["captionBaselineY"]))
        }
        // printedFields may be a Bool or a list of field names.
        let printed: Bool
        if let b = t["printedFields"] as? Bool { printed = b }
        else if let a = t["printedFields"] as? [Any] { printed = !a.isEmpty }
        else { printed = false }

        var rims: MixtapeRims?
        var pMin = packMin, pMax = max(packMax, packMin)
        if let r = t["rims"] as? [String: Any],
           let l = r["left"] as? [String: Any], let rr = r["right"] as? [String: Any],
           let lRect = rect(l["rect"]), let lFile = l["file"] as? String,
           let rRect = rect(rr["rect"]), let rFile = rr["file"] as? String {
            rims = MixtapeRims(leftRect: lRect, leftFile: lFile, rightRect: rRect, rightFile: rFile,
                               clearShell: r["clearShell"] as? Bool ?? false)
            if let a = num(r["packMinRadius"]), let b = num(r["packMaxRadius"]), b > a {
                pMin = a; pMax = b
            }
        }

        return MixtapeTape(
            id: id,
            brand: t["brand"] as? String ?? "",
            sku: t["sku"] as? String ?? "",
            labelStyle: t["labelStyle"] as? String ?? "blank",
            shell: t["shell"] as? String ?? "",
            wear: t["wear"] as? String ?? "",
            tapeFile: tapeFile,
            hubFile: files["hub"] as? String,
            packFile: files["pack"] as? String,
            spriteRect: sprite, hubL: hubL, hubR: hubR, hubRadius: hubRadius,
            packMinRadius: pMin, packMaxRadius: pMax,
            windowRect: rect(t["windowRect"]),
            labelRect: rect(t["labelRect"]),
            artSlotRect: rect(t["artSlotRect"]),
            textLines: lines,
            printedFields: printed,
            inkColorHex: t["inkColor"] as? String ?? "#1d2a6b",
            font: t["font"] as? String ?? HandFont.postScriptName,
            rims: rims)
    }

    // MARK: - Loose JSON helpers

    static func num(_ v: Any?) -> Double? {
        if let n = v as? NSNumber { return n.doubleValue }
        if let s = v as? String { return Double(s) }
        return nil
    }

    static func rect(_ v: Any?) -> NRect? {
        if let d = v as? [String: Any],
           let x = num(d["x"]), let y = num(d["y"]),
           let w = num(d["w"] ?? d["width"]), let h = num(d["h"] ?? d["height"]) {
            return NRect(x: x, y: y, w: w, h: h)
        }
        if let a = v as? [Any], a.count == 4,
           let x = num(a[0]), let y = num(a[1]), let w = num(a[2]), let h = num(a[3]) {
            return NRect(x: x, y: y, w: w, h: h)
        }
        return nil
    }

    static func point(_ v: Any?) -> NPoint? {
        if let d = v as? [String: Any], let x = num(d["x"]), let y = num(d["y"]) {
            return NPoint(x: x, y: y)
        }
        if let a = v as? [Any], a.count >= 2, let x = num(a[0]), let y = num(a[1]) {
            return NPoint(x: x, y: y)
        }
        return nil
    }
}

// MARK: - FNV-1a 32

/// FNV-1a, 32-bit, over the UTF-8 bytes. Must match the JS implementation byte
/// for byte (the manifest's hashCheck is the shared test vector). Never use
/// Swift's hashValue here: it is randomised per process.
func fnv1a32(_ s: String) -> UInt32 {
    var h: UInt32 = 0x811C9DC5
    for b in s.utf8 {
        h ^= UInt32(b)
        h = h &* 0x01000193
    }
    return h
}

/// "title|artist|stationName", lowercased and trimmed: the one string that
/// decides whether a new tape goes in (docs/designs/mixtape.md, "The tape key").
func mixtapeKey(title: String, artist: String, station: String) -> String {
    [title, artist, station]
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .joined(separator: "|")
}
