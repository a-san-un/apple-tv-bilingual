// =============================================================
// Apple TV+ Bilingual Subtitles - modules/cue-sequence-builder.js
// 役割: primaryCues / secondaryCues から subtitle block sequence を
//       構築する責務を担う。
//       cue-controller.js の rebuildCurrentSceneSubtitleBlocks() から
//       sequence 構築ロジックを切り出した facade 向けモジュール。
// =============================================================

(() => {
  const root = (window.ATVB = window.ATVB || {});

  /**
   * subtitle block sequence 構築を担う factory を生成する。
   *
   * @param {{
   *   buildSubtitleBlockSequence: Function,
   *   getPrimaryTrackCues: Function,
   *   getSecondaryTrackCues: Function,
   *   getPreviousSubtitleBlocks: Function,
   *   cleanCueText: Function,
   *   setSubtitleBlocks: Function,
   *   setCurrentSubtitleBlock: Function,
   *   getCurrentCue: Function,
   *   getCurrentTime: Function,
   *   logContent?: Function,
   *   DEBUG_SECONDARY_SUBS?: boolean,
   * }} deps
   */
  function createCueSequenceBuilder(deps) {
    const {
      buildSubtitleBlockSequence,
      getPrimaryTrackCues,
      getSecondaryTrackCues,
      getPreviousSubtitleBlocks,
      cleanCueText,
      setSubtitleBlocks,
      setCurrentSubtitleBlock,
      getCurrentCue,
      getCurrentTime,
      logContent,
      DEBUG_SECONDARY_SUBS,
    } = deps;

    /**
     * 現在時刻を基準に subtitle block sequence を再構築し、
     * currentBlock を確定して返す。
     * cue-controller.js の rebuildCurrentSceneSubtitleBlocks() と同等の処理。
     *
     * @param {{
     *   primaryTrack: TextTrack | null,
     *   secondaryTrack: TextTrack | null,
     *   rebuildReason?: string,
     * }} options
     * @returns {{
     *   sequence: object,
     *   currentBlock: object | null,
     *   sequenceHealth: object | null,
     *   primaryCue: VTTCue | null,
     *   secondaryCue: VTTCue | null,
     *   primaryText: string,
     *   secondaryText: string,
     * }}
     */
    function rebuildSequence({ primaryTrack, secondaryTrack, rebuildReason = "rebuildSequence" }) {
      const currentTime = getCurrentTime();

      const primaryCue = getCurrentCue(primaryTrack, currentTime);
      const secondaryCue = getCurrentCue(secondaryTrack, currentTime);

      const primaryText = cleanCueText(primaryCue);
      const secondaryText = cleanCueText(secondaryCue);

      const primaryCueWindowBeforeSeconds = 180;
      const primaryCueWindowAfterSeconds = 30;
      const secondaryCueWindowBeforeSeconds = 300;
      const secondaryCueWindowAfterSeconds = 60;

      function toCueArray(cuesLike) {
        return Array.from(cuesLike || []);
      }

      function filterCuesByTimeWindow(
        cuesLike,
        now,
        beforeSeconds,
        afterSeconds,
      ) {
        return toCueArray(cuesLike).filter((cue) => {
          const startTime = Number(cue?.startTime ?? Number.NaN);
          const endTime = Number(cue?.endTime ?? Number.NaN);
          if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
            return false;
          }
          return (
            endTime >= now - beforeSeconds &&
            startTime <= now + afterSeconds
          );
        });
      }

      const rawPrimaryCues = getPrimaryTrackCues();
      const rawSecondaryCues = getSecondaryTrackCues();

      const primaryCues = filterCuesByTimeWindow(
        rawPrimaryCues,
        currentTime,
        primaryCueWindowBeforeSeconds,
        primaryCueWindowAfterSeconds,
      );

      const secondaryCueWindowFallbackBeforeSeconds = 900;
      const secondaryCueWindowFallbackAfterSeconds = 180;
      const secondaryCueFallbackMaxCount = 150;

      const secondaryCuesInPrimaryWindow = filterCuesByTimeWindow(
        rawSecondaryCues,
        currentTime,
        secondaryCueWindowBeforeSeconds,
        secondaryCueWindowAfterSeconds,
      );

      const secondaryHasAnyCues = toCueArray(rawSecondaryCues).length > 0;

      const shouldUseSecondaryFallbackWindow =
        secondaryHasAnyCues &&
        secondaryCuesInPrimaryWindow.length === 0 &&
        !secondaryCue;

      const secondaryCues = shouldUseSecondaryFallbackWindow
        ? filterCuesByTimeWindow(
            rawSecondaryCues,
            currentTime,
            secondaryCueWindowFallbackBeforeSeconds,
            secondaryCueWindowFallbackAfterSeconds,
          ).slice(-secondaryCueFallbackMaxCount)
        : secondaryCuesInPrimaryWindow;

      const previousSequence = getPreviousSubtitleBlocks();

      const shouldDropPreviousBlocks =
        rebuildReason === "nearbyRebuild" ||
        rebuildReason === "sync_interval_large_seek_resync" ||
        rebuildReason === "content_key_changed";

      const previousBlocks = shouldDropPreviousBlocks
        ? []
        : Array.isArray(previousSequence?.blocks)
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

      setSubtitleBlocks(sequence, {
        sourceTag: "cue-sequence-builder",
        reason: rebuildReason,
      });

      const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];

      const currentIndex = Number.isInteger(sequence?.currentIndex)
        ? sequence.currentIndex
        : -1;

      const currentBlock =
        currentIndex >= 0 && currentIndex < blocks.length
          ? blocks[currentIndex] || null
          : null;

      setCurrentSubtitleBlock(currentBlock, sequence?.meta || null);

      const sequenceHealth = sequence?.meta?.sequenceHealth || null;

      if (DEBUG_SECONDARY_SUBS) {
        logContent?.("cue-sequence-builder: rebuild", {
          reason: rebuildReason,
          currentTime,
          primaryTrackFound: Boolean(primaryTrack),
          secondaryTrackFound: Boolean(secondaryTrack),
          primaryTextLength: primaryText.length,
          secondaryTextLength: secondaryText.length,
          hasPrimaryCue: Boolean(primaryCue),
          hasSecondaryCue: Boolean(secondaryCue),
          hasCurrentBlock: Boolean(currentBlock),
          hasCurrentPrimary: Boolean(currentBlock?.primaryText),
          hasCurrentSecondary: Boolean(currentBlock?.secondaryText),
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
          totalBlockCount: blocks.length,
          currentIndex,
          sequenceMeta: sequence?.meta || null,
        });
      }

      return {
        sequence,
        currentBlock,
        sequenceHealth,
        primaryCue,
        secondaryCue,
        primaryText,
        secondaryText,
      };
    }

    return { rebuildSequence };
  }

  root.createCueSequenceBuilder = createCueSequenceBuilder;
})();
