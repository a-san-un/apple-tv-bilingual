// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-session-cleanup.js
//
// 役割:
// - 再生セッションに紐づく一時的な UI 状態だけをクリアする。
// - popup / options で保存した設定値（primaryLang / secondaryLang / showSidebar など）は保持する。
//
// clearInternalSubtitleState の reason 使い分け:
//   "prepareForRestart" → 設定変更による再起動。パネルDOMはフラッシュ防止のため保持する。
//   "videoClose"        → 動画クローズ / セッション完全終了。パネルDOMも含めて全消去する。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

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
      destroyFeatureUiHosts,
      clearInternalSubtitleState,
      cueController,
      runtimeObservers,
    } = teardownDeps;

    // secondary track の参照と表示だけを消す。
    // contentSettings や requested settings には触らない。
    function clearSecondaryTrackState() {
      state.secondaryTrack = null;
      state.lastSecondarySyncContext = null;

      if (state.secondaryHideTimer) {
        clearTimeout(state.secondaryHideTimer);
        state.secondaryHideTimer = null;
      }

      renderSecondarySubtitle("", null);
    }

    // 再生中の overlay / panel / observer を停止し、
    // 現在の playback session にだけ紐づく表示資産を破棄する。
    //
    // primary: handoffPrimarySubtitleToNative() でネイティブ字幕に制御を返す。
    //   unbind 後に mode を直接書き込む二重制御は不要。
    // secondary: restoreMode: false で unbind のみ。
    //   teardown 時は secondary 字幕を消すことが目的なので
    //   unbindSecondarySubtitleTrack 内で secondaryTrackBound = null になれば十分。
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
    }

    function detachForDisabled() {
      stopPlaybackControlLayoutObservers?.();
      layoutController?.teardownPlaybackControlsUi?.();

      clearInitialCueRecovery?.();
      clearSecondaryTrackState();
      overlayController?.clearOverlayState?.();
      destroyOverlay?.();
      destroyFeatureUiHosts?.();

      runtimeObservers?.stopAll?.();

      cueController?.handoffPrimarySubtitleToNative?.();
      cueController?.unbindSecondarySubtitleTrack?.({ restoreMode: true });
    }

    // 字幕履歴や track 参照など、再生セッション由来の一時 state を初期化する。
    // ユーザー設定（contentSettings / requestedContentSettings / storage）は保持する。
    //
    // reason="prepareForRestart": 設定変更による再起動。
    //   パネルDOMはフラッシュ防止のため clearInternalSubtitleState 側でスキップされる。
    //   startBilingual() が直後に呼ばれて新しい字幕で上書きされることが前提。
    function prepareForRestart() {
      clearInternalSubtitleState?.({ preserveSecondaryDom: true });
      // ... state リセット（以下変更なし）
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

    // 動画 close / 再生終了 / 再初期化前に、
    // playback session にだけ紐づく UI 状態をまとめてクリアする。
    //
    // prepareForRestart() は reason="prepareForRestart" でパネルDOMを保持するが、
    // 動画クローズ時はその後 startBilingual が来ないため、
    // 直後に reason="videoClose" で明示的にパネルDOMも消去する。
    function clearPlaybackSessionUiState(reason = "playback_session_cleared") {
      logContent?.(reason, {
        previousVideoSrcKey: state.lastVideoSrcKey,
        currentContentKey: state.currentContentKey,
        preservedSettings: {
          primaryLang: state.contentSettings?.primaryLang || "",
          secondaryLang: state.contentSettings?.secondaryLang || "",
          showSidebar: state.contentSettings?.showSidebar,
          requestedSecondaryLang: state.requestedSecondaryLang || "",
        },
      });

      teardownForRestart();
      prepareForRestart();

      // prepareForRestart はパネルDOMをスキップするが、
      // 動画クローズ後は次の startBilingual が来ないため、
      // パネルとオーバーレイの残留字幕を確実に消去する。
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

    // Apple TV の playback dialog 内の close button クリックだけを検知する。
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

    // close button 監視は 1 回だけ登録する。
    // close 時は設定を残したまま playback UI state のみクリアする。
    function ensureCloseClickListener() {
      if (state.playbackCloseClickHandler) return;

      state.playbackCloseClickHandler = (event) => {
        if (!isPlaybackCloseButtonClick(event)) return;
        clearPlaybackSessionUiState("playback close button clicked");
      };

      document.addEventListener("click", state.playbackCloseClickHandler, true);
    }

    return {
      clearSecondaryTrackState,
      teardownForRestart,
      detachForDisabled,
      prepareForRestart,
      clearPlaybackSessionUiState,
      isPlaybackCloseButtonClick,
      ensureCloseClickListener,
    };
  }

  root.createPlaybackSessionCleanup = createPlaybackSessionCleanup;
})();