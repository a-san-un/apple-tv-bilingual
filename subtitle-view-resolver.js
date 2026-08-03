// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-view-resolver.js
// version: 1.1.1
//
// 役割:
// - subtitle block sequence から panel / overlay 共通の current subtitle view を解決する
// - sequence 側で確定した currentIndex / currentBlock を唯一の current 根拠として使う
// - resolver 内で current の再探索は行わず、primary / secondary をそのまま view へ写す
//
// 方針:
// - truth は subtitle-blocks.js が返す blocks / currentIndex
// - current block の primaryText / secondaryText を shared UI view へ正規化する
// - panel / overlay が同じ current block を参照できる形を保つ
// =============================================================

(() => {
  try {
    const root = (window.ATVB = window.ATVB || {});

    // null / undefined を空文字へ寄せ、比較と出力を安定させる。
    function normalizeText(text) {
      return String(text || "").trim();
    }

    // currentIndex から current block を安全に取り出す。
    // 範囲外や不正値のときは null を返す。
    function pickCurrentBlock(blocks, currentIndex) {
      const list = Array.isArray(blocks) ? blocks : [];
      if (!Number.isInteger(currentIndex)) return null;
      if (currentIndex < 0 || currentIndex >= list.length) return null;
      return list[currentIndex] || null;
    }

    // current block を panel / overlay 共通の最小 view model へ変換する。
    // 新 schema は primary / secondary を基本とし、currentBlock も保持する。
    function buildSharedSubtitleViewFromBlock(currentBlock, meta = null) {
      const primaryText = normalizeText(currentBlock?.primaryText);
      const secondaryText = normalizeText(currentBlock?.secondaryText);

      return {
        primary: primaryText,
        secondary: secondaryText,
        isVisible: Boolean(primaryText || secondaryText),
        currentBlock: currentBlock || null,
        meta: meta || null,
      };
    }

    // blocks と currentIndex から shared subtitle view を解決する。
    // current は再推定せず、sequence 側で決まった index をそのまま信頼する。
    function resolveUiSubtitleView(blocks, currentIndex, meta = null) {
      const list = Array.isArray(blocks) ? blocks : [];
      const currentBlock = pickCurrentBlock(list, currentIndex);
      const view = buildSharedSubtitleViewFromBlock(currentBlock, meta);

      console.debug("[ATVB] subtitle-view-resolver debug", {
        currentIndex,
        totalBlockCount: list.length,
        currentBlock: currentBlock
          ? {
              key: currentBlock.key || "",
              startTime: Number(currentBlock.startTime ?? 0),
              endTime: Number(currentBlock.endTime ?? 0),
              state: currentBlock.state || "",
              primaryText: normalizeText(currentBlock.primaryText),
              secondaryText: normalizeText(currentBlock.secondaryText),
            }
          : null,
        subtitleViewPrimary: view.primary,
        subtitleViewSecondary: view.secondary,
      });

      return view;
    }

    root.subtitleViewResolver = {
      resolveUiSubtitleView,
    };
  } catch (error) {
    console.error("[ATVB] subtitle-view-resolver: failed", error);
  }
})();
