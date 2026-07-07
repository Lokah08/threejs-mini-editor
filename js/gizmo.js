// gizmo.js — 移動 / 回転 / 拡縮のトランスフォームギズモ
import * as THREE from "three";
import { scene, app, editorCam, camGizmo, selBox, onSelect } from "./state.js";
import { refreshInspector } from "./inspector.js";

export let gizmoMode = "translate";

export const gizmo = new THREE.Group();
gizmo.visible = false;
gizmo.userData.editorOnly = true;
scene.add(gizmo);

const gTranslate = new THREE.Group();
const gRotate    = new THREE.Group();
const gScale     = new THREE.Group();
gizmo.add(gTranslate, gRotate, gScale);

const AXES3 = [
  { ax: "x", dir: new THREE.Vector3(1, 0, 0), color: 0xff5f5f },
  { ax: "y", dir: new THREE.Vector3(0, 1, 0), color: 0x8bd450 },
  { ax: "z", dir: new THREE.Vector3(0, 0, 1), color: 0x4f9dff },
];
const gmat  = color => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: .95 });
const gpick = ()    => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false });
function orientY(g, ax) {
  if (ax === "x") g.rotation.z = -Math.PI / 2;
  else if (ax === "z") g.rotation.x = Math.PI / 2;
}

/* --- 移動: 矢印 --- */
for (const { ax, dir, color } of AXES3) {
  const g = new THREE.Group();
  const m = gmat(color);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .85, 8), m);
  shaft.position.y = .425;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.07, .22, 12), m);
  tip.position.y = .96;
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 1.15, 6), gpick());
  pick.position.y = .55;
  g.add(shaft, tip, pick);
  orientY(g, ax);
  g.userData = { tool: "translate", ax, dir };
  gTranslate.add(g);
}
/* --- 回転: リング --- */
for (const { ax, dir, color } of AXES3) {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(new THREE.TorusGeometry(1, .016, 8, 64), gmat(color)),
    new THREE.Mesh(new THREE.TorusGeometry(1, .09, 6, 40), gpick()),
  );
  if (ax === "x") g.rotation.y = Math.PI / 2;      // トーラスは既定でZ軸まわり
  else if (ax === "y") g.rotation.x = Math.PI / 2;
  g.userData = { tool: "rotate", ax, dir };
  gRotate.add(g);
}
/* --- 拡縮: 先端キューブ + 中央キューブ(全体) --- */
for (const { ax, dir, color } of AXES3) {
  const g = new THREE.Group();
  const m = gmat(color);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .7, 8), m);
  shaft.position.y = .35;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(.11, .11, .11), m);
  cube.position.y = .76;
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .95, 6), gpick());
  pick.position.y = .48;
  g.add(shaft, cube, pick);
  orientY(g, ax);
  g.userData = { tool: "scale", ax, dir };
  gScale.add(g);
}
{
  const center = new THREE.Group();
  center.add(
    new THREE.Mesh(new THREE.BoxGeometry(.14, .14, .14), gmat(0xffd166)),
    new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3), gpick()),
  );
  center.userData = { tool: "scaleAll" };
  gScale.add(center);
}

/* --- ツール切替 (ボタン + W/E/Rキー) --- */
const scaleBtn = document.querySelector('.tool[data-tool="scale"]');
export function setTool(t) {
  gizmoMode = t;
  document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
}
document.querySelectorAll(".tool").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
window.addEventListener("keydown", e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "w") setTool("translate");
  else if (k === "e") setTool("rotate");
  else if (k === "r" && app.selected !== camGizmo) setTool("scale");
});
onSelect(obj => {
  const isCam = obj === camGizmo;
  scaleBtn.classList.toggle("disabled", isCam);
  if (isCam && gizmoMode === "scale") setTool("translate");
});

/* --- ドラッグ計算 --- */
// マウスレイと軸直線の最近接点 (軸に沿った距離 s を返す)
function closestS(origin, dir, ray) {
  const w0 = new THREE.Vector3().subVectors(origin, ray.origin);
  const b = dir.dot(ray.direction);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return null;
  return (b * ray.direction.dot(w0) - dir.dot(w0)) / denom;
}
function afterTransform() {
  selBox.setFromObject(app.selected);
  refreshInspector();
}

// pointerdown時: ギズモのハンドルに当たっていればドラッグ情報を返す
export function hitGizmoHandle(raycaster) {
  if (!gizmo.visible) return null;
  const activeGroup = gizmoMode === "translate" ? gTranslate
                    : gizmoMode === "rotate"    ? gRotate : gScale;
  const hits = raycaster.intersectObjects(activeGroup.children, true);
  if (!hits.length) return null;
  let h = hits[0].object;
  while (h && !h.userData.tool) h = h.parent;
  return h ? h.userData : null;
}

export function beginGizmoDrag(ud, e, raycaster) {
  const sel = app.selected;
  const pos = sel.position.clone();
  if (ud.tool === "scaleAll") {
    return { mode: "gscaleAll", startScale: sel.scale.clone(), y: e.clientY };
  }
  const dirW = ud.dir.clone().applyQuaternion(gizmo.quaternion).normalize();
  if (ud.tool === "rotate") {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dirW, pos);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return { mode: "grotate", dirW, plane, center: pos, v0: hit.sub(pos), startQuat: sel.quaternion.clone() };
  }
  const s0 = closestS(pos, dirW, raycaster.ray);
  if (s0 === null) return null;
  return {
    mode: ud.tool === "translate" ? "gtranslate" : "gscale",
    ax: ud.ax, dirW, origin: pos, s0,
    startPos: pos.clone(), startScale: sel.scale.clone(),
  };
}

export function applyGizmoDrag(drag, e, raycaster) {
  const sel = app.selected;
  if (!sel) return;
  if (drag.mode === "gtranslate") {
    const s = closestS(drag.origin, drag.dirW, raycaster.ray);
    if (s !== null) {
      sel.position.copy(drag.startPos).addScaledVector(drag.dirW, s - drag.s0);
      afterTransform();
    }
  }
  else if (drag.mode === "gscale") {
    const s = closestS(drag.origin, drag.dirW, raycaster.ray);
    if (s !== null && Math.abs(drag.s0) > 1e-6) {
      const f = Math.abs(s / drag.s0);
      sel.scale[drag.ax] = Math.max(0.01, drag.startScale[drag.ax] * f);
      afterTransform();
    }
  }
  else if (drag.mode === "gscaleAll") {
    const f = Math.max(0.01, 1 + (drag.y - e.clientY) * 0.01);
    sel.scale.copy(drag.startScale).multiplyScalar(f);
    afterTransform();
  }
  else if (drag.mode === "grotate") {
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(drag.plane, hit)) {
      const v1 = hit.sub(drag.center);
      const angle = Math.atan2(
        new THREE.Vector3().crossVectors(drag.v0, v1).dot(drag.dirW),
        drag.v0.dot(v1)
      );
      const q = new THREE.Quaternion().setFromAxisAngle(drag.dirW, angle);
      sel.quaternion.copy(drag.startQuat).premultiply(q);
      afterTransform();
    }
  }
}

/* --- 毎フレーム更新 (main.js から呼ぶ) --- */
export function updateGizmoFrame(isSceneView) {
  const sel = app.selected;
  if (sel && isSceneView) {
    gizmo.visible = true;
    gizmo.position.copy(sel.position);
    gizmo.quaternion.copy(sel.quaternion);
    const d = editorCam.position.distanceTo(sel.position);
    gizmo.scale.setScalar(Math.max(d * 0.2, 0.4));
    gTranslate.visible = gizmoMode === "translate";
    gRotate.visible    = gizmoMode === "rotate";
    gScale.visible     = gizmoMode === "scale";
  } else {
    gizmo.visible = false;
  }
}
