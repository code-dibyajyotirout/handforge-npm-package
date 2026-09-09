# Changelog

All notable changes to the `handforge` package are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.2] - 2026-09-10

### Added
- Single-Hand Focus Mode toggle switch to eliminate phantom ghost hands and accidental zooming in desktop webcam sessions.
- In Single-Hand mode, solo gestures for orbit (fist) and uniform scale (two fingers) map directly to the primary hand.
- Synchronized grayscale monochrome gesture guide icons in studio UI.

## [1.0.1] - 2026-09-09

### Fixed
- Fixed runaway scale enlargement bug when sculpting with one hand.
- Added finite number guards to `OneEuroFilter` to prevent NaN coordinate propagation.
- Resolved React 19 strict-mode double-initialization in studio canvas.

## [1.0.0] - 2026-09-09

### Added
- Core `SculptingEngine` module with real-time WebGL/WebGPU vertex displacement shaders.
- Six brush deformation algorithms: Push, Pull, Inflate, Smooth, Flatten, and Crease.
- Blender-style 3-axis `TransformGizmo` with 12 interactive grab nodes and raycast colliders.
- Adaptive `OneEuroFilter` and `OneEuroFilter3D` signal smoothing routines for webcam coordinate stabilization.
- `GestureClassifier` with joint curl metrics and temporal hysteresis debouncing.
- `AnimTimeline` keyframe animation recorder, playback loop, and linear transform interpolation engine.
- `ProjectManager` handling roundtrip `.hf3d` project serialization with format versioning and magic header checks.
- Tree-shakable modular subpath exports: `/engine`, `/math`, `/vision`, `/components`, and `/style.css`.
- Comprehensive automated Node.js test suite for engine lifecycle, filtering math, and module exports.
