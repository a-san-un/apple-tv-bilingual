# Apple TV+ Bilingual Subtitles 設計まとめ

この文書は、Apple TV+ Bilingual Subtitles の **現行仕様・責務境界・UI 方針** を整理した設計書である。

この文書で扱うもの:

- 現状コードで確定している UI / 表示 / 設定の仕様
- 今後も維持したい責務境界
- `content.js` 内の各レイヤーをどう捉えるか
- unconfigured flow を含む表示条件の考え方

この文書で扱わないもの:

- issue の進捗・完了状態の正本管理
- `content.js` 分割の段階順や実装バッチの詳細
- AI セッション運用テンプレ

正本の位置づけ:

- 実装順や issue の進捗管理は `docs/dev-roadmap.md` を正本とする
- `content.js` 分割の段階方針や安全策は `docs/contentjs-split-roadmap.md` に寄せる
- AI セッションの依頼テンプレは `docs/ai-session-templates.md` に寄せる
- この文書は、現行仕様・責務境界・UI 方針の正本とする

---

## 1. システム全体像

### 1.1 現在の構成

- Chrome 拡張 Manifest V3
- `background.js`: 外部 API 通信用 Service Worker
- `content.js`: Apple TV+ 再生画面へ UI を注入するメインロジック
- `popup.html` / `popup.js`: 簡易設定 UI
- `options.html` / `options.css` / `options.js`: 別タブの詳細設定画面
- 現行バージョン表記は phase-3 系列の設計を前提とする

### 1.2 コンポーネントの責務

- popup / options は「設定値を入力・保存する UI」
- background は通知や外部連携の橋渡し
- content は設定読込、fallback 適用、字幕 track 解決、再生中 UI への反映を担当する
- 実際にどの字幕 track を採用するかの最終判断は `content.js` 側で行う

### 1.3 用語整理

- `popup` は文脈によって 2 種類ある
  - **extension popup**: ブラウザ拡張の popup UI（`popup.html` / `popup.js`）
  - **subtitle popup**: 字幕上で単語クリック時に出る辞書 / AI 補助 popup
- この文書で単に `popup` と書く場合、混乱しやすい箇所では **subtitle popup** / **extension popup** を明示する

---

## 2. 言語設定と適用責務

### 2.1 基本方針

- popup は簡易設定、options は詳細設定という役割分担に寄せる
- `primaryLang` は必須設定
- `secondaryLang` は空値を許容する
- `secondaryLang = ""` の場合は、content 側でブラウザ言語 fallback を適用する
- 設定 UI では `textTracks` の生データを直接表示しない
- popup / options の言語候補は、動画依存の `textTracks` ではなく固定言語一覧ベースで扱う

### 2.2 設定値の意味

#### `primaryLang`

`primaryLang` は「学習したい主字幕言語」を表す。

- popup または options で設定する
- `chrome.storage.sync` に保存する
- `content.js` が読み込んで再生中の字幕処理へ反映する

#### `secondaryLang`

`secondaryLang` は「補助表示に使う言語」を表す。

- 値が設定されていれば、その言語を優先する
- 空値なら、content 側でブラウザ言語 fallback を適用する
- UI 上では「ブラウザ言語を使う」を明示する

### 2.3 設定ライフサイクル

#### 主トリガー

- 設定適用の主トリガーは **設定変更時** と **動画ページ初期化時**
- ページ離脱時は、設定反映ではなく必要最小限の cleanup を主目的とする

#### 擬似フロー

設定変更時:

```text
popup/options で設定保存
  -> storage.sync 更新
  -> （必要なら）background 経由で content へ通知
  -> content が設定を再読込
  -> secondaryLang が空ならブラウザ言語 fallback
  -> resolver 実行
  -> UI へ再適用
```

動画ページ初期化時:

```text
content 初期化
  -> storage.sync から設定読込
  -> secondaryLang が空ならブラウザ言語 fallback
  -> resolver 実行
  -> UI 初期描画
```

ページ離脱時:

```text
ページ離脱検知
  -> listener / timer / observer を必要最小限で解放
  -> 設定値そのものは storage 側で変更しない
  -> 次回の初期化時フローで再適用
```

### 2.4 `content.js` 側の責務

`content.js` で扱うこと:

1. 設定値の読込
2. `textTracks` の正規化
3. primary / secondary 用 track の resolver
4. current / history / future の描画
5. 動画レイヤー上への UI 注入と再配置

設定 UI との境界:

- popup / options は固定言語一覧のみを表示する
- UI では `textTracks` の生データや `forced` 付き候補を直接見せない
- `secondaryLang` 空値時のブラウザ言語 fallback は `content.js` 側で適用する
- どの track を採用するかは `content.js` 側の resolver が決める

### 2.5 `textTracks` と WebVTT 正規化

Apple TV+ の `textTracks` には、同一言語でも通常字幕・captions・forced など複数種が混在する可能性がある。  
そのため、設定 UI では単純な言語選択だけを扱い、実際の track 選択とテキスト正規化は `content.js` 側で解決する。

解決方針:

- UI 層では「1 言語 = 1 候補」として扱う
- `content.js` 側で `textTracks` を正規化する
- resolver は優先順位ベースで最終採用 track を決定する
- 基本優先順位は「通常字幕 → captions → forced」
- forced 字幕は UI の直接候補には出さないが、通常候補がない場合の内部 fallback 候補として保持する
- WebVTT の cue テキストから `<c.styledotitalic>` のようなタグ断片を除去する
- 正規化後の観測は、F12 Console 補助ログではなく右字幕パネル下部の Debug セクションを主導線とする

主な観測項目:

- `tracks resolved`
- `Selected tracks detail`
- `primaryTrackFound`
- `secondaryTrackFound`

---

## 3. 字幕 UI の基本設計

### 3.1 全体レイアウト

- 動画コンテナは 70% 幅を基準に扱い、右側 30% を字幕パネル領域として使う方針
- 右パネルは「履歴 + 現在 + 未来」の一覧型
- 各字幕ブロックは primary / secondary の 2 行表示
- 左下 overlay は、右字幕パネルを閉じたときの補助表示として現在字幕 2 行を表示する
- パネルは `✕` で閉じ、閉じた時だけ右上の再表示ボタンで開く構成を基本とする

### 3.2 右字幕パネル

- 履歴一覧を残す
- 各字幕ブロックは 2 行表示
  - 1 行目: primary
  - 2 行目: secondary
- 右字幕パネルは、上から次の 3 層構造を維持する
  1. 固定ヘッダー（`字幕履歴` / `⚙️` / `閉じる✕`）
  2. 固定 debug ログセクション
  3. 字幕一覧のスクロール領域（history / current / future）
- 履歴ブロックをクリックしてシークできる現機能は維持する

### 3.3 current 行モデル

- current 表示は、**独立 current ブロック強調** ではなく **字幕一覧内の current 行 + 左側固定幅マーク欄** を基本モデルとする
- 字幕行は `[mark][subtitle text]` の 2 カラム構造とし、マークが出ても字幕本文の列位置はずれないようにする
- current の時だけ左側マーク欄に `▶` などの再生マークを表示する
- past / current / future の字幕本文は、色・背景・文字サイズをすべて同一とする
- current の背景塗り、強い黄色強調、全体グレーアウトは行わない
- current / history / future のテキストは、選択・コピー可能な DOM のまま維持する

### 3.4 スクロール挙動

- 通常時は字幕リストを動かさない
- 再生位置の変化に応じて、**再生マークだけ** current 行へ移動する
- current が字幕パネル下部のしきい値まで来た時だけ、字幕リストを上へスクロールする
- スクロール量は最小限とし、毎 cue ごとの細かいスムーススクロールは行わない
- current を常に中央へ寄せる方式は採用しない
- 動きの主役は「字幕強調」ではなく「マーク移動 + 必要時のみ最小スクロール」とする

### 3.5 overlay

- 左下 overlay は、右字幕パネルを閉じたときの補助字幕表示として扱う
- overlay の表示責務と panel の表示責務は分けて考える
- overlay は subtitle shell の一部として扱うが、panel と同じ表示条件にはしない
- overlay 上の単語クリック処理は event delegation ベースで扱う

### 3.6 subtitle popup

- subtitle popup は字幕上の語彙学習用 UI として扱う
- ヘッダーに単語、音声、設定、閉じるを配置する余地を持たせる
- 辞書情報、補助説明、例文、AI 補助タブを段階的に表示する
- 字幕本体の 2 行表示と、学習補助 popup は役割を分ける
- popup の UI shell 整理と、辞書 / AI タブ拡張本体は別フェーズで進める
- 辞書入力文字列の正規化仕様（例: `You're` → `Youre`）は、popup / dictionary 系の後続課題として扱う

### 3.7 debug 導線

- ATV DEBUG の独立表示は廃止し、右字幕パネル下部の折り畳みセクションへ統合する
- debug ログセクションはヘッダー直下に固定されたままとする
- 折りたたみ時は 1 行、展開時は数行のログ本文を表示できる状態を維持する
- settings / debug の新導線は増やさず、既存 UI と `window.ATVB.settingsBridge` / `window.ATVB.debugPanel` / `window.ATVB.logger` を再利用する

```text
┌────────────────────────────────────────────┐
│ 字幕履歴                         [⚙️][閉じる✕] │
├────────────────────────────────────────────┤
│ デバッグログ（開発者向け）              ▶︎ │
├────────────────────────────────────────────┤
│ [    ]  12:03                             │
│        I mean, it sounds weird.           │
│        つまり、変に聞こえるけど。          │
│                                            │
│ [ ▶ ]  12:05                             │
│        but it's still like making a baby. │
│        でもそれはまだ赤ちゃんを育てるようなもの。│
│                                            │
│ [    ]  12:07                             │
│        You have to keep feeding it.       │
│        ずっと面倒を見ないといけない。       │
└────────────────────────────────────────────┘
```

---

## 4. panel / overlay / notice の表示条件

### 4.1 基本方針

- `panelVisible` は「ユーザーが subtitle panel を開いているか」を表す状態として扱う
- `showSidebar` は「UI として sidebar 機能が有効か」を表す設定として扱う
- この 2 つは似て見えても責務を分ける
- popup settings apply のたびに panel を自動で開く挙動は採用しない

### 4.2 unconfigured flow の原則

- 未設定時は、必要な場面で language setup notice を出して導線を示す
- 未設定だからといって、常に空の panel を自動表示し続ける設計にはしない
- 空の secondary subtitle host や、内容のない panel / overlay を不用意に再生成しない
- unconfigured flow では「何を表示するか」だけでなく「何を生成しないか」も重要な仕様とする

### 4.3 notice / panel / secondary host の関係

- `showLanguageSetupNotice()` は、未設定時の導線表示責務として扱う
- secondary subtitle host の生成条件は、notice 表示責務とは分けて考える
- secondary host は、必要な言語選択が揃っていない状態では不用意に作らない
- 再初期化や `startBilingual()` 後の導線でも、未設定時に空の shell だけが残る状態を避ける
- notice を出しているのに空の panel / secondary host が別経路で生成される状態は、設計上の不整合として扱う

### 4.4 現在の安定化結果

#26 で次の整理を行った。

- `showLanguageSetupNotice()` と panel 表示条件の整合を見直した
- `ensureSecondarySubtitleElement()` の生成条件を見直した
- 未設定時に空の secondary subtitle host や panel が出る経路を抑止した
- `attachTracks` / 再初期化 / 動画切替周辺で、未設定時に古い状態を引きずらないよう整理した
- 「たまに panel が開く」系の不安定挙動を抑止した

---

## 5. primary 非英語時の扱い

### 5.1 確認済みのこと

- resolver レイヤーでは、`primaryLang = de / ja / zh / ko / fr / es` でも `primaryTrackFound: true` になる
- `subtitle-track-resolver.js` では、underscore 区切り正規化と主要 3 文字コードの 2 文字コード寄せを追加済み
  - `deu -> de`
  - `jpn -> ja`
  - `zho` / `chi -> zh`
  - `kor -> ko`
  - `fra` / `fre -> fr`
  - `spa -> es`
- `content.js` 側では、`primaryActiveCues` / `hasFreshPrimarySnapshot` / `lastPrimarySnapshotAt` を使った live 優先 + snapshot 鮮度付き判定へ整理済み
- Debug ログ上では、`primaryCueTextLength > 0` / `snapshotPrimaryTextLength > 0` が観測できる

### 5.2 維持する設計

- binder / sidebar / `renderPanel` 側の非対称は解消済みとする
- primary track は `showing` で運用し、non-en primary でも cue 可用性を確保する
- `video::cue` 非表示を維持し、ネイティブ字幕の二重表示を防ぐ
- `findCueAt` の `track.cues` 参照を保護し、mode 遷移時でも安全に cue 探索できるようにする
- `primary = state.primaryTrack` / `secondary = state.secondaryTrack` の責務分離は維持する
- resolver の言語一致仕様、`secondaryLang` fallback、current 行モデルは変更しない

---

## 6. `content.js` の責務境界

### 6.1 基本方針

- `content.js` は最終的に bootstrap 的な薄い入口へ寄せたい
- ただし、一度に全面分割せず、挙動を壊さない責務整理を優先する
- UI shell と binder / cue logic と observer / bootstrap は同じ差分で大きく混ぜない

### 6.2 UI shell

UI shell として扱う対象:

- panel
- debug
- overlay
- subtitle popup
- notice / panel slot / secondary host 周辺の shell 生成導線

設計方針:

- create 系は host 作成、shadow 準備、shell 適用、wiring 呼び出しに集中させる
- 長い template は `build*ShellHTML()` / `build*StyleText()` 系へ寄せる
- render は shell を新規作成せず、既存 shell に状態を反映する責務に留める
- 未設定時の notice / panel / secondary host 生成条件も UI shell 境界の一部として追える形にする

### 6.3 binder / cue logic

binder / cue logic として扱う対象:

- track binding
- cue handling
- history 管理
- current row 連携
- snapshot 周辺

設計方針:

- track binding 関数群を近接配置して見通しを上げる
- cue handling 関数群をまとまりとして見えるようにする
- 挙動変更よりも、関数グルーピング、コメント境界、早期 return、薄い helper 化を優先する

### 6.4 observer / bootstrap

- `ResizeObserver` / `MutationObserver` / timer / retry / bootstrap は最後に整理する
- observer の二重登録や disconnect 漏れを防ぐ
- 動画切替、再初期化、settings apply の責務境界を明確にする
- unconfigured flow と `attachTracks` 周辺の安定化を優先する
- Phase E では、特に notice 表示条件、secondary host 生成条件、再初期化導線の整合を重視する

---

## 7. options 画面

### 7.1 役割

- `options.html` を別タブで開く
- `options.html` / `options.css` / `options.js` で責務分離する
- ON / OFF はトグルスイッチ中心で整理する
- popup は簡易設定、options は詳細設定として役割を分ける

### 7.2 基本項目

- `primaryLang` は必須
- `secondaryLang` は空値時にブラウザ言語を使う
- 字幕表示、音声、AI 補助などを options から詳細設定できる形を維持する

```text
┌─────────────────────────────────────────────┐
│ Apple TV+ Bilingual Subtitles        [保存] │
│ 字幕表示や学習補助の設定を行います           │
├─────────────────────────────────────────────┤
│ 基本設定                                    │
│ 勉強している言語   [ 英語 ▼ ]               │
│ 自分の言語         [ ブラウザ言語を使う ▼ ] │
│                                             │
│ 字幕表示                                    │
│ [ON/OFF] 右側の字幕パネルを表示する         │
│ [ON/OFF] 字幕パネルを固定表示する           │
│                                             │
│ 音声                                        │
│ [ON/OFF] 単語クリック時に音声再生           │
│                                             │
│ AIツールチップ                              │
│ [ON/OFF] AI自動翻訳ツールチップ             │
└─────────────────────────────────────────────┘
```

### 7.3 manifest 設定

```json
{
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

- `open_in_tab: true` で設定画面を別タブで開く
- popup や UI 上の `⚙️` からは `chrome.runtime.openOptionsPage()` を使う

---

## 8. AI 補助機能

- AI 表示はあくまで学習補助機能として扱う
- 字幕パネル本体の 2 行字幕は AI で置き換えない
- AI 訳は意訳を含むため、公式字幕との差分を補助的に見る用途とする
- 設定画面でも、AI は補助であり本字幕置換ではないことを明示する
- 辞書 / AI タブ拡張そのものは後続タスクとして扱う

---

## 9. 再生操作レイヤーと DOM 調整

### 9.1 基本方針

- 動画本体は 70% 幅、右 30% を字幕パネル専用領域として扱う
- Apple TV+ の再生操作 UI が右パネルに重ならないよう、CSS 上書きと DOM 配置を調整する
- 実 DOM / class 名への依存は必要最小限にし、壊れにくい調整を優先する

### 9.2 維持する設計

- 再生開始直後 / 設定反映直後でも、再生バー・シーク UI・ボタン群が右字幕パネルに隠れないこと
- `.video-player__footer` と `.unified-controls` は同じ基準で補正し、右側重なりを回避すること
- shift 値を保持して再補正時の snap-back を防ぐこと
- `amp-volume-control-unified` は中央寄せせず、字幕パネルに重なる分だけ左へ移動すること
- 常駐監視に依存せず、起動時 / 再起動時の軽量な補正バーストで安定化すること

### 9.3 既知の制約

- 大きめのデスクトップ解像度では、playback controls の操作性は実用範囲内
- 一方で small resolution では、Apple TV+ 側の intrinsic 幅や flex / grid レイアウトとの干渉により、controls layout が崩れる可能性が残る
- 現行版では small resolution を既知制約として扱う
- small resolution を本格対応する場合は、最小差分パッチの延長ではなく専用の layout 分岐や CSS 設計を前提に再検討する

### 9.4 開発者向けメモ

- `adjustPlaybackControlsForPanel` は、大きめ解像度を壊さないことを優先する
- small resolution を再調整する場合は、Apple TV+ 側 DOM と flex / grid 制約を整理し直してから着手する
- 調査時は `safeAreaLeft/right/width` と、`header` / `footer` / `progress` / `unified` の rect ログをセットで残す

---

## 10. 今後この文書で広げないもの

- popup / options / content 間での ES Modules 共有化をこの phase の主タスクにはしない
- AI タブ拡張や subtitle popup 全面刷新を、構造整理と同じ差分で進めない
- debug 基盤の全面再設計を今フェーズの主目的にはしない
- popup の辞書入力文字列正規化仕様を、Phase E / #26 の構造改善と同じ差分で処理しない
- `SUPPORTED_LANGS` の共有モジュール化は有効だが、短期的には優先課題としない

---

## 11. 文書整理方針

- `docs/dev-roadmap.md`: 実装順・issue 追跡用
- `docs/atv-design.md`: 設計意図と画面方針の正本
- `docs/contentjs-split-roadmap.md`: `content.js` 分割方針の整理用
- `docs/ai-session-templates.md`: AI セッション運用テンプレ整理用
- README は利用者向けの概要と導入手順を中心に保つ
