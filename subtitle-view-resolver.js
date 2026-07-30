(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /*
   * UI 共通の current subtitle view を返す。
   * 当面は overlay 用 view をそのまま流用し、
   * 将来 panel / history 側もここへ寄せる。
   */
  function resolveUiSubtitleView(blocks, currentIndex, meta = null) {
    const overlayResolver = root.overlayBlockResolver;

    if (
      !overlayResolver ||
      typeof overlayResolver.resolveOverlayView !== "function"
    ) {
      return null;
    }

    const view = overlayResolver.resolveOverlayView(blocks, currentIndex, meta);
    if (!view) {
      return null;
    }

    return {
      currentBlock: view.currentBlock ?? null,
      displayBlocks: Array.isArray(view.displayBlocks) ? view.displayBlocks : [],
      mainLines: Array.isArray(view.mainLines) ? view.mainLines : [],
      subLines: Array.isArray(view.subLines) ? view.subLines : [],
      isStable: Boolean(view.isStable),
      shouldKeepVisible: Boolean(view.shouldKeepVisible),
      isEmpty: Boolean(view.isEmpty),
    };
  }

  root.subtitleViewResolver = {
    resolveUiSubtitleView,
  };
})();
