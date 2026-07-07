// ui.js — ビュータブ切替、オーバーレイ表示、Assetsフォルダ開閉
import { app, objects, gameCam } from "./state.js";

const gameFrame = document.getElementById("game-frame");
const overlay = document.getElementById("view-overlay");

document.querySelectorAll(".vtab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".vtab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    app.viewMode = tab.dataset.view;
    gameFrame.style.display = app.viewMode === "game" ? "block" : "none";
    updateOverlay();
  });
});

export function updateOverlay() {
  overlay.innerHTML = app.viewMode === "scene"
    ? `<b style="color:#4f9dff">Scene View</b> — 自由視点 (編集用)<br>オブジェクト数: ${objects.length - 1} + Main Camera`
    : `<b style="color:#ffb454">Game View</b> — Main Camera 視点 (FOV ${gameCam.fov}°)<br>Scene View でカメラを動かすと画角が変わります`;
}

document.querySelectorAll(".folder>.fname").forEach(f => {
  f.addEventListener("click", () => f.parentElement.classList.toggle("open"));
});
