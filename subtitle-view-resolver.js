// =============================================================
// Apple TV+ Bilingual Subtitles - subtitle-view-resolver.js
// version: 1.3.1
//
// 役割:
// - subtitle block sequence から panel / overlay 共通の current subtitle view を解決する
// - sequence 側で確定した currentIndex / currentBlock を第一の current 根拠として使う
// - resolver 内で current の再探索は行わず、primary / secondary をそのまま view へ写す
//
// 方針:
// - truth は subtitle-blocks.js が返す blocks / currentIndex
// - current block の primaryText / secondaryText を shared UI view へ正規化する
// - panel / overlay が同じ current block を参照できる形を保つ
// - 起動直後や nearby rebuild 直後に current block が未確定でも、meta の hold block があれば
//   recovery failure ではなく hold 状態として view を返す
// - ただし hold は短時間だけ有効にし、期限切れなら waiting へ落とす
// - hold も current も無いときだけ waiting 状態を返す
// =============================================================

(() => {
  try {
    const root = (window.ATVB = window.ATVB || {});

    // hold block を current 扱いで許容する最大の経過秒数。
    // これを超えた古い hold は破棄し、waiting へ落とす。
    const HOLD_WINDOW_SECONDS = 1.2;

    function normalizeText(text) {
      return String(text || "").trim();
    }

    function pickCurrentBlock(blocks, currentIndex) {
      const list = Array.isArray(blocks) ? blocks : [];
      if (!Number.isInteger(currentIndex)) return null;
      if (currentIndex < 0 || currentIndex >= list.length) return null;
      return list[currentIndex] || null;
    }

    function hasRenderableSignal(block) {
      if (!block || typeof block !== "object") return false;
      return Boolean(
        block.hasPrimarySignal ||
          block.hasSecondarySignal ||
          normalizeText(block.primaryText) ||
          normalizeText(block.secondaryText),
      );
    }

    // hold block が「今もまだ新しい」かどうかを、meta の now/currentTime と
    // block.endTime の差で判定する。now が block の再生区間より前、または
    // 終了直後 HOLD_WINDOW_SECONDS 以内なら新鮮とみなす。
    function isFreshHoldBlock(block, meta = null) {
      if (!block || typeof block !== "object") return false;
      const baseMeta = meta && typeof meta === "object" ? meta : {};
      const now = Number(baseMeta.now ?? baseMeta.currentTime ?? NaN);
      const endTime = Number(block?.endTime ?? NaN);
      const startTime = Number(block?.startTime ?? NaN);

      if (!Number.isFinite(now) || !Number.isFinite(endTime)) return false;
      if (Number.isFinite(startTime) && now < startTime - 5) return false;
      if (now < endTime) return true;
      return now - endTime <= HOLD_WINDOW_SECONDS;
    }

    function pickHoldBlock(meta = null) {
      const baseMeta = meta && typeof meta === "object" ? meta : {};
      const holdBlock = baseMeta.holdBlock || null;
      const holdViewBlock = baseMeta.holdView?.currentBlock || null;

      const sequenceTotal = Number(baseMeta.totalBlockCount ?? NaN);
      const holdTotal = Number(baseMeta.holdBlockTotalBlockCount ?? NaN);
      const sameSequence =
        Number.isFinite(sequenceTotal) && Number.isFinite(holdTotal)
          ? sequenceTotal === holdTotal
          : true;

      if (
        sameSequence &&
        hasRenderableSignal(holdBlock) &&
        isFreshHoldBlock(holdBlock, baseMeta)
      ) {
        return holdBlock;
      }

      if (
        sameSequence &&
        hasRenderableSignal(holdViewBlock) &&
        isFreshHoldBlock(holdViewBlock, baseMeta)
      ) {
        return holdViewBlock;
      }

      return null;
    }

    function buildSharedSubtitleViewFromBlock(currentBlock, meta = null) {
      const primaryText = normalizeText(currentBlock?.primaryText);
      const secondaryText = normalizeText(currentBlock?.secondaryText);
      const baseMeta = meta && typeof meta === "object" ? { ...meta } : {};

      return {
        primary: primaryText,
        secondary: secondaryText,
        isVisible: Boolean(primaryText || secondaryText),
        currentBlock: currentBlock || null,
        meta: baseMeta,
      };
    }

    function resolveUiSubtitleView(blocks, currentIndex, meta = null) {
      const list = Array.isArray(blocks) ? blocks : [];
      const currentBlock = pickCurrentBlock(list, currentIndex);
      const baseMeta = meta && typeof meta === "object" ? { ...meta } : {};
      const holdBlock = pickHoldBlock(baseMeta);
      const debugPanelProbe = Boolean(baseMeta.DEBUG_PANEL_PROBE);

      if (currentBlock) {
        const view = buildSharedSubtitleViewFromBlock(currentBlock, {
          ...baseMeta,
          viewStatus: "ready",
          waitingReason: "",
          totalBlockCount: list.length,
          currentIndex,
        });

        if (debugPanelProbe) {
          console.debug("[ATVB] subtitle-view-resolver debug", { // eslint-disable-line no-console
            currentIndex,
            totalBlockCount: list.length,
            resolutionSource: "currentBlock",
            currentBlock: {
              key: currentBlock.key || "",
              startTime: Number(currentBlock.startTime ?? 0),
              endTime: Number(currentBlock.endTime ?? 0),
              state: currentBlock.state || "",
              primaryText: normalizeText(currentBlock.primaryText),
              secondaryText: normalizeText(currentBlock.secondaryText),
            },
            subtitleViewPrimary: view.primary,
            subtitleViewSecondary: view.secondary,
            viewStatus: view.meta?.viewStatus || "",
          });
        }

        return view;
      }

      if (holdBlock) {
        const view = buildSharedSubtitleViewFromBlock(holdBlock, {
          ...baseMeta,
          viewStatus: "hold",
          waitingReason: "",
          totalBlockCount: list.length,
          currentIndex: Number.isInteger(currentIndex) ? currentIndex : null,
          resolutionSource: "holdBlock",
        });

        if (debugPanelProbe) {
          console.debug("[ATVB] subtitle-view-resolver debug", { // eslint-disable-line no-console
            currentIndex,
            totalBlockCount: list.length,
            resolutionSource: "holdBlock",
            currentBlock: {
              key: holdBlock.key || "",
              startTime: Number(holdBlock.startTime ?? 0),
              endTime: Number(holdBlock.endTime ?? 0),
              state: holdBlock.state || holdBlock.sourceReason || "",
              primaryText: normalizeText(holdBlock.primaryText),
              secondaryText: normalizeText(holdBlock.secondaryText),
            },
            subtitleViewPrimary: view.primary,
            subtitleViewSecondary: view.secondary,
            viewStatus: view.meta?.viewStatus || "",
          });
        }

        return view;
      }

      const waitingReason =
        list.length === 0 ? "empty_sequence" : "waiting_for_current_cue";

      const view = buildSharedSubtitleViewFromBlock(null, {
        ...baseMeta,
        viewStatus: "waiting",
        waitingReason,
        totalBlockCount: list.length,
        currentIndex: Number.isInteger(currentIndex) ? currentIndex : null,
      });

      if (debugPanelProbe) {
        console.debug("[ATVB] subtitle-view-resolver debug", { // eslint-disable-line no-console
          currentIndex,
          totalBlockCount: list.length,
          resolutionSource: "waiting",
          currentBlock: null,
          subtitleViewPrimary: view.primary,
          subtitleViewSecondary: view.secondary,
          viewStatus: view.meta?.viewStatus || "",
          waitingReason: view.meta?.waitingReason || "",
        });
      }

      return view;
    }

    root.subtitleViewResolver = {
      resolveUiSubtitleView,
    };
  } catch (error) {
    console.error("[ATVB] subtitle-view-resolver: failed", error); // eslint-disable-line no-console
  }
})();
