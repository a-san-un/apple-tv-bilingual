// =============================================================
// Apple TV+ Bilingual Subtitles - reinitialize-coordinator.js
// version: 2.6.3
// 役割: subtitle pipeline の再初期化フローを coordinator としてまとめる。
// Phase J / Issue #32: entry / retry / settings-result bridge を 1 塊で外出しし、
// content.js をイベント入口と重い実装詳細に寄せる。
// =============================================================

(function () {
  function createReinitializeCoordinator(deps) {
    const {
      state,
      panelUi,
      loadSettingsSnapshot,
      getVideoAndDialog,
      getCurrentVideoSrcKey,
      syncHistoryContextWithPlayback,
      clearInternalSubtitleState,
      selectPrimaryAndSecondaryTracks,
      TRACK_RESOLVE_RETRY_DELAYS_MS,
      logContent,
      logContentSubtitle,
      logContentError,
    } = deps;

    // -----------------------------------------------------------------------------
    // Retry timer ownership
    // track resolve retry timer の所有者はこの coordinator。
    // detach 側からも cleanup できるよう public API に出す。
    // -----------------------------------------------------------------------------
    function clearTrackResolveRetryTimers() {
      if (!state.trackResolveRetryTimers.length) return;
      state.trackResolveRetryTimers.forEach((timerId) => clearTimeout(timerId));
      state.trackResolveRetryTimers = [];
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Flow Coordinator
    // 再初期化フロー本体。状態クリア → track 再解決 → listener 再接続 →
    // panel 反映までの手順を束ねる。
    // 判定本体や resolver / binder の実装詳細は deps 側へ委譲する。
    // -----------------------------------------------------------------------------
    function reinitializeSubtitlePipeline(reason = "unknown") {
      const switched = syncHistoryContextWithPlayback(reason);
      clearInternalSubtitleState(reason);

      const effectiveSecondaryLanguage =
        state.requestedSecondaryLang || state.contentSettings.secondaryLang;

      const trackSelection = selectPrimaryAndSecondaryTracks(
        state.video,
        state.contentSettings.primaryLang,
        effectiveSecondaryLanguage,
        reason,
      );

      const primaryTrackFound = trackSelection.primaryTrackFound;
      const secondaryTrackFound = trackSelection.secondaryTrackFound;
      const primaryListenerBound = trackSelection.primaryListenerBound;
      const secondaryListenerBound = trackSelection.secondaryListenerBound;

      logContentSubtitle("tracks resolved", {
        reason,
        switchedHistoryContext: switched,
        primaryTrackFound,
        secondaryTrackFound,
        trackCount: trackSelection.trackCount,
        primaryTrack: trackSelection.primaryTrack,
        secondaryTrack: trackSelection.secondaryTrack,
      });

      logContentSubtitle("cuechange listeners rebound", {
        reason,
        primaryListenerBound,
        secondaryTrackBound: secondaryListenerBound,
      });

      // panel 反映も coordinator から起動するが、
      // 実 UI 更新の詳細は panelUi 側に残す。
      panelUi.applyPanelState(reason);

      logContent("panel state reapplied", {
        reason,
        contentKey: state.currentContentKey,
        panelVisible: state.panelVisible,
      });

      return {
        reason,
        primaryTrackFound,
        secondaryTrackFound,
        primaryListenerBound,
        secondaryListenerBound,
        ready:
          primaryTrackFound &&
          secondaryTrackFound &&
          primaryListenerBound &&
          secondaryListenerBound,
      };
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Entry Points
    // 現在の playback context を取り直し、coordinator 本体へ渡すための入口。
    // video / dialog 更新だけを担当し、再初期化ルール自体は持たない。
    // -----------------------------------------------------------------------------
    function refreshPlaybackContextForReinitialize() {
      const found = getVideoAndDialog();

      if (found) {
        state.video = found.video;
        state.dialogEl = found.dialog;
      }

      if (!state.video) return false;

      state.lastVideoSrcKey = getCurrentVideoSrcKey(state.video);
      return true;
    }

    function runReinitializeFromCurrentPlayback(reason = "unknown") {
      if (!refreshPlaybackContextForReinitialize()) return null;
      return reinitializeSubtitlePipeline(reason);
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Retry Control
    // video_changed 後に track 解決が遅れるケースだけを対象に、
    // retry 間隔とタイマーのライフサイクルを管理する。
    // retry 条件の判定本体は持ち込まず、再試行の orchestration に限定する。
    // -----------------------------------------------------------------------------
    function scheduleTrackResolveRetry(reason = "video_changed") {
      clearTrackResolveRetryTimers();

      logContentSubtitle("track resolve retry scheduled", {
        reason,
        retryDelaysMs: TRACK_RESOLVE_RETRY_DELAYS_MS,
      });

      TRACK_RESOLVE_RETRY_DELAYS_MS.forEach((delayMs, retryIndex) => {
        const timerId = window.setTimeout(() => {
          if (state.restarting || !state.video) return;

          const attempt = retryIndex + 1;

          logContentSubtitle("track resolve retry attempt", {
            reason,
            attempt,
            delayMs,
          });

          const retryResult = runReinitializeFromCurrentPlayback(
            `${reason}:retry_${attempt}`,
          );

          if (!retryResult) return;

          if (retryResult.ready) {
            logContentSubtitle("track resolve retry success", {
              reason,
              attempt,
            });
            clearTrackResolveRetryTimers();
            return;
          }

          if (attempt === TRACK_RESOLVE_RETRY_DELAYS_MS.length) {
            logContentError("track resolve retry exhausted", {
              reason,
              attempts: TRACK_RESOLVE_RETRY_DELAYS_MS.length,
              primaryTrackFound: retryResult.primaryTrackFound,
              secondaryTrackFound: retryResult.secondaryTrackFound,
              primaryListenerBound: retryResult.primaryListenerBound,
              secondaryListenerBound: retryResult.secondaryListenerBound,
            });
            clearTrackResolveRetryTimers();
          }
        }, delayMs);

        state.trackResolveRetryTimers.push(timerId);
      });
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Settings & Result Bridge
    // settings snapshot の state 反映と、再初期化結果の後処理を橋渡しする。
    // content.js に残すのはイベント入口で、reload → reflect → reinitialize の
    // 手順はこの coordinator に寄せる。
    // -----------------------------------------------------------------------------
    function applyVideoChangedReinitializeResult(result) {
      if (!result) return;

      if (result.ready) {
        clearTrackResolveRetryTimers();
      } else {
        scheduleTrackResolveRetry("video_changed");
      }
    }

    function applyReinitializeResult(result, reason = "unknown") {
      if (reason === "video_changed") {
        applyVideoChangedReinitializeResult(result);
      }
    }

    // settings 読込結果を state へ反映するだけの薄い bridge。
    function applySettingsSnapshotToState(snapshot) {
      state.requestedContentSettings = {
        ...(snapshot.storedSettings || {}),
      };
      state.requestedSecondaryLang = snapshot.requestedSecondaryLang || "";
      state.contentSettings = { ...snapshot.effectiveSettings };
    }

    // settings reload → state reflect → reinitialize 起動の橋渡し。
    function reloadSettingsAndReinitialize(reason = "unknown") {
      if (state.restarting) return;

      loadSettingsSnapshot(reason)
        .then((snapshot) => {
          applySettingsSnapshotToState(snapshot);

          const result = runReinitializeFromCurrentPlayback(reason);
          applyReinitializeResult(result, reason);
        })
        .catch((error) => {
          logContentError("settings load failed", {
            reason,
            error: String(error),
          });
        });
    }

    return {
      clearTrackResolveRetryTimers,
      reinitializeSubtitlePipeline,
      reloadSettingsAndReinitialize,
    };
  }

  window.ATVB = window.ATVB || {};
  window.ATVB.createReinitializeCoordinator = createReinitializeCoordinator;
})();
