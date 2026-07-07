// ui.js — ビュータブ切替、オーバーレイ表示、Assetsフォルダ開閉
import { app, objects, gameCam } from "./state.js";

const gameFrame = document.getElementById("game-frame");
const overlay = document.getElementById("view-overlay");

export function setViewMode(mode) {
  app.viewMode = mode;
  document.querySelectorAll(".vtab").forEach(t => t.classList.toggle("active", t.dataset.view === mode));
  gameFrame.style.display = mode === "game" ? "block" : "none";
  updateOverlay();
}
document.querySelectorAll(".vtab").forEach(tab => {
  tab.addEventListener("click", () => setViewMode(tab.dataset.view));
});

export function updateOverlay() {
  if (app.playing) {
    overlay.innerHTML = `<b style="color:#8bd450">再生中</b> — WASD / 矢印: 移動 ／ Space: ジャンプ ／ Esc か ■ で停止`;
    return;
  }
  overlay.innerHTML = app.viewMode === "scene"
    ? `<b style="color:#4f9dff">Scene View</b> — 自由視点 (編集用)<br>オブジェクト数: ${objects.length - 1} + Main Camera`
    : `<b style="color:#ffb454">Game View</b> — Main Camera 視点 (FOV ${gameCam.fov}°)<br>Scene View でカメラを動かすと画角が変わります`;
}

document.querySelectorAll(".folder>.fname").forEach(f => {
  f.addEventListener("click", () => f.parentElement.classList.toggle("open"));
});
