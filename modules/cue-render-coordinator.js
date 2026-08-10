// =============================================================
// Apple TV+ Bilingual Subtitles - modules/cue-render-coordinator.js
// 役割:
// - cue-controller.js にある render 系補助ロジックを段階的に切り出す。
// - Step 7-C 時点では buildMergedSubtitleHealth / nearby rebuild guard /
//   current scene rebuild をモジュール化する。
// - Step 7-F で cue-controller.js facade からこの module を呼ぶ。
// =============================================================

(() => {
  const root = (window.ATVB = window.ATVB || {});

  /**
   * @param {{
   *   state: object,
   *   buildSubtitleBlockSequence: Function,
   *   getPrimaryTrackCues: Function,
   *   getSecondaryTrackCues: Function,
   *   getPreviousSubtitleBlocks: Function,
   *   cleanCueText: Function,
   *   setSubtitleBlocks: Function,
   *   setCurrentSubtitleBlock: Function,
   *   getCurrentCue: Function,
   *   getCurrentTime: Function,
   *   getTrackActiveCuesLength: Function,
   *   NEARBY_REBUILD_SEEK_WINDOW_MS: number,
   *   logContent?: Function,
   *   DEBUG_SECONDARY_SUBS?: boolean,
   * }} deps
   */
  function createCueRenderCoordinator(deps) {
    const {
      state,
      buildSubtitleBlockSequence,
      getPrimaryTrackCues,
      getSecondaryTrackCues,
      getPreviousSubtitleBlocks,
      cleanCueText,
      setSubtitleBlocks,
      setCurrentSubtitleBlock,
      getCurrentCue,
      getCurrentTime,
      getTrackActiveCuesLength,
      NEARBY_REBUILD_SEEK_WINDOW_MS,
      logContent,
      DEBUG_SECONDARY_SUBS,
    } = deps;

    let nearbyRebuildGuard = null;

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
        hasFreshCurrentPrimary: Boolean(pCue) && Boolean(pText),
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
        (runtime.primaryActiveCues > 0 ||
          currentCue.hasPrimaryText ||
          sequence.hasCurrentPrimary);

      const secondaryHealthy =
        runtime.secondaryTrackFound &&
        (runtime.secondaryActiveCues > 0 ||
          currentCue.hasSecondaryText ||
          sequence.hasCurrentSecondary);

      const sequenceSuggestsSecondaryGap = sequence.currentPairMissingSecondary;

      const shouldRecoverSecondary =
        primaryHealthy && !secondaryHealthy && sequenceSuggestsSecondaryGap;

      const shouldForceSecondaryRebind =
        shouldRecoverSecondary && sequence.consecutiveCurrentMissingSecondary;

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

    function clearNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
      state.nearbyRebuildHoldView = null;
    }

    function consumeNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
    }

    function isWithinNearbyRebuildSeekWindow() {
      const lastLargeSeekAt = Number(state.lastLargeSeekAt ?? 0);
      if (!lastLargeSeekAt) return false;
      return Date.now() - lastLargeSeekAt <= NEARBY_REBUILD_SEEK_WINDOW_MS;
    }

    function armNearbyRebuildGuard(currentBlock) {
      nearbyRebuildGuard = {
        consumeOnNextPrimaryCueChange: true,
        issuedAt: Date.now(),
        blockStartTime: currentBlock?.startTime ?? null,
        blockEndTime: currentBlock?.endTime ?? null,
        sourceReason: currentBlock?.sourceReason ?? "nearbyRebuild",
      };
    }

    function shouldPreserveNearbyRebuildCurrentBlock() {
      const guardActive = Boolean(
        nearbyRebuildGuard?.consumeOnNextPrimaryCueChange,
      );
      if (!guardActive) return false;

      const hasNearbySource = Boolean(
        state.nearbyRebuildHoldView?.currentBlock?.sourceReason ===
          "nearbyRebuildHold" ||
          state.currentSubtitleBlock?.sourceReason === "nearbyRebuild",
      );
      if (!hasNearbySource) return false;

      return isWithinNearbyRebuildSeekWindow();
    }

    function rebuildCurrentSceneSubtitleBlocks({
      primaryTrack,
      secondaryTrack,
      rebuildReason = "nearbyRebuild",
    } = {}) {
      const currentTime = getCurrentTime();

      const primaryCue = getCurrentCue(primaryTrack, currentTime);
      const secondaryCue = getCurrentCue(secondaryTrack, currentTime);

      const primaryText = cleanCueText(primaryCue);
      const secondaryText = cleanCueText(secondaryCue);

      const primaryCues = getPrimaryTrackCues();
      const secondaryCues = getSecondaryTrackCues();

      const previousSequence = getPreviousSubtitleBlocks();
      const previousBlocks = Array.isArray(previousSequence?.blocks)
        ? previousSequence.blocks
        : Array.isArray(previousSequence)
          ? previousSequence
          : [];

      const sequence = buildSubtitleBlockSequence({
        primaryCues,
        secondaryCues,
        now: currentTime,
        previousBlocks,
        cleanCueText,
        rebuildReason,
      });

      const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
      setSubtitleBlocks(sequence);

      const currentIndex = Number.isInteger(sequence?.currentIndex)
        ? sequence.currentIndex
        : -1;

      const currentBlock =
        currentIndex >= 0 && currentIndex < blocks.length
          ? blocks[currentIndex] || null
          : null;

      setCurrentSubtitleBlock(currentBlock, sequence?.meta || null);

      if (currentBlock) {
        state.nearbyRebuildHoldView = {
          currentBlock: {
            ...currentBlock,
            sourceReason: "nearbyRebuildHold",
          },
          issuedAt: Date.now(),
          rebuildReason,
        };
        armNearbyRebuildGuard(currentBlock);
      } else {
        clearNearbyRebuildGuard();
      }

      if (DEBUG_SECONDARY_SUBS) {
        logContent?.("cue-render-coordinator: rebuildCurrentSceneSubtitleBlocks", {
          reason: rebuildReason,
          currentTime,
          hasPrimaryCue: Boolean(primaryCue),
          hasSecondaryCue: Boolean(secondaryCue),
          primaryTextLength: primaryText.length,
          secondaryTextLength: secondaryText.length,
          hasCurrentBlock: Boolean(currentBlock),
          currentIndex,
          totalBlockCount: blocks.length,
          sequenceMeta: sequence?.meta || null,
        });
      }

      return {
        sequence,
        currentBlock,
        primaryCue,
        secondaryCue,
        primaryText,
        secondaryText,
      };
    }

    function getNearbyRebuildGuard() {
      return nearbyRebuildGuard;
    }

    return {
      buildMergedSubtitleHealth,
      clearNearbyRebuildGuard,
      consumeNearbyRebuildGuard,
      isWithinNearbyRebuildSeekWindow,
      armNearbyRebuildGuard,
      shouldPreserveNearbyRebuildCurrentBlock,
      rebuildCurrentSceneSubtitleBlocks,
      getNearbyRebuildGuard,
    };
  }

  root.createCueRenderCoordinator = createCueRenderCoordinator;
})();
