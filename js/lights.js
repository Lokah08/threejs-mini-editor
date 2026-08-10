// lights.js — ライトをオブジェクトとして配置・編集する
// ライトは Group (電球ギズモ + 実ライト) として objects に入れる。
// これで選択・移動・複製・保存・コンポーネント付与が全部そのまま使える。
import * as THREE from "three";
import { scene, objects, select, notifySceneChanged } from "./state.js";

export const LIGHT_LABELS = {
  point: "Point Light",
  spot: "Spot Light",
  directional: "Directional Light",
};

const bulbGeo = new THREE.SphereGeometry(0.13, 12, 8);
let counter = 0;
export function resetLightCounter() { counter = 0; }

/* --- ライトを1つ作る (kind: point / spot / directional) --- */
export function addLight(kind, opts = {}) {
  const g = new THREE.Group();
  const color = opts.color ?? 0xffd9a0;
  const intensity = opts.intensity ?? (kind === "directional" ? 1.2 : 8);
  const distance = opts.distance ?? 8;
  const angle = opts.angle ?? 35;

  let light;
  if (kind === "spot") {
    light = new THREE.SpotLight(color, intensity, distance, THREE.MathUtils.degToRad(angle), 0.4);
  } else if (kind === "directional") {
    light = new THREE.DirectionalLight(color, intensity);
  } else {
    light = new THREE.PointLight(color, intensity, distance);
  }
  g.add(light);

  // spot/directional は「グループの真下」を照らす。回転させると向きが変わる
  if (kind !== "point") {
    const target = new THREE.Object3D();
    target.position.set(0, -1, 0);
    g.add(target);
    light.target = target;
    g.userData.lightTarget = target;
  }

  // 編集中の位置がわかるように光る球を置く (再生中は隠す)
  const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color }));
  bulb.userData.editorOnly = true;
  g.add(bulb);

  g.name = opts.name ?? `${LIGHT_LABELS[kind]}_${String(++counter).padStart(2, "0")}`;
  g.userData.kind = "light";
  g.userData.lightType = kind;
  g.userData.light = light;
  g.userData.bulb = bulb;
  g.userData.lightColor = "#" + new THREE.Color(color).getHexString();
  g.userData.intensity = intensity;
  g.userData.distance = distance;
  g.userData.angle = angle;

  if (opts.position) g.position.fromArray(opts.position);
  else g.position.set(0, 2.5, 0);
  if (opts.rotation) g.rotation.fromArray(opts.rotation);

  scene.add(g);
  objects.push(g);
  notifySceneChanged();
  select(g);
  return g;
}

/* --- Inspectorからの設定変更を実ライトに反映 --- */
export function applyLightSettings(g) {
  const light = g.userData.light;
  if (!light) return;
  light.color.set(g.userData.lightColor);
  light.intensity = g.userData.intensity;
  if (light.distance !== undefined && g.userData.lightType !== "directional") {
    light.distance = g.userData.distance;
  }
  if (light.isSpotLight) light.angle = THREE.MathUtils.degToRad(g.userData.angle);
  if (g.userData.bulb) g.userData.bulb.material.color.set(g.userData.lightColor);
}

export function isLight(obj) {
  return obj?.userData.kind === "light";
}
