// =============================================================
// Apple TV+ Bilingual Subtitles - panel-renderer.js
// version: 2.7.2
//
// 役割:
// - 右字幕パネルの list 描画責務を担当する
// - panel は resolver の window 表示に依存せず、取得済み subtitleBlocks 全件を表示する
// - 過去 / 現在 / 未来をひとつのスクロールリストとして扱う
// - 現在行だけ subtitleView / currentSubtitleBlock で補強し、強調表示する
//
// 方針:
// - truth は state.subtitleBlocks（取得済み字幕ブロック全件）
// - panel は常に全件ビュー
// - strict current が取れればそれを使い、取れなければ currentTime に最も近い block を current 扱いにする
// - panel は current block を常時中央追従させず、下端近くまで来たら
//   上から 1〜2 行ぶん余白を残す位置へ送る自動スクロールを行う
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  function createPanelRenderer(deps = {}) {
    const {
      state,
      makeClickableSpans,
      formatTime,
      showPopup,
      findCueAt,
      logContent,
    } = deps;

    // view schema 差分を吸収し、primary / secondary を安定して引けるようにする。
    // 新 schema を優先しつつ、旧 mainLines / subLines にも後方互換を残す。
    function getSubtitleViewTexts(subtitleView) {
      const primary = String(
        subtitleView?.primary ||
          (Array.isArray(subtitleView?.mainLines)
            ? subtitleView.mainLines.join("\n")
            : "") ||
          "",
      ).trim();

      const secondary = String(
        subtitleView?.secondary ||
          (Array.isArray(subtitleView?.subLines)
            ? subtitleView.subLines.join("\n")
            : "") ||
          "",
      ).trim();

      return {
        primary,
        secondary,
      };
    }

    // block から panel 描画用の primary / secondary を安全に取り出す。
    function getBlockTexts(block) {
      return {
        primary: String(block?.primaryText || block?.primary || "").trim(),
        secondary: String(block?.secondaryText || block?.secondary || "").trim(),
      };
    }

    function buildPanelBlockHtml(block) {
      const isWindowCurrent = block.isWindowCurrent === true;
      const isSequentialCurrent =
        block.isSequentialCurrent ?? block.state === "current";
      const isPanelEmphasized =
        block.isPanelEmphasized ?? block.state === "current";

      const cls = "subtitle-block";
      const mid = isSequentialCurrent ? 'id="current-block"' : "";
      const mark = isPanelEmphasized
        ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`
        : "";

      const { primary, secondary } = getBlockTexts(block);
      const pText = makeClickableSpans(primary, primary);
      const sText = makeClickableSpans(secondary, primary);

      return `
        <div
          class="${cls}"
          ${mid}
          data-time="${block.startTime}"
          data-window-current="${isWindowCurrent ? "true" : "false"}"
          data-sequential-current="${isSequentialCurrent ? "true" : "false"}"
          data-panel-emphasized="${isPanelEmphasized ? "true" : "false"}"
        >
          <div class="subtitle-row">
            <div class="subtitle-mark">${mark}</div>
            <div class="subtitle-content">
              <div class="subtitle-time">${formatTime(block.startTime)}</div>
              <div class="subtitle-primary">${pText}</div>
              ${sText ? `<div class="subtitle-secondary">${sText}</div>` : ""}
            </div>
          </div>
        </div>
      `;
    }

    // panel 内の .atv-word に hover / click を結び、popup を表示する。
    function bindPanelWordInteractions(blockEl) {
      blockEl.querySelectorAll(".atv-word").forEach((span) => {
        span.addEventListener("mouseenter", () => {
          span.style.background = "rgba(255,220,80,0.3)";
        });

        span.addEventListener("mouseleave", () => {
          span.style.background = "";
        });

        span.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();

          const word = String(span.dataset.word || "").trim();
          const sentence = decodeURIComponent(span.dataset.sentence || "");

          if (!word) return;

          showPopup(word, sentence, span.getBoundingClientRect(), {
            source: "panel",
          });
        });
      });
    }

    // 行クリックで該当 startTime へ seek する。
    // 単語 click は popup 優先なのでここでは除外する。
    function bindPanelBlockInteractions(list) {
      list.querySelectorAll(".subtitle-block").forEach((blockEl) => {
        bindPanelWordInteractions(blockEl);

        blockEl.addEventListener("click", (e) => {
          if (e.target.classList.contains("atv-word")) return;

          e.stopPropagation();
          e.preventDefault();

          const t = parseFloat(blockEl.dataset.time);
          if (state.video && !Number.isNaN(t)) {
            state.video.currentTime = t;
            setTimeout(() => renderPanel(), 100);
          }
        });
      });
    }

    // 最後に描画した current block snapshot を state に残す。
    // panel / overlay のズレ確認時の観測点として使う。
    function updatePanelRenderSnapshot({
      currentBlock,
      displayBlocks,
      curPrimaryCue,
      subtitleView,
    }) {
      const renderedCurrentBlock =
        currentBlock ||
        subtitleView?.currentBlock ||
        (Array.isArray(displayBlocks)
          ? displayBlocks.find((block) => block.state === "current") || null
          : null);

      const stateCurrentBlock = state.currentSubtitleBlock || null;
      const { primary: uiPrimaryText, secondary: uiSecondaryText } =
        getSubtitleViewTexts(subtitleView);

      const currentSubtitleBlock = stateCurrentBlock
        ? {
            ...stateCurrentBlock,
            primaryText: uiPrimaryText || stateCurrentBlock.primaryText || "",
            secondaryText:
              uiSecondaryText || stateCurrentBlock.secondaryText || "",
          }
        : renderedCurrentBlock
          ? {
              ...renderedCurrentBlock,
              primaryText:
                uiPrimaryText ||
                renderedCurrentBlock.primaryText ||
                renderedCurrentBlock.primary ||
                "",
              secondaryText:
                uiSecondaryText ||
                renderedCurrentBlock.secondaryText ||
                renderedCurrentBlock.secondary ||
                "",
            }
          : uiPrimaryText || uiSecondaryText
            ? {
                primaryText: uiPrimaryText,
                secondaryText: uiSecondaryText,
              }
            : null;

      state.lastPanelRenderSnapshot = {
        allBlocksCount: Array.isArray(displayBlocks) ? displayBlocks.length : 0,
        currentSubtitleBlock,
      };

      if (curPrimaryCue && currentSubtitleBlock?.primaryText) {
        state.lastPrimarySnapshotAt = Date.now();
      }
    }

    // current block は常時追従させず、
    // 下端近くまで来たときだけ current 行を上側へ送り返す。
    // 送り先は上端ぴったりではなく、1〜2 行ぶんの余白を残す。
    function scrollCurrentPanelBlockIntoView() {
      const root = state.panelShadowRoot;
      if (!root) return;

      const scroller = root.getElementById("panel-scroll");
      const current = root.getElementById("current-block");
      if (!scroller || !current) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();

      const currentTop =
        currentRect.top - scrollerRect.top + scroller.scrollTop;
      const currentBottom = currentTop + currentRect.height;

      // 上側に残したい余白。1〜2行ぶんを少し広めに取る。
      const topPadding = Math.max(currentRect.height * 1.5, 56);

      // 下端判定は「最後の1〜2ブロック付近」に入ったかどうかの目安。
      const bottomThreshold =
        scroller.scrollTop + scroller.clientHeight - currentRect.height * 2;

      // current が上へ外れていた場合だけ最小限戻す。
      if (currentTop < scroller.scrollTop + topPadding) {
        scroller.scrollTo({
          top: Math.max(0, currentTop - topPadding),
          behavior: "smooth",
        });
        return;
      }

      // current が下端近くに来たら、
      // current 行を上から 1〜2 行ぶん空けた位置へ送る。
      if (currentBottom > bottomThreshold) {
        scroller.scrollTo({
          top: Math.max(0, currentTop - topPadding),
          behavior: "smooth",
        });
      }
    }

    // state.subtitleBlocks を panel 表示用 block 配列へ正規化する。
    // strict current が無ければ currentTime 最寄り block を current 扱いにする。
    function getAllPanelBlocks(currentTime) {
      const sourceBlocks = Array.isArray(state.subtitleBlocks)
        ? state.subtitleBlocks.slice()
        : [];

      const normalizedBlocks = sourceBlocks
        .filter((block) => block && typeof block === "object")
        .map((block, index) => ({
          ...block,
          key: block.key || `subtitle-block-${index}`,
          primary: block.primary || block.primaryText || "",
          secondary: block.secondary || block.secondaryText || "",
          primaryText: block.primaryText || block.primary || "",
          secondaryText: block.secondaryText || block.secondary || "",
        }))
        .sort((a, b) => {
          const aStart = Number(a.startTime ?? 0);
          const bStart = Number(b.startTime ?? 0);
          return aStart - bStart;
        });

      let currentIndex = normalizedBlocks.findIndex(
        (block) => block.state === "current",
      );

      if (currentIndex < 0 && normalizedBlocks.length > 0) {
        let closestIndex = 0;
        let closestDelta = Number.POSITIVE_INFINITY;

        for (let i = 0; i < normalizedBlocks.length; i++) {
          const block = normalizedBlocks[i];
          const start = Number(block.startTime ?? 0);
          const end = Number(block.endTime ?? start);
          const center = (start + end) / 2;
          const delta = Math.abs(center - currentTime);

          if (delta < closestDelta) {
            closestDelta = delta;
            closestIndex = i;
          }
        }

        currentIndex = closestIndex;
      }

      const panelBlocks = normalizedBlocks.map((block, index) => {
        const isCurrent = index === currentIndex;
        const start = Number(block.startTime ?? 0);
        const end = Number(block.endTime ?? start);

        let derivedState = block.state;
        if (!derivedState) {
          if (isCurrent) {
            derivedState = "current";
          } else if (end < currentTime) {
            derivedState = "past";
          } else {
            derivedState = "future";
          }
        }

        return {
          ...block,
          state: isCurrent ? "current" : derivedState,
          isWindowCurrent: isCurrent,
          isSequentialCurrent: isCurrent,
          isPanelEmphasized: isCurrent,
        };
      });

      return {
        panelBlocks,
        currentIndex,
        currentBlock:
          currentIndex >= 0 ? panelBlocks[currentIndex] || null : null,
      };
    }

    function renderPanel() {
      if (!state.panelShadowRoot) return;

      const list = state.panelShadowRoot.getElementById("subtitle-list");
      if (!list) return;

      const currentTime = state.video ? state.video.currentTime : 0;
      const subtitleView = state.currentSubtitleView || null;
      const { primary: subtitleViewPrimary, secondary: subtitleViewSecondary } =
        getSubtitleViewTexts(subtitleView);

      const {
        panelBlocks: basePanelBlocks,
        currentIndex,
        currentBlock: baseCurrentBlock,
      } = getAllPanelBlocks(currentTime);

      // current 行だけ shared subtitle view を優先し、panel / overlay を揃えやすくする。
      const panelBlocks = basePanelBlocks.map((block, index) => {
        const isCurrent = index === currentIndex;

        if (!isCurrent) {
          return {
            ...block,
            primary: block.primaryText || block.primary || "",
            secondary: block.secondaryText || block.secondary || "",
          };
        }

        const fallbackPrimary =
          subtitleViewPrimary ||
          state.currentSubtitleBlock?.primaryText ||
          block.primaryText ||
          block.primary ||
          "";

        const fallbackSecondary =
          subtitleViewSecondary ||
          state.currentSubtitleBlock?.secondaryText ||
          block.secondaryText ||
          block.secondary ||
          "";

        return {
          ...block,
          primary: fallbackPrimary,
          secondary: fallbackSecondary,
          primaryText: fallbackPrimary,
          secondaryText: fallbackSecondary,
          state: "current",
          isWindowCurrent: true,
          isSequentialCurrent: true,
          isPanelEmphasized: true,
        };
      });

      const currentBlock =
        currentIndex >= 0 ? panelBlocks[currentIndex] || null : baseCurrentBlock;

      const curPrimaryCue =
        currentBlock &&
        state.primaryTrack &&
        Number.isFinite(currentBlock.startTime)
          ? findCueAt(state.primaryTrack, currentBlock.startTime + 0.01)
          : null;

      if (typeof logContent === "function") {
        logContent("panel render blocks debug", {
          currentTime,
          currentBlock: currentBlock
            ? {
                key: currentBlock.key || null,
                startTime: currentBlock.startTime ?? null,
                endTime: currentBlock.endTime ?? null,
                state: currentBlock.state || null,
                primaryPreview: String(currentBlock.primary || "").slice(0, 80),
                secondaryPreview: String(currentBlock.secondary || "").slice(
                  0,
                  80,
                ),
              }
            : null,
          stateCurrentSubtitleBlock: state.currentSubtitleBlock || null,
          subtitleViewPrimary,
          subtitleViewSecondary,
          panelBlocksPreview: panelBlocks
            .slice(
              Math.max(0, currentIndex - 2),
              currentIndex >= 0 ? currentIndex + 3 : 5,
            )
            .map((block) => ({
              startTime: block.startTime ?? null,
              state: block.state || null,
              isPanelEmphasized: block.isPanelEmphasized ?? null,
              primaryPreview: String(block.primary || "").slice(0, 80),
              secondaryPreview: String(block.secondary || "").slice(0, 80),
            })),
          totalBlockCount: panelBlocks.length,
        });
      }

      updatePanelRenderSnapshot({
        currentBlock,
        displayBlocks: panelBlocks,
        curPrimaryCue,
        subtitleView,
      });

      list.innerHTML = panelBlocks
        .map((block) => buildPanelBlockHtml(block))
        .join("");

      bindPanelBlockInteractions(list);
      scrollCurrentPanelBlockIntoView();
    }

    return {
      renderPanel,
    };
  }

  window.ATVB.panelRenderer = {
    createPanelRenderer,
  };
})();
