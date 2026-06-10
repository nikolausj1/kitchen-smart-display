import Foundation

// PhotoService - loads the Immich manifest the Pi serves and exposes a photo
// list. Mirrors useImmichPhotos.js: reads /stub-photos/manifest.json, filters
// by selectedAlbumIds, and resolves relative src paths against the Pi base.

struct PhotoFace: Decodable, Equatable {
    var cx: Double
    var cy: Double
    var w: Double
    var h: Double
}

struct PhotoExif: Decodable, Equatable {
    var location: String?
    var date: String?
    var album: String?
}

struct Photo: Decodable, Equatable, Identifiable {
    var src: String
    var width: Int
    var height: Int
    var orientation: String        // "landscape" | "portrait"
    var addedAt: Double?
    var albums: [String]?
    var exif: PhotoExif?
    var faces: [PhotoFace]?

    var id: String { src }
    var isPortrait: Bool { orientation == "portrait" }
    var aspect: Double { height > 0 ? Double(width) / Double(height) : 1 }

    // Absolute URL for loading (manifest stores app-relative paths).
    var url: URL? {
        if src.hasPrefix("http") { return URL(string: src) }
        return URL(string: AppConfig.piBase.absoluteString + src)
    }
}

// A selectable Immich album (from the manifest's albums[] index).
struct PhotoAlbum: Identifiable, Equatable {
    var id: String
    var name: String
    var count: Int
}

private struct Manifest: Decodable {
    var photos: [Photo]?
    var albums: [AlbumEntry]?
    struct AlbumEntry: Decodable { var id: String; var name: String?; var count: Int? }
}

struct PhotoService {
    static var manifestURL: URL {
        AppConfig.piBase.appendingPathComponent("stub-photos/manifest.json")
    }

    func fetch(selectedAlbumIds: [String]?) async -> [Photo] {
        guard let manifest: Manifest = await fetchJSON(Self.manifestURL),
              let photos = manifest.photos else { return [] }
        return filterByAlbums(photos, selectedAlbumIds)
    }

    // The album index, for the TV's album picker. Sorted alphanumerically
    // (2018, 2019, ... then named albums) rather than manifest order.
    func fetchAlbums() async -> [PhotoAlbum] {
        guard let manifest: Manifest = await fetchJSON(Self.manifestURL),
              let albums = manifest.albums else { return [] }
        return albums
            .map { PhotoAlbum(id: $0.id, name: $0.name ?? "Album", count: $0.count ?? 0) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private func filterByAlbums(_ photos: [Photo], _ selected: [String]?) -> [Photo] {
        guard let selected else { return photos }        // nil -> all
        if selected.isEmpty { return [] }                // empty -> none
        let wanted = Set(selected)
        return photos.filter { p in
            guard let a = p.albums, !a.isEmpty else { return false }
            return a.contains(where: { wanted.contains($0) })
        }
    }
}
