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
   * cueController の公開 API を、呼び出し側で扱いやすい binder 形に束ねる。
   * primary の bind / unbind は従来どおり cueController に委譲しつつ、
   * secondary については monitor state を binder 側で保持する。
   *
   * Step 3:
   * - secondary listener の開始・差し替え・停止を binder module 側へ寄せる。
   * - cleanup の実体は createTrackListenerBinding().cleanup を使い、
   *   新しい解除実装は増やさない。
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
   *   startSecondaryMonitor: Function,
   *   replaceSecondaryMonitor: Function,
   *   stopSecondaryMonitor: Function,
   *   getSecondaryMonitorState: Function,
   * }}
   */
  function createCueTrackBinder({ cueController }) {
    // secondary monitor が現在監視している track 本体。
    // same track の差し替え回避判定にも使う。
    let secondaryMonitorTrack = null;

    // createTrackListenerBinding() から受け取る唯一の cleanup 経路。
    // Step 4 ではこの保持をさらに binder 主体へ寄せていく前提。
    let secondaryMonitorCleanup = null;

    // debug / state 観測用の軽量メタ情報。
    // track 全体ではなく id / language のみ持つ。
    let secondaryMonitorMeta = null;

    /**
     * 現在の secondary monitor を停止する。
     * cleanup は createTrackListenerBinding() が返したものだけを使う。
     */
    function stopSecondaryMonitor() {
      try {
        secondaryMonitorCleanup?.();
      } catch (_) {}

      secondaryMonitorTrack = null;
      secondaryMonitorCleanup = null;
      secondaryMonitorMeta = null;
    }

    /**
     * secondary monitor を新規開始する。
     * 既存 monitor があれば先に stop してから付け直す。
     *
     * @param {TextTrack} track
     * @param {Function} onCueChange
     * @param {{
     *   video?: HTMLVideoElement | null,
     * }} options
     * @returns {{
     *   track: TextTrack,
     *   notifyInitial: Function,
     *   cleanup: Function,
     * } | null}
     */
    function startSecondaryMonitor(track, onCueChange, options = {}) {
      if (!track || typeof onCueChange !== "function") return null;

      stopSecondaryMonitor();

      const binding = createTrackListenerBinding({
        track,
        onCueChange,
        video: options.video || null,
        passTrackToHandler: true,
        usePlaybackSignals: false,
      });

      if (!binding) return null;

      secondaryMonitorTrack = track;
      secondaryMonitorCleanup = binding.cleanup;
      secondaryMonitorMeta = {
        trackId: track?.id || "",
        language: track?.language || "",
      };

      // bind 直後に 1 回だけ同期させ、最初の cuechange 待ちで空表示になるのを防ぐ。
      binding.notifyInitial?.();
      return binding;
    }

    /**
     * secondary monitor を差し替える。
     * すでに同じ track を監視中なら bind 自体をスキップする。
     *
     * @param {TextTrack} track
     * @param {Function} onCueChange
     * @param {{
     *   video?: HTMLVideoElement | null,
     * }} options
     * @returns {{
     *   skipped: boolean,
     *   reason: string,
     *   track: TextTrack | null,
     *   meta: { trackId: string, language: string } | null,
     * }}
     */
    function replaceSecondaryMonitor(track, onCueChange, options = {}) {
      const sameTrackRef = Boolean(track && secondaryMonitorTrack === track);

      if (sameTrackRef && secondaryMonitorCleanup) {
        return {
          skipped: true,
          reason: "same-track-ref",
          track: secondaryMonitorTrack,
          meta: secondaryMonitorMeta,
        };
      }

      const binding = startSecondaryMonitor(track, onCueChange, options);

      return {
        skipped: false,
        reason: binding ? "replaced" : "binding-failed",
        track: binding?.track || null,
        meta: secondaryMonitorMeta,
      };
    }

    return {
      // primary bind は従来どおり cueController に委譲する。
      bindPrimary: (track, onCueChange, options) =>
        cueController.bindPrimarySubtitleTrack(track, onCueChange, options),

      // primary unbind も cueController に委譲する。
      unbindPrimary: (options) =>
        cueController.unbindPrimarySubtitleTrack(options),

      // primary 字幕から native 字幕へ handoff する。
      handoffPrimaryToNative: () =>
        cueController.handoffPrimarySubtitleToNative(),

      // native 字幕の復元処理を呼び出す。
      restoreNative: () =>
        cueController.restoreNativeSubtitles?.(),

      // secondary の mode 決定や bind 自体はまだ cueController 側に委譲する。
      bindSecondary: (track, modeDecision) =>
        cueController.bindSecondarySubtitleTrack(track, modeDecision),

      // secondary unbind 前に monitor を必ず止める。
      // listener cleanup を先に通してから controller 側 unbind へ進む。
      unbindSecondary: (options) => {
        stopSecondaryMonitor();
        return cueController.unbindSecondarySubtitleTrack(options);
      },

      // 現在 bind 済みの primary track を返す。
      getBoundPrimary: () =>
        cueController.getBoundPrimaryTrack(),

      // 現在 bind 済みの secondary track を返す。
      getBoundSecondary: () =>
        cueController.getBoundSecondaryTrack(),

      // secondary monitor API。
      startSecondaryMonitor,
      replaceSecondaryMonitor,
      stopSecondaryMonitor,

      // monitor state の観測用 API。
      getSecondaryMonitorState: () => ({
        track: secondaryMonitorTrack,
        meta: secondaryMonitorMeta,
        active: Boolean(secondaryMonitorCleanup),
      }),
    };
  }

  /**
   * primary / secondary 共通の cuechange listener binding を作る。
   * track.mode は一切変更せず、listener の attach / cleanup だけを担う。
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

    // primary は引数なし、secondary は track を渡す形をここで吸収する。
    const invoke = () => {
      if (passTrackToHandler) {
        onCueChange(track);
        return;
      }
      onCueChange();
    };

    // cuechange 本体のハンドラ。
    // listener 経由で例外を外へ漏らさない。
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

    // primary 用では playback signal でも補助発火できるようにする。
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

      // bind 直後の初回同期。
      // 次の cuechange を待つ間の空表示を防ぐ。
      notifyInitial() {
        try {
          invoke();
        } catch (_) {}
      },

      // attach した listener を全て解除する。
      // video 側の補助 listener もここでまとめて外す。
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

  root.cueTrackBinder = root.cueTrackBinder || {};
  root.cueTrackBinder.createCueTrackBinder = createCueTrackBinder;
  root.cueTrackBinder.createTrackListenerBinding = createTrackListenerBinding;
})();
