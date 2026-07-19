# content.js 分割ロードマップ

この文書は、`content.js` の責務整理と段階分割の方針をまとめたロードマップである。  
`content.js` をどの順で安全に薄くしていくか、どの責務をどこへ移すか、最終的に何を `content.js` に残すかを定める。

この文書で扱うもの:

- `content.js` をどの順で薄くしていくか
- どの責務境界を守りながら分割するか
- 各 Phase / Issue で何を確定し、次にどこを整理するか
- subtitle sync / recovery を含む追加改善を、どこへ責務移送して進めるか

この文書で扱わないもの:

- issue の進捗・完了状態の管理
- UI 仕様の詳細定義
- subtitle sync / recovery の詳細な設計・パラメータ
- 個別セッションの作業メモ全文

正本の位置づけ:

- issue の進捗・完了状態は `docs/dev-roadmap.md` を正本とする
- UI 仕様や表示方針の正本は `docs/atv-design.md` に寄せる
- subtitle sync の表示モデル / health / recovery 方針の正本は `docs/issue-32-subtitle-sync-design.md` に寄せる
- この文書は、`content.js` 分割の設計原則・責務境界・段階順の正本とする

現在の全体的な優先順位と Issue レベルの進行状況は `docs/dev-roadmap.md` を参照する。

---

## 1. 分割の目的

`content.js` の分割は、単なるファイル分割ではない。  
最優先は既存挙動を壊さずに責務を分けることだが、同時に次の目的も持つ。

- `content.js` のコード量を段階的に減らし、見通しを良くする
- UI shell / binder / observer / bootstrap の責務線を明確にする
- 影響範囲を追いやすくし、修正時の事故を減らす
- 将来的に必要な単位だけ安全に実ファイルへ切り出せる状態を作る
- subtitle sync / recovery の改善も、`content.js` への追記で吸収せず、controller / resolver / helper 側へ責務移送して進められる構造にする

---

## 2. 分割の基本方針

- `content.js` は一括分割せず、Phase 単位で段階的に整理する
- 最優先は **既存挙動を変えないこと**
- 構造整理と仕様変更を同じバッチで混ぜない
- 先に純関数・独立責務を切り出し、DOM 依存・observer 依存・Apple TV+ 固有 UI 依存の強い責務は後ろへ回す
- content script は manifest の `content_scripts` 順で読み込まれる前提で、`window.ATVB` 名前空間を使って段階的に分離する
- 旧ロジックを残したまま新ロジックを継ぎ足す形は避け、薄いラッパーか差分ゼロ移設を基本とする
- 同じ責務の処理を別経路に複製しない
- 既存 helper / 既存 state / 既存フローに寄せられるものは寄せる
- 削除は「確実に不要」と判断できるものだけに限定し、迷うものは次バッチへ送る
- phase 外の全面リファクタリングは行わない
- comments / section boundary を使って、まずは `content.js` 内で責務境界を見える化する
- UI 見た目調整の issue は、分割ロードマップの主線とは分けて扱い、必要な補足だけを残す
- subtitle sync / recovery の改善も、`content.js` に状態や分岐を足し続けるのではなく、`cue-controller.js` / resolver / health helper 側へ責務移送する
- `content.js` は最終的に、薄い wiring / bootstrap / lifecycle 入口として残すことを目標にする

---

## 3. 分割で守る境界

### 3.1 UI shell

対象:

- panel
- debug
- overlay
- subtitle popup
- notice / panel slot 周辺の shell 生成導線

責務:

- host 作成と shadow root 準備
- shell HTML / style の適用
- event wiring と既存 shell への state 反映
- 空 shell を不用意に再生成しないための生成条件管理

方針:

- `create*()` 系は host / shadow / shell / wiring に集中させる
- 長い template は `build*ShellHTML()` / `build*StyleText()` 系へ寄せる
- render 系は shell の新規生成ではなく、既存 shell への反映責務に留める
- 未設定状態では panel / secondary host / notice の関係が破綻しないよう、生成条件を UI shell 側で追えるようにする

### 3.1.1 overlay shell

overlay は UI shell の一部だが、panel と同じ表示条件・同じ見た目責務で扱わない。

- overlay 本体の HTML / CSS は `buildOverlayShellHTML()` 側に持たせる
- shell 側は背景・padding・border-radius・line-height・text-shadow・font-size の受け口を持つ
- host 側は fixed 配置・width・中央寄せ・z-index を持ち、bottom を playback progress / footer 基準で動的に更新する
- font-size は host に CSS 変数として設定し、video 高さ基準で更新する
- primary / secondary の 2 行表示と単語クリック可能な DOM 構造は維持する

この境界により、overlay の見た目調整は shell 側、位置調整と解像度追従は host 側へ寄せて扱う。

---

### 3.2 binder / cue logic

対象:

- track binding
- cue handling
- history 管理
- current row 連携
- snapshot 管理
- primary / secondary の live cue 同期
- subtitle sync / health / recovery の controller 連携

責務:

- primary / secondary cuechange の本流管理と、UI への反映前の整形
- track / cue / current block の同期と history 追加契機の制御
- subtitle sync / recovery 実行の入り口制御と、controller 呼び出しの配線
- `content.js` から見た controller 呼び出し点の最小化

方針:

- cue の解釈・同期・health 集約は `cue-controller.js` を主担当に寄せる
- subtitle sync / recovery の改善は、`content.js` に新しい分岐や状態を増やして吸収しない
- `content.js` 側は controller 呼び出し、戻り値の受け取り、必要最小限の wiring に留める
- current / history / recovery の truth 判定は、可能な限り resolver / controller 側へ寄せる
- 同じ recovery 条件を `content.js` と controller 側の両方で持たない
- 「旧 recovery state を残したまま新 recovery state を追加する」形は避け、責務移送後は旧 state 参照を段階的に消す

---

### 3.3 observer / layout / bootstrap

対象:

- `ResizeObserver`
- `MutationObserver`
- timer / retry
- 動画切替と再初期化
- `attachTracks`
- playback controls layout 調整
- bootstrap / cleanup
- unconfigured flow

責務:

- 監視開始 / 停止と DOM 再接続への追従
- host 再配置と layout 更新
- bootstrap 順序の維持と cleanup の整合
- UI shell / controller / settings の起動配線と再初期化

方針:

- observer は「何を監視し、何を再評価するか」を明示した薄い配線層へ寄せる
- layout 更新は UI shell の見た目責務と混ぜず、位置・サイズ・再配置に限定する
- bootstrap は「必要な初期化を順に呼ぶだけ」の形に近づける
- retry / timer は controller のロジックと混ぜず、起動・再接続の補助に留める
- unconfigured flow は例外経路ではなく、通常の初期状態として破綻しない構造を保つ
- subtitle sync / recovery の本体ロジックは持たず、controller / resolver の評価を再トリガする入口に留める

---

## 4. 実装順と現在の主線

### 4.1 実装順

1. 純関数と独立 logger を切り出す
2. subtitle track resolver を切り出す
3. settings bridge と Debug UI API を分ける
4. binder / sidebar の非対称を解消しながら UI 層の責務を整理する
5. UI shell を整理する
6. binder / cue logic を整理し、subtitle sync / recovery の責務を controller 側へ寄せる
7. observer / layout / bootstrap を最後に整理し、`content.js` を薄い入口へ寄せる

補足:

- subtitle sync / recovery の改善は、原則として **6. binder / cue logic の整理** の中で controller / resolver 側へ移す
- observer / bootstrap の調整で recovery 問題を無理に吸収しない
- `content.js` に暫定フラグや一時 state を足す前に、「controller 側へ移せないか」を先に確認する

### 4.2 Phase E / Issue #32 の位置づけ

- Phase E は、UI shell / binder / cue / observer / bootstrap の境界を維持しつつ、`content.js` 後半を整理して bootstrap 的な薄い入口へ寄せるフェーズである
- [#20](../issues/20), [#21](../issues/21), [#24](../issues/24), [#26](../issues/26) は Phase E の一部として進める
- Issue #32（subtitle sync / recovery）は、Phase E 後半〜Phase J にまたがる設計・実装タスクとして扱い、subtitle sync の truth / health / recovery 境界を controller / resolver 側へ寄せる

### 4.3 現在の主線（2026-07 時点）

- #24 では `attachTracks` / observer / bootstrap / 再初期化周辺の安定化を進める
- Issue #32 では subtitle sync / recovery の改善を `content.js` 追記ではなく controller / resolver 側へ責務移送する
- secondary recovery の判定責務は `content.js` から `cue-controller.js` 側へ寄せる
- large seek 時の secondary recovery は、runtime 主体の missing / reset / miss limit 付き retry として controller 側で扱う
- 今後の改善も、`content.js` に recovery state や分岐を増やす方向ではなく、controller / resolver / helper の責務分割で進める

---

## 5. 注意

- Issue の進捗・完了状態、現在の優先順位は `docs/dev-roadmap.md` を正本とする
- subtitle sync / recovery の設計詳細と runtime 方針は `docs/issue-32-subtitle-sync-design.md` に寄せる
- この文書では、個々の issue の完了判定ではなく、「`content.js` をどう安全に薄くしていくか」の観点に限定して扱う
