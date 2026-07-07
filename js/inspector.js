// inspector.js — Inspector パネルの表示と入力バインド
import * as THREE from "three";
import { app, camGizmo, gameCam, selBox, objects, onSelect, notifySceneChanged } from "./state.js";
import { pushCommand, pushDelete, snapshotTransform, pushTransform } from "./history.js";

const inspEmpty    = document.getElementById("insp-empty");
const inspContent  = document.getElementById("insp-content");
const nameInput    = document.getElementById("obj-name");
const typeLabel    = document.getElementById("obj-type");
const colorInput   = document.getElementById("obj-color");
const fovInput     = document.getElementById("cam-fov");
const matSection   = document.getElementById("mat-section");
const camSection   = document.getElementById("cam-section");
const scaleSection = document.getElementById("scale-section");
const playerSection = document.getElementById("player-section");
const playerCheck  = document.getElementById("obj-player");
const speedInput   = document.getElementById("obj-speed");
const clipsLabel   = document.getElementById("obj-clips");
const bindInputs   = [...document.querySelectorAll("[data-bind]")];

const KIND_LABELS = { glb: "Imported Model (GLB)" };

onSelect(obj => {
  if (!obj) {
    inspEmpty.style.display = "";
    inspContent.style.display = "none";
    return;
  }
  inspEmpty.style.display = "none";
  inspContent.style.display = "";
  const isCam = obj === camGizmo;
  const isGlb = obj.userData.kind === "glb";
  matSection.style.display    = (isCam || isGlb) ? "none" : "";
  scaleSection.style.display  = isCam ? "none" : "";
  camSection.style.display    = isCam ? "" : "none";
  playerSection.style.display = isCam ? "none" : "";
  typeLabel.textContent = isCam ? "Camera (Game View の視点)"
                        : KIND_LABELS[obj.userData.kind] ?? `Mesh: ${obj.userData.kind}`;
  refreshInspector();
});

export function refreshInspector() {
  const sel = app.selected;
  if (!sel) return;
  nameInput.value = sel.name;
  for (const inp of bindInputs) {
    const [prop, ax] = inp.dataset.bind.split(".");
    let v = sel[prop][ax];
    if (prop === "rotation") v = THREE.MathUtils.radToDeg(v);
    inp.value = Math.round(v * 100) / 100;
  }
  if (sel === camGizmo) fovInput.value = gameCam.fov;
  else if (sel.material) colorInput.value = "#" + sel.material.color.getHexString();
  if (sel !== camGizmo) {
    playerCheck.checked = !!sel.userData.isPlayer;
    speedInput.value = sel.userData.moveSpeed ?? 2.5;
    const clips = sel.userData.clips || [];
    clipsLabel.textContent = "クリップ: " + (clips.length ? clips.map(c => c.name).join(", ") : "なし");
  }
}

/* --- 名前 (focusで控えて、changeで履歴に積む) --- */
let pendName = null;
nameInput.addEventListener("focus", () => {
  if (app.selected) pendName = { obj: app.selected, before: app.selected.name };
});
nameInput.addEventListener("input", () => {
  if (!app.selected) return;
  app.selected.name = nameInput.value;
  notifySceneChanged();                 // Hierarchyの表示名を追従させる
});
nameInput.addEventListener("change", () => {
  if (pendName && pendName.obj === app.selected && pendName.before !== pendName.obj.name) {
    const { obj, before } = pendName;
    const after = obj.name;
    pushCommand({
      undo: () => { obj.name = before; syncAfterEdit(obj); },
      redo: () => { obj.name = after;  syncAfterEdit(obj); },
    });
  }
  pendName = null;
});

/* --- 色 (最初のinputで控えて、changeで履歴に積む) --- */
let pendColor = null;
colorInput.addEventListener("input", () => {
  const sel = app.selected;
  if (!sel || sel === camGizmo || !sel.material) return;
  if (!pendColor || pendColor.obj !== sel) pendColor = { obj: sel, before: sel.material.color.getHex() };
  sel.material.color.set(colorInput.value);
});
colorInput.addEventListener("change", () => {
  if (pendColor && pendColor.obj === app.selected) {
    const { obj, before } = pendColor;
    const after = obj.material.color.getHex();
    if (before !== after) pushCommand({
      undo: () => { obj.material.color.setHex(before); syncAfterEdit(obj); },
      redo: () => { obj.material.color.setHex(after);  syncAfterEdit(obj); },
    });
  }
  pendColor = null;
});

/* --- FOV --- */
let pendFov = null;
fovInput.addEventListener("focus", () => { pendFov = gameCam.fov; });
fovInput.addEventListener("input", () => {
  gameCam.fov = parseFloat(fovInput.value) || 60;
  gameCam.updateProjectionMatrix();
});
fovInput.addEventListener("change", () => {
  const before = pendFov, after = gameCam.fov;
  if (before !== null && before !== after) pushCommand({
    undo: () => { gameCam.fov = before; gameCam.updateProjectionMatrix(); syncAfterEdit(camGizmo); },
    redo: () => { gameCam.fov = after;  gameCam.updateProjectionMatrix(); syncAfterEdit(camGizmo); },
  });
  pendFov = null;
});

/* --- Transform数値入力 (focusで控えて、changeで履歴に積む) --- */
let pendT = null;
for (const inp of bindInputs) {
  inp.addEventListener("focus", () => {
    if (app.selected) pendT = { obj: app.selected, t: snapshotTransform(app.selected) };
  });
  inp.addEventListener("input", () => {
    const sel = app.selected;
    if (!sel) return;
    const [prop, ax] = inp.dataset.bind.split(".");
    let v = parseFloat(inp.value);
    if (isNaN(v)) return;
    if (prop === "rotation") v = THREE.MathUtils.degToRad(v);
    sel[prop][ax] = v;
    selBox.setFromObject(sel);
  });
  inp.addEventListener("change", () => {
    if (pendT && pendT.obj === app.selected) pushTransform(pendT.obj, pendT.t);
    pendT = null;
  });
}

/* --- プレイヤー指定 (シーンに1体だけ。既存プレイヤーは自動解除) --- */
playerCheck.addEventListener("change", () => {
  const sel = app.selected;
  if (!sel || sel === camGizmo) return;
  const on = playerCheck.checked;
  const prev = objects.find(o => o.userData.isPlayer && o !== sel) || null;
  const apply = () => {
    if (on && prev) prev.userData.isPlayer = false;
    sel.userData.isPlayer = on;
  };
  const revert = () => {
    sel.userData.isPlayer = !on;
    if (on && prev) prev.userData.isPlayer = true;
  };
  apply();
  pushCommand({
    undo: () => { revert(); syncAfterEdit(sel); },
    redo: () => { apply();  syncAfterEdit(sel); },
  });
});

/* --- 移動速度 --- */
let pendSpeed = null;
speedInput.addEventListener("focus", () => {
  if (app.selected) pendSpeed = { obj: app.selected, before: app.selected.userData.moveSpeed ?? 2.5 };
});
speedInput.addEventListener("input", () => {
  const sel = app.selected;
  if (!sel) return;
  const v = parseFloat(speedInput.value);
  if (!isNaN(v) && v > 0) sel.userData.moveSpeed = v;
});
speedInput.addEventListener("change", () => {
  if (pendSpeed && pendSpeed.obj === app.selected) {
    const { obj, before } = pendSpeed;
    const after = obj.userData.moveSpeed ?? 2.5;
    if (before !== after) pushCommand({
      undo: () => { obj.userData.moveSpeed = before; syncAfterEdit(obj); },
      redo: () => { obj.userData.moveSpeed = after;  syncAfterEdit(obj); },
    });
  }
  pendSpeed = null;
});

// Undo/Redo後にInspector表示を最新化する
function syncAfterEdit(obj) {
  if (app.selected === obj) refreshInspector();
  notifySceneChanged();
}

document.getElementById("btn-delete").addEventListener("click", () => {
  const sel = app.selected;
  if (!sel) return;
  if (sel === camGizmo) { alert("Main Camera は削除できません"); return; }
  pushDelete(sel);   // 削除実行 + 履歴に積む (Ctrl+Zで戻せる)
});
