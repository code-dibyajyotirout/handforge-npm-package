import * as THREE from "three";

/** Blender-style 3D transform gizmo with X/Y/Z rotation torus rings and 4 grab nodes per ring. */
export class TransformGizmo {
  group: THREE.Group;
  visible = true;
  rings: Record<string, THREE.Mesh> = {};
  colliders: Record<string, THREE.Mesh> = {};
  nodes: Record<string, THREE.Mesh[]> = {};
  nodeColliders: Record<string, THREE.Mesh[]> = {};

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = "TransformGizmo";
    this.createGizmo();
    scene.add(this.group);
  }

  private createGizmo(): void {
    const axes = [
      { name: "x", color: 0xff4444, rotation: new THREE.Euler(0, Math.PI / 2, 0) },
      { name: "y", color: 0x44ff44, rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
      { name: "z", color: 0x4488ff, rotation: new THREE.Euler(0, 0, 0) },
    ];

    for (const axis of axes) {
      // 1. Thin visible ring
      const ringGeo = new THREE.TorusGeometry(1.2, 0.012, 8, 64);
      const ringMat = new THREE.MeshBasicMaterial({ color: axis.color, transparent: true, opacity: 0.45, depthTest: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.copy(axis.rotation);
      ring.renderOrder = 999;
      this.group.add(ring);
      this.rings[axis.name] = ring;

      // 2. Thick invisible collider for easy raycasting
      const colliderGeo = new THREE.TorusGeometry(1.2, 0.12, 8, 32);
      const colliderMat = new THREE.MeshBasicMaterial({
        color: axis.color,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        depthTest: false
      });
      const collider = new THREE.Mesh(colliderGeo, colliderMat);
      collider.rotation.copy(axis.rotation);
      this.group.add(collider);
      this.colliders[axis.name] = collider;

      // 3. Visible nodes & node colliders
      const nodeGroup: THREE.Mesh[] = [];
      const nodeColliderGroup: THREE.Mesh[] = [];
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const pos = new THREE.Vector3(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, 0);
        pos.applyEuler(axis.rotation);

        // Visible node
        const nodeGeo = new THREE.SphereGeometry(0.045, 8, 8);
        const nodeMat = new THREE.MeshBasicMaterial({ color: axis.color, transparent: true, opacity: 0.85, depthTest: false });
        const node = new THREE.Mesh(nodeGeo, nodeMat);
        node.position.copy(pos);
        node.renderOrder = 1000;
        this.group.add(node);
        nodeGroup.push(node);

        // Node collider (thick invisible sphere)
        const nodeCollGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const nodeColl = new THREE.Mesh(nodeCollGeo, colliderMat);
        nodeColl.position.copy(pos);
        this.group.add(nodeColl);
        nodeColliderGroup.push(nodeColl);
      }
      this.nodes[axis.name] = nodeGroup;
      this.nodeColliders[axis.name] = nodeColliderGroup;
    }
  }

  attachTo(mesh: THREE.Mesh): void {
    mesh.getWorldPosition(this.group.position);
    mesh.getWorldQuaternion(this.group.quaternion);

    if (!mesh.geometry.boundingSphere) {
      mesh.geometry.computeBoundingSphere();
    }
    const sphere = mesh.geometry.boundingSphere;
    if (sphere) {
      const radius = sphere.radius;
      const targetScale = Math.max(0.2, Math.min(2.0, (radius * 1.6) / 1.2));
      this.group.scale.setScalar(targetScale);
    } else {
      this.group.scale.setScalar(1.0);
    }

    this.group.updateMatrixWorld(true);
    this.group.visible = this.visible;
  }

  syncRotation(mesh: THREE.Mesh): void {
    mesh.getWorldPosition(this.group.position);
    mesh.getWorldQuaternion(this.group.quaternion);

    if (!mesh.geometry.boundingSphere) {
      mesh.geometry.computeBoundingSphere();
    }
    const sphere = mesh.geometry.boundingSphere;
    if (sphere) {
      const radius = sphere.radius;
      const targetScale = Math.max(0.2, Math.min(2.0, (radius * 1.6) / 1.2));
      this.group.scale.setScalar(targetScale);
    }

    this.group.updateMatrixWorld(true);
  }

  highlightAxis(axisName: string): void {
    for (const key of Object.keys(this.rings)) {
      const isActive = key === axisName;
      (this.rings[key].material as THREE.MeshBasicMaterial).opacity = isActive ? 0.85 : 0.3;
      this.nodes[key].forEach((n) => {
        n.scale.setScalar(isActive ? 1.6 : 1.0);
        (n.material as THREE.MeshBasicMaterial).opacity = isActive ? 1.0 : 0.6;
      });
    }
  }

  resetHighlight(): void {
    for (const key of Object.keys(this.rings)) {
      (this.rings[key].material as THREE.MeshBasicMaterial).opacity = 0.45;
      this.nodes[key].forEach((n) => {
        n.scale.setScalar(1.0);
        (n.material as THREE.MeshBasicMaterial).opacity = 0.85;
      });
    }
  }

  toggle(): void {
    this.visible = !this.visible;
    this.group.visible = this.visible;
  }
}
