# Module Load Order (manifest.json content_scripts.js)

`manifest.json` の `content_scripts[0].js` 配列は、依存関係に基づいた
明示的な順序であり、偶然この順で動いているわけではない。
配列に手を加える際は、必ず以下のグループ順序を維持すること。

manifest.json はコメントを書けないため、順序のルールはこのドキュメントで管理する。

## グループ構成と順序ルール

1. **基盤ユーティリティ / 設定層**
   - vtt-normalizer.js
   - debug-logger.js
   - modules/language-definitions.js
   - subtitle-track-resolver.js
   - modules/settings-schema.js
   - modules/settings-store.js
   - modules/panel-visibility-state.js
   - settings-bridge.js
   - debug-panel.js
   - 役割: ログ・設定・言語定義など、他のどのモジュールよりも先に
     存在している必要がある低レベル依存。

2. **panel-related modules（panel 描画・UI層）**
   - panel-renderer.js
   - panel-ui.js
   - 依存順: panel-renderer.js は panel-ui.js より前に置くこと
     （panel-ui.js が内部で panelRenderer を参照するため）。
   - content.js からは `window.ATVB.panelUi.createPanelUi` と
     `window.ATVB.panelRenderer.createPanelRenderer` のみを参照する
     （17-A-9: 公開面固定）。

3. **subtitle pipeline（字幕ブロック生成・解決層）**
   - subtitle-blocks.js
   - subtitle-block-resolver.js
   - overlay-block-resolver.js
   - subtitle-view-resolver.js
   - secondary-subtitle-dom.js
   - 依存順: subtitle-blocks.js → subtitle-block-resolver.js の順を維持する
     （resolver 側が blocks 側の出力 shape を前提にしているため）。
   - content.js からは `buildSubtitleBlockSequence`
     （subtitle-blocks.js）と `resolvePanelBlocksForRender`
     （subtitle-block-resolver.js）のみを参照する（17-A-9: 公開面固定）。

4. **cue / recovery 層**
   - initial-cue-recovery.js
   - modules/lane-recovery-state.js
   - modules/subtitle-health-snapshot.js
   - modules/subtitle-recovery-manager.js
   - cue-controller.js
   - modules/cue-track-binder.js
   - modules/text-track-debug.js
   - modules/cue-sequence-builder.js
   - modules/cue-render-coordinator.js
   - 役割: TextTrack の cue 取得・復旧・シーケンス構築。
     panel/subtitle pipeline よりも後、orchestrator 層よりも前。

5. **overlay / layout 層**
   - overlay-controller.js
   - runtime-observers.js
   - playback-controls-layout.js
   - modules/playback-controls-layout-controller.js
   - settings-runtime.js
   - modules/playback-context-controller.js

6. **orchestrators（再初期化・セッション管理層）**
   - reinitialize-coordinator.js
   - modules/subtitle-state-reset.js
   - modules/subtitle-history-store.js
   - modules/playback-session-cleanup.js
   - modules/playback-startup-coordinator.js
   - modules/subtitle-sync-controller.js
   - sync-interval-orchestrator.js
   - 役割: 上位の状態管理・再起動制御。個々の低レベルモジュールを
     まとめて扱うため、必ず該当モジュール群より後に置く。

7. **エントリーポイント**
   - content.js
   - 必ず配列の最後に置くこと。すべてのモジュールが
     `window.ATVB.*` 経由で確定した後に実行される前提。

## 変更時のチェックリスト

- [ ] 新しいモジュールを追加する場合、上記のどのグループに属するか判定する
- [ ] 同じグループ内で依存がある場合、依存元を依存先より前に置く
- [ ] content.js は常に配列の最後
- [ ] 並び替え後は `content.js` の module resolution セクション
      （17-A-9: single entry point）で参照しているグローバル名が
      すべて解決できるか確認する
- [ ] manifest.json 自体にはコメントを追加できないため、
      変更内容は必ずこのドキュメントに追記する
