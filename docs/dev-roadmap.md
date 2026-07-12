# phase-3 実装ロードマップ

> **対象ブランチ**: `issue-23-overlay-native-style`  
> **最終更新**: 2026-07-12  
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
- #22 は完了
- #26 は完了
- 現在の主線は **Phase E (3)** として、`attachTracks` / observer / bootstrap の安定化を進めること
- 特に #24 が、現在のコード安定化の中心課題である
- 並行して #23 では、subtitle overlay の見た目を Apple TV+ ネイティブ字幕に近づける UI 調整を進める
- popup / dictionary / AI タブ拡張は、構造整理の後段として扱う

### 現在の優先順

1. #24: `attachTracks` / observer 周辺の安定化
2. #23: subtitle overlay を Apple TV+ のネイティブ字幕に近い見た目へ調整する
3. Phase E 後半: layout / observer / bootstrap の最終整理
4. #10: subtitle popup UI / dictionary / AI タブ拡張

---

## 2. ロードマップ方針

- 既存 issue（#3 以降）は基本的にそのまま使う
- 実機検証と実装進捗に応じて、**優先順位・フェーズ・状態** を更新する
- 進捗管理はこの文書に集約し、仕様や責務境界の詳細は他 docs に寄せる
- docs は差分修正前提ではなく、必要ならフルアップデートしてよい
- `content.js` 分割は、既存挙動を壊さず責務を分けることに加え、コード量削減と見通し改善を目的とする
- popup / options の言語候補は固定言語一覧、実トラック選択は `content.js` resolver という役割分担を維持する
- resolver 仕様、`secondaryLang` fallback、current 行モデルなど、既に確定した設計は無理に戻さない
- Issue #23 のような UI 見た目調整では、表示条件や resolver / binder / observer の仕様変更を混ぜない
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
| [#22](../../issues/22) | サブタイトルポップアップがビューポート外にはみ出さないよう位置計算を修正           |     P1 | UI安定化     | **完了** | `p1` `bug` `area:content` `area:ui`                        |
| [#23](../../issues/23) | [P2] subtitle overlay を Apple TV+ のネイティブ字幕に近い見た目へ調整する          |     P2 | UI調整       | 未完了   | `p2` `enhancement` `area:ui` `area:content`                |
| [#24](../../issues/24) | `attachTracks` / observer 周辺の安定化                                             |     P1 | Phase E (3)  | 進行中   | `p1` `area:content` `area:observer`                        |
| [#26](../../issues/26) | unconfigured flow と panel / notice / secondary host 生成条件の整理                |     P1 | Phase E (3)  | **完了** | `p1` `bug` `area:content` `area:ui`                        |

---

## 4. フェーズ構成

### Phase 1: 字幕選択と再生 UI の安定化

**ゴール**: popup / options の言語設定が動画状態に依存せず安定して表示され、`secondaryLang` の空値運用を含めた設定 UI が一貫して扱えること。加えて、動画再生 UI が右字幕パネルに妨げられない状態を作る。

- [x] [#6](../../issues/6) 固定言語一覧ベースへの変更と UI からの `textTracks` 生データ分離
- [x] [#7](../../issues/7) `secondaryLang` 空値許容とブラウザ言語 fallback 前提の UI 整理
- [x] [#3](../../issues/3) 動画操作レイヤーの重なり解消

### Phase 2: Debug UI 整理

**ゴール**: Debug UI が常時浮かず、必要なときだけ右字幕パネルや options から確認できる状態を作る。

- [x] [#4](../../issues/4) ATV DEBUG を字幕パネル下部に統合
- [x] [#5](../../issues/5) options の Debug セクション折り畳み既定化

### Phase 3: ログ基盤整理と初期分割

**ゴール**: options と字幕パネルが同じログソースを共有し、必要なカテゴリだけを既定表示できること。加えて、後続の `content.js` 分割を安全に進められるよう、独立責務の切り出しを先行すること。

- [x] [#8](../../issues/8)
- [x] [#12](../../issues/12)
- [x] [#13](../../issues/13)
- [x] [#14](../../issues/14)
- [x] [#16](../../issues/16)
- [x] [#17](../../issues/17)
- [x] [#18](../../issues/18)

### Phase D: binder / sidebar 非対称の解消

**ゴール**: resolver / signal レイヤーで取得できている primary cue を、binder / sidebar / `renderPanel` 側でも一貫して UI に反映できる状態にする。

- [x] [#19](../../issues/19)

### Phase E: 最終整理

**ゴール**: UI shell / binder / cue の境界を維持したまま、最も密結合で壊れやすい `content.js` 後半の責務を整理し、最終的に bootstrap 的な薄い入口へ寄せる。

- [x] [#20](../../issues/20)
- [x] [#21](../../issues/21)
- [ ] [#24](../../issues/24)
- [x] [#26](../../issues/26)

### 並行 UI 調整タスク

**ゴール**: 既存の表示責務やトラック解決ロジックを変えずに、overlay / popup の UI を違和感の少ない見た目へ寄せる。

- [x] [#22](../../issues/22) subtitle popup の viewport clamp
- [ ] [#23](../../issues/23) subtitle overlay のネイティブ字幕寄せ

---

## 5. 次の優先タスク

### 直近

- [ ] [#24](../../issues/24) `attachTracks` / observer / 再初期化周辺の安定化
- [ ] [#23](../../issues/23) subtitle overlay の見た目調整

### その次

- [ ] Phase E 後半として layout / observer / bootstrap の最終整理
- [ ] `content.js` を bootstrap 的な薄い入口へさらに寄せる
- [ ] 必要に応じて将来の実ファイル分割単位を再確認する

### 後続タスク

- [ ] [#10](../../issues/10) 単語ポップアップ UI 刷新・AI タブ拡張
- [ ] `background.js` の `dictionaryapi.dev` ハンドラ実装
