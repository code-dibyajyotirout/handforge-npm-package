import type { SculptingEngine } from "./SculptingEngine";
import type { AnimTimeline } from "./AnimTimeline";
import * as THREE from "three";

/** Handles .hf3d project save/load with full session state roundtrip, compressed URL sharing, and localStorage auto-save for session persistence across reloads. */
export class ProjectManager {
  private static AUTOSAVE_KEY = "handforge_autosave_v2";
  private static autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private static AUTOSAVE_DEBOUNCE_MS = 2000; // 2 seconds debounce
  static EXT = ".hf3d";

  static save(engine: SculptingEngine, timeline?: AnimTimeline | null): void {
    if (!engine.sculptMesh) return;
    const project = {
      magic: "HF3D",
      version: 2,
      timestamp: Date.now(),
      mesh: {
        shape: engine.currentShape,
        material: engine.currentMaterial,
        parts: engine.sculptMesh.children.map((c) => {
          const m = c as THREE.Mesh;
          return {
            name: m.name,
            sculptOffsets: m.userData.sculptOffsets ? Array.from(m.userData.sculptOffsets) : [],
            rotation: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
            position: { x: m.position.x, y: m.position.y, z: m.position.z },
          };
        }),
        rotation: { x: engine.sculptMesh.rotation.x, y: engine.sculptMesh.rotation.y, z: engine.sculptMesh.rotation.z },
        scale: engine.sculptMesh.scale.x,
      },
      brush: { mode: engine.brushMode, radius: engine.brushRadius, strength: engine.brushStrength },
      animation: timeline ? timeline.exportKeyframes() : null,
    };
    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `HandForge_${Date.now()}${ProjectManager.EXT}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  static load(): Promise<any> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = `${ProjectManager.EXT},.json`;
      input.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return reject(new Error("No file"));
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const p = JSON.parse(ev.target!.result as string);
            if (p.magic !== "HF3D") return reject(new Error("Invalid .hf3d"));
            resolve(p);
          } catch (err) { reject(err); }
        };
        reader.readAsText(file);
      });
      input.click();
    });
  }

  static apply(engine: SculptingEngine, project: any): boolean {
    if (!project?.mesh) return false;
    engine.createSculptMesh(project.mesh.shape);

    if (project.mesh.parts && Array.isArray(project.mesh.parts) && project.mesh.parts.length > 0) {
      const partsMap = new Map<string, any>();
      for (const p of project.mesh.parts) {
        partsMap.set(p.name, p);
      }
      engine.sculptMesh!.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData.sculptOffsets) return;
        const saved = partsMap.get(mesh.name);
        if (saved) {
          if (saved.sculptOffsets && saved.sculptOffsets.length === mesh.userData.sculptOffsets.length) {
            mesh.userData.sculptOffsets.set(new Float32Array(saved.sculptOffsets));
          }
          if (saved.rotation) mesh.rotation.set(saved.rotation.x, saved.rotation.y, saved.rotation.z);
          if (saved.position) mesh.position.set(saved.position.x, saved.position.y, saved.position.z);
        }
      });
      engine.syncDeformedGeometry();
    } else if (project.mesh.sculptOffsets && engine.sculptOffsets && project.mesh.sculptOffsets.length === engine.sculptOffsets.length) {
      engine.sculptOffsets.set(new Float32Array(project.mesh.sculptOffsets));
      engine.syncDeformedGeometry();
    }

    if (project.mesh.rotation) engine.sculptMesh!.rotation.set(project.mesh.rotation.x, project.mesh.rotation.y, project.mesh.rotation.z);
    if (project.mesh.scale) engine.sculptMesh!.scale.setScalar(project.mesh.scale);
    if (project.mesh.material) engine.setMaterial(project.mesh.material);
    if (project.brush) {
      engine.brushMode = project.brush.mode || "push";
      engine.brushRadius = project.brush.radius || 0.4;
      engine.brushStrength = project.brush.strength || 0.35;
    }
    return true;
  }

  /** Generate compact compressed URL link containing project mesh state & keyframes */
  static getShareUrl(engine: SculptingEngine, timeline?: AnimTimeline | null): string {
    if (!engine.sculptMesh) return window.location.origin + window.location.pathname;

    const parts = engine.sculptMesh.children.map((c) => {
      const m = c as THREE.Mesh;
      const sparse: number[] = [];
      const off = m.userData.sculptOffsets || [];
      for (let i = 0; i < off.length; i++) {
        if (Math.abs(off[i]) > 0.0001) sparse.push(i, Math.round(off[i] * 1000));
      }
      return {
        n: m.name,
        o: sparse,
        r: { x: Math.round(m.rotation.x * 1000) / 1000, y: Math.round(m.rotation.y * 1000) / 1000, z: Math.round(m.rotation.z * 1000) / 1000 },
        p: { x: Math.round(m.position.x * 1000) / 1000, y: Math.round(m.position.y * 1000) / 1000, z: Math.round(m.position.z * 1000) / 1000 }
      };
    });

    const data = {
      s: engine.currentShape,
      m: engine.currentMaterial,
      p: parts,
      b: { r: engine.brushRadius, s: engine.brushStrength },
      a: timeline ? timeline.exportKeyframes() : null
    };

    try {
      const json = JSON.stringify(data);
      const base64 = btoa(encodeURIComponent(json));
      return `${window.location.origin}${window.location.pathname}#project=${base64}`;
    } catch (e) {
      console.warn("Share link generation failed:", e);
      return window.location.origin + window.location.pathname;
    }
  }

  /** Try to load project state from URL hash if present */
  static loadFromUrlHash(engine: SculptingEngine, timeline?: AnimTimeline | null): boolean {
    try {
      const hash = window.location.hash;
      if (!hash.startsWith("#project=")) return false;
      const base64 = hash.substring(9);
      const json = decodeURIComponent(atob(base64));
      const data = JSON.parse(json);

      if (data.s) {
        engine.createSculptMesh(data.s);
        if (data.m) engine.setMaterial(data.m);
        if (data.b) {
          engine.brushRadius = data.b.r || 0.4;
          engine.brushStrength = data.b.s || 0.35;
        }
        if (data.p && Array.isArray(data.p)) {
          const partsMap = new Map<string, any>();
          for (const p of data.p) {
            partsMap.set(p.n, p);
          }
          engine.sculptMesh!.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || !mesh.userData.sculptOffsets) return;
            const saved = partsMap.get(mesh.name);
            if (saved) {
              if (saved.o && saved.o.length > 0) {
                const off = mesh.userData.sculptOffsets;
                for (let i = 0; i < saved.o.length; i += 2) {
                  const idx = saved.o[i];
                  const val = saved.o[i + 1] / 1000;
                  if (idx < off.length) off[idx] = val;
                }
              }
              if (saved.r) mesh.rotation.set(saved.r.x, saved.r.y, saved.r.z);
              if (saved.p) mesh.position.set(saved.p.x, saved.p.y, saved.p.z);
            }
          });
          engine.syncDeformedGeometry();
        } else if (data.o && data.o.length > 0 && engine.sculptOffsets) {
          const off = engine.sculptOffsets;
          for (let i = 0; i < data.o.length; i += 2) {
            const idx = data.o[i];
            const val = data.o[i + 1] / 1000;
            if (idx < off.length) off[idx] = val;
          }
          engine.syncDeformedGeometry();
        }
        if (data.a && timeline) {
          timeline.importKeyframes(data.a);
        }
        return true;
      }
    } catch (e) {
      console.warn("Failed to load project from URL hash:", e);
    }
    return false;
  }

  /**
   * Auto-save current session to localStorage with debouncing.
   * Called after sculpt strokes, shape changes, material switches, etc.
   */
  static autoSave(engine: SculptingEngine, timeline?: AnimTimeline | null): void {
    if (!engine.sculptMesh) return;

    if (ProjectManager.autoSaveTimer) {
      clearTimeout(ProjectManager.autoSaveTimer);
    }

    ProjectManager.autoSaveTimer = setTimeout(() => {
      try {
        const data = {
          magic: "HF3D_AUTO",
          version: 2,
          timestamp: Date.now(),
          mesh: {
            shape: engine.currentShape,
            material: engine.currentMaterial,
            parts: engine.sculptMesh!.children.map((c) => {
              const m = c as THREE.Mesh;
              return {
                name: m.name,
                sculptOffsets: m.userData.sculptOffsets ? Array.from(m.userData.sculptOffsets) : [],
                rotation: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
                position: { x: m.position.x, y: m.position.y, z: m.position.z },
              };
            }),
            rotation: {
              x: engine.sculptMesh!.rotation.x,
              y: engine.sculptMesh!.rotation.y,
              z: engine.sculptMesh!.rotation.z,
            },
            scale: engine.sculptMesh!.scale.x,
          },
          brush: {
            mode: engine.brushMode,
            radius: engine.brushRadius,
            strength: engine.brushStrength,
          },
          animation: timeline ? timeline.exportKeyframes() : null,
        };
        localStorage.setItem(ProjectManager.AUTOSAVE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn("Auto-save failed:", e);
      }
    }, ProjectManager.AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Try to auto-load a previous session from localStorage.
   * Returns true if a session was restored.
   */
  static autoLoad(engine: SculptingEngine, timeline?: AnimTimeline | null): boolean {
    try {
      const raw = localStorage.getItem(ProjectManager.AUTOSAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data?.mesh?.shape) return false;

      engine.createSculptMesh(data.mesh.shape);

      if (data.mesh.parts && Array.isArray(data.mesh.parts) && data.mesh.parts.length > 0) {
        const partsMap = new Map<string, any>();
        for (const p of data.mesh.parts) {
          partsMap.set(p.name, p);
        }
        engine.sculptMesh!.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !mesh.userData.sculptOffsets) return;
          const saved = partsMap.get(mesh.name);
          if (saved) {
            if (saved.sculptOffsets && saved.sculptOffsets.length === mesh.userData.sculptOffsets.length) {
              mesh.userData.sculptOffsets.set(new Float32Array(saved.sculptOffsets));
            }
            if (saved.rotation) mesh.rotation.set(saved.rotation.x, saved.rotation.y, saved.rotation.z);
            if (saved.position) mesh.position.set(saved.position.x, saved.position.y, saved.position.z);
          }
        });
        engine.syncDeformedGeometry();
      } else if (data.mesh.sculptOffsets && engine.sculptOffsets && data.mesh.sculptOffsets.length === engine.sculptOffsets.length) {
        engine.sculptOffsets.set(new Float32Array(data.mesh.sculptOffsets));
        engine.syncDeformedGeometry();
      }

      if (data.mesh.rotation) {
        engine.sculptMesh!.rotation.set(
          data.mesh.rotation.x,
          data.mesh.rotation.y,
          data.mesh.rotation.z
        );
      }
      if (data.mesh.scale) {
        engine.sculptMesh!.scale.setScalar(data.mesh.scale);
      }

      if (data.mesh.material) engine.setMaterial(data.mesh.material);

      if (data.brush) {
        engine.brushMode = data.brush.mode || "push";
        engine.brushRadius = data.brush.radius || 0.4;
        engine.brushStrength = data.brush.strength || 0.35;
      }

      if (data.animation && timeline) {
        timeline.importKeyframes(data.animation);
      }

      return true;
    } catch (e) {
      console.warn("Auto-load failed:", e);
      return false;
    }
  }

  static clearAutoSave(): void {
    try {
      localStorage.removeItem(ProjectManager.AUTOSAVE_KEY);
    } catch (e) { /* Ignore */ }
  }

  static hasAutoSave(): boolean {
    try {
      return localStorage.getItem(ProjectManager.AUTOSAVE_KEY) !== null;
    } catch {
      return false;
    }
  }
}
