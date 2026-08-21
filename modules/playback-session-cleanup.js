// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-session-cleanup.js
//
// 役割:
// - 再生セッションに紐づく一時的な UI / observer / subtitle state を片付ける。
// - popup / options で保存した設定値
//   （primaryLang / secondaryLang / panelDefaultOpen / extensionEnabled など）は保持する。
// - restart 用 cleanup と extensionEnabled=false 用 cleanup を分け、
//   再起動時は再生成前提の撤収、OFF 時は再生画面の拡張 UI 完全破棄を担当する。
// - content switch 時の resetForContentSwitch() は、同一タイミングで重複して呼ばれても
//   teardown が壊れないよう最小限の再入ガードを持つ。
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
      destroyOverlay,
      destroyUiHosts,
      applyLayout,
      clearInternalSubtitleState,
      cueController,
      subtitleRecoveryManager,
      runtimeObservers,
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
    // teardown helpers
    // -------------------------------------------------------

    // restart 前に、現在の playback session に紐づく UI / observer をいったん撤収する。
    // 直後に startBilingual() で再生成する前提なので、字幕制御はネイティブへ戻すが
    // secondary track の mode 復元までは行わない。
    function teardownForRestart() {
      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();
      overlayController?.clearOverlayState?.();
      destroyOverlay?.();
      destroyUiHosts?.();

      runtimeObservers?.stopAll?.();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({ restoreMode: false });
      cueController?.destroy?.();
      subtitleRecoveryManager?.dispose?.();
    }

    // extensionEnabled=false 用の cleanup。
    // 再生画面に出していた拡張 UI を完全に外し、secondary subtitle の mode も元へ戻す。
    function detachForDisabled() {
      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();
      overlayController?.clearOverlayState?.();
      destroyOverlay?.();
      destroyUiHosts?.();

      runtimeObservers?.stopAll?.();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({ restoreMode: true });
      cueController?.destroy?.();
      subtitleRecoveryManager?.dispose?.();
    }

    // -------------------------------------------------------
    // restart preparation
    // -------------------------------------------------------

    // 再起動前に、再生セッション由来の一時 state だけを初期化する。
    // 保存済み設定は保持し、直後の startBilingual() で新しい字幕状態を積み直す前提で使う。
    function prepareForRestart() {
      clearInternalSubtitleState?.({
        preserveSecondaryDom: true,
        reason: "prepareForRestart",
      });

      state.primaryTrack = null;
      state.secondaryTrack = null;
      state.currentSubtitleBlock = null;
      state.subtitleBlockMeta = null;
      state.lastPanelRenderSnapshot = null;
      state.lastSecondarySyncContext = null;
      state.subtitleHistory = [];
      state.panelPastBlocks = [];
      state.subtitleBlocks = [];
      state.subtitleCurrentIndex = -1;
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
        logContent?.("resetForContentSwitch skipped (reentrant)", {
          reason,
          previousVideoSrcKey: state.lastVideoSrcKey,
          currentContentKey: state.currentContentKey,
        });
        return;
      }

      isResettingForContentSwitch = true;

      try {
        logContent?.(reason, {
          previousVideoSrcKey: state.lastVideoSrcKey,
          currentContentKey: state.currentContentKey,
          preservedSettings: {
            primaryLang: state.contentSettings?.primaryLang || "",
            secondaryLang: state.contentSettings?.secondaryLang || "",
            panelDefaultOpen: state.contentSettings?.panelDefaultOpen,
            requestedSecondaryLang: state.requestedSecondaryLang || "",
          },
        });

        teardownForRestart();
        prepareForRestart();

        // prepareForRestart は secondary DOM を残すので、
        // コンテンツ切替では旧エピソードの字幕残留を避けるため明示的に消す。
        clearInternalSubtitleState?.({
          preserveSecondaryDom: false,
          reason: "resetForContentSwitch",
        });

        state.video = null;
        state.dialogEl = null;
        state.lastObservedVideoTime = null;
        state.currentContentKey = "";
      } finally {
        isResettingForContentSwitch = false;
      }
    }

    // 動画クローズや再生終了時に、playback session 由来の UI と一時 state をまとめて消す。
    // 設定値は保持したまま、次の playback 開始時にクリーンな状態から再初期化できるようにする。
    function clearPlaybackSessionUiState(reason = "playback_session_cleared") {
      logContent?.(reason, {
        previousVideoSrcKey: state.lastVideoSrcKey,
        currentContentKey: state.currentContentKey,
        preservedSettings: {
          primaryLang: state.contentSettings?.primaryLang || "",
          secondaryLang: state.contentSettings?.secondaryLang || "",
          panelDefaultOpen: state.contentSettings?.panelDefaultOpen,
          requestedSecondaryLang: state.requestedSecondaryLang || "",
        },
      });

      teardownForRestart();
      prepareForRestart();

      // prepareForRestart は secondary DOM を残すので、
      // playback session 完全終了では panel / overlay の残留表示も含めて消す。
      clearInternalSubtitleState?.({
        preserveSecondaryDom: false,
        reason: "clearPlaybackSessionUiState",
      });

      state.video = null;
      state.dialogEl = null;
      state.lastObservedVideoTime = null;
      state.currentContentKey = "";
      state.lastVideoSrcKey = "";
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

  root.createPlaybackSessionCleanup = createPlaybackSessionCleanup;
})();
