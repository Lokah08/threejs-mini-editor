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

- コンポーネントシステムは `js/components.js`。各オブジェクトの `userData.components` に
  `[{ type, ...パラメータ }]` の配列で保持 (パラメータ省略時はデフォルト値)。
  種類は `COMPONENT_TYPES` に登録: params定義 (InspectorのUIが自動生成される) と
  ライフサイクル (`start` / `update` / `onTouch`)。touchable: true のものは当たり判定から
  除外され、プレイヤー接触で `onTouch` が呼ばれる。実行系は再生モード中のみ動作し、
  ポーズは play.js が復元、Collectible等の非表示化は compPlayStop が復元する。
  新しい振る舞いは COMPONENT_TYPES への追加だけで完結する。
- ライトは `js/lights.js`。Group (実ライト + 電球ギズモ + spot/directional用のtarget) を
  objects に入れるので、選択・移動・複製・保存・コンポーネント付与がそのまま効く。
  `userData.kind === "light"`、種類は `lightType` (point/spot/directional)。
  設定値は userData (lightColor/intensity/distance/angle) に持ち、`applyLightSettings()`
  で実ライトへ反映する。spot/directional は「グループの真下」を照らす (回転で向きを変える)。
  当たり判定からは除外、電球ギズモ (`userData.editorOnly`) は再生中に隠れる。
  シーン全体のベース照明は state.js の `ambientLight` / `sunLight` で、
  Main Camera の Inspector から強さを調整する (暗くするとライトが映える)。
- サウンドは `js/audio.js`。ブラウザの自動再生制限のため、▶ボタンのクリックを起点に
  AudioContext を作る。BGMは再生モード中ループ、効果音は `playSE(key)`。
  コンポーネントからは `ctx.sound(名前)` で鳴らす (Collectible/Trap/Goal は
  パラメータで音を選べる)。音源が無い環境ではエラーを出さず無音になる。
- アセットパック (`assets/` フォルダ、gitignore対象) は `assets/index.json` の目録で
  Assetsパネルに一覧表示 (js/assets.js)。読み込みは `importAssetGLB(path)` で、
  scene.json には `assetPath` 参照で保存される (Base64埋め込みなしで軽量)。
  目録はフォルダにGLBを追加したら再生成する (files配列にファイル名を足すだけでもよい)。

- エディタ内AIチャットは `js/chat.js`。ビューポート下のドロワー (💬 AI ボタン)。
  Anthropic SDK (`@anthropic-ai/sdk`、importmap で esm.sh から動的 import) をブラウザから直接呼ぶ
  (`dangerouslyAllowBrowser`)。APIキーは localStorage (`miniEditor.apiKey`) のみに保存し、
  scene.json には含めない。モデルは `claude-opus-5`、サーバー側フォールバック
  (`fallbacks: "default"`) を付けて呼び、未対応の 400 が返ったら外して再試行する。
  Claude にはツール (define_component / attach_component / detach_component /
  remove_component_type) を渡し、返ってきた tool_use をその場で実行して結果を返す手動ループ。
  システムプロンプトにコンポーネントの契約 (定義の形、ctx API) と現在のシーン一覧を毎回入れる。
- カスタムコンポーネントは components.js の `registerComponent(name, code)`。code は
  「定義オブジェクトに評価される JS 式」で、`new Function("THREE", ...)` で評価・検証して
  COMPONENT_TYPES に登録する (組み込みは上書き不可)。ソースは `CUSTOM_COMPONENTS` に保持し、
  localStorage (`miniEditor.customComponents`) と scene.json の `customComponents` (v11) に保存。
  scene.json 読込時は objects より先に登録する。登録簿の変化は `onComponentsChanged(fn)` で
  購読 (Inspector の追加メニューを作り直す)。生成コードはページ内で実行されるので、
  ローカルの単独利用が前提。

- 背景 (スカイボックス) は `js/skybox.js`。等距円筒パノラマ画像を TextureLoader で読み
  `EquirectangularReflectionMapping` + sRGB で `scene.background` に貼る (Scene/Game 両ビューに映る)。
  候補は `assets/index.json` の `skyboxes` (パス配列)。現在値は `skyState.path` (null = 単色)、
  Main Camera の Inspector「背景」で切り替え (Undo可)、scene.json は `env.skybox` (v12)。
  `scene.environment` (反射・IBL) には使っていない。

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
- 障害物の上に乗れる (supportAt: 真下へのレイキャストで足元の支持面を毎フレーム計算。
  AABBだと円形の床の四隅に見えない張り出しができるため、支持面判定のみ実形状で行う)。
  端から歩き出すと落下、落下中に支持面へ着地。低い段差は登り降りに自動追従。
  支持面が無ければ -Infinity (奈落) で、プレイヤーの足元原点補正は state.footOff
  (Cube等の中心原点でも正しく接地する)
- 動く床 (Rotator/Mover持ち) に立つと「乗車」(state.ride) し、床のローカル座標を保持して
  回転・移動に追従する。降りるか空中に出ると解除
- 再生中は非表示 (`userData.hideInPlay`): 見えない壁用。再生中 visible=false、当たり判定は残る
- トリガー (`userData.isTrigger`): 当たり判定なし・再生中非表示・プレイヤーが入った瞬間に
  トースト表示 (`🚩 {name} を通過!`)。出て再度入ると再通知。ゴール/チェックポイント用。
  どちらもInspectorのPlay Settingsセクションで設定、scene.json は version 6
- 編集QoL: F = 選択オブジェクトへ視点フォーカス、Delete = 選択オブジェクトを削除 (Undo可)
- コンポーネント6種: Rotator (回転)、Mover (往復移動)、Collectible (取ると消えて
  💎カウント表示)、Trap (触れるとリスポーン)、Chaser (索敵範囲内のプレイヤーを追跡、
  接触でリスポーン、見失うと持ち場へ帰る。壁すり抜けの幽霊タイプ)、
  Goal (触れるとSTAGE CLEARバナー。`requireAll` でアイテム全収集を条件にできる。
  クリア後は `state.cleared` で操作・リスポーンを停止)。Rotator/Mover持ちのAABBは毎フレーム追従。
  奈落 (KillZ): スタートより12下に落ちるとリスポーン
- 当たり判定の種類 (`userData.collider`, InspectorのPlay Settingsで設定):
  "solid" 実体 (既定・AABBでぶつかる) / "walkable" 床のみ (横は当たらず上に乗れる。
  段差許容が STEP_WALK=0.7 に広がる。階段・スロープ用) / "none" すり抜け (ゲート・装飾用)。
  AABBは形を箱で包むため、階段は斜めの壁、アーチは塞がった門になってしまう。それを
  オブジェクト単位で回避するための設定
- GLBのティント (`userData.tint`, InspectorのColorで設定): 全メッシュの元色
  (`material.userData.origColor` に保持) に指定色を掛ける。#ffffff で元通り。
  scene.json は version 11 (v7: assetPath/components, v8: tint, v9: collider,
  v10: ライト (lightType/lightColor/intensity/distance/angle) と env (環境光の強さ),
  v11: customComponents (チャットで作った部品のソース), v12: env.skybox)
- 音源ファイル (`assets/audio/`, gitignore対象):
  BGM.wav (BGM) / Coins.wav (コイン) / heart.wav (ハート) / key.wav (鍵・クリア) /
  trap.wav (トラップ・敵) / falling.wav (落下)。追加するときは audio.js の SE_FILES と
  components.js の sound パラメータの options に足す

## 今後の予定 (優先順)

作業の分担についての方針:
- **エディタ自体を作る** (新機能・設計変更、ファイル横断の改修) → Claude Code でやる
- **エディタで作品を作る** (コンポーネントを1個増やす等) → エディタ内AIチャットでやる
  この分担のため、エディタ内チャットは簡素な作りでよい
  (components.js に部品を追記して即使える、程度で十分価値がある)

1. ~~ライティング~~ / ~~サウンド (BGM・効果音)~~ → 実装済み
   ~~背景のスカイボックス化~~ → 実装済み (js/skybox.js)。
   残り: 位置つき音 (PositionalAudio、篝火のパチパチ等。音源が見つかったら)、
   スカイボックスを scene.environment にも使う (反射) オプション、任意画像のD&D対応
2. ~~エディタ内AIチャット~~ → 実装済み (js/chat.js)。
   候補: 生成した部品を components.js に書き戻すエクスポート、シーン操作ツールの追加 (配置・移動)

## その他の候補 (未実装)

- Hierarchyの親子関係・グループ化 (scene.json のバージョン更新が必要)
- コンポーネント追加案: スイッチで開くドア、消える床、ジャンプ台、タイマー制限
- 再生モードの拡張 (テクスチャアニメーション)
