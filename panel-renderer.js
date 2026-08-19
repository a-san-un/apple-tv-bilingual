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
      const seekTime = Array.isArray(block.cues) && block.cues[0]
        ? Number(block.cues[0].startTime ?? block.startTime)
        : Number(block.startTime ?? 0);

      return `
        <div
          class="${cls}"
          ${mid}
          data-time="${block.startTime}"
          data-seek-time="${seekTime}"
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

          const t = parseFloat(
            blockEl.dataset.seekTime || blockEl.dataset.time,
          );
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

    // 直近でスクロールを実行した current block の key を覚えておく。
    // 同じ current に対して renderPanel() が連続で呼ばれても、
    // 毎回スクロールをやり直して動きがガクつくのを防ぐ。
    let lastScrolledCurrentKey = null;

    // current block は「今再生しているブロックにマークが付いた状態」を維持する。
    // 上下に約1ブロック分の余白を確保し、
    // 余白を割り込んだときだけ current 行を余白ぶん離れた位置へ戻す。
    // (下端の余白を割り込んだ場合、結果的に current 行は
    //  スクロールによって画面下から画面上の余白位置まで移動して見える)
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

      // 上下の余白は「1ブロック分」に固定する。
      // ブロックごとに高さが変わっても、余白の考え方をぶらさない。
      const margin = currentRect.height || 56;

      const viewTop = scroller.scrollTop + margin;
      const viewBottom = scroller.scrollTop + scroller.clientHeight - margin;

      const maxScrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );

      // current block を一意に識別する key（同一判定用）。
      const currentKey =
        current.getAttribute("data-seek-time") ||
        current.getAttribute("data-time") ||
        "";

      const isSameAsLastScrolled =
        Boolean(currentKey) && currentKey === lastScrolledCurrentKey;

      // 上余白を割り込んでいる場合（巻き戻し・シーク直後など）。
      if (currentTop < viewTop) {
        const target = Math.max(
          0,
          Math.min(maxScrollTop, currentTop - margin),
        );
        scroller.scrollTo({
          top: target,
          behavior: isSameAsLastScrolled ? "auto" : "smooth",
        });
        lastScrolledCurrentKey = currentKey;
        return;
      }

      // 下余白まで到達したら、current 行を上余白ぶん離れた位置へ戻す。
      // 同じ current に対しては再発火させない。
      if (currentBottom > viewBottom && !isSameAsLastScrolled) {
        const target = Math.max(
          0,
          Math.min(maxScrollTop, currentTop - margin),
        );
        scroller.scrollTo({ top: target, behavior: "smooth" });
        lastScrolledCurrentKey = currentKey;
      }
    }

    // state.subtitleBlocks を panel 表示用 block 配列へ正規化する。
    // 旧 Array 形式と、新しい { blocks, currentIndex, meta } 形式の両方を受ける。
    // strict current が無ければ currentTime 最寄り block を current 扱いにする。
    function getAllPanelBlocks(currentTime) {
      const subtitleBlocksState = state.subtitleBlocks;
      const sourceBlocks = Array.isArray(subtitleBlocksState)
        ? subtitleBlocksState.slice()
        : Array.isArray(subtitleBlocksState?.blocks)
          ? subtitleBlocksState.blocks.slice()
          : [];

      const sequenceCurrentIndex = Number.isInteger(subtitleBlocksState?.currentIndex)
        ? subtitleBlocksState.currentIndex
        : -1;

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

      let currentIndex =
        sequenceCurrentIndex >= 0 && sequenceCurrentIndex < normalizedBlocks.length
          ? sequenceCurrentIndex
          : normalizedBlocks.findIndex((block) => block.state === "current");

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
      const subtitleViewCurrentBlock = subtitleView?.currentBlock || null;
      const { primary: subtitleViewPrimary, secondary: subtitleViewSecondary } =
        getSubtitleViewTexts(subtitleView);

      const {
        panelBlocks: basePanelBlocks,
        currentIndex,
        currentBlock: baseCurrentBlock,
      } = getAllPanelBlocks(currentTime);

      const resolvedCurrentBlock =
        subtitleViewCurrentBlock ||
        (currentIndex >= 0 ? basePanelBlocks[currentIndex] || null : null) ||
        baseCurrentBlock ||
        null;

      const panelBlocks = basePanelBlocks.map((block, index) => {
        const isCurrent =
          index === currentIndex ||
          (resolvedCurrentBlock &&
            block?.key &&
            resolvedCurrentBlock?.key &&
            block.key === resolvedCurrentBlock.key);

        if (!isCurrent) {
          return {
            ...block,
            primary: block.primaryText || block.primary || "",
            secondary: block.secondaryText || block.secondary || "",
          };
        }

        const fallbackPrimary =
          subtitleViewPrimary ||
          resolvedCurrentBlock?.primaryText ||
          block.primaryText ||
          block.primary ||
          "";

        const fallbackSecondary =
          subtitleViewSecondary ||
          resolvedCurrentBlock?.secondaryText ||
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
        resolvedCurrentBlock ||
        (currentIndex >= 0 ? panelBlocks[currentIndex] || null : null) ||
        null;

      const curPrimaryCue =
        currentBlock &&
        state.primaryTrack &&
        Number.isFinite(currentBlock.startTime)
          ? findCueAt(state.primaryTrack, currentBlock.startTime + 0.01)
          : null;

      if (false && typeof logContent === "function") {
        logContent("panel render blocks debug", {
          currentTime,
          currentBlock: currentBlock
            ? {
                key: currentBlock.key || null,
                startTime: currentBlock.startTime ?? null,
                endTime: currentBlock.endTime ?? null,
                state: currentBlock.state || null,
                primaryPreview: String(currentBlock.primaryText || currentBlock.primary || "").slice(0, 80),
                secondaryPreview: String(currentBlock.secondaryText || currentBlock.secondary || "").slice(0, 80),
              }
            : null,
          stateCurrentSubtitleBlock: state.currentSubtitleBlock || null,
          subtitleViewCurrentBlock: subtitleViewCurrentBlock || null,
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

      // ブロック構成（件数 + 各ブロックの識別子）の signature を作る。
      // 前回描画と同じ構成であれば、DOM を丸ごと作り直さない。
      const blockSignature = panelBlocks
        .map((block) => `${block.key || block.startTime || ""}`)
        .join("|");

      const shouldRebuildList = state.lastPanelBlockSignature !== blockSignature;

      // ブロックの追加/削除がリストのどこで起きても、
      // ユーザーが見ている位置が視覚的にズレないようにする。
      // scrollHeight の差分ではなく、「現在ビューポート上端に
      // 見えている実在のブロック（アンカー）」を基準に、
      // 再構築後も同じ見た目の位置へ scrollTop を復元する。
      const scrollerEl =
        state.panelShadowRoot?.getElementById("panel-scroll") || null;

      let anchorKey = null;
      let anchorViewportOffset = 0;

      if (scrollerEl) {
        const scrollerRect = scrollerEl.getBoundingClientRect();
        const candidates = Array.from(
          list.querySelectorAll(".subtitle-block"),
        );
        // ビューポート上端に最初にかかっている要素をアンカーにする。
        const anchorEl = candidates.find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.bottom > scrollerRect.top;
        });

        if (anchorEl) {
          const anchorRect = anchorEl.getBoundingClientRect();
          anchorKey =
            anchorEl.getAttribute("data-seek-time") ||
            anchorEl.getAttribute("data-time");
          // ビューポート上端からアンカーまでの距離（見た目上の位置）。
          anchorViewportOffset = anchorRect.top - scrollerRect.top;
        }
      }

      if (shouldRebuildList) {
        list.innerHTML = panelBlocks
          .map((block) => buildPanelBlockHtml(block))
          .join("");

        bindPanelBlockInteractions(list);
        state.lastPanelBlockSignature = blockSignature;

        if (scrollerEl && anchorKey !== null) {
          const newAnchorEl = list.querySelector(
            `[data-seek-time="${anchorKey}"]`,
          );
          if (newAnchorEl) {
            // ★ offsetTop は使わない。
            // #panel はShadow DOM内にあり、#panel-scroll / .subtitle-block に
            // position指定が無いため、offsetParent の探索が Shadow DOM の
            // 境界を越えてページ側まで遡ってしまい、無関係な絶対座標が
            // 返ってくることがある。
            // getBoundingClientRect() はビューポート基準の絶対座標であり、
            // offsetParent の有無や Shadow DOM 境界に影響されないため、
            // #panel-scroll という「実際にスクロールする要素」の中での
            // 相対位置を確実に再現できる。
            const scrollerRectNow = scrollerEl.getBoundingClientRect();
            const newAnchorRectNow = newAnchorEl.getBoundingClientRect();

            // 再構築直後、現状の scrollTop のままでアンカーが
            // ビューポート上端からどれだけ離れて見えているか。
            const currentViewportOffset =
              newAnchorRectNow.top - scrollerRectNow.top;

            // 「見たかった位置(anchorViewportOffset)」との差分だけ
            // scrollTop を動かす。
            const delta = currentViewportOffset - anchorViewportOffset;

            const maxScrollTop = Math.max(
              0,
              scrollerEl.scrollHeight - scrollerEl.clientHeight,
            );
            scrollerEl.scrollTop = Math.max(
              0,
              Math.min(maxScrollTop, scrollerEl.scrollTop + delta),
            );
          }
        }
      } else {
        // 構成が同じ場合は current の付け替えだけ行い、
        // スクロールアニメーションを中断させないようにする。
        const existingCurrent = list.querySelector("#current-block");
        if (existingCurrent && existingCurrent.id === "current-block") {
          existingCurrent.removeAttribute("id");
          existingCurrent.setAttribute("data-sequential-current", "false");
          existingCurrent.setAttribute("data-panel-emphasized", "false");
          const mark = existingCurrent.querySelector(".subtitle-mark");
          if (mark) mark.innerHTML = "";
        }

        const newCurrentEl = currentBlock
          ? list.querySelector(
              `[data-seek-time="${currentBlock.startTime ?? ""}"]`,
            )
          : null;
        if (newCurrentEl) {
          newCurrentEl.id = "current-block";
          newCurrentEl.setAttribute("data-sequential-current", "true");
          newCurrentEl.setAttribute("data-panel-emphasized", "true");
          const mark = newCurrentEl.querySelector(".subtitle-mark");
          if (mark) {
            mark.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`;
          }
        }
      }

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
