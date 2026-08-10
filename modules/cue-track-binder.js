// =============================================================
// Apple TV+ Bilingual Subtitles - modules/cue-track-binder.js
//
// 役割:
// - cue-controller.js が持つ track bind / unbind / handoff の
//   パブリック API を名前空間経由で参照可能にする薄いファクトリ。
// - Step 7（cue-controller.js 分割）でここに実装を移行する予定。
// - 現段階では createCueTrackBinder を公開するのみ。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * createCueTrackBinder
   *
   * cueController インスタンスを受け取り、
   * track bind / unbind / handoff の操作を提供するオブジェクトを返す。
   *
   * @param {{ cueController: object }} deps
   * @returns {{
   *   bindPrimary: Function,
   *   unbindPrimary: Function,
   *   handoffPrimaryToNative: Function,
   *   restoreNative: Function,
   *   bindSecondary: Function,
   *   unbindSecondary: Function,
   *   getBoundPrimary: Function,
   *   getBoundSecondary: Function,
   * }}
   */
  function createCueTrackBinder({ cueController }) {
    return {
      bindPrimary: (track, onCueChange, options) =>
        cueController.bindPrimarySubtitleTrack(track, onCueChange, options),

      unbindPrimary: (options) =>
        cueController.unbindPrimarySubtitleTrack(options),

      handoffPrimaryToNative: () =>
        cueController.handoffPrimarySubtitleToNative(),

      restoreNative: () =>
        cueController.restoreNativeSubtitles?.(),

      bindSecondary: (track, modeDecision) =>
        cueController.bindSecondarySubtitleTrack(track, modeDecision),

      unbindSecondary: (options) =>
        cueController.unbindSecondarySubtitleTrack(options),

      getBoundPrimary: () =>
        cueController.getBoundPrimaryTrack(),

      getBoundSecondary: () =>
        cueController.getBoundSecondaryTrack(),
    };
  }

  root.cueTrackBinder = {
    createCueTrackBinder,
  };
})();