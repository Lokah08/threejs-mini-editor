// components.js — コンポーネントシステム (UnityのComponent風)
// 各オブジェクトの userData.components に [{ type, ...params }] の配列で保持する。
// 種類の定義は COMPONENT_TYPES に登録。再生モード中だけ動く。
// 新しい振る舞いを増やすときは、ここに定義を1つ追加するだけでよい
// (Inspector のUIは params 定義から自動生成される)。
import * as THREE from "three";

/* ============================================================
   コンポーネントの種類の登録簿
   params: { キー: { type: "number"|"select"|"checkbox", default, label, options? } }
   ライフサイクル: start(inst) → update(inst, dt, ctx) 毎フレーム
                  onTouch(inst, ctx) プレイヤー接触時 (touchable: true のもの)
   inst = { obj, params, state } (state は再生ごとに空オブジェクトから)
============================================================ */
export const COMPONENT_TYPES = {

  Rotator: {
    label: "Rotator (回転し続ける)",
    params: {
      axis:  { type: "select", options: ["x", "y", "z"], default: "y", label: "軸" },
      speed: { type: "number", default: 90, label: "速度 (度/秒)" },
    },
    update(inst, dt) {
      inst.obj.rotation[inst.params.axis] += THREE.MathUtils.degToRad(inst.params.speed) * dt;
    },
  },

  Mover: {
    label: "Mover (往復移動)",
    params: {
      axis:     { type: "select", options: ["x", "y", "z"], default: "x", label: "軸" },
      distance: { type: "number", default: 3, label: "距離" },
      duration: { type: "number", default: 2, label: "片道 (秒)" },
    },
    start(inst) {
      inst.state.base = inst.obj.position[inst.params.axis];
      inst.state.t = 0;
    },
    update(inst, dt) {
      const p = inst.params;
      inst.state.t += dt;
      // sinカーブで滑らかに往復 (端で一瞬止まる自然な動き)
      const phase = (inst.state.t / Math.max(p.duration, 0.05)) * Math.PI;
      inst.obj.position[p.axis] = inst.state.base + (1 - Math.cos(phase)) / 2 * p.distance;
    },
  },

  Collectible: {
    label: "Collectible (取れるアイテム)",
    touchable: true,
    params: {
      spin:  { type: "checkbox", default: true, label: "回転演出" },
      sound: { type: "select", options: ["coin", "heart", "key", "none"], default: "coin", label: "効果音" },
    },
    update(inst, dt) {
      if (inst.params.spin) inst.obj.rotation.y += 2.5 * dt;
    },
    onTouch(inst, ctx) {
      if (inst.state.taken) return;
      inst.state.taken = true;
      inst.obj.visible = false;   // 停止時に復元される (visibleは再生系が戻す)
      ctx.sound(inst.params.sound);
      ctx.collect();              // カウント + トースト表示
    },
  },

  Trap: {
    label: "Trap (触れるとリスポーン)",
    touchable: true,
    params: {
      sound: { type: "select", options: ["trap", "falling", "none"], default: "trap", label: "効果音" },
    },
    onTouch(inst, ctx) {
      ctx.sound(inst.params.sound);
      ctx.respawn("💀 トラップ! スタートに戻る");
    },
  },

  Goal: {
    label: "Goal (触れるとクリア)",
    touchable: true,
    params: {
      requireAll: { type: "checkbox", default: false, label: "アイテム全収集が条件" },
      spin:       { type: "checkbox", default: true,  label: "回転演出" },
      sound:      { type: "select", options: ["key", "coin", "heart", "none"], default: "key", label: "クリア音" },
    },
    update(inst, dt) {
      if (inst.params.spin) inst.obj.rotation.y += 1.5 * dt;
    },
    onTouch(inst, ctx) {
      if (inst.state.done) return;
      if (inst.params.requireAll && ctx.remaining() > 0) {
        ctx.notify(`🔒 まだ取っていないアイテムが ${ctx.remaining()} 個あります`);
        return;
      }
      inst.state.done = true;
      inst.obj.visible = false;   // 取ったゴール品は消える (停止時に復元)
      ctx.sound(inst.params.sound);
      ctx.clear();
    },
  },

  Chaser: {
    label: "Chaser (追いかけてくる敵)",
    touchable: true,   // 捕まったらリスポーン。壁や床はすり抜ける (幽霊タイプ)
    params: {
      speed: { type: "number", default: 1.8, label: "速度" },
      range: { type: "number", default: 6, label: "索敵範囲" },
      back:  { type: "checkbox", default: true, label: "見失ったら持ち場に戻る" },
    },
    start(inst) {
      inst.state.home = inst.obj.position.clone();   // 持ち場を覚えておく
    },
    update(inst, dt, ctx) {
      const o = inst.obj, p = inst.params;
      const dx = ctx.px - o.position.x, dz = ctx.pz - o.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < p.range && dist > 0.05) {
        // プレイヤーを発見 → 追いかける
        o.position.x += (dx / dist) * p.speed * dt;
        o.position.z += (dz / dist) * p.speed * dt;
        o.rotation.y = Math.atan2(dx, dz);
      } else if (p.back && inst.state.home) {
        // 見失った → 持ち場へ帰る
        const hx = inst.state.home.x - o.position.x, hz = inst.state.home.z - o.position.z;
        const hd = Math.hypot(hx, hz);
        if (hd > 0.05) {
          o.position.x += (hx / hd) * p.speed * dt;
          o.position.z += (hz / hd) * p.speed * dt;
          o.rotation.y = Math.atan2(hx, hz);
        }
      }
    },
    onTouch(inst, ctx) {
      ctx.sound("trap");
      ctx.respawn("👻 捕まった! スタートに戻る");
    },
  },

};

/* ============================================================
   実行系 (play.js から呼ばれる)
============================================================ */
const runtime = {
  instances: [],   // { obj, type, def, params, state }
  touchables: [],  // instances のうち接触判定するもの
  hiddenByComp: [],  // Collectible取得などで消したもの (停止時に戻す)
};

// 再生開始: userData.components からインスタンスを生成
export function compPlayStart(objects, player) {
  runtime.instances = [];
  runtime.touchables = [];
  runtime.hiddenByComp = [];
  for (const o of objects) {
    if (o === player) continue;   // プレイヤー自身のコンポーネントは対象外
    for (const c of (o.userData.components || [])) {
      const def = COMPONENT_TYPES[c.type];
      if (!def) continue;
      const params = {};
      for (const [key, spec] of Object.entries(def.params)) {
        params[key] = c[key] ?? spec.default;
      }
      const inst = { obj: o, type: c.type, def, params, state: {} };
      def.start?.(inst);
      runtime.instances.push(inst);
      if (def.touchable) runtime.touchables.push(inst);
    }
  }
  return runtime.instances.map(i => i.obj);   // ポーズ保存が必要なオブジェクト一覧
}

// 毎フレーム更新
export function compUpdate(dt, ctx) {
  for (const inst of runtime.instances) {
    inst.def.update?.(inst, dt, ctx);
  }
  // プレイヤー接触判定 (オブジェクトのAABBとプレイヤーの箱)
  const box = new THREE.Box3();
  for (const inst of runtime.touchables) {
    if (inst.state.taken || !inst.obj.visible) continue;
    box.setFromObject(inst.obj);
    if (box.isEmpty()) continue;
    if (
      ctx.px + ctx.colR > box.min.x && ctx.px - ctx.colR < box.max.x &&
      ctx.pz + ctx.colR > box.min.z && ctx.pz - ctx.colR < box.max.z &&
      box.max.y > ctx.py && box.min.y < ctx.py + ctx.colH
    ) {
      inst.def.onTouch?.(inst, ctx);
      if (!inst.obj.visible) runtime.hiddenByComp.push(inst.obj);
    }
  }
}

// 再生停止: 消したものを戻す
export function compPlayStop() {
  for (const o of runtime.hiddenByComp) o.visible = true;
  runtime.instances = [];
  runtime.touchables = [];
  runtime.hiddenByComp = [];
}

// コンポーネント付きオブジェクトか (動的AABB更新の対象判定に使う)
export function hasMovementComponent(obj) {
  return (obj.userData.components || []).some(c => {
    const def = COMPONENT_TYPES[c.type];
    return def && def.update && !def.touchable;   // Rotator / Mover 系
  });
}

// 接触型コンポーネント持ちか (当たり判定から除外してすり抜けさせる)
export function hasTouchableComponent(obj) {
  return (obj.userData.components || []).some(c => COMPONENT_TYPES[c.type]?.touchable);
}

// 今の再生でのCollectibleの総数 (カウンター表示用)
export function compCollectibleCount() {
  return runtime.touchables.filter(i => i.type === "Collectible").length;
}
