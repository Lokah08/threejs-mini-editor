// io.js — scene.json の保存/読込 と GLB のインポート/エクスポート
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { scene, objects, camGizmo, gameCam, ambientLight, sunLight, select, removeObject, notifySceneChanged } from "./state.js";
import { addLight, resetLightCounter } from "./lights.js";
import { addPrimitive, resetCounter } from "./primitives.js";
import { updateOverlay } from "./ui.js";
import { pushAdd, clearHistory } from "./history.js";
import { stopPlay } from "./play.js";

/* ============================================================
   scene.json
============================================================ */
export function sceneToJSON() {
  return JSON.stringify({
    meta: { app: "MiniEditor", version: 10 },   // v9: collider, v10: ライト / 環境光
    env: { ambient: ambientLight.intensity, sun: sunLight.intensity },
    camera: {
      name: camGizmo.name,
      position: camGizmo.position.toArray(),
      rotation: camGizmo.rotation.toArray().slice(0, 3),
      fov: gameCam.fov,
      playMode: camGizmo.userData.playMode || "fixed",
    },
    objects: objects.filter(o => o !== camGizmo).map(o => {
      const base = {
        name: o.name,
        kind: o.userData.kind,
        position: o.position.toArray(),
        rotation: o.rotation.toArray().slice(0, 3),
        scale: o.scale.toArray(),
      };
      if (o.userData.isPlayer) base.isPlayer = true;
      if (o.userData.moveSpeed) base.moveSpeed = o.userData.moveSpeed;
      if (o.userData.autoClip) base.autoClip = o.userData.autoClip;
      if (o.userData.hideInPlay) base.hideInPlay = true;
      if (o.userData.isTrigger) base.isTrigger = true;
      if (o.userData.components?.length) base.components = o.userData.components;   // v7
      if (o.userData.tint && o.userData.tint !== "#ffffff") base.tint = o.userData.tint;   // v8
      if (o.userData.collider && o.userData.collider !== "solid") base.collider = o.userData.collider;   // v9
      if (o.userData.kind === "light") {        // v10: ライト
        base.lightType = o.userData.lightType;
        base.lightColor = o.userData.lightColor;
        base.intensity = o.userData.intensity;
        base.distance = o.userData.distance;
        base.angle = o.userData.angle;
      } else if (o.userData.assetPath) {
        base.assetPath = o.userData.assetPath;   // v7: アセットはパス参照 (軽量)
      } else if (o.userData.kind === "glb") {
        base.glbBase64 = o.userData.glbBase64;   // 元のGLBを丸ごと埋め込む (クリップ含む)
      } else {
        base.color = "#" + o.material.color.getHexString();
        base.texture = o.userData.texKind;
      }
      return base;
    }),
  }, null, 2);
}

export async function loadJSON(text) {
  const data = JSON.parse(text);
  stopPlay();   // 再生中なら停止してから入れ替える
  // シーン丸ごと入れ替えなので履歴はリセット
  clearHistory();
  // 既存オブジェクトを全消去 (Main Camera 以外)
  for (const o of [...objects]) removeObject(o);
  select(null);
  resetCounter();
  resetLightCounter();
  if (data.env) {                                        // v10: 環境光
    ambientLight.intensity = data.env.ambient ?? 0.9;
    sunLight.intensity = data.env.sun ?? 1.2;
  }

  for (const d of (data.objects || [])) {
    let obj;
    if (d.kind === "light") {                            // v10: ライト
      obj = addLight(d.lightType || "point", {
        name: d.name, position: d.position, rotation: d.rotation,
        color: d.lightColor, intensity: d.intensity,
        distance: d.distance, angle: d.angle,
      });
    } else if (d.assetPath) {                            // v7: パス参照アセット
      obj = await importAssetGLB(d.assetPath, d.name);
      obj.position.fromArray(d.position);
      obj.rotation.fromArray([...d.rotation, "XYZ"]);
      obj.scale.fromArray(d.scale);
    } else if (d.kind === "glb" && d.glbBase64) {
      obj = await importGLBFromBase64(d.glbBase64, d.name);
      obj.position.fromArray(d.position);
      obj.rotation.fromArray([...d.rotation, "XYZ"]);
      obj.scale.fromArray(d.scale);
    } else {
      obj = addPrimitive(d.kind, {
        name: d.name, position: d.position, rotation: d.rotation,
        scale: d.scale, color: new THREE.Color(d.color), texKind: d.texture,
      });
    }
    if (d.isPlayer) obj.userData.isPlayer = true;      // v3
    if (d.moveSpeed) obj.userData.moveSpeed = d.moveSpeed;
    if (d.autoClip) obj.userData.autoClip = d.autoClip;   // v5
    if (d.hideInPlay) obj.userData.hideInPlay = true;     // v6
    if (d.isTrigger) obj.userData.isTrigger = true;       // v6
    if (d.components) obj.userData.components = d.components;   // v7
    if (d.tint) applyTint(obj, d.tint);                          // v8
    if (d.collider) obj.userData.collider = d.collider;          // v9
  }
  if (data.camera) {
    camGizmo.position.fromArray(data.camera.position);
    camGizmo.rotation.fromArray([...data.camera.rotation, "XYZ"]);
    gameCam.fov = data.camera.fov || 60;
    gameCam.updateProjectionMatrix();
    camGizmo.userData.playMode = data.camera.playMode || "fixed";   // v4
  }
  select(null);
  updateOverlay();
}

/* ============================================================
   GLB インポート
============================================================ */
const loader = new GLTFLoader();

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function parseGLB(arrayBuffer) {
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, "", gltf => resolve(gltf), err => reject(err));
  });
}

export async function importGLB(arrayBuffer, name) {
  const obj = await importGLBFromBuffer(arrayBuffer, name);
  select(obj);
  pushAdd(obj);   // Ctrl+Zでインポートを取り消せる
  updateOverlay();
  return obj;
}

async function importGLBFromBuffer(arrayBuffer, name) {
  const gltf = await parseGLB(arrayBuffer);
  const root = gltf.scene;
  root.name = name || "Model";
  root.userData.kind = "glb";
  root.userData.glbBase64 = bufferToBase64(arrayBuffer);
  root.userData.clips = gltf.animations || [];   // 同梱アニメーション (再生モードで使用)
  scene.add(root);
  objects.push(root);
  notifySceneChanged();
  return root;
}
export async function importGLBFromBase64(b64, name) {
  return importGLBFromBuffer(base64ToBuffer(b64), name);
}

/* --- GLBモデルのティント (全メッシュの元色に指定色を掛ける。#ffffffで元通り) --- */
const _tintColor = new THREE.Color();
export function applyTint(root, hex) {
  _tintColor.set(hex);
  root.traverse(m => {
    if (m.isMesh && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat.userData.origColor) mat.userData.origColor = mat.color.clone();
        mat.color.copy(mat.userData.origColor).multiply(_tintColor);
      }
    }
  });
  root.userData.tint = hex;
}

/* --- assets/ フォルダのGLBをパス参照でインポート (scene.jsonにはパスだけ保存) --- */
const assetCache = new Map();   // path -> ArrayBuffer

export async function importAssetGLB(path, name) {
  let buf = assetCache.get(path);
  if (!buf) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`アセットを読み込めません: ${path}`);
    buf = await res.arrayBuffer();
    assetCache.set(path, buf);
  }
  const gltf = await parseGLB(buf.slice(0));
  const root = gltf.scene;
  root.name = name || path.split("/").pop().replace(/\.glb$/i, "");
  root.userData.kind = "glb";
  root.userData.assetPath = path;   // Base64の代わりにパス参照
  root.userData.clips = gltf.animations || [];
  scene.add(root);
  objects.push(root);
  notifySceneChanged();
  return root;
}

/* ============================================================
   GLB エクスポート (エディタ専用ヘルパーとカメラ本体は除外)
============================================================ */
export function exportGLB() {
  const exporter = new GLTFExporter();
  const targets = objects.filter(o => o !== camGizmo);
  if (!targets.length) { alert("書き出すオブジェクトがありません"); return; }
  exporter.parse(
    targets,
    result => {
      const blob = new Blob([result], { type: "model/gltf-binary" });
      downloadBlob(blob, "scene.glb");
    },
    err => alert("GLB書き出しに失敗: " + err),
    { binary: true }
  );
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   UI 配線: モーダル / ファイル選択 / ドラッグ&ドロップ
============================================================ */
const modal = document.getElementById("modal");
const area  = document.getElementById("json-area");
const jmsg  = document.getElementById("json-msg");
const jsonFileInput = document.getElementById("json-file");
const glbFileInput  = document.getElementById("glb-file");

document.getElementById("open-scene-json").addEventListener("click", () => {
  area.value = sceneToJSON();
  jmsg.textContent = "現在のシーンの状態です。編集して読み込むこともできます。";
  modal.classList.add("show");
});
document.getElementById("json-close").addEventListener("click", () => modal.classList.remove("show"));
document.getElementById("json-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(area.value); }
  catch { area.select(); document.execCommand("copy"); }
  jmsg.textContent = "コピーしました。";
});
document.getElementById("json-download").addEventListener("click", () => {
  downloadBlob(new Blob([area.value], { type: "application/json" }), "scene.json");
  jmsg.textContent = "scene.json をダウンロードしました。";
});
document.getElementById("json-load").addEventListener("click", async () => {
  try {
    await loadJSON(area.value);
    jmsg.textContent = "読み込みました。";
    modal.classList.remove("show");
  } catch (err) {
    jmsg.textContent = "JSONエラー: " + err.message;
  }
});

/* --- scene.json をファイルから開く --- */
document.getElementById("json-open-file").addEventListener("click", () => jsonFileInput.click());
jsonFileInput.addEventListener("change", async () => {
  const file = jsonFileInput.files[0];
  if (!file) return;
  await loadJSONFile(file);
  jsonFileInput.value = "";
});
async function loadJSONFile(file) {
  try {
    const text = await file.text();
    await loadJSON(text);
    area.value = text;
    jmsg.textContent = `「${file.name}」を読み込みました。`;
    modal.classList.remove("show");
  } catch (err) {
    try { area.value = await file.text(); } catch {}
    jmsg.textContent = `「${file.name}」の読み込みに失敗: ${err.message}`;
    modal.classList.add("show");
  }
}

/* --- GLB をファイルから開く --- */
document.getElementById("glb-import").addEventListener("click", () => glbFileInput.click());
glbFileInput.addEventListener("change", async () => {
  const file = glbFileInput.files[0];
  if (!file) return;
  await loadGLBFile(file);
  glbFileInput.value = "";
});
async function loadGLBFile(file) {
  try {
    const buf = await file.arrayBuffer();
    await importGLB(buf, file.name.replace(/\.(glb|gltf)$/i, ""));
  } catch (err) {
    alert(`「${file.name}」の読み込みに失敗: ${err.message}`);
  }
}

/* --- GLB 書き出し --- */
document.getElementById("glb-export").addEventListener("click", exportGLB);

/* --- ドラッグ&ドロップ (画面のどこに落としてもOK) --- */
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (/\.json$/i.test(file.name))            loadJSONFile(file);
  else if (/\.(glb|gltf)$/i.test(file.name)) loadGLBFile(file);
  else alert("scene.json または .glb ファイルをドロップしてください");
});
