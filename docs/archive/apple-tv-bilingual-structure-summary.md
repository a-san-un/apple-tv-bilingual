# Apple TV+ Bilingual Subtitles 構造整理メモ（最終版ドラフト）

## 概要
このメモは、README、`tree` による実ファイル確認、secondary recovery の調査ログをもとに、現時点で確認できている **ファイル構造** と **呼び出しフロー** を分離して整理した最新版ドラフトである。[1][2]

目的は、プロジェクト全体を「どのファイルが何を持つか」と「いつどこから render されるか」の 2 軸で追えるようにし、secondary subtitle や playback controls layout の差分確認をしやすくすることにある。[1][3][2]

## ファイル構造

### manifest / extension entry

`manifest.json` は拡張全体の登録点であり、content scripts の注入順、background service worker、popup / options などの入口を持つ。[1]

実ファイル確認では、top level に `manifest.json`、`background.js`、複数の content script 群、`popup.*`、`options.*`、CSS、辞書、docs、解析ログが並ぶ構成になっている。[1]

### background

`background.js` は service worker として動作し、外部 API 通信や runtime message の受け口など、ページ外側の拡張責務を持つ層である。[1]

この層は UI を直接描画するのではなく、popup/options や content script から来る要求を中継する土台として位置づけるのが自然である。[1]

### content

`content.js` は最終 wiring と composition root を担う中心ファイルであり、各 module を束ねて Apple TV+ 再生画面へ UI を注入する。[1]

ここには `buildUi`、`startBilingual`、`renderCurrentSnapshot`、`ensureSecondarySubtitleElement`、`renderSecondarySubtitle`、`syncSecondarySubtitleTrackBinding` など、全体起動と glue code が集まっている。[1][2]

### controller

controller 層の中心は `cue-controller.js` と `sync-interval-orchestrator.js` である。[2]

`cue-controller.js` は secondary track の bind/unbind、cuechange listener、primary cue change 後の rebuild、`syncSecondarySubtitleTrack()` による再解決を担う。一方 `sync-interval-orchestrator.js` は health 監視、miss count、secondary recovery trigger、force-rebind 判定を担う。[2]

### renderer

renderer 系には `panel-renderer.js`、`subtitle-blocks.js`、`subtitle-block-resolver.js`、`subtitle-view-resolver.js`、`overlay-block-resolver.js` などが含まれる。[1]

これらは raw cue を panel / overlay / current block 表示に使える形へ変換する中間層であり、`cue-controller.js` や `content.js` から呼ばれて UI 表示の実データを供給する。[1][2]

### overlay

overlay 系では `overlay-controller.js` がパネル非表示時の字幕 overlay を担当し、`overlay.css` がその見た目を支える。[1]

また secondary subtitle の実体は `content.js` 側の secondary subtitle element と、overlay 側の subtitle 表示で別経路を取るため、panel shell と overlay は明確に分離して考える必要がある。[1]

### settings

settings 系には `settings-bridge.js`、`settings-runtime.js`、`popup.html/js`、`options.html/css/js` が含まれる。[1][2]

`settings-bridge.js` は popup/options と content の橋渡しを担い、`settings-runtime.js` は読み込まれた設定を state に反映したうえで `cueController.syncSecondarySubtitleTrack(...)` や再初期化経路につなげる。[2]

### その他の補助層

`playback-controls-layout.js` は native controls の panel 回避補正、`runtime-observers.js` は DOM / playback 状態監視、`playbackContext.js` は content key や playback context の解決、`reinitialize-coordinator.js` は retry 付き再初期化を担当する。[3][2]

このため、secondary subtitle 周辺の不具合であっても、実際には settings、controller、layout、observer までまたがって追う必要がある。[3][2]

## 更新後の全体図

```text
manifest.json
  ├─ vtt-normalizer.js             WebVTT 正規化
  ├─ debug-logger.js              ログ基盤
  ├─ subtitle-track-resolver.js   textTracks から best track を選ぶ
  ├─ settings-bridge.js           popup/options と content の橋渡し
  ├─ debug-panel.js               デバッグ UI
  ├─ panel-renderer.js            パネル HTML の生成
  ├─ panel-ui.js                  パネル操作/UI 制御
  ├─ subtitle-blocks.js           subtitle block モデル
  ├─ subtitle-block-resolver.js   cue → block への変換
  ├─ overlay-block-resolver.js    overlay 用 block 変換
  ├─ subtitle-view-resolver.js    block → UI view への整形
  ├─ cue-controller.js            cuechange / bind / rebuild
  ├─ overlay-controller.js        overlay 表示制御
  ├─ runtime-observers.js         DOM / playback の監視
  ├─ playback-controls-layout.js  再生 UI の位置補正
  ├─ settings-runtime.js          設定読込・適用
  ├─ playbackContext.js           playback context / content key 処理
  ├─ reinitialize-coordinator.js  再初期化と retry
  ├─ sync-interval-orchestrator.js sync interval / secondary recovery
  └─ content.js                   composition root / UI 注入

background.js                     Service Worker / API 通信
popup.html / popup.js             popup 設定 UI
options.html / options.css / options.js  詳細設定 UI
overlay.css / panel.css           overlay / panel の CSS
dict/ejdict.json                  辞書データ
docs/...                          ドキュメント
repo-output/apple-tv-bilingual.txt テキスト出力
secondary-recovery-pass*.txt      secondary recovery 解析ログ
testlog.txt                       テストログ
```

## 呼び出しフロー

### 1. 設定変更時

設定変更時は popup/options 側から bridge を通じて content 側へ設定が渡り、`settings-runtime.js` が `requestedSecondaryLang` と反映済み settings を更新する。[2]

secondary language が有効で、`state.video` が存在する場合、`cueController.syncSecondarySubtitleTrack(state.video, resolvedSecondaryLanguage, renderSecondarySubtitle)` が呼ばれ、その後 `state.secondaryTrack = cueController.getBoundSecondaryTrack()` で controller 側の結果を state に戻す。必要ならその後 `restartBilingual(...)` による再初期化へ進む。[2]

```text
popup/options
  └─ settings-bridge / runtime message
       └─ settings-runtime.js
            ├─ state.requestedSecondaryLang 更新
            ├─ cueController.syncSecondarySubtitleTrack(...)
            └─ restartBilingual(...)
```

### 2. 起動時

起動時は `content.js` の `startBilingual()` が playback readiness を確認し、history context 同期、track bind、UI build、initial snapshot render の順で進む。[2]

このとき secondary track が存在すれば、`renderSecondarySubtitle(getCurrentCueText(state.secondaryTrack), state.secondaryTrack)` により初期描画が行われる。[2]

```text
content.js:startBilingual()
  ├─ syncHistoryContextWithPlayback(...)
  ├─ bindTracks()
  │    └─ syncSecondarySubtitleTrackBinding(...)
  ├─ buildUi()
  ├─ ensureSecondarySubtitleElement()
  └─ renderSecondarySubtitle(getCurrentCueText(...), state.secondaryTrack)
```

### 3. secondary cuechange 時

secondary track に bind されると、`cue-controller.js` が `cuechange` listener を張り、event 発火時に `renderSecondarySubtitle(cueText, track)` を呼ぶ。[2]

これが secondary lane の最も直接的な更新経路であり、secondary subtitle が正常に読めるときはこの経路が主経路として機能する。[2]

```text
secondary TextTrack cuechange
  └─ cue-controller.js:onCueChange(track)
       └─ renderSecondarySubtitle(cueText, track)
```

### 4. primary cuechange 時

primary cuechange 時には `cue-controller.js:onPrimaryCueChange()` が current block を更新し、必要に応じて subtitle block sequence / hold view / overlay view を再解決したうえで、secondary 側にも `renderSecondarySubtitle(sText, secondaryTrack)` を流す。[2]

このため secondary subtitle は secondary cuechange だけでなく、**primary cuechange ベースの rebuild** からも更新される。[2]

```text
primary TextTrack cuechange
  └─ cue-controller.js:onPrimaryCueChange()
       ├─ current block 更新
       ├─ subtitle view / overlay view 再解決
       └─ renderSecondarySubtitle(sText, secondaryTrack)
```

### 5. clear 時

secondary language が空になった場合や track が解決できなかった場合には、`unbindSecondarySubtitleTrack()` と `renderSecondarySubtitle("", null)` が呼ばれ、secondary subtitle DOM は明示的に clear される。[2]

これは「表示されない」を曖昧に放置するのではなく、secondary lane 無効時の状態を renderer 側へ明示的に伝える経路である。[2]

```text
secondaryLang なし / track 解決失敗
  ├─ unbindSecondarySubtitleTrack()
  └─ renderSecondarySubtitle("", null)
```

### 6. interval recovery 時

通常 cue イベントだけで回復しない場合、`sync-interval-orchestrator.js` が secondary lane の miss を監視し、一定条件で `triggerSecondaryRecovery()` から `syncSecondarySubtitleTrack(..., { forceRebind })` を起動する。[2]

その後、必要なら rebind と `rebuildCurrentSceneSubtitleBlocks()` が走り、secondary subtitle は interval 側からも回復を試みる。[2]

```text
sync-interval-orchestrator
  └─ health / miss count 監視
       └─ triggerSecondaryRecovery(...)
            └─ syncSecondarySubtitleTrack(..., { forceRebind })
                 ├─ bindSecondarySubtitleTrack(...) or refresh
                 └─ rebuildCurrentSceneSubtitleBlocks()
```

## secondary subtitle の位置づけ

`renderSecondarySubtitle()` は secondary subtitle DOM の単独描画関数だが、その入口は起動時、settings 変更時、secondary cuechange、primary cuechange、clear、interval recovery と多岐にわたる。[1][2]

したがって不具合解析では「renderer が壊れているか」だけでは不十分であり、どの入口から空文字や unreadable track が入っているかを切り分ける必要がある。[1][2]

## playback controls layout の位置づけ

`playback-controls-layout.js` は secondary subtitle そのものを描画しないが、panel や secondary subtitle DOM を anchor に使って Apple TV+ 側 controls の位置を補正する。[3]

そのため secondary subtitle や panel 周辺の DOM 状態が変化すると、layout 側の safe area 計算や managed style 適用にも影響が及ぶ可能性がある。[3]

## 現時点の結論

このプロジェクトは、`content.js` 単独の大型スクリプトではなく、manifest 順に注入された module 群を `content.js` が最終接続する構造になっている。[1]

また secondary subtitle は、`cue-controller.js` による cuechange 駆動と `sync-interval-orchestrator.js` による interval recovery を併用することで表示維持を図る多段構造になっている。[2]

構造把握では **ファイル構造** と **呼び出しフロー** を分離して見ることで、「何があるか」と「いつ動くか」を混同せずに追える状態になる。[1][2]