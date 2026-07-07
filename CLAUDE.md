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
  開始時にプレイヤーとカメラのポーズをスナップショットし、停止時に完全復元する。
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
- カメラの再生中挙動 (Main CameraのInspectorで選択、`camGizmo.userData.playMode`):
  "fixed" 固定 / "follow" 追従 (開始時の構図を保ち位置をlerp) /
  "lookat" 注視 (位置固定でプレイヤーへquaternionをslerp)。停止時はカメラも復元。
- クリップ自動再生 (`userData.autoClip` にクリップ名): 非プレイヤーのオブジェクトを
  再生モード中ループ再生。InspectorのCharacterセクションで選択。停止時に復元。
  scene.json は version 5 (v3: isPlayer/moveSpeed, v4: camera.playMode, v5: autoClip)
- リグ付き (ボーン/スキン) モデルのプレイヤー動作は検証済み (Mixamoマネキンで確認、
  エディタ側の変更は不要だった)。アセット準備の定型手順:
  Mixamoから Walking (In Place・With Skin) と Idle (Without Skin) をFBX Binaryで取得 →
  BlenderでWalkingをインポートしアクション名を "walk" にリネーム → Idleを追加インポートして
  アクション名を "idle" に → 両アクションをメインアーマチュアのNLAトラックに積む (muteでよい) →
  Idle由来の余分なアーマチュアを削除 → glTF (GLB, export_animation_mode='ACTIONS') で書き出し。
  クリップ名が "walk" でない場合も先頭クリップが歩きとして使われる (play.js のフォールバック)
- 当たり判定 (再生モード中): 再生開始時に非プレイヤーの全メッシュのAABB (Box3) を収集し、
  プレイヤーの移動を軸分離で判定 (壁ずりスライド)。STEP=0.35 以下の段差は乗り越え可、
  ジャンプ中は足元が上がるので低い障害物を飛び越せる。めり込み時は脱出方向の移動を許可。
  障害物のAABBは再生開始時に固定 (動く障害物には追従しない)
- 障害物の上に乗れる (supportHeightAt で足元の支持面を毎フレーム計算)。
  端から歩き出すと落下、落下中に支持面へ着地。低い段差は登り降りに自動追従
- 再生中は非表示 (`userData.hideInPlay`): 見えない壁用。再生中 visible=false、当たり判定は残る
- トリガー (`userData.isTrigger`): 当たり判定なし・再生中非表示・プレイヤーが入った瞬間に
  トースト表示 (`🚩 {name} を通過!`)。出て再度入ると再通知。ゴール/チェックポイント用。
  どちらもInspectorのPlay Settingsセクションで設定、scene.json は version 6
- 編集QoL: F = 選択オブジェクトへ視点フォーカス、Delete = 選択オブジェクトを削除 (Undo可)

## 今後の候補 (未実装)

- Hierarchyの親子関係・グループ化 (scene.json version 7 が必要)
- ライトをオブジェクトとして配置・編集
- 再生モードの拡張 (テクスチャアニメーション、動く障害物への当たり判定追従)
