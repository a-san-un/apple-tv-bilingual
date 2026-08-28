# 残存ログの probe 制御整理メモ

## 背景

直近の整理で、Panel / Startup / Recovery の詳細観測ログの一部は既存 probe へ移管済みである。最新コミットは `1077e4f refactor: startup・panel・recovery の詳細ログを probe 経由へ追加整理する` で、ブランチ `issue-32-content-core-split` はリモートと同期している。

一方で、リポジトリ内にはまだ `logContent?.(...)` が残っており、役割の異なるログが同じ経路で混在している。現状の既存 probe は `content.js` にある `logSubtitleProbe`、`logPanelProbe`、`logStartupProbe`、`logRecoveryProbe` の4本で、個別の debug flag で有効化される構成になっている。

## 現状の既存 probe

`content.js` では次の debug flag と probe 関数が定義されている。

| probe | flag | 現在の役割 |
|---|---|---|
| `logSubtitleProbe` | `DEBUG_SECONDARY_SUBS` | 字幕 snapshot / cue 観測 |
| `logPanelProbe` | `DEBUG_PANEL_PROBE` | パネル描画 / UI レイアウト観測 |
| `logStartupProbe` | `DEBUG_STARTUP_PROBE` | 起動 / readiness / auto-start 観測 |
| `logRecoveryProbe` | `DEBUG_RECOVERY_PROBE` | recovery / skip / wait / fallback 観測 |

このため、今後「全ログを probe で制御する」方針を採る場合も、既存設計を拡張する形で進めるのが自然である。新しい probe も `content.js` にまとめて置き、各 module へ DI する方針で揃えるのがよい。

## 残存 `logContent` の全体像

残存 `logContent` は少なくとも 41 箇所あり、分布は session cleanup、startup skip、secondary recovery、subtitle reset、cue 再構築などにまたがっている。ファイル別の分布は次のとおりである。

| ファイル | 件数 | 主な内容 |
|---|---:|---|
| `sync-interval-orchestrator.js` | 7 | secondary recovery entry / trigger / pass / action evaluated |
| `modules/playback-session-cleanup.js` | 6 | cleanup phase / reset for content switch / UI state clear |
| `modules/lane-recovery-state.js` | 6 | lane reset / `laneRecoveryDecision` |
| `modules/cue-track-binder.js` | 5 | secondary monitor stop / reset / bind skip / bind fail / start |
| `settings-runtime.js` | 3 | auto-start skip / language readiness skip / restart skip |
| `modules/subtitle-sync-controller.js` | 3 | pending sync task orchestration |
| `modules/playback-context-controller.js` | 3 | direct fallback / native fallback result |
| `modules/panel-ui.js` | 2 | dispose start / done |
| `modules/playback-startup-coordinator.js` | 2 | playback target changed / cleanup skipped |
| `modules/subtitle-state-reset.js` | 2 | subtitle state clear / full reset for toggle |
| `modules/cue-render-coordinator.js` | 1 | current scene subtitle block rebuild |
| `modules/cue-sequence-builder.js` | 1 | cue sequence rebuild |

## 推奨する probe 分類

残存ログは、用途ごとに次の6分類へ整理するのがよい。

| probe | 目的 |
|---|---|
| `logLifecycleProbe` | session / cleanup / target change / start skip / toggle reset |
| `logStartupProbe` | readiness / attach / polling / timeout / retry |
| `logPanelProbe` | panel render / layout / panel state / native toggle |
| `logRecoveryProbe` | secondary monitor / recovery pass / fallback / lane decision |
| `logSubtitleProbe` | cue sequence / block rebuild / current subtitle render |
| `logLookupProbe` | popup / dictionary / translation / Tatoeba などの UI lookup |

この分類にすると、既存の詳細 probe を温存しつつ、高レベル遷移を `logLifecycleProbe` へ切り出せる。加えて、字幕構築系と辞書 UI 系も別 probe に切り離せるため、ブラウザテスト時に必要な観測だけを選択しやすくなる。

## `logLifecycleProbe` 候補

高レベル遷移、skip 理由、cleanup 境界は `logLifecycleProbe` に寄せるのが自然である。これらは詳細な recovery や readiness の内部観測ではなく、「セッションがどう進んだか」を追うためのログだからである。

| ファイル | ログ | 推奨先 |
|---|---|---|
| `settings-runtime.js` | `initial auto-start skipped: no video` | `logLifecycleProbe` |
| `settings-runtime.js` | `language selection not ready yet; skip start` | `logLifecycleProbe` |
| `settings-runtime.js` | `restartBilingual skipped because extension is disabled` | `logLifecycleProbe` |
| `modules/panel-ui.js` | `panel-ui dispose start` | `logLifecycleProbe` |
| `modules/panel-ui.js` | `panel-ui dispose done` | `logLifecycleProbe` |
| `modules/playback-startup-coordinator.js` | `playback target changed` | `logLifecycleProbe` |
| `modules/playback-startup-coordinator.js` | `playback target changed cleanup skipped` | `logLifecycleProbe` |
| `modules/playback-session-cleanup.js` | `playback session cleanup ${phase}` | `logLifecycleProbe` |
| `modules/playback-session-cleanup.js` | `playback session prepare restart` | `logLifecycleProbe` |
| `modules/playback-session-cleanup.js` | `resetForContentSwitch reentry skipped` | `logLifecycleProbe` |
| `modules/playback-session-cleanup.js` | `playback session reset for content switch` | `logLifecycleProbe` |
| `modules/playback-session-cleanup.js` | `playback session ui state cleared` | `logLifecycleProbe` |
| `modules/playback-session-cleanup.js` | `playback target missing after cleanup` | `logLifecycleProbe` |
| `modules/subtitle-state-reset.js` | `subtitle state cleared` | `logLifecycleProbe` |
| `modules/subtitle-state-reset.js` | `subtitle state fully reset for toggle` | `logLifecycleProbe` |

## `logRecoveryProbe` 候補

secondary lane の監視、recovery 判定、fallback、rebind はすべて `logRecoveryProbe` に寄せるべきである。これらは既存の recovery probe の責務に素直に収まる。

| ファイル | ログ | 推奨先 |
|---|---|---|
| `modules/cue-track-binder.js` | `secondary monitor stopped` | `logRecoveryProbe` |
| `modules/cue-track-binder.js` | `secondary monitor fully reset for toggle` | `logRecoveryProbe` |
| `modules/cue-track-binder.js` | `secondary monitor bind skipped` | `logRecoveryProbe` |
| `modules/cue-track-binder.js` | `secondary monitor bind failed` | `logRecoveryProbe` |
| `modules/cue-track-binder.js` | `secondary monitor started` | `logRecoveryProbe` |
| `modules/lane-recovery-state.js` | `secondary recovery lane reset` | `logRecoveryProbe` |
| `modules/lane-recovery-state.js` | `laneRecoveryDecision` 全件 | `logRecoveryProbe` |
| `modules/playback-context-controller.js` | `subtitle sync direct selected track` | `logRecoveryProbe` |
| `modules/playback-context-controller.js` | `subtitle sync direct fallback to native` | `logRecoveryProbe` |
| `modules/playback-context-controller.js` | `subtitle sync native fallback result` | `logRecoveryProbe` |
| `modules/subtitle-sync-controller.js` | `ensureSyncIntervalOrchestrator` | `logRecoveryProbe` または `logLifecycleProbe` |
| `modules/subtitle-sync-controller.js` | `cancelPendingSyncTask` | `logRecoveryProbe` |
| `modules/subtitle-sync-controller.js` | `createPendingSyncTask` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary sync context` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary recovery terminated` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary recovery entry` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary recovery trigger started` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary recovery trigger finished` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary recovery pass started` | `logRecoveryProbe` |
| `sync-interval-orchestrator.js` | `secondary recovery action evaluated` | `logRecoveryProbe` |

`modules/subtitle-sync-controller.js` の task orchestration 系3件は、recovery 補助ログとして扱うなら `logRecoveryProbe` が最も収まりがよい。ただし「同期タスクのライフサイクル」を独立して見たいなら、将来的に `logLifecycleProbe` へ寄せる再検討余地はある。

## `logSubtitleProbe` 候補

字幕 block や cue sequence の再構築は、panel / startup / recovery のどれにも綺麗には入らない。そのため、既存の `logSubtitleProbe` を字幕構築系にも拡張して使うのがよい。

| ファイル | ログ | 推奨先 |
|---|---|---|
| `modules/cue-render-coordinator.js` | `cue-render-coordinator: rebuildCurrentSceneSubtitleBlocks` | `logSubtitleProbe` |
| `modules/cue-sequence-builder.js` | `cue-sequence-builder: rebuild` | `logSubtitleProbe` |

## `logLookupProbe` 候補

今回の残存 `logContent?.(...)` 一覧には含まれないが、`content.js` には popup / dictionary / translation 関連の `logContent(...)` 呼び出しが残っている。単語ポップアップや辞書 API を今後も観測対象にするなら、`logLookupProbe` を独立させるのがよい。

候補例は次のとおり。

| ファイル | ログ例 | 推奨先 |
|---|---|---|
| `content.js` | `showPopup position` / `showPopup` | `logLookupProbe` または `logPopupProbe` |
| `content.js` | `fetchDictionary Jisho failed/success` | `logLookupProbe` |
| `content.js` | `fetchTatoeba UI empty/success` | `logLookupProbe` |
| `content.js` | `fetchTranslation UI start/success/error` | `logLookupProbe` |

## `console.*` は別ワークストリームで扱う

`console.debug / warn / error / log` も残っているが、これは `logContent` 残存問題とは切り離して扱うべきである。`subtitle-view-resolver.js` や `overlay-controller.js` の `console.debug` は probe flag ガード付き、`content.js` の `console.warn/error` は障害時可視化、`background.js` は content script とは責務が異なる。

したがって、今回のドキュメントでは `console.*` は次のように扱う。

| 区分 | 方針 |
|---|---|
| gated debug console | 将来の probe 化候補として保留 |
| error / warn fallback | 障害時可視性のため原則維持 |
| background / logger self logs | content probe 整理の対象外 |

## DI と実装構造

`content.js` は既存 probe を1箇所に持ち、各 module の factory へ `deps` または `services` 経由で注入する構造である。このため、新 probe も `content.js` に追加し、同じ流儀で渡すのがもっとも一貫する。

現時点で確認できている DI 上の注意点は次のとおりである。

| 対象 | 現状 | メモ |
|---|---|---|
| `settingsRuntime` | `logStartupProbe` は注入済み | `logLifecycleProbe` を追加しやすい |
| `playbackStartupCoordinator` | `services.logContent` と `services.logStartupProbe` を使用 | `logLifecycleProbe` を追加しやすい |
| `playbackSessionCleanup` | `logContent` のみ注入 | `logLifecycleProbe` 用の引数追加が必要 |
| `subtitleStateReset` | `logContent` のみ注入 | `logLifecycleProbe` 用の引数追加が必要 |
| `subtitleSyncController` | `services.logRecoveryProbe` は注入済み | `createSyncIntervalOrchestrator` への受け渡し設計を明示する |
| `cueTrackBinder` | factory は `logContent` を受けられるが、`content.js` では未注入 | `logRecoveryProbe` を渡すよう修正が必要 |
| `cueRenderCoordinator` | logger 未注入 | `logSubtitleProbe` を使うなら deps 拡張が必要 |
| `cueSequenceBuilder` | `logContent` を注入済み | `logSubtitleProbe` へ置換しやすい |

## 推奨ワークストリーム

### Phase 1: probe 定義追加

`content.js` に `logLifecycleProbe` と `logLookupProbe` を追加する。既存 probe と同じく `DEBUG_*` flag を持たせ、`logContentUi` または適切な category へ橋渡しする。

### Phase 2: Lifecycle 系移管

`settings-runtime.js`、`modules/panel-ui.js`、`modules/playback-startup-coordinator.js`、`modules/playback-session-cleanup.js`、`modules/subtitle-state-reset.js` へ `logLifecycleProbe` を渡し、残存高レベルログを置換する。

### Phase 3: Recovery 系移管

`modules/cue-track-binder.js`、`modules/lane-recovery-state.js`、`modules/playback-context-controller.js`、`modules/subtitle-sync-controller.js`、`sync-interval-orchestrator.js` を `logRecoveryProbe` に寄せる。`sync-interval-orchestrator.js` は `subtitle-sync-controller.js` 経由で probe を渡す。

### Phase 4: Subtitle / Lookup 系移管

`modules/cue-render-coordinator.js` と `modules/cue-sequence-builder.js` を `logSubtitleProbe` に寄せる。必要に応じて `content.js` の popup / dictionary / translation 系ログを `logLookupProbe` へ移す。

### Phase 5: 最終監査

全 `.js` を再 grep し、`logContent?.(...)` の残件をゼロまたは意図的保留のみへ絞る。`console.*` は別表で管理し、今回対象外の理由を明記する。

## 実装順の提案

実装順は次が安全である。

1. `content.js` に新 probe 定義を追加  
2. `settings-runtime.js` / `playback-startup-coordinator.js` から `logLifecycleProbe` を導入  
3. `playback-session-cleanup.js` / `subtitle-state-reset.js` の deps 拡張  
4. `subtitle-sync-controller.js` 経由で `sync-interval-orchestrator.js` に `logRecoveryProbe` を流す  
5. `cue-track-binder.js` の DI 修正  
6. `cue-render-coordinator.js` / `cue-sequence-builder.js` を `logSubtitleProbe` へ移行  
7. 全体 grep で監査

## 期待する到達状態

最終的には、`logContent` は「一般ログの後方互換 API」として残せても、各 module の運用ログは probe 単位で制御できる状態にするのが望ましい。特にブラウザテストや手動検証では、`Lifecycle + Startup`、`Recovery のみ`、`Subtitle のみ` のように有効化セットを切り替えられる構成が最も扱いやすい。
