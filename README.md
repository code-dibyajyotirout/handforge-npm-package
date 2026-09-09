# HandForge

[![NPM Version](https://img.shields.io/npm/v/handforge.svg?style=flat-square)](https://www.npmjs.com/package/handforge)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r170-black?style=flat-square)](https://threejs.org/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Vision-green?style=flat-square)](https://developers.google.com/mediapipe)

Browser-native spatial 3D digital sculpting and keyframe animation studio engine. Powered by Three.js WebGL/WebGPU, MediaPipe skeletal tracking, custom vertex deformation pipelines, and adaptive One Euro Filter signal smoothing.

---

## Architectural Highlights

- **GPU-Accelerated Vertex Displacement**: Real-time per-vertex displacement transforms (Push, Pull, Inflate, Smooth, Flatten, Crease) executed across meshes exceeding 66,000 vertices with zero server compute dependency.
- **Adaptive Signal Processing**: Dynamic One Euro Filter pipeline dynamically tunes cutoff frequencies based on instantaneous fingertip velocity vector magnitudes, eradicating webcam landmark coordinate jitter while guaranteeing sub-frame tactile responsiveness.
- **Dual-Hand Gesture Classifier**: Calibrated skeletal threshold matrix and temporal hysteresis debouncing to classify Pinch-Sculpt, Fist-Orbit, Open-Palm-Smooth, and Victory-Scale interaction archetypes.
- **Blender-Style Transform Gizmo**: Orthogonal 3-axis torus rotation system with 12 grab nodes and spatial collider raycasting for precision multi-axis orientation.
- **Keyframe Animation Engine**: 30 FPS client-side animation recording, scrubber seeking, and linear transform interpolation between sorted snapshot frames.
- **Roundtrip Serialization**: Custom `.hf3d` specification with magic header verification (`HF3D`), format versioning, vertex offset buffers, and session recovery.

---

## Installation

```bash
npm install handforge three @mediapipe/tasks-vision
```

If utilizing the React component wrapper, ensure `react` and `react-dom` are installed:

```bash
npm install handforge react react-dom
```

---

## Subpath Exports & Modular Architecture

HandForge is engineered with tree-shakable modular entrypoints:

```
handforge
├── /engine      (SculptingEngine, TransformGizmo, AnimTimeline, ProjectManager)
├── /math        (OneEuroFilter, OneEuroFilter3D, CoordinateMapper, GestureClassifier)
├── /vision      (SpatialTracker, landmarks, hand/pose pipeline)
├── /components  (React Studio viewport and user interface)
└── /style.css   (Core studio stylesheets and theme definitions)
```

### 1. Core Sculpting Engine Usage

```typescript
import { SculptingEngine } from "handforge/engine";

const container = document.getElementById("viewport") as HTMLDivElement;
const engine = new SculptingEngine(container);

await engine.init((status) => {
  console.log("Status:", status);
});

// Switch brush archetype
engine.brushMode = "inflate";
engine.brushRadius = 0.5;
engine.brushStrength = 0.4;
```

### 2. Adaptive Signal Filtering (One Euro Filter)

```typescript
import { OneEuroFilter3D } from "handforge/math";
import * as THREE from "three";

// frequency = 60Hz, minCutoff = 1.0Hz, beta = 0.007, dCutoff = 1.0Hz
const filter = new OneEuroFilter3D(60, 1.0, 0.007, 1.0);

function onHandLandmarkUpdate(rawPosition: THREE.Vector3, timestampSeconds: number) {
  const smoothedPosition = filter.filter(rawPosition, timestampSeconds);
  return smoothedPosition;
}
```

### 3. Gesture Classification Pipeline

```typescript
import { GestureClassifier, CoordinateMapper } from "handforge/math";

const classifier = new GestureClassifier();
const mapper = new CoordinateMapper();

function processLandmarks(landmarks) {
  const result = classifier.classify(landmarks, mapper);
  console.log("Detected State:", result.state);
  console.log("Confidence Metric:", result.confidence);
  console.log("Relative Pinch:", result.relativePinch);
}
```

### 4. React Studio Component

```tsx
import React from "react";
import { Studio } from "handforge/components";
import "handforge/style.css";

export default function App() {
  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <Studio />
    </main>
  );
}
```

---

## File Format Specification (.hf3d)

Projects are serialized as portable JSON structures adhering to the following schema:

```json
{
  "magic": "HF3D",
  "version": 2,
  "timestamp": 1741564800000,
  "mesh": {
    "shape": "sphere",
    "material": "clay",
    "parts": [
      {
        "name": "sculpt_core",
        "sculptOffsets": [0.012, -0.004, 0.082],
        "rotation": { "x": 0, "y": 0, "z": 0 },
        "position": { "x": 0, "y": 0, "z": 0 }
      }
    ],
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "scale": 1.0
  },
  "brush": {
    "mode": "push",
    "radius": 0.4,
    "strength": 0.35
  },
  "animation": {
    "keyframes": [],
    "totalFrames": 120,
    "fps": 30
  }
}
```

---

## Development & Testing

```bash
# Install dependencies
npm install

# Execute automated test suite
npm run test

# Compile distribution bundle
npm run build
```

---

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](./LICENSE) for details.
