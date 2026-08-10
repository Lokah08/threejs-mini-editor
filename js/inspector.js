// inspector.js — Inspector パネルの表示と入力バインド
import * as THREE from "three";
import { app, camGizmo, gameCam, selBox, objects, ambientLight, sunLight, onSelect, notifySceneChanged } from "./state.js";
import { applyLightSettings, isLight } from "./lights.js";
import { pushCommand, pushDelete, snapshotTransform, pushTransform } from "./history.js";
import { COMPONENT_TYPES } from "./components.js";
import { applyTint } from "./io.js";

const inspEmpty    = document.getElementById("insp-empty");
const inspContent  = document.getElementById("insp-content");
const nameInput    = document.getElementById("obj-name");
const typeLabel    = document.getElementById("obj-type");
const colorInput   = document.getElementById("obj-color");
const fovInput     = document.getElementById("cam-fov");
const camPlaySelect = document.getElementById("cam-play");
const matSection   = document.getElementById("mat-section");
const camSection   = document.getElementById("cam-section");
const scaleSection = document.getElementById("scale-section");
const playerSection = document.getElementById("player-section");
const playerCheck  = document.getElementById("obj-player");
const speedInput   = document.getElementById("obj-speed");
const autoClipSelect = document.getElementById("obj-autoclip");
const playsetSection = document.getElementById("playset-section");
const hidePlayCheck  = document.getElementById("obj-hideplay");
const triggerCheck   = document.getElementById("obj-trigger");
const colliderSelect = document.getElementById("obj-collider");
const lightSection   = document.getElementById("light-section");
const lightColor     = document.getElementById("light-color");
const lightIntensity = document.getElementById("light-intensity");
const lightDistance  = document.getElementById("light-distance");
const lightAngle     = document.getElementById("light-angle");
const lightDistRow   = document.getElementById("light-dist-row");
const lightAngleRow  = document.getElementById("light-angle-row");
const envAmbient     = document.getElementById("env-ambient");
const envSun         = document.getElementById("env-sun");
const compSection    = document.getElementById("comp-section");
const compList       = document.getElementById("comp-list");
const compAddSelect  = document.getElementById("comp-add-select");
const compAddBtn     = document.getElementById("comp-add-btn");

// 追加メニューは登録簿から一度だけ生成
for (const [type, def] of Object.entries(COMPONENT_TYPES)) {
  compAddSelect.append(new Option(def.label, type));
}
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
  const light = isLight(obj);
  matSection.style.display    = (isCam || light) ? "none" : "";   // GLBはティント(色掛け)
  scaleSection.style.display  = (isCam || light) ? "none" : "";
  camSection.style.display    = isCam ? "" : "none";
  lightSection.style.display  = light ? "" : "none";
  playerSection.style.display  = (isCam || light) ? "none" : "";
  playsetSection.style.display = (isCam || light) ? "none" : "";
  compSection.style.display    = isCam ? "none" : "";   // ライトも回せる (Rotator等)
  if (light) {
    // Pointは広がり不要、Directionalは距離も広がりも不要
    const t = obj.userData.lightType;
    lightDistRow.style.display  = t === "directional" ? "none" : "";
    lightAngleRow.style.display = t === "spot" ? "" : "none";
  }
  typeLabel.textContent = isCam ? "Camera (Game View の視点)"
                        : light ? `Light: ${obj.userData.lightType}`
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
  if (sel === camGizmo) {
    fovInput.value = gameCam.fov;
    camPlaySelect.value = camGizmo.userData.playMode || "fixed";
    envAmbient.value = ambientLight.intensity;
    envSun.value = sunLight.intensity;
  }
  else if (isLight(sel)) {
    lightColor.value = sel.userData.lightColor;
    lightIntensity.value = sel.userData.intensity;
    lightDistance.value = sel.userData.distance;
    lightAngle.value = sel.userData.angle;
  }
  else if (sel.userData.kind === "glb") colorInput.value = sel.userData.tint || "#ffffff";
  else if (sel.material) colorInput.value = "#" + sel.material.color.getHexString();
  if (sel !== camGizmo) {
    playerCheck.checked = !!sel.userData.isPlayer;
    speedInput.value = sel.userData.moveSpeed ?? 2.5;
    // 自動再生クリップの選択肢を持っているクリップから作る
    const clips = sel.userData.clips || [];
    autoClipSelect.innerHTML = "";
    if (clips.length) {
      autoClipSelect.disabled = false;
      autoClipSelect.append(new Option("(なし)", ""));
      for (const c of clips) autoClipSelect.append(new Option(c.name, c.name));
      autoClipSelect.value = sel.userData.autoClip || "";
    } else {
      autoClipSelect.disabled = true;
      autoClipSelect.append(new Option("(クリップなし)", ""));
    }
    hidePlayCheck.checked = !!sel.userData.hideInPlay;
    triggerCheck.checked  = !!sel.userData.isTrigger;
    colliderSelect.value  = sel.userData.collider || "solid";
    renderComponents(sel);
  }
}

/* --- Componentsセクション: userData.components からUIを自動生成 --- */
function renderComponents(sel) {
  compList.innerHTML = "";
  const comps = sel.userData.components || [];
  comps.forEach((c, index) => {
    const def = COMPONENT_TYPES[c.type];
    if (!def) return;
    const box = document.createElement("div");
    box.className = "comp";
    const head = document.createElement("div");
    head.className = "chead";
    const cname = document.createElement("span");
    cname.className = "cname";
    cname.textContent = def.label;
    const del = document.createElement("button");
    del.className = "cdel";
    del.textContent = "✕";
    del.title = "コンポーネントを外す";
    del.addEventListener("click", () => removeComponent(sel, index));
    head.append(cname, del);
    box.appendChild(head);

    for (const [key, spec] of Object.entries(def.params)) {
      const row = document.createElement("div");
      row.className = "irow";
      const label = document.createElement("label");
      label.style.cssText = "width:auto;font-family:inherit";
      label.textContent = spec.label ?? key;
      let input;
      if (spec.type === "select") {
        input = document.createElement("select");
        for (const opt of spec.options) input.append(new Option(opt, opt));
        input.value = c[key] ?? spec.default;
      } else if (spec.type === "checkbox") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.style.cssText = "flex:0 0 auto;margin-left:auto";
        input.checked = c[key] ?? spec.default;
      } else {
        input = document.createElement("input");
        input.type = "number";
        input.step = "0.1";
        input.value = c[key] ?? spec.default;
      }
      input.addEventListener("change", () => {
        const before = c[key] ?? spec.default;
        const after = spec.type === "checkbox" ? input.checked
                    : spec.type === "number" ? (parseFloat(input.value) || spec.default)
                    : input.value;
        if (before === after) return;
        c[key] = after;
        pushCommand({
          undo: () => { c[key] = before; syncAfterEdit(sel); },
          redo: () => { c[key] = after;  syncAfterEdit(sel); },
        });
      });
      row.append(label, input);
      box.appendChild(row);
    }
    compList.appendChild(box);
  });
}

function removeComponent(sel, index) {
  const comps = sel.userData.components;
  const removed = comps[index];
  comps.splice(index, 1);
  pushCommand({
    undo: () => { comps.splice(index, 0, removed); syncAfterEdit(sel); },
    redo: () => { comps.splice(index, 1); syncAfterEdit(sel); },
  });
  renderComponents(sel);
}

compAddBtn.addEventListener("click", () => {
  const sel = app.selected;
  if (!sel || sel === camGizmo) return;
  const type = compAddSelect.value;
  if (!COMPONENT_TYPES[type]) return;
  if (!sel.userData.components) sel.userData.components = [];
  const comps = sel.userData.components;
  const entry = { type };   // パラメータは省略時デフォルト。編集したら値が入る
  comps.push(entry);
  pushCommand({
    undo: () => { comps.splice(comps.indexOf(entry), 1); syncAfterEdit(sel); },
    redo: () => { comps.push(entry); syncAfterEdit(sel); },
  });
  renderComponents(sel);
});

/* --- userDataのboolean設定をUndo対応で切り替える共通処理 --- */
function bindFlagCheckbox(input, key) {
  input.addEventListener("change", () => {
    const sel = app.selected;
    if (!sel || sel === camGizmo) return;
    const before = !!sel.userData[key];
    const after = input.checked;
    if (before === after) return;
    sel.userData[key] = after;
    pushCommand({
      undo: () => { sel.userData[key] = before; syncAfterEdit(sel); },
      redo: () => { sel.userData[key] = after;  syncAfterEdit(sel); },
    });
  });
}
bindFlagCheckbox(hidePlayCheck, "hideInPlay");
bindFlagCheckbox(triggerCheck, "isTrigger");

/* --- ライトの設定 (色・強さ・距離・広がり) --- */
function bindLightInput(input, key, isColor = false) {
  let pend = null;
  input.addEventListener("focus", () => {
    if (isLight(app.selected)) pend = { obj: app.selected, before: app.selected.userData[key] };
  });
  input.addEventListener("input", () => {
    const sel = app.selected;
    if (!isLight(sel)) return;
    if (isColor) {
      if (!pend || pend.obj !== sel) pend = { obj: sel, before: sel.userData[key] };
      sel.userData[key] = input.value;
    } else {
      const v = parseFloat(input.value);
      if (isNaN(v)) return;
      sel.userData[key] = v;
    }
    applyLightSettings(sel);
  });
  input.addEventListener("change", () => {
    if (pend && pend.obj === app.selected) {
      const { obj, before } = pend;
      const after = obj.userData[key];
      if (before !== after) pushCommand({
        undo: () => { obj.userData[key] = before; applyLightSettings(obj); syncAfterEdit(obj); },
        redo: () => { obj.userData[key] = after;  applyLightSettings(obj); syncAfterEdit(obj); },
      });
    }
    pend = null;
  });
}
bindLightInput(lightColor, "lightColor", true);
bindLightInput(lightIntensity, "intensity");
bindLightInput(lightDistance, "distance");
bindLightInput(lightAngle, "angle");

/* --- 環境光 (シーン全体のベース照明) --- */
function bindEnvInput(input, light) {
  let before = null;
  input.addEventListener("focus", () => { before = light.intensity; });
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v >= 0) light.intensity = v;
  });
  input.addEventListener("change", () => {
    const after = light.intensity;
    if (before !== null && before !== after) {
      const b = before;
      pushCommand({
        undo: () => { light.intensity = b;     syncAfterEdit(camGizmo); },
        redo: () => { light.intensity = after; syncAfterEdit(camGizmo); },
      });
    }
    before = null;
  });
}
bindEnvInput(envAmbient, ambientLight);
bindEnvInput(envSun, sunLight);

/* --- 当たり判定の種類 (実体 / 床のみ / なし) --- */
colliderSelect.addEventListener("change", () => {
  const sel = app.selected;
  if (!sel || sel === camGizmo) return;
  const before = sel.userData.collider || "solid";
  const after = colliderSelect.value;
  if (before === after) return;
  sel.userData.collider = after;
  pushCommand({
    undo: () => { sel.userData.collider = before; syncAfterEdit(sel); },
    redo: () => { sel.userData.collider = after;  syncAfterEdit(sel); },
  });
});

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
  if (!sel || sel === camGizmo) return;
  if (sel.userData.kind === "glb") {
    // GLBはティント: 全メッシュの元色に掛け算 (#ffffffで元通り)
    if (!pendColor || pendColor.obj !== sel) pendColor = { obj: sel, before: sel.userData.tint || "#ffffff", glb: true };
    applyTint(sel, colorInput.value);
  } else if (sel.material) {
    if (!pendColor || pendColor.obj !== sel) pendColor = { obj: sel, before: sel.material.color.getHex() };
    sel.material.color.set(colorInput.value);
  }
});
colorInput.addEventListener("change", () => {
  if (pendColor && pendColor.obj === app.selected) {
    const { obj, before, glb } = pendColor;
    if (glb) {
      const after = obj.userData.tint || "#ffffff";
      if (before !== after) pushCommand({
        undo: () => { applyTint(obj, before); syncAfterEdit(obj); },
        redo: () => { applyTint(obj, after);  syncAfterEdit(obj); },
      });
    } else {
      const after = obj.material.color.getHex();
      if (before !== after) pushCommand({
        undo: () => { obj.material.color.setHex(before); syncAfterEdit(obj); },
        redo: () => { obj.material.color.setHex(after);  syncAfterEdit(obj); },
      });
    }
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

/* --- 再生中のカメラ挙動 (固定 / 追従 / 注視) --- */
camPlaySelect.addEventListener("change", () => {
  const before = camGizmo.userData.playMode || "fixed";
  const after = camPlaySelect.value;
  if (before === after) return;
  camGizmo.userData.playMode = after;
  pushCommand({
    undo: () => { camGizmo.userData.playMode = before; syncAfterEdit(camGizmo); },
    redo: () => { camGizmo.userData.playMode = after;  syncAfterEdit(camGizmo); },
  });
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

/* --- 自動再生クリップ (再生モードでループ再生。バックダンサー用) --- */
autoClipSelect.addEventListener("change", () => {
  const sel = app.selected;
  if (!sel || sel === camGizmo) return;
  const before = sel.userData.autoClip || "";
  const after = autoClipSelect.value;
  if (before === after) return;
  sel.userData.autoClip = after;
  pushCommand({
    undo: () => { sel.userData.autoClip = before; syncAfterEdit(sel); },
    redo: () => { sel.userData.autoClip = after;  syncAfterEdit(sel); },
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
