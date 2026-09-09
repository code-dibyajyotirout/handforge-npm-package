import * as THREE from "three";

/** 1€ Filter — Adaptive low-pass filter for noise reduction and zero-latency tracking. */
export class OneEuroFilter {
  private freq: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private x: number | null = null;
  private dx = 0;
  private lastTime: number | null = null;

  constructor(freq = 60, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(val: number, timestamp: number = performance.now() / 1000): number {
    if (this.lastTime === null) {
      this.x = val;
      this.dx = 0;
      this.lastTime = timestamp;
      return val;
    }
    const dt = Math.max(timestamp - this.lastTime, 0.0001);
    this.lastTime = timestamp;
    const dval = (val - this.x!) / dt;
    const alphaD = this.alpha(this.dCutoff, dt);
    this.dx = alphaD * dval + (1 - alphaD) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = this.alpha(cutoff, dt);
    this.x = a * val + (1 - a) * this.x!;
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastTime = null;
  }
}

/** 3D variant of the 1€ Filter */
export class OneEuroFilter3D {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;
  private filterZ: OneEuroFilter;

  constructor(freq = 60, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.filterX = new OneEuroFilter(freq, minCutoff, beta, dCutoff);
    this.filterY = new OneEuroFilter(freq, minCutoff, beta, dCutoff);
    this.filterZ = new OneEuroFilter(freq, minCutoff, beta, dCutoff);
  }

  filter(v: THREE.Vector3, ts?: number): THREE.Vector3 {
    return new THREE.Vector3(
      this.filterX.filter(v.x, ts),
      this.filterY.filter(v.y, ts),
      this.filterZ.filter(v.z, ts)
    );
  }

  reset(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.filterZ.reset();
  }
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Dual-hand coordinate mapper with adaptive 1€ filter smoothing. */
export class CoordinateMapper {
  camera: THREE.PerspectiveCamera;
  filters: OneEuroFilter3D[];

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.filters = [
      new OneEuroFilter3D(60, 1.0, 0.007, 1.0),
      new OneEuroFilter3D(60, 1.0, 0.007, 1.0),
    ];
  }

  getNormalizedScreenCoords(lm: Landmark): { x: number; y: number } {
    return { x: (1.0 - lm.x) * 2 - 1, y: -lm.y * 2 + 1 };
  }

  calculateDistance(p1: Landmark, p2: Landmark): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
