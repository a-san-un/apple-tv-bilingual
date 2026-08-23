# Secondary 統合後の責務再定義一覧

以下は、**「secondary の状態を decision result に統合し、`cue-controller.js` を実行・交通整理役へ薄くする」**方針に基づく責務再定義です。現状でも `subtitle-sync-controller.js` は selection / readability、`cue-track-binder.js` は secondary monitor の状態と mode 復元、`secondary-track-recovery.js` は継続 missing 判定を主に担っているため、その境界を明確化する形です。


| モジュール | 再定義後の主責務 | 主な入力 | 主な出力 / 公開API | 持たない責務 | 移管・整理対象 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `modules/subtitle-sync-controller.js` | **secondary sync decision の正本**。track selection、readability、前回 binding との差分、monitor 状態、recovery 要求を統合し、最終 action を決定する | `video`、`requestedLang`、`previousBoundTrack`、`monitorState`、`recoveryRequest`、`forceRebind` | `buildSecondarySyncDecision()`、`selectSecondarySubtitleTrack()`、`getTrackReadability()`、`waitForReadableTrack()` | DOM 操作、listener attach / cleanup、track mode の直接変更、lane state の保持 | `cue-controller.js` の `staleMonitor`、`shouldRebind`、rationale 組み立てを移管する。 |
| `cue-controller.js` | **secondary action の実行と字幕描画 orchestration**。decision を受けて `clear` / `keep` / `wait-and-bind` / `bind` を実行し、cue を render する | `decision`、現在の video / cue、binder API、renderer | `syncSecondaryTrackOrchestration()`、render / scene block 更新 | candidate 選別、monitor 健全性の詳細判定、rebind policy のローカル実装、recovery の時間窓計算 | `staleMonitor`、`shouldRebind`、bind reason の三項演算子を削除し、decision の `action` に置換する。 |
| `modules/cue-track-binder.js` | **secondary monitor の実行器・所有者**。listener attach / cleanup、`track.mode` の適用・復元、monitor state の保持、実体上不要な再bindの最終防止を担当する | `track`、`requestedMode`、`originalMode`、`onCueChange`、`bindingMeta` | `startSecondaryMonitor()`、`stopSecondaryMonitor()`、`getSecondaryMonitorState()` | language selection、readability policy、recovery policy、なぜ rebind するかの判断 | `same-track-ref-same-mode` skip は残すが、「policy 判断」ではなく listener 再作成を避ける最終防波堤へ限定する。 |
| `modules/secondary-track-recovery.js` | **secondary lane の継続失敗検出・昇格判定**。runtime missing を時間軸で観測し、`idle` / `recover` / `force-rebind` / `terminated` を返す | health / runtime snapshot、current cue、時刻、derived recovery flag | `evaluateSecondaryRecovery()`、`resetSecondaryRecoveryLane()`、lane state | track selection、same track 判定、monitor stale 判定、direct bind 実行 | `missingDurationMs`、debounce、missCount、terminated retry をここだけの正本として維持する。 |
| `modules/subtitle-recovery-manager.js` | **recovery policy の集約窓口**。both-missing recovery と secondary recovery の結果を正規化して上位へ返す | merged subtitle health、track count、extension enabled、secondary recovery module | `evaluateBothMissingRecovery()`、`evaluateSecondaryRecovery()`、`reset()`、`dispose()` | DOM / `TextTrack` の保持、listener操作、track選定、bind実行 | secondary module の結果を `recoveryRequest` として decision builder に渡せる形式へ整える。 |
| `modules/playback-session-cleanup.js` | **再生 session 単位の撤収と再入ガード**。restart / close / content switch / extension OFF の cleanup 経路を集約する | cleanup reason、session state、controller / binder cleanup API | `resetForContentSwitch()`、session cleanup API | secondary track の選択、rebind判断、recovery判定、通常時のcue描画 | secondary monitor の停止は binder API を呼ぶだけにし、状態判断を持ち込まない。 |
| `content.js` | **Composition Root（生成・配線専用）**。state、controller、binder、recovery manager、cleanup を生成・接続し、ライフサイクル入口を呼ぶ | Chrome event、DOM ready、設定、各 factory | 各モジュールのインスタンス生成・依存性注入・destroy起点 | selection、readability、bind / recovery / cleanup の詳細条件 | Step 8 では decision / binder / recovery の実装ロジックを追加しない。 |
| `modules/subtitle-track-resolver.js` | **TextTrack の純粋な探索・比較ユーティリティ**。言語一致、forced 判定、cue / active cue / overlap の取得を提供する | `video`、`TextTrack`、requested language、current time | `resolveSecondarySubtitleTrack()`、`matchesRequestedLanguage()`、`isForcedLikeTrack()`、cue取得系 | bind、monitor保持、action決定、recovery状態 | `subtitle-sync-controller.js` から呼ばれる副作用なしの下位層として維持する。 |

## 依存方向

依存は次の一方向を基本とします。

```text
content.js
  ├─ cue-controller.js
  ├─ subtitle-sync-controller.js
  ├─ cue-track-binder.js
  ├─ subtitle-recovery-manager.js
  │    └─ secondary-track-recovery.js
  └─ playback-session-cleanup.js

cue-controller.js
  ├─ subtitle-sync-controller.js  // decision を取得
  ├─ cue-track-binder.js          // bind / unbind を実行
  ├─ subtitle-recovery-manager.js // recovery 要求を取得
  └─ renderer / scene block APIs

subtitle-sync-controller.js
  └─ subtitle-track-resolver.js   // 純粋な track / cue 情報を取得
```

`cue-track-binder.js` は `subtitle-sync-controller.js` を参照せず、`secondary-track-recovery.js` も `TextTrack` や binder を直接参照しない構造にします。これにより「判定」「実行」「時間軸 recovery」が混ざらなくなります。

## decision builder の責務

`modules/subtitle-sync-controller.js` に追加する `buildSecondarySyncDecision()` は、secondary に関する**状態解釈の唯一の正本**とします。


| 判定カテゴリ | decision builder が扱う内容 | 例 |
| :-- | :-- | :-- |
| Selection | requested language に対応する最適 track の選定 | forced-like 除外、言語一致、cue overlap 優先 |
| Readability | cues / activeCues / current cue text / overlap の snapshot | `readable: true / false` |
| Binding diff | 前回 bound track との差分 | `sameTrackRef`、`requestedLanguageChanged` |
| Monitor health | binder が公開する monitor state の解釈 | `active`、`hasCleanup`、track mismatch、`stale` |
| Recovery input | recovery manager からの昇格要求の取り込み | `requested`、`forceRebind`、reason |
| Action | 実行すべき処理の一意な決定 | `clear`、`keep`、`wait-and-bind`、`bind` |

## action ごとの実行担当

| Action | decision builder の責務 | `cue-controller.js` の責務 | binder の責務 |
| :-- | :-- | :-- | :-- |
| `clear` | track 不在を検出し、`track-missing` を返す | secondary unbind、render clear、scene更新 | listener cleanup、mode復元 |
| `keep` | same track / healthy monitor / 強制更新なしを判定する | 現在 cue の render と scene更新だけ行う | 呼ばれても物理的な再bindを避ける |
| `wait-and-bind` | unreadable track と短時間 wait の必要性を判断する | `waitForReadableTrack()` 後に bind、cue render | listener attach、mode適用、初回同期 |
| `bind` | track変更、language変更、stale monitor、force rebind を判定する | bind API 呼び出し、cue render | cleanup後のlistener再作成、mode適用、初回同期 |

## 状態の所有者

| 状態 | 正本モジュール | 補足 |
| :-- | :-- | :-- |
| 選択された secondary track | `subtitle-sync-controller.js` の decision result | 実際に bind 中かどうかは binder state を正とする |
| secondary monitor track / cleanup / original mode / requested mode | `modules/cue-track-binder.js` | `getSecondaryMonitorState()` で読み取り専用公開する。 |
| secondary readability snapshot | `modules/subtitle-sync-controller.js` | cue / activeCue / overlap は resolver から都度取得する。 |
| secondary recovery lane state | `modules/secondary-track-recovery.js` | `missingSince`、`missingDurationMs`、`missCount`、`terminated` を保持する。 |
| both-missing cooldown | `modules/subtitle-recovery-manager.js` | `lastBothMissingRecoveryAttemptAt` を内部保持する。 |
| playback session の cleanup 再入防止 | `modules/playback-session-cleanup.js` | content switch / restart / close で重複 teardown を防ぐ。 |
| popup / options の永続設定 | storage / `content.js` の設定読込層 | session cleanup では消さない。 |

## 実装上のルール

- `cue-controller.js` で新しい `if (sameTrackRef && ...)` や `if (staleMonitor && ...)` を増やさない
→ 条件追加は原則 `buildSecondarySyncDecision()` に集約する。
- `cue-track-binder.js` に requested language や readability を渡さない
→ binder は受け取った track を監視する実行層に留める。
- `secondary-track-recovery.js` に `TextTrack` を渡さない
→ recovery は health snapshot と時間軸だけを見る。
- `subtitle-sync-controller.js` は DOM を直接操作しない
→ `clear` や `bind` の決定は返すが、実行は controller に任せる。
- `content.js` に secondary 条件分岐を置かない
→ factory 生成、依存性注入、イベント接続、session lifecycle 起動だけを担当する。

この境界を守ることで、Step 7 では条件の正本を `subtitle-sync-controller.js` の decision builder に寄せ、Step 8 では `content.js` を安全に配線専用へ縮小できます。

