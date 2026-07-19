# phase-3 実装ロードマップ

> **対象ブランチ**: `issue-23-overlay-native-style`  
> **最終更新**: 2026-07-19  
> **マージ先**: `main`

この文書は、phase-3 全体の **実装順・issue 状態・現在位置・次の主線** を管理する親ドキュメントである。

この文書で扱うもの:

- 実装順
- issue 状態
- フェーズ進捗
- 現在の主線と優先順

この文書で扱わないもの:

- UI 仕様の詳細
- `content.js` 分割の具体的な責務境界
- subtitle sync / recovery の詳細設計
- AI セッション運用テンプレ

正本の位置づけ:

- UI 仕様や表示ルールの詳細は `docs/atv-design.md` に寄せる
- `content.js` 分割の段階方針や安全策は `docs/contentjs-split-roadmap.md` に寄せる
- subtitle sync の表示モデル / health / recovery 設計は `docs/issue-32-subtitle-sync-design.md` に寄せる
- AI セッション運用テンプレは `docs/ai-session-templates.md` に寄せる
- この文書は、phase-3 の進捗正本とする

---

## 1. 現在位置

- Phase 1〜Phase D は完了、Phase E は進行中
- Phase E (1), Phase E (2), #22, #23, #26 は完了
- #24 は進行中（`attachTracks` / observer / bootstrap / 再初期化周辺の安定化）
- subtitle sync / recovery の改善を扱う Issue #32 は、Phase E 後半〜Phase J にまたがる設計・実装タスクとして進行中
- 現在の主線は **#24 / Issue #32** として、`attachTracks` / observer / bootstrap の安定化と、subtitle sync の truth / health / recovery 境界整理を進めること
- 特に、secondary recovery の判定責務を `content.js` から `cue-controller.js` 側へ寄せ、large seek 後の復帰挙動を runtime 主体で安定化することが現在の中心課題である
- 現在は「secondary が戻らない」状態の切り分けから一歩進み、「戻るが少し時間がかかる」復帰ラグの調整段階に入っている
- popup / dictionary / AI タブ拡張 (#10) は、構造整理と subtitle sync 改善の後段として扱う

### 現在の優先順

1. #24 / Issue #32 Phase J: secondary recovery の復帰ラグ調整
2. Phase E 後半: observer / layout / bootstrap の最終整理
3. #10: subtitle popup UI / dictionary / AI タブ拡張

---

## 2. Issue 一覧

| #                   | タイトル                                                                           | 優先度 | フェーズ     | 状態     | ラベル                                                     |
| ------------------- | ---------------------------------------------------------------------------------- | -----: | ------------ | -------- | ---------------------------------------------------------- |
| [#3](../issues/3)   | 字幕パネル表示時に動画操作レイヤーが右パネルに隠れないよう調整する                 |     P0 | Phase 1      | **完了** | `p0` `bug` `enhancement` `area:ui`                         |
| [#4](../issues/4)   | ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する             |     P1 | Phase 2      | **完了** | `p1` `enhancement` `area:ui` `area:content`                |
| [#5](../issues/5)   | options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする             |     P1 | Phase 2      | **完了** | `p1` `enhancement` `area:options`                          |
| [#6](../issues/6)   | popup / options の字幕言語一覧を動画状態から分離して固定化する                     |     P0 | Phase 1      | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#7](../issues/7)   | secondaryLang の空値保存とブラウザ言語 fallback の挙動を統一する                   |     P0 | Phase 1      | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#8](../issues/8)   | Debug ログのカテゴリ設計を整理し、共通ログ基盤を共有する                           |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:options` `area:content`           |
| [#10](../issues/10) | 単語ポップアップ UI 刷新・AI タブ拡張と `dictionaryapi.dev` ハンドラ実装           |     P2 | 後続タスク   | 未完了   | `enhancement` `area:content` `area:popup` `p2`             |
| [#12](../issues/12) | content.js Phase A: `vtt-normalizer.js` / `debug-logger.js` を切り出す             |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:content`                          |
| [#13](../issues/13) | content.js Phase B: `subtitle-track-resolver.js` を切り出す                        |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:content`                          |
| [#14](../issues/14) | 設定変更時と動画初期化時を基準に字幕設定を反映し、ページ離脱時リセット依存を減らす |     P1 | Phase 3      | **完了** | `p1` `enhancement` `area:content`                          |
| [#16](../issues/16) | Phase C: `settings-bridge.js` / `debug-panel.js` を切り出す                        |     P1 | Phase C      | **完了** | `p1` `enhancement` `area:content`                          |
| [#17](../issues/17) | `content.js` の current 表示モデルを整理し、マーク移動と最小スクロールへ移行する   |     P1 | Phase 3 後半 | **完了** | `p1` `enhancement` `area:ui` `area:content`                |
| [#18](../issues/18) | primaryLang を英語以外にした場合に主字幕が表示されない問題を切り分ける             |     P1 | Phase 3      | **完了** | `p1` `bug` `area:content`                                  |
| [#19](../issues/19) | Phase D: binder/sidebar 側で primary cue が UI に反映されない非対称を解消する      |     P1 | Phase D      | **完了** | `p1` `area:content` `area:ui`                              |
| [#20](../issues/20) | Phase E (1): `content.js` panel / overlay セクションの責務分離                     |     P1 | Phase E      | **完了** | `enhancement` `p1` `area:ui` `area:content` `area:options` |
| [#21](../issues/21) | Phase E (2): `content.js` binder / cue ロジックの整理と分割準備                    |     P1 | Phase E      | **完了** | `enhancement` `p1` `area:content` `area:options`           |
| [#22](../issues/22) | サブタイトルポップアップがビューポート外にはみ出さないよう位置計算を修正           |     P1 | UI安定化     | **完了** | `p1` `bug` `area:content` `area:ui`                        |
| [#23](../issues/23) | [P2] subtitle overlay を Apple TV+ のネイティブ字幕に近い見た目へ調整する          |     P2 | UI調整       | **完了** | `p2` `enhancement` `area:ui` `area:content`                |
| [#24](../issues/24) | `attachTracks` / observer 周辺の安定化                                             |     P1 | Phase E (3)  | 進行中   | `p1` `area:content` `area:observer`                        |
| [#26](../issues/26) | unconfigured flow と panel / notice / secondary host 生成条件の整理                |     P1 | Phase E (3)  | **完了** | `p1` `bug` `area:content` `area:ui`                        |

※ Issue #32（subtitle sync / recovery）は、Phase E 後半〜Phase J にまたがるタスクとして扱う。  
※ 設計詳細と進捗は `docs/issue-32-subtitle-sync-design.md` 側で管理する。

---

## 3. フェーズ構成

### Phase 1: 字幕選択と再生 UI の安定化

popup / options の言語設定が動画状態に依存せず安定して表示され、`secondaryLang` の空値運用を含めた設定 UI が一貫して扱える状態を作る。  
同時に、動画再生 UI が右字幕パネルに妨げられないようレイアウトを整える。  
[#3](../issues/3), [#6](../issues/6), [#7](../issues/7)

### Phase 2: Debug UI 整理

Debug UI が常時浮かず、必要なときだけ右字幕パネルや options から確認できる状態を作る。  
既存 UI に大きな変更を加えず、開発者向け情報の確認導線を整理する。  
[#4](../issues/4), [#5](../issues/5)

### Phase 3: ログ基盤整理と初期分割

options と字幕パネルが同じログソースを共有し、必要なカテゴリだけを既定表示できる状態にする。  
後続の `content.js` 分割を安全に進められるよう、独立責務（normalizer / logger / resolver / settings bridge など）を先行して切り出す。  
[#8](../issues/8), [#12](../issues/12), [#13](../issues/13), [#14](../issues/14), [#16](../issues/16), [#17](../issues/17), [#18](../issues/18)

### Phase D: binder / sidebar 非対称の解消

resolver / signal レイヤーで取得できている primary cue を、binder / sidebar / `renderPanel` 側でも一貫して UI に反映できる状態にする。  
primary/secondary の非対称を減らし、current 行モデルの挙動を安定させる。  
[#19](../issues/19)

### Phase E: 最終整理

UI shell / binder / cue / observer / bootstrap の境界を維持しつつ、最も密結合で壊れやすい `content.js` 後半の責務を整理し、bootstrap 的な薄い入口へ寄せる。  
observer / layout / bootstrap の起動・再初期化・再接続を薄い配線層として整え、subtitle sync 改善を controller 側へ寄せやすくする。  
[#20](../issues/20), [#21](../issues/21), [#24](../issues/24), [#26](../issues/26), Issue #32

### 並行 UI 調整タスク

既存の表示責務やトラック解決ロジックを変えずに、overlay / popup の UI を違和感の少ない見た目へ寄せる。  
content.js 分割の主線を壊さない範囲で、viewport clamp やネイティブ字幕寄せを行う。  
[#22](../issues/22), [#23](../issues/23)
