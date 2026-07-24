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
        reloadSettingsAndReinitialize,
        debugPanelProbe,
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
      void reloadSettingsAndReinitialize;
      void debugPanelProbe;
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
        const found = getVideoAndDialog();
        const nextVideo = found?.video || state.video;
        const nextVideoSrcKey = getCurrentVideoSrcKey(nextVideo);
        const hasCurrentSrcChanged =
          Boolean(nextVideoSrcKey) &&
          Boolean(state.lastVideoSrcKey) &&
          nextVideoSrcKey !== state.lastVideoSrcKey;

        logContent("sync interval playback context", {
          hasFoundVideo: Boolean(found?.video),
          hasStateVideo: Boolean(state.video),
          sameVideoObject: Boolean(found?.video && found.video === state.video),
          previousVideoSrcKey: state.lastVideoSrcKey || "",
          nextVideoSrcKey: nextVideoSrcKey || "",
          hasCurrentSrcChanged,
          currentTime: Number(nextVideo?.currentTime ?? 0),
          lastObservedVideoTime: Number(state.lastObservedVideoTime),
        });

        if (hasCurrentSrcChanged) {
          logContent("currentSrc changed", {
            previousVideoSrcKey: state.lastVideoSrcKey,
            nextVideoSrcKey,
          });
        }

        if (found && (found.video !== state.video || hasCurrentSrcChanged)) {
          state.video = found.video;
          state.dialogEl = found.dialog;
          state.lastVideoSrcKey = nextVideoSrcKey;
          state.lastObservedVideoTime = null;
          reloadSettingsAndReinitialize?.("video_changed");
          return;
        }

        if (found && state.video) {
          const switched =
            syncHistoryContextWithPlayback("content_key_changed");
          if (switched) {
            renderCurrentSnapshot();
            renderPanel();
          }
        }
      }

      function detectLargeSeek() {
        const currentVideoTime = Number(state.video?.currentTime ?? 0);
        const previousObservedTime = Number(state.lastObservedVideoTime);
        const delta = Math.abs(currentVideoTime - previousObservedTime);
        const largeSeekDetected =
          Number.isFinite(previousObservedTime) &&
          Number.isFinite(currentVideoTime) &&
          delta > 3;

        logContent("large seek baseline", {
          previousObservedTime,
          currentVideoTime,
          delta,
          previousObservedTimeFinite: Number.isFinite(previousObservedTime),
          currentVideoTimeFinite: Number.isFinite(currentVideoTime),
          largeSeekDetected,
          lastLargeSeekAt: state.lastLargeSeekAt ?? 0,
        });

        state.lastObservedVideoTime = Number.isFinite(currentVideoTime)
          ? currentVideoTime
          : null;

        if (!largeSeekDetected) return;

        state.lastLargeSeekAt = Date.now();

        logContent("large seek detected", {
          previousObservedTime,
          currentVideoTime,
          delta,
          lastLargeSeekAt: state.lastLargeSeekAt,
          requestedSecondaryLang: state.requestedSecondaryLang || "",
          activeSecondaryLanguage: state.secondaryTrack?.language || "",
          textTrackCount: state.video?.textTracks?.length ?? 0,
        });

        panelUi.applyPanelState("sync_interval_large_seek_resync");
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
        const secondaryActiveCues =
          getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;
        const primaryActiveCues =
          getTrackActiveCuesLength?.(state.primaryTrack) ?? 0;
        const secondaryCueText =
          normalizeSubtitleText?.(
            getCurrentCueText?.(state.secondaryTrack),
          ) ?? "";
        const primaryCueText =
          normalizeSubtitleText?.(
            getCurrentCueText?.(state.primaryTrack),
          ) ?? "";
        const currentPrimaryText =
          normalizeSubtitleText?.(
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

        const secondaryTrackFoundBefore = Boolean(state.secondaryTrack);
        const secondaryActiveCuesLengthBefore =
          getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;

        runSecondaryResolverProbeIfNeeded({
          effectiveSecondaryLanguage,
          secondaryCueText,
        });

        logContent?.("secondary recovery trigger started", {
          effectiveSecondaryLanguage,
          secondaryTrackFoundBefore,
          secondaryActiveCuesLengthBefore,
          renderInvoked: false,
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

        const secondaryTrackFoundAfter = Boolean(state.secondaryTrack);
        const secondaryActiveCuesLengthAfter =
          getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;

        logContent?.("secondary recovery trigger finished", {
          effectiveSecondaryLanguage,
          secondaryTrackFoundBefore,
          secondaryTrackFoundAfter,
          secondaryActiveCuesLengthBefore,
          secondaryActiveCuesLengthAfter,
          renderInvoked: true,
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
        const millisSinceLargeSeek =
          state.lastLargeSeekAt > 0 ? now - state.lastLargeSeekAt : null;

        logContent?.("secondary recovery pass started", {
          effectiveSecondaryLanguage,
          currentTime: Number(state.video?.currentTime ?? 0),
          lastLargeSeekAt: state.lastLargeSeekAt ?? null,
          millisSinceLargeSeek,
          hasVideo: Boolean(state.video),
          textTrackCount: state.video?.textTracks?.length ?? 0,
          hasPrimaryTrackObject: Boolean(state.primaryTrack),
          hasSecondaryTrackObject: Boolean(state.secondaryTrack),
        });

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
          }) ?? {
            action: "idle",
            reason: "orchestrator_unavailable",
            secondaryLane: null,
          };

        if (recoveryDecision.action !== "idle") {
          const millisSinceLastRecovery =
            recoveryDecision.secondaryLane?.lastRecoveredAt > 0
              ? now - recoveryDecision.secondaryLane.lastRecoveredAt
              : null;

          logContent?.("secondary recovery action evaluated", {
            hasPrimarySignal,
            hasSecondarySignal,
            shouldRecover:
              recoveryDecision.action === "recover" ||
              recoveryDecision.action === "force-rebind",
            reason: recoveryDecision.reason,
            cooldownActive:
              recoveryDecision.reason === "secondary_cooldown_active",
            millisSinceLastRecovery,
            millisSinceLargeSeek,
            action: recoveryDecision.action,
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

      return {
        refreshPlaybackContext,
        detectLargeSeek,
        runSecondaryRecoveryPass,
      };
    };
})();