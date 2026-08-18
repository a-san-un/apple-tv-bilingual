// =============================================================
// Apple TV+ Bilingual Subtitles - modules/cue-track-binder.js
//
// 役割:
// - cue-controller.js が持つ track bind / unbind / handoff 系 API を
//   名前空間経由で参照しやすい形にまとめるバインダーモジュール。
// - primary / secondary で共通の cuechange listener bind 処理を
//   createTrackListenerBinding として提供し、mode 操作とは分離する。
// - track.mode の決定・適用は引き続き cue-controller.js 側の責務とし、
//   ここでは listener の attach / cleanup / 初回発火だけを担う。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * cueController の公開APIを、呼び出し側で扱いやすい binder 形に束ねる。
   * 現時点では実処理を持たず、委譲レイヤーとして振る舞う。
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
      // primary track の bind を cueController に委譲する。
      // 実際の mode 制御や listener 管理は cueController 側で行う。
      bindPrimary: (track, onCueChange, options) =>
        cueController.bindPrimarySubtitleTrack(track, onCueChange, options),

      // primary track の unbind を cueController に委譲する。
      // 復元有無などの詳細オプションもそのまま渡す。
      unbindPrimary: (options) =>
        cueController.unbindPrimarySubtitleTrack(options),

      // primary 字幕から native 字幕へ制御を戻す。
      // handoff の実装詳細は cueController 側に集約する。
      handoffPrimaryToNative: () =>
        cueController.handoffPrimarySubtitleToNative(),

      // native 字幕復元処理を呼び出す。
      // 実装が未提供でも安全に呼べるよう optional chain を使う。
      restoreNative: () =>
        cueController.restoreNativeSubtitles?.(),

      // secondary track の bind を cueController に委譲する。
      // modeDecision の解釈や適用は cueController 側で行う。
      bindSecondary: (track, modeDecision) =>
        cueController.bindSecondarySubtitleTrack(track, modeDecision),

      // secondary track の unbind を cueController に委譲する。
      // restoreMode などのオプションもそのまま透過する。
      unbindSecondary: (options) =>
        cueController.unbindSecondarySubtitleTrack(options),

      // 現在 bind 済みの primary track を取得する。
      // 実体は cueController が保持している state を参照する。
      getBoundPrimary: () =>
        cueController.getBoundPrimaryTrack(),

      // 現在 bind 済みの secondary track を取得する。
      // 呼び出し側は secondary の状態確認に使える。
      getBoundSecondary: () =>
        cueController.getBoundSecondaryTrack(),
    };
  }

  /**
   * primary / secondary で共通の cuechange listener bind を行う。
   * track.mode は一切変更せず、purely listener の attach / cleanup だけを担う。
   *
   * @param {{
   *   track: TextTrack,
   *   onCueChange: Function,
   *   video?: HTMLVideoElement | null,
   *   passTrackToHandler?: boolean,
   *   usePlaybackSignals?: boolean,
   * }} params
   * @returns {{
   *   track: TextTrack,
   *   notifyInitial: Function,
   *   cleanup: Function,
   * } | null}
   */
  function createTrackListenerBinding({
    track,
    onCueChange,
    video = null,
    passTrackToHandler = false,
    usePlaybackSignals = false,
  }) {
    if (!track || typeof onCueChange !== "function") return null;

    // handler 種別（primary: 引数なし呼び出し / secondary: track を渡す呼び出し）を統一的に扱う。
    const invoke = () => {
      if (passTrackToHandler) {
        onCueChange(track);
        return;
      }
      onCueChange();
    };

    // cuechange イベント本体のハンドラ。例外を握って呼び出し元へ伝播させない。
    const cueHandler = () => {
      try {
        invoke();
      } catch (_) {}
    };

    try {
      track.addEventListener("cuechange", cueHandler);
    } catch (_) {
      return null;
    }

    // primary 用途向け: timeupdate / seeked / playing でも onCueChange を補助発火させる。
    let playbackHandler = null;
    if (
      usePlaybackSignals &&
      video &&
      typeof video.addEventListener === "function"
    ) {
      playbackHandler = () => {
        try {
          invoke();
        } catch (_) {}
      };

      try {
        video.addEventListener("timeupdate", playbackHandler);
      } catch (_) {}
      try {
        video.addEventListener("seeked", playbackHandler);
      } catch (_) {}
      try {
        video.addEventListener("playing", playbackHandler);
      } catch (_) {}
    }

    return {
      track,

      // bind 直後に一度だけ描画させ、次の cuechange を待つ間の空表示を防ぐ。
      notifyInitial() {
        try {
          invoke();
        } catch (_) {}
      },

      // listener を全て解除する。video 側の補助 listener も対象に含める。
      cleanup() {
        try {
          track.removeEventListener("cuechange", cueHandler);
        } catch (_) {}

        if (
          playbackHandler &&
          video &&
          typeof video.removeEventListener === "function"
        ) {
          try {
            video.removeEventListener("timeupdate", playbackHandler);
          } catch (_) {}
          try {
            video.removeEventListener("seeked", playbackHandler);
          } catch (_) {}
          try {
            video.removeEventListener("playing", playbackHandler);
          } catch (_) {}
        }
      },
    };
  }

  root.cueTrackBinder = {
    createCueTrackBinder,
    createTrackListenerBinding,
  };
})();
