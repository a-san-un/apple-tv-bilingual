// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-state-reset.js
//
// 役割:
// - 字幕の一時 state（テキスト・タイムスタンプ）のリセットを担当する。
// - reason 文字列ではなく options オブジェクトで振る舞いを制御する。
//
// clearSubtitleState(options):
//   options.preserveSecondaryDom  = true  → パネルの secondary DOM は保持する
//                                 = false → パネルの secondary テキストも消去する
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  function createSubtitleStateReset({ state, secondarySubtitleDom, logContent }) {
    function clearSubtitleState(options = {}) {
      const preserveSecondaryDom =
        typeof options.preserveSecondaryDom === "boolean"
          ? options.preserveSecondaryDom
          : false;

      state.lastSecondaryText = "";
      state.lastSecondaryTextAt = 0;
      state.lastSecondarySignalAt = 0;
      state.lastPrimaryText = "";
      state.lastPrimarySnapshotAt = 0;

      if (!preserveSecondaryDom) {
        secondarySubtitleDom.clearPanelSecondaryText();
      }

      logContent?.("subtitle state cleared", {
        preserveSecondaryDom,
        contentKey: state.currentContentKey,
      });
    }

    return { clearSubtitleState };
  }

  root.createSubtitleStateReset = createSubtitleStateReset;
})();
