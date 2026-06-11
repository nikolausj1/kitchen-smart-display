// RemoteLayer - intentionally removed.
//
// The first remote implementation wrapped a UIKit UIView with swipe gesture
// recognizers in a SwiftUI .background. On tvOS that view never reliably
// entered the focus chain, so it received no input. Remote handling now lives
// in RootView via SwiftUI's .onMoveCommand / .onPlayPauseCommand on a single
// focusable root, which is the reliable tvOS pattern. This file is kept as a
// placeholder so the project file's source list stays stable.
