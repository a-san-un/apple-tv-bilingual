// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-block-resolver.js
// version: 2.6.3
// 役割: panel 表示用 subtitle block の正規化・同時間窓グループ化・
// current の truth 解決を担当する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  function normalizePanelBlocks(sourceBlocks, currentTime, currentSubtitleBlock) {
    const baseBlocks = Array.isArray(sourceBlocks) ? sourceBlocks : [];
    const normalizedBlocks = baseBlocks
      .filter((block) => block && Number.isFinite(block.startTime))
      .map((block) => {
        const startTime = Number(block.startTime);
        const endTime = Number.isFinite(block.endTime)
          ? Number(block.endTime)
          : startTime;
        let state = "future";

        if (endTime <= currentTime) {
          state = "past";
        } else if (startTime <= currentTime && endTime > currentTime) {
          state = "current";
        }

        return {
          ...block,
          startTime,
          endTime,
          primary: block.primary ?? block.primaryText ?? "",
          secondary: block.secondary ?? block.secondaryText ?? "",
          state,
        };
      });

    const hasCurrentBlock = normalizedBlocks.some(
      (block) => block.state === "current",
    );

    const fallbackStartTime =
      currentSubtitleBlock?.startTime != null
        ? Number(currentSubtitleBlock.startTime)
        : null;
    const fallbackEndTime =
      currentSubtitleBlock?.endTime != null
        ? Number(currentSubtitleBlock.endTime)
        : null;

    const hasNormalBlockInSameWindow =
      fallbackStartTime != null &&
      fallbackEndTime != null &&
      normalizedBlocks.some(
        (block) =>
          block.key !== "current-fallback" &&
          block.startTime === fallbackStartTime &&
          block.endTime === fallbackEndTime,
      );

    let usedCurrentFallback = false;
    if (
      !hasCurrentBlock &&
      fallbackStartTime != null &&
      fallbackEndTime != null &&
      !hasNormalBlockInSameWindow
    ) {
      usedCurrentFallback = true;
      normalizedBlocks.push({
        startTime: fallbackStartTime,
        endTime: fallbackEndTime,
        primary:
          currentSubtitleBlock.primaryText ||
          currentSubtitleBlock.primary ||
          "",
        secondary:
          currentSubtitleBlock.secondaryText ||
          currentSubtitleBlock.secondary ||
          "",
        state: "current",
        stable: false,
        key: "current-fallback",
      });
    }

    normalizedBlocks.sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime - b.startTime;
      if (a.endTime !== b.endTime) return a.endTime - b.endTime;
      return 0;
    });

    return {
      normalizedBlocks,
      usedCurrentFallback,
    };
  }

  function groupBlocksByTimeWindow(blocks) {
    const groups = new Map();
    (Array.isArray(blocks) ? blocks : []).forEach((block, index) => {
      const key = `${block.startTime}::${block.endTime}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ block, index });
    });
    return groups;
  }

  function applySequentialCurrentWithinGroup(groups, currentTime, debugLog = null) {
    groups.forEach((entries) => {
      if (entries.length <= 1) return;

      const { startTime, endTime } = entries[0].block;
      if (!(startTime <= currentTime && endTime > currentTime)) return;

      const duration = Math.max(0.001, endTime - startTime);
      const progress = Math.min(
        0.999999,
        Math.max(0, (currentTime - startTime) / duration),
      );
      const currentIndex =
        entries.length === 2
          ? (progress < 0.3 ? 0 : 1)
          : Math.min(
              entries.length - 1,
              Math.floor(progress * entries.length),
            );

      entries.forEach(({ block }, index) => {
        if (index < currentIndex) {
          block.state = "past";
        } else if (index === currentIndex) {
          block.state = "current";
        } else {
          block.state = "future";
        }
      });

      if (
        typeof debugLog === "function" &&
        currentTime >= 32 &&
        currentTime <= 40
      ) {
        debugLog("same-window sequential current", {
          currentTime,
          startTime,
          endTime,
          duration,
          progress,
          entryCount: entries.length,
          selectedIndex: currentIndex,
          items: entries.map(({ block }, index) => ({
            index,
            key: block.key || null,
            primaryPreview: String(block.primary || "").slice(0, 40),
            state: block.state,
          })),
        });
      }
    });
  }

  function resolveSingleCurrentBlock(blocks, currentTime) {
    const currentBlocks = (Array.isArray(blocks) ? blocks : []).filter(
      (block) => block.state === "current",
    );

    if (currentBlocks.length <= 1) {
      return currentBlocks;
    }

    const groupedByWindow = new Map();
    currentBlocks.forEach((block) => {
      const key = `${block.startTime}::${block.endTime}`;
      if (!groupedByWindow.has(key)) groupedByWindow.set(key, []);
      groupedByWindow.get(key).push(block);
    });

    if (groupedByWindow.size <= 1) {
      return currentBlocks;
    }

    const currentWinner = currentBlocks
      .slice()
      .sort((a, b) => {
        const aDistance = Math.abs(currentTime - a.startTime);
        const bDistance = Math.abs(currentTime - b.startTime);
        if (aDistance !== bDistance) return aDistance - bDistance;
        if (a.startTime !== b.startTime) return a.startTime - b.startTime;
        if (a.endTime !== b.endTime) return a.endTime - b.endTime;
        return 0;
      })[0];

    blocks.forEach((block) => {
      if (block.state !== "current") return;
      if (
        block.startTime === currentWinner.startTime &&
        block.endTime === currentWinner.endTime
      ) {
        return;
      }

      block.state =
        block.startTime < currentWinner.startTime ? "past" : "future";
    });

    return blocks.filter((block) => block.state === "current");
  }

  function resolvePanelBlocksForRender({
    sourceBlocks = [],
    currentTime = 0,
    currentSubtitleBlock = null,
    debugLog = null,
  } = {}) {
    const { normalizedBlocks, usedCurrentFallback } = normalizePanelBlocks(
      sourceBlocks,
      currentTime,
      currentSubtitleBlock,
    );
    const sameWindowGroups = groupBlocksByTimeWindow(normalizedBlocks);

    applySequentialCurrentWithinGroup(
      sameWindowGroups,
      currentTime,
      debugLog,
    );
    const currentBlocks = resolveSingleCurrentBlock(
      normalizedBlocks,
      currentTime,
    );

    return {
      blocks: normalizedBlocks,
      currentBlocks,
      usedCurrentFallback,
      sameWindowGroups,
    };
  }

  window.ATVB.subtitleBlockResolver = {
    normalizePanelBlocks,
    groupBlocksByTimeWindow,
    applySequentialCurrentWithinGroup,
    resolveSingleCurrentBlock,
    resolvePanelBlocksForRender,
  };
})();
