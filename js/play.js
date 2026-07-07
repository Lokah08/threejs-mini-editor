// play.js — 再生モード: プレイヤー操作 (WASD/Space) とアニメーションクリップ再生
// ▶ で開始、■ / Esc で停止。停止時は再生前のポーズ・位置に完全復帰する。
import * as THREE from "three";
import { objects, app, select } from "./state.js";
import { setViewMode, updateOverlay } from "./ui.js";

const btn = document.getElementById("btn-play");
const SPEED_DEFAULT = 2.5;

const state = {
  player: null, mixer: null,
  walk: null, idle: null, current: null,
  snapshot: null, groundY: 0,
  keys: {}, vy: 0, grounded: true,
};

/* --- ポーズの保存/復元 (再生中の変更をシーンに残さない) --- */
function snapshotPose(root) {
  const list = [];
  root.traverse(o => list.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  return list;
}
function restorePose(list) {
  for (const [o, p, q, s] of list) {
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
}

/* --- クリップのクロスフェード --- */
function fade(next) {
  if (state.current === next) return;
  if (next) next.reset().fadeIn(0.15).play();
  if (state.current) state.current.fadeOut(0.15);
  state.current = next;
}

export function startPlay() {
  const player = objects.find(o => o.userData.isPlayer);
  if (!player) {
    alert("プレイヤーが設定されていません。\nオブジェクトを選択して、Inspector の「プレイヤーとして操作」にチェックを入れてください。");
    return;
  }
  state.player = player;
  state.snapshot = snapshotPose(player);
  state.groundY = player.position.y;
  state.keys = {}; state.vy = 0; state.grounded = true;

  const clips = player.userData.clips || [];
  if (clips.length) {
    state.mixer = new THREE.AnimationMixer(player);
    const walkClip = THREE.AnimationClip.findByName(clips, "walk") || clips[0];
    const idleClip = THREE.AnimationClip.findByName(clips, "idle");
    state.walk = state.mixer.clipAction(walkClip);
    state.idle = idleClip ? state.mixer.clipAction(idleClip) : null;
    state.current = null;
    fade(state.idle);
  }

  select(null);
  app.playing = true;
  btn.textContent = "■ 停止";
  btn.classList.add("playing");
  setViewMode("game");
}

export function stopPlay() {
  if (!app.playing) return;
  if (state.mixer) state.mixer.stopAllAction();
  if (state.snapshot) restorePose(state.snapshot);
  state.mixer = null; state.walk = null; state.idle = null; state.current = null;
  state.player = null; state.snapshot = null;
  app.playing = false;
  btn.textContent = "▶ 再生";
  btn.classList.remove("playing");
  setViewMode("scene");
}

/* --- 毎フレーム更新 (main.js のループから呼ぶ) --- */
export function updatePlay(dt) {
  if (!app.playing || !state.player) return;
  const p = state.player;
  const k = state.keys;

  let dx = 0, dz = 0;
  if (k["w"] || k["arrowup"])    dz -= 1;
  if (k["s"] || k["arrowdown"])  dz += 1;
  if (k["a"] || k["arrowleft"])  dx -= 1;
  if (k["d"] || k["arrowright"]) dx += 1;
  const moving = dx !== 0 || dz !== 0;

  if (moving) {
    const len = Math.hypot(dx, dz);
    const sp = p.userData.moveSpeed || SPEED_DEFAULT;
    p.position.x += (dx / len) * sp * dt;
    p.position.z += (dz / len) * sp * dt;
    p.rotation.y = Math.atan2(dx, dz);
  }

  // ジャンプ (Space)
  if (k[" "] && state.grounded) { state.vy = 4.5; state.grounded = false; }
  if (!state.grounded) {
    p.position.y += state.vy * dt;
    state.vy -= 12 * dt;
    if (p.position.y <= state.groundY) {
      p.position.y = state.groundY;
      state.vy = 0;
      state.grounded = true;
    }
  }

  if (state.mixer) {
    fade(moving ? state.walk : state.idle);
    state.mixer.update(dt);
  }
}

/* --- 入力 --- */
window.addEventListener("keydown", e => {
  if (!app.playing) return;
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  state.keys[e.key.toLowerCase()] = true;
  if (e.key === " ") e.preventDefault();   // ページスクロール抑止
  if (e.key === "Escape") stopPlay();
});
window.addEventListener("keyup", e => { state.keys[e.key.toLowerCase()] = false; });

btn.addEventListener("click", () => (app.playing ? stopPlay() : startPlay()));
