(() => {
  const root = (window.ATVB = window.ATVB || {});

  function createSubtitleSyncController({
    state,
    logContent,
    cueController,
    renderSecondarySubtitle,
    getRequestedSecondaryLanguage,
    resolverDeps,
    getTrackActiveCuesLength,
    ensureSyncIntervalOrchestrator,
    onRecoveryNeeded,
  }) {
    let secondaryTrackSyncInterval = null;
    let lastLargeSeekAt = 0;

    function getSecondaryTrackDebugPayload(effectiveSecondaryLanguage, track) {
      return {
        effectiveSecondaryLanguage: effectiveSecondaryLanguage || "",
        selectedTrackLanguage: track?.language || "",
        cuesLength: resolverDeps.getTrackCuesLength(track),
        activeCuesLength: getTrackActiveCuesLength(track),
      };
    }

    function canReadCueFromTrack(track) {
      if (!track) return false;
      return track.mode === "hidden" || track.mode === "showing";
    }

    function notifyLargeSeek(at = Date.now()) {
      lastLargeSeekAt = Number(at) || Date.now();
    }

    function getTrackSnapshot(track) {
      return {
        exists: Boolean(track),
        language: track?.language || "",
        mode: track?.mode || "",
        cuesLength: (() => {
          try {
            return track?.cues?.length ?? 0;
          } catch (_) {
            return -1;
          }
        })(),
        activeCuesLength: (() => {
          try {
            return track?.activeCues?.length ?? 0;
          } catch (_) {
            return -1;
          }
        })(),
      };
    }

    function syncSecondarySubtitleTrackBinding(
      video,
      requestedLang,
      renderFn,
      options = {},
    ) {
      const forceRebind = options?.forceRebind === true;
      const suppressRender = options?.suppressRender === true;
      const previousTrack = state.secondaryTrack || null;
      const previousSnapshot = getTrackSnapshot(previousTrack);

      logContent("secondary track binding sync requested", {
        requestedLang: requestedLang || "",
        forceRebind,
        suppressRender,
        hasVideo: Boolean(video),
        previousTrackExists: previousSnapshot.exists,
        previousTrackLanguage: previousSnapshot.language,
        previousTrackMode: previousSnapshot.mode,
      });

      cueController.syncSecondarySubtitleTrack(
        video,
        requestedLang,
        renderFn,
        options,
      );

      const boundTrack = cueController.getBoundSecondaryTrack?.() || null;
      const boundSnapshot = getTrackSnapshot(boundTrack);

      logContent("secondary track binding sync finished", {
        requestedLang: requestedLang || "",
        forceRebind,
        suppressRender,
        previousTrackExists: previousSnapshot.exists,
        boundTrackExists: boundSnapshot.exists,
        sameTrackRef: Boolean(
          previousTrack && boundTrack && previousTrack === boundTrack,
        ),
        boundTrackLanguage: boundSnapshot.language,
        boundTrackMode: boundSnapshot.mode,
        boundTrackCuesLength: boundSnapshot.cuesLength,
        boundTrackActiveCuesLength: boundSnapshot.activeCuesLength,
      });

      return boundTrack;
    }

    function syncSecondarySubtitleTrack({
      reason = "unknown",
      forceRebind = false,
    } = {}) {
      const video = state.video;
      const requestedLang = getRequestedSecondaryLanguage();
      const previousTrack = state.secondaryTrack || null;
      const previousSnapshot = getTrackSnapshot(previousTrack);

      logContent("secondary track resync requested", {
        reason,
        forceRebind,
        requestedLang: requestedLang || "",
        hasVideo: Boolean(video),
        previousTrackExists: previousSnapshot.exists,
        previousTrackLanguage: previousSnapshot.language,
        previousTrackMode: previousSnapshot.mode,
        previousTrackCuesLength: previousSnapshot.cuesLength,
        previousTrackActiveCuesLength: previousSnapshot.activeCuesLength,
      });

      if (!video || !requestedLang) {
        logContent("secondary sync result: skipped before binding", {
          reason,
          forceRebind,
          requestedLang: requestedLang || "",
          hasVideo: Boolean(video),
        });
        return null;
      }

      try {
        syncSecondarySubtitleTrackBinding(
          video,
          requestedLang,
          renderSecondarySubtitle,
          {
            forceRebind,
            suppressRender: true,
          },
        );
      } catch (error) {
        logContent("secondary sync result: binding threw", {
          reason,
          forceRebind,
          requestedLang,
          message: String(error?.message || error || ""),
        });
        throw error;
      }

      state.secondaryTrack = cueController.getBoundSecondaryTrack?.() || null;
      const currentTrack = state.secondaryTrack;
      const currentSnapshot = getTrackSnapshot(currentTrack);

      if (!currentTrack) {
        logContent("secondary sync result: no track resolved (clearing)", {
          reason,
          forceRebind,
          requestedLang,
        });
      } else if (previousTrack !== currentTrack || forceRebind) {
        logContent("secondary sync result: track re-bound", {
          reason,
          forceRebind,
          requestedLang,
          trackLang: currentSnapshot.language,
          trackMode: currentSnapshot.mode,
          cuesLength: currentSnapshot.cuesLength,
          activeCuesLength: currentSnapshot.activeCuesLength,
        });
      } else {
        logContent("secondary sync result: same track (no re-bind needed)", {
          reason,
          forceRebind,
          requestedLang,
          trackLang: currentSnapshot.language,
          trackMode: currentSnapshot.mode,
          cuesLength: currentSnapshot.cuesLength,
          activeCuesLength: currentSnapshot.activeCuesLength,
        });
      }

      return currentTrack;
    }

    function runSyncIntervalTick() {
      const orchestrator = ensureSyncIntervalOrchestrator?.();

      logContent("sync interval tick", {
        restarting: state.restarting,
        hasSyncIntervalOrchestrator: Boolean(orchestrator),
        hasVideo: Boolean(state.video),
        requestedSecondaryLang: getRequestedSecondaryLanguage() || "",
        currentTime: Number(state.video?.currentTime ?? 0),
      });

      if (state.restarting) return;
      if (!orchestrator) return;

      orchestrator.refreshPlaybackContext();
      orchestrator.detectLargeSeek();

      // PR2 では notifyLargeSeek() を主経路にしつつ、
      // 既存 state.lastLargeSeekAt を fallback として維持する。
      // source of truth の一本化は state 境界整理（後続 PR）で行う。
      lastLargeSeekAt = Number(state.lastLargeSeekAt ?? lastLargeSeekAt ?? 0);

      const effectiveSecondaryLanguage = getRequestedSecondaryLanguage();
      if (!state.video || !effectiveSecondaryLanguage) return;

      const { now, hasSecondarySignal, hasPrimarySignal } =
        orchestrator.runSecondaryRecoveryPass(effectiveSecondaryLanguage);

      const trackCount = state.video?.textTracks?.length ?? 0;
      const shouldAttemptPrimaryRecovery =
        hasSecondarySignal && !hasPrimarySignal && trackCount > 1;

      if (!shouldAttemptPrimaryRecovery) {
        if (hasPrimarySignal) state.lastPrimaryRecoveryAttemptAt = 0;
        return;
      }

      if (
        state.lastPrimaryRecoveryAttemptAt &&
        now - state.lastPrimaryRecoveryAttemptAt < 4000
      ) {
        return;
      }

      state.lastPrimaryRecoveryAttemptAt = now;

      const recoveryResult =
        onRecoveryNeeded?.({
          reason: "syncintervalprimaryrecovery",
          now,
          trackCount,
          hasSecondarySignal,
          hasPrimarySignal,
          lastLargeSeekAt,
        }) ?? {};

      logContent("sync interval primary recovery", {
        trackCount,
        primaryTrackFound: recoveryResult.primaryTrackFound,
        secondaryTrackFound: recoveryResult.secondaryTrackFound,
        primaryListenerBound: recoveryResult.primaryListenerBound,
        secondaryListenerBound: recoveryResult.secondaryListenerBound,
      });

      if (recoveryResult.primaryTrackFound) {
        state.lastPrimaryRecoveryAttemptAt = 0;
      }
    }

    function ensureSecondaryTrackSyncInterval() {
      if (secondaryTrackSyncInterval) return;

      secondaryTrackSyncInterval = window.setInterval(() => {
        runSyncIntervalTick();
      }, 2000);
    }

    function clearSecondaryTrackSyncInterval() {
      if (!secondaryTrackSyncInterval) return;
      window.clearInterval(secondaryTrackSyncInterval);
      secondaryTrackSyncInterval = null;
    }

    return {
      getSecondaryTrackDebugPayload,
      canReadCueFromTrack,
      notifyLargeSeek,
      syncSecondarySubtitleTrackBinding,
      syncSecondarySubtitleTrack,
      runSyncIntervalTick,
      ensureSecondaryTrackSyncInterval,
      clearSecondaryTrackSyncInterval,
    };
  }

  root.subtitleSyncController = {
    createSubtitleSyncController,
  };
})();
