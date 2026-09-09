import { CoordinateMapper, type Landmark } from "./CoordinateMapper";

export interface GestureResult {
  state: "hover" | "sculpt" | "smooth" | "orbit" | "scale" | "undo" | "brush_switch" | "reset";
  confidence: number;
  relativePinch: number;
  fingerGap: number;
  palmScale: number;
}

/**
 * Stateful gesture classification engine with temporal hysteresis
 * and skeletal joint-ratio verification for noise-free input.
 */
export class GestureClassifier {
  private counters = { sculpt: 0, orbit: 0, smooth: 0, scale: 0, undo: 0, brush_switch: 0, reset: 0 };
  confirmedState: GestureResult["state"] = "hover";

  classify(landmarks: Landmark[], mapper: CoordinateMapper, handIdx = 0): GestureResult {
    if (!landmarks || landmarks.length < 21) {
      return { state: "hover", confidence: 0, relativePinch: 1, fingerGap: 0, palmScale: 0.2 };
    }

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    const middleKnuckle = landmarks[9];

    const palmScale = mapper.calculateDistance(wrist, middleKnuckle) || 0.2;
    const dTW = mapper.calculateDistance(thumbTip, wrist) / palmScale;
    const dIW = mapper.calculateDistance(indexTip, wrist) / palmScale;
    const dMW = mapper.calculateDistance(middleTip, wrist) / palmScale;
    const dRW = mapper.calculateDistance(ringTip, wrist) / palmScale;
    const dPW = mapper.calculateDistance(pinkyTip, wrist) / palmScale;

    const rawPinch = mapper.calculateDistance(indexTip, thumbTip);
    const relativePinch = rawPinch / palmScale;
    const fingerGap = mapper.calculateDistance(indexTip, middleTip) / palmScale;

    // 1. Fist (Orbit)
    const isFistRaw = dIW < 1.05 && dMW < 1.05 && dRW < 1.05 && dPW < 1.05;
    
    // 2. Open Palm (Smooth)
    const isOpenPalmRaw = dIW > 1.4 && dMW > 1.4 && dRW > 1.4 && dPW > 1.4 && relativePinch > 0.65;
    
    // 3. Pinch (Sculpt)
    const isPinchRaw = relativePinch < 0.52 && !isFistRaw;
    
    // 4. Two Fingers Up (Scale)
    const isScaleRaw = dIW > 1.35 && dMW > 1.35 && dRW < 1.1 && dPW < 1.1;

    // 5. Thumbs Up (Undo)
    // Thumb is extended, but other fingers are folded. Thumb tip is higher than wrist.
    const isUndoRaw = dTW > 1.25 && dIW < 1.05 && dMW < 1.05 && dRW < 1.05 && dPW < 1.05 && (thumbTip.y < indexTip.y);

    // 6. Three Fingers Up (Brush Switch)
    // Index, Middle, Thumb extended; Ring, Pinky folded.
    const isBrushSwitchRaw = dTW > 1.2 && dIW > 1.3 && dMW > 1.3 && dRW < 1.1 && dPW < 1.1 && relativePinch > 0.5;

    // Temporal hysteresis (debouncing across frames)
    const inc = (k: keyof typeof this.counters, cond: boolean) => {
      this.counters[k] = cond ? Math.min(5, this.counters[k] + 1) : Math.max(0, this.counters[k] - 1);
    };
    
    inc("orbit", isFistRaw);
    inc("smooth", isOpenPalmRaw);
    inc("sculpt", isPinchRaw);
    inc("scale", isScaleRaw);
    inc("undo", isUndoRaw);
    inc("brush_switch", isBrushSwitchRaw);

    let state: GestureResult["state"] = "hover";
    if (this.counters.undo >= 3) state = "undo";
    else if (this.counters.brush_switch >= 3) state = "brush_switch";
    else if (this.counters.orbit >= 2) state = "orbit";
    else if (this.counters.scale >= 2) state = "scale";
    else if (this.counters.smooth >= 2) state = "smooth";
    else if (this.counters.sculpt >= 2) state = "sculpt";

    this.confirmedState = state;
    return { state, confidence: 1, relativePinch, fingerGap, palmScale };
  }
}
