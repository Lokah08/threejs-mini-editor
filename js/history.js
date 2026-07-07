// history.js — Undo/Redo スタック (コマンド方式)
// 各コマンドは { undo(), redo(), obj? } の形。obj はオブジェクトの生成/削除に
// 関わるコマンドが持ち、履歴から消えた時点でシーンに無ければ dispose する。
import {
  objects, app, select, disposeObject, detachObject, attachObject,
  notifySceneChanged,
} from "./state.js";

const MAX = 100;
const undoStack = [];
const redoStack = [];

function referenced(obj) {
  return undoStack.some(c => c.obj === obj) || redoStack.some(c => c.obj === obj);
}
// 履歴から外れたコマンドが持つオブジェクトが、シーンにも他の履歴にも
// 居なければメモリ解放してよい
function disposeIfOrphan(obj) {
  if (obj && !objects.includes(obj) && !referenced(obj)) disposeObject(obj);
}

export function pushCommand(cmd) {
  undoStack.push(cmd);
  if (undoStack.length > MAX) disposeIfOrphan(undoStack.shift().obj);
  for (const c of redoStack.splice(0)) disposeIfOrphan(c.obj);
}

export function undo() {
  const c = undoStack.pop();
  if (!c) return;
  c.undo();
  redoStack.push(c);
  afterHistory();
}

export function redo() {
  const c = redoStack.pop();
  if (!c) return;
  c.redo();
  undoStack.push(c);
  afterHistory();
}

function afterHistory() {
  // 選択オブジェクトが履歴操作で消えた場合に備えて選択を貼り直す
  select(app.selected && objects.includes(app.selected) ? app.selected : null);
  notifySceneChanged();
}

export function clearHistory() {
  for (const c of [...undoStack.splice(0), ...redoStack.splice(0)]) {
    if (c.obj && !objects.includes(c.obj)) disposeObject(c.obj);
  }
}

/* ============================================================
   よく使うコマンドのヘルパー
============================================================ */

/* --- Transform (position / rotation / scale) --- */
export function snapshotTransform(obj) {
  return { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
}
function sameTransform(a, b) {
  return a.p.equals(b.p) && a.q.equals(b.q) && a.s.equals(b.s);
}
export function pushTransform(obj, before, after = snapshotTransform(obj)) {
  if (sameTransform(before, after)) return;
  const apply = t => {
    obj.position.copy(t.p);
    obj.quaternion.copy(t.q);
    obj.scale.copy(t.s);
  };
  pushCommand({ obj, undo: () => apply(before), redo: () => apply(after) });
}

/* --- 追加 (obj は既にシーンに入っている状態で呼ぶ) --- */
export function pushAdd(obj) {
  const index = objects.indexOf(obj);
  pushCommand({
    obj,
    undo: () => detachObject(obj),
    redo: () => { attachObject(obj, index); select(obj); },
  });
}

/* --- 削除 (このヘルパー自体が削除を実行する) --- */
export function pushDelete(obj) {
  const index = objects.indexOf(obj);
  detachObject(obj);
  pushCommand({
    obj,
    undo: () => { attachObject(obj, index); select(obj); },
    redo: () => detachObject(obj),
  });
}

/* ============================================================
   キーバインド: Ctrl+Z = Undo / Ctrl+Y, Ctrl+Shift+Z = Redo
============================================================ */
window.addEventListener("keydown", e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
});
