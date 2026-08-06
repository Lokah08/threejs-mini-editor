// play.js — 再生モード: プレイヤー操作 (WASD/Space) とアニメーションクリップ再生
// ▶ で開始、■ / Esc で停止。停止時は再生前のポーズ・位置に完全復帰する。
import * as THREE from "three";
import { objects, app, camGizmo, select } from "./state.js";
import { setViewMode, updateOverlay } from "./ui.js";
import {
  compPlayStart, compUpdate, compPlayStop,
  hasMovementComponent, hasTouchableComponent, compCollectibleCount,
} from "./components.js";

const btn = document.getElementById("btn-play");
const SPEED_DEFAULT = 2.5;
const STEP = 0.35;        // この高さ以下の段差 (床タイル等) は乗り越えられる
const STEP_WALK = 0.7;    // コライダー「床のみ」(階段/スロープ) の段差許容

const state = {
  player: null, mixer: null,
  walk: null, idle: null, current: null,
  snapshot: null, camSnapshot: null, camOffset: null,
  groundY: 0, footOff: 0,
  keys: {}, vy: 0, grounded: true,
  extras: [],      // 自動再生クリップを持つ非プレイヤーの { mixer, snapshot }
  obstacles: [],   // 当たり判定用のAABB (メッシュ単位のBox3)
  colR: 0.2, colH: 1.5,   // プレイヤーの当たり判定の半径と身長
  hidden: [],      // 再生中に非表示にしたオブジェクト (停止時に戻す)
  triggers: [],    // トリガーゾーン { box, name, inside }
  compSnapshots: [],   // コンポーネント持ちオブジェクトのポーズ (停止時に復元)
  dynamicObs: [],      // 動くオブジェクトのAABB { mesh, box } (毎フレーム更新)
  startPos: null,      // リスポーン地点 (再生開始時のプレイヤー位置)
  collected: 0, collectTotal: 0,
  ride: null,          // 乗っている動く床 { obj, local } (床と一緒に動く)
  cleared: false,      // ゴール到達 (以降は操作を受け付けない)
};

/* --- トリガー通過などのお知らせ表示 --- */
const toast = document.createElement("div");
toast.style.cssText = "position:absolute;top:44px;left:50%;transform:translateX(-50%);" +
  "background:rgba(20,25,40,.88);color:#ffd166;border:1px solid rgba(255,209,102,.4);" +
  "padding:8px 18px;border-radius:8px;font-size:14px;display:none;z-index:5;pointer-events:none;";
document.getElementById("canvas-wrap").appendChild(toast);
let toastTimer = 0;
function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = "none"; }, 2000);
}

/* --- クリア演出 (画面中央の大きなバナー) --- */
const clearBanner = document.createElement("div");
clearBanner.style.cssText = "position:absolute;inset:0;display:none;z-index:6;" +
  "align-items:center;justify-content:center;flex-direction:column;gap:10px;" +
  "pointer-events:none;background:radial-gradient(circle,rgba(255,209,102,.12),transparent 60%);";
clearBanner.innerHTML =
  `<div style="font-size:44px;font-weight:700;color:#ffd166;text-shadow:0 2px 18px rgba(255,209,102,.6);letter-spacing:2px">STAGE CLEAR!</div>` +
  `<div id="clear-sub" style="font-size:15px;color:#e8eaee"></div>` +
  `<div style="font-size:12px;color:#9aa3ad;margin-top:6px">Esc か ■ で編集に戻る</div>`;
document.getElementById("canvas-wrap").appendChild(clearBanner);
function showClear() {
  if (state.cleared) return;
  state.cleared = true;
  clearBanner.querySelector("#clear-sub").textContent =
    state.collectTotal > 0 ? `💎 ${state.collected} / ${state.collectTotal}` : "";
  clearBanner.style.display = "flex";
  toast.style.display = "none";
}

// カメラ更新用のテンポラリ (毎フレームのnew回避)
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

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

/* --- 当たり判定: プレイヤーの箱 (x,y,z に居るとして) が障害物と重なるか --- */
function collides(x, y, z) {
  const minX = x - state.colR, maxX = x + state.colR;
  const minZ = z - state.colR, maxZ = z + state.colR;
  const bottom = y + STEP, top = y + state.colH;   // 低い段差は足元扱いで無視
  for (const e of state.obstacles) {
    if (e.walkable) continue;   // 「床のみ」は横方向には当たらない (階段/スロープ)
    const b = e.box;
    if (maxX <= b.min.x || minX >= b.max.x) continue;
    if (maxZ <= b.min.z || minZ >= b.max.z) continue;
    if (b.max.y <= bottom || b.min.y >= top) continue;   // 段差以下 or 頭上
    return true;
  }
  return false;
}

/* --- 足元の支持面をレイキャストで求める (円形の床の縁も実形状どおりに判定) ---
   戻り値 { y, mesh }: 支持面が無ければ y = -Infinity (奈落) */
const _rayOrigin = new THREE.Vector3();
const _rayDown = new THREE.Vector3(0, -1, 0);
const _raycaster = new THREE.Raycaster();
function supportAt(x, z, y) {
  _rayOrigin.set(x, y + STEP_WALK, z);   // 一番高い許容段差から真下を見る
  let best = -Infinity, bestMesh = null;
  for (const e of state.obstacles) {
    const b = e.box;
    if (x <= b.min.x || x >= b.max.x) continue;   // 中心点で候補を絞る
    if (z <= b.min.z || z >= b.max.z) continue;
    const step = e.walkable ? STEP_WALK : STEP;   // 「床のみ」は段差を大きめに許容
    if (b.min.y > y + step) continue;
    _raycaster.set(_rayOrigin, _rayDown);
    const hits = _raycaster.intersectObject(e.mesh, false);
    if (hits.length) {
      const hy = _rayOrigin.y - hits[0].distance;
      if (hy <= y + step && hy > best) { best = hy; bestMesh = e.mesh; }
    }
  }
  return { y: best, mesh: bestMesh };
}

// メッシュから objects 配列上のルートオブジェクトを辿る (動く床の乗車判定用)
function rootOf(m) {
  let o = m;
  while (o && !objects.includes(o)) o = o.parent;
  return o;
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
  state.camSnapshot = snapshotPose(camGizmo);   // カメラも停止時に復元する
  state.camOffset = camGizmo.position.clone().sub(player.position);   // 追従用: 開始時の構図
  state.keys = {}; state.vy = 0; state.grounded = true;

  // 当たり判定の準備: プレイヤーの寸法と、障害物のAABB一覧 (メッシュ単位)
  const pbox = new THREE.Box3().setFromObject(player);
  state.colH = Math.max(pbox.max.y - pbox.min.y, 0.2);
  state.colR = Math.max(Math.min(pbox.max.x - pbox.min.x, pbox.max.z - pbox.min.z) * 0.4, 0.1);
  state.footOff = player.position.y - pbox.min.y;    // 原点から足元までの距離 (Cube等は中心原点)
  state.groundY = player.position.y - state.footOff; // 開始時の足元の高さ (KillZ基準)
  state.obstacles = [];
  state.triggers = [];
  state.hidden = [];
  state.dynamicObs = [];
  for (const o of objects) {
    if (o === player || o === camGizmo) continue;
    o.updateWorldMatrix(true, true);
    if (o.userData.isTrigger) {
      // トリガー: 当たり判定なし・再生中非表示・通過を検知
      const b = new THREE.Box3().setFromObject(o);
      if (!b.isEmpty()) state.triggers.push({ box: b, name: o.name, inside: false });
    } else if (hasTouchableComponent(o) || o.userData.collider === "none") {
      // Collectible / Trap / コライダー「なし」は当たり判定を作らない (すり抜け)
    } else {
      const dynamic = hasMovementComponent(o);   // Rotator/Mover持ちはAABBを毎フレーム更新
      const walkable = o.userData.collider === "walkable";   // 床のみ (階段/スロープ)
      o.traverse(m => {
        if (m.isMesh) {
          const b = new THREE.Box3().setFromObject(m);
          if (!b.isEmpty()) {
            const entry = { mesh: m, box: b, walkable };
            state.obstacles.push(entry);
            if (dynamic) state.dynamicObs.push(entry);
          }
        }
      });
    }
    if ((o.userData.hideInPlay || o.userData.isTrigger) && o.visible) {
      o.visible = false;   // 見えない壁 / トリガーは再生中は姿を消す
      state.hidden.push(o);
    }
  }

  // コンポーネント起動 + 対象オブジェクトのポーズ保存 + リスポーン地点
  state.startPos = player.position.clone();
  const compObjs = [...new Set(compPlayStart(objects, player))];
  state.compSnapshots = compObjs.map(o => snapshotPose(o));
  state.collected = 0;
  state.collectTotal = compCollectibleCount();
  state.cleared = false;
  clearBanner.style.display = "none";

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

  // 自動再生クリップ指定のある非プレイヤーをループ再生 (バックダンサー)
  state.extras = [];
  for (const o of objects) {
    if (o === player) continue;
    const name = o.userData.autoClip;
    if (!name) continue;
    const clip = THREE.AnimationClip.findByName(o.userData.clips || [], name);
    if (!clip) continue;
    const mixer = new THREE.AnimationMixer(o);
    mixer.clipAction(clip).play();
    state.extras.push({ mixer, snapshot: snapshotPose(o) });
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
  if (state.camSnapshot) restorePose(state.camSnapshot);
  for (const ex of state.extras) {
    ex.mixer.stopAllAction();
    restorePose(ex.snapshot);
  }
  compPlayStop();   // Collectibleで消えた物を戻す
  for (const list of state.compSnapshots) restorePose(list);   // 回転/移動した物を戻す
  state.compSnapshots = [];
  state.dynamicObs = [];
  state.ride = null;
  state.cleared = false;
  clearBanner.style.display = "none";
  for (const o of state.hidden) o.visible = true;
  state.hidden = [];
  state.extras = [];
  state.obstacles = [];
  state.triggers = [];
  toast.style.display = "none";
  state.mixer = null; state.walk = null; state.idle = null; state.current = null;
  state.player = null; state.snapshot = null; state.camSnapshot = null; state.camOffset = null;
  app.playing = false;
  btn.textContent = "▶ 再生";
  btn.classList.remove("playing");
  setViewMode("scene");
}

/* --- 毎フレーム更新 (main.js のループから呼ぶ) --- */
function respawn(msg) {
  const p = state.player;
  if (!p) return;
  p.position.copy(state.startPos);
  state.vy = 0;
  state.grounded = true;
  state.ride = null;
  if (msg) showToast(msg);
}

export function updatePlay(dt) {
  if (!app.playing || !state.player) return;
  const p = state.player;
  const k = state.keys;

  // 動くオブジェクト (Rotator/Mover) の当たり判定を最新の位置に追従させる
  for (const d of state.dynamicObs) d.box.setFromObject(d.mesh);

  // 動く床に乗っていたら、床の動きと一緒に運ばれる (回転床・移動床)
  if (state.ride && state.grounded) {
    state.ride.obj.updateWorldMatrix(true, false);
    p.position.copy(state.ride.obj.localToWorld(state.ride.local.clone()));
  }

  let dx = 0, dz = 0;
  if (!state.cleared) {   // クリア後は操作を受け付けない
    if (k["w"] || k["arrowup"])    dz -= 1;
    if (k["s"] || k["arrowdown"])  dz += 1;
    if (k["a"] || k["arrowleft"])  dx -= 1;
    if (k["d"] || k["arrowright"]) dx += 1;
  }
  const moving = dx !== 0 || dz !== 0;

  const footY = () => p.position.y - state.footOff;   // 足元の高さ (原点が中心の形状にも対応)

  if (moving) {
    const len = Math.hypot(dx, dz);
    const sp = p.userData.moveSpeed || SPEED_DEFAULT;
    const nx = p.position.x + (dx / len) * sp * dt;
    const nz = p.position.z + (dz / len) * sp * dt;
    // 軸ごとに判定して、壁に斜めに当たったときは沿ってスライドする。
    // 既にめり込んでいる場合 (stuck) は脱出を優先して移動を許可する。
    const fy = footY();
    const stuck = collides(p.position.x, fy, p.position.z);
    if (stuck || !collides(nx, fy, p.position.z)) p.position.x = nx;
    if (stuck || !collides(p.position.x, fy, nz)) p.position.z = nz;
    p.rotation.y = Math.atan2(dx, dz);
  }

  // 重力と着地: レイキャストで足元の支持面を求める (障害物の上にも乗れる)
  const sup = supportAt(p.position.x, p.position.z, footY());
  const support = sup.y;
  if (state.grounded) {
    if (support === -Infinity || footY() > support + 0.001) {
      state.grounded = false;   // 端から歩き出した → 落下開始
    } else {
      p.position.y = support + state.footOff;   // 低い段差は登り降りに追従
    }
  }
  if (k[" "] && state.grounded) { state.vy = 4.5; state.grounded = false; }
  if (!state.grounded) {
    p.position.y += state.vy * dt;
    state.vy -= 12 * dt;
    if (state.vy <= 0 && footY() <= support) {
      p.position.y = support + state.footOff;   // 落下中に支持面へ着地
      state.vy = 0;
      state.grounded = true;
    }
  }

  // 立っている床が動く床 (Rotator/Mover持ち) なら「乗車」を記録する
  state.ride = null;
  if (state.grounded && sup.mesh) {
    const root = rootOf(sup.mesh);
    if (root && hasMovementComponent(root)) {
      root.updateWorldMatrix(true, false);
      state.ride = { obj: root, local: root.worldToLocal(p.position.clone()) };
    }
  }

  // コンポーネントの更新と接触判定 (Rotator/Mover/Collectible/Trap)
  compUpdate(dt, {
    px: p.position.x, py: footY(), pz: p.position.z,
    colR: state.colR, colH: state.colH,
    respawn: msg => { if (!state.cleared) respawn(msg); },   // クリア後はリスポーンしない
    collect: () => {
      state.collected++;
      showToast(`💎 ${state.collected} / ${state.collectTotal}`);
    },
    remaining: () => state.collectTotal - state.collected,
    notify: showToast,
    clear: showClear,
  });

  // 奈落 (KillZ): スタート地点よりだいぶ下に落ちたらリスポーン
  if (!state.cleared && footY() < state.groundY - 12) respawn("💀 落下! スタートに戻る");

  // トリガー通過の検知 (入った瞬間に一度だけ通知、出たらリセット)
  for (const t of state.triggers) {
    const inside = !(
      p.position.x + state.colR <= t.box.min.x || p.position.x - state.colR >= t.box.max.x ||
      p.position.z + state.colR <= t.box.min.z || p.position.z - state.colR >= t.box.max.z ||
      t.box.max.y <= footY() || t.box.min.y >= footY() + state.colH
    );
    if (inside && !t.inside) showToast(`🚩 ${t.name} を通過!`);
    t.inside = inside;
  }

  if (state.mixer) {
    fade(moving ? state.walk : state.idle);
    state.mixer.update(dt);
  }
  for (const ex of state.extras) ex.mixer.update(dt);

  /* --- カメラの再生中挙動 (Main Camera の Inspector で設定) --- */
  const camMode = camGizmo.userData.playMode || "fixed";
  if (camMode !== "fixed") {
    const damp = 1 - Math.exp(-6 * dt);   // フレームレート非依存の滑らかさ
    if (camMode === "follow") {
      // 追従: 開始時の構図 (プレイヤーとの位置関係) を保って平行移動 (ドリー撮影)
      _desired.copy(p.position).add(state.camOffset);
      camGizmo.position.lerp(_desired, damp);
    } else if (camMode === "lookat") {
      // 注視: カメラは動かず、首だけ振ってプレイヤーを追う (パン撮影)
      _look.copy(p.position);
      _look.y += 0.8;
      _m.lookAt(camGizmo.position, _look, camGizmo.up);
      _q.setFromRotationMatrix(_m);
      camGizmo.quaternion.slerp(_q, damp);
    }
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
