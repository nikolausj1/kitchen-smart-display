// nightSkies.js - the night versions of the three sky icons that draw the sun
// (public/icons/weather clear.svg, partly-cloudy.svg, mostly-cloudy.svg): the
// same box, the same cloud, the moon where the sun was. WeatherIcon.jsx draws
// them inline, so the moon can show tonight's phase (MoonGlyph.jsx
// MoonShape). Pure data, tested from Node (nightSkies.test.mjs, which also
// holds every cloud path below to its day file, character for character).
//
// Each sky: its day file's viewBox (so it letterboxes in its box exactly as
// the day icon does), the moon's centre and radius in those units, and for a
// cloudy sky the cloud to draw over the moon and the cloud's inside edge,
// inside which the moon is hidden (the cloud's line is opaque and covers the
// rest). No background colour is assumed: the day partly-cloudy icon hides
// the cloud behind its sun with a disc of the Board's dark grey, which a
// night icon over a photo or on the light Briefing page cannot do.
//
// The moon: clear night is the moon alone, larger than the sun's disc
// because there are no rays to fill the box; partly cloudy, the moon up and
// left of the sun's centre, behind the cloud; mostly cloudy, the moon exactly
// where the day icon's sun is and as big, so the cloud hides most of it, as
// it hides most of the sun. Centres and radii are round numbers so the path
// strings carry no float noise.

// --- The clouds, from the day files ----------------------------------------------

// partly-cloudy.svg, `Vector` (the cloud), verbatim: its outside edge, then
// its inside edge.
const PC_OUTSIDE =
  'M108.189 41.1933C108.865 41.1547 109.541 41.131 110.217 41.1224C126.115 40.9582 140.764 49.7177 148.14 63.799C149.858 67.0491 150.814 70.4716 152.049 73.9138C152.233 74.4252 157.011 75.3544 157.777 75.5808C168.553 78.7593 175.7 88.8338 175.626 100.005C175.6 106.786 172.876 113.278 168.054 118.047C164.857 121.178 160.881 123.397 156.538 124.474C151.447 125.75 141.889 125.354 136.291 125.351L110.094 125.334L74.6131 125.362C72.2767 125.36 69.7708 125.429 67.4624 125.112C52.4401 123.051 41.7272 110.5 42.0053 95.4967C42.1518 87.795 45.389 80.4752 50.9882 75.1839C56.6493 69.9003 64.1473 67.0314 71.8901 67.1866C72.7865 64.1316 75.403 59.7146 77.432 57.2632C85.98 46.9344 95.2549 42.6545 108.189 41.1933Z'
const PC_INSIDE =
  'M75.055 72.5837C69.6836 71.4471 62.7194 73.0828 58.0926 76.0505C52.7318 79.5233 48.9758 84.9887 47.6568 91.2375C44.5668 106.379 55.4625 120.202 70.8218 120.327C74.6384 120.359 78.45 120.371 82.2669 120.37L112.425 120.344L138.836 120.373C142.652 120.374 151.323 120.606 154.48 119.865C158.307 118.95 161.81 117 164.6 114.229C173.775 104.961 171.973 89.1237 160.924 82.2863C156.708 79.6792 152.626 79.267 147.777 79.3382C145.406 68.2589 142.026 59.9443 132.442 52.9847C123.66 46.6081 115.309 45.8367 104.872 46.5438C88.973 50.4042 81.1018 57.3721 75.055 72.5837Z'

// mostly-cloudy.svg draws its cloud and the visible arc of the sun as one
// white path (`Vector`), the orange arc (`Vector_2`) painted over the arc's
// part. The cloud alone is put together from that path's own pieces:
//   - `Vector`'s first subpath from where the sun's arc meets the cloud's
//     dome (89.9852 46.5639), round the dome, the right side, the bottom and
//     the left side, to where the arc leaves the cloud (41.6691 86.1338)
const MC_EDGE =
  'C103.109 41.5936 112.47 40.7197 125.857 46.3708C135.78 50.5598 144.698 60.4965 147.892 70.6292C148.168 71.5135 149.337 75.0066 149.837 75.4621C152.141 76.0986 156.533 77.0631 158.565 78.0646C169.994 83.6974 175.591 96.2902 172.102 108.435C170.19 114.923 165.781 120.389 159.847 123.637C152.87 127.482 145.031 126.735 137.352 126.726L114.644 126.699L83.7679 126.712C78.6496 126.719 72.2525 126.909 67.2507 126.663C64.9696 126.548 62.7085 126.16 60.5173 125.509C43.4373 120.417 35.232 102.597 41.6691 86.1338'
//   - the cloud's left bump and the dome's left flank, which the day file
//     draws as the lower edge of the sun's inside (`Vector`'s second subpath:
//     its last two curves, then its first)
const MC_BUMP = 'C45.4254 79.9137 47.2103 77.8751 48.9087 76.2727C54.4432 71.1319 61.7761 68.369 69.3253 68.5787'
const MC_FLANK = 'C72.5422 59.5569 78.523 54.0626 86.029 48.6494'
//   - the two short joins under the orange arc, from `Vector_2`, run
//     backwards: arc's end to the bump, flank to the arc's start
const MC_JOIN_LEFT = 'C42.1952 84.602 43.101 83.1241 43.8969 81.6952'
const MC_JOIN_TOP = 'C87.5376 47.666 88.3534 47.3064 89.9852 46.5639'
const MC_OUTSIDE = `M89.9852 46.5639${MC_EDGE}${MC_JOIN_LEFT}${MC_BUMP}${MC_FLANK}${MC_JOIN_TOP}Z`
//   - and `Vector`'s third subpath, the cloud's inside edge, verbatim.
const MC_INSIDE =
  'M72.5289 73.9302C66.3949 72.8912 59.6082 74.5152 54.5498 78.1468C49.4548 81.8107 46.0082 87.334 44.9559 93.5212C42.8646 106.446 50.8135 119.096 64.56 121.452C68.8891 122.194 75.5426 121.743 80.1048 121.74L109.802 121.712L136.35 121.74C145.861 121.742 154.585 123.103 161.968 115.736C165.851 111.85 168.006 106.564 167.946 101.072C167.899 87.6733 157.892 80.5396 145.221 80.6864C140.719 57.9156 125.88 45.8275 102.476 47.91C86.4353 51.6358 78.6929 58.7855 72.5289 73.9302Z'

// The pieces, named, so the test can find each one in its day file.
export const CLOUD_PIECES = Object.freeze({
  partlyOutside: PC_OUTSIDE,
  partlyInside: PC_INSIDE,
  mostlyEdge: MC_EDGE,
  mostlyBump: MC_BUMP,
  mostlyFlank: MC_FLANK,
  mostlyJoinLeft: MC_JOIN_LEFT,
  mostlyJoinTop: MC_JOIN_TOP,
  mostlyInside: MC_INSIDE,
})

// The day files' cloud white.
export const CLOUD_COLOR = '#FEFEFE'

// --- The skies --------------------------------------------------------------------

export const NIGHT_SKIES = Object.freeze({
  'clear-night': Object.freeze({
    label: 'Clear night',
    viewBox: '0 0 130.921 131.201',
    moon: Object.freeze({ cx: 65.5, cy: 65.5, r: 42 }),
    cloud: null,
    cloudInside: null,
  }),
  'partly-cloudy-night': Object.freeze({
    label: 'Partly cloudy night',
    viewBox: '0 0 175.627 131.201',
    moon: Object.freeze({ cx: 62, cy: 60, r: 38 }),
    cloud: `${PC_OUTSIDE}${PC_INSIDE}`,
    cloudInside: PC_INSIDE,
  }),
  'mostly-cloudy-night': Object.freeze({
    label: 'Mostly cloudy night',
    viewBox: '0 0 173.131 126.79',
    moon: Object.freeze({ cx: 65.5, cy: 65.5, r: 31.5 }),
    cloud: `${MC_OUTSIDE}${MC_INSIDE}`,
    cloudInside: MC_INSIDE,
  }),
})

// 'clear-night', 'partly-cloudy-night', 'mostly-cloudy-night'.
export const NIGHT_ICON_NAMES = Object.keys(NIGHT_SKIES)

// The clip that hides the moon inside a cloud: a box well past the icon's,
// less the cloud's inside edge (even-odd).
export function cloudClipPath(cloudInside) {
  return `M-50 -50H250V200H-50Z${cloudInside}`
}
