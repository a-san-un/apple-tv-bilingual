(() => {
  try {
    const root = (window.ATVB = window.ATVB || {});

    function toArray(cuesLike) {
      if (!cuesLike) return [];
      try {
        return Array.from(cuesLike);
      } catch (_) {
        return [];
      }
    }

    function normalizeText(text) {
      return String(text || "").trim();
    }

    function buildSubtitleBlockKey(block) {
      return [
        Number(block?.startTime ?? 0).toFixed(3),
        Number(block?.endTime ?? 0).toFixed(3),
        normalizeText(block?.primaryText),
      ].join("::");
    }

    function classifyBlockState(block, now) {
      if (block.endTime < now) return "past";
      if (block.startTime > now) return "future";
      return "current";
    }

    function matchSecondaryText(
      block,
      secondaryCues,
      cleanCueText,
      matchWindow,
    ) {
      let bestCue = null;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (const cue of secondaryCues) {
        const text = normalizeText(
          cleanCueText ? cleanCueText(cue) : cue?.text,
        );
        if (!text) continue;

        const delta = Math.abs(
          Number(cue?.startTime ?? 0) - Number(block.startTime ?? 0),
        );

        if (delta > matchWindow) continue;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestCue = cue;
        }
      }

      if (!bestCue) return "";
      return normalizeText(
        cleanCueText ? cleanCueText(bestCue) : bestCue?.text,
      );
    }

    function buildSubtitleBlockSequence({
      primaryCues,
      secondaryCues,
      now,
      previousBlocks = [],
      cleanCueText,
      matchWindow = 2.0,
      rebuildReason = "cuechange",
    }) {
      const primaryList = toArray(primaryCues);
      const secondaryList = toArray(secondaryCues);
      const previousMap = new Map(
        (Array.isArray(previousBlocks) ? previousBlocks : []).map((block) => [
          block.key,
          block,
        ]),
      );

      const blocks = primaryList
        .map((cue) => {
          const primaryText = normalizeText(
            cleanCueText ? cleanCueText(cue) : cue?.text,
          );
          if (!primaryText) return null;

          const block = {
            startTime: Number(cue?.startTime ?? 0),
            endTime: Number(cue?.endTime ?? 0),
            primaryText,
            secondaryText: "",
            state: "future",
            stable: false,
          };

          block.key = buildSubtitleBlockKey(block);
          block.secondaryText = matchSecondaryText(
            block,
            secondaryList,
            cleanCueText,
            matchWindow,
          );
          block.state = classifyBlockState(block, now);

          const prev = previousMap.get(block.key);
          if (block.state === "past") {
            block.stable = true;
          } else if (
            block.state === "current" &&
            prev &&
            prev.secondaryText === block.secondaryText &&
            prev.stable === true
          ) {
            block.stable = true;
          } else {
            block.stable = false;
          }

          return block;
        })
        .filter(Boolean);

      const currentIndex = blocks.findIndex(
        (block) => block.state === "current",
      );

      return {
        blocks,
        currentIndex,
        meta: {
          now,
          rebuildReason,
          blockCount: blocks.length,
        },
      };
    }

    root.subtitleBlocks = {
      buildSubtitleBlockKey,
      buildSubtitleBlockSequence,
    };

  } catch (error) {
    console.error("[ATVB] subtitle-blocks: failed", error);
  }
})();
