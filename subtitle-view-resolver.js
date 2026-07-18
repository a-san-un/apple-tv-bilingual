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

    return overlayResolver.resolveOverlayView(blocks, currentIndex, meta);
  }

  root.subtitleViewResolver = {
    resolveUiSubtitleView,
  };
})();
