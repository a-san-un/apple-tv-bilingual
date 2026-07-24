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
      function buildSecondarySyncLogPayload({
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth = null,
        extra = {},
      }) {
        return {
          effectiveSecondaryLanguage,
          trackCount: state.video?.textTracks?.length ?? 0,
          primaryTrackFound: Boolean(state.primaryTrack),
          secondaryTrackFound: Boolean(state.secondaryTrack),
          secondaryTrackLanguage: state.secondaryTrack?.language || "",
          secondaryActiveCues,
          primaryActiveCues,
          currentSecondaryTextLength: secondaryCueText.length,
          primaryCueTextLength: primaryCueText.length,
          currentPrimaryTextLength: currentPrimaryText.length,
          hasFreshCurrentPrimary,
          mergedPrimaryHealthy:
            mergedSubtitleHealth?.derived?.primaryHealthy ?? null,
          mergedSecondaryHealthy:
            mergedSubtitleHealth?.derived?.secondaryHealthy ?? null,
          mergedShouldRecoverSecondary:
            mergedSubtitleHealth?.derived?.shouldRecoverSecondary ?? null,
          mergedShouldForceSecondaryRebind:
            mergedSubtitleHealth?.derived?.shouldForceSecondaryRebind ?? null,
          secondaryRecoveryMissCount:
            cueController?.getLaneStates?.()?.secondary?.missCount ?? null,
          ...extra,
        };
      }

      function buildSyncIntervalSubtitleSnapshot(now) {
        const secondaryActiveCues = getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;
        const primaryActiveCues = getTrackActiveCuesLength?.(state.primaryTrack) ?? 0;
        const secondaryCueText = normalizeSubtitleText?.(
          getCurrentCueText?.(state.secondaryTrack),
        ) ?? "";
        const primaryCueText = normalizeSubtitleText?.(
          getCurrentCueText?.(state.primaryTrack),
        ) ?? "";
        const currentPrimaryText = normalizeSubtitleText?.(
          state.currentSubtitleBlock?.primaryText || state.lastPrimaryText || "",
        ) ?? "";
        const hasPrimaryLiveSignal =
          primaryActiveCues > 0 || Boolean(primaryCueText);
        const hasFreshCurrentPrimary =
          Boolean(currentPrimaryText) &&
          state.lastCurrentSubtitleBlockAt > 0 &&
          now - state.lastCurrentSubtitleBlockAt <= 3000;
        const hasSecondarySignal =
          secondaryActiveCues > 0 || Boolean(secondaryCueText);
        const hasPrimarySignal = hasPrimaryLiveSignal || hasFreshCurrentPrimary;

        return {
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasPrimaryLiveSignal,
          hasFreshCurrentPrimary,
          hasSecondarySignal,
          hasPrimarySignal,
          mergedSubtitleHealth: getMergedSubtitleHealthSnapshot?.() ?? null,
        };
      }

      function logSecondarySyncContextIfNeeded({
        previousSecondaryTrack,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
      }) {
        const syncContextSummary = JSON.stringify({
          trackCount: state.video?.textTracks?.length ?? 0,
          primaryTrackFound: Boolean(state.primaryTrack),
          secondaryTrackFound: Boolean(state.secondaryTrack),
          secondaryTrackLanguage: state.secondaryTrack?.language || "",
          secondaryActiveCues,
          primaryActiveCues,
          primaryCueTextLength: primaryCueText.length,
          currentPrimaryTextLength: currentPrimaryText.length,
          hasFreshCurrentPrimary,
        });

        const shouldLogSyncContext =
          previousSecondaryTrack !== state.secondaryTrack ||
          syncContextSummary !== state.lastSecondarySyncContext;

        if (!shouldLogSyncContext) return;

        state.lastSecondarySyncContext = syncContextSummary;
        logContent?.(
          "secondary track sync context",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueText,
            primaryCueText,
            currentPrimaryText,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              reason: "sync_interval",
            },
          }),
        );
      }

      function logSecondaryRecoveryTermination({
        recoveryDecision,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
      }) {
        if (recoveryDecision.action !== "terminated") return;

        logContent?.(
          "secondary recovery terminated",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueText,
            primaryCueText,
            currentPrimaryText,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              reason: "sync_interval",
              missCount: recoveryDecision.secondaryLane.missCount,
            },
          }),
        );
      }

      function runSecondaryResolverProbeIfNeeded({
        effectiveSecondaryLanguage,
        secondaryCueText,
      }) {
        if (!debugPanelProbe) return;

        const secondaryCandidates =
          resolverDeps?.getSecondarySubtitleTrackCandidates?.(
            state.video,
            effectiveSecondaryLanguage,
          ) ?? [];
        const resolvedSecondaryTrack =
          resolverDeps?.resolveSecondarySubtitleTrack?.(
            state.video,
            effectiveSecondaryLanguage,
          ) ?? null;

        logContent?.("secondary resolver probe", {
          reason: "sync_interval",
          effectiveSecondaryLanguage,
          currentSecondaryTrackLanguage: state.secondaryTrack?.language || "",
          currentSecondaryTrackKind: state.secondaryTrack?.kind || "",
          currentSecondaryTrackMode: state.secondaryTrack?.mode || "",
          currentSecondaryCuesLength:
            resolverDeps?.getTrackCuesLength?.(state.secondaryTrack) ?? 0,
          currentSecondaryActiveCuesLength:
            getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0,
          currentSecondaryCueTextLength: secondaryCueText.length,
          resolvedSecondaryTrackLanguage: resolvedSecondaryTrack?.language || "",
          resolvedSecondaryTrackKind: resolvedSecondaryTrack?.kind || "",
          resolvedSecondaryTrackMode: resolvedSecondaryTrack?.mode || "",
          resolvedSecondaryCuesLength:
            resolverDeps?.getTrackCuesLength?.(resolvedSecondaryTrack) ?? 0,
          resolvedSecondaryActiveCuesLength:
            getTrackActiveCuesLength?.(resolvedSecondaryTrack) ?? 0,
          resolvedSecondaryCueTextLength:
            normalizeSubtitleText?.(
              getCurrentCueText?.(resolvedSecondaryTrack),
            )?.length ?? 0,
          secondaryCandidates,
        });
      }

      function triggerSecondaryRecovery({
        recoveryDecision,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
      }) {
        if (
          recoveryDecision.action !== "recover" &&
          recoveryDecision.action !== "force-rebind"
        ) {
          return;
        }

        runSecondaryResolverProbeIfNeeded({
          effectiveSecondaryLanguage,
          secondaryCueText,
        });

        logContent?.(
          "secondary recovery trigger",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueText,
            primaryCueText,
            currentPrimaryText,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              reason: "sync_interval",
              missCount: recoveryDecision.secondaryLane.missCount,
              forceRebind: recoveryDecision.action === "force-rebind",
              terminated: recoveryDecision.secondaryLane.terminated,
              missLimitReached: recoveryDecision.action === "terminated",
            },
          }),
        );

        syncSecondarySubtitleTrack?.({
          reason: recoveryDecision.reason,
          forceRebind: recoveryDecision.action === "force-rebind",
        });
      }

      function runSecondaryRecoveryPass(effectiveSecondaryLanguage) {
        const previousSecondaryTrack = state.secondaryTrack;
        syncSecondarySubtitleTrackBinding?.(
          state.video,
          effectiveSecondaryLanguage,
          renderSecondarySubtitle,
          { suppressRender: true },
        );
        state.secondaryTrack = cueController?.getBoundSecondaryTrack?.() ?? null;

        const now = Date.now();
        const {
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          hasSecondarySignal,
          hasPrimarySignal,
          mergedSubtitleHealth,
        } = buildSyncIntervalSubtitleSnapshot(now);

        logSecondarySyncContextIfNeeded({
          previousSecondaryTrack,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
        });

        const recoveryDecision =
          cueController?.evaluateSecondaryRecovery?.({
            now,
            runtime: {
              primaryTrackFound: Boolean(state.primaryTrack),
              secondaryTrackFound: Boolean(state.secondaryTrack),
              primaryActiveCues,
              secondaryActiveCues,
            },
            currentCue: {
              primaryTextLength: primaryCueText.length,
              secondaryTextLength: secondaryCueText.length,
              currentPrimaryTextLength: currentPrimaryText.length,
              hasFreshCurrentPrimary,
            },
            sequence: mergedSubtitleHealth?.sequence || null,
            derived: mergedSubtitleHealth?.derived || null,
          }) ?? { action: "idle", reason: "orchestrator_unavailable", secondaryLane: null };

        if (recoveryDecision.action !== "idle") {
          logContent?.("secondary recovery action evaluated", {
            action: recoveryDecision.action,
            reason: recoveryDecision.reason,
            missCount: recoveryDecision.secondaryLane?.missCount ?? null,
          });
        }

        logSecondaryRecoveryTermination({
          recoveryDecision,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
        });

        triggerSecondaryRecovery({
          recoveryDecision,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
        });

        return {
          now,
          hasSecondarySignal,
          hasPrimarySignal,
        };
      }
    };
})();