# Apple TV+ Bilingual Subtitles 最新メモ統合 v2

## 概要
このメモは、直近の確認内容を 1 本の Markdown に統合したものである。対象は主に **secondary subtitle の描画・再バインド・recovery pass**、および playback controls layout 周辺の構造と呼び出し経路である。[cite:96][cite:97][cite:121]

現時点の理解では、実行の中心は `content.js` 単体ではなく、そこから分離された helper 群へ責務が逃がされており、`cue-controller.js`、`sync-interval-orchestrator.js`、settings/runtime 系の処理が連携して secondary subtitle の表示維持を行っている。[cite:96][cite:97][cite:121]

## 現在見えている構造
コード上では、secondary subtitle の実レンダリング関数 `renderSecondarySubtitle` は複数箇所から参照されており、少なくとも `cue-controller.js`、`sync-interval-orchestrator.js`、統合出力 `repo-output/apple-tv-bilingual.txt`、および `content.js` 本体から利用されている。[cite:96]

特に `cue-controller.js` では、通常の cue change 反映、override 経由の描画、hold block の復元、通常同期時の描画など複数の経路から `renderSecondarySubtitle` が呼ばれていることが確認できる。[cite:96]

一方 `sync-interval-orchestrator.js` 側では、通常の cue event に依存せず、一定間隔の監視の中で secondary lane の health を観測し、必要時に recovery trigger や recovery pass を起動する構造になっている。[cite:121]

## 呼び出しの大枠
settings の初期ロード時には、`loadSettingsFromSync()` が snapshot を読み込み、`requestedSecondaryLang` と `effectiveSettings` を state へ反映する。設定が有効で、かつ `state.video` と secondary language が揃っている場合、`cueController.syncSecondarySubtitleTrack(state.video, effectiveSecondaryLanguage, renderSecondarySubtitle)` が呼ばれ、その後 `state.secondaryTrack = cueController.getBoundSecondaryTrack()` で反映結果を state に戻している。[cite:121]

同様の流れは settings 変更時にも使われており、`resolvedSecondaryLanguage` がある場合に `cueController.syncSecondarySubtitleTrack(...)` が再度実行され、そのあと `restartBilingual(next, "SETTINGS_CHANGED", ...)` が呼ばれる構造になっている。[cite:121]

通常起動側では `startBilingual()` が playback readiness を確認した後、`syncHistoryContextWithPlayback("startBilingual")`、`bindTracks()` を呼び出し、その中で secondary resolver / binder の attach 処理へ進む。[cite:121]

## secondary subtitle の attach / bind
secondary attach の主入口では、secondary language が存在する場合に `syncSecondarySubtitleTrackBinding(video, secondaryLang, renderSecondarySubtitle)` が呼ばれ、存在しない場合は `cueController.unbindSecondarySubtitleTrack()` と `renderSecondarySubtitle("", null)` により明示的に解除・クリアされる。[cite:121]

この bind 完了後、`state.secondaryTrack = cueController.getBoundSecondaryTrack()` で最新の bound track が state へ戻されているため、**bind の真実の所有者は cueController 側**であり、`content.js` は結果を受け取る coordinator 的な立場に寄っていると解釈できる。[cite:121]

実際に `bindSecondarySubtitleTrack(track, renderSecondarySubtitle)` は `track.mode = "showing"` または `hidden` への調整を試み、`cuechange` listener を設定し、listener 内で `renderSecondarySubtitle(getCurrentCueText(track), track)` を呼ぶ。さらに bind 直後の initial paint としても `renderSecondarySubtitle(getCurrentCueText(track), track)` が 1 回実行される。[cite:96][cite:121]

## renderSecondarySubtitle の呼ばれ方
`renderSecondarySubtitle` は少なくとも次の経路から呼ばれている。[cite:96][cite:121]

- secondary track の `cuechange` listener 内。[cite:96]
- primary/secondary をまとめて見る `onCueChange()` の中で、`state.secondaryTrack` があれば `renderSecondarySubtitle(sText, state.secondaryTrack)` を呼ぶ経路。[cite:96]
- `bindSecondarySubtitleTrack()` の initial paint。[cite:96]
- resolver/binder の attach で secondary language が空になったときの clear 描画 `renderSecondarySubtitle("", null)`。[cite:121]
- subtitle view resolver を経由した `resolvedSecondaryText` の描画。[cite:121]
- recovery pass / sync interval 周辺から渡される render callback。[cite:121]

このため、secondary subtitle の表示は単一イベントに依存せず、**cue event / attach 初期描画 / state 再同期 / recovery 処理**の複数経路で上書きされる設計になっている。[cite:96][cite:121]

## renderSecondarySubtitle 実装断面
`renderSecondarySubtitle(text, track)` の本体は、まず `ensureSecondarySubtitleElement()` を呼び、secondary subtitle の受け皿 DOM を必ず 1 個に正規化してから処理を進める構造になっている。[cite:96]

`ensureSecondarySubtitleElement()` 自体は `[data-secondary-subtitle], .dual-subtitles-secondary` を全件検索し、複数あれば先頭だけ残して削除し、属性や class の不足も補う。必要に応じて `atv-panel-host` や panel host の slot を遅延生成するため、render 側は「要素が無い」より「要素はある前提で text をどう確定するか」に集中した構造になっている。[cite:96]

render 本体では、`secondary-dom render-entry`、`secondary-dom render-final`、`secondary-dom render-applied` の順にログが仕込まれており、入力 text、最終反映 text、DOM 反映後の element 状態を分けて観測できるようになっている。[cite:96]

また `lastSecondaryText` と `lastSecondaryTextAt` を見ながら、空文字になった瞬間に即消すのではなく、`SECONDARY_SUBTITLE_GRACE_MS` の猶予内では直前の字幕を保持し、猶予超過後に clear する分岐が入っていることが読み取れる。このため render は単純な `el.textContent = text` ではなく、**truth と idle clear の間に保留レイヤーを持つ**実装になっている。[cite:96]

最終適用時には `el.textContent = finalText` と `el.dataset.language = track?.language` を設定し、直後に `logSubtitlePanelState("after-renderSecondarySubtitle")` を呼んで panel snapshot と照合している。したがってこの関数は secondary subtitle の単独描画関数であると同時に、panel 側 current block 状態との差分観測点でもある。[cite:96]

ログ上で `secondary-dom render-applied` が `appliedTextLength: 5` と `appliedTextLength: 0` の両方を取っていることから、DOM 生成や接続は成立していても、`finalText` が空へ落ちる分岐が実際に起きていることが分かる。ここは secondary recovery の症状と直接つながる観測点である。[cite:96]

## syncSecondarySubtitleTrack 実装断面
`cue-controller.js` 側の `syncSecondarySubtitleTrack(video, requestedLang, renderSecondarySubtitleOverride, options)` は、secondary track の **resolver と binder の中継点**として動いている。[cite:121]

この関数はまず `video` の存在を確認し、`options.suppressRender === true` と `options.forceRebind === true` を読み取り、現在の `secondaryTrackBound` を `previousBoundTrack` として保持する。続いて `resolveSecondarySubtitleTrack(video, requestedLang)` を呼び、候補解決結果と以前の bound track を比較する。[cite:121]

解決結果については `sameTrackRef`、`resolvedTrackCuesLength`、`resolvedTrackActiveCuesLength`、current time、mode、language などをまとめて `secondary-sync resolver-selected` と `secondary sync raw` に記録しており、**resolver の選択成功と cue 可読性は別問題**として扱っていることが分かる。[cite:121]

track が見つからなかった場合は `unbindSecondarySubtitleTrack()` を行い、`suppressRender` でなければ `renderSecondarySubtitleOverride || renderSecondarySubtitle` に空文字と `null` を渡して clear する。そのため「見つからない」は DOM 残骸を残さず明示的 clear へ落とす設計である。[cite:121]

track が見つかった場合でも、`sameTrackRef === true` かつ `resolvedTrackCuesLength > 0` なのに `resolvedTrackActiveCuesLength === 0` という条件下では `shouldRebindBecauseUnreadable` が立ち、`secondary-sync rebind-required` が `sameTrackButUnreadableAtCurrentTime` 理由で出力される。これは**同じ track object を握っていても、その時点では読めない track と見なして再 bind する**ための分岐である。[cite:121]

その後の分岐では、`secondaryTrackBound !== track`、`forceRebind`、`shouldRebindBecauseUnreadable` のいずれかが真なら `bindSecondarySubtitleTrack(track)` を実行し、さらに `rebuildCurrentSceneSubtitleBlocks()` を呼んで current block / panel / overlay 側の整合を取り直す。逆に再 bind が不要な場合のみ、`suppressRender` でなければ `renderSecondarySubtitle(getCurrentCueText(track), track)` で即時 refresh する。[cite:121]

つまり `syncSecondarySubtitleTrack()` は「単に resolver で選んで返す関数」ではなく、**resolve → readability 判定 → rebind or immediate render → current scene rebuild** まで含んだ coordinator である。[cite:121]

## sync interval による監視と recovery
`sync-interval-orchestrator` では、secondary lane の miss が一定条件を満たしたときに `triggerSecondaryRecovery()` が動く。ここでは recovery action が `recover` または `force-rebind` の場合のみ処理を継続し、開始時点の `secondaryTrackFoundBefore` と `secondaryActiveCuesLengthBefore` を採取してログ出力している。[cite:121]

その後 `syncSecondarySubtitleTrack({ reason: recoveryDecision.reason, forceRebind: recoveryDecision.action === "force-rebind" })` が呼ばれ、終了時には `secondaryTrackFoundAfter` と `secondaryActiveCuesLengthAfter` を再度記録している。[cite:121]

runtime log でも、`secondary recovery trigger started` → `secondary-sync resolver-selected` → `secondary sync raw` → `secondary-sync rebind-required` → `secondary sync result: track re-bound` → `secondary recovery trigger finished` という流れが実際に観測されている。[cite:121]

## force-rebind 判定の見え方
runtime log では、選ばれた日本語 track 自体は存在しているが、`selectedTrackActiveCuesLength` が 0、`selectedTrackCurrentCueTextLength` も 0、かつ `selectedTrackHasCueOverlapAtCurrentTime` が false の状態が観測されている。[cite:121]

そのため `sameTrackRef` が true でも `sameTrackButUnreadableAtCurrentTime` を理由に rebind-required と判定され、結果として `secondary_force_rebind_after_repeated_miss` 理由で track re-bind が実行されている。[cite:121]

ただし re-bind 後も `activeCuesLength` は 0 のままで、`renderInvoked: true` で終わっているログがあるため、**track object の再取得・listener 再設定までは成功しても、その瞬間に cue が読めるとは限らない**ことが確認できる。[cite:121]

## recovery pass の役割
`runSecondaryRecoveryPass(effectiveSecondaryLanguage)` は、まず `syncSecondarySubtitleTrackBinding(state.video, effectiveSecondaryLanguage, renderSecondarySubtitle, { suppressRender: true })` を呼び、secondary track binding を suppressRender つきで再同期する。その後 `cueController?.getBoundSecondaryTrack?.()` から state へ current bound track を戻している。[cite:121]

さらに `lastLargeSeekAt` と現在時刻との差分、video の有無、textTrack 数、primary/secondary track object の有無をまとめて `secondary recovery pass started` として記録しており、これは **大きな seek 後の不安定化や track 再選択の失敗を切り分けるための観測点**として機能している。[cite:121]

実ログでも `textTrackCount: 272`、`millisSinceLargeSeek` 付きで recovery pass started が複数回記録されており、sync interval ループの中で繰り返し recovery pass が走っていることが確認できる。[cite:121]

## UI / DOM 側の状態
`ensureSecondarySubtitleElement()` は `[data-secondary-subtitle], .dual-subtitles-secondary` を全件検索し、複数存在した場合は先頭を残して重複要素を削除する。したがって secondary subtitle DOM は **常に単一要素へ正規化する前提**になっている。[cite:96]

ログ上でも `secondary-dom render-applied` が繰り返し記録されており、適用対象 element は `DIV.dual-subtitles-secondary` で、接続状態 `isConnected: true` が保たれているケースが確認できる。[cite:96]

一方で `appliedTextLength` が 5 のときと 0 のときが混在しているため、DOM 要素自体の消失よりは、**描画対象テキストの解決結果が空文字になる問題**の比重が高いと読める。[cite:96]

## playback controls layout 周辺
playback controls layout 側には、footer / header / progress / skip overlay などへ managed style を適用する一連の helper があり、`data-atvb-*` 属性や base transform / width 属性を保存しながら可逆的に補正する構造が見えている。[cite:97]

具体的には `applyManagedTranslateX`、`clearManagedTranslateX`、`applyManagedFooterSizing`、`applyManagedHeaderSizing`、`applyManagedProgressInset`、`applyManagedSkipPosition` などが存在し、panel の表示によって安全領域 `safeAreaRight` / `safeAreaWidth` を計算し、それに応じて Apple TV+ 側の controls を押し出す設計になっている。[cite:97]

`getPlaybackPanelLayoutAnchor()` は panel selector、`.dual-subtitles-secondary`、`[data-secondary-subtitle]` の順に anchor を解決し、`computePlaybackVisibleArea()` は video rect と panel rect から safe gutter を引いた visible area を算出する。つまり字幕 panel や secondary subtitle の DOM が layout 計算の anchor としても使われている。[cite:97]

## 現時点の整理
現状の責務分担は次のように見ると整理しやすい。[cite:96][cite:97][cite:121]

| レイヤー | 主な責務 | 主な入口 |
|---|---|---|
| settings/runtime | 設定読込、requested/effective language 反映、restart 判断 | `loadSettingsFromSync()`, settings changed path [cite:121] |
| startup/coordinator | playback readiness 判定、history context 同期、全体起動 | `startBilingual()`, `bindTracks()` [cite:121] |
| cue controller | secondary track bind/unbind、cuechange listener、initial paint、readability 判定つき再 bind | `bindSecondarySubtitleTrack()`, `syncSecondarySubtitleTrack()` [cite:96][cite:121] |
| sync interval orchestrator | health 監視、miss count、recovery / force-rebind 判定 | `triggerSecondaryRecovery()`, `runSecondaryRecoveryPass()` [cite:121] |
| DOM/UI | secondary subtitle 要素の確保、grace 付き render 適用、重複除去 | `ensureSecondarySubtitleElement()`, `renderSecondarySubtitle()` 周辺 [cite:96] |
| playback controls layout | panel/字幕 DOM を anchor にした controls 位置補正 | managed style helpers, visible area 計算 [cite:97] |

## いま分かっているボトルネック
今回のログからは、secondary track の選択そのものが常に失敗しているというより、**選択済み track が current time で unreadable** と判定されるケースが継続し、その結果 rebind と recovery pass が反復していることが主要症状に見える。[cite:121]

また DOM は接続されたまま render-applied まで進んでいるため、単純な「要素が無い」問題ではなく、`getCurrentCueText(track)` や overlap 判定、activeCues 読み出し、あるいは `suppressRender` を含む bind/recovery のタイミングの方が重要な観測点である可能性が高い。[cite:96][cite:121]

## 次に詰めるべき確認点
次の調査では、以下を 1 本ずつ確認すると整理が進む。[cite:96][cite:121]

- `findCueAt(track, time)` と `getCurrentCueText(track)` が hidden/showing 状態や seek 後にどう振る舞うか。[cite:96]
- `resolveSecondarySubtitleTrack(video, requestedLang)` の候補選定条件と forced-like 除外の重みづけ。[cite:121]
- `suppressRender: true` のときに panel / overlay / current block のどこまで更新が止まるか。[cite:121]
- `rebuildCurrentSceneSubtitleBlocks()` が rebind 後に secondary text をどう補完しているか。[cite:121]
- playback controls layout の anchor が空文字 secondary DOM を見ても安全に計算できるか。[cite:97]

## 補足
この版では、前回の統合メモを土台にしつつ、`renderSecondarySubtitle()` 本体と `syncSecondarySubtitleTrack()` 実装断面を追加して、secondary subtitle recovery の読み筋を一段深くした。[cite:96][cite:121]

特に重要なのは、`renderSecondarySubtitle()` が **grace つきの表示保持レイヤー**であり、`syncSecondarySubtitleTrack()` が **resolve だけでなく readability 判定と rebind を含む coordinator**である、という 2 点である。ここを押さえると、secondary lane の不調が「DOM の消失」ではなく「読めない track と空へ落ちる finalText の連鎖」で説明しやすくなる。[cite:96][cite:121]
