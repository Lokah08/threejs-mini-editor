# Mini Editor プロジェクトについて

Three.js製のUnityライクなブラウザ3Dエディタ。ビルドステップなし、
ES Modules + importmap (three本体とaddonsはunpkg CDN) で動く。

## 動作確認

ローカルサーバーで index.html を開く (`npx serve .` など)。
ES Modulesのためファイル直開き (file://) では動かない。

## アーキテクチャ

- `js/state.js` が唯一の共有状態置き場。シーン/カメラ/objects配列/選択(app.selected)。
  選択の変更は必ず `select(obj)` を通す。UI側は `onSelect(fn)` で購読する。
  オブジェクトの増減・改名は `notifySceneChanged()` で通知し、`onSceneChanged(fn)` で
  購読する (Hierarchyパネルが購読)。
- Undo/Redoは `js/history.js` のコマンド方式 (`{undo, redo, obj?}` を積む)。
  編集操作を新設するときは必ず対応するコマンドを push する。
  追加/削除は `pushAdd` / `pushDelete` (disposeせず `detachObject` / `attachObject` で
  シーンから外すだけ。破棄は履歴から溢れた時点で `disposeIfOrphan` が判断)。
  Transformは操作開始時に `snapshotTransform`、確定時に `pushTransform`。
  Inspector入力は focus で控えて change で確定 (input中は履歴に積まない)。
- `objects` 配列に入っているものだけが「編集対象」(選択・保存・書き出しの対象)。
  グリッド等のエディタ専用物は `userData.editorOnly = true` を付けて配列に入れない。
- Main Camera はシーン内のギズモ (`camGizmo`) として存在し、毎フレーム `gameCam` に姿勢を同期。
- GLBインポートしたモデルは gltf.scene (Group) を1つの選択単位として objects に入れる。
  `userData.kind === "glb"`、元バイナリは `userData.glbBase64` に保持 (scene.json 保存用)。
  同梱アニメーションは `userData.clips` (AnimationClip[]) に保持 (バイナリ由来なので
  scene.json 経由の復元でも消えない)。
- 再生モードは `js/play.js`。`app.playing` が true の間は編集操作を全て無効化
  (各モジュールのハンドラ先頭で `if (app.playing) return`)。プレイヤーは
  `userData.isPlayer` (シーンに1体、Inspectorで排他設定)、速度は `userData.moveSpeed`。
  開始時にプレイヤーのポーズをスナップショットし、停止時に完全復元する。
  クリップは "walk" / "idle" を名前で探す (walkが無ければ先頭クリップ)。

## 規約

- UI文言は日本語
- OrbitControls / TransformControls は使わず自前実装 (controls.js / gizmo.js)。
  置き換える場合は選択・ドラッグ移動との排他制御に注意
- scene.json のフォーマットを変えるときは `meta.version` を上げる

## 実装済みの主な機能

- Hierarchyパネル (`js/hierarchy.js`): objects の一覧表示・クリック選択。
  現状はフラットな一覧のみ (親子関係・グループ化は未対応)
- Undo/Redo (Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z): 追加・削除・複製・Transform・
  名前・色・テクスチャ・FOV・GLBインポートが対象。scene.json読込で履歴リセット
- オブジェクト複製 (Ctrl+D): プリミティブは同設定で再生成、GLBは glbBase64 から
  再インポート。少しオフセットして配置
- 再生モード (▶ボタン): プレイヤーをWASD/矢印で移動、Spaceジャンプ、
  移動中はwalk・停止中はidleクリップをクロスフェード再生。Escか■で停止。
  scene.json は version 3 (isPlayer / moveSpeed を追加)

## 今後の候補 (未実装)

- Hierarchyの親子関係・グループ化 (scene.json version 4 が必要)
- ライトをオブジェクトとして配置・編集
- 再生モードの拡張 (追従カメラ、当たり判定、プレイヤー以外のクリップ自動再生)
