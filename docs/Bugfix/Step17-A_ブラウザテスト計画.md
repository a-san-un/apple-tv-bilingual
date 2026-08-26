# Step17-A ブラウザテスト計画

対象ブランチ: `issue-32-content-core-split`  
対象範囲: **Step 17-A 全体（17-A-1 〜 17-A-10）**  
前提コミット: `43ed673 refactor: Step 17-A-10 の owner 境界整理とコメント同期を反映する` / `75076ff docs: Step 17-A-10 完了とStep 17-Bへの引き継ぎを記録する`

***

## 1. この資料の役割

この資料は、Step 17-A 全体の実装後に行う**ブラウザ実機確認の正本**である。  
ここでは、Apple TV+ の再生画面で確認すべき操作シナリオ、期待結果、異常時の切り分け先を整理する。

この資料はテスト計画と確認観点の整理を目的とし、コード修正手順や Step 17-B の実装方針は持たない。  
Step 17-A の owner 境界や API 契約の詳細は `docs/Bugfix/Step17-A_panel系統合_方針整理メモ.md`、全体の優先順位は `docs/Bugfix/Bugfix マスタープラン.md` を参照する。

***

## 2. テストの目的

Step 17-A では、panel / block 系責務を `content.js` から分離し、`modules/panel-ui.js`、`modules/panel-renderer.js`、`modules/subtitle-block-state.js`、`modules/subtitle-blocks.js`、`modules/subtitle-block-resolver.js`、`modules/panel-visibility-state.js` などへ整理してきた。  
また Step 17-A-8 で `panelUi.dispose()` を panel cleanup の高レベル入口として固定し、Step 17-A-10 で panel / block public API と高レベル中継境界を整理した。

そのため今回のブラウザテストでは、**見た目の確認だけでなく、開閉・破棄・復帰・再初期化・遷移の各経路が壊れていないこと**を確認する。  
特に次の観点を満たすかを確認する。

- 動画再生中に拡張機能を ON/OFF できること。
- panel open / close に応じて overlay と panel が正しく追従すること。
- `panelUi.dispose()` を通る cleanup が安定していること。
- `subtitleBlockState.sequence`、`state.currentSubtitleBlock`、`state.lastPanelRenderSnapshot` まわりで破綻がないこと。
- seek、再初期化、SPA 遷移後も panel / overlay / subtitle が再構築できること。

***

## 3. 事前準備

### 3-1. テスト環境

- Chrome で `issue-32-content-core-split` の unpacked extension を読み込む。
- Apple TV+ にログイン済みで、再生確認しやすい作品・エピソードを 1 つ決める。
- 字幕を primary / secondary が見える構成にする。
- DevTools を開ける状態にする。

### 3-2. 事前に確認するもの

- Console に初期エラーが出ていないこと。
- `atvb-native-toggle`、`atv-toggle-btn`、`atv-panel-host`、`atv-overlay-host` が必要に応じて生成されること。
- `panelOpen` の保存値と初期表示が大きく矛盾していないこと。

### 3-3. 主な観測対象

| 項目 | 役割 | 主な確認ポイント |
| :-- | :-- | :-- |
| `atvb-native-toggle` | 拡張全体の ON/OFF | OFF 時も残るか、再操作できるか |
| `atv-toggle-btn` | panel 開閉 | 開閉のたびに安定して効くか |
| `atv-panel-host` | 右側字幕 panel host | 開閉・dispose・再生成で整合するか |
| `atv-overlay-host` | overlay host | panel 開閉・ON/OFF・seek 後に位置ずれしないか |
| `subtitleBlockState.sequence` | block state 正本 | panel open / seek / 再初期化後に追従するか |
| `state.currentSubtitleBlock` | runtime mirror | renderer / overlay 互換参照として破綻しないか |
| `state.lastPanelRenderSnapshot` | panel 最終描画 snapshot | dispose / 再描画 / 再初期化で残骸を持たないか |

***

## 4. テストの進め方

ブラウザテストは、次の順に進める。

1. 通常再生の基本確認
2. panel 開閉確認
3. 拡張 ON/OFF 確認
4. seek / 再同期確認
5. 再初期化系確認
6. SPA 遷移確認
7. 連続操作・再現性確認

各シナリオは、**操作手順 → 期待結果 → 異常時の切り分け先** の順に記録する。  
不具合が出た場合は、その場で修正に入らず、まず再現条件と影響範囲を記録する。

***

## 5. テストシナリオ一覧

| No. | シナリオ | 目的 | 優先度 |
| :-- | :-- | :-- | :-- |
| 1 | 通常再生の初期表示確認 | 基本表示と初期生成の確認 | 高 |
| 2 | panel 開閉確認 | panel open / close と overlay 追従確認 | 高 |
| 3 | panel 開閉連続確認 | render artifact 残留や二重処理確認 | 高 |
| 4 | 拡張 OFF 確認 | dispose / cleanup の確認 | 高 |
| 5 | OFF → ON 復帰確認 | 再生成と復帰の確認 | 高 |
| 6 | seek 後の追従確認 | block 再同期と panel / overlay 更新確認 | 高 |
| 7 | 再初期化系操作確認 | reset / reinitialize 契約の確認 | 中 |
| 8 | SPA 遷移確認 | cleanup と新セッション初期化確認 | 高 |
| 9 | 長めの連続操作確認 | Step 17-A 全体の安定性確認 | 中 |

***

## 6. 詳細シナリオ

### 6-1. 通常再生の初期表示確認

**操作手順**

1. Apple TV+ の対象作品を開く。
2. 再生を開始する。
3. 何も触らず数秒待つ。
4. panel、overlay、字幕の初期表示を確認する。
5. Console にエラーがないか確認する。

**期待結果**

- primary / secondary 字幕が表示される。
- panel の初期状態が保存状態どおりに開く、または閉じる。
- overlay が再生画面に追従して表示される。
- Console に即時エラーが出ない。

**異常時に疑う箇所**

- `content.js` の起動シーケンス
- `modules/panel-ui.js`
- `modules/panel-renderer.js`
- `modules/subtitle-block-state.js`

### 6-2. panel 開閉確認

**操作手順**

1. `atv-toggle-btn` で panel を開く。
2. 数秒待って内容を確認する。
3. panel を閉じる。
4. もう一度開く。

**期待結果**

- 開閉操作が毎回成立する。
- panel open 時に block rebuild と render が正しく行われる。
- overlay が panel 開閉に合わせて位置・幅を保つ。
- 二重描画や空白 panel が出ない。

**異常時に疑う箇所**

- `applyPanelOpenEffects()`
- `modules/subtitle-block-state.js`
- `modules/panel-ui.js`
- `modules/panel-renderer.js`

### 6-3. panel 開閉連続確認

**操作手順**

1. panel を 5 回程度連続で開閉する。
2. 開いた状態で字幕の進行を確認する。
3. 閉じた状態でも overlay が壊れないか確認する。

**期待結果**

- 開閉を繰り返しても挙動が重くならない。
- 以前の render artifact や古い内容が残らない。
- listener / observer の二重登録を疑う挙動が出ない。

**異常時に疑う箇所**

- `clearPanelRenderArtifacts()`
- `panelUi.dispose()` に近い cleanup 経路
- `modules/panel-ui.js` 内の timer / observer 管理

### 6-4. 拡張 OFF 確認

**操作手順**

1. 再生中に `atvb-native-toggle` で拡張を OFF にする。
2. panel / overlay / 拡張由来 UI の変化を確認する。
3. Apple TV+ 本来の字幕表示へ戻るか確認する。

**期待結果**

- 拡張 UI が完全に破棄される。
- OFF 時にも `atvb-native-toggle` は残る。
- panel host / overlay host の残骸が見えない。
- Console に cleanup エラーが出ない。

**異常時に疑う箇所**

- `panelUi.dispose()`
- `modules/panel-ui.js`
- `modules/playback-session-cleanup.js`
- `modules/subtitle-state-reset.js`

### 6-5. OFF → ON 復帰確認

**操作手順**

1. OFF にした直後に再び ON にする。
2. 再生を継続したまま字幕・panel・overlay の復帰を確認する。
3. 必要に応じて panel を開閉する。

**期待結果**

- ON→OFF→ON の基本復帰経路が成立する。
- panel / overlay / subtitle が正常に再生成される。
- 二重 host、二重 listener、二重描画が起きない。

**異常時に疑う箇所**

- `content.js` の高レベル再起動シーケンス
- `modules/panel-ui.js`
- `reinitialize-coordinator.js`
- `modules/subtitle-block-state.js`

### 6-6. seek 後の追従確認

**操作手順**

1. 少しだけシークする。
2. 大きめに前後へシークする。
3. 数秒待ち、字幕・panel・overlay の追従を確認する。

**期待結果**

- seek 後も現在字幕に追従する。
- panel current block 表示が大きくずれない。
- cleanup 多重実行や pending task の残留を疑うエラーが出ない。

**異常時に疑う箇所**

- `modules/subtitle-block-state.js`
- `modules/subtitle-blocks.js`
- pending sync task cancel まわり
- `content.js` の seek 後 orchestration

### 6-7. 再初期化系操作確認

**操作手順**

1. 再描画や再読込が走る設定操作を行う。
2. panel が開いている状態と閉じている状態の両方で試す。
3. 再初期化後の panel / overlay / subtitle を確認する。

**期待結果**

- 再初期化後も panel / overlay / subtitle が破綻しない。
- render snapshot や current subtitle mirror の不整合が出ない。
- reset options や clear 系呼び出しに関するエラーが出ない。

**異常時に疑う箇所**

- `reinitialize-coordinator.js`
- `modules/subtitle-state-reset.js`
- `modules/panel-ui.js`
- `content.js`

### 6-8. SPA 遷移確認

**操作手順**

1. 再生ページから別エピソードまたは別作品へ移動する。
2. 遷移先で再生を開始する。
3. panel / overlay / toggle の状態を確認する。
4. 必要に応じて ON/OFF や panel 開閉も試す。

**期待結果**

- 遷移前の panel host / overlay host / observer / listener が残らない。
- 遷移先で新しいセッションとして正常に初期化される。
- SPA 遷移時の cleanup 多重実行が起きない。

**異常時に疑う箇所**

- `modules/playback-session-cleanup.js`
- `panelUi.dispose()`
- `reinitialize-coordinator.js`
- `content.js` のセッション切替処理

### 6-9. 長めの連続操作確認

**操作手順**

1. 5〜10分程度再生する。
2. 途中で panel 開閉、ON/OFF、seek、SPA 遷移の一部を組み合わせる。
3. 最後に再び通常再生へ戻す。

**期待結果**

- 時間経過や連続操作で挙動が著しく不安定にならない。
- 字幕、panel、overlay が最終的に通常状態へ戻る。
- Console にエラーや警告が増え続けない。

**異常時に疑う箇所**

- listener / observer の残留
- render artifact の残留
- reset / reinitialize / cleanup の到達順不整合

***

## 7. 重点チェック項目

### 7-1. UI / DOM

- `atv-toggle-btn` が常に正しく機能するか。
- `atv-panel-host` が開閉・dispose・再生成で矛盾しないか。
- `atv-overlay-host` が panel 状態や seek 後に位置ずれしないか。
- OFF 時に不要な host が残らないか。

### 7-2. state / render

- `panelOpen` の保存状態と見た目が矛盾しないか。
- `subtitleBlockState.sequence` が seek / panel open / 再初期化後も有効に再構築されるか。
- `state.currentSubtitleBlock` が renderer / overlay 互換 mirror として破綻しないか。
- `state.lastPanelRenderSnapshot` が古い描画結果を引きずらないか。

### 7-3. cleanup / lifecycle

- `panelUi.dispose()` 到達後に panel / overlay / timer / observer が残らないか。
- OFF → ON、再初期化、SPA 遷移後に二重初期化が起きないか。
- cleanup 多重実行防止が崩れていないか。

***

## 8. Console / 観測ポイント

ブラウザテスト中は、見た目だけでなく Console も同時に見る。  
特に次のような兆候がないかを確認する。

- `undefined` 参照や null 参照エラー
- dispose 済み object / host / observer への再アクセス
- reset options 不整合を疑うエラー
- panel 開閉時の二重描画、二重 listener、二重 observer を疑うログ
- SPA 遷移や seek 後の古い state 参照

必要に応じて、Elements で次を観測する。

- `atv-panel-host` の生成 / 破棄タイミング
- `atv-overlay-host` の残留有無
- panel 閉時でも不要な subtree が残り続けていないか

***

## 9. 記録テンプレート

各シナリオは、次の形式で結果を記録する。

| No. | シナリオ | 結果 | 症状 / メモ | 疑い箇所 | 優先度 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | 通常再生の初期表示確認 | 未実施 / OK / NG |  |  |  |
| 2 | panel 開閉確認 | 未実施 / OK / NG |  |  |  |
| 3 | panel 開閉連続確認 | 未実施 / OK / NG |  |  |  |
| 4 | 拡張 OFF 確認 | 未実施 / OK / NG |  |  |  |
| 5 | OFF → ON 復帰確認 | 未実施 / OK / NG |  |  |  |
| 6 | seek 後の追従確認 | 未実施 / OK / NG |  |  |  |
| 7 | 再初期化系操作確認 | 未実施 / OK / NG |  |  |  |
| 8 | SPA 遷移確認 | 未実施 / OK / NG |  |  |  |
| 9 | 長めの連続操作確認 | 未実施 / OK / NG |  |  |  |

***

## 10. この資料で扱わないこと

- Step 17-B の visibility / lifecycle 実装方針そのもの
- Step 18 の term inspector 分離作業
- UI デザインやレイアウト調整そのもの
- テスト中に見つかった不具合の修正手順詳細

***

## 11. 結論

Step 17-A は owner 分離、dispose 契約、render / block / visibility 境界の整理まで完了している。  
このブラウザテストでは、Step 17-A 全体の回帰確認として、通常再生・panel 開閉・ON/OFF・seek・再初期化・SPA 遷移の各経路が壊れていないことを確認する。  
ここで大きな問題がなければ、次の Step 17-B は visibility / lifecycle owner 固定へ進める。
