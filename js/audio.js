// audio.js — BGMと効果音 (再生モード中のみ鳴る)
// ブラウザの自動再生制限があるため、▶ボタンのクリックを起点に音を初期化する。
// 音源は assets/audio/ に置く (gitignore対象)。

const BASE = "assets/audio/";
export const SE_FILES = {
  none:    null,
  coin:    "Coins.wav",
  heart:   "heart.wav",
  key:     "key.wav",
  trap:    "trap.wav",
  falling: "falling.wav",
};
const BGM_FILE = "BGM.wav";

let ctx = null;                 // AudioContext (初回再生時に作る)
const buffers = new Map();      // ファイル名 -> AudioBuffer
let bgmSource = null;
let masterGain = null;
let bgmGain = null;
let enabled = true;

/* --- 音量設定 (0〜1) --- */
export const volume = { master: 0.8, bgm: 0.5 };

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { enabled = false; return null; }
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = volume.master;
  masterGain.connect(ctx.destination);
  bgmGain = ctx.createGain();
  bgmGain.gain.value = volume.bgm;
  bgmGain.connect(masterGain);
  return ctx;
}

async function loadBuffer(file) {
  if (!file) return null;
  if (buffers.has(file)) return buffers.get(file);
  try {
    const res = await fetch(BASE + file);
    if (!res.ok) return null;   // ファイルが無い環境では黙って無音
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    buffers.set(file, buf);
    return buf;
  } catch {
    return null;
  }
}

/* --- 再生モード開始: 音を初期化してBGMをループ再生 --- */
export async function audioPlayStart() {
  if (!enabled) return;
  if (!ensureContext()) return;
  if (ctx.state === "suspended") await ctx.resume();

  // 効果音を先読みしておく (初回の遅延を防ぐ)
  for (const f of Object.values(SE_FILES)) loadBuffer(f);

  const buf = await loadBuffer(BGM_FILE);
  if (!buf) return;
  stopBgm();
  bgmSource = ctx.createBufferSource();
  bgmSource.buffer = buf;
  bgmSource.loop = true;
  bgmSource.connect(bgmGain);
  bgmSource.start();
}

/* --- 再生モード停止 --- */
export function audioPlayStop() {
  stopBgm();
}
function stopBgm() {
  if (bgmSource) {
    try { bgmSource.stop(); } catch {}
    bgmSource.disconnect();
    bgmSource = null;
  }
}

/* --- 効果音を1回鳴らす (キー名 or ファイル名) --- */
export function playSE(key, gain = 1) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const file = SE_FILES[key] ?? key;
  const buf = buffers.get(file);
  if (!buf) { loadBuffer(file); return; }   // 未ロードなら次回から鳴る
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(masterGain);
  src.start();
}

/* --- 音量変更 (Inspector等から) --- */
export function setVolume(kind, v) {
  volume[kind] = v;
  if (kind === "master" && masterGain) masterGain.gain.value = v;
  if (kind === "bgm" && bgmGain) bgmGain.gain.value = v;
}
