// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-session-cleanup.js
//
// 役割:
// - 再生セッションに紐づく一時的な UI / observer / subtitle state を片付ける。
// - popup / options で保存した設定値
//   （primaryLang / secondaryLang / panelDefaultOpen / extensionEnabled など）は保持する。
// - restart 用 cleanup と extensionEnabled=false 用 cleanup を分け、
//   再起動時は再生成前提の撤収、OFF 時は再生画面の拡張 UI 完全破棄を担当する。
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

    // SPA で別コンテンツへ切り替わるときの cleanup。
    // 設定は保持したまま、旧 playback session に紐づく UI / track / subtitle state を撤収する。
    // clearPlaybackSessionUiState よりは「次の再生へすぐ繋ぐ前提」の軽い cleanup として扱う。
    function resetForContentSwitch(reason = "content_switch") {
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
      // 動画クローズ後はここで残留字幕を明示的に消す。
      clearInternalSubtitleState?.({ preserveSecondaryDom: false });

      state.video = null;
      state.dialogEl = null;
      state.lastVideoSrcKey = "";
      state.lastObservedVideoTime = null;
      state.currentContentKey = "";

      // 設定保持:
      // - state.contentSettings は消さない
      // - state.requestedContentSettings は消さない
      // - chrome.storage.sync は触らない
    }

    // playback target が一時的に見つからないときに、残っていた UI を外して layout を戻す。
    // URL 遷移や dialog 差し替え直後の中間状態で使う。
    function handleNavigationTargetMissing({
      reason = "navigation_target_missing",
      url = "",
      playbackContext = null,
    } = {}) {
      destroyUiHosts?.();
      applyLayout?.(false);

      logContent?.("navigation changed: playback target not ready yet", {
        reason,
        url,
        ...(playbackContext || {}),
      });
    }

    // Apple TV の playback dialog 内の close button クリックかどうかだけを判定する。
    // 他の button クリックでは cleanup しない。
    function isPlaybackCloseButtonClick(event) {
      const path =
        typeof event?.composedPath === "function" ? event.composedPath() : [];

      const closeButton = path.find(
        (el) =>
          el instanceof Element &&
          String(el.tagName || "").toUpperCase() === "BUTTON" &&
          el.getAttribute("data-testid") === "close-button" &&
          el.getAttribute("aria-label") === "閉じる",
      );

      const playbackDialog = path.find(
        (el) =>
          el instanceof Element &&
          String(el.tagName || "").toUpperCase() === "DIALOG" &&
          el.getAttribute("data-testid") === "playback-view",
      );

      return Boolean(closeButton && playbackDialog);
    }

    // close button 監視を 1 回だけ登録する。
    // close 時は設定を残しつつ playback session 由来 state だけを消す。
    function ensureCloseClickListener() {
      if (state.playbackCloseClickHandler) return;

      state.playbackCloseClickHandler = (event) => {
        if (!isPlaybackCloseButtonClick(event)) return;
        clearPlaybackSessionUiState("playback close button clicked");
      };

      document.addEventListener("click", state.playbackCloseClickHandler, true);
    }

    // settings-runtime や他モジュールから使う cleanup 関数群を返す。
    return {
      clearSecondaryTrackState,
      teardownForRestart,
      detachForDisabled,
      prepareForRestart,
      clearPlaybackSessionUiState,
      resetForContentSwitch,
      handleNavigationTargetMissing,
      isPlaybackCloseButtonClick,
      ensureCloseClickListener,
    };
  }

  // cleanup factory を ATVB 名前空間へ公開する。
  root.createPlaybackSessionCleanup = createPlaybackSessionCleanup;
})();
