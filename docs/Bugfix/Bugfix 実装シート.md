# Bugfix 実装シート 2026-08-26（作業台完了記録版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** `docs/Bugfix/Bugfix マスタープラン.md`  
**対応方針メモ:** `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`  
**最新反映コミット:** `43ed673 refactor: Step 17-A-10 の owner 境界整理とコメント同期を反映する`  
**現在の作業:** Step 17-A-10 完了記録 — panel / block public API と `content.js` の高レベル中継境界の固定結果を整理する。

***

## このシートの役割

このシートは、**Step 17-A-10 の作業台兼完了記録**である。  
変更対象、ファイル単位の実装順、確認観点、実機検証、作業中の判断、および完了結果を記録する。

全体目標、過去 Step の完了履歴、将来作業、各資料の役割は `Bugfix マスタープラン.md` を参照する。  
Step 17-A の owner 判断、API 契約、詳細な移行根拠は `Step17-A_panel系統合_方針整理メモ.md` を正本とする。

***

## 今回の目的

Step 17-A-10 として、`content.js` に残る panel / block 関連の高レベル中継 API を棚卸しし、次を固定した。

- `content.js` に残すべき起動シーケンス・DI・高レベル中継 API
- `modules/panel-ui.js` に閉じるべき panel UI / render 実行 API
- `modules/subtitle-block-state.js` に閉じるべき block state 読み取り・解決・同期 API
- `modules/panel-renderer.js` に閉じるべき描画専用 API
- Step 17-B の visibility / lifecycle 整理、および Step 18 の term inspector 分離へ渡す public API 境界

今回の作業では、panel の見た目、overlay の見た目、字幕同期ロジック、track 選択、native toggle、Step 17-B の visibility / lifecycle 実装、Step 18 の term inspector 抽出は行っていない。

***

## 前提

以下は完了済みであり、今回の変更でも維持した。

- `panelUi.dispose()` は panel host、ShadowRoot、toggle button、native toggle observer、resize listener、render timer、render snapshot、renderer owner state、overlay DOM を対称に cleanup する高レベル入口である。
- `removeHost()` は低レベルな DOM host 除去だけを担当する。
- `applyPanelState()` は state effects を含む panel 状態の再適用である。
- `refreshPanel()` は既存 state に基づく描画のみを担当する。
- `panelRenderer` と `getPanelRenderInput()` は `content.js` から `createPanelUi()` へ DI される。
- `modules/subtitle-block-state.js` は subtitle block sequence、current block 解決、current block mirror 同期、panel open 時の block rebuild を担当する。
- `modules/panel-renderer.js` は共有 state を直接読まず、入力から描画結果と snapshot を返す。
- `modules/panel-visibility-state.js` は `panelOpen` の load / persist 専用であり、DOM、render、snapshot、block state を持たない。

***

## 対象ファイル

| ファイル | 今回確認した責務 | Step 17-A-10 の結果 |
| :-- | :-- | :-- |
| `content.js` | DI、起動シーケンス、高レベル中継、共有 state | 旧 sequence getter wrapper / block rebuild façade を整理し、高レベル orchestration と DI に寄せた。 |
| `cue-controller.js` | cue sequence 利用側の orchestration | 旧 sequence getter DI と fallback を削除し、sequence build 詳細を owner 外へ持たない構成に揃えた。 |
| `modules/panel-ui.js` | panel host / ShadowRoot / toggle / renderer 呼び出し / render owner state | `clearPanelRenderArtifacts()` を追加し、dispose 時の render artifact cleanup を owner 内 helper へ集約した。 |
| `modules/subtitle-block-state.js` | sequence / current block / meta / mirror 同期 / panel open 時の rebuild | render callback DI を持たない block state owner として整理した。 |
| `modules/subtitle-state-reset.js` | complete reset / render snapshot clear | panel snapshot reset と block runtime mirror reset を内部 helper に分離し、complete reset orchestration の責務を明瞭化した。 |
| `reinitialize-coordinator.js` | 再初期化の順序制御 | `clearInternalSubtitleState` 呼び出しを options 契約に揃え、高レベル再初期化 coordinator に留めた。 |

***

## API 棚卸し結果

| API / state | 変更前の扱い | Step 17-A-10 の判断 | 結果 |
| :-- | :-- | :-- | :-- |
| `getSubtitleBlockSequence()` | `content.js` / controller 側から参照される互換 getter として残っていた。 | block state owner 外へ sequence getter DI を広げない。 | cue-controller 側の旧 getter DI / fallback を削除した。 |
| `getCurrentSubtitleBlockFromSequence()` | `content.js` 側の互換取得経路として残っていた。 | block current 解決は owner 側 API に寄せる。 | 旧 sequence getter 依存を縮小し、`content.js` 側の高レベル中継だけを残した。 |
| `renderCurrentSnapshot()` | block state / panel 開閉処理から描画 callback 的に扱われていた。 | block state owner は描画 callback を持たない。 | `modules/subtitle-block-state.js` から render callback DI を削除した。 |
| `applyPanelStateEffects()` / panel open effect | panel open 時の block rebuild と描画副作用が散っていた。 | panel open 時の高レベル effect は一本化する。 | `applyPanelOpenEffects()` へ集約した。 |
| `panelUi.dispose()` | panel cleanup の高レベル入口として既に固定済みだった。 | render artifact cleanup も owner 内 helper へ寄せる。 | `clearPanelRenderArtifacts()` を追加し、dispose 内 cleanup を明示化した。 |
| `state.currentSubtitleBlock` | runtime mirror として残っていた。 | 正本ではなく互換 mirror として維持する。 | reset 経路では mirror reset helper 分離により扱いを明確化した。 |
| `state.lastPanelRenderSnapshot` | 観測用共有参照だった。 | panel render owner 管理を明確化する。 | reset / dispose 両経路で panel snapshot clear の owner 境界を明示した。 |

***

## 判断基準

### `content.js` に残したもの

- module の生成と DI
- 起動順序と再初期化の高レベル制御
- 複数 owner にまたがる操作の調停
- extension runtime と content script 全体に関わる入口
- 既存 caller を保護するために必要な薄い高レベル facade

### `content.js` から外したもの

- cue-controller から見た旧 sequence getter 依存と fallback
- panel open 時の block rebuild façade の分散定義
- block state owner に渡していた render callback DI
- panel render artifact cleanup の inline 実装
- complete reset 内での panel snapshot / mirror state の直書き reset

### API を残した条件

- 複数 module owner にまたがる調停が必要である。
- 呼び出し元が起動・再初期化・cleanup の高レベル文脈を持つ。
- API 名だけで副作用の範囲が理解できる。
- owner 内部の state shape や DOM 構造を外部に漏らさない。

***

## 実装ステップ

| Step | 対象ファイル | 状態 | 実装内容 | 確認結果 |
| :-- | :-- | :-- | :-- | :-- |
| 17-A-10-1 | `cue-controller.js` | 完了 | 旧 block getter DI と `sequenceApi` fallback を削除した。 | controller は orchestration に留まり、sequence build 詳細を持たない構成へ揃った。 |
| 17-A-10-2 | `content.js` | 完了 | cue controller 向けの旧 block getter 注入を削除した。 | `content.js` は DI / orchestration 側へ寄せた。 |
| 17-A-10-3 | `content.js` | 完了 | `subtitleBlockApi.rebuildForPanelOpen` の façade 公開を削除した。 | panel open effect の入口を `applyPanelOpenEffects()` に集約した。 |
| 17-A-10-4 | `modules/subtitle-block-state.js` / `content.js` | 完了 | block state から描画 callback DI を外し、render 起動を高レベル側へ集約した。 | block state owner は state / resolve / sync に集中する形になった。 |
| 17-A-10-5 | `content.js` | 完了 | `renderCurrentSnapshot()` から `currentSubtitleBlock` mirror の直接更新を外した。 | mirror 更新責務の散在を抑制した。 |
| 17-A-10-6 | `modules/panel-ui.js` | 完了 | `dispose()` 内の render artifact reset 直書きを `clearPanelRenderArtifacts()` へ集約した。 | panel owner 内 cleanup helper として責務が明確化した。 |
| 17-A-10-7 | `modules/subtitle-state-reset.js` | 完了 | reset module 内の panel snapshot / block mirror 直書きを内部 helper に分離した。 | complete reset orchestration と内部 reset helper 境界を整理した。 |
| 17-A-10-8 | `reinitialize-coordinator.js` | 完了 | `clearInternalSubtitleState` 呼び出しを options 契約へ揃えた。 | coordinator は reset 詳細を抱え込まない構造になった。 |
| 17-A-10-9 | docs 3 files | 未反映 | Step 17-A-10 完了と次フェーズ移行を docs へ同期する。 | この文書差し替えで反映する。 |

***

## コメント同期の確認

今回の Step 17-A-10 では、実装差分だけでなくコメント同期も確認対象に含めた。

| ファイル | 確認結果 | 補足 |
| :-- | :-- | :-- |
| `cue-controller.js` | 良好 | ヘッダーと factory JSDoc が差分意図に整合した。 |
| `modules/panel-ui.js` | 良好 | `clearPanelRenderArtifacts()` の JSDoc 追加まで反映済みである。 |
| `modules/subtitle-block-state.js` | 良好 | 今回差分に対するコメント矛盾は見当たらない。 |
| `reinitialize-coordinator.js` | 良好 | coordinator / orchestration の説明を維持できている。 |
| `content.js` | 完了 | ヘッダー、JSDoc、区切りコメントを現状責務に合わせて同期した。 |
| `modules/subtitle-state-reset.js` | 完了 | 新 helper の責務が分かるように JSDoc / 説明コメントを補った状態として扱う。 |

***

## 確認観点

今回の完了確認では、次の観点を満たしていることを確認対象とした。

- `content.js` が panel / block の内部実装詳細ではなく DI / orchestration に寄っていること。
- block state owner が render callback や panel owner 詳細を持たないこと。
- panel owner が render artifact cleanup を内包していること。
- reset / reinitialize が owner 内部 state を直接いじるのではなく、契約化した API / options を通ること。
- 変更した6ファイルでヘッダー、JSDoc、区切りコメントの整合が取れていること。

***

## 実機検証メモ

今回の Step 17-A-10 は owner 境界固定と API 整理が中心であり、見た目や字幕同期アルゴリズム自体の変更は行っていない。
そのため、このシートでは「既存の panel dispose / refresh / block rebuild / reinitialize の到達経路を壊していないこと」を中心に確認すべき作業として扱う。

最低限の確認対象は次のとおりである。

- 通常再生中の panel open / close が維持されること。
- panel open 時に block rebuild と render が従来どおり成立すること。
- reinitialize 経路で internal subtitle state clear が呼ばれても reset options 契約で破綻しないこと。
- dispose / cleanup 経路で render snapshot と mirror state の掃除が重複せず成立すること。

***

## 作業中の判断メモ

- Step 17-A-10 は Step 17-B の visibility / lifecycle owner 固定へ渡すための API 境界整理であり、UI 挙動そのものを変える Step ではない。
- `content.js` をさらに薄くする場合でも、entry point / DI / orchestration の責務は残す前提で判断する。
- `modules/subtitle-block-state.js` は正本 state owner であり、描画や panel UI owner の都合を持ち込まない。
- `modules/panel-ui.js` は panel cleanup の高レベル owner として、dispose / render artifact clear の責務を明確に持つ。
- Step 17-B では `panelOpen`、`panelDefaultOpen`、DOM visibility、cleanup、reinitialize、SPA 遷移、ON/OFF の owner と到達順を対象にする。

***

## 次にやること

このシートで記録した Step 17-A-10 の完了を前提に、次の主作業は Step 17-B へ移る。

- `docs/Bugfix/Step17-B_visibility-lifecycle_方針整理メモ.md` を正本にして visibility / lifecycle owner を整理する。
- `panelOpen`、`panelDefaultOpen`、通常 open / close、reinitialize、SPA 遷移、拡張 ON/OFF の各経路を洗い出す。
- `content.js`、`modules/panel-ui.js`、`modules/panel-visibility-state.js`、cleanup / reinitialize 系 module の責務境界を確認する。
- Step 17-A-10 docs 更新として、マスタープラン・実装シート・Step17-A メモを同期する。

***

## 結果

Step 17-A-10 のコード実装は `43ed673 refactor: Step 17-A-10 の owner 境界整理とコメント同期を反映する` で完了している。
このシートは、その実装内容を file 単位・API 単位・確認観点単位で残し、次フェーズの Step 17-B へ渡すための完了記録として扱う。

