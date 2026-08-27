// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-session-cleanup.js
//
// 役割:
// - 再生セッションに紐づく一時的な UI / observer / subtitle state を片付ける。
// - popup / options で保存した永続設定
//   （primaryLang / secondaryLang / panelDefaultOpen など）は保持する。
// - runtime state の extensionEnabled はこの cleanup では保存・復元せず、
//   呼び出し元の state.extensionEnabled を前提に teardown だけを担当する。
// - restart 用 cleanup と extension OFF 用 cleanup を分け、
//   再起動時は再生成前提の撤収、OFF 時は再生画面の拡張 UI 完全破棄を担当する。
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

  // 再生セッション終了・再起動・無効化で使う cleanup 関数群を生成する。
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
      stopSecondaryTrackSyncInterval,
      pauseSyncIntervalOrchestrator,
    } = teardownDeps;

    // resetForContentSwitch() の同期的な再入だけを防ぐフラグ。
    // 同一旧セッションへの cleanup 一度化そのものは
    // playback-startup-coordinator.js 側で行い、
    // ここでは「呼ばれても壊れない」ための保険に留める。
    let isResettingForContentSwitch = false;

    // -------------------------------------------------------
    // 小さな state cleanup
    // -------------------------------------------------------

    // secondary track の参照と表示だけを消す。
    // 設定値や requested settings には触らない。
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

    // cleanup 前後ログ用に、現在の playback session 周辺 state を
    // 軽量スナップショット化する。
    // 生の DOM / track をそのまま出さず、保持有無と件数を中心に返す。
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

    // cleanup 開始 / 終了ログを揃った形式で出す。
    // toggleOpId がある場合は OFF 側相関ログとしてそのまま流せるようにする。
    function logCleanupPhase(phase, payload = {}) {
      logContent?.(`playback session cleanup ${phase}`, payload);
    }

    // teardown 共通本体。
    // restart / disabled で共通な撤収処理をまとめ、mode restore や
    // complete reset の有無だけをオプションで切り替える。
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

    // restart 前に、現在の playback session に紐づく UI / observer をいったん撤収する。
    // 直後に startBilingual() で再生成する前提なので、字幕制御はネイティブへ戻すが
    // secondary track の mode 復元までは行わない。
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

    // extensionEnabled=false 用の cleanup。
    // 再生画面に出していた拡張 UI を完全に外し、secondary subtitle の mode も元へ戻す。
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
    // restart preparation
    // -------------------------------------------------------

    // 再起動前に、再生セッション由来の一時 state だけを初期化する。
    // 保存済み設定は保持し、直後の startBilingual() で新しい字幕状態を積み直す前提で使う。
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
    // session cleanup
    // -------------------------------------------------------

    // SPA で別コンテンツへ切り替わるときの cleanup。
    // 設定は保持したまま、旧 playback session に紐づく UI / track / subtitle state を撤収する。
    // clearPlaybackSessionUiState よりは「次の再生へすぐ繋ぐ前提」の軽い cleanup として扱う。
    //
    // ここでは同期的な再入だけを防ぎ、
    // 同一旧セッションへの cleanup 一度化そのものは coordinator 側に任せる。
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

        clearInternalSubtitleState?.({
          preserveSecondaryDom: false,
          reason: "content_switch",
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

    // 再生 UI と字幕 state を完全に外す。
    // close / navigation / hard reset など「今の playback session を完全終了する」用途。
    function clearPlaybackSessionUiState(reason = "clear_playback_session_ui_state") {
      const before = buildCleanupSnapshot();

      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

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

      clearInternalSubtitleState?.({
        preserveSecondaryDom: false,
        reason,
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

    // navigation 直後に新しい playback target がまだ見つからないときの後始末。
    // UI はすでに resetForContentSwitch() 済みの想定なので、ここでは参照系を空に寄せる。
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
    // layout reset
    // -------------------------------------------------------

    // 再生 UI teardown 後に layout を標準状態へ戻す。
    // 拡張 UI の残骸を避けるため、最後に一度だけ呼ぶ用途を想定する。
    function restoreDefaultLayout() {
      applyLayout?.({
        panelOpen: false,
        forceOverlayHidden: true,
      });
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------

    return {
      teardownForRestart,
      detachForDisabled,
      prepareForRestart,
      resetForContentSwitch,
      clearPlaybackSessionUiState,
      handleNavigationTargetMissing,
      restoreDefaultLayout,
    };
  }

  // -------------------------------------------------------
  // エクスポート
  // -------------------------------------------------------
  root.createPlaybackSessionCleanup = createPlaybackSessionCleanup;
})();
