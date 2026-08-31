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
          : -1,
        hasSecondaryHideTimer: Boolean(state.secondaryHideTimer),
        playbackControlsRafId: state.playbackControlsRafId || 0,
        playbackControlsRetryTimersCount: Array.isArray(
          state.playbackControlsRetryTimers,
        )
          ? state.playbackControlsRetryTimers.length
          : 0,
        trackResolveRetryTimersCount: Array.isArray(state.trackResolveRetryTimers)
          ? state.trackResolveRetryTimers.length
          : 0,
        controlSettlingTimersCount: Array.isArray(state.controlSettlingTimers)
          ? state.controlSettlingTimers.length
          : 0,
        initialCueRecoveryTimersCount: Array.isArray(
          state.initialCueRecoveryTimers,
        )
          ? state.initialCueRecoveryTimers.length
          : 0,
        initialCueRecoveryCleanupCount: Array.isArray(
          state.initialCueRecoveryCleanup,
        )
          ? state.initialCueRecoveryCleanup.length
          : 0,
        hasOverlayRoot: Boolean(state.overlayRoot),
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        hasPopupShadowRoot: Boolean(state.popupShadowRoot),
        hasDebugPanelRoot: Boolean(state.debugPanelRoot),
        hasPopupDocClickHandler: Boolean(state.popupDocClickHandler),
        hasPlaybackCloseClickHandler: Boolean(state.playbackCloseClickHandler),
        hasPopupResizeObserver: Boolean(state.popupResizeObserver),
        hasToggleButtonResizeHandler: Boolean(state.toggleButtonResizeHandler),
        hasPopupLastContext: Boolean(state.popupLastContext),
        messageListenerAttached: Boolean(state.messageListenerAttached),
        currentContentKey: state.currentContentKey || "",
        lastVideoSrcKey: state.lastVideoSrcKey || "",
        secondaryMonitor: secondaryMonitorState
          ? {
              active: Boolean(secondaryMonitorState.active),
              hasCleanup: Boolean(secondaryMonitorState.hasCleanup),
              hasTrack: Boolean(secondaryMonitorState.track),
              originalMode:
                secondaryMonitorState.originalMode != null
                  ? secondaryMonitorState.originalMode
                  : null,
              requestedMode:
                secondaryMonitorState.requestedMode != null
                  ? secondaryMonitorState.requestedMode
                  : null,
              meta: secondaryMonitorState.meta || null,
            }
          : null,
      };
    }

    /**
     * cleanup 開始 / 終了ログを揃った形式で出す。
     * toggleOpId がある場合は OFF 側相関ログとしてそのまま流せるようにする。
     *
     * @param {string} phase cleanup の段階名。
     * @param {object} [payload={}] 追加で記録する構造化 payload。
     */
    function logCleanupPhase(phase, payload = {}) {
      logContent?.(`playback session cleanup ${phase}`, payload);
    }

    /**
     * teardown 共通本体。
     * restart / disabled で共通な撤収処理をまとめ、mode restore や
     * complete reset の有無だけをオプションで切り替える。
     *
     * @param {object} [options={}] teardown 実行オプション。
     * @param {string} [options.phase="unknown"] ログ用の cleanup phase。
     * @param {boolean} [options.restoreSecondaryMode=false]
     *   secondary track の mode を native 側へ戻すか。
     * @param {boolean} [options.completeSubtitleStateReset=false]
     *   subtitle state を complete reset として扱うか。
     * @param {boolean} [options.preserveSecondaryDom=false]
     *   secondary DOM を残すか。
     * @param {string|null} [options.toggleOpId=null] toggle 操作相関 ID。
     * @param {string} [options.reason=options.phase] cleanup reason。
     */
    function runSessionTeardown({
      phase = "unknown",
      restoreSecondaryMode = false,
      completeSubtitleStateReset = false,
      preserveSecondaryDom = false,
      toggleOpId = null,
      reason = phase,
    } = {}) {
      const before = buildCleanupSnapshot();

      logCleanupPhase("begin", {
        phase,
        reason,
        toggleOpId,
        restoreSecondaryMode,
        completeSubtitleStateReset,
        preserveSecondaryDom,
        before,
      });

      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      stopSecondaryTrackSyncInterval?.(reason);
      pauseSyncIntervalOrchestrator?.(reason);

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();
      overlayController?.clearOverlayState?.();
      disposePanelUi?.({ reason });

      runtimeObservers?.stopAll?.();
      resetInitialAutoStartDelegation?.();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({
        restoreMode: restoreSecondaryMode,
        reason,
        toggleOpId,
      });
      subtitleRecoveryManager?.dispose?.();

      if (completeSubtitleStateReset) {
        clearInternalSubtitleState?.({
          preserveSecondaryDom,
          reason,
          toggleOpId,
          completeReset: true,
        });
      }

      const after = buildCleanupSnapshot();

      logCleanupPhase("done", {
        phase,
        reason,
        toggleOpId,
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
     */
    function clearSubtitlesForStartup(options = {}) {
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "startup_target_attach_cleanup";

      resetForContentSwitch(reason);
    }

    /**
     * restart teardown 用の cleanup owner 入口。
     * startup coordinator などからの rebuild 要求で、現在の playback session を
     * 再生成前提の teardown へ収束させる。
     *
     * @param {object} [options={}] 実行オプション。
     * @param {string} [options.toggleOpId] toggle 操作相関 ID。
     * @param {string} [options.reason="teardownForRestart"] cleanup reason。
     */
    function teardownForRestart(options = {}) {
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "teardownForRestart";

      runSessionTeardown({
        phase: "restart",
        restoreSecondaryMode: false,
        completeSubtitleStateReset: false,
        preserveSecondaryDom: true,
        toggleOpId,
        reason,
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
     */
    function detachForDisabled(options = {}) {
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "detachForDisabled";

      runSessionTeardown({
        phase: "disabled",
        restoreSecondaryMode: true,
        completeSubtitleStateReset: true,
        preserveSecondaryDom: false,
        toggleOpId,
        reason,
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
     */
    function prepareForRestart(options = {}) {
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "prepareForRestart";

      const before = buildCleanupSnapshot();

      clearInternalSubtitleState?.({
        preserveSecondaryDom: true,
        reason,
        toggleOpId,
      });

      // prepareForRestart() は complete reset ではなく、restart 前の軽量な参照整理である。
      // clearInternalSubtitleState({ preserveSecondaryDom: true }) だけでは
      // panel render snapshot は消えないため、panel DOM を残す経路でも
      // 次回起動で古い描画結果を再利用しないようここで明示的に無効化する。
      state.primaryTrack = null;
      state.secondaryTrack = null;
      state.currentSubtitleBlock = null;
      state.subtitleBlockMeta = null;
      // panel render snapshot は restart 後に再計算させる。
      state.lastPanelRenderSnapshot = null;
      state.lastSecondarySyncContext = null;
      state.subtitleHistory = [];
      state.panelPastBlocks = [];
      state.subtitleBlocks = [];
      state.subtitleCurrentIndex = -1;

      const after = buildCleanupSnapshot();

      logContent?.("playback session prepare restart", {
        reason,
        toggleOpId,
        before,
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
     * @param {string} [reason="content_switch"] cleanup reason。
     */
    function resetForContentSwitch(reason = "content_switch") {
      if (isResettingForContentSwitch) {
        logContent?.("resetForContentSwitch reentry skipped", {
          reason,
          currentContentKey: state.currentContentKey,
          lastVideoSrcKey: state.lastVideoSrcKey,
        });
        return;
      }

      isResettingForContentSwitch = true;

      const before = buildCleanupSnapshot();

      try {
        stopPlaybackControlLayoutObservers?.();
        layoutController?.teardownPlaybackControlsUi?.();

        stopSecondaryTrackSyncInterval?.("content_switch");
        pauseSyncIntervalOrchestrator?.("content_switch");

        clearInitialCueRecovery?.();
        clearSecondaryTrackState();

        cueController?.handoffPrimarySubtitleToNative?.();
        cueController?.unbindSecondarySubtitleTrack?.({
          restoreMode: true,
          reason: "content_switch",
        });
        subtitleRecoveryManager?.dispose?.();

        overlayController?.clearOverlayState?.();
        disposePanelUi?.({ reason: "content_switch" });

        runtimeObservers?.stopAll?.();
        resetInitialAutoStartDelegation?.();

        clearInternalSubtitleState?.({
          preserveSecondaryDom: false,
          reason: "content_switch",
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

      logContent?.("playback session reset for content switch", {
        reason,
        previousVideoSrcKey: state.lastVideoSrcKey,
        currentContentKey: state.currentContentKey,
        before,
        after,
      });
    }

    /**
     * session UI clear 用の cleanup owner 入口。
     * close / navigation / hard reset など「今の playback session を完全終了する」用途で、
     * 再生 UI / observer / subtitle state を完全に外す。
     *
     * @param {string} [reason="clear_playback_session_ui_state"] cleanup reason。
     */
    function clearPlaybackSessionUiState(reason = "clear_playback_session_ui_state") {
      const before = buildCleanupSnapshot();

      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      stopSecondaryTrackSyncInterval?.(reason);
      pauseSyncIntervalOrchestrator?.(reason);

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({
        restoreMode: true,
        reason,
      });
      cueController?.destroy?.();
      subtitleRecoveryManager?.dispose?.();

      overlayController?.clearOverlayState?.();
      disposePanelUi?.({ reason });

      runtimeObservers?.stopAll?.();
      resetInitialAutoStartDelegation?.();

      clearInternalSubtitleState?.({
        preserveSecondaryDom: false,
        reason,
        completeReset: true,
      });

      state.primaryTrack = null;
      state.video = null;
      state.dialogEl = null;
      state.lastObservedVideoTime = null;
      state.currentContentKey = "";
      state.lastVideoSrcKey = "";

      const after = buildCleanupSnapshot();

      logContent?.("playback session ui state cleared", {
        reason,
        before,
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
     */
    function handleNavigationTargetMissing({
      reason = "navigation_target_missing",
      playbackContext = {},
    } = {}) {
      logContent?.("playback target missing after cleanup", {
        reason,
        previousVideoSrcKey: state.lastVideoSrcKey,
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
