(() => {
  const root = (window.ATVB = window.ATVB || {});

  function createCueController({
    state,
    logContent,
    DEBUG_SECONDARY_SUBS,
    getSecondaryTrackDebugPayload,
    resolveSecondarySubtitleTrack,
    getCurrentCueText,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    getRequestedSecondaryLanguage,
    getPrimaryTrack,
    getSecondaryTrack,
    getCurrentCue,
    cleanCueText,
    getCurrentTime,
    getPrimaryTrackCues,
    getSecondaryTrackCues,
    getPreviousSubtitleBlocks,
    setSubtitleBlocks,
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence,
    setCurrentSubtitleBlock,
    DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    updateOverlay,
    updateOverlayFromView,
    updateOverlayFromBlock,
    renderPanel,
  }) {
    let secondaryTrackCleanup = null;
    let secondaryTrackBound = null;
    let lastMergedSubtitleHealth = null;

    const SECONDARY_RECOVERY_WINDOW_MS = 1000;
    const SECONDARY_FORCE_REBIND_MISS_COUNT = 2;
    const SECONDARY_RECOVERY_MISS_LIMIT = 8;

    function createLaneState(lane) {
      return {
        lane,
        healthy: false,
        isMissing: false,
        missingSince: 0,
        missingDurationMs: 0,
        missCount: 0,
        terminated: false,
        lastDecision: "idle",
      };
    }

    const laneStates = {
      primary: createLaneState("primary"),
      secondary: createLaneState("secondary"),
    };

    function resetLaneState(laneState) {
      laneState.isMissing = false;
      laneState.missingSince = 0;
      laneState.missingDurationMs = 0;
      laneState.missCount = 0;
      laneState.terminated = false;
      laneState.lastDecision = "idle";
    }

    function updateLaneState(laneState, { now, healthy, isMissing }) {
      laneState.healthy = healthy === true;
      laneState.isMissing = isMissing === true;

      if (!laneState.isMissing) {
        laneState.missingSince = 0;
        laneState.missingDurationMs = 0;
        laneState.missCount = 0;
        laneState.terminated = false;
        laneState.lastDecision = "idle";
        return laneState;
      }

      if (!laneState.missingSince) {
        laneState.missingSince = now;
      }

      laneState.missingDurationMs = Math.max(0, now - laneState.missingSince);
      return laneState;
    }

    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence,
      derived,
    }) {
      const primaryLane = updateLaneState(laneStates.primary, {
        now,
        healthy: derived?.primaryHealthy === true,
        isMissing: false,
      });

      const secondaryRuntimeMissing =
        currentCue?.hasFreshCurrentPrimary === true &&
        currentCue?.secondaryTextLength === 0 &&
        runtime?.secondaryTrackFound === true &&
        runtime?.secondaryActiveCues === 0;

      const secondarySequenceMissing =
        sequence?.currentPairMissingSecondary === true;

      const secondaryRecovered =
        runtime?.secondaryTrackFound === true &&
        runtime?.secondaryActiveCues > 0;

      const secondaryLane = updateLaneState(laneStates.secondary, {
        now,
        healthy: secondaryRecovered,
        isMissing: secondaryRuntimeMissing,
      });

      if (secondaryRecovered) {
        resetLaneState(secondaryLane);
      }

      if (!secondaryLane.isMissing) {
        secondaryLane.lastDecision = "idle";
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_not_missing",
        };
      }

      if (secondaryLane.terminated) {
        secondaryLane.lastDecision = "terminated";
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_terminated",
        };
      }

      const shouldRecoverSecondary =
        secondaryLane.missingDurationMs >= SECONDARY_RECOVERY_WINDOW_MS &&
        (
          derived?.shouldRecoverSecondary === true ||
          derived?.primaryHealthy === true
        );

      if (!shouldRecoverSecondary) {
        secondaryLane.lastDecision = "idle";
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_missing_waiting_window",
        };
      }

      secondaryLane.missCount += 1;

      if (secondaryLane.missCount >= SECONDARY_RECOVERY_MISS_LIMIT) {
        secondaryLane.terminated = true;
        secondaryLane.lastDecision = "terminated";
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_miss_limit",
        };
      }

      const shouldForceSecondaryRebind =
        derived?.shouldForceSecondaryRebind === true ||
        secondaryLane.missCount >= SECONDARY_FORCE_REBIND_MISS_COUNT;

      secondaryLane.lastDecision = shouldForceSecondaryRebind
        ? "force-rebind"
        : "recover";

      return {
        primaryLane,
        secondaryLane,
        action: secondaryLane.lastDecision,
        reason: shouldForceSecondaryRebind
          ? "secondary_force_rebind_after_repeated_miss"
          : "secondary_current_missing_with_primary_present",
      };
    }

    function getBoundSecondaryTrack() {
      return secondaryTrackBound;
    }

    function unbindSecondarySubtitleTrack() {
      if (secondaryTrackCleanup) {
        secondaryTrackCleanup();
        secondaryTrackCleanup = null;
      }
      secondaryTrackBound = null;
    }

    function onCueChange(track) {
      if (track && DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(getRequestedSecondaryLanguage(), track),
        );
      }

      if (track) {
        renderSecondarySubtitle(getCurrentCueText(track), track);
      }

      onPrimaryCueChange();
    }

    function bindSecondarySubtitleTrack(track) {
      if (!track) return;

      unbindSecondarySubtitleTrack();

      try {
        if (track.mode === "disabled") {
          track.mode = "hidden";
        }
      } catch (_) {}

      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary track bind", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackMode: track?.mode || "",
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
        });
      }

      const handler = () => onCueChange(track);
      track.addEventListener("cuechange", handler);

      secondaryTrackCleanup = () => {
        track.removeEventListener("cuechange", handler);
      };

      secondaryTrackBound = track;
      onCueChange(track);
    }

    function syncSecondarySubtitleTrack(
      video,
      requestedLang,
      renderSecondarySubtitleOverride,
      options = {},
    ) {
      if (!video) return;

      const suppressRender = options.suppressRender === true;
      const forceRebind = options.forceRebind === true;

      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary sync",
          getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
        );
      }

      if (forceRebind) {
        unbindSecondarySubtitleTrack();
      }

      const track = resolveSecondarySubtitleTrack(video, requestedLang);

      if (!track) {
        unbindSecondarySubtitleTrack();
        if (!suppressRender) {
          (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
            "",
            null,
          );
        }
        return;
      }

      if (secondaryTrackBound !== track || forceRebind) {
        bindSecondarySubtitleTrack(track);
        return;
      }

      if (!suppressRender) {
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
          getCurrentCueText(track),
          track,
        );
      }
    }

    function buildMergedSubtitleHealth({
      primaryTrack,
      secondaryTrack,
      pCue,
      pText,
      sCue,
      sText,
      sequenceHealth,
    }) {
      const runtime = {
        primaryTrackFound: Boolean(primaryTrack),
        secondaryTrackFound: Boolean(secondaryTrack),
        primaryActiveCues: getTrackActiveCuesLength(primaryTrack),
        secondaryActiveCues: getTrackActiveCuesLength(secondaryTrack),
      };

      const currentCue = {
        hasPrimaryCue: Boolean(pCue),
        hasSecondaryCue: Boolean(sCue),
        primaryTextLength: pText.length,
        secondaryTextLength: sText.length,
        hasPrimaryText: Boolean(pText),
        hasSecondaryText: Boolean(sText),
      };

      const sequence = {
        hasCurrentBlock: Boolean(sequenceHealth?.hasCurrentBlock),
        hasCurrentPrimary: Boolean(sequenceHealth?.hasCurrentPrimary),
        hasCurrentSecondary: Boolean(sequenceHealth?.hasCurrentSecondary),
        currentPairAligned: Boolean(sequenceHealth?.currentPairAligned),
        currentPairMissingSecondary: Boolean(
          sequenceHealth?.currentPairMissingSecondary,
        ),
        previousPairMissingSecondary: Boolean(
          sequenceHealth?.previousPairMissingSecondary,
        ),
        consecutiveCurrentMissingSecondary: Boolean(
          sequenceHealth?.consecutiveCurrentMissingSecondary,
        ),
      };

      const primaryHealthy =
        runtime.primaryTrackFound &&
        (
          runtime.primaryActiveCues > 0 ||
          currentCue.hasPrimaryText ||
          sequence.hasCurrentPrimary
        );

      const secondaryHealthy =
        runtime.secondaryTrackFound &&
        (
          runtime.secondaryActiveCues > 0 ||
          currentCue.hasSecondaryText ||
          sequence.hasCurrentSecondary
        );

      const sequenceSuggestsSecondaryGap =
        sequence.currentPairMissingSecondary;

      const shouldRecoverSecondary =
        primaryHealthy &&
        !secondaryHealthy &&
        sequenceSuggestsSecondaryGap;

      const shouldForceSecondaryRebind =
        shouldRecoverSecondary &&
        sequence.consecutiveCurrentMissingSecondary;

      return {
        runtime,
        currentCue,
        sequence,
        derived: {
          primaryHealthy,
          secondaryHealthy,
          shouldRecoverSecondary,
          shouldForceSecondaryRebind,
        },
      };
    }

    function onPrimaryCueChange() {
      logContent("cue-controller onPrimaryCueChange entered", {
        hasATVB: !!window.ATVB,
      });

      const currentTime = getCurrentTime();
      const primaryTrack = getPrimaryTrack();
      const secondaryTrack = getSecondaryTrack();
      const pCue = getCurrentCue(primaryTrack, currentTime);
      const pText = cleanCueText(pCue);
      const sCue = getCurrentCue(secondaryTrack, currentTime);
      const sText = cleanCueText(sCue);

      if (DEBUG_PANEL_PROBE) {
        logContent("cuechange track probe", {
          primaryTrackLanguage: primaryTrack?.language,
          secondaryTrackLanguage: secondaryTrack?.language,
          pText: pText.slice(0, 40),
          sText: sText.slice(0, 40),
        });
      }

      const blockApi = window.ATVB?.subtitleBlocks || {};
      const hasBuildSubtitleBlockSequence =
        typeof blockApi.buildSubtitleBlockSequence === "function";

      if (DEBUG_PANEL_PROBE) {
        logContent("subtitle blocks api snapshot", {
          hasATVB: !!window.ATVB,
          atvbKeys: Object.keys(window.ATVB || {}),
          hasSubtitleBlocks: !!window.ATVB?.subtitleBlocks,
          hasBuildSubtitleBlockSequence,
        });
      }

      let blockResult = null;

      if (hasBuildSubtitleBlockSequence) {
        blockResult = blockApi.buildSubtitleBlockSequence({
          primaryCues: getPrimaryTrackCues(),
          secondaryCues: getSecondaryTrackCues(),
          now: currentTime,
          previousBlocks: getPreviousSubtitleBlocks(),
          cleanCueText,
          rebuildReason: "onPrimaryCueChange",
        });

        setSubtitleBlocks(blockResult, "onPrimaryCueChange");
      } else {
        logContent("subtitle blocks api missing", {
          reason: "onPrimaryCueChange",
          hasATVB: !!window.ATVB,
          atvbKeys: Object.keys(window.ATVB || {}),
        });
      }

      const sequenceHealth = blockResult?.meta?.sequenceHealth || null;
      const mergedSubtitleHealth = buildMergedSubtitleHealth({
        primaryTrack,
        secondaryTrack,
        pCue,
        pText,
        sCue,
        sText,
        sequenceHealth,
      });

      lastMergedSubtitleHealth = mergedSubtitleHealth;

      if (DEBUG_PANEL_PROBE) {
        logContent("merged subtitle health snapshot", {
          primaryHealthy: mergedSubtitleHealth.derived.primaryHealthy,
          secondaryHealthy: mergedSubtitleHealth.derived.secondaryHealthy,
          shouldRecoverSecondary:
            mergedSubtitleHealth.derived.shouldRecoverSecondary,
          shouldForceSecondaryRebind:
            mergedSubtitleHealth.derived.shouldForceSecondaryRebind,
        });
      }

      if (mergedSubtitleHealth.derived.shouldRecoverSecondary && state.video) {
        if (DEBUG_PANEL_PROBE) {
          logContent("cue-controller secondary recovery observed", {
            hasVideo: Boolean(state.video),
            forceRebind:
              mergedSubtitleHealth.derived.shouldForceSecondaryRebind,
            note: "sync interval handles execution",
          });
        }
      }

      const currentBlock =
        getCurrentSubtitleBlockFromSequence(blockResult) || {
          startTime: pCue?.startTime ?? null,
          endTime: pCue?.endTime ?? null,
          primaryText: pText || "",
          secondaryText: sText || "",
          hasPrimarySignal: Boolean(pText),
          hasSecondarySignal: Boolean(sText),
          sourceReason: "onPrimaryCueChange:fallback",
          updatedAt: Date.now(),
        };

      /* truth blocks から overlay view を解決して描画する。 */
      setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange");

      const overlaySequence = getSubtitleBlockSequence();
      const subtitleViewResolver = root.subtitleViewResolver || null;
      const subtitleView =
        subtitleViewResolver &&
        typeof subtitleViewResolver.resolveUiSubtitleView === "function"
          ? subtitleViewResolver.resolveUiSubtitleView(
              overlaySequence?.blocks,
              overlaySequence?.currentIndex,
              overlaySequence?.meta,
            )
          : null;

      state.currentSubtitleView = subtitleView;

      if (subtitleView) {
        updateOverlayFromView(subtitleView);
      } else {
        updateOverlayFromBlock(currentBlock);
      }

      if (secondaryTrack) {
        renderSecondarySubtitle(sText, secondaryTrack);
      }

      renderPanel();
    }

    return {
      getBoundSecondaryTrack,
      unbindSecondarySubtitleTrack,
      bindSecondarySubtitleTrack,
      syncSecondarySubtitleTrack,
      onCueChange,
      onPrimaryCueChange,
      getMergedSubtitleHealth: () => lastMergedSubtitleHealth,
      getLaneStates: () => laneStates,
      evaluateSecondaryRecovery,
    };
  }

  root.cueController = {
    createCueController,
  };
})();
