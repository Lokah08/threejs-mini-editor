// hierarchy.js — Hierarchy パネル (オブジェクト一覧・クリック選択)
import { objects, camGizmo, app, select, onSelect, onSceneChanged } from "./state.js";
import { updateOverlay } from "./ui.js";

const list = document.getElementById("hier-list");

const ICONS = {
  box: "◼", sphere: "●", cylinder: "▮", torus: "◯", plane: "▬", glb: "📦", light: "💡",
};

export function renderHierarchy() {
  list.innerHTML = "";
  for (const o of objects) {
    const el = document.createElement("div");
    el.className = "hitem" + (o === app.selected ? " selected" : "");
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.textContent = o === camGizmo ? "🎥" : (ICONS[o.userData.kind] ?? "◇");
    const name = document.createElement("span");
    name.className = "hname";
    name.textContent = o.name;
    el.append(ico, name);
    el.addEventListener("click", () => select(o));
    list.appendChild(el);
  }
}

onSceneChanged(() => { renderHierarchy(); updateOverlay(); });
onSelect(renderHierarchy);
renderHierarchy();
