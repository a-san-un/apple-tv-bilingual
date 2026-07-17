(() => {
  const root = (window.ATVB = window.ATVB || {});
  const PLAYBACK_SKIP_BASE_LEFT_ATTR = "data-atvb-skip-base-left";
  const PLAYBACK_SKIP_BASE_RIGHT_ATTR = "data-atvb-skip-base-right";
  const PLAYBACK_SKIP_BASE_TRANSFORM_ATTR = "data-atvb-skip-base-transform";

  function createOverlayController({
    getOverlayRoot,
    setOverlayRoot,
    getTarget,
    showPopup,
    getPlaybackControlsLayoutTargets,
    PLAYBACK_CONTROLS_LAYOUT,
    setStyleIfChanged,
  }) {
    function buildOverlayShellHTML() {
      return `
      <style>
        #overlay {
          display: inline-block; background: rgba(0,0,0,0.58);
          border-radius: 6px; padding: 6px 14px;
          max-width: 90%; text-align: center; pointer-events: auto;
        }
        .sub-line {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: var(--atv-overlay-font-size, 22px); font-weight: 500; color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,0.8); line-height: 1.35;
        }
        .atv-word { cursor: pointer; border-radius: 2px; padding: 0 1px; }
        .atv-word:hover { background: rgba(255,220,80,0.4); }
      </style>
      <div id="overlay">
        <span class="sub-line" id="ov-primary"></span>
        <span class="sub-line" id="ov-secondary"></span>
      </div>
    `;
    }

    function wireOverlayUiEvents() {
      const rootNode = getOverlayRoot();
      if (!rootNode) return;

      rootNode.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const wordEl = target.closest(".atv-word");
        if (!wordEl) return;

        e.stopPropagation();

        const word = wordEl.dataset.word || "";
        if (!word) return;

        const sentence = wordEl.dataset.sentence || "";
        showPopup(
          word,
          decodeURIComponent(sentence),
          wordEl.getBoundingClientRect(),
          { source: "overlay" },
        );
      });
    }

    function updateOverlayTypography() {
      const rootNode = getOverlayRoot();
      if (!rootNode) return;

      const { video } = getPlaybackControlsLayoutTargets();
      const videoRect = video?.getBoundingClientRect?.() || null;
      const basisHeight =
        videoRect?.height ||
        window.innerHeight ||
        document.documentElement.clientHeight ||
        0;

      let rawFontSizePx = Math.round(basisHeight * 0.036);

      if (basisHeight >= 760) rawFontSizePx += 3;
      if (basisHeight >= 900) rawFontSizePx += 2;

      const fontSizePx = Math.max(20, Math.min(38, rawFontSizePx));

      rootNode.host.style.setProperty("--atv-overlay-font-size", `${fontSizePx}px`);
    }

    function getOverlayHost() {
      return getTarget().querySelector("#atv-overlay-host");
    }

    function updateOverlayHostPosition() {
      const overlayHost = getOverlayHost();
      if (!overlayHost) return;

      const progressById = document.querySelector("#playback-progress");
      const {
        progress,
        footer,
        video,
      } = getPlaybackControlsLayoutTargets();

      const anchorEl = progressById || progress || footer;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

      if (!anchorEl || !viewportHeight) {
        overlayHost.style.bottom = "96px";
        return;
      }

      const anchorRect = anchorEl.getBoundingClientRect();
      const videoRect = video?.getBoundingClientRect?.() || null;
      const gapPx = PLAYBACK_CONTROLS_LAYOUT.footerGapPx + 10;
      const minBottomPx = 96;

      let nextBottom = Math.round(viewportHeight - anchorRect.top + gapPx);

      if (videoRect) {
        const maxBottom = Math.max(
          minBottomPx,
          Math.round(viewportHeight - videoRect.bottom + videoRect.height * 0.22),
        );
        nextBottom = Math.min(nextBottom, maxBottom);
      }

      nextBottom = Math.max(minBottomPx, nextBottom);
      overlayHost.style.bottom = `${nextBottom}px`;
    }

    function setOverlayVisible(visible) {
      const overlayHost = getOverlayHost();
      if (!overlayHost) return;
      overlayHost.style.display = visible ? "" : "none";
      if (visible) {
        updateOverlayHostPosition();
        updateOverlayTypography();
      }
    }



    function destroyOverlay() {
      const overlayHost = getOverlayHost();
      if (overlayHost) overlayHost.remove();
      setOverlayRoot(null);
    }

    function createOverlay() {
      const target = getTarget();
      const existingHost = target.querySelector("#atv-overlay-host");
      if (existingHost) {
        setOverlayRoot(existingHost.shadowRoot || getOverlayRoot());
        return;
      }

      const host = document.createElement("div");
      host.id = "atv-overlay-host";
      host.style.cssText = [
        "position:fixed",
        "bottom:96px",
        "left:50%",
        "transform:translateX(-50%)",
        "width:80%",
        "max-width:900px",
        "z-index:99998",
        "pointer-events:none",
        "text-align:center",
      ].join(";");
      target.appendChild(host);

      updateOverlayHostPosition();

      const rootNode = host.attachShadow({ mode: "open" });
      setOverlayRoot(rootNode);
      rootNode.innerHTML = buildOverlayShellHTML();
      updateOverlayTypography();
      wireOverlayUiEvents();
    }

    /* overlay の 1 行テキストを word span 群へ変換する。 */
    function renderOverlayLineHtml(text) {
      const normalizedText = typeof text === "string" ? text : "";
      if (!normalizedText) return "";

      return normalizedText
        .split(" ")
        .map((word) => {
          const esc = word
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
          return `<span class="atv-word" data-word="${esc}" data-sentence="${encodeURIComponent(normalizedText)}">${esc}</span>`;
        })
        .join(" ");
    }

    /* overlay の表示 DOM を空にする。 */
    function clearOverlayLines() {
      const rootNode = getOverlayRoot();
      if (!rootNode) return;
      const p = rootNode.getElementById("ov-primary");
      const s = rootNode.getElementById("ov-secondary");
      if (!p || !s) return;
      p.innerHTML = "";
      s.innerHTML = "";
    }

    /* 単一テキストの overlay 更新を行う。 */
    function updateOverlay(primaryText, secondaryText) {
      const rootNode = getOverlayRoot();
      if (!rootNode) return;
      const p = rootNode.getElementById("ov-primary");
      const s = rootNode.getElementById("ov-secondary");
      if (!p || !s) return;
      if (!primaryText) {
        clearOverlayLines();
        return;
      }

      p.innerHTML = renderOverlayLineHtml(primaryText);
      s.textContent = secondaryText || "";
    }

    /* OverlayView を描画し、clear 条件もここで統一する。 */
    function updateOverlayFromView(view) {
      const rootNode = getOverlayRoot();
      if (!rootNode) return;

      const p = rootNode.getElementById("ov-primary");
      const s = rootNode.getElementById("ov-secondary");
      if (!p || !s) return;

      if (view?.isEmpty === true && view?.shouldKeepVisible === false) {
        clearOverlayLines();
        return;
      }

      const mainLines = Array.isArray(view?.mainLines) ? view.mainLines : [];
      const subLines = Array.isArray(view?.subLines) ? view.subLines : [];

      p.innerHTML = mainLines.map((line) => renderOverlayLineHtml(line)).filter(Boolean).join("<br>");
      s.innerHTML = subLines
        .map((line) =>
          String(line || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
        )
        .filter(Boolean)
        .join("<br>");
    }

    /* 移行期間中の block ベース更新を維持する legacy adapter。 */
    function updateOverlayFromBlock(block) {
      updateOverlay(block?.primaryText || "", block?.secondaryText || "");
    }

    return {
      setOverlayVisible,
      destroyOverlay,
      createOverlay,
      updateOverlay,
      updateOverlayFromView,
      updateOverlayFromBlock,
    };
  }

  root.overlayController = {
    createOverlayController,
  };
})();
