// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-block-resolver.js
// version: 2.6.4
//
// 役割:
// - panel 表示用 subtitle block の正規化を行う
// - start/end が同じ block を same-window group として束ねる
// - truth としての current/past/future を strict に解決する
// - panel UX 用に、window 単位 current 強調フラグを派生計算する
//
// Phase 3-3 方針:
// - truth の state/currentBlocks は strict な時刻判定のまま維持する
// - ただし panel は派生ビューとして、短い gap では直前 window を
//   current 風に見せられるようにする
// - same-window 2行/3行 group では、isSequentialCurrent は 1行だけ、
//   isPanelEmphasized は window 単位で複数行 true を許容する
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const PANEL_CURRENT_WINDOW_GAP_TOLERANCE = 0.18;

  // [normalize blocks]
  // sourceBlocks を panel 用 block 配列へ正規化し、strict な state を付与する。
  // current block が無い場合のみ、必要なら currentSubtitleBlock 由来 fallback を追加する。
  function normalizePanelBlocks(
    sourceBlocks,
    currentTime,
    currentSubtitleBlock,
  ) {
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

  // [group by time window]
  // start/end が同じ block を同一 window とみなし、group map を作る。
  function groupBlocksByTimeWindow(blocks) {
    const groups = new Map();
    (Array.isArray(blocks) ? blocks : []).forEach((block, index) => {
      const key = `${block.startTime}::${block.endTime}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ block, index });
    });
    return groups;
  }

  // [same-window sequential current]
  // current window 内で same-window group が複数行ある場合、
  // progress に応じて 1 行だけ strict current にし、前後行を past/future へ振り分ける。
  function applySequentialCurrentWithinGroup(
    groups,
    currentTime,
    debugLog = null,
  ) {
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
          ? progress < 0.3
            ? 0
            : 1
          : Math.min(entries.length - 1, Math.floor(progress * entries.length));

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

  // [single current winner]
  // 複数 window が同時に current になった場合、現在時刻に最も近い 1 window を winner に決める。
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

    const currentWinner = currentBlocks.slice().sort((a, b) => {
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

  // [panel current window key]
  // panel 用 current window を決める。
  // strict current window が無い場合でも、短い gap なら直前 window を current 扱いで延命する。
  function findPanelCurrentWindowKey(sameWindowGroups, currentTime) {
    let strictCurrentWindowKey = null;
    let nearestPastWindowKey = null;
    let nearestPastDistance = Infinity;

    sameWindowGroups.forEach((entries, groupKey) => {
      if (!entries.length) return;

      const { startTime, endTime } = entries[0].block;

      if (startTime <= currentTime && endTime > currentTime) {
        strictCurrentWindowKey = groupKey;
        return;
      }

      if (endTime <= currentTime) {
        const distance = currentTime - endTime;
        if (distance < nearestPastDistance) {
          nearestPastDistance = distance;
          nearestPastWindowKey = groupKey;
        }
      }
    });

    if (strictCurrentWindowKey) {
      return {
        currentWindowKey: strictCurrentWindowKey,
        usedGapFallback: false,
        gapFromPreviousWindow: 0,
      };
    }

    if (
      nearestPastWindowKey &&
      nearestPastDistance <= PANEL_CURRENT_WINDOW_GAP_TOLERANCE
    ) {
      return {
        currentWindowKey: nearestPastWindowKey,
        usedGapFallback: true,
        gapFromPreviousWindow: nearestPastDistance,
      };
    }

    return {
      currentWindowKey: null,
      usedGapFallback: false,
      gapFromPreviousWindow: null,
    };
  }

  // [panel current flags]
  // truth の state から panel 表示用派生フラグを計算する。
  // same-window 複数行では window 単位で isPanelEmphasized=true を付与する。
  function applyPanelCurrentFlags(
    blocks,
    sameWindowGroups,
    currentTime,
    debugLog = null,
  ) {
    const { currentWindowKey, usedGapFallback, gapFromPreviousWindow } =
      findPanelCurrentWindowKey(sameWindowGroups, currentTime);

    (Array.isArray(blocks) ? blocks : []).forEach((block) => {
      const windowKey = `${block.startTime}::${block.endTime}`;
      const groupEntries = sameWindowGroups.get(windowKey) || [];
      const isWindowCurrent = windowKey === currentWindowKey;
      const hasMultipleBlocksInWindow = groupEntries.length > 1;

      block.isWindowCurrent = isWindowCurrent;
      block.isSequentialCurrent = block.state === "current";
      block.isPanelEmphasized = hasMultipleBlocksInWindow
        ? isWindowCurrent
        : isWindowCurrent || block.isSequentialCurrent;
    });

    if (
      usedGapFallback &&
      typeof debugLog === "function" &&
      currentTime >= 32 &&
      currentTime <= 40
    ) {
      debugLog("panel current window gap fallback", {
        currentTime,
        currentWindowKey,
        gapFromPreviousWindow,
        tolerance: PANEL_CURRENT_WINDOW_GAP_TOLERANCE,
      });
    }
  }

  // [resolve panel blocks]
  // panel 描画用の truth/派生情報をまとめて解決し、renderer が使う shape へ整える。
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

    applySequentialCurrentWithinGroup(sameWindowGroups, currentTime, debugLog);
    const currentBlocks = resolveSingleCurrentBlock(
      normalizedBlocks,
      currentTime,
    );

    applyPanelCurrentFlags(
      normalizedBlocks,
      sameWindowGroups,
      currentTime,
      debugLog,
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
    findPanelCurrentWindowKey,
    applyPanelCurrentFlags,
    resolvePanelBlocksForRender,
  };
})();
