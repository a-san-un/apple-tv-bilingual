# Bugfix 仕様確定書

**対象ブランチ:** `issue-32-content-core-split`  
**文書の位置づけ:** 現在進めている Bugfix の設計確定と修正方針の正本。実装はこの文書の責務境界・状態遷移・禁止事項に従う。  
**対象範囲:** Apple TV+ 上の字幕表示、native 字幕制御、overlay / panel UI、secondary track 選択、recovery、lifecycle cleanup、runtime messaging のうち、今回の整理対象に含まれるもの。  
**対象外:** 将来着手項目、長期計測計画、後続フェーズ専用の整理タスク。これらは別の将来作業計画に退避する。  

***

## 1. 目的

今回の Bugfix の目的は、単なる症状対処ではなく、字幕制御の責務を再分離し、再生開始・seek・SPA 遷移・OFF/ON・destroy をまたいでも一貫して壊れない構造へ更新することにある。  
とくに、secondary track の判断、bind / keep / clear の実行、native 字幕復元、overlay / panel 表示制御、cleanup の所有者を明確に分け、`content.js` に判断ロジックが逆流しない状態を作る。  

この文書では、次の 4 点を確定する。

- 何をどのモジュールの責務とするか
- どの状態で何を表示・非表示・復元するか
- どの終了経路で何を cleanup するか
- 今回の修正で禁止する実装パターンは何か

***

## 2. 設計原則

### 2-1. 責務分離

今回の修正では、次の原則を守る。

- `content.js` は配線専用とし、業務判断を持たない
- 字幕トラックの判断は decision 層に集約する
- 実際の bind / unbind / monitor attach / cleanup は binder 層が持つ
- secondary の再取得・再接続判断は recovery 系が持つ
- native 字幕の退避・復元は cue-controller 系が正本を持つ
- UI の表示制御と DOM 存在管理は UI 層が持つ
- session の開始・終了に伴う統合 cleanup は lifecycle / cleanup 系が持つ

これにより、同じ条件分岐が複数モジュールに散らばる状態を止める。

### 2-2. 単一正本

以下の情報は、それぞれ一箇所だけを正本とする。

| 項目 | 正本 |
|---|---|
| secondary を bind すべきかの判断 | decision 関数 |
| primary / secondary track の bind 実行 | cue-track-binder |
| native 字幕の元 mode | cue-controller が保存する original mode |
| overlay の位置計算 | overlay 位置同期関数 |
| session 単位の cleanup 実行 | playback-session-cleanup |
| UI の存在状態 | UI host の実 DOM |

同じ意味の状態を複数のフラグで持たない。

### 2-3. セッション分離

再生セッションをまたぐ状態の持ち越しを禁止する。  
old session の listener、observer、timer、retry、watch、pending recovery は、新 session に引き継いではならない。  

### 2-4. 触った分だけ戻す

native 字幕や native UI に対して、拡張機能は必要最小限だけ介入し、OFF または終了時には**自分が変更した分だけ**戻す。  
Apple TV+ 本体が持つ UI の構造や状態を、拡張側の都合で恒久的に書き換えない。  

***

## 3. アーキテクチャ責務

## 3-1. `content.js`

`content.js` は初期化・依存性生成・接続・停止の配線だけを担当する。  
次のようなロジックは持たない。

- secondary を bind するかどうかの条件判断
- recovery を発火するかどうかの条件判断
- cleanup 実行条件の詳細分岐
- `TextTrack.mode` をどう変えるかの判断
- panel / overlay 表示位置の算出ロジック本体

許可される責務:

- 各モジュールの生成
- モジュール間依存の注入
- 起動フローの開始
- shutdown / destroy の入口呼び出し
- 高水準イベントの受け渡し

### 3-2. cue-controller

cue-controller は primary 字幕と native 字幕の受け渡し責務の正本とする。  
主な責務は次のとおり。

- primary 字幕 track の bind / unbind
- bind 前の native `track.mode` の退避
- overlay 使用中の native 字幕抑制
- OFF / 終了時の native 字幕復元
- 拡張側が変更した CSS / track 状態の解除

ただし、secondary の選定基準そのものは持たない。

### 3-3. decision 層

secondary 関連の実行要否は、専用の decision 関数で一元判断する。  
この判断は最低でも次を返せる必要がある。

- action: `bind` / `keep` / `clear` / `skip`
- reason: なぜその action なのか
- target: 対象 track があるか
- recoveryHint: recovery 系が見る補助情報
- observability: ログに出すための最小診断情報

この結果をもとに binder や recovery が動く。  
各実行側が独自に再判断してはならない。

### 3-4. cue-track-binder

binder は decision の実行者であり、secondary listener / monitor の所有者でもある。  
主な責務は次のとおり。

- decision の action に従った bind / keep / clear の実行
- secondary track への listener attach
- detach / cleanup の実行
- 同一 session 内での多重 attach 防止
- 所有中リソースの明示的破棄

binder は「何をすべきか」は決めず、「決まったことを安全に実行する」ことに専念する。

### 3-5. recovery 系

recovery 系は、secondary track が失われた、再取得が必要、再接続を試みる、といった回復処理を扱う。  
ただし、通常経路の bind 判定と recovery 条件を混同しない。  

主な責務:

- secondary 消失時の再探索
- 必要時のみの再試行
- retry / watch の上限管理
- session 境界での保留処理破棄
- decision 層への入力条件の補助

### 3-6. playback-session-cleanup / lifecycle 系

session 終了に関わる総 cleanup の正本とする。  
主な責務:

- session 単位の cleanup 呼び出し集約
- 多重 cleanup 防止
- old session 資源の確実破棄
- close / destroy / restart / SPA 遷移など終了経路の統一処理
- cleanup 実行済み / skip の状態区別

***

## 4. 状態モデル

今回の実装は、少なくとも次の状態を区別して扱う。

| 状態 | extensionEnabled | panel | overlay | native subtitles | 説明 |
|---|---|---|---|---|---|
| S1 | OFF | なし | なし | 復元状態 | 拡張は字幕描画を行わない |
| S2 | ON | 閉 | 表示 | 抑制 | overlay が字幕描画を担当 |
| S3 | ON | 開 | 表示 | 抑制 | overlay は左可視領域中央へ寄せる |
| S4 | ON | 遷移中 | 必要に応じ再計算 | 抑制 | seek / SPA / episode change 中の過渡状態 |
| S5 | 終了処理中 | 破棄中 | 破棄中 | 復元中または復元済み | cleanup 実行中 |

重要なのは、panel の開閉は overlay の生死を決めないこと、そして ON/OFF が overlay 存在の第一条件であること。

***

## 5. 表示仕様

## 5-1. native UI

Apple TV+ のネイティブ UI アイコン群、ヘッダー、フッター、シークバー、再生操作群には干渉しない。  
拡張機能は、それらを隠す、移動する、縮める、消す、といった操作を行わない。  

## 5-2. native toggle

native toggle は拡張全体の ON/OFF だけを担当する。  
OFF 中でも残してよい常設要素は native toggle のみとする。  

## 5-3. panel

panel は ON 時だけ存在できる。  
OFF 時は非表示ではなく、原則として破棄対象とする。  

panel の責務は secondary 情報の閲覧や操作であり、overlay 表示の有無を直接決めない。  
panel の開閉状態は overlay 位置計算には影響するが、overlay 自体を消す条件にはならない。

## 5-4. overlay

overlay は ON 時にのみ存在し、字幕描画の正本である。  
panel が閉じていても開いていても表示を継続する。  

配置ルール:

- ON + panel 閉: 動画全体の中央下
- ON + panel 開: 右 panel 幅を除いた左側可視領域の中央下
- OFF: 非表示ではなく破棄対象
- 終了処理中: cleanup に従って破棄

***

## 6. native 字幕制御仕様

### 6-1. ON 時

拡張が primary 字幕を overlay 描画へ引き取るとき、bind 前の native `track.mode` を保存してから抑制へ移る。  
このとき、native 字幕を拡張都合で恒久的に変更してはならない。  

要件:

- original mode は bind 前に保存する
- overlay 使用中は native 字幕を抑制する
- secondary 用に変更した状態を native 側へ残さない
- native menu の意味と `TextTrack.mode` の制御責務を混同しない

### 6-2. OFF 時

OFF 時は「触った分だけ戻す」を厳守する。  
拡張側が保存していた original mode に戻し、拡張が注入した字幕抑制 CSS を除去する。  

処理順の原則:

1. native 字幕復元
2. overlay / panel など拡張 UI 破棄
3. 設定適用完了

### 6-3. 空白許容

OFF 切り替え直後に、一瞬字幕が見えない時間が入る可能性は許容する。  
ただし、最終状態として native 字幕が再利用可能であることを優先する。  

***

## 7. secondary 選択仕様

secondary の扱いは、今回の修正で最重要の一つとする。  
従来のように、controller 側、binder 側、recovery 側でそれぞれ独自条件を持つ構造は廃止する。  

### 7-1. 判断モデル

secondary の扱いは decision 関数が一度だけ決める。  
出力 action は少なくとも次のいずれかとする。

- `bind`: 新しい secondary を bind する
- `keep`: 現在の secondary を維持する
- `clear`: 現在の secondary を解除する
- `skip`: 今回は何もしない

### 7-2. 判断材料

decision 層は、最低でも次の入力を見られる必要がある。

- 現在の primary / secondary track 情報
- 既存 bind 状態
- track 再生成有無
- seek / restart / SPA 遷移などの lifecycle 条件
- recovery 中かどうか
- current session に属する情報かどうか

### 7-3. 実行原則

- decision を見ずに binder が独自 bind しない
- decision を見ずに recovery が独自 clear しない
- `keep` と `skip` を混同しない
- 同じ理由で複数箇所が重複ログを出さない

***

## 8. recovery 仕様

recovery は「通常の bind 判定に失敗したから毎回走る処理」ではない。  
secondary track の消失や再生成など、回復が必要な条件に限定して動く。  

要件:

- retry は無制限に増やさない
- watch は session をまたいで残さない
- recovery 中でも action の正本は decision 層にある
- recovery 完了後、不要な pending 状態を残さない
- old track を再利用候補として握り続けない

禁止事項:

- track が見つからないたびに無制限 retry
- new session 開始後も old session 用 timer が残ること
- recovery ログが通常 bind ログと区別できないこと

***

## 9. lifecycle / cleanup 仕様

### 9-1. 対象経路

少なくとも次の経路で cleanup が正しく成立しなければならない。

- panel close
- playback close
- extension OFF
- extension ON 復帰
- short seek
- hard seek
- SPA 遷移
- destroy
- restart
- 別エピソード遷移
- 別作品遷移

### 9-2. cleanup 原則

- 同一 session への cleanup 実体は 1 回だけ
- cleanup skip と cleanup 実行は明確に区別する
- listener / observer / timer / retry / watch を owner 単位で破棄する
- UI 破棄と track 復元の責務を混ぜない
- old session の保留処理を new session へ持ち越さない

### 9-3. 所有権

cleanup し忘れを防ぐため、所有権を固定する。

| 資源 | owner |
|---|---|
| primary subtitle bind 状態 | cue-controller |
| secondary bind / listener | cue-track-binder |
| recovery retry / watch | recovery 系 |
| session 統合 cleanup | playback-session-cleanup |
| panel / overlay DOM | UI 管理層 |

owner 以外が暗黙に破棄しない。

***

## 10. runtime messaging 仕様

runtime messaging は今回の主軸ではないが、設計上の前提はここで確定する。  
message channel closed 系の問題を再発させないため、送信契約を明確化する。  

### 10-1. 送信種別

メッセージは次の 2 種類に分ける。

- request-response: 応答が必須
- fire-and-forget: 応答不要

この区別を曖昧にしたまま `return true` を使わない。

### 10-2. 要件

- `return true` を返す経路では、応答完了の責務を明示する
- 応答不要の経路では、疑似的に request-response へしない
- content script 再注入や page 遷移時の race を前提に設計する
- retry が必要でも、回数と条件を限定する
- 未解決 Promise を放置しない

***

## 11. 初期化仕様

### 11-1. `extensionEnabled`

初期値は OFF を正とする。  
storage 未設定時は `false` として扱い、明示的に ON にされたときだけ拡張機能を有効化する。  

### 11-2. 起動順

起動時は次の順を原則とする。

1. settings 読み出し
2. 高水準 coordinator / controller 群の生成
3. UI 注入可否判定
4. ON の場合のみ overlay / panel / binder 系起動
5. 必要な監視開始

`extensionEnabled` 確定前に UI 注入可否を silent fail で判定してはならない。

### 11-3. 早期 return の扱い

初期化や注入関数で早期 return する場合、理由が観測できるログを残す。  
「何も起きなかった」状態を silent にしない。  

***

## 12. DOM / UI 正本

DOM 上の役割名と責務を固定する。  

| 要素 | 役割 | OFF 時 |
|---|---|---|
| `#atvb-native-toggle` | 拡張全体 ON/OFF | 残す |
| `#atv-toggle-btn` | panel 開閉 | 破棄 |
| `#atv-panel-host` | panel host | 破棄 |
| `#atv-panel-root` | panel 本体 | host とともに消える |
| `#atv-overlay-host` | overlay host | 破棄 |
| `[data-atvb-overlay-root]` | overlay 内部 root | host とともに消える |
| `[data-atvb-overlay-primary]` | primary 描画先 | 破棄 |
| `[data-atvb-overlay-secondary]` | secondary 描画先 | 破棄 |

host が正本であり、inner root 単体残留は異常状態として cleanup 対象とする。

***

## 13. ログ仕様

今回の修正では、ログは「量」ではなく「責務の切り分け」を優先する。  

分類原則:

- decision: なぜ bind / keep / clear / skip になったか
- binder: 実際に何を attach / detach / bind / clear したか
- recovery: なぜ再探索 / retry したか
- lifecycle: どの経路で cleanup / restart / destroy が走ったか
- ui: panel / overlay / toggle の生成と破棄
- messaging: request-response / fire-and-forget の送信結果

要件:

- 同じ事実を複数層が重複出力しない
- 一時観測ログは恒久仕様に含めない
- 通常再生でノイズ過多にしない
- 問題発生時の因果関係は追える

***

## 14. 禁止事項

今回の修正では、以下を禁止する。

- `content.js` に個別の字幕判断ロジックを再追加すること
- 複数モジュールがそれぞれ secondary 判断を持つこと
- owner 以外が暗黙に listener / timer / watch を破棄すること
- session をまたいで old state を再利用すること
- OFF 時に native 字幕を未復元のまま UI だけ破棄すること
- panel 開閉で overlay を消すこと
- `return true` を返したのに応答しないこと
- silent early return を量産すること
- 一時デバッグコードを恒久仕様として残すこと

***

## 15. 完了条件

今回の Bugfix は、少なくとも次を満たしたときに完了と判断する。

- `content.js` が配線専用になっている
- secondary の判断正本が一箇所に集約されている
- binder が実行責務と所有資源を明確に持っている
- recovery が通常判定と混線していない
- native 字幕が OFF / 終了時に一貫して復元される
- overlay / panel の存在条件が ON/OFF と整合している
- cleanup が全終了経路で多重なく成立する
- old session の listener / timer / retry が持ち越されない
- runtime messaging の送信契約が明確である
- ログが責務ごとに読める

***

## 16. 実装順の指針

実装は次の順で進める。

1. decision 正本の確立
2. binder の実行責務統一
3. cue-controller の native 復元責務固定
4. `content.js` の配線専用化
5. lifecycle / cleanup 統合
6. UI / overlay / panel 条件整理
7. messaging 契約整理
8. ログ整理と不要分岐削除

この順番を崩して局所対処を先に積むと、責務が再び分散しやすい。

***

## 17. 備考

この文書は、現在の Bugfix の**仕様正本**であり、途中メモではない。  
曖昧な実装都合で例外分岐を増やすのではなく、ここで定義した責務境界に合わせて既存コードを寄せる。  

また、将来着手項目や再評価待ちの残件はこの文書に戻さない。  
それらは将来作業計画側で管理し、この仕様書は「今回確定したものだけ」を保つ。


