/* eslint-disable @typescript-eslint/no-explicit-any */
import { HandLandmarker, PoseLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

export interface HandData {
  allLandmarks: any[][];
  allWorldLandmarks: any[][];
}

export interface PoseData {
  landmarks: any[];
  worldLandmarks: any[];
}

export interface TrackerData {
  hands: HandData | null;
  pose: PoseData | null;
}

/**
 * SpatialTracker
 * Handles unified webcam tracking for BOTH dual-hand gestures and full-body pose estimation.
 */
export class SpatialTracker {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private drawingUtils: DrawingUtils;
  private onResults: (data: TrackerData) => void;
  
  private handLandmarker: any = null;
  private poseLandmarker: any = null;
  
  private isTracking = false;
  private lastVideoTime = -1;
  
  enablePoseTracking = false;

  // Connection guides for skeletal drawing
  private static readonly POSE_CONNECTIONS = [
    [11, 12], // shoulders
    [11, 13], [13, 15], // left arm
    [12, 14], [14, 16], // right arm
    [11, 23], [12, 24], [23, 24], // torso
    [23, 25], [25, 27], // left leg
    [24, 26], [26, 28]  // right leg
  ];

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    onResults: (data: TrackerData) => void
  ) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.drawingUtils = new DrawingUtils(this.ctx);
    this.onResults = onResults;
  }

  async init(statusCb?: (msg: string) => void): Promise<boolean> {
    try {
      if (statusCb) statusCb("Accessing Camera Stream...");
      await this.setupCamera();

      if (statusCb) statusCb("Loading Spatial AI Vision Models...");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      // Load Hand models
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });

      // Load Pose models
      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
      });

      this.isTracking = true;
      if (statusCb) statusCb("Hand & Pose Tracking Active!");
      return true;
    } catch (err: any) {
      console.warn("SpatialTracker init error:", err?.message);
      if (statusCb) statusCb("Spatial Tracking Offline (Mouse/Touch active)");
      return false;
    }
  }

  private async setupCamera(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia is not supported by your browser");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    });
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) {
        this.canvas.width = this.video.videoWidth || 640;
        this.canvas.height = this.video.videoHeight || 480;
        resolve();
      } else {
        this.video.addEventListener("loadeddata", () => {
          this.canvas.width = this.video.videoWidth || 640;
          this.canvas.height = this.video.videoHeight || 480;
          resolve();
        }, { once: true });
      }
    });
  }

  update(): void {
    if (!this.isTracking || !this.video.currentTime) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const ts = performance.now();
    try {
      this.ctx.save();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      let handResults: HandData | null = null;
      let poseResults: PoseData | null = null;

      // 1. Run Hand Landmarker
      if (this.handLandmarker) {
        const results = this.handLandmarker.detectForVideo(this.video, ts);
        if (results.landmarks?.length > 0) {
          const colors = [
            { bone: "#00f2fe", joint: "#ff007f", fill: "#00ff87" },
            { bone: "#ff007f", joint: "#00f2fe", fill: "#ffd700" },
          ];
          for (let h = 0; h < results.landmarks.length; h++) {
            const c = colors[h % 2];
            this.drawingUtils.drawConnectors(results.landmarks[h], HandLandmarker.HAND_CONNECTIONS, { color: c.bone, lineWidth: 3 });
            this.drawingUtils.drawLandmarks(results.landmarks[h], { color: c.joint, fillColor: c.fill, radius: 4 });
          }
          handResults = {
            allLandmarks: results.landmarks,
            allWorldLandmarks: results.worldLandmarks || []
          };
        }
      }

      // 2. Run Pose Landmarker (if enabled)
      if (this.enablePoseTracking && this.poseLandmarker) {
        const results = this.poseLandmarker.detectForVideo(this.video, ts);
        if (results.landmarks?.length > 0) {
          const landmarks = results.landmarks[0];
          // Draw pose bones (shoulders, arms, torso, legs)
          for (const connection of SpatialTracker.POSE_CONNECTIONS) {
            const p1 = landmarks[connection[0]];
            const p2 = landmarks[connection[1]];
            if (p1 && p2 && p1.visibility > 0.5 && p2.visibility > 0.5) {
              this.ctx.beginPath();
              this.ctx.moveTo(p1.x * this.canvas.width, p1.y * this.canvas.height);
              this.ctx.lineTo(p2.x * this.canvas.width, p2.y * this.canvas.height);
              this.ctx.strokeStyle = "#ffaa00";
              this.ctx.lineWidth = 4;
              this.ctx.stroke();
            }
          }
          // Draw joints
          for (let i = 0; i < landmarks.length; i++) {
            const p = landmarks[i];
            if (p && p.visibility > 0.5) {
              this.ctx.beginPath();
              this.ctx.arc(p.x * this.canvas.width, p.y * this.canvas.height, 5, 0, 2 * Math.PI);
              this.ctx.fillStyle = "#ff5500";
              this.ctx.fill();
            }
          }
          poseResults = {
            landmarks,
            worldLandmarks: results.worldLandmarks?.[0] || []
          };
        }
      }

      this.onResults({ hands: handResults, pose: poseResults });
      this.ctx.restore();
    } catch (e) {
      console.warn("Detection frame error:", e);
    }
  }

  dispose(): void {
    this.isTracking = false;
    if (this.video.srcObject) {
      const stream = this.video.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
    }
  }
}
