# content.js 分割ロードマップ

この文書は、`content.js` の責務整理と段階分割の方針をまとめたロードマップである。

この文書で扱うもの:

- `content.js` をどの順で安全に薄くしていくか
- どの責務境界を守りながら分割するか
- 各 Phase で何を確定し、次にどこを整理するか

この文書で扱わないもの:

- issue の進捗・完了状態の正本管理
- UI 仕様の詳細定義
- 個別セッションの作業メモ全文

正本の位置づけ:

- issue の進捗・完了状態は `docs/dev-roadmap.md` を正本とする
- UI 仕様や表示方針の正本は `docs/atv-design.md` に寄せる
- この文書は、`content.js` 分割の設計原則・責務境界・段階順の正本とする

---

## 1. 分割の目的

`content.js` の分割は、単なるファイル分割ではない。  
最優先は既存挙動を壊さずに責務を分けることだが、同時に次の目的も持つ。

- `content.js` のコード量を段階的に減らす
- 見通しを良くし、現在位置を追いやすくする
- UI shell / binder / observer / bootstrap の責務線を明確にする
- 影響範囲を追いやすくし、修正時の事故を減らす
- 将来的に必要な単位だけ安全に実ファイルへ切り出せる状態を作る

---

## 2. 基本方針

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

- host 作成
- shadow root 準備
- shell HTML / style 適用
- event wiring
- 既存 shell への state 反映
- 空 shell を不用意に再生成しないための生成条件管理

方針:

- `create*()` 系は host / shadow / shell / wiring に集中させる
- 長い template は `build*ShellHTML()` / `build*StyleText()` 系へ寄せる
- render 系は shell の新規生成ではなく、既存 shell への反映責務に留める
- 未設定状態では panel / secondary host / notice の関係が破綻しないよう、生成条件を UI shell 側で追えるようにする

### 3.2 binder / cue logic

対象:

- track binding
- cue handling
- history 管理
- current row 連携
- snapshot 管理
- primary / secondary の live cue 同期

### 3.3 observer / layout / bootstrap

対象:

- `ResizeObserver`
- `MutationObserver`
- timer / retry
- 動画切替
- 再初期化
- `attachTracks`
- playback controls layout 調整
- bootstrap / cleanup
- unconfigured flow

---

## 4. 実装順

1. 純関数と独立 logger を切り出す
2. subtitle track resolver を切り出す
3. settings bridge と Debug UI API を分ける
4. binder / sidebar の非対称を解消しながら UI 層の責務を整理する
5. UI shell を整理する
6. binder / cue logic を整理する
7. observer / layout / bootstrap を最後に整理する

---

## 5. 各 Phase の整理

### Phase E: 最終整理

**ゴール**: UI shell / binder / cue の境界を維持したまま、最も密結合で壊れやすい `content.js` 後半の責務を整理し、最終的に bootstrap 的な薄い入口へ寄せる。

#### Phase E の完了状況

- [x] [#20](../../issues/20) Phase E (1): panel / overlay セクションの責務分離
- [x] [#21](../../issues/21) Phase E (2): binder / cue ロジックの整理と分割準備
- [ ] [#24](../../issues/24) `attachTracks` / observer 周辺の安定化
- [x] [#26](../../issues/26) unconfigured flow と panel / notice / secondary host 生成条件の整理

#### #20 完了メモ

- panel / debug / overlay / subtitle popup の UI shell 境界を明確化
- `createRightPanel()` / `createOverlay()` / `createPopupHost()` を host / shadow / shell / wiring 中心に整理
- 長い template を `build*ShellHTML()` 系へ寄せた
- overlay は event delegation ベースへ整理
- panel shell / debug shell / debug mount / header wiring の境界を見える形にした
- DOM の `id` / `class` / `data-*`、見た目、close 動作、current 行や threshold-scroll の挙動は変えていない
- この整理により、overlay の見た目調整は `buildOverlayShellHTML()` / `createOverlay()` を中心に局所修正しやすい状態になった

#### 注意

- #23 は `content.js` 分割そのものではなく UI 見た目調整の issue である
- #23 の詳細な設計方針は `docs/atv-design.md` と `docs/dev-roadmap.md` に寄せる
