// =============================================================
// Apple TV+ Bilingual Subtitles - modules/cue-track-binder.js
//
// 役割: cue-controller.js が持つ track bind / unbind / handoff 系 API を
//       名前空間経由で参照しやすい形にまとめるバインダーモジュール
//
// 依存: cue-controller.js が生成する cueController インスタンス
//       (bindPrimarySubtitleTrack / unbindPrimarySubtitleTrack /
//        handoffPrimarySubtitleToNative / restoreNativeSubtitles /
//        getBoundPrimaryTrack)
//
// 設計原則:
//   - primary の bind / unbind / handoff / restore は
//     引き続き cueController に委譲する（track.mode の決定は
//     primary 側の文脈が複雑なため、責務を分割しない）。
//   - secondary は listener の attach/cleanup に加えて、
//     track.mode の決定・適用・復元・同一track判定まで
//     このモジュールが一元的に持つ。
//   - secondary monitor の状態（bind中のtrack・meta・
//     適用中mode・復元用mode）は全てこのモジュール内の
//     クロージャ変数で保持し、getSecondaryMonitorState() で
//     読み取り専用として公開する。
//   - createTrackListenerBinding() は primary/secondary 共通の
//     cuechange listener attach/cleanup のみを担い、
//     track.mode には触れない（mode操作は呼び出し側の責務）。
//   - トグル完全リセット時は、secondary monitor が保持している
//     cleanup / track / mode / meta をこのモジュール側で明示的に手放し、
//     古い track 参照を次回セッションへ持ち越さない。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * cueController の公開 API を、呼び出し側で扱いやすい binder 形に束ねる。
   *
   * @param {{
   *   cueController: object,
   *   logContent?: Function,
   * }} deps
   * @returns {{
   *   bindPrimary: Function,
   *   unbindPrimary: Function,
   *   handoffPrimaryToNative: Function,
   *   restoreNative: Function,
   *   bindSecondary: Function,
   *   unbindSecondary: Function,
   *   resetSecondaryMonitorForToggle: Function,
   *   getBoundPrimary: Function,
   *   getBoundSecondary: Function,
   *   startSecondaryMonitor: Function,
   *   replaceSecondaryMonitor: Function,
   *   stopSecondaryMonitor: Function,
   *   getSecondaryMonitorState: Function,
   * }}
   */
  function createCueTrackBinder({ cueController, logContent }) {
    // -------------------------------------------------------
    // secondary monitor state
    // -------------------------------------------------------

    // secondary monitor が現在監視している track 本体。
    // same track の差し替え回避判定にも使う。
    let secondaryMonitorTrack = null;

    // createTrackListenerBinding() から受け取る唯一の cleanup 経路。
    let secondaryMonitorCleanup = null;

    // debug / state 観測用のメタ情報。
    // bind 時に渡された bindingMeta をそのまま保持し、
    // cleanup ログでも同じ内容を参照できるようにする。
    let secondaryMonitorMeta = null;

    // 拡張が track.mode を書き換える前の値。
    // stop 時に restoreMode !== false であればこの値へ戻す。
    let secondaryMonitorOriginalMode = null;

    // 直近で適用した requestedMode。
    // same track re-bind 時の mode 変化判定に使う。
    let secondaryMonitorRequestedMode = null;

    // -------------------------------------------------------
    // 内部 helper
    // -------------------------------------------------------

    // secondary monitor が現在握っている参照を
    // ログ向けに軽量スナップショット化する。
    // track 本体は返さず、解放前後の状態比較に必要な情報だけ返す。
    function buildSecondaryMonitorSnapshot() {
      return {
        active: Boolean(secondaryMonitorCleanup),
        hasCleanup: Boolean(secondaryMonitorCleanup),
        hasTrack: Boolean(secondaryMonitorTrack),
        trackId: secondaryMonitorTrack?.id || "",
        trackKind: secondaryMonitorTrack?.kind || "",
        trackLabel: secondaryMonitorTrack?.label || "",
        trackLanguage: secondaryMonitorTrack?.language || "",
        currentMode:
          secondaryMonitorTrack && typeof secondaryMonitorTrack.mode === "string"
            ? secondaryMonitorTrack.mode
            : null,
        originalMode:
          secondaryMonitorOriginalMode != null
            ? secondaryMonitorOriginalMode
            : null,
        requestedMode:
          secondaryMonitorRequestedMode != null
            ? secondaryMonitorRequestedMode
            : null,
        meta: secondaryMonitorMeta || null,
      };
    }

    // secondary monitor が保持するクロージャ参照を完全に手放す。
    // listener cleanup 後は必ずこの helper を通して参照を null 化し、
    // 次回 bind が古い track / meta を再利用しないようにする。
    function clearSecondaryMonitorRefs() {
      secondaryMonitorTrack = null;
      secondaryMonitorCleanup = null;
      secondaryMonitorMeta = null;
      secondaryMonitorOriginalMode = null;
      secondaryMonitorRequestedMode = null;
    }

    /**
     * secondary track の mode を安全に適用する。
     * 失敗時は例外を握り、呼び出し元の onModeApplyError へ通知するだけに留める。
     *
     * @param {TextTrack} track
     * @param {string} nextMode
     * @param {{ onModeApplyError?: Function, applyReason?: string }} context
     */
    function applySecondaryTrackMode(
      track,
      nextMode,
      { onModeApplyError, applyReason = "secondary-monitor" } = {},
    ) {
      if (!track || !nextMode) return;
      if (track.mode === nextMode) return;

      try {
        track.mode = nextMode;
      } catch (error) {
        try {
          onModeApplyError?.(error, nextMode, applyReason);
        } catch (_) {}
      }
    }

    // -------------------------------------------------------
    // secondary unbind / reset
    // -------------------------------------------------------

    /**
     * 現在の secondary monitor を停止する。
     * listener cleanup を必ず実行し、restoreMode !== false の場合は
     * mode を bind 前の値へ戻す。
     *
     * fallbackTrack / fallbackOriginalMode は、呼び出し側
     * (cue-controller.js) がまだローカルに track / originalMode を
     * 保持しているケースの橋渡し用。monitor 側の状態が既に
     * 空でも、渡された値を使って restore できるようにする。
     *
     * @param {{
     *   restoreMode?: boolean,
     *   fallbackTrack?: TextTrack | null,
     *   fallbackOriginalMode?: string | null,
     *   reason?: string,
     *   toggleOpId?: string | null,
     * }} options
     */
    function stopSecondaryMonitor(options = {}) {
      const restoreMode = options.restoreMode !== false;
      const fallbackTrack = options.fallbackTrack || null;
      const fallbackOriginalMode =
        options.fallbackOriginalMode != null
          ? options.fallbackOriginalMode
          : null;
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "secondary-monitor-stop";
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;

      const before = buildSecondaryMonitorSnapshot();

      const track = secondaryMonitorTrack || fallbackTrack || null;
      const originalMode =
        secondaryMonitorOriginalMode != null
          ? secondaryMonitorOriginalMode
          : fallbackOriginalMode;

      let cleanupExecuted = false;
      let restoreAttempted = false;
      let restoreSucceeded = false;

      try {
        if (typeof secondaryMonitorCleanup === "function") {
          secondaryMonitorCleanup();
          cleanupExecuted = true;
        }
      } catch (_) {}

      if (restoreMode && track && originalMode != null) {
        restoreAttempted = true;
        try {
          track.mode = originalMode;
          restoreSucceeded = true;
        } catch (_) {}
      }

      clearSecondaryMonitorRefs();

      const after = buildSecondaryMonitorSnapshot();

      logContent?.("secondary monitor stopped", {
        reason,
        toggleOpId,
        restoreMode,
        cleanupExecuted,
        restoreAttempted,
        restoreSucceeded,
        before,
        after,
      });
    }

    // 拡張 ON/OFF トグル用に secondary monitor を完全リセットする。
    // stopSecondaryMonitor() を基礎にしつつ、ログ名を分けて
    // toggleOpId 単位で OFF/ON の相関を追いやすくする。
    function resetSecondaryMonitorForToggle(options = {}) {
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;
      const restoreMode = options.restoreMode !== false;
      const before = buildSecondaryMonitorSnapshot();

      stopSecondaryMonitor({
        ...options,
        restoreMode,
        reason: options.reason || "toggle-reset",
        toggleOpId,
      });

      const after = buildSecondaryMonitorSnapshot();

      logContent?.("secondary monitor fully reset for toggle", {
        toggleOpId,
        restoreMode,
        before,
        after,
      });
    }

    // -------------------------------------------------------
    // secondary bind
    // -------------------------------------------------------

    /**
     * secondary monitor を開始する。
     * 同一 track かつ同一 requestedMode で既に監視中の場合は
     * bind をスキップし、listener の再作成を避ける。
     *
     * ただし、monitor state が stale な場合は
     * same track でも skip せず張り直す。
     *
     * @param {TextTrack} track
     * @param {Function} onCueChange - secondary の cuechange で呼ぶハンドラ
     * @param {{
     *   video?: HTMLVideoElement | null,
     *   requestedMode?: string,
     *   originalMode?: string | null,
     *   bindingMeta?: object | null,
     *   onModeApplyError?: Function,
     *   toggleOpId?: string | null,
     * }} options
     * @returns {{
     *   skipped: boolean,
     *   reason: string,
     *   track: TextTrack | null,
     *   meta: object | null,
     * }}
     */
    function startSecondaryMonitor(track, onCueChange, options = {}) {
      const video = options.video || null;
      const requestedMode = options.requestedMode || "hidden";
      const originalMode =
        options.originalMode != null ? options.originalMode : null;
      const bindingMeta = options.bindingMeta || null;
      const onModeApplyError = options.onModeApplyError;
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;

      const sameTrack = Boolean(
        track &&
          secondaryMonitorTrack &&
          track === secondaryMonitorTrack &&
          requestedMode === secondaryMonitorRequestedMode,
      );

      const staleMonitor = Boolean(
        sameTrack &&
          (!secondaryMonitorCleanup || secondaryMonitorTrack !== track),
      );

      if (sameTrack && !staleMonitor) {
        logContent?.("secondary monitor bind skipped", {
          toggleOpId,
          reason: "same-track-same-mode",
          requestedMode,
          snapshot: buildSecondaryMonitorSnapshot(),
        });

        return {
          skipped: true,
          reason: "same-track-same-mode",
          track: secondaryMonitorTrack,
          meta: secondaryMonitorMeta,
        };
      }

      // stale monitor を残したまま張り直すと cleanup 参照の取りこぼしが起きるため、
      // bind 前に現在の monitor を必ず停止する。
      stopSecondaryMonitor({
        restoreMode: true,
        reason: staleMonitor ? "stale-rebind" : "replace-before-bind",
        toggleOpId,
      });

      applySecondaryTrackMode(track, requestedMode, {
        onModeApplyError,
        applyReason: "secondary-monitor-bind",
      });

      const binding = createTrackListenerBinding({
        track,
        onCueChange,
        video,
        passTrackToHandler: true,
        usePlaybackSignals: false,
      });

      if (!binding) {
        logContent?.("secondary monitor bind failed", {
          toggleOpId,
          reason: "binding-failed",
          trackId: track?.id || "",
          trackLanguage: track?.language || "",
          requestedMode,
        });

        return {
          skipped: false,
          reason: "binding-failed",
          track: null,
          meta: null,
        };
      }

      secondaryMonitorTrack = track;
      secondaryMonitorCleanup = binding.cleanup;
      secondaryMonitorOriginalMode = originalMode;
      secondaryMonitorRequestedMode = requestedMode;
      secondaryMonitorMeta = {
        trackId: track?.id || "",
        language: track?.language || "",
        bindingId: bindingMeta?.bindingId || "",
        lane: bindingMeta?.lane || "secondary",
        trackKind: track?.kind || "",
        trackLabel: track?.label || "",
        trackLanguage: track?.language || "",
        requestedMode,
      };

      logContent?.("secondary monitor started", {
        toggleOpId,
        requestedMode,
        snapshot: buildSecondaryMonitorSnapshot(),
      });

      // bind 直後に 1 回だけ同期させ、最初の cuechange 待ちで
      // 空表示になるのを防ぐ。
      binding.notifyInitial?.();

      return {
        skipped: false,
        reason: "started",
        track,
        meta: secondaryMonitorMeta,
      };
    }

    /**
     * secondary monitor を差し替える。
     * 実体は startSecondaryMonitor() と同じ判定を使うため、
     * ここでは単純に委譲する。
     *
     * @param {TextTrack} track
     * @param {Function} onCueChange
     * @param {object} options
     * @returns {ReturnType<typeof startSecondaryMonitor>}
     */
    function replaceSecondaryMonitor(track, onCueChange, options = {}) {
      return startSecondaryMonitor(track, onCueChange, options);
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------
    return {
      // primary bind は cueController に委譲する。
      // primary は OFF/handoff の絡みが多く、責務を割らない。
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

      // secondary の bind 実体はこのモジュールが持つ。
      // 呼び出し側 (cue-controller.js) は
      // track / onCueChange / requestedMode / originalMode /
      // bindingMeta / onModeApplyError を渡すだけでよい。
      bindSecondary: (track, onCueChange, options) =>
        startSecondaryMonitor(track, onCueChange, options),

      // secondary unbind もこのモジュールが持つ。
      // options.restoreMode / fallbackTrack / fallbackOriginalMode /
      // reason / toggleOpId をそのまま stopSecondaryMonitor() へ渡す。
      unbindSecondary: (options) => stopSecondaryMonitor(options),

      // トグル完全リセット専用の unbind。
      // OFF 時の相関ログを start 側と結び付けたい場合に使う。
      resetSecondaryMonitorForToggle: (options) =>
        resetSecondaryMonitorForToggle(options),

      // 現在 bind 済みの primary track を返す。
      getBoundPrimary: () => cueController.getBoundPrimaryTrack(),

      // 現在 bind 済みの secondary track を返す。
      // monitor が空の場合は null。
      getBoundSecondary: () => secondaryMonitorTrack || null,

      // secondary monitor API。
      // cue-controller.js からは主にこの3つを直接呼ぶ想定。
      startSecondaryMonitor,
      replaceSecondaryMonitor,
      stopSecondaryMonitor,

      // monitor state の観測用 API。
      // track / meta に加えて、適用中の mode と復元用 mode も返す。
      getSecondaryMonitorState: () => ({
        active: Boolean(secondaryMonitorCleanup),
        hasCleanup: Boolean(secondaryMonitorCleanup),
        track: secondaryMonitorTrack,
        meta: secondaryMonitorMeta,
        originalMode: secondaryMonitorOriginalMode,
        requestedMode: secondaryMonitorRequestedMode,
      }),
    };
  }

  /**
   * primary / secondary 共通の cuechange listener binding を作る。
   * track.mode には触れず、listener の attach / cleanup / 初回発火だけを担う。
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
    }

    return {
      track,

      // bind 直後に現在の active cue を同期したいときに使う。
      notifyInitial: () => {
        try {
          invoke();
        } catch (_) {}
      },

      // addEventListener した listener を全て外す。
      // ここが bind 1 回につき 1 つだけ存在する cleanup 本体。
      cleanup: () => {
        try {
          track.removeEventListener("cuechange", cueHandler);
        } catch (_) {}

        if (playbackHandler && video) {
          try {
            video.removeEventListener("timeupdate", playbackHandler);
          } catch (_) {}

          try {
            video.removeEventListener("seeked", playbackHandler);
          } catch (_) {}
        }
      },
    };
  }

  // -------------------------------------------------------
  // エクスポート
  // -------------------------------------------------------
  // window.ATVB.cueTrackBinder として公開する。
  // cue-controller.js 側は createCueTrackBinder({ cueController }) を呼び、
  // 返り値を window.ATVB.cueTrackBinder.instance として保持する想定。
  root.cueTrackBinder = root.cueTrackBinder || {};
  root.cueTrackBinder.createCueTrackBinder = createCueTrackBinder;
  root.cueTrackBinder.createTrackListenerBinding = createTrackListenerBinding;
})();
