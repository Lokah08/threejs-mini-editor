// state.js — エディタ全体で共有する状態 (シーン、カメラ、選択、再生フラグ)
import * as THREE from "three";

/* ===== レンダラ & シーン ===== */
export const wrap = document.getElementById("canvas-wrap");
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141518);

/* ===== 環境光 (シーン全体のベース照明。Inspectorで強さを調整できる) ===== */
export const ambientLight = new THREE.HemisphereLight(0xffffff, 0x33383f, 0.9);
scene.add(ambientLight);
export const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
sunLight.position.set(5, 8, 4);
scene.add(sunLight);

/* ===== エディタ専用ヘルパー (保存対象外) ===== */
export const grid = new THREE.GridHelper(20, 20, 0x3a4048, 0x24282e);
grid.userData.editorOnly = true;
scene.add(grid);
export const axes = new THREE.AxesHelper(1.2);
axes.userData.editorOnly = true;
scene.add(axes);

/* ===== エディタカメラ (Scene View / 自前オービット) ===== */
export const editorCam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
export const orbit = {
  target: new THREE.Vector3(0, 0.8, 0),
  theta: Math.PI / 4, phi: Math.PI / 3.2, dist: 9,
  apply() {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    editorCam.position.set(
      this.target.x + this.dist * sp * Math.sin(this.theta),
      this.target.y + this.dist * cp,
      this.target.z + this.dist * sp * Math.cos(this.theta)
    );
    editorCam.lookAt(this.target);
  },
};
orbit.apply();

/* ===== ゲームカメラ (Game View / scene.json の Main Camera) ===== */
export const gameCam = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

/* ===== Main Camera ギズモ (Scene View に見えるカメラ本体) ===== */
export const camGizmo = new THREE.Group();
camGizmo.name = "Main Camera";
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffb454, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.7), bodyMat);
  const lens = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 20), bodyMat);
  lens.rotation.x = -Math.PI / 2;
  lens.position.z = -0.5;
  camGizmo.add(body, lens);
  camGizmo.position.set(0, 2.2, 6);
  camGizmo.rotation.set(-0.28, 0, 0);
}
scene.add(camGizmo);

export const camHelper = new THREE.CameraHelper(gameCam);
camHelper.userData.editorOnly = true;
scene.add(camHelper);

/* ===== 編集対象オブジェクト ===== */
export const objects = [camGizmo];

/* ===== 選択 ===== */
export const app = { viewMode: "scene", selected: null, playing: false };

export const selBox = new THREE.BoxHelper(undefined, 0x4f9dff);
selBox.visible = false;
selBox.userData.editorOnly = true;
scene.add(selBox);

const selectListeners = [];
export function onSelect(fn) { selectListeners.push(fn); }

export function select(obj) {
  app.selected = obj;
  if (obj) {
    selBox.setFromObject(obj);
    selBox.visible = true;
  } else {
    selBox.visible = false;
  }
  for (const fn of selectListeners) fn(obj);
}

/* ===== シーン変更通知 (Hierarchy等が購読) ===== */
const sceneListeners = [];
export function onSceneChanged(fn) { sceneListeners.push(fn); }
export function notifySceneChanged() { for (const fn of sceneListeners) fn(); }

/* ===== 破棄ユーティリティ ===== */
export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

export function removeObject(obj) {
  if (!obj || obj === camGizmo) return;
  detachObject(obj);
  disposeObject(obj);
}

/* ===== Undo/Redo用: 破棄せずシーンから外す / 戻す ===== */
export function detachObject(obj) {
  if (!obj || obj === camGizmo) return;
  scene.remove(obj);
  const i = objects.indexOf(obj);
  if (i >= 0) objects.splice(i, 1);
  if (app.selected === obj) select(null);
  notifySceneChanged();
}

export function attachObject(obj, index) {
  scene.add(obj);
  if (Number.isInteger(index) && index >= 0 && index <= objects.length) {
    objects.splice(index, 0, obj);
  } else {
    objects.push(obj);
  }
  notifySceneChanged();
}
