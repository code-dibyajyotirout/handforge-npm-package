"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { SculptingEngine } from "../engine/SculptingEngine";
import { SpatialTracker, type TrackerData } from "../vision/SpatialTracker";
import { CoordinateMapper } from "../math/CoordinateMapper";
import { GestureClassifier } from "../math/GestureClassifier";
import { ProjectManager } from "../engine/ProjectManager";
import { AnimTimeline } from "../engine/AnimTimeline";

export default function Studio() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SculptingEngine | null>(null);
  const mapperRef = useRef<CoordinateMapper | null>(null);
  const trackerRef = useRef<SpatialTracker | null>(null);
  const classifiersRef = useRef([new GestureClassifier(), new GestureClassifier()]);
  const timelineRef = useRef(new AnimTimeline());
  
  const [poseActive, setPoseActive] = useState(false);
  const [activeBrush, setActiveBrush] = useState("push");
  const [activeShape, setActiveShape] = useState("sphere");
  const [activeMat, setActiveMat] = useState("clay");
  const [mobileTab, setMobileTab] = useState<"canvas" | "settings" | "vision">("canvas");
  const [spatialActive, setSpatialActive] = useState(true);
  const [dualHandMode, setDualHandMode] = useState(false);
  const dualHandModeRef = useRef(false);
  const stateRef = useRef({
    handDetected: false,
    isMouseDown: false,
    isOrbiting: false,
    wasSculpting: false,
    lastPointer: { x: 0, y: 0 },
    prevHand: [new THREE.Vector3(), new THREE.Vector3()],
    // Gesture edge-trigger flags
    hasTriggeredUndo: false,
    hasTriggeredBrushCycle: false,
    isDraggingGizmo: false,
    activeGizmoAxis: null as string | null,
    lastGizmoAngle: 0,
  });

  const brushesRef = useRef(["push", "pull", "smooth", "inflate", "flatten", "crease"]);

  /* ─── DOM helper ─── */
  const $ = useCallback((id: string) => document.getElementById(id), []);

  /* ─── Init ─── */
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (!canvasRef.current) return;
    initializedRef.current = true;

    const engine = new SculptingEngine(canvasRef.current);
    engineRef.current = engine;
    let active = true;
    let animId: number;
    let pointerCleanup: (() => void) | undefined;
    let keyboardCleanup: (() => void) | undefined;
    let trackingTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      setLoader("Initializing HandForge WebGPU Engine…", 20);
      await engine.init((msg) => setLoader(msg, 40));
      setLoader("Engine Ready", 50);

      mapperRef.current = new CoordinateMapper(engine.camera);
      setVertexCount(engine.vertexCount);
      pointerCleanup = setupPointer(engine);
      keyboardCleanup = setupKeyboard(engine);

      setLoader("Loading Hand & Body AI Vision Models…", 70);
      const video = document.getElementById("webcam-video") as HTMLVideoElement;
      const canvas = document.getElementById("webcam-canvas") as HTMLCanvasElement;
      if (video && canvas) {
        const tracker = new SpatialTracker(video, canvas, onTrackerResult);
        trackerRef.current = tracker;
        const ok = await tracker.init((msg) => setLoader(msg, 90));
        if (ok) {
          $("webcam-placeholder")?.classList.add("hidden");
        } else {
          const ph = $("webcam-placeholder");
          if (ph) { ph.innerHTML = "<span>Camera unavailable — fallback controls active</span>"; }
          updateGestureUI("fallback", 0);
          setSpatialActive(false);
        }
      }

      // Try to load project from URL hash first, then fallback to auto-save
      let sessionRestored = false;
      if (ProjectManager.loadFromUrlHash(engine, timelineRef.current)) {
        sessionRestored = true;
      } else if (ProjectManager.autoLoad(engine, timelineRef.current)) {
        sessionRestored = true;
        showToast("Previous session restored!");
      }
      if (sessionRestored) {
        setVertexCount(engine.vertexCount);
        setActiveBrush(engine.brushMode);
        setActiveShape(engine.currentShape);
        setActiveMat(engine.currentMaterial);
        const kfEl = $("anim-kf-count");
        if (kfEl) kfEl.textContent = `${timelineRef.current.count} KF`;
      }

      setLoader("HandForge Ready!", 100);
      setTimeout(() => $("loader")?.classList.add("fade-out"), 300);

      // Connect animation playback to scrubber slider
      timelineRef.current.onFrameChange = (frame) => {
        const slider = $("anim-scrubber") as HTMLInputElement;
        if (slider) slider.value = String(frame);
        const lbl = $("anim-frame-label");
        if (lbl) lbl.textContent = `Frame ${frame}`;
      };

      timelineRef.current.onPlaybackEnd = () => {
        const playBtn = $("btn-anim-play");
        if (playBtn) playBtn.textContent = "▶ Play";
      };

      const runTracking = () => {
        if (!active) return;
        trackerRef.current?.update();
        // Dynamic tracking frequency: 30 FPS (33ms) when tracking hands, 8 FPS (120ms) when scanning/idle
        const interval = stateRef.current.handDetected ? 33 : 120;
        trackingTimer = setTimeout(runTracking, interval);
      };
      runTracking();

      const animate = () => {
        if (!active) return;
        animId = requestAnimationFrame(animate);
        engine.render(timelineRef.current.isPlaying);
        updateFPS();
      };
      animate();
    })();

    return () => {
      active = false;
      cancelAnimationFrame(animId);
      clearTimeout(trackingTimer!);
      pointerCleanup?.();
      keyboardCleanup?.();
      engine.dispose();
      trackerRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Loader ─── */
  const setLoader = (msg: string, pct: number) => {
    const s = $("loader-status"); if (s) s.textContent = msg;
    const p = $("loader-progress"); if (p) (p as HTMLDivElement).style.width = `${pct}%`;
  };

  /* ─── FPS ─── */
  const fpsData = useRef({ count: 0, last: performance.now() });
  const updateFPS = () => {
    fpsData.current.count++;
    const now = performance.now();
    if (now - fpsData.current.last >= 1000) {
      const fps = Math.round((fpsData.current.count * 1000) / (now - fpsData.current.last));
      const el = $("fps-counter"); if (el) el.textContent = String(fps);
      fpsData.current.count = 0;
      fpsData.current.last = now;
    }
  };

  const setVertexCount = (n: number) => {
    const el = $("vertex-counter");
    if (el) el.textContent = n.toLocaleString();
  };

  /* ─── Pointer Fallback ─── */
  const setupPointer = (engine: SculptingEngine) => {
    const dom = engine.renderer.domElement;
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    const s = stateRef.current;

    const activeTouches = new Map<number, { x: number; y: number }>();
    let prevPinchDist = 0;
    let prevMidpoint = { x: 0, y: 0 };

    const getMidpointAndDist = () => {
      const pts = Array.from(activeTouches.values());
      if (pts.length < 2) return { midpoint: null, dist: 0 };
      const p1 = pts[0], p2 = pts[1];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      return { midpoint, dist };
    };

    const onMove = (e: PointerEvent) => {
      if (s.handDetected) { s.isMouseDown = false; s.isOrbiting = false; s.wasSculpting = false; return; }
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activeTouches.size === 2 && engine.sculptMesh) {
        // Multi-touch Zoom & Rotate
        const { midpoint, dist } = getMidpointAndDist();
        if (midpoint) {
          if (prevPinchDist > 0) {
            const zoomDelta = (dist - prevPinchDist) * 0.015;
            engine.zoom(zoomDelta);
          }
          if (prevMidpoint.x > 0) {
            const dx = midpoint.x - prevMidpoint.x;
            const dy = midpoint.y - prevMidpoint.y;
            engine.sculptMesh.rotation.y += dx * 0.01;
            engine.sculptMesh.rotation.x += dy * 0.01;
            engine.gizmo?.highlightAxis("y");
          }
          prevPinchDist = dist;
          prevMidpoint = midpoint;
        }
        return;
      }

      if (activeTouches.size === 1) {
        const rect = dom.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

        if (s.isDraggingGizmo && s.activeGizmoAxis && engine.selectedPart && engine.gizmo) {
          const centerWorld = engine.gizmo.group.position;
          const centerScreen = centerWorld.clone().project(engine.camera);
          const centerX = rect.left + rect.width * (centerScreen.x + 1) / 2;
          const centerY = rect.top + rect.height * (-centerScreen.y + 1) / 2;
          
          const dx = e.clientX - centerX;
          const dy = e.clientY - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          const currentAngle = Math.atan2(dy, dx);
          
          // Guard: If the pointer is extremely close to the center of the gizmo, ignore rotation deltas to prevent rapid spinning
          if (dist < 20) {
            s.lastGizmoAngle = currentAngle;
            return;
          }

          let delta = currentAngle - s.lastGizmoAngle;
          if (delta > Math.PI) delta -= Math.PI * 2;
          if (delta < -Math.PI) delta += Math.PI * 2;
          s.lastGizmoAngle = currentAngle;

          // Scale down the rotation delta for a premium, controllable sensitivity
          const rotationDelta = delta * 0.4;

          // Apply rotation. If the camera is looking from the back, we might invert if needed.
          if (s.activeGizmoAxis === "x") {
            engine.selectedPart.rotation.x += rotationDelta;
          } else if (s.activeGizmoAxis === "y") {
            engine.selectedPart.rotation.y += rotationDelta;
          } else if (s.activeGizmoAxis === "z") {
            engine.selectedPart.rotation.z += rotationDelta;
          }
          engine.gizmo?.highlightAxis(s.activeGizmoAxis);
          return;
        }

        if (s.isOrbiting && engine.sculptMesh) {
          engine.sculptMesh.rotation.y += (e.clientX - s.lastPointer.x) * 0.01;
          engine.sculptMesh.rotation.x += (e.clientY - s.lastPointer.y) * 0.01;
          s.lastPointer = { x: e.clientX, y: e.clientY };
          engine.gizmo?.highlightAxis("y");
          return;
        }

        let wp = engine.getSurfacePoint(nx, ny, false); // No selection on hover
        const mapper = mapperRef.current;
        if (mapper) wp = mapper.filters[0].filter(wp);

        if (s.isMouseDown) {
          if (!s.wasSculpting) { engine.saveSnapshot(); s.wasSculpting = true; }
          engine.sculptStroke(wp);
        } else {
          // Trigger auto-save when mouse sculpt stroke ends
          if (s.wasSculpting) ProjectManager.autoSave(engine, timelineRef.current);
          s.wasSculpting = false;
        }
        engine.updateToolVisualizer(0, wp, engine.brushRadius, s.isMouseDown ? "sculpt" : "hover", true);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (s.handDetected) return;
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.lastPointer = { x: e.clientX, y: e.clientY };

      if (activeTouches.size >= 2) {
        s.isMouseDown = false;
        s.isOrbiting = true;
        s.isDraggingGizmo = false;
        s.activeGizmoAxis = null;
        engine.gizmo?.resetHighlight();
        const { midpoint, dist } = getMidpointAndDist();
        if (midpoint) {
          prevPinchDist = dist;
          prevMidpoint = midpoint;
        }
      } else {
        const rect = dom.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        let hitGizmo = false;

        if (engine.gizmo && engine.gizmo.visible) {
          const raycaster = new THREE.Raycaster();
          const mouse = new THREE.Vector2(nx, ny);
          raycaster.setFromCamera(mouse, engine.camera);
          
          engine.gizmo.group.updateMatrixWorld(true);
          const gizmoHits = raycaster.intersectObjects(engine.gizmo.group.children, true);
          const mannequinHits = engine.sculptMesh ? raycaster.intersectObject(engine.sculptMesh, true) : [];

          // Compare distances to handle occlusion
          const gizmoDist = gizmoHits.length > 0 ? gizmoHits[0].distance : Infinity;
          const mannequinDist = mannequinHits.length > 0 ? mannequinHits[0].distance : Infinity;

          if (gizmoHits.length > 0 && gizmoDist < mannequinDist) {
            const hitObj = gizmoHits[0].object;
            let activeAxis: string | null = null;
            for (const axis of ["x", "y", "z"]) {
              if (
                engine.gizmo.rings[axis] === hitObj ||
                engine.gizmo.colliders[axis] === hitObj ||
                engine.gizmo.nodes[axis].includes(hitObj as THREE.Mesh) ||
                engine.gizmo.nodeColliders[axis].includes(hitObj as THREE.Mesh)
              ) {
                activeAxis = axis;
                break;
              }
            }
            if (activeAxis) {
              s.isDraggingGizmo = true;
              s.activeGizmoAxis = activeAxis;
              engine.gizmo.highlightAxis(activeAxis);
              s.isMouseDown = false;
              s.isOrbiting = false;

              // Calculate screen center of the gizmo to track circular drag angles
              const centerWorld = engine.gizmo.group.position;
              const centerScreen = centerWorld.clone().project(engine.camera);
              const centerX = rect.left + rect.width * (centerScreen.x + 1) / 2;
              const centerY = rect.top + rect.height * (-centerScreen.y + 1) / 2;
              s.lastGizmoAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
              hitGizmo = true;
            }
          }
        }

        if (!hitGizmo) {
          // Raycast and select part on down click/tap
          engine.getSurfacePoint(nx, ny, true);

          if (e.button === 2 || e.button === 1 || e.shiftKey) {
            s.isOrbiting = true;
          } else {
            s.isMouseDown = true;
          }
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      activeTouches.delete(e.pointerId);
      if (activeTouches.size < 2) {
        prevPinchDist = 0;
        prevMidpoint = { x: 0, y: 0 };
      }
      if (activeTouches.size === 0) {
        // Auto-save when mouse sculpt stroke ends on pointer release
        if (s.wasSculpting && engineRef.current) {
          ProjectManager.autoSave(engineRef.current, timelineRef.current);
        }
        s.isMouseDown = false;
        s.isOrbiting = false;
        s.wasSculpting = false;
        s.isDraggingGizmo = false;
        s.activeGizmoAxis = null;
        engine.gizmo?.resetHighlight();
      }
    };

    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      engine.zoom(e.deltaY > 0 ? -0.3 : 0.3);
    };
    dom.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("wheel", onWheel);
    };
  };

  /* ─── Keyboard Shortcuts ─── */
  const setupKeyboard = (engine: SculptingEngine) => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const br = brushesRef.current;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); ProjectManager.autoSave(engine, timelineRef.current); }
        if (e.key === "y") { e.preventDefault(); engine.redo(); ProjectManager.autoSave(engine, timelineRef.current); }
        return;
      }
      if (e.key >= "1" && e.key <= "6") { const m = br[parseInt(e.key) - 1]; if (m) { engine.brushMode = m as any; setActiveBrush(m); showToast(`Brush: ${m.toUpperCase()}`); } }
      if (e.key === "r" || e.key === "R") { engine.resetSculptMesh(); ProjectManager.clearAutoSave(); showToast("Mesh reset & auto-save cleared"); }
      if (e.key === "t" || e.key === "T") { engine.isOrbitEnabled = !engine.isOrbitEnabled; $("btn-orbit")?.classList.toggle("active", engine.isOrbitEnabled); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  };

  /* ─── Unified Tracker Results ─── */
  const onTrackerResult = useCallback((data: TrackerData) => {
    const engine = engineRef.current;
    const mapper = mapperRef.current;
    if (!engine || !mapper) return;
    const s = stateRef.current;
    const cls = classifiersRef.current;

    // 1. Process Body Pose if active
    if (engine.enablePoseRigging && data.pose?.landmarks) {
      engine.updatePoseSkeleton(data.pose.landmarks);
      engine.deformMeshWithPose(data.pose.landmarks);
    } else {
      engine.updatePoseSkeleton([]);
    }

    // If user is actively using mouse, ignore hand gestures
    if (s.isMouseDown || s.isOrbiting || s.isDraggingGizmo) {
      return;
    }

    // 2. Process Hand Gestures
    if (!data.hands?.allLandmarks?.length) {
      // Auto-save when gesture sculpting ends (hands leave frame)
      if (s.handDetected && s.wasSculpting) {
        ProjectManager.autoSave(engine, timelineRef.current);
      }
      s.handDetected = false; s.wasSculpting = false;
      s.prevHand[0].set(0, 0, 0);
      s.prevHand[1].set(0, 0, 0);
      engine.updateToolVisualizer(0, new THREE.Vector3(), engine.brushRadius, "hover", false);
      engine.updateToolVisualizer(1, new THREE.Vector3(), engine.brushRadius, "hover", false);
      engine.gizmo?.resetHighlight();
      updateGestureUI(data.pose?.landmarks ? "pose" : "hover", 0);
      updatePinchMeter(0.85); // Reset pinch pressure meter to 0%
      return;
    }

    s.handDetected = true;
    const isDual = dualHandModeRef.current;
    const hands = isDual ? data.hands.allLandmarks : data.hands.allLandmarks.slice(0, 1);
    let overall = data.pose?.landmarks ? "pose" : "hover";

    for (let h = 0; h < 2; h++) {
      if (h >= hands.length) {
        s.prevHand[h].set(0, 0, 0);
        engine.updateToolVisualizer(h, new THREE.Vector3(), engine.brushRadius, "hover", false);
        continue;
      }
      const lm = hands[h];
      const ndc = mapper.getNormalizedScreenCoords(lm[8]);
      const g = cls[h].classify(lm, mapper, h);
      const shouldSelect = (g.state === "sculpt" || g.state === "smooth");
      let wp = engine.getSurfacePoint(ndc.x, ndc.y, shouldSelect);
      wp = mapper.filters[h].filter(wp);
      if (h === 0) updatePinchMeter(g.relativePinch);

      // Edge-triggered actions
      if (g.state === "undo") {
        if (!s.hasTriggeredUndo) {
          engine.undo();
          s.hasTriggeredUndo = true;
          showToast("Undo Triggered!");
        }
      } else {
        s.hasTriggeredUndo = false;
      }

      if (g.state === "brush_switch") {
        if (!s.hasTriggeredBrushCycle) {
          const br = brushesRef.current;
          const nextIdx = (br.indexOf(engine.brushMode) + 1) % br.length;
          const nextMode = br[nextIdx];
          engine.brushMode = nextMode as any;
          setActiveBrush(nextMode);
          s.hasTriggeredBrushCycle = true;
          showToast(`Brush Switched to: ${nextMode.toUpperCase()}`);
        }
      } else {
        s.hasTriggeredBrushCycle = false;
      }

      let hs = "hover";
      if (h === 0) {
        if (!isDual && g.state === "orbit") {
          hs = "orbit";
          overall = "orbit";
          if (engine.sculptMesh && s.prevHand[0].lengthSq() > 0) {
            const dx = Math.max(-0.08, Math.min(0.08, wp.x - s.prevHand[0].x));
            const dy = Math.max(-0.08, Math.min(0.08, wp.y - s.prevHand[0].y));
            engine.sculptMesh.rotation.y += dx * 2.5;
            engine.sculptMesh.rotation.x += dy * 2.5;
            engine.gizmo?.highlightAxis(Math.abs(dx) > Math.abs(dy) ? "y" : "x");
          }
        } else if (!isDual && g.state === "scale") {
          hs = "sculpt";
          overall = "resize";
          if (engine.sculptMesh && s.prevHand[0].lengthSq() > 0) {
            const dy = Math.max(-0.04, Math.min(0.04, wp.y - s.prevHand[0].y));
            engine.sculptMesh.scale.setScalar(Math.max(0.5, Math.min(2.5, engine.sculptMesh.scale.x + dy * 1.2)));
          }
        } else if (g.state === "smooth") {
          hs = "smooth";
          overall = "smooth";
          const pm = engine.brushMode;
          engine.brushMode = "smooth";
          engine.sculptStroke(wp);
          engine.brushMode = pm;
        } else if (g.state === "sculpt") {
          hs = "sculpt";
          overall = "sculpt";
          if (!s.wasSculpting) {
            engine.saveSnapshot();
            s.wasSculpting = true;
          }
          engine.sculptStroke(wp);
        } else {
          // Trigger auto-save when gesture sculpt stroke ends
          if (s.wasSculpting) ProjectManager.autoSave(engine, timelineRef.current);
          s.wasSculpting = false;
        }
      } else {
        if (g.state === "orbit") {
          hs = "orbit";
          overall = "orbit";
          if (engine.sculptMesh && s.prevHand[1].lengthSq() > 0) {
            const dx = Math.max(-0.08, Math.min(0.08, wp.x - s.prevHand[1].x));
            const dy = Math.max(-0.08, Math.min(0.08, wp.y - s.prevHand[1].y));
            engine.sculptMesh.rotation.y += dx * 2.5;
            engine.sculptMesh.rotation.x += dy * 2.5;
            engine.gizmo?.highlightAxis(Math.abs(dx) > Math.abs(dy) ? "y" : "x");
          }
        } else if (g.state === "scale") {
          hs = "sculpt";
          overall = "resize";
          if (engine.sculptMesh && s.prevHand[1].lengthSq() > 0) {
            const dy = Math.max(-0.04, Math.min(0.04, wp.y - s.prevHand[1].y));
            engine.sculptMesh.scale.setScalar(Math.max(0.5, Math.min(2.5, engine.sculptMesh.scale.x + dy * 1.2)));
          }
        } else if (g.state === "sculpt") {
          // Both hands can sculpt naturally without unintended resizing
          hs = "sculpt";
          overall = "sculpt";
          if (!s.wasSculpting) {
            engine.saveSnapshot();
            s.wasSculpting = true;
          }
          engine.sculptStroke(wp);
        } else {
          engine.gizmo?.resetHighlight();
        }
      }
      if (Number.isFinite(wp.x) && Number.isFinite(wp.y) && Number.isFinite(wp.z)) {
        s.prevHand[h].copy(wp);
      }
      engine.updateToolVisualizer(h, wp, engine.brushRadius, hs, true);
    }
    updateGestureUI(overall, hands.length);
  }, []);

  /* ─── UI updates ─── */
  const updateGestureUI = (state: string, handCount: number) => {
    const badge = $("hand-status-badge");
    const icon = $("gesture-icon");
    const title = $("gesture-title");
    const desc = $("gesture-desc");
    const card = $("gesture-card");
    if (!badge || !icon || !title || !desc || !card) return;

    if (handCount === 0) {
      if (state === "fallback") {
        badge.textContent = "Offline"; badge.className = "badge badge-warning";
        card.className = "gesture-card state-hover"; icon.textContent = "OFF";
        title.textContent = "FALLBACK ACTIVE"; desc.textContent = "Mouse, keyboard, and touch controls fully active";
      } else if (state === "pose") {
        badge.textContent = "Pose Tracking"; badge.className = "badge badge-info";
        card.className = "gesture-card state-pose"; icon.textContent = "RIG";
        title.textContent = "BODY RIGGING"; desc.textContent = "Live body skeletal coordinates driving mesh shape";
      } else {
        badge.textContent = "Wave Hands"; badge.className = "badge badge-warning";
        card.className = "gesture-card state-hover"; icon.textContent = "SCAN";
        title.textContent = "WAITING"; desc.textContent = "Place hands in frame to sculpt, or use mouse";
      }
      return;
    }

    badge.textContent = handCount === 2 ? "Dual Hands" : "1 Hand"; badge.className = "badge badge-success";
    const map: Record<string, [string, string, string, string]> = {
      resize: ["state-sculpt", "SCALE", "SPATIAL RESIZE", "Pinch Hand 2 to scale"],
      orbit: ["state-sculpt", "ORBIT", "SPATIAL ORBIT", "Fist on Hand 2 — rotating model"],
      sculpt: ["state-sculpt", "SCULPT", "SCULPTING", "Deforming mesh"],
      smooth: ["state-smooth", "SMOOTH", "SMOOTHING", "Laplacian smooth pass"],
      pose: ["state-pose", "RIG", "BODY RIG ACTIVE", "Skeletal movement deforming model"],
      hover: ["state-hover", "HOVER", "HOVER", "Hand 1 sculpts, Hand 2 transforms"],
    };
    const [cls, ic, t, d] = map[state] || map.hover;
    card.className = `gesture-card ${cls}`; icon.textContent = ic; title.textContent = t; desc.textContent = d;
  };

  const updatePinchMeter = (rp: number) => {
    const pct = Math.max(0, Math.min(100, Math.round((1 - rp / 0.85) * 100)));
    const bar = $("pinch-pressure-bar"); if (bar) (bar as HTMLDivElement).style.width = `${pct}%`;
    const val = $("pinch-pressure-val"); if (val) val.textContent = `${pct}%`;
  };

  const showToast = (msg: string) => {
    const el = $("studio-toast");
    if (el) {
      el.textContent = msg;
      el.classList.add("visible");
      setTimeout(() => el.classList.remove("visible"), 2000);
    }
  };

  /* ─── Actions ─── */
  const handleBrush = (mode: string) => {
    if (engineRef.current) engineRef.current.brushMode = mode as any;
    setActiveBrush(mode);
  };
  const handleShape = (shape: string) => {
    const engine = engineRef.current; if (!engine) return;
    const n = engine.createSculptMesh(shape);
    setVertexCount(n);
    setActiveShape(shape);
    ProjectManager.autoSave(engine, timelineRef.current);
  };
  const handleMat = (mat: string) => {
    const engine = engineRef.current; if (!engine) return;
    engine.setMaterial(mat);
    setActiveMat(mat);
    ProjectManager.autoSave(engine, timelineRef.current);
  };

  const togglePoseTracking = () => {
    const nextVal = !poseActive;
    setPoseActive(nextVal);
    if (trackerRef.current) trackerRef.current.enablePoseTracking = nextVal;
    if (engineRef.current) {
      engineRef.current.enablePoseRigging = nextVal;
      engineRef.current.resetNeutralPose();
    }
    showToast(nextVal ? "Body Rigging Activated" : "Body Rigging Deactivated");
  };

  const toggleSpatialMode = async () => {
    const nextVal = !spatialActive;
    setSpatialActive(nextVal);
    if (!nextVal) {
      // Turn off
      trackerRef.current?.dispose();
      trackerRef.current = null;
      stateRef.current.handDetected = false;
      stateRef.current.wasSculpting = false;
      stateRef.current.isMouseDown = false;
      mapperRef.current?.filters[0].reset();
      mapperRef.current?.filters[1].reset();
      engineRef.current?.updateToolVisualizer(0, new THREE.Vector3(), engineRef.current.brushRadius, "hover", false);
      engineRef.current?.updateToolVisualizer(1, new THREE.Vector3(), engineRef.current.brushRadius, "hover", false);
      $("webcam-placeholder")?.classList.remove("hidden");
      const ph = $("webcam-placeholder");
      if (ph) ph.innerHTML = "<span>Camera Offline — Mouse, Keyboard & Touch Active</span>";
      updateGestureUI("fallback", 0);
      showToast("Spatial AI Mode Disabled");
    } else {
      // Turn on
      showToast("Initializing Camera...");
      const video = document.getElementById("webcam-video") as HTMLVideoElement;
      const canvas = document.getElementById("webcam-canvas") as HTMLCanvasElement;
      if (video && canvas) {
        $("webcam-placeholder")?.classList.remove("hidden");
        const ph = $("webcam-placeholder");
        if (ph) ph.innerHTML = "<span>Starting camera stream...</span>";
        const tracker = new SpatialTracker(video, canvas, onTrackerResult);
        trackerRef.current = tracker;
        tracker.enablePoseTracking = poseActive;
        const ok = await tracker.init();
        if (ok) {
          $("webcam-placeholder")?.classList.add("hidden");
          showToast("Spatial AI Mode Active");
        } else {
          if (ph) ph.innerHTML = "<span>Camera unavailable — fallback controls active</span>";
          showToast("Failed to access camera");
        }
      }
    }
  };

  const copyShareLink = () => {
    if (engineRef.current) {
      const url = ProjectManager.getShareUrl(engineRef.current, timelineRef.current);
      navigator.clipboard.writeText(url);
      showToast("Share link copied to clipboard");
    }
  };

  const exportAnimOnly = () => {
    const keyframes = timelineRef.current.exportKeyframes();
    const blob = new Blob([JSON.stringify(keyframes)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `HandForge_Animation_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Animation timeline exported");
  };

  const importAnimOnly = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target!.result as string);
          timelineRef.current.importKeyframes(data);
          const el = $("anim-kf-count");
          if (el) el.textContent = `${timelineRef.current.count} KF`;
          showToast("Animation timeline imported");
        } catch (err) {
          showToast("Failed to parse animation file.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  };

  return (
    <>
      {/* Toast Notification */}
      <div id="studio-toast" className="studio-toast" />

      {/* Loader */}
      <div id="loader" className="loader-overlay">
        <div className="loader-content">
          <div className="cube-spinner">
            <div className="cube-face front" /><div className="cube-face back" />
            <div className="cube-face right" /><div className="cube-face left" />
            <div className="cube-face top" /><div className="cube-face bottom" />
          </div>
          <h2>HANDFORGE</h2>
          <p id="loader-status">Initializing WebGPU Engine…</p>
          <div className="progress-bar-container"><div id="loader-progress" className="progress-bar-fill" /></div>
        </div>
      </div>

      {/* 3D Canvas */}
      <div id="canvas-container" ref={canvasRef} />

      {/* UI */}
      <div id="ui-layer">
        {/* Header */}
        <header className="studio-header glass-panel">
          <div className="brand">
            <div className="brand-text"><h1>HAND<span>FORGE</span></h1><span className="version-tag">Spatial Suite v3.0.0</span></div>
          </div>
          <div className="mobile-tabs">
            <button className={mobileTab === "canvas" ? "active" : ""} onClick={() => setMobileTab("canvas")}>Studio</button>
            <button className={mobileTab === "settings" ? "active" : ""} onClick={() => setMobileTab("settings")}>Settings</button>
            <button className={mobileTab === "vision" ? "active" : ""} onClick={() => setMobileTab("vision")}>Vision</button>
          </div>
          <div className="header-stats">
            <div className="stat-badge"><span className="stat-label">FPS</span><span id="fps-counter" className="stat-value highlight-green">60</span></div>
            <div className="stat-badge"><span className="stat-label">VERTICES</span><span id="vertex-counter" className="stat-value">66,049</span></div>
          </div>
        </header>

        {/* Left Sidebar */}
        <aside className={`left-sidebar glass-panel ${mobileTab === "settings" ? "mobile-show" : ""}`}>
          <div className="panel-section">
            <h3>BRUSH TOOLS</h3>
            <div className="tool-grid">
              {[["push","","Push"],["pull","","Carve"],["smooth","","Smooth"],["inflate","","Inflate"],["flatten","","Flatten"],["crease","","Crease"]].map(([mode, icon, name]) => (
                <button key={mode} className={`tool-btn ${activeBrush === mode ? "active" : ""}`} onClick={() => handleBrush(mode)}>
                  {icon && <span className="tool-icon">{icon}</span>}
                  <span className="tool-name">{name}</span>
                </button>
              ))}
            </div>
          </div>
          
          <div className="panel-section">
            <h3>PARAMETERS</h3>
            <div className="slider-group">
              <div className="slider-label"><span>Brush Radius</span><span id="val-brush-radius">0.40m</span></div>
              <input type="range" min="0.1" max="1.5" step="0.05" defaultValue="0.4" onChange={(e) => {
                const v = parseFloat(e.target.value); if (engineRef.current) engineRef.current.brushRadius = v;
                const el = $("val-brush-radius"); if (el) el.textContent = v.toFixed(2) + "m";
              }} />
            </div>
            <div className="slider-group">
              <div className="slider-label"><span>Strength</span><span id="val-brush-strength">0.35</span></div>
              <input type="range" min="0.05" max="1.0" step="0.05" defaultValue="0.35" onChange={(e) => {
                const v = parseFloat(e.target.value); if (engineRef.current) engineRef.current.brushStrength = v;
                const el = $("val-brush-strength"); if (el) el.textContent = v.toFixed(2);
              }} />
            </div>
          </div>

          <div className="panel-section">
            <h3>CLAY MESH</h3>
            <div className="shape-grid">
              {[["sphere","Sphere"],["plane","Plane"],["torus","Torus"],["cylinder","Cylinder"],["human","Mannequin"]].map(([s, n]) => (
                <button key={s} className={`shape-btn ${activeShape === s ? "active" : ""}`} onClick={() => handleShape(s)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <h3>MATERIALS</h3>
            <div className="mat-grid">
              {[["clay","Digital Clay"],["gold","Gold"],["cyber","Cyber"],["marble","Obsidian"]].map(([m, n]) => (
                <button key={m} className={`mat-btn ${activeMat === m ? "active" : ""}`} onClick={() => handleMat(m)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <h3>ANIMATION</h3>
            <div className="anim-controls">
              <button className="dock-btn small" onClick={() => {
                const e = engineRef.current; const t = timelineRef.current;
                if (e?.sculptMesh) { t.recordKeyframe(e.sculptMesh); const el = $("anim-kf-count"); if (el) el.textContent = `${t.count} KF`; }
              }}>Record</button>
              <button className="dock-btn small" id="btn-anim-play" onClick={() => {
                const e = engineRef.current; const t = timelineRef.current;
                if (t.isPlaying) { t.pause(); ($("btn-anim-play") as HTMLButtonElement).textContent = "Play"; }
                else if (e?.sculptMesh) { t.play(e.sculptMesh); ($("btn-anim-play") as HTMLButtonElement).textContent = "Pause"; }
              }}>Play</button>
              <span id="anim-kf-count" className="badge badge-info" style={{ fontSize: "0.62rem" }}>0 KF</span>
            </div>
            <div className="slider-group" style={{ marginTop: 6 }}>
              <div className="slider-label"><span>Scrubber</span><span id="anim-frame-label">Frame 0</span></div>
              <input type="range" id="anim-scrubber" min="0" max="120" step="1" defaultValue="0" onChange={(e) => {
                const f = parseInt(e.target.value); const t = timelineRef.current;
                t.seekTo(f, engineRef.current?.sculptMesh || undefined);
                const el = $("anim-frame-label"); if (el) el.textContent = `Frame ${f}`;
              }} />
            </div>
            <div className="anim-export-import" style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button className="dock-btn small" style={{ flex: 1, justifyContent: "center" }} onClick={exportAnimOnly}>Export Anim</button>
              <button className="dock-btn small" style={{ flex: 1, justifyContent: "center" }} onClick={importAnimOnly}>Import Anim</button>
            </div>
          </div>
        </aside>

        {/* Right Sidebar */}
        <aside className={`right-sidebar glass-panel ${mobileTab === "vision" ? "mobile-show" : ""}`}>
          <div className="panel-section">
            <div className="section-title-with-badge">
              <h3>SPATIAL VISION</h3>
              <span id="hand-status-badge" className="badge badge-warning">Waiting</span>
            </div>

            {spatialActive && (
              <div className="hand-mode-toggle">
                <button 
                  className={`mode-btn ${!dualHandMode ? "active" : ""}`} 
                  onClick={() => {
                    setDualHandMode(false);
                    dualHandModeRef.current = false;
                    showToast("1 Hand Mode (Ghost-Free)");
                  }}
                >
                  1 Hand (Focus)
                </button>
                <button 
                  className={`mode-btn ${dualHandMode ? "active" : ""}`} 
                  onClick={() => {
                    setDualHandMode(true);
                    dualHandModeRef.current = true;
                    showToast("Dual Hand Mode (Bimanual)");
                  }}
                >
                  Dual Hands
                </button>
              </div>
            )}
            
            <button className={`dock-btn ${spatialActive ? "active" : ""}`} style={{ marginBottom: 8, width: "100%", justifyContent: "center" }} onClick={toggleSpatialMode}>
              {spatialActive ? "Disable Spatial AI Mode" : "Enable Spatial AI Mode"}
            </button>

            <div className="webcam-card">
              <video id="webcam-video" autoPlay playsInline muted />
              <canvas id="webcam-canvas" />
              <div id="webcam-placeholder" className="webcam-placeholder"><span>Initializing Camera…</span></div>
            </div>
            
            {spatialActive && (
              <button className={`dock-btn ${poseActive ? "active" : ""}`} style={{ marginTop: 8, width: "100%", justifyContent: "center" }} onClick={togglePoseTracking}>
                {poseActive ? "Disable Pose Rigging" : "Enable Body Pose Rigging"}
              </button>
            )}
          </div>

          <div className="panel-section">
            <h3>GESTURE MONITOR</h3>
            <div id="gesture-card" className="gesture-card state-hover">
              <div className="gesture-icon" id="gesture-icon">HOVER</div>
              <div><div className="gesture-title" id="gesture-title">HOVER</div><div className="gesture-desc" id="gesture-desc">Hand 1 sculpts, Hand 2 transforms</div></div>
            </div>
            <div className="meter-container">
              <div className="meter-label"><span>Pinch Pressure</span><span id="pinch-pressure-val">0%</span></div>
              <div className="meter-track"><div id="pinch-pressure-bar" className="meter-fill" /></div>
            </div>
          </div>

          <div className="panel-section">
            <h3>SPATIAL GESTURES</h3>
            <ul className="gesture-guide">
              <li><span className="guide-icon">☝</span><div className="guide-text"><strong>Point:</strong> Hover & aim 3D target ring</div></li>
              <li><span className="guide-icon">🤏</span><div className="guide-text"><strong>Pinch:</strong> Deform & sculpt clay surface</div></li>
              <li><span className="guide-icon">✋</span><div className="guide-text"><strong>Open Palm:</strong> Laplacian smooth pass</div></li>
              <li><span className="guide-icon">✊</span><div className="guide-text"><strong>Fist:</strong> Rotate & orbit 3D model</div></li>
              <li><span className="guide-icon">✌</span><div className="guide-text"><strong>Two Fingers:</strong> Scale / resize model</div></li>
              <li><span className="guide-icon">👍</span><div className="guide-text"><strong>Thumbs Up:</strong> Undo last sculpt stroke</div></li>
              <li><span className="guide-icon">🤟</span><div className="guide-text"><strong>3-Fingers:</strong> Cycle active brush tool</div></li>
            </ul>
          </div>
        </aside>

        {/* Bottom Dock */}
        <footer className="bottom-dock glass-panel">
          <button className="dock-btn" onClick={() => { engineRef.current?.undo(); if (engineRef.current) ProjectManager.autoSave(engineRef.current, timelineRef.current); }}>Undo</button>
          <button className="dock-btn" onClick={() => { engineRef.current?.redo(); if (engineRef.current) ProjectManager.autoSave(engineRef.current, timelineRef.current); }}>Redo</button>
          <button className="dock-btn danger" onClick={() => { engineRef.current?.resetSculptMesh(); ProjectManager.clearAutoSave(); showToast("Mesh reset & auto-save cleared"); }}>Reset</button>
          <button className="dock-btn" onClick={() => { engineRef.current?.smoothAllMesh(); if (engineRef.current) ProjectManager.autoSave(engineRef.current, timelineRef.current); }}>Smooth All</button>
          <button className="dock-btn" id="btn-orbit" onClick={() => {
            const e = engineRef.current; if (!e) return; e.isOrbitEnabled = !e.isOrbitEnabled;
            $("btn-orbit")?.classList.toggle("active", e.isOrbitEnabled);
          }}>Turntable</button>
          <button className="dock-btn active" onClick={() => engineRef.current?.gizmo?.toggle()}>Gizmo</button>
          <button className="dock-btn" onClick={copyShareLink}>Share Link</button>
          <div className="dock-separator" />
          <button className="dock-btn" onClick={() => ProjectManager.save(engineRef.current!, timelineRef.current)}>Save .hf3d</button>
          <button className="dock-btn" onClick={async () => {
            try {
              const p = await ProjectManager.load();
              ProjectManager.apply(engineRef.current!, p);
              if (p.animation) timelineRef.current.importKeyframes(p.animation);
              setVertexCount(engineRef.current!.vertexCount);
              showToast("Project loaded successfully!");
            } catch (e) { console.warn("Load:", e); }
          }}>Open</button>
          <div className="dock-separator" />
          <button className="dock-btn primary" onClick={() => engineRef.current?.exportOBJ()}>Export OBJ</button>
        </footer>
      </div>
    </>
  );
}
