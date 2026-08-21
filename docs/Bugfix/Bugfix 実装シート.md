# Bugfix 実装シート 2026-08-21（作業台版）

**ブランチ:** `issue-32-content-core-split`  
**対応マスタープラン:** Bugfix マスタープラン 2026-08-21（要約版）  
**このシートの役割:** 今まさに着手している修正の対象・変更方針・実装順・検証観点・実機ログ観点を 1 枚に集約する。完了したら archive し、次のテーマでは新しい実装シートへ切り替える。

***

## 今回の作業テーマ

### 主テーマ

**M-2: secondary 条件統合の実装（Step 7）**

secondary の selection、readability、monitor health、recovery、rebind 条件の正本を `subtitle-sync-controller.js` 側へ集約し、`cue-controller.js` を action 実行中心の orchestration に寄せる。

### 副テーマ

- F-5: lifecycle ごとの secondary cleanup / mode restore の確認
- F-8: decision 単位のログ整理
- M-1: 長時間再生時メモリ増加の継続観測
- F-4: 初回 async response エラーの持ち越し調査

***

## 現在の症状

| # | 症状 | 観察事実 | 関連 ID | 状態 |
|---|---|---|---|---|
| 1 | メッセージチャネルクローズエラー（初回のみ） | `A listener indicated an asynchronous response...` はまだ残るが、UI 復旧自体は達成済み | F-4 | 🟠 持ち越し |
| 2 | ネイティブ字幕メニューに干渉せず OFF 後復元を成立させたい | secondary cleanup / mode restore は binder 側へ集約済み。残りは lifecycle 経路の確認 | F-5 | 🟠 検証継続 |
| 3 | DevConsole にログが残りやすい | noisy ログは一部 suppress 済みだが、decision 単位の整理は未完了 | F-8 | 🟠 一次整理済み |
| 4 | 長時間再生で Renderer メモリ使用量が大きく増える | cleanup 多重実行対策は入ったが、listener / observer / timer 蓄積は継続観測が必要 | M-1 | 🟠 調査継続 |
| 5 | secondary の条件判断が複数モジュールに分散している | `cue-controller.js` に `staleMonitor` / `shouldRebind` のローカル組み立てが残る | M-2 | ⬜ 今回の主対象 |

***

## 今回の到達目標

### 完了条件

- `subtitle-sync-controller.js` に secondary decision の正本がある
- `cue-controller.js` が `staleMonitor` / `shouldRebind` を自前で組み立てない
- action が `clear` / `keep` / `wait-and-bind` / `bind` の 4 種に整理されている
- 同一 track の一時 unreadable で rebind しない
- recovery の一時空状態で force rebind しない
- bind / cleanup / mode restore は binder 側に留まる
- 実機で seek / SPA 遷移 / ON-OFF / panel 開閉後も secondary が安定する

***

## 触るファイル

### 今回の主対象

- `modules/subtitle-sync-controller.js`
- `cue-controller.js`

### 必要に応じて触る

- `modules/cue-track-binder.js`
- `modules/subtitle-recovery-manager.js`
- `modules/secondary-track-recovery.js`

### 今回は原則触らない

- `content.js`  
  配線専用を維持する。decision 条件は持ち込まない。

***

## 実装方針

### 目指す構成

secondary の selection、readability、monitor health、recovery 要求、前回 bind 状態との差分を、`subtitle-sync-controller.js` の decision builder へ集約する。

`cue-controller.js` はその結果を見て、bind / keep / clear / wait-and-bind を実行するだけに寄せる。

### decision result 例

```js
{
  track,
  snapshot,

  selection: {
    sameTrackRef,
    requestedLanguageChanged,
  },

  monitor: {
    healthy,
    stale,
  },

  recovery: {
    requested,
    forceRebind,
    reason,
  },

  derived: {
    trackFound,
    readable,
    shouldClear,
    needsReadableWait,
    needsRebind,
    canKeepCurrentBinding,
  },

  action: {
    type: "clear" | "keep" | "wait-and-bind" | "bind",
    reason,
    requestedMode: "hidden",
  },
}
```

### action の意味

| action | 使用条件 | controller 側の処理 |
|---|---|---|
| `clear` | secondary track が存在しない | unbind、render clear、scene 再構築 |
| `keep` | 同一 track かつ monitor 健全、recovery 要求なし | 現在の binding を維持 |
| `wait-and-bind` | track はあるが readable 待ちが必要 | `waitForReadableTrack()` 後に bind |
| `bind` | track 変更、requested language 変更、monitor stale、force rebind など | binder 経由で bind / replace |

***

## controller から移したいもの

今回の主眼は、`cue-controller.js` に残っている secondary 詳細判定を外すこと。

### 移管対象

- `staleMonitor` の判定
- `shouldRebind` の組み立て
- bind rationale の分岐
- unreadable track に対する warmup 判定
- `waitForReadableTrack()` を呼ぶべきかの判定
- recovery と selection / monitor を統合した最終 action 決定

### controller に残すもの

- decision 呼び出し
- action switch
- bind / clear / render / scene rebuild の実行
- 上位 orchestration とログ出力

***

## 実装順

1. `modules/subtitle-sync-controller.js` に `buildSecondarySyncDecision()` を追加する
2. selection result と readability snapshot を decision builder の入力に寄せる
3. monitor state を decision 入力へ渡せるようにする
4. recovery manager の結果を decision 入力へ渡す
5. `clear` / `keep` / `wait-and-bind` / `bind` の action を返す
6. `cue-controller.js` の secondary sync を action switch ベースへ置き換える
7. `staleMonitor` / `shouldRebind` / rationale 組み立てを controller から削る
8. decision 単位のログを追加する
9. 実機検証を行う
10. 結果をこのシートへ追記する

***

## 実装時の制約

- 同一 track の一時 unreadable を `bind` の直接理由に戻さない
- 一時的な空状態で recovery force rebind を返す挙動へ戻さない
- listener attach / cleanup、mode apply / restore を controller 側へ戻さない
- `content.js` に selection / recovery / cleanup 判定を増やさない
- native 字幕 UI の状態を拡張側で直接書き換えない

***

## 検証チェックリスト

### 基本動作

- [ ] primary / secondary 字幕が同時に表示される
- [ ] secondary 言語を `ja → ko`、`ko → ja`、`ja → en` に切り替えられる
- [ ] 同一 track の一時 unreadable で unbind / bind が繰り返されない
- [ ] track 変更時だけ secondary bind が走る
- [ ] requested language 変更時に正しい track へ移る
- [ ] monitor stale 時に必要な bind / replace が走る
- [ ] recovery force rebind 時に必要な bind が走る
- [ ] track 不在時に secondary listener と表示が clear される

### lifecycle

- [ ] short seek 後に字幕が復帰する
- [ ] hard seek 後に old listener / retry が残らない
- [ ] SPA 遷移後に previous session の cleanup が多重実行されない
- [ ] panel close / open 後も secondary monitor が正しく維持または停止される
- [ ] extension OFF 時に secondary listener が cleanup され、track mode が復元される
- [ ] extension ON 復帰時に secondary 字幕が再表示される
- [ ] playback close / restart 時に cleanup が 1 回だけ実行される

### ログ

- [ ] action type が `clear` / `keep` / `wait-and-bind` / `bind` として出力される
- [ ] action reason が track missing、same track healthy、track changed、requested language changed、stale monitor、force rebind などとして判別できる
- [ ] `keep` のとき bind / cleanup が実行されていないことを確認できる
- [ ] cleanup skip と実 cleanup を区別できる
- [ ] noisy な probe ログが通常時に復活していない

***

## 実機ログ観点

### 確認したいログ

- decision 入力
  - selected track
  - sameTrackRef
  - requestedLanguageChanged
  - monitor healthy / stale
  - recovery requested / forceRebind
- decision 出力
  - action type
  - action reason
- bind / cleanup
  - secondary bind 実行
  - secondary keep
  - cleanup skip
  - 実 cleanup
- lifecycle
  - hard seek
  - SPA 遷移
  - playback close
  - restart

### 見え方の理想

- 同一 track 健全時は `keep`
- track 変更時は `bind`
- unreadable 直後は `wait-and-bind` または `keep`
- track 不在時は `clear`
- cleanup 実体は 1 回だけ観測される

***

## 今回の作業ログ

### 既に入っている前提修正

- Step 5: unreadable 即 rebind 抑制
- Step 6: recovery の継続失敗中心化
- Step 6.5: hard seek / SPA 遷移時 cleanup 多重実行防止
- Step 6.6: secondary 条件統合の設計確定と責務境界の文書化

### 今回の着手前メモ

- 実装対象は Step 7
- 6.6 は設計完了であり、実装はまだ
- 次にやるのは `buildSecondarySyncDecision()` 導入と controller 側条件削減

### 実装後に追記する項目

- 変更した関数名
- 削除できた controller 側条件
- 追加した decision ログ
- 実機テスト結果
- 残課題

***

## 参照資料

- `docs/Bugfix/Bugfix マスタープラン.md`
- `docs/Bugfix/Secondary 条件統合メモ.md`
- `docs/Bugfix/Secondary 統合後の責務再定義一覧.md`

***

## 直近コミット

| コミット | 内容 |
|---|---|
| `3afc931` | `refactor: secondary 条件統合の設計を整理する (Issue #32)` |
| `ea5d814` | `fix: hard seek / SPA遷移時の cleanup 多重実行を防ぎ、secondary track 復帰の基盤を整理する (Issue #32)` |

情報源
