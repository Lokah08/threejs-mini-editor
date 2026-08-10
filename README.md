# Mini Editor — Three.js

Unityライクな3ペイン構成のブラウザ3Dエディタ。

```
[Hierarchy]   [Viewport]              [Inspector]
[Assets]      Scene View / Game View   Position / Rotation / Scale
models/                                Material / Camera FOV
textures/
scenes/
```

## 起動方法

ES Modulesを使っているため、ファイル直開きではなくローカルサーバーが必要です。

- **VSCode**: Live Server拡張で `index.html` を開く (右クリック → Open with Live Server)
- **コマンドライン**: `npx serve .` または `python -m http.server`

Three.js本体はCDN (unpkg) から読み込むため、ビルド不要・npm install不要です。

## 機能

- **Scene View**: 自由視点 (左ドラッグ回転 / 右ドラッグパン / ホイールズーム)
- **Game View**: シーン内の Main Camera 視点。最終画角の確認用
- **ギズモ**: 移動(W) / 回転(E) / 拡縮(R)。Unityライクな矢印・リング・ハンドル
- **Hierarchy**: オブジェクト一覧の表示とクリック選択
- **Undo/Redo**: Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)。追加・削除・移動・回転・拡縮・色・テクスチャ等に対応
- **複製**: Ctrl+D で選択オブジェクトを複製
- **再生モード**: ▶でプレイヤーをWASD操作 (Spaceジャンプ)。GLB同梱のwalk/idleクリップを自動再生
- **カメラ挙動**: 再生中のMain Cameraを「固定 / 追従 (構図キープ) / 注視」から選択
- **クリップ自動再生**: 非プレイヤーのオブジェクトに指定したクリップを再生中ループ再生
- **当たり判定**: 再生中は壁や家具にぶつかる (壁ずりスライド、低い段差は乗り越え可、障害物の上に乗れる)
- **見えない壁 / トリガー**: 「再生中は非表示 (コライダー)」で見えない壁、「トリガー」で通過検知 (ゴール判定など)
- **当たり判定の種類**: 実体 / 床のみ (階段・坂を登れる) / なし (ゲートをくぐれる) をオブジェクトごとに選択
- **編集ショートカット**: F (選択にフォーカス) / Delete (削除) / Ctrl+Z/Y (Undo/Redo) / Ctrl+D (複製)
- **コンポーネント**: Rotator (回転) / Mover (往復) / Collectible (収集) / Trap (リスポーン) / Chaser (追跡する敵) / Goal (クリア判定) をオブジェクトに着脱
- **アセットフォルダ**: `assets/` に置いたGLBパックをAssetsパネルから配置 (scene.jsonへはパス参照で保存)
- **ライト**: ポイント / スポット / 平行光をオブジェクトとして配置、色・強さ・距離を調整。環境光の強さも変更可
- **サウンド**: 再生モード中のBGMループと効果音 (収集・トラップ・ゴール・落下)。音源は `assets/audio/`
- **scene.json**: シーンの保存・読み込み (モーダル / ファイル選択 / D&D)
- **GLB入出力**: .glb/.gltf のインポート (D&D対応)、シーン全体のGLB書き出し

## ファイル構成

| ファイル | 役割 |
|---|---|
| `js/state.js` | 共有状態: シーン、カメラ、オブジェクト一覧、選択管理 |
| `js/history.js` | Undo/Redo (コマンド方式、Ctrl+Z / Ctrl+Y) |
| `js/hierarchy.js` | Hierarchyパネル (一覧表示・選択) |
| `js/play.js` | 再生モード (プレイヤー操作、クリップ再生) |
| `js/primitives.js` | プリミティブ生成、手続きテクスチャ |
| `js/controls.js` | オービットカメラ、クリック選択、本体ドラッグ移動 |
| `js/gizmo.js` | トランスフォームギズモ (移動/回転/拡縮) |
| `js/inspector.js` | Inspectorパネルの表示と入力 |
| `js/io.js` | scene.json / GLB の入出力 |
| `js/ui.js` | ビュータブ、オーバーレイ |
| `js/main.js` | エントリポイント、メインループ、初期シーン |

## 既知の仕様

- scene.json にGLBモデルはBase64で丸ごと埋め込まれる (大きいモデルはJSONが肥大化する)
- ギズモはローカル軸 (Unityの Local モード相当)
- GLB書き出しにはエディタ専用ヘルパー (グリッド等) と Main Camera 本体は含まれない
