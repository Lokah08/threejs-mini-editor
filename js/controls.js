// controls.js — オービットカメラ、クリック選択、ドラッグ移動
import * as THREE from "three";
import { renderer, editorCam, orbit, objects, app, select, selBox } from "./state.js";
import { hitGizmoHandle, beginGizmoDrag, applyGizmoDrag } from "./gizmo.js";
import { refreshInspector } from "./inspector.js";
import { snapshotTransform, pushTransform } from "./history.js";

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const canvas = renderer.domElement;
let drag = null;

function setNDC(e) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function castFromMouse(e) {
  setNDC(e);
  raycaster.setFromCamera(ndc, editorCam);
  return raycaster;
}
function pickObject(e) {
  castFromMouse(e);
  const hits = raycaster.intersectObjects(objects, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o.parent && !objects.includes(o)) o = o.parent;
  return objects.includes(o) ? o : null;
}

canvas.addEventListener("pointerdown", e => {
  if (app.viewMode !== "scene") return;
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 2 || (e.button === 0 && e.altKey)) {
    drag = { mode: "pan", x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;

  // ギズモのハンドルを最優先で判定
  if (app.selected) {
    castFromMouse(e);
    const ud = hitGizmoHandle(raycaster);
    if (ud) {
      drag = beginGizmoDrag(ud, e, raycaster);
      if (drag) {
        drag.histObj = app.selected;                     // Undo用: 開始時の状態
        drag.hist0 = snapshotTransform(app.selected);
      }
      return;
    }
  }

  const hit = pickObject(e);
  if (hit) {
    select(hit);
    // 本体ドラッグ移動: 通常はXZ平面 (床)、Shiftでカメラ向き縦平面 (Y移動)
    const plane = new THREE.Plane();
    if (e.shiftKey) {
      const n = new THREE.Vector3().subVectors(editorCam.position, hit.position);
      n.y = 0; n.normalize();
      plane.setFromNormalAndCoplanarPoint(n, hit.position);
    } else {
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hit.position);
    }
    castFromMouse(e);
    const start = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, start);
    drag = {
      mode: "move", obj: hit, plane,
      offset: start ? start.sub(hit.position) : new THREE.Vector3(),
      shift: e.shiftKey,
      histObj: hit, hist0: snapshotTransform(hit),       // Undo用: 開始時の状態
    };
  } else {
    drag = { mode: "orbit", x: e.clientX, y: e.clientY, moved: false };
  }
});

canvas.addEventListener("pointermove", e => {
  if (!drag || app.viewMode !== "scene") return;

  if (drag.mode === "orbit") {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    orbit.theta -= dx * 0.006;
    orbit.phi = THREE.MathUtils.clamp(orbit.phi - dy * 0.006, 0.05, Math.PI - 0.05);
    drag.x = e.clientX; drag.y = e.clientY;
    orbit.apply();
  }
  else if (drag.mode === "pan") {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const right = new THREE.Vector3().setFromMatrixColumn(editorCam.matrix, 0);
    const up    = new THREE.Vector3().setFromMatrixColumn(editorCam.matrix, 1);
    const k = orbit.dist * 0.0016;
    orbit.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    drag.x = e.clientX; drag.y = e.clientY;
    orbit.apply();
  }
  else if (drag.mode.startsWith("g")) {
    castFromMouse(e);
    applyGizmoDrag(drag, e, raycaster);
  }
  else if (drag.mode === "move") {
    castFromMouse(e);
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(drag.plane, p)) {
      p.sub(drag.offset);
      if (drag.shift) {
        drag.obj.position.y = p.y;      // Shift: 上下のみ
      } else {
        drag.obj.position.x = p.x;      // 通常: 床の上をスライド
        drag.obj.position.z = p.z;
      }
      selBox.setFromObject(drag.obj);
      refreshInspector();
    }
  }
});

canvas.addEventListener("pointerup", () => {
  if (drag && drag.mode === "orbit" && !drag.moved) select(null);  // 空クリックで選択解除
  if (drag && drag.histObj) pushTransform(drag.histObj, drag.hist0); // 変化があれば履歴に積む
  drag = null;
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("wheel", e => {
  if (app.viewMode !== "scene") return;
  e.preventDefault();
  orbit.dist = THREE.MathUtils.clamp(orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 1.5, 60);
  orbit.apply();
}, { passive: false });
