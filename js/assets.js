// assets.js — assets/ フォルダのGLB一覧をAssetsパネルに表示して配置できるようにする
// 一覧は assets/index.json (目録) から読む。scene.json にはパス参照で保存される。
import { app } from "./state.js";
import { importAssetGLB } from "./io.js";
import { pushAdd } from "./history.js";
import { updateOverlay } from "./ui.js";

const listEl = document.getElementById("asset-glb-list");

const ICONS = [
  [/^(platform|circle|passage|stairs|ruins_road)/, "🟫"],
  [/^obstacle/, "⚠️"],
  [/^(star|diamond|coin|heart|key|crown|apple|berries)/, "⭐"],
  [/^(gate|arch|door)/, "🚪"],
  [/^(wall|fence|pillar|column|ruins)/, "🧱"],
  [/^(fire|bomb|dynamite)/, "🔥"],
];
function iconFor(name) {
  for (const [re, ico] of ICONS) if (re.test(name)) return ico;
  return "📦";
}

async function loadManifest() {
  try {
    const res = await fetch("assets/index.json");
    if (!res.ok) return;   // assetsフォルダが無い環境では静かにスキップ
    const manifest = await res.json();
    render(manifest);
  } catch {
    /* 目録なし: assetsフォルダ未設置の環境 */
  }
}

function render(manifest) {
  listEl.innerHTML = "";
  for (const file of manifest.files) {
    const name = file.replace(/\.glb$/i, "");
    const el = document.createElement("div");
    el.className = "asset";
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.textContent = iconFor(name);
    const label = document.createElement("span");
    label.textContent = name;
    const ext = document.createElement("small");
    ext.textContent = ".glb";
    el.append(ico, label, ext);
    el.addEventListener("click", async () => {
      if (app.playing) return;
      el.style.opacity = "0.5";
      try {
        const obj = await importAssetGLB(manifest.base + file, name);
        pushAdd(obj);
        updateOverlay();
      } catch (err) {
        alert(err.message);
      } finally {
        el.style.opacity = "";
      }
    });
    listEl.appendChild(el);
  }
}

loadManifest();
