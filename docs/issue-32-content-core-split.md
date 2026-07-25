# Issue #32 Content Core Split

## 1. 目的・スコープ

### 1.1 この文書の役割

この文書は、Issue #32 における `content.js` の責務整理と段階分割を、**設計と実装運用の観点**で扱う正本である。

主目的は、`content.js` を巨大な実装本体の置き場として維持するのではなく、thin coordinator に近づけるために、どの責務をどの module 側へ移すかを明確にすることにある。

### 1.2 この文書で扱うもの

この文書で扱うものは次のとおり。

- Issue #32 における `content.js` コア分割の目的
- 現在の構造と最終ゴール
- `content.js` に残す責務と外へ出す責務
- `content.js` の 7 セクション設計
- Section 4 / Section 6 を含む、各セクションの正本の読み方
- secondary sync の責務境界
- Known Issue の切り分けラベル
- ラウンドごとの意味づけの要約

### 1.3 この文書で扱わないもの

この文書では、次を主目的として扱わない。

- 各ラウンドの詳細な完了報告
- セッションごとの実況ログや時系列メモ
- `node --check` 通過記録や行数変化の記録
- subtitle truth / health / lane state の詳細設計
- panel / overlay / popup の UI 詳細仕様
- 他 issue を含めた親ロードマップ

これらの詳細は、必要に応じてアーカイブ文書や関連ドキュメントを参照する。

### 1.4 他ドキュメントとの分担

文書の分担は次のように整理する。

- `docs/content-architecture.md`
  - content 層全体の設計正本
- `docs/issue-32-content-core-split.md`
  - Issue #32 における `content.js` 分割方針の正本
- `docs/ai-session-templates.md`
  - AI セッション運用テンプレート
- `docs/archive/issue-32-content-core-split-archive.md`
  - 過去ラウンドの詳細記録、実況、観測ログの保管先

---

## 2. 現在の構造と最終ゴール

### 2.1 この issue の設計上の主題

Issue #32 の主題は、単なる subtitle sync / recovery の不具合修正ではない。  
`content.js` を coordinator として薄く保ちつつ、subtitle sync / recovery、layout、observer、reinitialize などの実装本体を、責務ごとに適切な module へ移すことである。

したがって、この issue では次の 2 点を同時に扱う。

- subtitle sync / recovery を `content.js` への追記で吸収しない構造へ寄せること
- `content.js` を thin coordinator に近づけること

### 2.2 `content.js` に残す責務

最終的に `content.js` に残す責務は、次のような coordinator / wiring 中心のものとする。

- Apple TV+ 再生画面への attach / detach
- lifecycle 管理
- bootstrap / cleanup の入口
- observer / timer の起動と停止
- settings / storage / message bridge の配線
- controller / resolver / renderer の呼び出し配線
- runtime fact の記録
- 観測ログの入口
- module public API を top-level で束ねる wiring

### 2.3 `content.js` から外へ出す責務

`content.js` から段階的に外へ出す責務は、次のような実装本体である。

- playback context / content key / history context の詳細実装
- subtitle sync / recovery の本体判定
- secondary subtitle DOM の探索 / host 確保 / 描画導線
- sync interval の詳細 orchestration
- layout 計算や managed style の本体
- observer callback / resize handler / orientation handler の実装詳細
- module 内部 state
- reinitialize / retry / result bridge の内部処理

### 2.4 `content.js` の 7 セクション設計

`content.js` は、現在次の 7 セクションで読む。

1. Logger & Debug Bridge
2. Playback Context Bridge
3. UI: Secondary Subtitle DOM
4. Sync Interval: Periodic Orchestration
5. Layout: Playback Controls Adjustment
6. Observer: Runtime Monitoring
7. Lifecycle: Boot & Teardown

### 2.5 各セクションの役割

- **Section 1: Logger & Debug Bridge**
  - logger / debug panel への橋渡しと payload 正規化を扱う
- **Section 2: Playback Context Bridge**
  - playback DOM / textTrack から context を検出し、content 切替の入口を扱う
- **Section 3: UI: Secondary Subtitle DOM**
  - secondary subtitle element / panel host の確保と描画入口を扱う
- **Section 4: Sync Interval: Periodic Orchestration**
  - sync interval の scheduling、orchestration 順制御、recovery 起動判断の入口を扱う
- **Section 5: Layout: Playback Controls Adjustment**
  - controls の位置・幅・translate 調整と layout retry の配線を扱う
- **Section 6: Observer: Runtime Monitoring**
  - mutation / resize / orientation / video change 監視の入口を扱う
- **Section 7: Lifecycle: Boot & Teardown**
  - boot / restart / teardown と、bind / initial snapshot / cleanup の入口を扱う

### 2.6 Section 4 / Section 6 の正本

現在の構造では、次の 2 セクションは `content.js` が薄い入口であり、実装本体は module 側を正本として読む。

- **Section 4: Sync Interval: Periodic Orchestration**
  - `content.js` 側では scheduling / orchestration order / primary recovery 判定を読む
  - 実装本体の正本は `sync-interval-orchestrator.js` として読む
- **Section 6: Observer: Runtime Monitoring**
  - `content.js` 側では observer attach / detach / routing / wiring を読む
  - 実装本体の正本は `runtime-observers.js` として読む

### 2.7 最終ゴール

Issue #32 の最終ゴールは、`content.js` を「再生ページ全体の coordinator」として維持しつつ、実装詳細は subtitle / layout / observer / playback context 各 module 側へ移した構造を安定させることである。

特に subtitle sync 系では、`content.js` に recovery 条件や binding 詳細を抱え込まず、orchestration lane と signal lane の責務境界を保ったまま、secondary sync の切り分けができる構成を最終形とする。

### 2.8 現在位置

現在、`content.js` の責務分割として、`playbackContext`、`reinitialize-coordinator`、`runtime-observers`、`sync-interval-orchestrator`、playback controls layout は正本分離済みとして扱う。

Section 4 の実装本体は `sync-interval-orchestrator.js`、Section 6 の実装本体は `runtime-observers.js` を正本として読む。  
一方で、secondary subtitle DOM 管理と initial cue recovery は、引き続き主な分割候補として残っている。

large seek 後 secondary missing の既知問題については、現在の主因候補を Section 4 単体には置かず、secondary signal lane、すなわち `resolveSecondarySubtitleTrack()`、`syncSecondarySubtitleTrackBinding()`、cue-readable 判定の境界に置く。  
したがって、次スレでの重点観測対象は、resolver → binding → cue-readable の一直線とする。

---

## 3. ラウンドサマリ表

Issue #32 のラウンドは、詳細な実況ではなく「どの種類の整理を行ったラウンドか」という観点で次のように読む。

| Round | 主題 | 性質 | 現在の読み方 |
|---|---|---|---|
| 1 | section regroup | ordering-only | `content.js` を 7 セクションで読むための基準面 |
| 2 | runtime observers move | physical move-only | Section 6 実装本体は `runtime-observers.js` 側 |
| 3 | observer state capsule | private 化 | observer 内部 state は module private |
| 4 | sync interval split trial | 試行 + rollback | Section 4 の責務境界整理ラウンド |
| 5 | sync interval loading strategy | 設計確定 | `window.ATVB.createXxx` 前提の loading strategy 確定 |
| 6 | sync interval physical split | physical split | Section 4 実装本体は `sync-interval-orchestrator.js` 側 |
| 7 | secondary recovery observability | observability | resolver / binding / cue-readable 境界を重点観測する段階 |

この表の目的は、ラウンドごとの詳細を記録することではなく、各ラウンドを「何のための整理だったか」という粒度で読み直せるようにすることにある。

---

## 4. Secondary sync 境界

### 4.1 secondary sync を分けて読む理由

Apple TV+ の再生ページでは、同一言語・kind の TextTrack が複数存在しうるため、secondary 字幕の sync / recovery を 1 か所に押し込むと、原因切り分けが難しくなる。

Issue #32 では、secondary sync を次の 3 層に分けて扱う。

- resolver 層
- binding 層
- cue-readable 層

Section 4: Sync Interval は、これら 3 層に対して「いつ recovery を走らせるか」を担当する orchestration lane として扱う。

### 4.2 resolver 層

resolver 層は、candidate track の列挙と最適 track の選定を担当する。

代表的な実装は `subtitle-track-resolver.js` であり、`resolveSecondarySubtitleTrack(...)` の戻り値として「どの TextTrack を secondary とみなすか」と、そのときの diagnostics を返す。

### 4.3 binding 層

binding 層は、resolver 層で選ばれた TextTrack に対して bind / unbind / listener 更新を行う。

代表的な実装は `syncSecondarySubtitleTrackBinding(...)` や cue controller 側の binding helpers であり、`secondaryTrack` を state に反映しつつ、必要な listener を適切に張る。

### 4.4 cue-readable 層

cue-readable 層は、現在時刻で、その track から読める cue が存在するかどうかを判定する。

代表的な実装は `getTrackActiveCuesLength(...)` / `hasCueOverlapAtTime(...)` / `getCurrentCue()` / `getCurrentCueText(...)` などであり、`activeCuesLength` や `hasCueOverlapAtCurrentTime` を基準に `cue readable` かどうかを判断する。

### 4.5 orchestration lane と signal lane

Issue #32 の split では、

- resolver 層
- binding 層
- cue-readable 層

を secondary signal lane の API 境界として扱い、Section 4 はこれらを呼び出す orchestration lane として薄く保つ。

これにより、「いつ recovery を走らせるか」と「どの track を bind し、その track から cue を読めるか」を分けて扱う。

---

## 5. Known Issue の切り分けラベル

### 5.1 用語

large seek 後の secondary 不調を読むため、この文書では現象を次の 3 語で表現する。

- `track found`
  - resolver が対象言語・kind の TextTrack を選定できている状態
- `cue unreadable`
  - currentTime に対して、その track から読める cue が得られていない状態
- `signal missing`
  - primary / secondary いずれかの字幕が panel / overlay / popup へ signal として流れていない状態

Known Issue の記録では、`track not found` に短絡せず、この 3 語を組み合わせて現象を読む。

### 5.2 Known Issue の 2 系統

large seek 後に「メインは出るがサブが出ない」既知問題については、次の 2 系統に分けて扱う。

- **A. Section 4 到達系**
  - `detectLargeSeek()` と secondary recovery pass が走っているにもかかわらず、secondary signal が戻らないケース
- **B. Section 4 未到達系**
  - large seek 後 secondary missing は再現するが、Section 4 の recovery 文脈に入っていないケース

Known Issue を記録する際は、必ずどちらの系統かを明示する。

### 5.3 secondary sync logging / naming 方針

secondary sync / recovery に関するログの message prefix は `secondary-sync ...` に統一し、resolver / binding / cue-readable / orchestration のどこで起きている現象かを切り分ける。

詳細なログ項目や代表ケースの生ログは、アーカイブ文書側で扱う。

---

## 6. 注意・運用ルール

### 6.1 この文書の位置づけ

- この文書は Issue #32 の **設計と実装運用の正本** であり、ラウンド実況や細かいログの完全記録ではない
- subtitle truth / health / recovery / UI 境界の詳細設計は `docs/content-architecture.md` を参照する
- 過去ラウンドの詳細記録、実況、観測ログは `docs/archive/issue-32-content-core-split-archive.md` を参照する
- セッション運用の一般ルールは `docs/ai-session-templates.md` を参照する

### 6.2 ラウンド運用上の注意

- Round 1 / Round 2 / Round 3 / Round 4 / Round 5 / Round 6 / Round 7 を混ぜない
- **区画整理 / 物理移送 / private 化 / observability 追加 / rollback 判断** を常に別論点として扱う
- Round 2 は physical move-only、Round 3 は state カプセル化 only として扱い、挙動変更を混ぜない
- Round 4 は責務境界整理と試行的 physical split を含むが、rollback 済みの部分完了ラウンドとして扱う
- Round 5 は content script 向け module loading strategy / 依存注入境界 / 公開 API の確定ラウンドとして扱う
- Round 6 は Section 4 の physical split 完了ラウンドとして扱い、既存 Known Issue の解消とは分けて扱う
- Round 7 は secondary recovery の observability 強化ラウンドとして扱い、挙動変更とは分けて扱う

### 6.3 設計変更とログ追加の分離

- 行数削減や `node --check` の通過より重要なのは、**責務が正しい場所へ移っていること**である
- 設計変更とログ追加は、常に別の commit / ラウンドとして扱う
- Known Issue の記録では、`track found` / `cue unreadable` / `signal missing` の語彙を使い、原因を resolver / binding / cue-readable / orchestration のどこに置くべきかを意識する