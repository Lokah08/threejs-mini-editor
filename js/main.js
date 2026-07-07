// main.js — エントリポイント: 起動、メインループ、初期シーン
import * as THREE from "three";
import {
  wrap, renderer, scene, editorCam, gameCam,
  camGizmo, camHelper, grid, axes, selBox, app, select,
} from "./state.js";
import { addPrimitive, makeTexture } from "./primitives.js";
import { updateGizmoFrame } from "./gizmo.js";
import { updateOverlay } from "./ui.js";
import { pushAdd, pushCommand, pushDelete } from "./history.js";
import { importGLBFromBase64 } from "./io.js";
import { updatePlay } from "./play.js";
import "./inspector.js";
import "./controls.js";
import "./hierarchy.js";

/* ===== Assets: models / textures クリック ===== */
document.querySelectorAll("[data-add]").forEach(el => {
  el.addEventListener("click", () => {
    if (app.playing) return;   // 再生中は編集不可
    const mesh = addPrimitive(el.dataset.add);
    pushAdd(mesh);
    updateOverlay();
  });
});

function applyTexture(obj, kind) {
  if (obj.material.map) obj.material.map.dispose();
  obj.material.map = makeTexture(kind);
  obj.material.needsUpdate = true;
  obj.userData.texKind = kind;
}
document.querySelectorAll("[data-tex]").forEach(el => {
  el.addEventListener("click", () => {
    if (app.playing) return;   // 再生中は編集不可
    const sel = app.selected;
    if (!sel || sel === camGizmo || !sel.material) {
      alert("先に Scene View でメッシュを選択してください");
      return;
    }
    const kind = el.dataset.tex;
    const before = sel.userData.texKind;
    if (before === kind) return;
    applyTexture(sel, kind);
    pushCommand({
      undo: () => applyTexture(sel, before),
      redo: () => applyTexture(sel, kind),
    });
  });
});

/* ===== Ctrl+D: 選択オブジェクトを複製 ===== */
async function duplicateSelected() {
  const src = app.selected;
  if (!src || src === camGizmo) return;

  let copy;
  if (src.userData.kind === "glb") {
    // GLBは保持している元バイナリから再インポート
    copy = await importGLBFromBase64(src.userData.glbBase64, src.name + " (copy)");
    copy.position.copy(src.position);
    copy.quaternion.copy(src.quaternion);
    copy.scale.copy(src.scale);
  } else {
    copy = addPrimitive(src.userData.kind, {
      name: src.name + " (copy)",
      position: src.position.toArray(),
      rotation: src.rotation.toArray().slice(0, 3),
      scale: src.scale.toArray(),
      color: src.material.color.clone(),
      texKind: src.userData.texKind,
    });
  }
  copy.position.x += 0.4;   // 重ならないよう少しずらす
  copy.position.z += 0.4;
  select(copy);
  pushAdd(copy);
  updateOverlay();
}
window.addEventListener("keydown", e => {
  if (app.playing) return;   // 再生中は編集操作を無効化
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();   // ブラウザのブックマーク追加を抑止
    duplicateSelected();
  }
  // Delete: 選択オブジェクトを削除 (Undo可)
  if (e.key === "Delete" && app.selected && app.selected !== camGizmo) {
    pushDelete(app.selected);
    updateOverlay();
  }
});

/* ===== リサイズ ===== */
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h);
  editorCam.aspect = w / h; editorCam.updateProjectionMatrix();
  gameCam.aspect = w / h;   gameCam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

/* ===== メインループ ===== */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  updatePlay(clock.getDelta());   // 再生モード (WASD移動 + クリップ再生)

  // Main Camera ギズモの姿勢を gameCam に同期
  gameCam.position.copy(camGizmo.position);
  gameCam.rotation.copy(camGizmo.rotation);
  gameCam.updateMatrixWorld();
  camHelper.update();

  const isScene = app.viewMode === "scene";
  grid.visible = axes.visible = camHelper.visible = isScene;
  camGizmo.visible = isScene;
  selBox.visible = isScene && !!app.selected;
  if (app.selected) selBox.setFromObject(app.selected);

  updateGizmoFrame(isScene);

  renderer.render(scene, isScene ? editorCam : gameCam);
}
animate();

/* ===== 初期シーン ===== */
addPrimitive("plane",  { name: "Ground",    position: [0, 0, 0],      color: new THREE.Color(0x4a5560), texKind: "grid" });
addPrimitive("box",    { name: "Cube_01",   position: [-1.4, 0.7, 0] });
addPrimitive("sphere", { name: "Sphere_01", position: [0.6, 0.8, -0.8] });
addPrimitive("torus",  { name: "Torus_01",  position: [1.6, 0.9, 1.0], rotation: [Math.PI / 2.5, 0, 0] });
select(null);
updateOverlay();
