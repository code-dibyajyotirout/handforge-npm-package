import * as THREE from "three";
import { TransformGizmo } from "./TransformGizmo";

export type BrushMode = "push" | "pull" | "smooth" | "inflate" | "flatten" | "crease";

/**
 * SculptingEngine (HandForge)
 * WebGL renderer with custom vertex shader deformation, Blender gizmo, dual cursors,
 * real-time vertex deformation, live 3D body pose rig, undo/redo, and OBJ export.
 */
export class SculptingEngine {
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  sculptMesh: THREE.Group | null = null;
  selectedPart: THREE.Mesh | null = null;
  gizmo: TransformGizmo | null = null;

  cursors: Array<{ mesh: THREE.Mesh; ring: THREE.Mesh; palette: { main: number; active: number; smooth: number } }> = [];

  private raycaster = new THREE.Raycaster();
  private screenVec = new THREE.Vector2();

  brushMode: BrushMode = "push";
  brushRadius = 0.4;
  brushStrength = 0.35;
  currentShape = "sphere";
  currentMaterial = "clay";
  isOrbitEnabled = false; // Off by default — users need to sculpt first

  private undoStack: Array<{ mesh: THREE.Mesh; offsets: Float32Array }> = [];
  private redoStack: Array<{ mesh: THREE.Mesh; offsets: Float32Array }> = [];
  private maxStack = 30; // Increased from 20

  originalPositions: Float32Array | null = null;
  sculptOffsets: Float32Array | null = null;
  poseOffsets: Float32Array | null = null;
  vertexWeights: Float32Array | null = null;
  vertexBoneIndices: Uint8Array | null = null;
  vertexBoneWeights: Float32Array | null = null;
  normals: Float32Array | null = null;
  vertexCount = 0;

  private materialsMap: Record<string, THREE.MeshStandardMaterial> = {};
  private geometriesMap: Record<string, THREE.BufferGeometry> = {};

  // Live Body Pose Rigging
  poseGroup!: THREE.Group;
  private poseJoints: THREE.Mesh[] = [];
  private poseBonesGroup!: THREE.Group;
  private poseBoneMat!: THREE.LineBasicMaterial; // Cached — no per-frame alloc
  enablePoseRigging = false;
  private neutralPose: any = null;

  private resizeHandler = () => this.onResize();

  constructor(private container: HTMLDivElement) {}

  async init(statusCb?: (msg: string) => void): Promise<{ isWebGPU: boolean; vertexCount: number }> {
    statusCb?.("Initializing Renderer...");

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#090a0f");
    this.scene.fog = new THREE.FogExp2("#090a0f", 0.08);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 5.5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    this.setupStudio();
    statusCb?.("Building Mesh Geometries...");
    this.setupGeometries();
    this.setupMaterials();
    this.createSculptMesh("sphere");
    this.createCursors();
    this.initPoseRig();

    this.gizmo = new TransformGizmo(this.scene);
    if (this.selectedPart) this.gizmo.attachTo(this.selectedPart);

    window.addEventListener("resize", this.resizeHandler);
    return { isWebGPU: false, vertexCount: this.vertexCount };
  }

  dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    for (const key in this.geometriesMap) {
      this.geometriesMap[key].dispose();
    }
    for (const key in this.materialsMap) {
      this.materialsMap[key].dispose();
    }
  }

  private setupStudio(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(5, 8, 5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x00f2fe, 1.0); fill.position.set(-5, -2, -3); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff007f, 1.2); rim.position.set(0, 5, -6); this.scene.add(rim);
    const grid = new THREE.GridHelper(12, 24, 0x00f2fe, 0x1f293d); grid.position.y = -2.2; this.scene.add(grid);
  }

  private setupGeometries(): void {
    this.geometriesMap["sphere"] = new THREE.SphereGeometry(1.8, 128, 128);
    this.geometriesMap["plane"] = new THREE.PlaneGeometry(4.5, 4.5, 128, 128);
    this.geometriesMap["torus"] = new THREE.TorusGeometry(1.5, 0.6, 64, 128);
    this.geometriesMap["cylinder"] = new THREE.CylinderGeometry(1.2, 1.2, 3.2, 96, 96);
  }

  private setupMaterials(): void {
    const makeDeformable = (mat: THREE.MeshStandardMaterial) => {
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = `
          attribute vec3 sculptOffset;
          ${shader.vertexShader}
        `.replace(
          `#include <begin_vertex>`,
          `
          #include <begin_vertex>
          transformed += sculptOffset;
          `
        );
      };
    };

    const clay = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.55, metalness: 0.05 });
    makeDeformable(clay);
    this.materialsMap["clay"] = clay;

    const gold = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.2, metalness: 0.95 });
    makeDeformable(gold);
    this.materialsMap["gold"] = gold;

    const cyber = new THREE.MeshStandardMaterial({ color: 0x00f2fe, roughness: 0.15, metalness: 0.8 });
    makeDeformable(cyber);
    this.materialsMap["cyber"] = cyber;

    const marble = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.1, metalness: 0.3 });
    makeDeformable(marble);
    this.materialsMap["marble"] = marble;
  }

  private initMeshUserData(mesh: THREE.Mesh, geo: THREE.BufferGeometry): void {
    const count = geo.attributes.position.count;
    geo.setAttribute("sculptOffset", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    mesh.userData.originalPositions = new Float32Array(geo.attributes.position.array);
    mesh.userData.sculptOffsets = geo.attributes.sculptOffset.array as Float32Array;
    mesh.userData.normals = new Float32Array(geo.attributes.normal.array);
    mesh.userData.vertexCount = count;
  }

  private selectPart(mesh: THREE.Mesh): void {
    this.selectedPart = mesh;
    this.originalPositions = mesh.userData.originalPositions;
    this.sculptOffsets = mesh.userData.sculptOffsets;
    this.normals = mesh.userData.normals;
    this.vertexCount = mesh.userData.vertexCount;
    this.poseOffsets = new Float32Array(this.vertexCount * 3);
  }

  createSculptMesh(shape: string): number {
    if (this.sculptMesh) this.scene.remove(this.sculptMesh);
    this.currentShape = shape;

    const group = new THREE.Group();
    group.name = "SculptGroup";
    this.sculptMesh = group as any;
    this.scene.add(group);

    if (shape === "human") {
      const parts = this.createHumanParts();
      for (const p of parts) {
        group.add(p);
      }
      this.selectedPart = parts.find(p => p.name === "chest" || p.name === "torso") || parts[0];
    } else {
      const geo = this.geometriesMap[shape].clone();
      const mesh = new THREE.Mesh(geo, this.materialsMap[this.currentMaterial]);
      mesh.name = shape;
      this.initMeshUserData(mesh, geo);
      group.add(mesh);
      this.selectedPart = mesh;
    }

    this.selectPart(this.selectedPart!);
    this.undoStack = [];
    this.redoStack = [];

    if (this.gizmo && this.selectedPart) this.gizmo.attachTo(this.selectedPart);
    return this.vertexCount;
  }

  saveSnapshot(): void {
    if (!this.selectedPart || !this.sculptOffsets) return;
    if (this.undoStack.length >= this.maxStack) this.undoStack.shift();
    this.undoStack.push({
      mesh: this.selectedPart,
      offsets: new Float32Array(this.sculptOffsets)
    });
    this.redoStack = [];
  }

  undo(): boolean {
    if (!this.undoStack.length) return false;
    const snap = this.undoStack.pop()!;
    if (snap.mesh && snap.mesh.userData.sculptOffsets) {
      this.redoStack.push({
        mesh: snap.mesh,
        offsets: new Float32Array(snap.mesh.userData.sculptOffsets)
      });
      snap.mesh.userData.sculptOffsets.set(snap.offsets);
      this.selectPart(snap.mesh);
      this.syncDeformedGeometry();
      if (this.gizmo && this.gizmo.visible) this.gizmo.attachTo(snap.mesh);
      return true;
    }
    return false;
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    const snap = this.redoStack.pop()!;
    if (snap.mesh && snap.mesh.userData.sculptOffsets) {
      this.undoStack.push({
        mesh: snap.mesh,
        offsets: new Float32Array(snap.mesh.userData.sculptOffsets)
      });
      snap.mesh.userData.sculptOffsets.set(snap.offsets);
      this.selectPart(snap.mesh);
      this.syncDeformedGeometry();
      if (this.gizmo && this.gizmo.visible) this.gizmo.attachTo(snap.mesh);
      return true;
    }
    return false;
  }

  /**
   * Sync the position attribute to include sculpt offsets so that:
   * 1. Raycaster hit-tests against the ACTUAL deformed surface
   * 2. Vertex normals are recomputed for correct lighting on deformed geometry
   */
  syncDeformedGeometry(): void {
    if (!this.selectedPart) return;
    const mesh = this.selectedPart;
    const geo = mesh.geometry;
    const pos = geo.attributes.position.array as Float32Array;
    const orig = mesh.userData.originalPositions;
    const off = mesh.userData.sculptOffsets;
    const cnt = mesh.userData.vertexCount;
    for (let i = 0; i < cnt * 3; i++) {
      pos[i] = orig[i] + off[i];
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.sculptOffset.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  private createCursors(): void {
    const palettes = [
      { main: 0x00f2fe, active: 0x00ff87, smooth: 0x7f00ff },
      { main: 0xff007f, active: 0xffd700, smooth: 0xffaa00 },
    ];
    for (const p of palettes) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: p.main, wireframe: true, transparent: true, opacity: 0.8 }));
      mesh.visible = false; this.scene.add(mesh);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.39, 0.4, 32), new THREE.MeshBasicMaterial({ color: p.main, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
      ring.visible = false; this.scene.add(ring);
      this.cursors.push({ mesh, ring, palette: p });
    }
  }

  /** Initialize 3D Stick-Figure Pose Rig */
  private initPoseRig(): void {
    this.poseGroup = new THREE.Group();
    this.poseGroup.visible = false;
    this.scene.add(this.poseGroup);

    this.poseBonesGroup = new THREE.Group();
    this.poseGroup.add(this.poseBonesGroup);

    // Cache bone line material — reused every frame instead of re-creating
    this.poseBoneMat = new THREE.LineBasicMaterial({ color: 0x00f2fe, linewidth: 2, transparent: true, opacity: 0.7 });

    const jointMat = new THREE.MeshBasicMaterial({ color: 0xff9900, transparent: true, opacity: 0.9 });
    const jointGeo = new THREE.SphereGeometry(0.08, 16, 16);

    // Create 33 landmarks
    for (let i = 0; i < 33; i++) {
      const joint = new THREE.Mesh(jointGeo, jointMat);
      this.poseGroup.add(joint);
      this.poseJoints.push(joint);
    }
  }

  /** Update 3D visual skeletal bones of the pose rig in real-time */
  updatePoseSkeleton(landmarks: any[]): void {
    if (!landmarks || landmarks.length === 0) {
      this.poseGroup.visible = false;
      return;
    }
    this.poseGroup.visible = this.enablePoseRigging;
    if (!this.enablePoseRigging) return;

    // Dispose existing bone line geometries properly to prevent memory leak
    while (this.poseBonesGroup.children.length > 0) {
      const child = this.poseBonesGroup.children[0];
      this.poseBonesGroup.remove(child);
      if ((child as THREE.Line).geometry) (child as THREE.Line).geometry.dispose();
    }

    const jointAnchors: Record<number, THREE.Vector3> = {
      11: new THREE.Vector3(-0.5, 0.8, 0),   // Left Shoulder
      12: new THREE.Vector3(0.5, 0.8, 0),    // Right Shoulder
      13: new THREE.Vector3(-0.8, 0.3, 0),   // Left Elbow
      14: new THREE.Vector3(0.8, 0.3, 0),    // Right Elbow
      15: new THREE.Vector3(-1.1, -0.2, 0),  // Left Wrist
      16: new THREE.Vector3(1.1, -0.2, 0),   // Right Wrist
      23: new THREE.Vector3(-0.25, -0.2, 0), // Left Hip
      24: new THREE.Vector3(0.25, -0.2, 0),  // Right Hip
      25: new THREE.Vector3(-0.25, -0.8, 0), // Left Knee
      26: new THREE.Vector3(0.25, -0.8, 0),  // Right Knee
      27: new THREE.Vector3(-0.25, -1.4, 0), // Left Ankle
      28: new THREE.Vector3(0.25, -1.4, 0),  // Right Ankle
    };

    const mapCoords = (lm: any) => {
      const x = (0.5 - lm.x) * 5.0;
      const y = (0.5 - lm.y) * 4.0;
      const z = -lm.z * 3.0 - 0.5;
      return new THREE.Vector3(x, y, z);
    };

    const rawPoints: Record<number, THREE.Vector3> = {};
    for (let i = 0; i < 33; i++) {
      if (landmarks[i]) {
        rawPoints[i] = mapCoords(landmarks[i]);
      }
    }

    // Align rawPoints to jointAnchors
    let scaleFactor = 1.0;
    const offset = new THREE.Vector3();
    if (rawPoints[11] && rawPoints[12] && rawPoints[23] && rawPoints[24]) {
      const rawShoulderMid = rawPoints[11].clone().add(rawPoints[12]).multiplyScalar(0.5);
      const rawHipMid = rawPoints[23].clone().add(rawPoints[24]).multiplyScalar(0.5);
      const rawSpineLen = rawShoulderMid.distanceTo(rawHipMid);

      const neutralShoulderMid = jointAnchors[11].clone().add(jointAnchors[12]).multiplyScalar(0.5);
      const neutralHipMid = jointAnchors[23].clone().add(jointAnchors[24]).multiplyScalar(0.5);
      const neutralSpineLen = neutralShoulderMid.distanceTo(neutralHipMid);

      scaleFactor = neutralSpineLen / (rawSpineLen || 1.0);
      offset.copy(neutralShoulderMid).addScaledVector(rawShoulderMid, -scaleFactor);
    }

    const alignedPoints: Record<number, THREE.Vector3> = {};
    for (let i = 0; i < 33; i++) {
      if (rawPoints[i]) {
        alignedPoints[i] = rawPoints[i].clone().multiplyScalar(scaleFactor).add(offset);
      } else {
        alignedPoints[i] = (jointAnchors[i] || new THREE.Vector3()).clone();
      }
      this.poseJoints[i].position.copy(alignedPoints[i]);
    }

    const connections = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
      [24, 26], [26, 28]
    ];

    for (const conn of connections) {
      const p1 = alignedPoints[conn[0]];
      const p2 = alignedPoints[conn[1]];
      if (!p1 || !p2) continue;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(lineGeo, this.poseBoneMat); // reuse cached material
      this.poseBonesGroup.add(line);
    }
  }

  /**
   * Real-time Body-Pose Mesh Deformer (rigging).
   * Map user's left/right arm postures to bend and morph the 3D sculpt figure.
   */
  /**
   * Dynamic Skeletal Soft Skinning Rig deforms vertices of any model based on
   * inverse-distance weights to human pose landmarks.
   */
  deformMeshWithPose(landmarks: any[]): void {
    if (!this.enablePoseRigging || !landmarks || landmarks.length < 17) return;
    if (!this.sculptMesh) return;

    const jointAnchors: Record<number, THREE.Vector3> = {
      11: new THREE.Vector3(-0.5, 0.8, 0),   // Left Shoulder
      12: new THREE.Vector3(0.5, 0.8, 0),    // Right Shoulder
      13: new THREE.Vector3(-0.8, 0.3, 0),   // Left Elbow
      14: new THREE.Vector3(0.8, 0.3, 0),    // Right Elbow
      15: new THREE.Vector3(-1.1, -0.2, 0),  // Left Wrist
      16: new THREE.Vector3(1.1, -0.2, 0),   // Right Wrist
      23: new THREE.Vector3(-0.25, -0.2, 0), // Left Hip
      24: new THREE.Vector3(0.25, -0.2, 0),  // Right Hip
      25: new THREE.Vector3(-0.25, -0.8, 0), // Left Knee
      26: new THREE.Vector3(0.25, -0.8, 0),  // Right Knee
      27: new THREE.Vector3(-0.25, -1.4, 0), // Left Ankle
      28: new THREE.Vector3(0.25, -1.4, 0),  // Right Ankle
    };

    const bones = [
      { p: 11, c: 13 }, // 0: Left Upper Arm
      { p: 13, c: 15 }, // 1: Left Forearm
      { p: 12, c: 14 }, // 2: Right Upper Arm
      { p: 14, c: 16 }, // 3: Right Forearm
      { p: 23, c: 25 }, // 4: Left Upper Leg
      { p: 25, c: 27 }, // 5: Left Lower Leg
      { p: 24, c: 26 }, // 6: Right Upper Leg
      { p: 26, c: 28 }, // 7: Right Lower Leg
      { p: 23, c: 24 }, // 8: Hips
      { p: 11, c: 12 }, // 9: Shoulders
    ];

    const mapCoords = (lm: any) => {
      const x = (0.5 - lm.x) * 5.0;
      const y = (0.5 - lm.y) * 4.0;
      const z = -lm.z * 3.0 - 0.5;
      return new THREE.Vector3(x, y, z);
    };

    // Calculate aligned landmarks to match model coordinate space
    const rawPoints: Record<number, THREE.Vector3> = {};
    for (let i = 0; i < 33; i++) {
      if (landmarks[i]) {
        rawPoints[i] = mapCoords(landmarks[i]);
      }
    }

    let scaleFactor = 1.0;
    const offset = new THREE.Vector3();
    if (rawPoints[11] && rawPoints[12] && rawPoints[23] && rawPoints[24]) {
      const rawShoulderMid = rawPoints[11].clone().add(rawPoints[12]).multiplyScalar(0.5);
      const rawHipMid = rawPoints[23].clone().add(rawPoints[24]).multiplyScalar(0.5);
      const rawSpineLen = rawShoulderMid.distanceTo(rawHipMid);

      const neutralShoulderMid = jointAnchors[11].clone().add(jointAnchors[12]).multiplyScalar(0.5);
      const neutralHipMid = jointAnchors[23].clone().add(jointAnchors[24]).multiplyScalar(0.5);
      const neutralSpineLen = neutralShoulderMid.distanceTo(neutralHipMid);

      scaleFactor = neutralSpineLen / (rawSpineLen || 1.0);
      offset.copy(neutralShoulderMid).addScaledVector(rawShoulderMid, -scaleFactor);
    }

    const alignedPoints: Record<number, THREE.Vector3> = {};
    for (let i = 0; i < 33; i++) {
      if (rawPoints[i]) {
        alignedPoints[i] = rawPoints[i].clone().multiplyScalar(scaleFactor).add(offset);
      } else {
        alignedPoints[i] = (jointAnchors[i] || new THREE.Vector3()).clone();
      }
    }

    // Calculate rotations for each bone segment
    const boneRotations: THREE.Quaternion[] = [];
    for (let b = 0; b < bones.length; b++) {
      const bone = bones[b];
      const pNeutral = jointAnchors[bone.p];
      const cNeutral = jointAnchors[bone.c];
      const pCurrent = alignedPoints[bone.p];
      const cCurrent = alignedPoints[bone.c];

      const vNeutral = cNeutral.clone().sub(pNeutral);
      const vCurrent = cCurrent.clone().sub(pCurrent);

      const q = new THREE.Quaternion().setFromUnitVectors(
        vNeutral.clone().normalize(),
        vCurrent.clone().normalize()
      );
      boneRotations.push(q);
    }

    // Compute hierarchical deformed joint positions in model space
    const pDeformed: Record<number, THREE.Vector3> = {};
    pDeformed[11] = jointAnchors[11].clone();
    pDeformed[12] = jointAnchors[12].clone();
    pDeformed[23] = jointAnchors[23].clone();
    pDeformed[24] = jointAnchors[24].clone();

    // Left Upper Arm (bone 0: 11 -> 13)
    pDeformed[13] = pDeformed[11].clone().add(
      jointAnchors[13].clone().sub(jointAnchors[11]).applyQuaternion(boneRotations[0])
    );
    // Left Forearm (bone 1: 13 -> 15)
    pDeformed[15] = pDeformed[13].clone().add(
      jointAnchors[15].clone().sub(jointAnchors[13]).applyQuaternion(boneRotations[1])
    );

    // Right Upper Arm (bone 2: 12 -> 14)
    pDeformed[14] = pDeformed[12].clone().add(
      jointAnchors[14].clone().sub(jointAnchors[12]).applyQuaternion(boneRotations[2])
    );
    // Right Forearm (bone 3: 14 -> 16)
    pDeformed[16] = pDeformed[14].clone().add(
      jointAnchors[16].clone().sub(jointAnchors[14]).applyQuaternion(boneRotations[3])
    );

    // Left Upper Leg (bone 4: 23 -> 25)
    pDeformed[25] = pDeformed[23].clone().add(
      jointAnchors[25].clone().sub(jointAnchors[23]).applyQuaternion(boneRotations[4])
    );
    // Left Lower Leg (bone 5: 25 -> 27)
    pDeformed[27] = pDeformed[25].clone().add(
      jointAnchors[27].clone().sub(jointAnchors[25]).applyQuaternion(boneRotations[5])
    );

    // Right Upper Leg (bone 6: 24 -> 26)
    pDeformed[26] = pDeformed[24].clone().add(
      jointAnchors[26].clone().sub(jointAnchors[24]).applyQuaternion(boneRotations[6])
    );
    // Right Lower Leg (bone 7: 26 -> 28)
    pDeformed[28] = pDeformed[26].clone().add(
      jointAnchors[28].clone().sub(jointAnchors[26]).applyQuaternion(boneRotations[7])
    );

    // Update parts of human mannequin
    if (this.currentShape === "human") {
      this.sculptMesh.children.forEach((child) => {
        const name = child.name;
        if (name === "head") {
          const neckMid = pDeformed[11].clone().add(pDeformed[12]).multiplyScalar(0.5);
          child.position.copy(neckMid).add(new THREE.Vector3(0, 0.45, 0));
        } else if (name === "neck") {
          const neckMid = pDeformed[11].clone().add(pDeformed[12]).multiplyScalar(0.5);
          child.position.copy(neckMid).add(new THREE.Vector3(0, 0.15, 0));
        } else if (name === "chest") {
          const chestMid = pDeformed[11].clone().add(pDeformed[12]).multiplyScalar(0.5)
            .add(pDeformed[23].clone().add(pDeformed[24]).multiplyScalar(0.5)).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.15, 0));
          child.position.copy(chestMid);
        } else if (name === "hips") {
          const hipsMid = pDeformed[23].clone().add(pDeformed[24]).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.1, 0));
          child.position.copy(hipsMid);
          child.quaternion.copy(boneRotations[8]);
        } else if (name === "left_shoulder") {
          child.position.copy(pDeformed[11]);
        } else if (name === "right_shoulder") {
          child.position.copy(pDeformed[12]);
        } else if (name === "left_arm") {
          child.position.copy(pDeformed[11].clone().add(pDeformed[13]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[0]);
        } else if (name === "right_arm") {
          child.position.copy(pDeformed[12].clone().add(pDeformed[14]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[2]);
        } else if (name === "left_elbow") {
          child.position.copy(pDeformed[13]);
        } else if (name === "right_elbow") {
          child.position.copy(pDeformed[14]);
        } else if (name === "left_forearm") {
          child.position.copy(pDeformed[13].clone().add(pDeformed[15]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[1]);
        } else if (name === "right_forearm") {
          child.position.copy(pDeformed[14].clone().add(pDeformed[16]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[3]);
        } else if (name === "left_hand") {
          child.position.copy(pDeformed[15]);
        } else if (name === "right_hand") {
          child.position.copy(pDeformed[16]);
        } else if (name === "left_leg") {
          child.position.copy(pDeformed[23].clone().add(pDeformed[25]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[4]);
        } else if (name === "right_leg") {
          child.position.copy(pDeformed[24].clone().add(pDeformed[26]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[6]);
        } else if (name === "left_knee") {
          child.position.copy(pDeformed[25]);
        } else if (name === "right_knee") {
          child.position.copy(pDeformed[26]);
        } else if (name === "left_shin") {
          child.position.copy(pDeformed[25].clone().add(pDeformed[27]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[5]);
        } else if (name === "right_shin") {
          child.position.copy(pDeformed[26].clone().add(pDeformed[28]).multiplyScalar(0.5));
          child.quaternion.copy(boneRotations[7]);
        } else if (name === "left_foot") {
          child.position.copy(pDeformed[27].clone().add(new THREE.Vector3(0, -0.05, 0.1)));
        } else if (name === "right_foot") {
          child.position.copy(pDeformed[28].clone().add(new THREE.Vector3(0, -0.05, 0.1)));
        }
      });
    } else {
      const spineRot = boneRotations[8] || new THREE.Quaternion();
      this.sculptMesh.quaternion.copy(spineRot);
    }

    if (this.selectedPart && this.gizmo && this.gizmo.visible) {
      this.gizmo.syncRotation(this.selectedPart);
    }
  }

  resetNeutralPose(): void {
    this.neutralPose = null;
    if (this.currentShape === "human" && this.sculptMesh) {
      this.sculptMesh.children.forEach((child) => {
        child.rotation.set(0, 0, 0);
        child.quaternion.set(0, 0, 0, 1);
        const name = child.name;
        if (name === "head") child.position.set(0, 1.25, 0);
        else if (name === "neck") child.position.set(0, 0.95, 0);
        else if (name === "chest") child.position.set(0, 0.55, 0);
        else if (name === "hips") child.position.set(0, 0.05, 0);
        else if (name === "left_shoulder") child.position.set(-0.5, 0.8, 0);
        else if (name === "right_shoulder") child.position.set(0.5, 0.8, 0);
        else if (name === "left_arm") child.position.set(-0.65, 0.55, 0);
        else if (name === "right_arm") child.position.set(0.65, 0.55, 0);
        else if (name === "left_elbow") child.position.set(-0.8, 0.3, 0);
        else if (name === "right_elbow") child.position.set(0.8, 0.3, 0);
        else if (name === "left_forearm") child.position.set(-0.95, 0.05, 0);
        else if (name === "right_forearm") child.position.set(0.95, 0.05, 0);
        else if (name === "left_hand") child.position.set(-1.1, -0.25, 0);
        else if (name === "right_hand") child.position.set(1.1, -0.25, 0);
        else if (name === "left_leg") child.position.set(-0.25, -0.5, 0);
        else if (name === "right_leg") child.position.set(0.25, -0.5, 0);
        else if (name === "left_knee") child.position.set(-0.25, -0.8, 0);
        else if (name === "right_knee") child.position.set(0.25, -0.8, 0);
        else if (name === "left_shin") child.position.set(-0.25, -1.1, 0);
        else if (name === "right_shin") child.position.set(0.25, -1.1, 0);
        else if (name === "left_foot") child.position.set(-0.25, -1.45, 0.1);
        else if (name === "right_foot") child.position.set(0.25, -1.45, 0.1);
      });
    } else if (this.sculptMesh) {
      this.sculptMesh.rotation.set(0, 0, 0);
    }
  }

  /** Precompute skinning weights for every vertex against the skeletal anchors */
  precomputeJointWeights(): void {
    if (!this.originalPositions) return;
    const count = this.vertexCount;
    const pos = this.originalPositions;
    this.vertexWeights = new Float32Array(count * 12);

    const jointAnchors = [
      new THREE.Vector3(-0.5, 0.8, 0),   // 11: Left Shoulder
      new THREE.Vector3(0.5, 0.8, 0),    // 12: Right Shoulder
      new THREE.Vector3(-0.8, 0.3, 0),   // 13: Left Elbow
      new THREE.Vector3(0.8, 0.3, 0),    // 14: Right Elbow
      new THREE.Vector3(-1.1, -0.2, 0),  // 15: Left Wrist
      new THREE.Vector3(1.1, -0.2, 0),   // 16: Right Wrist
      new THREE.Vector3(-0.25, -0.2, 0), // 23: Left Hip
      new THREE.Vector3(0.25, -0.2, 0),  // 24: Right Hip
      new THREE.Vector3(-0.25, -0.8, 0), // 25: Left Knee
      new THREE.Vector3(0.25, -0.8, 0),  // 26: Right Knee
      new THREE.Vector3(-0.25, -1.4, 0), // 27: Left Ankle
      new THREE.Vector3(0.25, -1.4, 0),  // 28: Right Ankle
    ];

    const tempV = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      tempV.set(pos[idx], pos[idx + 1], pos[idx + 2]);

      let sum = 0;
      const rawWeights = new Float32Array(12);
      for (let j = 0; j < 12; j++) {
        const d = tempV.distanceTo(jointAnchors[j]);
        // Strong falloff power of 3 to restrict regional movement bleed
        const w = 1.0 / (Math.pow(d, 3) + 0.05);
        rawWeights[j] = w;
        sum += w;
      }

      // Limit influence to top 3 joints for smooth skin deformation
      const sorted = Array.from(rawWeights)
        .map((w, index) => ({ w, index }))
        .sort((a, b) => b.w - a.w);

      let topSum = 0;
      for (let k = 0; k < 3; k++) {
        topSum += sorted[k].w;
      }

      const wIdx = i * 12;
      for (let j = 0; j < 12; j++) {
        this.vertexWeights[wIdx + j] = 0;
      }

      for (let k = 0; k < 3; k++) {
        const item = sorted[k];
        this.vertexWeights[wIdx + item.index] = item.w / topSum;
      }
    }
  }

  /** Precompute bone segment distances and skinning weights for rotation-based rigging */
  precomputeBoneSkinning(): void {
    if (!this.originalPositions) return;
    const count = this.vertexCount;
    const pos = this.originalPositions;
    this.vertexBoneIndices = new Uint8Array(count * 2);
    this.vertexBoneWeights = new Float32Array(count * 2);

    const jointAnchors: Record<number, THREE.Vector3> = {
      11: new THREE.Vector3(-0.5, 0.8, 0),   // Left Shoulder
      12: new THREE.Vector3(0.5, 0.8, 0),    // Right Shoulder
      13: new THREE.Vector3(-0.8, 0.3, 0),   // Left Elbow
      14: new THREE.Vector3(0.8, 0.3, 0),    // Right Elbow
      15: new THREE.Vector3(-1.1, -0.2, 0),  // Left Wrist
      16: new THREE.Vector3(1.1, -0.2, 0),   // Right Wrist
      23: new THREE.Vector3(-0.25, -0.2, 0), // Left Hip
      24: new THREE.Vector3(0.25, -0.2, 0),  // Right Hip
      25: new THREE.Vector3(-0.25, -0.8, 0), // Left Knee
      26: new THREE.Vector3(0.25, -0.8, 0),  // Right Knee
      27: new THREE.Vector3(-0.25, -1.4, 0), // Left Ankle
      28: new THREE.Vector3(0.25, -1.4, 0),  // Right Ankle
    };

    const bones = [
      { p: 11, c: 13 }, // 0: Left Upper Arm
      { p: 13, c: 15 }, // 1: Left Forearm
      { p: 12, c: 14 }, // 2: Right Upper Arm
      { p: 14, c: 16 }, // 3: Right Forearm
      { p: 23, c: 25 }, // 4: Left Upper Leg
      { p: 25, c: 27 }, // 5: Left Lower Leg
      { p: 24, c: 26 }, // 6: Right Upper Leg
      { p: 26, c: 28 }, // 7: Right Lower Leg
      { p: 23, c: 24 }, // 8: Hips
      { p: 11, c: 12 }, // 9: Shoulders
    ];

    const distanceToSegment = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
      const ab = b.clone().sub(a);
      const ap = p.clone().sub(a);
      const abLenSq = ab.lengthSq();
      if (abLenSq === 0) return p.distanceTo(a);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / abLenSq));
      const projection = a.clone().add(ab.multiplyScalar(t));
      return p.distanceTo(projection);
    };

    const tempV = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      tempV.set(pos[idx], pos[idx + 1], pos[idx + 2]);

      const rawDistances = new Float32Array(bones.length);
      for (let b = 0; b < bones.length; b++) {
        const bone = bones[b];
        const pAnchor = jointAnchors[bone.p];
        const cAnchor = jointAnchors[bone.c];
        rawDistances[b] = distanceToSegment(tempV, pAnchor, cAnchor);
      }

      // Convert distance to weight using inverse distance squared
      const rawWeights = new Float32Array(bones.length);
      let sum = 0;
      for (let b = 0; b < bones.length; b++) {
        const w = 1.0 / (Math.pow(rawDistances[b], 4) + 0.02);
        rawWeights[b] = w;
        sum += w;
      }

      // Find top 2 bones
      const sorted = Array.from(rawWeights)
        .map((w, index) => ({ w, index }))
        .sort((a, b) => b.w - a.w);

      const wIdx = i * 2;
      const b1 = sorted[0];
      const b2 = sorted[1];
      const weightSum = b1.w + b2.w;

      this.vertexBoneIndices![wIdx] = b1.index;
      this.vertexBoneWeights![wIdx] = b1.w / weightSum;

      this.vertexBoneIndices![wIdx + 1] = b2.index;
      this.vertexBoneWeights![wIdx + 1] = b2.w / weightSum;
    }
  }

  private createHumanParts(): THREE.Mesh[] {
    const mat = this.materialsMap[this.currentMaterial];
    const parts: THREE.Mesh[] = [];

    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const headMesh = new THREE.Mesh(headGeo, mat);
    headMesh.name = "head";
    headMesh.position.set(0, 1.25, 0);
    this.initMeshUserData(headMesh, headGeo);
    parts.push(headMesh);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.2, 16, 4);
    const neckMesh = new THREE.Mesh(neckGeo, mat);
    neckMesh.name = "neck";
    neckMesh.position.set(0, 0.95, 0);
    this.initMeshUserData(neckMesh, neckGeo);
    parts.push(neckMesh);

    // Chest (Upper Torso)
    const chestGeo = new THREE.CylinderGeometry(0.38, 0.30, 0.5, 16, 8);
    const chestMesh = new THREE.Mesh(chestGeo, mat);
    chestMesh.name = "chest";
    chestMesh.position.set(0, 0.55, 0);
    this.initMeshUserData(chestMesh, chestGeo);
    parts.push(chestMesh);

    // Hips (Lower Torso/Pelvis)
    const hipsGeo = new THREE.CylinderGeometry(0.30, 0.34, 0.5, 16, 8);
    const hipsMesh = new THREE.Mesh(hipsGeo, mat);
    hipsMesh.name = "hips";
    hipsMesh.position.set(0, 0.05, 0);
    this.initMeshUserData(hipsMesh, hipsGeo);
    parts.push(hipsMesh);

    // Left Shoulder
    const lShoulderGeo = new THREE.SphereGeometry(0.09, 16, 16);
    const lShoulderMesh = new THREE.Mesh(lShoulderGeo, mat);
    lShoulderMesh.name = "left_shoulder";
    lShoulderMesh.position.set(-0.5, 0.8, 0);
    this.initMeshUserData(lShoulderMesh, lShoulderGeo);
    parts.push(lShoulderMesh);

    // Right Shoulder
    const rShoulderGeo = new THREE.SphereGeometry(0.09, 16, 16);
    const rShoulderMesh = new THREE.Mesh(rShoulderGeo, mat);
    rShoulderMesh.name = "right_shoulder";
    rShoulderMesh.position.set(0.5, 0.8, 0);
    this.initMeshUserData(rShoulderMesh, rShoulderGeo);
    parts.push(rShoulderMesh);

    // Left Upper Arm
    const larmGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.52, 16, 8);
    larmGeo.rotateZ(0.54);
    const larmMesh = new THREE.Mesh(larmGeo, mat);
    larmMesh.name = "left_arm";
    larmMesh.position.set(-0.65, 0.55, 0);
    this.initMeshUserData(larmMesh, larmGeo);
    parts.push(larmMesh);

    // Right Upper Arm
    const rarmGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.52, 16, 8);
    rarmGeo.rotateZ(-0.54);
    const rarmMesh = new THREE.Mesh(rarmGeo, mat);
    rarmMesh.name = "right_arm";
    rarmMesh.position.set(0.65, 0.55, 0);
    this.initMeshUserData(rarmMesh, rarmGeo);
    parts.push(rarmMesh);

    // Left Elbow
    const lElbowGeo = new THREE.SphereGeometry(0.07, 16, 16);
    const lElbowMesh = new THREE.Mesh(lElbowGeo, mat);
    lElbowMesh.name = "left_elbow";
    lElbowMesh.position.set(-0.8, 0.3, 0);
    this.initMeshUserData(lElbowMesh, lElbowGeo);
    parts.push(lElbowMesh);

    // Right Elbow
    const rElbowGeo = new THREE.SphereGeometry(0.07, 16, 16);
    const rElbowMesh = new THREE.Mesh(rElbowGeo, mat);
    rElbowMesh.name = "right_elbow";
    rElbowMesh.position.set(0.8, 0.3, 0);
    this.initMeshUserData(rElbowMesh, rElbowGeo);
    parts.push(rElbowMesh);

    // Left Forearm
    const lforearmGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.52, 16, 8);
    lforearmGeo.rotateZ(0.54);
    const lforearmMesh = new THREE.Mesh(lforearmGeo, mat);
    lforearmMesh.name = "left_forearm";
    lforearmMesh.position.set(-0.95, 0.05, 0);
    this.initMeshUserData(lforearmMesh, lforearmGeo);
    parts.push(lforearmMesh);

    // Right Forearm
    const rforearmGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.52, 16, 8);
    rforearmGeo.rotateZ(-0.54);
    const rforearmMesh = new THREE.Mesh(rforearmGeo, mat);
    rforearmMesh.name = "right_forearm";
    rforearmMesh.position.set(0.95, 0.05, 0);
    this.initMeshUserData(rforearmMesh, rforearmGeo);
    parts.push(rforearmMesh);

    // Left Hand
    const lHandGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const lHandMesh = new THREE.Mesh(lHandGeo, mat);
    lHandMesh.name = "left_hand";
    lHandMesh.position.set(-1.1, -0.25, 0);
    this.initMeshUserData(lHandMesh, lHandGeo);
    parts.push(lHandMesh);

    // Right Hand
    const rHandGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const rHandMesh = new THREE.Mesh(rHandGeo, mat);
    rHandMesh.name = "right_hand";
    rHandMesh.position.set(1.1, -0.25, 0);
    this.initMeshUserData(rHandMesh, rHandGeo);
    parts.push(rHandMesh);

    // Left Thigh
    const llegGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.56, 16, 8);
    const llegMesh = new THREE.Mesh(llegGeo, mat);
    llegMesh.name = "left_leg";
    llegMesh.position.set(-0.25, -0.5, 0);
    this.initMeshUserData(llegMesh, llegGeo);
    parts.push(llegMesh);

    // Right Thigh
    const rlegGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.56, 16, 8);
    const rlegMesh = new THREE.Mesh(rlegGeo, mat);
    rlegMesh.name = "right_leg";
    rlegMesh.position.set(0.25, -0.5, 0);
    this.initMeshUserData(rlegMesh, rlegGeo);
    parts.push(rlegMesh);

    // Left Knee
    const lKneeGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const lKneeMesh = new THREE.Mesh(lKneeGeo, mat);
    lKneeMesh.name = "left_knee";
    lKneeMesh.position.set(-0.25, -0.8, 0);
    this.initMeshUserData(lKneeMesh, lKneeGeo);
    parts.push(lKneeMesh);

    // Right Knee
    const rKneeGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const rKneeMesh = new THREE.Mesh(rKneeGeo, mat);
    rKneeMesh.name = "right_knee";
    rKneeMesh.position.set(0.25, -0.8, 0);
    this.initMeshUserData(rKneeMesh, rKneeGeo);
    parts.push(rKneeMesh);

    // Left Shin
    const lshinGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.56, 16, 8);
    const lshinMesh = new THREE.Mesh(lshinGeo, mat);
    lshinMesh.name = "left_shin";
    lshinMesh.position.set(-0.25, -1.1, 0);
    this.initMeshUserData(lshinMesh, lshinGeo);
    parts.push(lshinMesh);

    // Right Shin
    const rshinGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.56, 16, 8);
    const rshinMesh = new THREE.Mesh(rshinGeo, mat);
    rshinMesh.name = "right_shin";
    rshinMesh.position.set(0.25, -1.1, 0);
    this.initMeshUserData(rshinMesh, rshinGeo);
    parts.push(rshinMesh);

    // Left Foot
    const lfootGeo = new THREE.BoxGeometry(0.12, 0.08, 0.22);
    const lfootMesh = new THREE.Mesh(lfootGeo, mat);
    lfootMesh.name = "left_foot";
    lfootMesh.position.set(-0.25, -1.45, 0.1);
    this.initMeshUserData(lfootMesh, lfootGeo);
    parts.push(lfootMesh);

    // Right Foot
    const rfootGeo = new THREE.BoxGeometry(0.12, 0.08, 0.22);
    const rfootMesh = new THREE.Mesh(rfootGeo, mat);
    rfootMesh.name = "right_foot";
    rfootMesh.position.set(0.25, -1.45, 0.1);
    this.initMeshUserData(rfootMesh, rfootGeo);
    parts.push(rfootMesh);

    return parts;
  }

  getSurfacePoint(ndcX: number, ndcY: number, shouldSelect = false): THREE.Vector3 {
    this.screenVec.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.screenVec, this.camera);
    if (this.sculptMesh) {
      const hits = this.raycaster.intersectObject(this.sculptMesh, true);
      if (hits.length > 0) {
        const hitObj = hits[0].object as THREE.Mesh;
        if (shouldSelect && hitObj.isMesh && hitObj.userData.sculptOffsets && this.selectedPart !== hitObj) {
          this.selectPart(hitObj);
          if (this.gizmo && this.gizmo.visible) {
            this.gizmo.attachTo(hitObj);
          }
        }
        return hits[0].point.clone();
      }
    }
    const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera);
    return this.camera.position.clone().add(v.sub(this.camera.position).normalize().multiplyScalar(3));
  }

  updateToolVisualizer(idx: number, pos: THREE.Vector3, radius: number, state: string, vis: boolean): void {
    const c = this.cursors[idx]; if (!c) return;
    c.mesh.visible = vis; c.ring.visible = vis; if (!vis) return;
    c.mesh.position.copy(pos); c.ring.position.copy(pos);
    c.ring.scale.setScalar(radius); c.ring.lookAt(this.camera.position);
    const hex = state === "sculpt" ? c.palette.active : state === "smooth" ? c.palette.smooth : c.palette.main;
    (c.mesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
    (c.ring.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  sculptStroke(toolWorld: THREE.Vector3): void {
    if (!this.selectedPart || !this.originalPositions || !this.sculptOffsets || !this.normals) return;
    const local = this.selectedPart.worldToLocal(toolWorld.clone());
    const r = this.brushRadius, rSq = r * r, str = this.brushStrength, mode = this.brushMode;
    const pos = this.originalPositions, off = this.sculptOffsets, nrm = this.normals, cnt = this.vertexCount;
    let mod = 0;
    const affected: number[] = [];

    for (let i = 0; i < cnt; i++) {
      const idx = i * 3;
      const px = pos[idx] + off[idx], py = pos[idx+1] + off[idx+1], pz = pos[idx+2] + off[idx+2];
      const dx = px - local.x, dy = py - local.y, dz = pz - local.z;
      if (Math.abs(dx) > r || Math.abs(dy) > r || Math.abs(dz) > r) continue;
      const dSq = dx*dx + dy*dy + dz*dz;
      if (dSq < rSq) {
        const d = Math.sqrt(dSq), f = Math.max(0, (1 - (d/r) * (d/r)) ** 2), delta = str * f * 0.12;
        const nx = nrm[idx], ny = nrm[idx+1], nz = nrm[idx+2];
        if (mode === "push") { off[idx] += nx*delta; off[idx+1] += ny*delta; off[idx+2] += nz*delta; }
        else if (mode === "pull") { off[idx] -= nx*delta; off[idx+1] -= ny*delta; off[idx+2] -= nz*delta; }
        else if (mode === "inflate") { const len = Math.sqrt(px*px+py*py+pz*pz)||1; off[idx]+=(px/len)*delta; off[idx+1]+=(py/len)*delta; off[idx+2]+=(pz/len)*delta; }
        else if (mode === "crease") { off[idx]-=dx*f*str*0.2; off[idx+1]-=dy*f*str*0.2; off[idx+2]-=dz*f*str*0.2; }
        else if (mode === "smooth" || mode === "flatten") { affected.push(i); }
        mod++;
      }
    }

    if ((mode === "smooth" || mode === "flatten") && affected.length > 0) {
      const tx = new Float32Array(affected.length), ty = new Float32Array(affected.length), tz = new Float32Array(affected.length);
      for (let k = 0; k < affected.length; k++) {
        const idx = affected[k] * 3;
        let sx = off[idx], sy = off[idx+1], sz = off[idx+2], n = 1;
        for (let m = 0; m < affected.length; m++) { if (k === m) continue; const ni = affected[m]*3; sx+=off[ni]; sy+=off[ni+1]; sz+=off[ni+2]; n++; }
        const lf = mode === "flatten" ? 0.4 : 0.2;
        tx[k] = off[idx] + (sx/n - off[idx]) * lf;
        ty[k] = off[idx+1] + (sy/n - off[idx+1]) * lf;
        tz[k] = off[idx+2] + (sz/n - off[idx+2]) * lf;
      }
      for (let k = 0; k < affected.length; k++) { const idx = affected[k]*3; off[idx]=tx[k]; off[idx+1]=ty[k]; off[idx+2]=tz[k]; }
    }
    if (mod > 0) this.syncDeformedGeometry();
  }

  smoothAllMesh(): void {
    if (!this.selectedPart || !this.sculptOffsets) return;
    this.saveSnapshot();
    const off = this.sculptOffsets, cnt = this.vertexCount, next = new Float32Array(off.length);
    for (let i = 0; i < cnt; i++) {
      const idx = i*3, pi = ((i-1+cnt)%cnt)*3, ni = ((i+1)%cnt)*3;
      next[idx] = off[idx]*0.5 + (off[pi]+off[ni])*0.25;
      next[idx+1] = off[idx+1]*0.5 + (off[pi+1]+off[ni+1])*0.25;
      next[idx+2] = off[idx+2]*0.5 + (off[pi+2]+off[ni+2])*0.25;
    }
    off.set(next);
    this.syncDeformedGeometry();
  }

  resetSculptMesh(): void {
    if (!this.selectedPart || !this.sculptOffsets) return;
    this.saveSnapshot();
    this.sculptOffsets.fill(0);
    this.syncDeformedGeometry();
  }

  setMaterial(key: string): void {
    if (this.materialsMap[key] && this.sculptMesh) {
      this.currentMaterial = key;
      this.sculptMesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = this.materialsMap[key];
        }
      });
    }
  }

  /** Zoom camera in/out by delta (positive = zoom in, negative = zoom out) */
  zoom(delta: number): void {
    const z = this.camera.position.z - delta;
    this.camera.position.z = Math.max(2, Math.min(15, z));
  }

  exportOBJ(): void {
    if (!this.sculptMesh) return;
    let obj = `# HandForge - Wavefront OBJ\n\n`;
    let globalVertexOffset = 1;

    this.sculptMesh.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.originalPositions) return;

      obj += `o ${mesh.name}\n`;
      const pos = mesh.userData.originalPositions;
      const off = mesh.userData.sculptOffsets;
      const cnt = mesh.userData.vertexCount;

      mesh.updateMatrixWorld(true);
      const tempPos = new THREE.Vector3();
      for (let i = 0; i < cnt; i++) {
        const j = i * 3;
        tempPos.set(pos[j] + off[j], pos[j + 1] + off[j + 1], pos[j + 2] + off[j + 2]);
        tempPos.applyMatrix4(mesh.matrixWorld);
        obj += `v ${tempPos.x.toFixed(4)} ${tempPos.y.toFixed(4)} ${tempPos.z.toFixed(4)}\n`;
      }

      const indices = mesh.geometry.index?.array;
      if (indices) {
        for (let i = 0; i < indices.length; i += 3) {
          const v1 = indices[i] + globalVertexOffset;
          const v2 = indices[i + 1] + globalVertexOffset;
          const v3 = indices[i + 2] + globalVertexOffset;
          obj += `f ${v1} ${v2} ${v3}\n`;
        }
      }
      globalVertexOffset += cnt;
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([obj], { type: "text/plain" }));
    link.download = `HandForge_${this.currentShape}_${Date.now()}.obj`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(isPlayingAnimation = false): void {
    if (this.isOrbitEnabled && !isPlayingAnimation && this.sculptMesh) this.sculptMesh.rotation.y += 0.002;
    if (this.gizmo && this.selectedPart) this.gizmo.syncRotation(this.selectedPart);
    this.renderer.render(this.scene, this.camera);
  }
}
