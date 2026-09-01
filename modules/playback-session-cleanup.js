// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-session-cleanup.js
//
// 役割:
// - playback session cleanup owner の唯一入口として、再生セッションに紐づく
//   一時的な UI / observer / subtitle state / track binding の teardown を束ねる。
// - popup / options で保存した永続設定
//   （primaryLang / secondaryLang / panelDefaultOpen など）は保持する。
// - runtime state の extensionEnabled はこの cleanup では保存・復元せず、
//   呼び出し元の state.extensionEnabled を前提に teardown だけを担当する。
// - restart 用 cleanup と extension OFF 用 cleanup を分け、
//   再起動時は再生成前提の撤収、OFF 時は再生画面の拡張 UI 完全破棄を担当する。
// - content.js や panel/debug runtime から direct cleanup させず、
//   session teardown はこの owner API 経由へ収束させる。
// - content switch 時の resetForContentSwitch() は、同一タイミングで重複して呼ばれても
//   teardown が壊れないよう最小限の再入ガードを持つ。
// - cleanup 前後で、どの参照 / timer / observer / track binding を保持していたかを
//   構造化ログで記録し、トグル OFF や restart 時の解放状況を追跡できるようにする。
// - startup request / session 相関を requestId / sessionId / videoSrcKey で保持し、
//   restart 前 cleanup と attach 前 cleanup の前後関係を compact log で追えるようにする。
//
// clearInternalSubtitleState の preserveSecondaryDom 使い分け:
//   true  -> restart 前提。パネルDOMのフラッシュを避けるため secondary DOM を残す。
//   false -> 動画クローズ / セッション完全終了。パネルDOMも含めて残留表示を消す。
// =============================================================
(() => {
  "use strict";

  // モジュール公開先の ATVB 名前空間を確保する。
  const root = (window.ATVB = window.ATVB || {});

  /**
   * playback session cleanup owner を生成する。
   * 永続設定は保持し、playback session に紐づく一時 state と session UI の撤収だけを担当する。
   *
   * content.js や session 従属 UI module から direct cleanup させず、
   * restart / disable / content switch / UI clear の入口をこの API 群へ集約する。
   *
   * @param {object} params cleanup 生成に必要な依存関係。
   * @param {object} params.state playback runtime state。
   * @param {(message: string, payload?: object) => void} [params.logContent]
   *   構造化ログ出力関数。
   * @param {object} [params.teardownDeps={}] teardown に使う依存関係。
   * @returns {{
   *   teardownForRestart: (options?: object) => void,
   *   detachForDisabled: (options?: object) => void,
   *   prepareForRestart: (options?: object) => void,
   *   resetForContentSwitch: (reason?: string) => void,
   *   clearPlaybackSessionUiState: (reason?: string) => void,
   *   handleNavigationTargetMissing: (options?: object) => void,
   *   restoreDefaultLayout: () => void,
   * }} playback session cleanup owner API。
   */
  function createPlaybackSessionCleanup({
    state,
    logContent,
    teardownDeps = {},
  }) {
    const {
      stopPlaybackControlLayoutObservers,
      layoutController,
      clearInitialCueRecovery,
      renderSecondarySubtitle,
      overlayController,
      disposePanelUi,
      applyLayout,
      clearInternalSubtitleState,
      cueController,
      subtitleRecoveryManager,
      runtimeObservers,
      resetInitialAutoStartDelegation,
      stopSecondaryTrackSyncInterval,
      pauseSyncIntervalOrchestrator,
    } = teardownDeps;

    // resetForContentSwitch() の同期的な再入だけを防ぐフラグ。
    // 同一旧セッションへの cleanup 一度化そのものは
    // playback-startup-coordinator.js 側で行い、
    // cleanup owner であるこのモジュールでは「呼ばれても壊れない」ための保険に留める。
    let isResettingForContentSwitch = false;

    // -------------------------------------------------------
    // cleanup correlation state
    // -------------------------------------------------------

    /**
     * cleanup 相関用の active session 情報を返す。
     *
     * @returns {{
     *   sessionId: string,
     *   requestId: string,
     *   videoSrcKey: string,
     * }}
     */
    function getActiveCleanupCorrelation() {
      return {
        sessionId:
          typeof state.activeBilingualSessionId === "string"
            ? state.activeBilingualSessionId
            : "",
        requestId:
          typeof state.activeBilingualRequestId === "string"
            ? state.activeBilingualRequestId
            : "",
        videoSrcKey:
          typeof state.lastVideoSrcKey === "string" ? state.lastVideoSrcKey : "",
      };
    }

    /**
     * cleanup 系 API に渡された request context を正規化する。
     *
     * @param {object} [input={}]
     * @returns {{
     *   requestId: string,
     *   reason: string,
     *   source: string,
     *   videoSrcKey: string,
     *   sessionId: string,
     *   toggleOpId: string|null,
     * }}
     */
    function normalizeCleanupRequestContext(input = {}) {
      const active = getActiveCleanupCorrelation();

      return {
        requestId:
          typeof input.requestId === "string" && input.requestId.trim()
            ? input.requestId.trim()
            : active.requestId,
        reason:
          typeof input.reason === "string" && input.reason.trim()
            ? input.reason.trim()
            : "unknown",
        source:
          typeof input.source === "string" && input.source.trim()
            ? input.source.trim()
            : "cleanup_owner",
        videoSrcKey:
          typeof input.videoSrcKey === "string" && input.videoSrcKey
            ? input.videoSrcKey
            : active.videoSrcKey,
        sessionId:
          typeof input.sessionId === "string" && input.sessionId.trim()
            ? input.sessionId.trim()
            : active.sessionId,
        toggleOpId:
          typeof input.toggleOpId === "string" && input.toggleOpId
            ? input.toggleOpId
            : null,
      };
    }

    /**
     * cleanup 相関ログ用の compact payload を返す。
     *
     * @param {object} requestContext
     * @param {object} [overrides={}]
     * @returns {object}
     */
    function getCleanupLogContext(requestContext, overrides = {}) {
      return {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        source: requestContext?.source || "cleanup_owner",
        sessionId: requestContext?.sessionId || "",
        videoSrcKey: requestContext?.videoSrcKey || "",
        toggleOpId: requestContext?.toggleOpId ?? null,
        hasVideo: Boolean(state.video),
        hasDialogEl: Boolean(state.dialogEl),
        hasPrimaryTrack: Boolean(state.primaryTrack),
        hasSecondaryTrack: Boolean(state.secondaryTrack),
        panelOpen: state.panelOpen,
        subtitleHistoryCount: Array.isArray(state.subtitleHistory)
          ? state.subtitleHistory.length
          : 0,
        panelPastBlocksCount: Array.isArray(state.panelPastBlocks)
          ? state.panelPastBlocks.length
          : 0,
        ...overrides,
      };
    }

    /**
     * cleanup の begin / complete を compact log で残す。
     *
     * @param {"begin"|"complete"} stage
     * @param {object} requestContext
     * @param {object} [payload={}]
     * @returns {void}
     */
    function logCleanupLifecycle(stage, requestContext, payload = {}) {
      logContent?.(
        `playback session cleanup ${stage}`,
        getCleanupLogContext(requestContext, payload),
      );
    }

    // -------------------------------------------------------
    // 小さな state cleanup
    // -------------------------------------------------------

    /**
     * secondary track の参照と表示だけを消す。
     * 設定値や requested settings には触らない。
     */
    function clearSecondaryTrackState() {
      state.secondaryTrack = null;
      state.lastSecondarySyncContext = null;

      if (state.secondaryHideTimer) {
        clearTimeout(state.secondaryHideTimer);
        state.secondaryHideTimer = null;
      }

      renderSecondarySubtitle("", null);
    }

    // -------------------------------------------------------
    // cleanup snapshot
    // -------------------------------------------------------

    /**
     * cleanup 前後ログ用に、現在の playback session 周辺 state を軽量スナップショット化する。
     * 生の DOM / track をそのまま出さず、保持有無と件数を中心に返す。
     *
     * @returns {object} cleanup 前後比較用の軽量 snapshot。
     */
    function buildCleanupSnapshot() {
      const secondaryMonitorState =
        cueController?.getSecondaryMonitorState?.() || null;

      return {
        hasVideo: Boolean(state.video),
        hasDialogEl: Boolean(state.dialogEl),
        hasPrimaryTrack: Boolean(state.primaryTrack),
        hasSecondaryTrack: Boolean(state.secondaryTrack),
        hasCurrentSubtitleBlock: Boolean(state.currentSubtitleBlock),
        hasSubtitleBlockMeta: Boolean(state.subtitleBlockMeta),
        hasLastPanelRenderSnapshot: Boolean(state.lastPanelRenderSnapshot),
        hasLastSecondarySyncContext: Boolean(state.lastSecondarySyncContext),
        subtitleHistoryCount: Array.isArray(state.subtitleHistory)
          ? state.subtitleHistory.length
          : 0,
        panelPastBlocksCount: Array.isArray(state.panelPastBlocks)
          ? state.panelPastBlocks.length
          : 0,
        subtitleBlocksCount: Array.isArray(state.subtitleBlocks)
          ? state.subtitleBlocks.length
          : 0,
        subtitleCurrentIndex: Number.isFinite(state.subtitleCurrentIndex)
          ? state.subtitleCurrentIndex
          : null,
        secondaryHideTimerActive: Boolean(state.secondaryHideTimer),
        allowSecondaryOnlyUntil: Number.isFinite(state.allowSecondaryOnlyUntil)
          ? state.allowSecondaryOnlyUntil
          : null,
        currentContentKey: state.currentContentKey || "",
        lastVideoSrcKey: state.lastVideoSrcKey || "",
        secondaryMonitorBoundTrackLanguage:
          secondaryMonitorState?.boundTrackLanguage || "",
        secondaryMonitorBoundTrackLabel:
          secondaryMonitorState?.boundTrackLabel || "",
        secondaryMonitorPendingSync:
          secondaryMonitorState?.pendingSync ?? false,
      };
    }

    // -------------------------------------------------------
    // session teardown runner
    // -------------------------------------------------------

    /**
     * playback session teardown の本体。
     * restart / disable / startup attach 前 cleanup など、同系統の撤収処理をここへ集約する。
     *
     * @param {object} options
     * @param {"restart"|"disabled"|"startup_attach"} options.phase
     * @param {boolean} options.restoreSecondaryMode
     * @param {boolean} options.completeSubtitleStateReset
     * @param {boolean} options.preserveSecondaryDom
     * @param {object} [options.requestContext={}]
     * @returns {void}
     */
    function runSessionTeardown({
      phase,
      restoreSecondaryMode,
      completeSubtitleStateReset,
      preserveSecondaryDom,
      requestContext = {},
    }) {
      const normalizedRequestContext = normalizeCleanupRequestContext({
        ...requestContext,
      });
      const before = buildCleanupSnapshot();

      logCleanupLifecycle("begin", normalizedRequestContext, {
        phase,
        restoreSecondaryMode,
        completeSubtitleStateReset,
        preserveSecondaryDom,
        before,
      });

      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      pauseSyncIntervalOrchestrator?.(normalizedRequestContext.reason);

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();
      overlayController?.clearOverlayState?.();
      disposePanelUi?.({ reason: normalizedRequestContext.reason });

      runtimeObservers?.stopAll?.();
      resetInitialAutoStartDelegation?.();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({
        restoreMode: restoreSecondaryMode,
        reason: normalizedRequestContext.reason,
        toggleOpId: normalizedRequestContext.toggleOpId,
      });
      subtitleRecoveryManager?.dispose?.();

      if (completeSubtitleStateReset) {
        clearInternalSubtitleState?.({
          preserveSecondaryDom,
          reason: normalizedRequestContext.reason,
          toggleOpId: normalizedRequestContext.toggleOpId,
          completeReset: true,
        });
      }

      const after = buildCleanupSnapshot();

      logCleanupLifecycle("complete", normalizedRequestContext, {
        phase,
        restoreSecondaryMode,
        completeSubtitleStateReset,
        preserveSecondaryDom,
        after,
      });
    }

    // -------------------------------------------------------
    // teardown helpers
    // -------------------------------------------------------

    /**
     * startup coordinator からの target attach 前 cleanup 用 thin wrapper。
     * 旧 playback target から新 target へ attach し直す直前に、
     * 現在の session を再生成前提の teardown へ収束させる。
     *
     * clearPlaybackSessionUiState() のような完全終了 cleanup ではなく、
     * resetForContentSwitch() と同系統の「旧 session を持ち越さない」用途で使う。
     *
     * @param {object} [options={}] 実行オプション。
     * @param {string} [options.reason="startup_target_attach_cleanup"] cleanup reason。
     * @param {string} [options.requestId] startup request 相関 ID。
     * @param {string} [options.sessionId] teardown 対象 session ID。
     * @param {string} [options.videoSrcKey] playback target 相関キー。
     * @param {string} [options.source] 呼び出し元識別子。
     * @param {string} [options.toggleOpId] toggle 操作相関 ID。
     */
    function clearSubtitlesForStartup(options = {}) {
      const requestContext = normalizeCleanupRequestContext({
        reason:
          typeof options.reason === "string" && options.reason
            ? options.reason
            : "startup_target_attach_cleanup",
        requestId: options.requestId,
        sessionId: options.sessionId,
        videoSrcKey: options.videoSrcKey,
        source: options.source || "startup_coordinator",
        toggleOpId: options.toggleOpId,
      });

      runSessionTeardown({
        phase: "startup_attach",
        restoreSecondaryMode: false,
        completeSubtitleStateReset: false,
        preserveSecondaryDom: true,
        requestContext,
      });
    }

    /**
     * restart teardown 用の cleanup owner 入口。
     * startup coordinator などからの rebuild 要求で、現在の playback session を
     * 再生成前提の teardown へ収束させる。
     * reinitialize coordinator からの rebuild 経路もこの API へ集約する。
     *
     * @param {object} [options={}] 実行オプション。
     * @param {string} [options.toggleOpId] toggle 操作相関 ID。
     * @param {string} [options.reason="teardownForRestart"] cleanup reason。
     * @param {object} [options.requestContext] startup / rebuild request 相関情報。
     */
    function teardownForRestart(options = {}) {
      const requestContext = normalizeCleanupRequestContext({
        ...(options.requestContext || {}),
        toggleOpId:
          typeof options.toggleOpId === "string" && options.toggleOpId
            ? options.toggleOpId
            : options.requestContext?.toggleOpId,
        reason:
          typeof options.reason === "string" && options.reason
            ? options.reason
            : "teardownForRestart",
      });

      runSessionTeardown({
        phase: "restart",
        restoreSecondaryMode: false,
        completeSubtitleStateReset: false,
        preserveSecondaryDom: true,
        requestContext,
      });
    }

    /**
     * extensionEnabled=false 時の cleanup owner 入口。
     * 再生画面に出していた session UI / observer / subtitle state を完全撤収し、
     * secondary subtitle の mode も元へ戻す。
     *
     * @param {object} [options={}] 実行オプション。
     * @param {string} [options.toggleOpId] toggle 操作相関 ID。
     * @param {string} [options.reason="detachForDisabled"] cleanup reason。
     * @param {object} [options.requestContext] startup / rebuild request 相関情報。
     */
    function detachForDisabled(options = {}) {
      const requestContext = normalizeCleanupRequestContext({
        ...(options.requestContext || {}),
        toggleOpId:
          typeof options.toggleOpId === "string" && options.toggleOpId
            ? options.toggleOpId
            : options.requestContext?.toggleOpId,
        reason:
          typeof options.reason === "string" && options.reason
            ? options.reason
            : "detachForDisabled",
      });

      runSessionTeardown({
        phase: "disabled",
        restoreSecondaryMode: true,
        completeSubtitleStateReset: true,
        preserveSecondaryDom: false,
        requestContext,
      });
    }

    // -------------------------------------------------------
    // cleanup owner: restart preparation
    // -------------------------------------------------------

    /**
     * restart 前の cleanup owner 入口。
     * 保存済み設定は保持したまま、直後の startBilingual() で再生成できるよう
     * 再生セッション由来の一時 state と session UI の参照を初期化する。
     *
     * @param {object} [options={}] 実行オプション。
     * @param {string} [options.toggleOpId] toggle 操作相関 ID。
     * @param {string} [options.reason="prepareForRestart"] cleanup reason。
     * @param {object} [options.requestContext] startup / rebuild request 相関情報。
     */
    function prepareForRestart(options = {}) {
      const requestContext = normalizeCleanupRequestContext({
        ...(options.requestContext || {}),
        toggleOpId:
          typeof options.toggleOpId === "string" && options.toggleOpId
            ? options.toggleOpId
            : options.requestContext?.toggleOpId,
        reason:
          typeof options.reason === "string" && options.reason
            ? options.reason
            : "prepareForRestart",
      });

      const before = buildCleanupSnapshot();

      logCleanupLifecycle("begin", requestContext, {
        phase: "restart_prepare",
        preserveSecondaryDom: true,
        before,
      });

      clearInternalSubtitleState?.({
        preserveSecondaryDom: true,
        reason: requestContext.reason,
        toggleOpId: requestContext.toggleOpId,
      });

      // prepareForRestart() は complete reset ではなく、restart 前の軽量な参照整理である。
      // clearInternalSubtitleState({ preserveSecondaryDom: true }) だけでは
      // panel render snapshot は消えないため、panel DOM を残す経路でも
      // 次回起動で古い描画結果を再利用しないようここで明示的に無効化する。
      state.primaryTrack = null;
      state.lastPanelRenderSnapshot = null;
      state.currentSubtitleBlock = null;
      state.subtitleBlockMeta = null;
      state.lastSecondarySyncContext = null;
      state.allowSecondaryOnlyUntil = 0;

      const after = buildCleanupSnapshot();

      logCleanupLifecycle("complete", requestContext, {
        phase: "restart_prepare",
        preserveSecondaryDom: true,
        after,
      });
    }

    // -------------------------------------------------------
    // cleanup owner: session cleanup
    // -------------------------------------------------------

    /**
     * content switch 時の cleanup owner 入口。
     * 設定は保持したまま、旧 playback session に紐づく session UI / track / subtitle state を撤収する。
     * clearPlaybackSessionUiState よりは「次の再生へすぐ繋ぐ前提」の軽い cleanup として扱う。
     *
     * ここでは同期的な再入だけを防ぎ、
     * 同一旧セッションへの cleanup 一度化そのものは coordinator 側に任せる。
     *
     * @param {object|string} [options="content_switch"] 実行オプションまたは cleanup reason。
     * @param {string} [options.reason="content_switch"] cleanup reason。
     * @param {object} [options.requestContext] startup / rebuild request 相関情報。
     */
    function resetForContentSwitch(options = "content_switch") {
      const normalizedOptions =
        typeof options === "string" ? { reason: options } : options || {};
      const requestContext = normalizeCleanupRequestContext({
        ...(normalizedOptions.requestContext || {}),
        reason:
          typeof normalizedOptions.reason === "string" &&
          normalizedOptions.reason
            ? normalizedOptions.reason
            : "content_switch",
        source:
          normalizedOptions.requestContext?.source || "cleanup_owner",
      });

      if (isResettingForContentSwitch) {
        logCleanupLifecycle("complete", requestContext, {
          phase: "content_switch_reentry_skipped",
          skipped: true,
          currentContentKey: state.currentContentKey,
          previousVideoSrcKey: state.lastVideoSrcKey || "",
        });
        return;
      }

      isResettingForContentSwitch = true;

      const before = buildCleanupSnapshot();

      logCleanupLifecycle("begin", requestContext, {
        phase: "content_switch",
        preserveSecondaryDom: false,
        completeSubtitleStateReset: true,
        before,
      });

      try {
        stopPlaybackControlLayoutObservers?.();
        layoutController?.teardownPlaybackControlsUi?.();

        stopSecondaryTrackSyncInterval?.(requestContext.reason);
        pauseSyncIntervalOrchestrator?.(requestContext.reason);

        clearInitialCueRecovery?.();
        clearSecondaryTrackState();

        cueController?.handoffPrimarySubtitleToNative?.();
        cueController?.unbindSecondarySubtitleTrack?.({
          restoreMode: true,
          reason: requestContext.reason,
          toggleOpId: requestContext.toggleOpId,
        });
        subtitleRecoveryManager?.dispose?.();

        overlayController?.clearOverlayState?.();
        disposePanelUi?.({ reason: requestContext.reason });

        runtimeObservers?.stopAll?.();
        resetInitialAutoStartDelegation?.();

        clearInternalSubtitleState?.({
          preserveSecondaryDom: false,
          reason: requestContext.reason,
          toggleOpId: requestContext.toggleOpId,
          completeReset: true,
        });

        state.primaryTrack = null;
        state.video = null;
        state.dialogEl = null;
        state.lastObservedVideoTime = null;
      } finally {
        isResettingForContentSwitch = false;
      }

      const after = buildCleanupSnapshot();

      logCleanupLifecycle("complete", requestContext, {
        phase: "content_switch",
        preserveSecondaryDom: false,
        completeSubtitleStateReset: true,
        previousVideoSrcKey: state.lastVideoSrcKey || "",
        currentContentKey: state.currentContentKey,
        after,
      });
    }

    /**
     * session UI clear 用の cleanup owner 入口。
     * close / navigation / hard reset など「今の playback session を完全終了する」用途で、
     * 再生 UI / observer / subtitle state を完全に外す。
     *
     * @param {object|string} [options="clear_playback_session_ui_state"] 実行オプションまたは cleanup reason。
     * @param {string} [options.reason="clear_playback_session_ui_state"] cleanup reason。
     * @param {object} [options.requestContext] startup / rebuild request 相関情報。
     */
    function clearPlaybackSessionUiState(
      options = "clear_playback_session_ui_state",
    ) {
      const normalizedOptions =
        typeof options === "string" ? { reason: options } : options || {};
      const requestContext = normalizeCleanupRequestContext({
        ...(normalizedOptions.requestContext || {}),
        reason:
          typeof normalizedOptions.reason === "string" &&
          normalizedOptions.reason
            ? normalizedOptions.reason
            : "clear_playback_session_ui_state",
        source:
          normalizedOptions.requestContext?.source || "cleanup_owner",
      });

      const before = buildCleanupSnapshot();

      logCleanupLifecycle("begin", requestContext, {
        phase: "clear_playback_session_ui_state",
        preserveSecondaryDom: false,
        completeSubtitleStateReset: true,
        before,
      });

      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      stopSecondaryTrackSyncInterval?.(requestContext.reason);
      pauseSyncIntervalOrchestrator?.(requestContext.reason);

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({
        restoreMode: true,
        reason: requestContext.reason,
        toggleOpId: requestContext.toggleOpId,
      });
      cueController?.destroy?.();
      subtitleRecoveryManager?.dispose?.();

      overlayController?.clearOverlayState?.();
      disposePanelUi?.({ reason: requestContext.reason });

      runtimeObservers?.stopAll?.();
      resetInitialAutoStartDelegation?.();

      clearInternalSubtitleState?.({
        preserveSecondaryDom: false,
        reason: requestContext.reason,
        toggleOpId: requestContext.toggleOpId,
        completeReset: true,
      });

      state.primaryTrack = null;
      state.video = null;
      state.dialogEl = null;
      state.lastObservedVideoTime = null;
      state.currentContentKey = "";
      state.lastVideoSrcKey = "";

      const after = buildCleanupSnapshot();

      logCleanupLifecycle("complete", requestContext, {
        phase: "clear_playback_session_ui_state",
        preserveSecondaryDom: false,
        completeSubtitleStateReset: true,
        after,
      });
    }

    /**
     * navigation 直後に新しい playback target がまだ見つからないときの後始末。
     * UI はすでに resetForContentSwitch() 済みの想定なので、ここでは参照系を空に寄せる。
     *
     * @param {object} [options={}] 実行オプション。
     * @param {string} [options.reason="navigation_target_missing"] cleanup reason。
     * @param {object} [options.playbackContext={}] 補助ログ用の playback context。
     * @param {object} [options.requestContext] startup / rebuild request 相関情報。
     */
    function handleNavigationTargetMissing({
      reason = "navigation_target_missing",
      playbackContext = {},
      requestContext: requestContextInput = {},
    } = {}) {
      const requestContext = normalizeCleanupRequestContext({
        ...requestContextInput,
        reason:
          typeof reason === "string" && reason
            ? reason
            : "navigation_target_missing",
        source: requestContextInput?.source || "cleanup_owner",
      });

      logCleanupLifecycle("complete", requestContext, {
        phase: "navigation_target_missing",
        previousVideoSrcKey: state.lastVideoSrcKey || "",
        currentContentKey: state.currentContentKey,
        playbackContext,
      });

      state.video = null;
      state.dialogEl = null;
      state.lastObservedVideoTime = null;
      state.currentContentKey = "";
      state.lastVideoSrcKey = "";
    }

    // -------------------------------------------------------
    // cleanup owner: layout restore
    // -------------------------------------------------------

    /**
     * 再生 UI teardown 後に layout を標準状態へ戻す。
     * 拡張 UI の残骸を避けるため、最後に一度だけ呼ぶ用途を想定する。
     */
    function restoreDefaultLayout() {
      applyLayout?.({
        panelOpen: false,
        forceOverlayHidden: true,
      });
    }

    // -------------------------------------------------------
    // cleanup owner API export
    // -------------------------------------------------------

    // content.js や session 従属 UI module から direct cleanup せず、
    // playback session teardown はこの公開 API 群へ収束させる。
    return {
      teardownForRestart,
      clearSubtitlesForStartup,
      detachForDisabled,
      prepareForRestart,
      resetForContentSwitch,
      clearPlaybackSessionUiState,
      handleNavigationTargetMissing,
      restoreDefaultLayout,
    };
  }

  // -------------------------------------------------------
  // module export
  // -------------------------------------------------------
  root.createPlaybackSessionCleanup = createPlaybackSessionCleanup;
})();
