import * as THREE from "three";

export interface KeyframePart {
  name: string;
  rotation: { x: number; y: number; z: number };
  scale: number;
  position: { x: number; y: number; z: number };
}

export interface Keyframe {
  frame: number;
  parts: KeyframePart[];
}

/** Keyframe animation system with multi-mesh support for poses and joint movements. */
export class AnimTimeline {
  keyframes: Keyframe[] = [];
  currentFrame = 0;
  totalFrames = 120;
  fps = 30;
  isPlaying = false;
  private playInterval: ReturnType<typeof setInterval> | null = null;
  onFrameChange: ((frame: number) => void) | null = null;
  onPlaybackEnd: (() => void) | null = null;

  recordKeyframe(meshGroup: THREE.Object3D): Keyframe {
    const parts: KeyframePart[] = [];
    meshGroup.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.userData.sculptOffsets) {
        parts.push({
          name: m.name,
          rotation: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
          scale: m.scale.x,
          position: { x: m.position.x, y: m.position.y, z: m.position.z },
        });
      }
    });

    const kf: Keyframe = {
      frame: this.currentFrame,
      parts,
    };
    const idx = this.keyframes.findIndex((k) => k.frame === this.currentFrame);
    if (idx >= 0) this.keyframes[idx] = kf;
    else {
      this.keyframes.push(kf);
      this.keyframes.sort((a, b) => a.frame - b.frame);
    }
    return kf;
  }

  applyFrame(meshGroup: THREE.Object3D, frame: number): void {
    if (this.keyframes.length === 0) return;
    this.currentFrame = frame;
    let before: Keyframe | null = null;
    let after: Keyframe | null = null;
    for (const kf of this.keyframes) {
      if (kf.frame <= frame) before = kf;
      if (kf.frame >= frame && !after) after = kf;
    }
    if (!before && !after) return;
    if (!before) before = after!;
    if (!after) after = before;
    const range = after!.frame - before.frame;
    const t = range === 0 ? 0 : (frame - before.frame) / range;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const beforeMap = new Map<string, KeyframePart>();
    for (const p of before.parts) beforeMap.set(p.name, p);

    const afterMap = new Map<string, KeyframePart>();
    for (const p of after!.parts) afterMap.set(p.name, p);

    meshGroup.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.userData.sculptOffsets) {
        const bp = beforeMap.get(m.name);
        const ap = afterMap.get(m.name);
        if (bp && ap) {
          m.rotation.x = lerp(bp.rotation.x, ap.rotation.x, t);
          m.rotation.y = lerp(bp.rotation.y, ap.rotation.y, t);
          m.rotation.z = lerp(bp.rotation.z, ap.rotation.z, t);
          m.scale.setScalar(lerp(bp.scale, ap.scale, t));
          m.position.set(
            lerp(bp.position.x, ap.position.x, t),
            lerp(bp.position.y, ap.position.y, t),
            lerp(bp.position.z, ap.position.z, t)
          );
        }
      }
    });
  }

  play(meshGroup: THREE.Object3D): void {
    if (this.isPlaying || this.keyframes.length < 2) return;
    this.isPlaying = true;
    this.playInterval = setInterval(() => {
      this.currentFrame++;
      if (this.currentFrame >= this.totalFrames) {
        this.currentFrame = this.totalFrames;
        this.applyFrame(meshGroup, this.currentFrame);
        this.onFrameChange?.(this.currentFrame);
        this.pause();
        this.onPlaybackEnd?.();
        return;
      }
      this.applyFrame(meshGroup, this.currentFrame);
      this.onFrameChange?.(this.currentFrame);
    }, 1000 / this.fps);
  }

  pause(): void {
    this.isPlaying = false;
    if (this.playInterval) { clearInterval(this.playInterval); this.playInterval = null; }
  }

  seekTo(frame: number, meshGroup?: THREE.Object3D): void {
    this.currentFrame = Math.max(0, Math.min(this.totalFrames, frame));
    if (meshGroup && this.keyframes.length > 0) this.applyFrame(meshGroup, this.currentFrame);
  }

  exportKeyframes() {
    return { keyframes: JSON.parse(JSON.stringify(this.keyframes)), totalFrames: this.totalFrames, fps: this.fps };
  }

  importKeyframes(data: { keyframes: Keyframe[]; totalFrames: number; fps: number }): void {
    this.keyframes = data.keyframes || [];
    this.totalFrames = data.totalFrames || 120;
    this.fps = data.fps || 30;
    this.currentFrame = 0;
  }

  get count(): number { return this.keyframes.length; }
}
