// sync-interval-orchestrator.js
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  window.ATVB.createSyncIntervalOrchestrator =
    function createSyncIntervalOrchestrator({
      state,
      controllers = {},
      services = {},
    }) {
      const { cueController } = controllers;

      const {
        logContent,
        getVideoAndDialog,
        getCurrentVideoSrcKey,
        syncHistoryContextWithPlayback,
        renderCurrentSnapshot,
        renderPanel,
        getTrackActiveCuesLength,
        getCurrentCueText,
        normalizeSubtitleText,
        getMergedSubtitleHealthSnapshot,
        syncSecondarySubtitleTrackBinding,
        syncSecondarySubtitleTrack,
        renderSecondarySubtitle,
        resolverDeps,
        panelUi,
      } = services;

      void state;
      void cueController;
      void logContent;
      void getVideoAndDialog;
      void getCurrentVideoSrcKey;
      void syncHistoryContextWithPlayback;
      void renderCurrentSnapshot;
      void renderPanel;
      void getTrackActiveCuesLength;
      void getCurrentCueText;
      void normalizeSubtitleText;
      void getMergedSubtitleHealthSnapshot;
      void syncSecondarySubtitleTrackBinding;
      void syncSecondarySubtitleTrack;
      void renderSecondarySubtitle;
      void resolverDeps;
      void panelUi;

      function refreshPlaybackContext() {
        return null;
      }

      function detectLargeSeek() {
        const currentVideoTime = Number(state.video?.currentTime ?? 0);
        const previousObservedTime = Number(state.lastObservedVideoTime);

        const largeSeekDetected =
            Number.isFinite(previousObservedTime) &&
            Number.isFinite(currentVideoTime) &&
            Math.abs(currentVideoTime - previousObservedTime) > 6;

        state.lastObservedVideoTime = Number.isFinite(currentVideoTime)
            ? currentVideoTime
            : null;

        if (!largeSeekDetected) return;

        state.lastLargeSeekAt = Date.now();
        logContent?.("large seek detected", {
            previousObservedTime,
            currentVideoTime,
            delta: Math.abs(currentVideoTime - previousObservedTime),
        });
        panelUi?.applyPanelState?.("sync_interval_large_seek_resync");
      }

      function runSecondaryRecoveryPass(effectiveSecondaryLanguage) {
        void effectiveSecondaryLanguage;

        return {
          now: Date.now(),
          hasSecondarySignal: false,
          hasPrimarySignal: false,
        };
      }

      return {
        refreshPlaybackContext,
        detectLargeSeek,
        runSecondaryRecoveryPass,
      };
    };
})();