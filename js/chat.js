// chat.js — エディタ内AIチャット (作業依頼用)
// 「〇〇するコンポーネントを作って」「Cube_01 を回転させて」といった、エディタ "で" 行う作業を
// Claude に頼むための簡素なチャット。エディタ "自体" の改修はここでは扱わない (Claude Code で行う)。
//
// 仕組み: Claude にツール (define_component / attach_component / ...) を渡し、
// 返ってきたツール呼び出しをこの場で実行して結果を返す、という手動ループ。
// 生成されたコンポーネント定義は components.js の registerComponent で即登録され、
// localStorage と scene.json (v11) に保存される。
//
// APIキーはこのブラウザの localStorage にだけ保存し、scene.json には含めない。
// SDK は初回送信時に CDN (esm.sh) から動的に読み込む。
import { app, objects, camGizmo, select } from "./state.js";
import { pushCommand } from "./history.js";
import {
  COMPONENT_TYPES, CUSTOM_COMPONENTS,
  registerComponent, unregisterComponent,
} from "./components.js";
import { refreshComponentsUI } from "./inspector.js";
import { SE_FILES } from "./audio.js";

const MODEL = "claude-opus-5";
const KEY_STORAGE = "miniEditor.apiKey";
const MAX_TOOL_ROUNDS = 8;

/* ============================================================
   DOM
============================================================ */
const panel   = document.getElementById("chat");
const btnOpen = document.getElementById("btn-chat");
const msgsEl  = document.getElementById("chat-msgs");
const textEl  = document.getElementById("chat-text");
const sendBtn = document.getElementById("chat-send");
document.getElementById("chat-model").textContent = MODEL;

btnOpen.addEventListener("click", () => setOpen(panel.style.display === "none"));
document.getElementById("chat-close").addEventListener("click", () => setOpen(false));
document.getElementById("chat-key").addEventListener("click", () => askKey(true));
document.getElementById("chat-clear").addEventListener("click", () => {
  messages.length = 0;
  msgsEl.innerHTML = "";
  addMsg("sys", "会話をリセットしました。");
});
sendBtn.addEventListener("click", () => submit());
textEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

function setOpen(open) {
  panel.style.display = open ? "" : "none";
  btnOpen.classList.toggle("active", open);
  if (open) textEl.focus();
}

function addMsg(cls, text) {
  const el = document.createElement("div");
  el.className = "cmsg " + cls;
  el.textContent = text;
  msgsEl.appendChild(el);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return el;
}

// ツール実行結果の表示 (コードは折りたたみで見られる)
function addToolMsg(name, input, result, ok) {
  const el = document.createElement("div");
  el.className = "cmsg tool" + (ok ? "" : " ng");
  const head = document.createElement("div");
  head.textContent = `${ok ? "✔" : "✖"} ${name}: ${summarizeInput(input)} — ${result.split("\n")[0]}`;
  el.appendChild(head);
  if (input.code) {
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "生成されたコードを見る";
    const pre = document.createElement("pre");
    pre.textContent = input.code;
    det.append(sum, pre);
    el.appendChild(det);
  }
  msgsEl.appendChild(el);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}
function summarizeInput(input) {
  const { code, ...rest } = input;
  return Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
}

/* ============================================================
   APIキー / クライアント
============================================================ */
let client = null;

function askKey(force = false) {
  let key = localStorage.getItem(KEY_STORAGE) || "";
  if (!key || force) {
    const input = prompt(
      "Anthropic APIキーを入力してください (このブラウザの localStorage にのみ保存されます)",
      key,
    );
    if (input === null) return key;   // キャンセル
    key = input.trim();
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
    client = null;   // 作り直す
  }
  return key;
}

async function getClient() {
  if (client) return client;
  const key = askKey();
  if (!key) throw new Error("APIキーが設定されていません (🔑 APIキー ボタンから設定)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  return client;
}

/* ============================================================
   システムプロンプト (コンポーネントの契約とシーンの状況)
============================================================ */
const CONTRACT = `あなたは Three.js 製ブラウザ3Dエディタ「Mini Editor」の中で動くアシスタントです。
ユーザーはこのエディタでゲームのステージを作っています。ユーザーの依頼に応じて、
ツールを使ってコンポーネントを定義したり、シーン内のオブジェクトに付けたりしてください。
回答は日本語で、短く。作業した内容と使い方 (パラメータの意味など) を簡潔に伝えてください。

## コンポーネントの仕組み
- 各オブジェクトは userData.components = [{ type, ...params }] を持つ。再生モード (▶) 中だけ動く。
- 種類は COMPONENT_TYPES に登録された定義。define_component ツールの code には、
  **定義オブジェクトに評価される JavaScript の式** を渡す (ES2020、THREE は使える)。例:

({
  label: "Bouncer (上下に跳ねる)",          // Inspectorに出る表示名 (日本語の説明つき)
  params: {                                 // Inspector のUIが自動生成される
    height: { type: "number", default: 1, label: "高さ" },
    speed:  { type: "number", default: 2, label: "速さ" },
    axis:   { type: "select", options: ["x", "y", "z"], default: "y", label: "軸" },
    loop:   { type: "checkbox", default: true, label: "繰り返す" },
  },
  start(inst) {                             // 再生開始時に1回
    inst.state.base = inst.obj.position[inst.params.axis];
    inst.state.t = 0;
  },
  update(inst, dt, ctx) {                   // 毎フレーム (dt: 秒)
    inst.state.t += dt;
    inst.obj.position[inst.params.axis] =
      inst.state.base + Math.abs(Math.sin(inst.state.t * inst.params.speed)) * inst.params.height;
  },
  // onTouch(inst, ctx) {}                  // プレイヤー接触時 (定義すると touchable になる)
})

- inst = { obj (THREE.Object3D), params (現在の値), state (再生ごとに空の {}) }。
  params の type は number / select / checkbox のみ。default 必須。
- start / update / onTouch のいずれかが必須。
- touchable (onTouch を持つもの) は当たり判定から除外され、プレイヤーが触れると onTouch が呼ばれる。
  触れ続けている間は毎フレーム呼ばれるので、一度きりにしたいなら inst.state にフラグを持つ。
  inst.obj.visible = false で消せる (停止時に自動で復元される)。
- update だけの部品 (Rotator/Mover 系) は、動く障害物として当たり判定 (AABB) が毎フレーム追従する。
- 位置・回転・スケールなどのポーズは再生停止時にエディタが自動で元に戻すので、復元処理は不要。
- ctx (update / onTouch の引数):
  ctx.px, ctx.py, ctx.pz  プレイヤーの位置 (py は足元)
  ctx.colR, ctx.colH      プレイヤーの当たり判定の半径・身長
  ctx.respawn(msg)        プレイヤーをスタートに戻す (トースト表示つき)
  ctx.collect()           収集カウント +1 (💎 表示)
  ctx.remaining()         未収集の Collectible 数
  ctx.notify(msg)         トースト表示
  ctx.clear()             STAGE CLEAR
  ctx.sound(key)          効果音。key: ${Object.keys(SE_FILES).join(" / ")}
- プレイヤー自身に付けたコンポーネントは動かない (プレイヤーは除外される)。
- 組み込み (Rotator, Mover, Collectible, Trap, Goal, Chaser) は上書きできない。別名で作る。
- 名前 (name) は英字始まりの英数字 (PascalCase 推奨)。同名のカスタム部品は上書きされる。
- code に構文エラー等があるとツールがエラーを返すので、直して再度 define_component すること。

## 依頼の扱い
- 「〇〇するコンポーネントを作って」→ define_component。対象オブジェクトが指定されていれば attach_component も。
- 「Cube_01 を回転させて」など既存部品で済むなら、新しく作らず attach_component で組み込み部品を付ける。
- オブジェクト名が曖昧なら、シーンの一覧から最も近いものを選び、そう伝える。
- 作業ではない質問には普通に答える。エディタ自体の改修 (ソースコード変更) はここではできないと伝える。`;

function sceneSummary() {
  const lines = objects.filter(o => o !== camGizmo).map(o => {
    const u = o.userData;
    const p = o.position;
    const bits = [
      `${o.name} (${u.kind || "object"}${u.isPlayer ? ", プレイヤー" : ""})`,
      `pos=[${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}]`,
    ];
    if (u.components?.length) bits.push("components=" + u.components.map(c => c.type).join(","));
    return "- " + bits.join(" ");
  });
  const custom = Object.keys(CUSTOM_COMPONENTS);
  return [
    "## 現在のシーン",
    `選択中: ${app.selected && app.selected !== camGizmo ? app.selected.name : "(なし)"}`,
    "オブジェクト一覧:",
    ...(lines.length ? lines : ["- (なし)"]),
    "",
    "利用できるコンポーネント: " + Object.entries(COMPONENT_TYPES).map(([k, d]) => `${k}${d.custom ? " (カスタム)" : ""}`).join(", "),
    custom.length ? "カスタム部品の定義:\n" + custom.map(n => `### ${n}\n${CUSTOM_COMPONENTS[n].code}`).join("\n") : "",
  ].join("\n");
}

/* ============================================================
   ツール定義と実行
============================================================ */
const TOOLS = [
  {
    name: "define_component",
    description: "新しいコンポーネントの種類を定義して、すぐ使えるように登録する。code は定義オブジェクトに評価される JavaScript の式。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "種類名 (英字始まりの英数字、PascalCase)" },
        code: { type: "string", description: "定義オブジェクトの式。({ label, params, start, update, onTouch }) の形" },
      },
      required: ["name", "code"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "attach_component",
    description: "シーン内のオブジェクトにコンポーネントを付ける (Undo可)。params を省略するとデフォルト値。",
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string", description: "オブジェクト名" },
        type:   { type: "string", description: "コンポーネントの種類名" },
        params: { type: "object", description: "パラメータの初期値 (任意)" },
      },
      required: ["object", "type"],
    },
  },
  {
    name: "detach_component",
    description: "オブジェクトから指定した種類のコンポーネントを外す (Undo可)。",
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string", description: "オブジェクト名" },
        type:   { type: "string", description: "コンポーネントの種類名" },
      },
      required: ["object", "type"],
    },
  },
  {
    name: "remove_component_type",
    description: "カスタムコンポーネントの種類そのものを削除する (組み込みは不可)。",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

function findObject(name) {
  const cands = objects.filter(o => o !== camGizmo);
  return cands.find(o => o.name === name)
      || cands.find(o => o.name.toLowerCase() === String(name).toLowerCase())
      || null;
}

function runTool(name, input) {
  if (app.playing) throw new Error("再生中は編集できません。■ で停止してから頼んでください");
  switch (name) {
    case "define_component": {
      const def = registerComponent(input.name, input.code);
      return `登録しました: ${input.name} (${def.label})。params: ${Object.keys(def.params).join(", ") || "なし"}`;
    }
    case "attach_component": {
      const obj = findObject(input.object);
      if (!obj) throw new Error(`オブジェクト "${input.object}" が見つかりません。一覧: ${objects.filter(o => o !== camGizmo).map(o => o.name).join(", ")}`);
      const def = COMPONENT_TYPES[input.type];
      if (!def) throw new Error(`コンポーネント "${input.type}" は未定義です。利用可能: ${Object.keys(COMPONENT_TYPES).join(", ")}`);
      if (!obj.userData.components) obj.userData.components = [];
      const comps = obj.userData.components;
      const entry = { type: input.type };
      for (const [k, v] of Object.entries(input.params || {})) {
        if (k in def.params) entry[k] = v;
      }
      comps.push(entry);
      pushCommand({
        undo: () => { comps.splice(comps.indexOf(entry), 1); refreshComponentsUI(obj); },
        redo: () => { comps.push(entry); refreshComponentsUI(obj); },
      });
      select(obj);
      refreshComponentsUI(obj);
      return `${obj.name} に ${input.type} を付けました`;
    }
    case "detach_component": {
      const obj = findObject(input.object);
      if (!obj) throw new Error(`オブジェクト "${input.object}" が見つかりません`);
      const comps = obj.userData.components || [];
      const index = comps.findIndex(c => c.type === input.type);
      if (index < 0) throw new Error(`${obj.name} に ${input.type} は付いていません`);
      const removed = comps[index];
      comps.splice(index, 1);
      pushCommand({
        undo: () => { comps.splice(index, 0, removed); refreshComponentsUI(obj); },
        redo: () => { comps.splice(index, 1); refreshComponentsUI(obj); },
      });
      refreshComponentsUI(obj);
      return `${obj.name} から ${input.type} を外しました`;
    }
    case "remove_component_type": {
      if (!unregisterComponent(input.name)) throw new Error(`${input.name} はカスタムコンポーネントではありません`);
      const users = objects.filter(o => (o.userData.components || []).some(c => c.type === input.name)).map(o => o.name);
      return `${input.name} を削除しました` + (users.length ? ` (付けていたオブジェクト: ${users.join(", ")} は無効になります)` : "");
    }
    default:
      throw new Error("不明なツール: " + name);
  }
}

/* ============================================================
   送信ループ
============================================================ */
const messages = [];   // API に渡す会話履歴 (SDK の MessageParam 形式)
let busy = false;

async function submit() {
  const text = textEl.value.trim();
  if (!text || busy) return;
  textEl.value = "";
  addMsg("user", text);
  messages.push({ role: "user", content: text });
  busy = true;
  sendBtn.disabled = true;
  try {
    const c = await getClient();
    await converse(c);
  } catch (e) {
    console.error(e);
    addMsg("err", "エラー: " + (e?.message || e));
    // 失敗したターンは履歴から取り除く (次の送信で壊れた履歴を送らないため)
    while (messages.length && messages[messages.length - 1].role !== "user") messages.pop();
    if (messages.length) messages.pop();
  } finally {
    busy = false;
    sendBtn.disabled = false;
    textEl.focus();
  }
}

async function converse(c) {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const bubble = addMsg("ai thinking", "");
    let msg;
    try {
      msg = await requestStream(c, bubble);
    } catch (e) {
      bubble.remove();
      throw e;
    }
    bubble.classList.remove("thinking");
    if (!bubble.textContent) bubble.remove();

    if (msg.stop_reason === "refusal") {
      addMsg("err", "この依頼には応答できませんでした (安全上の理由で拒否されました)");
      messages.push({ role: "assistant", content: msg.content });
      return;
    }
    messages.push({ role: "assistant", content: msg.content });

    const uses = msg.content.filter(b => b.type === "tool_use");
    if (!uses.length) return;

    // ツールを実行して、結果を1つの user メッセージにまとめて返す
    const results = uses.map(u => {
      let out, ok = true;
      try { out = runTool(u.name, u.input); }
      catch (e) { out = "エラー: " + (e?.message || e); ok = false; }
      addToolMsg(u.name, u.input, out, ok);
      return { type: "tool_result", tool_use_id: u.id, content: out, is_error: !ok };
    });
    messages.push({ role: "user", content: results });
  }
  addMsg("err", "ツール呼び出しが多すぎるため中断しました");
}

let fallbackSupported = true;

async function requestStream(c, bubble) {
  const base = {
    model: MODEL,
    max_tokens: 16000,
    system: CONTRACT + "\n\n" + sceneSummary(),
    tools: TOOLS,
    messages,
  };
  // 安全上の拒否があった場合にサーバー側で別モデルへ引き継ぐ (未対応なら外して再試行)
  const withFallback = fallbackSupported
    ? { ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : base;
  try {
    return await streamOnce(c, withFallback, bubble);
  } catch (e) {
    if (fallbackSupported && e?.status === 400 && /fallback/i.test(e?.message || "")) {
      fallbackSupported = false;
      return await streamOnce(c, base, bubble);
    }
    throw e;
  }
}

async function streamOnce(c, params, bubble) {
  const stream = c.beta.messages.stream(params);
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      bubble.textContent += ev.delta.text;
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }
  return await stream.finalMessage();
}
