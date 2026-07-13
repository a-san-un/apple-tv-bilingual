(() => {
  const root = (window.ATVB = window.ATVB || {});

  function createOverlayController({
    getOverlayRoot,
    setOverlayRoot,
    getTarget,
    showPopup,
    getPlaybackControlsLayoutTargets,
    PLAYBACK_CONTROLS_LAYOUT,
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

    function updateOverlayHostPosition() {
      const overlayHost = getTarget().querySelector("#atv-overlay-host");
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

    function updateOverlay(primaryText, secondaryText) {
      const rootNode = getOverlayRoot();
      if (!rootNode) return;
      const p = rootNode.getElementById("ov-primary");
      const s = rootNode.getElementById("ov-secondary");
      if (!p || !s) return;
      if (!primaryText) {
        p.innerHTML = "";
        s.innerHTML = "";
        return;
      }

      p.innerHTML = primaryText
        .split(" ")
        .map((word) => {
          const esc = word
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
          return `<span class="atv-word" data-word="${esc}" data-sentence="${encodeURIComponent(primaryText)}">${esc}</span>`;
        })
        .join(" ");

      s.textContent = secondaryText || "";
    }

    return {
      buildOverlayShellHTML,
      wireOverlayUiEvents,
      updateOverlayTypography,
      updateOverlayHostPosition,
      createOverlay,
      updateOverlay,
    };
  }

  root.overlayController = {
    createOverlayController,
  };
})();
