// io.js — scene.json の保存/読込 と GLB のインポート/エクスポート
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { scene, objects, camGizmo, gameCam, select, removeObject, notifySceneChanged } from "./state.js";
import { addPrimitive, resetCounter } from "./primitives.js";
import { updateOverlay } from "./ui.js";
import { pushAdd, clearHistory } from "./history.js";

/* ============================================================
   scene.json
============================================================ */
export function sceneToJSON() {
  return JSON.stringify({
    meta: { app: "MiniEditor", version: 2 },
    camera: {
      name: camGizmo.name,
      position: camGizmo.position.toArray(),
      rotation: camGizmo.rotation.toArray().slice(0, 3),
      fov: gameCam.fov,
    },
    objects: objects.filter(o => o !== camGizmo).map(o => {
      const base = {
        name: o.name,
        kind: o.userData.kind,
        position: o.position.toArray(),
        rotation: o.rotation.toArray().slice(0, 3),
        scale: o.scale.toArray(),
      };
      if (o.userData.kind === "glb") {
        base.glbBase64 = o.userData.glbBase64;   // 元のGLBを丸ごと埋め込む
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
  // シーン丸ごと入れ替えなので履歴はリセット
  clearHistory();
  // 既存オブジェクトを全消去 (Main Camera 以外)
  for (const o of [...objects]) removeObject(o);
  select(null);
  resetCounter();

  for (const d of (data.objects || [])) {
    if (d.kind === "glb" && d.glbBase64) {
      const obj = await importGLBFromBase64(d.glbBase64, d.name);
      obj.position.fromArray(d.position);
      obj.rotation.fromArray([...d.rotation, "XYZ"]);
      obj.scale.fromArray(d.scale);
    } else {
      addPrimitive(d.kind, {
        name: d.name, position: d.position, rotation: d.rotation,
        scale: d.scale, color: new THREE.Color(d.color), texKind: d.texture,
      });
    }
  }
  if (data.camera) {
    camGizmo.position.fromArray(data.camera.position);
    camGizmo.rotation.fromArray([...data.camera.rotation, "XYZ"]);
    gameCam.fov = data.camera.fov || 60;
    gameCam.updateProjectionMatrix();
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
  scene.add(root);
  objects.push(root);
  notifySceneChanged();
  return root;
}
export async function importGLBFromBase64(b64, name) {
  return importGLBFromBuffer(base64ToBuffer(b64), name);
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
