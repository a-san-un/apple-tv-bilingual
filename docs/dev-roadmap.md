# phase-3 実装ロードマップ

> **対象ブランチ**: `issue-26-unconfigured-flow`  
> **最終更新**: 2026-07-11  
> **マージ先**: `main`

この文書は、phase-3 全体の **実装順・issue 状態・現在位置・次の主線** を管理する親ドキュメントである。

この文書で扱うもの:

- 実装順
- issue 状態
- フェーズ進捗
- 現在の主線
- 次の優先タスク

この文書で扱わないもの:

- UI 仕様の詳細
- `content.js` 分割の具体的な責務境界
- AI セッション運用テンプレ

正本の位置づけ:

- UI 仕様や表示ルールの詳細は `docs/atv-design.md` に寄せる
- `content.js` 分割の段階方針や安全策は `docs/contentjs-split-roadmap.md` に寄せる
- AI セッション運用テンプレは `docs/ai-session-templates.md` に寄せる
- この文書は、phase-3 の進捗正本とする

---

## 1. 現在位置

- Phase 1〜Phase D は完了
- Phase E は進行中
- Phase E (1) は完了
- Phase E (2) は完了
- #26 は完了
- 現在の主線は **Phase E (3)** として、`attachTracks` / observer / bootstrap の安定化を進めること
- 特に #24 が、現在のコード安定化の中心課題である
- popup / dictionary / AI タブ拡張は、構造整理の後段として扱う

### 現在の優先順

1. #24: `attachTracks` / observer 周辺の安定化
2. Phase E 後半: layout / observer / bootstrap の最終整理
3. #10: subtitle popup UI / dictionary / AI タブ拡張

---

## 2. ロードマップ方針

- 既存 issue（#3 以降）は基本的にそのまま使う
- 実機検証と実装進捗に応じて、**優先順位・フェーズ・状態** を更新する
- 進捗管理はこの文書に集約し、仕様や責務境界の詳細は他 docs に寄せる
- docs は差分修正前提ではなく、必要ならフルアップデートしてよい
- `content.js` 分割は、既存挙動を壊さず責務を分けることに加え、コード量削減と見通し改善を目的とする
- popup / options の言語候補は固定言語一覧、実トラック選択は `content.js` resolver という役割分担を維持する
- resolver 仕様、`secondaryLang` fallback、current 行モデルなど、既に確定した設計は無理に戻さない
- Phase 外の全面リファクタリングは行わない

---

## 3. Issue 一覧

| #                      | タイトル                                                                           | 優先度 | フェーズ     | 状態     | ラベル                                                     |
| ---------------------- | ---------------------------------------------------------------------------------- | -----: | ------------ | -------- | ---------------------------------------------------------- |
| [#3](../../issues/3)   | 字幕パネル表示時に動画操作レイヤーが右パネルに隠れないよう調整する                 |     P0 | Phase 1      | **完了** | `p0` `bug` `enhancement` `area:ui`                         |
| [#4](../../issues/4)   | ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する             |     P1 | Phase 2      | **完了** | `p1` `enhancement` `area:ui` `area:content`                |
| [#5](../../issues/5)   | options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする             |     P1 | Phase 2      | **完了** | `p1` `enhancement` `area:options`                          |
| [#6](../../issues/6)   | popup / options の字幕言語一覧を動画状態から分離して固定化する                     |     P0 | Phase 1      | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#7](../../issues/7)   | secondaryLang の空値保存とブラウザ言語 fallback の挙動を統一する                   |     P0 | Phase 1      | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#8](../../issues/8)   | Debug ログのカテゴリ設計を整理し、共通ログ基盤を共有する                           |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:options` `area:content`           |
| [#10](../../issues/10) | 単語ポップアップ UI 刷新・AI タブ拡張と `dictionaryapi.dev` ハンドラ実装           |     P2 | 後続タスク   | 未完了   | `enhancement` `area:content` `area:popup` `p2`             |
| [#12](../../issues/12) | content.js Phase A: `vtt-normalizer.js` / `debug-logger.js` を切り出す             |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:content`                          |
| [#13](../../issues/13) | content.js Phase B: `subtitle-track-resolver.js` を切り出す                        |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:content`                          |
| [#14](../../issues/14) | 設定変更時と動画初期化時を基準に字幕設定を反映し、ページ離脱時リセット依存を減らす |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:content`                          |
| [#16](../../issues/16) | Phase C: `settings-bridge.js` / `debug-panel.js` を切り出す                        |     P1 | Phase C      | **完了** | `p1` `enhancement` `area:content`                          |
| [#17](../../issues/17) | `content.js` の current 表示モデルを整理し、マーク移動と最小スクロールへ移行する   |     P1 | Phase 3 後半 | **完了** | `p1` `enhancement` `area:ui` `area:content`                |
| [#18](../../issues/18) | primaryLang を英語以外にした場合に主字幕が表示されない問題を切り分ける             |     P1 | Phase 3      | **完了** | `p1` `bug` `area:content`                                  |
| [#19](../../issues/19) | Phase D: binder/sidebar 側で primary cue が UI に反映されない非対称を解消する      |     P1 | Phase D      | **完了** | `p1` `area:content` `area:ui`                              |
| [#20](../../issues/20) | Phase E (1): `content.js` panel / overlay セクションの責務分離                     |     P1 | Phase E      | **完了** | `enhancement` `p1` `area:ui` `area:content` `area:options` |
| [#21](../../issues/21) | Phase E (2): `content.js` binder / cue ロジックの整理と分割準備                    |     P1 | Phase E      | **完了** | `enhancement` `p1` `area:content` `area:options`           |
| [#24](../../issues/24) | `attachTracks` / observer 周辺の安定化                                             |     P1 | Phase E (3)  | 進行中   | `p1` `area:content` `area:observer`                        |
| [#26](../../issues/26) | unconfigured flow と panel / notice / secondary host 生成条件の整理                |     P1 | Phase E (3)  | **完了** | `p1` `bug` `area:content` `area:ui`                        |

---

## 4. フェーズ構成

### Phase 1: 字幕選択と再生 UI の安定化

**ゴール**: popup / options の言語設定が動画状態に依存せず安定して表示され、`secondaryLang` の空値運用を含めた設定 UI が一貫して扱えること。加えて、動画再生 UI が右字幕パネルに妨げられない状態を作る。

- [x] [#6](../../issues/6) 固定言語一覧ベースへの変更と UI からの `textTracks` 生データ分離
- [x] [#7](../../issues/7) `secondaryLang` 空値許容とブラウザ言語 fallback 前提の UI 整理
- [x] [#3](../../issues/3) 動画操作レイヤーの重なり解消

#### 完了メモ

- popup / options の言語候補は `SUPPORTED_LANGS` に基づく固定言語一覧へ移行済み
- 動画ごとの `textTracks` 生データは UI に直接出さない
- `primaryLang` は必須、`secondaryLang` は空値保存を許容し、未設定時は content 側でブラウザ言語 fallback を適用する
- 設定保存後、アクティブな Apple TV+ タブへ設定を即時通知する実装を追加済み
- `content.js` 側で `requestedSecondaryLanguage` と `selectedSecondaryTrackLanguage` を分けてログ観測できるようにした
- 実機検証で `ja / zh-Hant / ko / fr-FR / de / es-ES` の言語切替が安定して動作することを確認済み
- 再生操作 UI は短時間の補正バーストで安定化し、常駐監視に依存しない構成へ整理済み

---

### Phase 2: Debug UI 整理

**ゴール**: Debug UI が常時浮かず、必要なときだけ右字幕パネルや options から確認できる状態を作る。

- [x] [#4](../../issues/4) ATV DEBUG を字幕パネル下部に統合
- [x] [#5](../../issues/5) options の Debug セクション折り畳み既定化

#### 完了メモ

- ATV DEBUG の独立表示を廃止し、右字幕パネル下部の折り畳みセクションへ統合済み
- options の「デバッグログ（開発者向け）」は折り畳み既定へ変更済み
- トグル UI は折り畳み / 展開の状態が追いやすい形へ整理済み

---

### Phase 3: ログ基盤整理と初期分割

**ゴール**: options と字幕パネルが同じログソースを共有し、必要なカテゴリだけを既定表示できること。加えて、後続の `content.js` 分割を安全に進められるよう、独立責務の切り出しを先行すること。

- [x] [#8](../../issues/8) Debug ログカテゴリ設計整理
- [x] [#12](../../issues/12) `content.js` の Phase A 分割（WebVTT 正規化と Debug logger の切り出し）
- [x] [#13](../../issues/13) `content.js` の Phase B 分割（subtitle-track-resolver の切り出し）
- [x] [#14](../../issues/14) 設定ライフサイクル再整理（設定変更時 / 動画初期化時を主トリガー化）
- [x] [#16](../../issues/16) Phase C: settings-bridge / debug-panel の責務分離
- [x] [#17](../../issues/17) current 行モデル整理
- [x] [#18](../../issues/18) primary 非英語時の切り分け

#### 完了メモ

- 設定適用トリガーは「設定変更時 / 動画初期化時」を主経路とする方針へ統一済み
- ページ離脱時は cleanup を主目的とし、設定反映の主トリガーとはしない
- `vtt-normalizer.js` / `debug-logger.js` / `subtitle-track-resolver.js` / `settings-bridge.js` / `debug-panel.js` の切り出しを完了
- options と右字幕パネルが同じログ基盤を共有する前提を整備済み
- current 行は、左側固定幅マーク欄 + 必要時のみ最小スクロールのモデルへ移行済み
- primary 非英語時の問題は、resolver / signal レイヤーまでは正常で、残課題が UI 側にあると切り分け済み

---

### Phase D: binder / sidebar 非対称の解消

**ゴール**: resolver / signal レイヤーで取得できている primary cue を、binder / sidebar / `renderPanel` 側でも一貫して UI に反映できる状態にする。

- [x] [#19](../../issues/19) binder/sidebar 側で primary cue が UI に反映されない非対称を解消

#### 完了メモ

- `primaryTrack.mode` を `showing` で運用し、non-en primary でも cue 可用性を確保
- `findCueAt` の `track.cues` 参照を保護し、mode 遷移時でも安全に cue 探索できるようにした
- `primary = state.primaryTrack` / `secondary = state.secondaryTrack` の責務分離を維持したまま current 行の非対称を解消
- panel 周辺は `panel.css` 外だし + shell 分離で整理し、`createRightPanel()` の責務を縮小した

---

### Phase E: 最終整理

**ゴール**: UI shell / binder / cue の境界を維持したまま、最も密結合で壊れやすい `content.js` 後半の責務を整理し、最終的に bootstrap 的な薄い入口へ寄せる。

#### Phase E の完了状況

- [x] [#20](../../issues/20) Phase E (1): panel / overlay セクションの責務分離
- [x] [#21](../../issues/21) Phase E (2): binder / cue ロジックの整理と分割準備
- [ ] [#24](../../issues/24) `attachTracks` / observer 周辺の安定化
- [x] [#26](../../issues/26) unconfigured flow と panel / notice / secondary host 生成条件の整理

#### 進め方

- まず「挙動を変えない責務整理」を優先する
- UI shell と binder / cue logic と observer / bootstrap を同じ差分で大きく混ぜない
- `ResizeObserver` / `MutationObserver` / timer / retry は最後まで慎重に扱う
- Apple TV+ の controls / footer / panel 位置調整は、必要なものだけ後半で触る
- observer の二重登録や disconnect 漏れを防ぐ
- 最終的に `content.js` は bootstrap 的な薄い入口へ寄せる

#### #20 完了メモ

- panel / debug / overlay / subtitle popup の UI shell 境界を明確化
- `createRightPanel()` / `createOverlay()` / `createPopupHost()` を host / shadow / shell / wiring 中心に整理
- 長い template を `build*ShellHTML()` 系へ寄せた
- overlay は event delegation ベースへ整理
- panel shell / debug shell / debug mount / header wiring の境界を見える形にした
- DOM の `id` / `class` / `data-*`、見た目、close 動作、current 行や threshold-scroll の挙動は変えていない

#### #21 完了メモ

- track binding / cue handling / history / snapshot / current row 連携を binder / cue logic 側のまとまりとして整理
- `selectPrimaryAndSecondaryTracks()` / `bindPrimarySubtitleTrack()` / `bindSecondarySubtitleTrack()` / `clearTrackBindings()` などの関数群を近接配置
- `onCueChange()` / `getCurrentCue()` / `findCueAt()` / snapshot 周辺を cue handling として見えるように整理
- 挙動変更よりも、関数グルーピング、コメント境界、早期 return、薄い helper 化を優先
- 実ファイル分割はまだ行わず、`content.js` 内での責務境界明示に留めた

#### #24 / #26 の現在地

- #24 は `attachTracks` / observer / 再初期化周辺の責務整理と安定化が対象
- #26 は完了
- #26 では、unconfigured 状態で空の panel や secondary host が別経路で再生成されないように条件整理を行った
- 特に `showLanguageSetupNotice()`、panel 表示条件、`ensureSecondarySubtitleElement()` の生成条件、再初期化導線の整合を見直した

---

## 5. 次の優先タスク

### 直近

- [ ] [#24](../../issues/24) `attachTracks` / observer / 再初期化周辺の安定化

### その次

- [ ] Phase E 後半として layout / observer / bootstrap の最終整理
- [ ] `content.js` を bootstrap 的な薄い入口へさらに寄せる
- [ ] 必要に応じて将来の実ファイル分割単位を再確認する

### 後続タスク

- [ ] [#10](../../issues/10) 単語ポップアップ UI 刷新・AI タブ拡張
- [ ] `background.js` の `dictionaryapi.dev` ハンドラ実装
- [ ] 辞書 / AI タブ拡張
- [ ] popup / dictionary 系の単語正規化仕様

---

## 6. 補足メモ

- `content.js` の popup は **subtitle popup** を指す
- extension popup（ブラウザ拡張の popup UI）は別物として扱う
- `You're` → `Youre` のような単語正規化仕様は、Phase E の構造改善ではなく popup / dictionary 系の後続課題として扱う
- current 行モデルは確定済みで、再度大きく戻さない
- primary UI 表示問題は #19 で解消済み
- docs は、この roadmap を親にして他の正本へ役割分担して読む

---

## 7. 文書管理方針

| ファイル                          | 目的                                                                   |
| --------------------------------- | ---------------------------------------------------------------------- |
| `docs/dev-roadmap.md`             | phase-3 全体の実装順、issue 状態、フェーズ進捗を管理する親ドキュメント |
| `docs/atv-design.md`              | UI / 表示仕様 / panel・overlay・popup の設計意図を管理する             |
| `docs/contentjs-split-roadmap.md` | `content.js` 分割・責務整理の段階順と安全策を管理する                  |
| `docs/ai-session-templates.md`    | Copilot / AI セッションに渡すテンプレと運用ルールを管理する            |

### 使い分けルール

- 実装順・優先順位・phase 管理は `docs/dev-roadmap.md`
- UI 表示仕様・責務境界の設計意図は `docs/atv-design.md`
- `content.js` の分割順・バッチ粒度・安全策は `docs/contentjs-split-roadmap.md`
- AI への依頼文・セッション運用ルールは `docs/ai-session-templates.md`

### 更新ルール

- 実装を進めたら、コードだけでなく関連 docs も同じバッチで更新する
- 「実施済み」「見送り」「次の方針」が分かる形で書く
- 未実施の案を完了済みのように書かない
- 必要なら最小差分ではなくフルアップデートしてよい
- 既存用語を壊さず、必要な箇所に責務境界メモや進捗メモを補う
