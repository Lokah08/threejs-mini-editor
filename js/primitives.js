// primitives.js — プリミティブ生成と手続きテクスチャ
import * as THREE from "three";
import { scene, objects, select, notifySceneChanged } from "./state.js";

export const GEOMS = {
  box:      () => new THREE.BoxGeometry(1, 1, 1),
  sphere:   () => new THREE.SphereGeometry(0.6, 32, 20),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 28),
  torus:    () => new THREE.TorusGeometry(0.55, 0.22, 18, 40),
  plane:    () => new THREE.BoxGeometry(3, 0.05, 3),
};
export const NAMES = { box: "Cube", sphere: "Sphere", cylinder: "Cylinder", torus: "Torus", plane: "Plane" };
const PALETTE = [0x6aa7ff, 0xff8a7a, 0x8bd450, 0xd9a7ff, 0xffd166, 0x6fe3d6];

let counter = 0;
export function resetCounter() { counter = 0; }

/* --- 手続きテクスチャ --- */
export function makeTexture(kind) {
  if (kind === "none") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (kind === "checker") {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? "#d8d8d8" : "#555a60";
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  } else if (kind === "grid") {
    g.fillStyle = "#3a3f46"; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#9fb8d8"; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke();
    }
  } else if (kind === "uv") {
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, "#ff5f6d"); grad.addColorStop(.5, "#ffc371"); grad.addColorStop(1, "#4fc3f7");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(255,255,255,.85)"; g.font = "bold 40px monospace";
    g.fillText("UV", 96, 140);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --- プリミティブ追加 --- */
export function addPrimitive(kind, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? PALETTE[counter % PALETTE.length],
    roughness: 0.55, metalness: 0.05,
  });
  const mesh = new THREE.Mesh(GEOMS[kind](), mat);
  mesh.name = opts.name ?? `${NAMES[kind]}_${String(++counter).padStart(2, "0")}`;
  mesh.userData.kind = kind;
  mesh.userData.texKind = "none";
  if (opts.position) mesh.position.fromArray(opts.position);
  else mesh.position.set((Math.random() - 0.5) * 3, kind === "plane" ? 0 : 0.7, (Math.random() - 0.5) * 3);
  if (opts.rotation) mesh.rotation.fromArray(opts.rotation);
  if (opts.scale)    mesh.scale.fromArray(opts.scale);
  if (opts.texKind && opts.texKind !== "none") {
    mesh.material.map = makeTexture(opts.texKind);
    mesh.userData.texKind = opts.texKind;
  }
  scene.add(mesh);
  objects.push(mesh);
  notifySceneChanged();
  select(mesh);
  return mesh;
}
