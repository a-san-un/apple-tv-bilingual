(function initSubtitleBlockStateModule(global) {
  const root = global.ATVB || (global.ATVB = {});

  function normalizeSequenceShape(subtitleBlocks) {
    if (subtitleBlocks && typeof subtitleBlocks === "object") {
      if (Array.isArray(subtitleBlocks.blocks)) {
        return subtitleBlocks;
      }

      if (Array.isArray(subtitleBlocks)) {
        return {
          blocks: subtitleBlocks,
          currentIndex: -1,
          meta: null,
        };
      }
    }

    if (Array.isArray(subtitleBlocks)) {
      return {
        blocks: subtitleBlocks,
        currentIndex: -1,
        meta: null,
      };
    }

    return {
      blocks: [],
      currentIndex: -1,
      meta: null,
    };
  }

  function createSubtitleBlockState({
    state,
    now = () => Date.now(),
    logSubtitle = () => {},
    renderCurrentSnapshot = null,
  }) {
    if (!state || typeof state !== "object") {
      throw new Error("ATVB createSubtitleBlockState requires state");
    }

    function getSequence() {
      return normalizeSequenceShape(state.subtitleBlocks);
    }

    function getCurrentBlock() {
      const sequence = getSequence();
      const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
      const currentIndex = Number.isInteger(sequence?.currentIndex)
        ? sequence.currentIndex
        : -1;

      if (currentIndex >= 0 && currentIndex < blocks.length) {
        return blocks[currentIndex] || null;
      }

      return null;
    }

    function syncCurrentBlock(block, meta = null) {
      const sequenceCurrentBlock = getCurrentBlock();

      state.currentSubtitleBlock = sequenceCurrentBlock || block || null;
      state.subtitleBlockMeta = meta || getSequence()?.meta || null;

      if (state.currentSubtitleBlock) {
        state.lastCurrentSubtitleBlockAt = now();
      }
    }

    function rebuildForPanelOpen(reason = "panel_open") {
      const sequence = getSequence();
      const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
      const currentBlock = getCurrentBlock();

      logSubtitle("rebuild subtitle blocks for panel open", {
        reason,
        totalBlockCount: blocks.length,
        currentIndex: Number.isInteger(sequence?.currentIndex)
          ? sequence.currentIndex
          : -1,
        hasCurrentBlock: Boolean(currentBlock),
        currentBlock: currentBlock
          ? {
              key: currentBlock.key || "",
              startTime: Number(currentBlock.startTime ?? 0),
              endTime: Number(currentBlock.endTime ?? 0),
              state: currentBlock.state || "",
            }
          : null,
      });

      state.currentSubtitleBlock =
        state.currentSubtitleView?.currentBlock || currentBlock || null;

      if (state.currentSubtitleBlock) {
        state.lastCurrentSubtitleBlockAt = now();
      }

      renderCurrentSnapshot?.();
    }

    return {
      getSequence,
      getCurrentBlock,
      syncCurrentBlock,
      rebuildForPanelOpen,
    };
  }

  root.createSubtitleBlockState = createSubtitleBlockState;
})(window);
