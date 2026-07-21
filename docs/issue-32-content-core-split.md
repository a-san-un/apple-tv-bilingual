# Issue #32 Content Core Split

## 1. この文書の役割

### 1.1 目的

この文書は、Issue #32 における `content.js` の責務整理と段階分割を、**実装運用の観点**で管理するための文書である。

主目的は次の 4 点である。

- subtitle sync / recovery 改善を、`content.js` への追記ではなく controller / resolver 側への責務移送として進める
- `content.js` を thin coordinator に近づけるため、分割対象とラウンド順を明確にする
- 各ラウンドで「今回どこを触るか」「どこは触らないか」「何をもって完了とするか」を固定する
- NLM 併用時にも、相談対象の責務境界と差分範囲をぶらさずに進められるようにする

### 1.2 扱うもの

この文書で扱うものは次のとおり。

- Issue #32 における `content.js` コア分割の目的
- 現在位置と進行中の主線
- 分割対象の優先順位
- ラウンド単位の作業スコープ
- 完了条件と確認観点
- 実装時に見るべきログと切り分け観点

### 1.3 扱わないもの

この文書では次を正本として扱わない。

- subtitle sync / recovery の truth / health / lane state の詳細設計
- panel / overlay / popup の UI 詳細仕様
- phase 全体の進捗一覧や他 issue を含めた親ロードマップ
- AI セッションテンプレ全文
- セッションごとの実況メモや一時ログ

### 1.4 他ドキュメントとの分担

文書の分担は次のように整理する。

- `docs/content-architecture.md`
  - content 層全体の設計正本
- `docs/issue-32-content-core-split.md`
  - Issue #32 の分割実装運用正本
- `docs/ai-session-templates.md`
  - AI セッション運用テンプレ
- `docs/README.md`
  - docs 全体の入口と参照案内
- `docs/archive/`
  - 過去ラウンドや完了済み調査ログの保管先

---

## 2. 背景

### 2.1 Issue #32 の主題

Issue #32 は、subtitle sync / recovery の改善そのものに加えて、`content.js` を巨大な実装本体の置き場から外し、controller / resolver / helper / layout module 側へ責務を段階的に移すための issue である。

そのため、この issue の主題は単なる不具合修正ではなく、次の 2 層を同時に持つ。

- subtitle sync / recovery の truth / runtime / UI 境界整理
- `content.js` のコア責務分割と thin coordinator 化

### 2.2 現在の問題群

現在の `content.js` 周辺には、次のような問題がある。

- subtitle sync / recovery の改善を `content.js` 側の追記で吸収しやすい
- large seek 後の secondary missing / recovery / force-rebind まわりの責務が追いにくい
- observer / bootstrap / retry / reinitialize が同じ後半領域に密集しやすい
- UI shell / DOM 管理 / layout bridge / recovery trigger が近接しており、修正時の影響範囲が読みにくい
- 実装ラウンドごとのスコープが曖昧だと、構造整理と仕様変更が混ざりやすい

### 2.3 今回の狙い

今回の狙いは、巨大ファイルを一気に割ることではない。  
あくまで **責務のまとまりごとに、小さなラウンドで安全に外へ出す** ことである。

その際の基本姿勢は次のとおりとする。

- 1 ラウンド 1 主題
- 既存挙動を壊さない
- controller 優先 + local fallback を基本にする
- `content.js` に新しい判定本体を増やさない
- docs 上でも「何をどこへ寄せるか」を明示したうえで着手する

---

## 3. 現在位置

### 3.1 すでに完了したこと

Issue #32 の流れの中で、すでに次の到達点がある。

- `SubtitleBlockSequence` を truth source として扱う方向が固まっている
- current / panel / overlay / history の境界整理方針が固まっている
- secondary recovery は runtime first / merged assists で扱う方針が固まっている
- `cue-controller.js` 側に lane state / recovery 判定を寄せる方向が固まっている
- `playbackContext.js` が最初の実ファイル分割単位として導入済みである
- playback controls layout は `playback-controls-layout.js` を正本とする構成へ整理済みである
- `content.js` 側に secondary recovery 判定結果と sync 実行結果を観測するログが入っている

### 3.2 進行中の主線

現在の主線は次の 2 本である。

- secondary recovery の Runtime First 方針を実機ログで安定化すること
- `content.js` 後半の coordinator / reinitialize / retry / result bridge / sync interval 周辺を、次の実分割候補として整理すること

特に、`content.js` 側に recovery 条件や missCount 管理を増やすのではなく、controller 側で判定し、`content.js` は trigger / logging / bridge に留める方針を守ることが重要である。

### 3.3 現時点の到達点

現時点では次の状態まで来ている。

- large seek 後の secondary recovery / force-rebind 判定は controller 側で進められている
- rebind 試行そのものが走っているかどうかをログで切り分けられる
- `playbackContext.js` により、playback page context / content key / history context は分離済みである
- playback controls layout も module 側を正本とする接続へ整理済みである
- 一方で、reinitialize / retry / result bridge、secondary subtitle DOM、sync interval orchestration などは、まだ `content.js` 側にまとまりとして残っている

---

## 4. 分割対象

### 4.1 content.js に残すもの

最終的に `content.js` に残すものは次の責務である。

- Apple TV+ 再生画面への attach / detach
- lifecycle 管理
- bootstrap / cleanup の入口
- observer / timer の起動と停止
- settings / storage / message bridge の配線
- controller / resolver / renderer の呼び出し配線
- large seek 検知のような薄い runtime fact の記録
- 観測ログの入口

### 4.2 content.js から外へ出すもの

段階的に外へ出す対象は次のとおり。

- subtitle sync / recovery の本体判定
- health 集約
- current / history / panel / overlay の truth 解決本体
- playback context / content key / history context の詳細実装
- reinitialize / retry / result bridge の内部処理
- secondary subtitle DOM の探索 / host 確保 /描画導線
- sync interval の詳細 orchestration
- layout 計算や managed style の本体
- runtime missing / missCount / force-rebind / terminated の条件本体

### 4.3 現在の主要分割単位

現在、Issue #32 で明示的に扱う分割単位は次のとおり。

- `playbackContext`
- playback controls layout
- reinitialize / retry / result bridge
- secondary subtitle DOM 管理
- sync interval orchestration
- initial cue recovery

このうち、前二者は導入済みまたは完了済みの先行例として扱い、残りを次ラウンド候補とする。

---

## 5. 実装ラウンド

### 5.1 Round A: playbackContext

目的は、playback page context / content key / history context を `content.js` 本体から分離することだった。

対象は次のような関数群である。

- `getPlaybackContext`
- `getVideoAndDialog`
- `isPlaybackPageReady`
- `getPlaybackContextLogPayload`
- `normalizeContentKeyPart`
- `normalizeMediaSourceKey`
- `getPlaybackTitleKey`
- `resolvePlaybackContentKey`
- `getCurrentVideoSrcKey`
- `getHistoryBucketForContentKey`
- `loadHistoryForContentKey`
- `saveHistoryForContentKey`
- `switchHistoryContext`
- `syncHistoryContextWithPlayback`

現状では `playbackContext.js` が追加済みで、`window.ATVB.createPlaybackContextController` を介した controller 優先 + local fallback の接続になっている。

### 5.2 Round B: playback controls layout

目的は、playback controls の位置・幅・translate 管理を `content.js` から module 側へ寄せることだった。

このラウンドで扱った主な対象は次のとおり。

- `PLAYBACK_CONTROLS_LAYOUT`
- `getPlaybackControlsLayoutTargets`
- `applyManaged*` / `clearManaged*`
- `clearPlaybackControlsTransforms`
- `adjustPlaybackControlsForPanel`

現状では `playback-controls-layout.js` を正本とし、`content.js` は layout controller instance を生成して bridge を配る薄い coordinator になっている。

### 5.3 Round C: reinitialize / retry / result bridge

次の有力候補は、再初期化まわりを 1 主題として扱うラウンドである。

対象候補は次のとおり。

- reinitialize entry helper
- track resolve retry helper
- settings reload 後の反映 helper
- result bridge helper
- `reinitializeSubtitlePipeline` 周辺の入口整理

このラウンドでは、再初期化の判定本体を増やすのではなく、entry / retry / result bridge の境界を可視化し、必要なら controller 化の足場を作る。

### 5.4 Round D: secondary subtitle DOM

secondary subtitle DOM 管理も、独立した 1 グループとして分けやすい。

対象候補は次のとおり。

- `getSecondarySubtitleElements`
- `getSecondaryRenderLogPayload`
- `ensureSecondarySubtitleElement`
- `renderSecondarySubtitle`

このラウンドでは truth 判定や recovery 判定を持ち込まず、DOM 探索・正規化・host 確保・表示反映だけに責務を限定する。

### 5.5 Round E: sync interval orchestration

sync interval 系は runtime recovery を駆動する orchestration 層としてまとまりがある。

対象候補は次のとおり。

- `buildSecondarySyncLogPayload`
- `buildSyncIntervalSubtitleSnapshot`
- `syncIntervalRefreshPlaybackContext`
- `syncIntervalDetectLargeSeek`
- `syncIntervalRunSecondaryRecoveryPass`
- `ensureSecondaryTrackSyncInterval`

このラウンドでは、判定本体を controller 側へ置いたまま、`content.js` 側の orchestration を薄くすることを狙う。

### 5.6 Round F: initial cue recovery

initial cue recovery は、large seek 後の recovery 本線とは別に、初期表示や attach 後の立ち上がり安定化として整理する候補である。

ただし、これは reinitialize / sync interval / controller 境界と干渉しやすいため、単独主題として扱う。  
他ラウンドと同時着手は避ける。

---

## 6. ラウンドごとの進め方

### 6.1 1 ラウンド 1 主題

各ラウンドでは、主題となる責務塊を 1 つだけ選ぶ。

例:

- 今回は reinitialize / retry / result bridge だけ
- 今回は secondary subtitle DOM だけ
- 今回は sync interval orchestration だけ

複数主題を同時に触ると、構造整理と仕様変更が混ざりやすくなるため避ける。

### 6.2 変更してよい範囲

各ラウンドで変更してよいのは、原則として次の範囲に限る。

- 対象責務の section boundary 整理
- module / controller 側への物理移送
- 呼び出し配線の差し替え
- local fallback の暫定追加
- 既存ログの移設または最小限の観測点追加
- 構文確認と manifest 読み込み順の整合に必要な変更

### 6.3 変更しない範囲

原則として、同じラウンドで次は変更しない。

- UI 見た目の調整
- truth / recovery パラメータの再設計
- unrelated な observer 条件追加
- 他責務のついで修正
- 新しい feature の混入
- `content.js` への新しい本体判定の追加

### 6.4 完了条件

1 ラウンドの完了条件は次のようにそろえる。

- 対象責務の境界が docs とコードで説明できる
- `content.js` 側が thin bridge / coordinator に寄っている
- 既存挙動を壊していない
- 最低限の構文確認が通る
- 実機で主経路が確認できる
- local fallback を残すなら、その撤去条件が明示されている

---

## 7. 現在の次アクション

### 7.1 最優先候補

次の着手候補としては、次の順を推奨する。

1. reinitialize / retry / result bridge
2. sync interval orchestration
3. secondary subtitle DOM
4. initial cue recovery

### 7.2 着手順

特に次ラウンドでは、次の順で入るのが安全である。

1. `content.js` 内で対象セクションの begin/end を明示する
2. 関連 helper のまとまりを確定する
3. 依存先を洗い出す
4. module 化または controller 化の入口を用意する
5. `content.js` 側を controller 優先 + local fallback 接続に寄せる
6. 実機で主経路を確認する
7. docs に導入範囲と残課題を反映する

### 7.3 確認項目

各ラウンドで最低限見る項目は次のとおり。

- `node --check` 相当の構文確認
- `manifest.json` の読み込み順
- `window.ATVB` への公開名
- `content.js` 側の参照名
- 実際に fallback / controller のどちらが走っているか
- Apple TV+ 再生画面で初期化エラーがないか
- panel / overlay / subtitle sync の主経路が壊れていないか

---

## 8. ログと検証

### 8.1 観測ポイント

Issue #32 の分割では、ログは次の切り分けに使う。

- recovery 判定が出たか
- trigger が実行されたか
- rebind が行われたか
- track が再取得されたか
- それでも active cues が戻らないか

この考え方は、recovery ロジック本体と Apple TV+ 側挙動を混同しないために重要である。

### 8.2 実機確認観点

実機では、少なくとも次を確認する。

- 通常再生で panel / overlay が壊れない
- large seek 後に primary が復帰する
- secondary recovery / force-rebind が必要なときだけ走る
- panel 開閉や controls 再描画で layout が崩れない
- 再初期化後に二重 attach や二重 render が出ない
- user scroll と auto-follow が不自然に競合しない

### 8.3 Known Issue の切り分け

現時点では、次を拡張側ロジックの問題と即断しない。

- recovery / force-rebind は走っている
- track の再バインドも行われている
- それでも JA track の active cues が復帰しない

このケースは Apple TV+ 側挙動に依存する Known Issue として切り分ける。  
そのため、Issue #32 の分割では「どこまで拡張側で制御できるか」を docs 上でも明確に残す。

---

## 9. 注意

- この文書は Issue #32 の **実装運用正本** であり、subtitle sync 設計そのものの正本ではない
- truth / health / recovery / UI 境界の設計は `docs/content-architecture.md` を参照する
- 1 回のスレッドで複数主題を同時に進めない
- `content.js` に一時 state や分岐を足す場合も、次に消す出口を前提にする
- local fallback は恒久化しない
- docs の更新は、実装後ではなく着手前にスコープを固定できる粒度で行う
- 行数削減は重要だが、より重要なのは責務が正しい場所へ移っていることである
