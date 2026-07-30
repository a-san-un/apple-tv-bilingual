> [!NOTE]
> この文書は旧 phase-3 実装ロードマップです。
>
> 2026-07 の docs 再編以降、docs の入口は `docs/README.md`、
> Issue #32 の実装運用は `docs/issue-32-content-core-split.md`、
> content 層の設計正本は `docs/content-architecture.md` を参照してください。
>
> このファイルは移行前の進捗記録として残しています。
> 原則として、今後の更新先にはしません。

# phase-3 実装ロードマップ

> **対象ブランチ**: `issue-32-content-core-split`  
> **最終更新**: 2026-07-21  
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
- Issue #32 における NLM 利用運用方針は、`docs/ai-session-templates.md` と `docs/issue-32-subtitle-sync-design.md` を参照する
- この文書は、phase-3 の進捗正本とする

---

## 1. 現在位置

- Phase 1〜Phase D は完了、Phase E は進行中
- Phase E (1), Phase E (2), #22, #23, #26 は完了
- #24 は進行中（`attachTracks` / observer / bootstrap / 再初期化周辺の安定化）
- Issue #32（subtitle sync / recovery）は、Phase E 後半〜Phase J にまたがる設計・実装タスクとして進行中
- Issue #32 の中には、
  - subtitle sync / recovery 設計正本（truth / health / recovery 境界）
  - `content.js` を thin coordinator へ近づけるための責務移送ラウンド
    の 2 レイヤーがある
- 現在の主線は **#24 / Issue #32** として、
  - `attachTracks` / observer / bootstrap の安定化
  - subtitle sync の truth / health / recovery 境界整理
  - `content.js` から subtitle sync / playback controls layout / playback context などの責務を段階的に外へ出し、thin coordinator へ近づけること
    を進めること
- 特に、secondary recovery の判定責務を `content.js` から `cue-controller.js` 側へ寄せ、large seek 後の復帰挙動を runtime 主体で安定化することが中心課題である
- 現時点では「secondary が戻らない」状態の切り分けから一歩進み、
  - 「large seek 後に recovery / force-rebind が正しく走っているか」
  - 「実際に track が re-bind されているか」
  - 「それでも Apple TV+ 側が JA track を復帰させない区間があるのか」
    をログで切り分けできる段階まで到達している
- popup / dictionary / AI タブ拡張 (#10) は、構造整理と subtitle sync 改善の後段として扱う
- `content.js` の責務整理は、巨大ファイルを一気に割るのではなく **coordinator を残しつつ周辺責務をラウンド単位で外へ出す** 方針で進行中
- 最初の実ファイル分割単位として `playbackContext.js` が追加され、`content.js` から controller 優先 + local fallback で接続されている
- large seek 後の secondary recovery については、waiting window / missCount / force-rebind / terminated のフローを整理し、Runtime First（実測優先）方針の first cut まで入っている
- playback controls layout については、既存の `playback-controls-layout.js` へ責務を寄せるラウンドが完了し、`content.js` 側は layout controller instance を起点に overlay / runtime-observers へ bridge を配る thin coordinator に寄っている
- 今後は playback controls layout を継続主線として引っ張るのではなく、次の主題を別責務から選ぶ段階に入っている

### 現在の優先順

1. #24 / Issue #32 Phase J: secondary recovery の Runtime First 化・復帰ラグ観測・observer / bootstrap 周辺の整理の継続
2. Phase E 後半: `content.js` 後半の coordinator / reinitialize / playbackContext / retry / initial recovery の責務整理（行数削減・重複削減を含む）
3. #10: subtitle popup UI / dictionary / AI タブ拡張

---

## 2. 現在の主線

### 2.1 #24

#24 は、`attachTracks` / observer / bootstrap / 再初期化まわりを安定化し、動画切替や DOM 再接続時の揺れを減らすための主線である。

当面の観点は次のとおり。

- `attachTracks` の再実行条件を追いやすくする
- observer の責務を再接続トリガと layout 再評価に限定する
- bootstrap / cleanup の順序を壊さず、例外経路を減らす
- subtitle sync の本体問題を observer 側で無理に吸収しない
- 再初期化系（`reinitializeSubtitlePipeline` / retry / settings reload）が「薄い入口」として扱えるよう責務を整理する

### 2.2 Issue #32

Issue #32 は、subtitle sync / recovery を `content.js` 追記ではなく controller / resolver 側へ寄せながら改善する主線である。  
同時に、`content.js` を薄い coordinator に近づけるため、関連責務をラウンド単位で外へ移す役割も持つ。

#### 2.2.1 subtitle sync 設計正本側

現在までに、次の方向が固まっている。

- truth source は `SubtitleBlockSequence` に寄せる
- current / panel / overlay / history の境界を分ける
- secondary recovery は runtime first / merged assists で判断する
- `cue-controller.js` に health / lane state / recovery 判定を集約する
- large seek 直後の UI 空白は nearby rebuild と short-lived hold で一時保護する
- 戻らない seek window は miss limit 到達後に primary-only terminated へ切り替える
- `content.js` は coordinator / logging / bridge 的な役割に絞り、subtitle sync / recovery の詳細判定は controller 側へ寄せる
- large seek 後の Runtime First 方針として、
  - recovery window（約 1 秒）到達前は derived 判定（merged assists）を尊重し idle を維持する
  - recovery window 超過後は、derived の揺れにかかわらず runtime の missing 継続（`secondaryLane.isMissing`）を優先して recovery を進める
    を first cut として採用した
- recovery 判定の数値構造（window 1秒 / force-rebind 開始タイミング / miss limit 8回）は現行を維持しつつ、gating と観測を強化する方針とした

#### 2.2.2 `content.js` 責務移送側

Issue #32 の流れの中で、`content.js` を thin coordinator に近づけるための責務移送ラウンドを進めている。

すでに到達したこと:

- secondary subtitle DOM 管理系を 1 グループとして整理した
- sync interval 系 6 関数を 1 グループとして整理した
- `content.js` 後半に coordinator / playbackContext / reinitialize / retry / result bridge の見出しを追加した
- `playbackContext.js` を新規追加し、playback page context / content key / subtitle history context を controller として分離した
- `manifest.json` に `playbackContext.js` が追加され、`content.js` から `window.ATVB.createPlaybackContextController` 経由で参照する構成にした
- playbackContext 対象 14 関数を controller 優先 + local fallback で段階接続し、既存挙動を壊さずに分割を導入した
- `content.js` 側で secondary recovery 判定結果と sync 実行結果を観測するログを追加し、「判定」「trigger」「再バインドの有無」を切り分けられるようにした
- playback controls layout 関連では、
  - `PLAYBACK_CONTROLS_LAYOUT`
  - `getPlaybackControlsLayoutTargets`
  - `applyManaged*` / `clearManaged*`
    の ownership を `playback-controls-layout.js` 側へ集約した
- `createPlaybackControlsLayout(...)` の return に layout 定数 / target resolver / runtime API を含め、layout controller instance を正本とする接続へ整理した
- `overlay-controller.js` / `runtime-observers.js` に対して、layout controller instance 由来の bridge を接続した
- playback controls layout ラウンドについて、panel 開閉 / overlay 位置維持 / controls 再描画後の再開閉を含む実機確認が完了した

ここまでにより、`content.js` は「責務本体を持つ場所」から、「接続・起動・観測の入口」へ寄せるラインが明確になっている。

### 2.3 現時点の到達点

2026-07-21 時点で、Issue #32 / Phase J は次の到達点にある。

- large seek 後の近傍 truth rebuild を追加
- nearby rebuild の latest-only hold を導入
- secondary recovery window / force-rebind 開始 / miss limit を controller 側へ寄せた
- miss limit 到達後は `terminated` として primary-only 区間へ落とす挙動を確認した
- `evaluateSecondaryRecovery()` の gating を Runtime First 方針に沿って緩和し、
  - waiting window 前は `derived.shouldRecoverSecondary` を尊重し idle を維持
  - waiting window 超過後は runtime missing 継続（`secondaryLane.isMissing`）を優先して recovery を進める
    変更を導入した
- large seek 後の実ログから、
  - recovery / force-rebind 判定は想定どおり進んでいる
  - `syncSecondarySubtitleTrack()` による re-bind 試行も行われている
  - それでも一部タイトル / 区間で Apple TV+ 側 JA track が active cues を復帰させないケースがある
    ことを確認し、拡張側ロジックと基盤側挙動の境界を明文化した
- `playbackContext.js` 導入後も、`contentKey` と history context の大枠は安定している
- playback controls layout ラウンドについては、今回の単位として完了している
- コミット / プッシュまで完了している

この段階では「secondary が戻らないケースを壊さず扱える」基盤は入っているが、miss limit 値や primary-only fallback 条件の微調整、大シーク後の secondary 欠落・通常再生中のちらつき・パネルスクロール競合については後続の調整対象とする。

---

## 3. Issue 一覧

| #                   | タイトル                                                                                                                 | 優先度 | フェーズ              | 状態     | ラベル                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | -----: | --------------------- | -------- | ---------------------------------------------------------- |
| [#3](../issues/3)   | 字幕パネル表示時に動画操作レイヤーが右パネルに隠れないよう調整する                                                       |     P0 | Phase 1               | **完了** | `p0` `bug` `enhancement` `area:ui`                         |
| [#4](../issues/4)   | ATV DEBUG を独立表示から右字幕パネル下部の折り畳みセクションへ統合する                                                   |     P1 | Phase 2               | **完了** | `p1` `enhancement` `area:ui` `area:content`                |
| [#5](../issues/5)   | options の「デバッグログ（開発者向け）」セクションを折り畳み既定にする                                                   |     P1 | Phase 2               | **完了** | `p1` `enhancement` `area:options`                          |
| [#6](../issues/6)   | popup / options の字幕言語一覧を動画状態から分離して固定化する                                                           |     P0 | Phase 1               | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#7](../issues/7)   | secondaryLang の空値保存とブラウザ言語 fallback の挙動を統一する                                                         |     P0 | Phase 1               | **完了** | `p0` `bug` `enhancement` `area:popup` `area:content`       |
| [#8](../issues/8)   | Debug ログのカテゴリ設計を整理し、共通ログ基盤を共有する                                                                 |     P1 | Phase 3               | **完了** | `p1` `enhancement` `area:options` `area:content`           |
| [#10](../issues/10) | 単語ポップアップ UI 刷新・AI タブ拡張と `dictionaryapi.dev` ハンドラ実装                                                 |     P2 | 後続タスク            | 未完了   | `enhancement` `area:content` `area:popup` `p2`             |
| [#12](../issues/12) | content.js Phase A: `vtt-normalizer.js` / `debug-logger.js` を切り出す                                                   |     P1 | Phase 3               | **完了** | `p1` `enhancement` `area:content`                          |
| [#13](../issues/13) | content.js Phase B: `subtitle-track-resolver.js` を切り出す                                                              |     P1 | Phase 3               | **完了** | `p1` `enhancement` `area:content`                          |
| [#14](../issues/14) | 設定変更時と動画初期化時を基準に字幕設定を反映し、ページ離脱時リセット依存を減らす                                       |     P1 | Phase 3               | **完了** | `p1` `enhancement` `area:content`                          |
| [#16](../issues/16) | Phase C: `settings-bridge.js` / `debug-panel.js` を切り出す                                                              |     P1 | Phase C               | **完了** | `p1` `enhancement` `area:content`                          |
| [#17](../issues/17) | `content.js` の current 表示モデルを整理し、マーク移動と最小スクロールへ移行する                                         |     P1 | Phase 3 後半          | **完了** | `p1` `enhancement` `area:ui` `area:content`                |
| [#18](../issues/18) | primaryLang を英語以外にした場合に主字幕が表示されない問題を切り分ける                                                   |     P1 | Phase 3               | **完了** | `p1` `bug` `area:content`                                  |
| [#19](../issues/19) | Phase D: binder/sidebar 側で primary cue が UI に反映されない非対称を解消する                                            |     P1 | Phase D               | **完了** | `p1` `area:content` `area:ui`                              |
| [#20](../issues/20) | Phase E (1): `content.js` panel / overlay セクションの責務分離                                                           |     P1 | Phase E               | **完了** | `enhancement` `p1` `area:ui` `area:content` `area:options` |
| [#21](../issues/21) | Phase E (2): `content.js` binder / cue ロジックの整理と分割準備                                                          |     P1 | Phase E               | **完了** | `enhancement` `p1` `area:content` `area:options`           |
| [#22](../issues/22) | サブタイトルポップアップがビューポート外にはみ出さないよう位置計算を修正                                                 |     P1 | UI安定化              | **完了** | `p1` `bug` `area:content` `area:ui`                        |
| [#23](../issues/23) | [P2] subtitle overlay を Apple TV+ のネイティブ字幕に近い見た目へ調整する                                                |     P2 | UI調整                | **完了** | `p2` `enhancement` `area:ui` `area:content`                |
| [#24](../issues/24) | `attachTracks` / observer 周辺の安定化                                                                                   |     P1 | Phase E (3)           | 進行中   | `p1` `area:content` `area:observer`                        |
| [#26](../issues/26) | unconfigured flow と panel / notice / secondary host 生成条件の整理                                                      |     P1 | Phase E (3)           | **完了** | `p1` `bug` `area:content` `area:ui`                        |
| [#32](../issues/32) | subtitle sync / recovery の truth / health / recovery 境界を整理し、content.js から sync / layout 責務を段階的に外へ出す |     P1 | Phase E 後半〜Phase J | 進行中   | `p1` `area:content` `area:subtitle-sync`                   |

※ Issue #32 の設計詳細は `docs/issue-32-subtitle-sync-design.md` を参照する。  
※ `content.js` 分割原則は `docs/contentjs-split-roadmap.md` を参照する。

---

## 4. フェーズ構成

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
primary / secondary の非対称を減らし、current 行モデルの挙動を安定させる。  
[#19](../issues/19)

### Phase E: 最終整理

UI shell / binder / cue / observer / bootstrap の境界を維持しつつ、最も密結合で壊れやすい `content.js` 後半の責務を整理し、bootstrap 的な薄い入口へ寄せる。  
observer / layout / bootstrap の起動・再初期化・再接続を薄い配線層として整え、subtitle sync 改善を controller 側へ寄せやすくする。  
[#20](../issues/20), [#21](../issues/21), [#24](../issues/24), [#26](../issues/26), [#32](../issues/32)

この Phase E の中で、次のような中間到達点を踏んでいる。

- secondary subtitle DOM 管理ブロックが 1 セクションとしてまとまっている
- sync interval 系 6 関数が 1 セクションとしてまとまっている
- `content.js` に coordinator / playbackContext / reinitialize / retry / result bridge の見出しが入っている
- `playbackContext.js` が新規追加されている
- `manifest.json` に `playbackContext.js` が追加されている
- playbackContext 対象 14 関数が controller 優先 + local fallback で接続されている
- secondary recovery の Runtime First 方針と miss limit / primary-only fallback の挙動が、Issue #32 / Phase J の first cut として実装されている
- large seek 後の recovery 判定と sync 実行結果を観測できるログが追加されており、拡張側と Apple TV+ 側挙動の境界を説明しやすくなっている
- playback controls layout の責務移送ラウンドが完了し、`playback-controls-layout.js` を正本、`content.js` を layout controller instance 起点の thin coordinator とする接続へ整理された

### 並行 UI 調整タスク

既存の表示責務やトラック解決ロジックを変えずに、overlay / popup の UI を違和感の少ない見た目へ寄せる。  
content.js 分割の主線を壊さない範囲で、viewport clamp やネイティブ字幕寄せを行う。  
[#22](../issues/22), [#23](../issues/23)

### 後続タスク

Phase E と Issue #32 の主線が一段落した後で、popup / dictionary / AI タブ拡張へ戻る。  
ここでは UI を作る前に、分割後の構造に乗せやすい責務境界を確認してから進める。  
[#10](../issues/10)

---

## 5. 直近の作業方針

### 5.1 #24 側

- `attachTracks` の再実行経路を整理する
- observer の再接続条件を明示する
- bootstrap / cleanup の順序と責務をさらに薄くする
- 再初期化入口（`reinitializeSubtitlePipeline`）を entry / retry / result bridge に分けて `docs/contentjs-split-roadmap.md` と同期する

### 5.2 #32 側

- secondary recovery の miss limit / window の数値調整（現状の 1秒 / 2回目 force-rebind / 8回 miss limit をベースに微調整が必要か検討）
- primary-only fallback の採用条件見直し（ユーザ体感とログの両面から）
- current / panel / overlay の truth 境界整理の継続
- nearby rebuild / short-lived hold の利用条件を必要最小限に保つ
- large seek 後に secondary が戻らないケースを、
  - `evaluateSecondaryRecovery`（判定）
  - `triggerSecondaryRecovery`（trigger）
  - `syncSecondarySubtitleTrackBinding`（sync 実行）
    周辺で観測し、Apple TV+ 側挙動と拡張側ロジックの境界を docs に落とす
- panel 自動追従とユーザスクロール競合の緩和方針を決める

### 5.3 次ラウンド候補

次の `content.js` 責務移送ラウンドは、**1 回のスレッドで主題を 1 個に絞って選ぶ**。  
候補は次のとおり。

- reinitialize / retry / result bridge
- secondary subtitle DOM 管理
- sync interval orchestration
- initial cue recovery

playback controls layout は今回の単位で完了しているため、次は別責務へ移る。  
また、次ラウンドからは着手前後で `wc -l content.js` を取り、行数削減が実際に進んでいるかを確認する。

### 5.4 `playbackContext` 側

- `playbackContext` の local fallback をいつ外すか基準を決める
- 安定確認後に `content.js` 側の重複実装を削る段取りを設計する
- fallback 撤去の完了条件を docs / Issue コメントのどこに残すか決める

### 5.5 docs / Issue 側

- 設計の正本は `docs/issue-32-subtitle-sync-design.md`
- 分割原則の正本は `docs/contentjs-split-roadmap.md`
- この `docs/dev-roadmap.md` は進捗・現在位置・優先順だけに集中させる
- `playbackContext` 分割導入と current Phase J の Runtime First / 観測強化の状況を、Issue #32 コメントにも短く反映する
- playback controls layout ラウンドについては、「責務移送完了・実機確認済み」であることを設計 docs / roadmap / Issue コメントの間で矛盾なく揃える
- recovery 系の追加調査や設計変更を行う際の「NLM への相談テンプレ」（今回のゴール / 触る層 / 変更しない範囲 / 欲しい答え）を `docs/ai-session-templates.md` から参照する
- Issue #32 内の `content.js` 責務移送ラウンドのスコープ（今回触る層 / 触らない層 / 完了条件）を、設計スレ → 実装スレの 2 段構成で NLM に渡す方針を明文化する

---

## 6. 注意

- この文書は **進捗正本** であり、設計詳細の置き場ではない
- subtitle sync / recovery の詳細パラメータや runtime 方針は `docs/issue-32-subtitle-sync-design.md` に寄せる
- `content.js` の責務境界や分割原則は `docs/contentjs-split-roadmap.md` に寄せる
- AI セッション運用のテンプレは `docs/ai-session-templates.md` に寄せる
- 現在の主線は #24 / #32 であり、後続 UI タスクはこの主線を崩さない範囲で扱う
- `playbackContext.js` は phase-3 分割方針に沿った最初の実ファイル分割単位であり、今後の分割も同様に「主題を 1 個に絞ったラウンド」で進める
- playback controls layout の責務移送ラウンドは、layout 計算式や UI 挙動を変えずに `playback-controls-layout.js` へ移送し、`content.js` 側を thin coordinator に近づける先例として扱う
- recovery ロジックや観測設計の見直しは、今後も NLM を前提に相談しつつ、提案 diff は必ずローカルでの確認フェーズ（grep / sed / 実ログテスト）を経て採用可否を判断する
