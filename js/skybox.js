// skybox.js — 背景のスカイボックス (等距円筒パノラマ画像を scene.background に貼る)
// 候補は assets/index.json の "skyboxes" 配列 (パスの一覧) から取る。
// 現在の選択は skyState.path (null = 単色背景) に持ち、scene.json の env.skybox に保存される (v12)。
import * as THREE from "three";
import { scene } from "./state.js";

const BASE_COLOR = new THREE.Color(0x141518);   // 単色背景 (state.js の初期値と同じ)
export const skyState = { path: null };
export const skyboxOptions = [];                // { name, path } の一覧 (目録から)

const cache = new Map();                        // path -> Texture (読み込み済み)
const loader = new THREE.TextureLoader();
let requestId = 0;                              // 連打時に古い読み込み結果を捨てる

const listeners = [];
export function onSkyboxOptionsLoaded(fn) { listeners.push(fn); }

function nameOf(path) {
  return path.split("/").pop().replace(/\.(png|jpe?g|webp)$/i, "");
}

async function loadTexture(path) {
  if (cache.has(path)) return cache.get(path);
  const tex = await loader.loadAsync(path);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(path, tex);
  return tex;
}

// 背景を切り替える。path が null なら単色に戻す。読み込み失敗時は単色のまま例外を投げる
export async function setSkybox(path) {
  skyState.path = path || null;
  const id = ++requestId;
  if (!path) {
    scene.background = BASE_COLOR;
    return;
  }
  const tex = await loadTexture(path);
  if (id !== requestId) return;   // その間に別の指定が来た
  scene.background = tex;
}

// 目録から候補を読む (assets フォルダが無い環境では空のまま)
async function loadOptions() {
  try {
    const res = await fetch("assets/index.json", { cache: "no-cache" });   // 目録を編集したらすぐ反映
    if (!res.ok) return;
    const manifest = await res.json();
    for (const path of (manifest.skyboxes || [])) {
      skyboxOptions.push({ name: nameOf(path), path });
    }
  } catch {
    /* 目録なし */
  } finally {
    for (const fn of listeners) fn(skyboxOptions);
  }
}
loadOptions();
