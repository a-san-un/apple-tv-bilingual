(function () {
  "use strict";

  const PLAYBACK_CONTROLS_LAYOUT = {
    headerSelector: ".video-player__header",
    controlsSelector: ".video-player__controls",
    progressSelector: ".video-player__progress",
    metadataSelector: ".video-player__metadata",
    tabsSelector: ".video-player__tabs",
    autoSubsNoteSelector: ".video-player__auto-subs-note",
    skipOverlaySelector:
      ".skip-overlay__button-container, .skip-overlay__controls-container",
    footerSelector: ".video-player__footer.scrubbing-extensionEnabled",
    footerFallbackSelector: ".video-player__footer",
    unifiedSelector: ".unified-controls",
    volumeSelector: "amp-volume-control-unified",
    volumeFallbackSelector: ".volume-unified",
    panelSelector: "#atv-panel-host",
    videoSelector: ".video-player__video-container",
    footerGapPx: 8,
    footerSafeGutterPx: 16,
  };

  const PLAYBACK_CONTROLS_BASE_TRANSFORM_ATTR = "data-atvb-base-transform";
  const PLAYBACK_CONTROLS_MANAGED_ATTR = "data-atvb-layout-managed";
  const PLAYBACK_CONTROLS_SHIFT_X_ATTR = "data-atvb-shift-x";
  const PLAYBACK_SKIP_BASE_RIGHT_ATTR = "data-atvb-playback-skip-base-right";
  const PLAYBACK_SKIP_BASE_TRANSFORM_ATTR = "data-atvb-playback-skip-base-transform";
  const PLAYBACK_HEADER_BASE_WIDTH_ATTR = "data-atvb-header-base-width";
  const PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR = "data-atvb-header-base-max-width";
  const PLAYBACK_FOOTER_BASE_WIDTH_ATTR = "data-atvb-footer-base-width";
  const PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR = "data-atvb-footer-base-max-width";
  const PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR =
    "data-atvb-progress-base-min-width";
  const PLAYBACK_PROGRESS_BASE_WIDTH_ATTR = "data-atvb-progress-base-width";
  const PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR =
    "data-atvb-progress-base-max-width";
  const PLAYBACK_SKIP_BASE_LEFT_ATTR = "data-atvb-playback-skip-base-left";

  function createPlaybackControlsLayout(deps) {
    const {
      DEBUG_SECONDARY_SUBS,
      logContent,
      secondarySubtitleDom,
    } = deps;

    function getPlaybackControlsLayoutTargets() {
      return {
        panel:
          document.querySelector(PLAYBACK_CONTROLS_LAYOUT.panelSelector) ||
          secondarySubtitleDom?.getElement(),
        header: document.querySelector(PLAYBACK_CONTROLS_LAYOUT.headerSelector),
        controls: document.querySelector(
          PLAYBACK_CONTROLS_LAYOUT.controlsSelector,
        ),
        progress: document.querySelector(
          PLAYBACK_CONTROLS_LAYOUT.progressSelector,
        ),
        skipOverlay: document.querySelector(
          PLAYBACK_CONTROLS_LAYOUT.skipOverlaySelector,
        ),
        footer:
          document.querySelector(PLAYBACK_CONTROLS_LAYOUT.footerSelector) ||
          document.querySelector(PLAYBACK_CONTROLS_LAYOUT.footerFallbackSelector),
        unified: document.querySelector(PLAYBACK_CONTROLS_LAYOUT.unifiedSelector),
        volume:
          document.querySelector(PLAYBACK_CONTROLS_LAYOUT.volumeSelector) ||
          document.querySelector(PLAYBACK_CONTROLS_LAYOUT.volumeFallbackSelector),
        video: document.querySelector(PLAYBACK_CONTROLS_LAYOUT.videoSelector),
      };
    }

    function isVisibleElement(el) {
      if (!el) return false;
      if (!el.isConnected) return false;
      if (el.getClientRects().length === 0) return false;
      return getComputedStyle(el).display !== "none";
    }

    function composeManagedTransform(baseTransform, shiftX) {
      const normalizedBase = String(baseTransform || "").trim();
      const normalizedShift =
        Math.abs(shiftX) < 0.5 ? 0 : Number(shiftX.toFixed(2));

      if (!normalizedShift) return normalizedBase;

      const shiftTransform = `translateX(${normalizedShift}px)`;
      return normalizedBase
        ? `${normalizedBase} ${shiftTransform}`
        : shiftTransform;
    }

    function setTransformIfChanged(el, value) {
      if (!el) return;
      const normalizedNext = String(value || "").trim();
      const normalizedCurrent = String(el.style.transform || "").trim();
      if (normalizedCurrent === normalizedNext) return;
      el.style.transform = normalizedNext;
    }

    function setStyleIfChanged(el, propertyName, value) {
      if (!el) return;
      const next = String(value || "");
      if (el.style[propertyName] === next) return;
      el.style[propertyName] = next;
    }

    function applyManagedTranslateX(el, shiftX) {
      if (!el) return;

      const managed = el.getAttribute(PLAYBACK_CONTROLS_MANAGED_ATTR) === "1";
      const baseTransform = managed
        ? el.getAttribute(PLAYBACK_CONTROLS_BASE_TRANSFORM_ATTR) || ""
        : String(el.style.transform || "").trim();

      if (!managed) {
        el.setAttribute(PLAYBACK_CONTROLS_BASE_TRANSFORM_ATTR, baseTransform);
      }

      const composed = composeManagedTransform(baseTransform, shiftX);
      setTransformIfChanged(el, composed);
      el.setAttribute(PLAYBACK_CONTROLS_SHIFT_X_ATTR, String(shiftX || 0));
      el.setAttribute(PLAYBACK_CONTROLS_MANAGED_ATTR, "1");
    }

    function getManagedShiftX(el) {
      if (!el) return 0;
      const raw = el.getAttribute(PLAYBACK_CONTROLS_SHIFT_X_ATTR);
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function clearManagedTranslateX(el) {
      if (!el) return;
      if (el.getAttribute(PLAYBACK_CONTROLS_MANAGED_ATTR) !== "1") return;

      const baseTransform =
        el.getAttribute(PLAYBACK_CONTROLS_BASE_TRANSFORM_ATTR) || "";
      setTransformIfChanged(el, baseTransform);
      el.removeAttribute(PLAYBACK_CONTROLS_SHIFT_X_ATTR);
      el.removeAttribute(PLAYBACK_CONTROLS_BASE_TRANSFORM_ATTR);
      el.removeAttribute(PLAYBACK_CONTROLS_MANAGED_ATTR);
    }

    function applyManagedFooterSizing(footer, widthPx, leftPx = 0) {
      if (!footer) return;

      if (!footer.hasAttribute(PLAYBACK_FOOTER_BASE_WIDTH_ATTR)) {
        footer.setAttribute(
          PLAYBACK_FOOTER_BASE_WIDTH_ATTR,
          footer.style.width || "",
        );
      }
      if (!footer.hasAttribute(PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR)) {
        footer.setAttribute(
          PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR,
          footer.style.maxWidth || "",
        );
      }

      const safeWidth = `${Math.max(0, widthPx).toFixed(2)}px`;
      setStyleIfChanged(footer, "width", safeWidth);
      setStyleIfChanged(footer, "maxWidth", safeWidth);
      applyManagedInlineStyle(
        footer,
        "footer",
        "marginLeft",
        `${Math.max(0, leftPx).toFixed(2)}px`,
      );
      applyManagedInlineStyle(footer, "footer", "marginRight", "auto");
    }

    function clearManagedFooterSizing(footer) {
      if (!footer) return;

      if (footer.hasAttribute(PLAYBACK_FOOTER_BASE_WIDTH_ATTR)) {
        setStyleIfChanged(
          footer,
          "width",
          footer.getAttribute(PLAYBACK_FOOTER_BASE_WIDTH_ATTR) || "",
        );
        footer.removeAttribute(PLAYBACK_FOOTER_BASE_WIDTH_ATTR);
      }

      if (footer.hasAttribute(PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR)) {
        setStyleIfChanged(
          footer,
          "maxWidth",
          footer.getAttribute(PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR) || "",
        );
        footer.removeAttribute(PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR);
      }

      clearManagedInlineStyle(footer, "footer", "marginLeft");
      clearManagedInlineStyle(footer, "footer", "marginRight");
    }

    function applyManagedHeaderSizing(header, widthPx, leftPx = 0) {
      if (!header) return;

      if (!header.hasAttribute(PLAYBACK_HEADER_BASE_WIDTH_ATTR)) {
        header.setAttribute(
          PLAYBACK_HEADER_BASE_WIDTH_ATTR,
          header.style.width || "",
        );
      }
      if (!header.hasAttribute(PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR)) {
        header.setAttribute(
          PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR,
          header.style.maxWidth || "",
        );
      }

      const safeWidth = `${Math.max(0, widthPx).toFixed(2)}px`;
      setStyleIfChanged(header, "width", safeWidth);
      setStyleIfChanged(header, "maxWidth", safeWidth);
      applyManagedInlineStyle(
        header,
        "header",
        "marginLeft",
        `${Math.max(0, leftPx).toFixed(2)}px`,
      );
      applyManagedInlineStyle(header, "header", "marginRight", "auto");
    }

    function clearManagedHeaderSizing(header) {
      if (!header) return;

      if (header.hasAttribute(PLAYBACK_HEADER_BASE_WIDTH_ATTR)) {
        setStyleIfChanged(
          header,
          "width",
          header.getAttribute(PLAYBACK_HEADER_BASE_WIDTH_ATTR) || "",
        );
        header.removeAttribute(PLAYBACK_HEADER_BASE_WIDTH_ATTR);
      }

      if (header.hasAttribute(PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR)) {
        setStyleIfChanged(
          header,
          "maxWidth",
          header.getAttribute(PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR) || "",
        );
        header.removeAttribute(PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR);
      }

      clearManagedInlineStyle(header, "header", "marginLeft");
      clearManagedInlineStyle(header, "header", "marginRight");
    }

    function _applyManagedProgressInset(progress) {
      if (!progress) return;

      if (!progress.hasAttribute(PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR)) {
        progress.setAttribute(
          PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR,
          progress.style.minWidth || "",
        );
      }
      if (!progress.hasAttribute(PLAYBACK_PROGRESS_BASE_WIDTH_ATTR)) {
        progress.setAttribute(
          PLAYBACK_PROGRESS_BASE_WIDTH_ATTR,
          progress.style.width || "",
        );
      }
      if (!progress.hasAttribute(PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR)) {
        progress.setAttribute(
          PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR,
          progress.style.maxWidth || "",
        );
      }

      setStyleIfChanged(progress, "minWidth", "0");
      setStyleIfChanged(progress, "width", "calc(100% - 48px)");
      setStyleIfChanged(progress, "maxWidth", "calc(100% - 48px)");
    }

    function clearManagedProgressInset(progress) {
      if (!progress) return;

      if (progress.hasAttribute(PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR)) {
        setStyleIfChanged(
          progress,
          "minWidth",
          progress.getAttribute(PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR) || "",
        );
        progress.removeAttribute(PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR);
      }
      if (progress.hasAttribute(PLAYBACK_PROGRESS_BASE_WIDTH_ATTR)) {
        setStyleIfChanged(
          progress,
          "width",
          progress.getAttribute(PLAYBACK_PROGRESS_BASE_WIDTH_ATTR) || "",
        );
        progress.removeAttribute(PLAYBACK_PROGRESS_BASE_WIDTH_ATTR);
      }
      if (progress.hasAttribute(PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR)) {
        setStyleIfChanged(
          progress,
          "maxWidth",
          progress.getAttribute(PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR) || "",
        );
        progress.removeAttribute(PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR);
      }
    }

    function getManagedInlineStyleAttr(scope, propertyName) {
      return `data-atvb-${scope}-${propertyName.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
    }

    function applyManagedInlineStyle(el, scope, propertyName, value) {
      if (!el) return;
      const attrName = getManagedInlineStyleAttr(scope, propertyName);
      if (!el.hasAttribute(attrName)) {
        el.setAttribute(attrName, el.style[propertyName] || "");
      }
      setStyleIfChanged(el, propertyName, value);
    }

    function clearManagedInlineStyle(el, scope, propertyName) {
      if (!el) return;
      const attrName = getManagedInlineStyleAttr(scope, propertyName);
      if (!el.hasAttribute(attrName)) return;
      setStyleIfChanged(el, propertyName, el.getAttribute(attrName) || "");
      el.removeAttribute(attrName);
    }

    function applyManagedSkipPosition(skipOverlay, safeAreaRight) {
      if (!skipOverlay) return;

      if (!skipOverlay.hasAttribute(PLAYBACK_SKIP_BASE_LEFT_ATTR)) {
        skipOverlay.setAttribute(
          PLAYBACK_SKIP_BASE_LEFT_ATTR,
          skipOverlay.style.left || "",
        );
      }
      if (!skipOverlay.hasAttribute(PLAYBACK_SKIP_BASE_RIGHT_ATTR)) {
        skipOverlay.setAttribute(
          PLAYBACK_SKIP_BASE_RIGHT_ATTR,
          skipOverlay.style.right || "",
        );
      }
      if (!skipOverlay.hasAttribute(PLAYBACK_SKIP_BASE_TRANSFORM_ATTR)) {
        skipOverlay.setAttribute(
          PLAYBACK_SKIP_BASE_TRANSFORM_ATTR,
          skipOverlay.style.transform || "",
        );
      }

      const rect = skipOverlay.getBoundingClientRect();
      const left = safeAreaRight - rect.width;
      setStyleIfChanged(skipOverlay, "left", `${left.toFixed(2)}px`);
      setStyleIfChanged(skipOverlay, "right", "auto");
      setStyleIfChanged(skipOverlay, "transform", "none");
    }

    function clearManagedSkipPosition(skipOverlay) {
      if (!skipOverlay) return;

      if (skipOverlay.hasAttribute(PLAYBACK_SKIP_BASE_LEFT_ATTR)) {
        setStyleIfChanged(
          skipOverlay,
          "left",
          skipOverlay.getAttribute(PLAYBACK_SKIP_BASE_LEFT_ATTR) || "",
        );
        skipOverlay.removeAttribute(PLAYBACK_SKIP_BASE_LEFT_ATTR);
      }
      if (skipOverlay.hasAttribute(PLAYBACK_SKIP_BASE_RIGHT_ATTR)) {
        setStyleIfChanged(
          skipOverlay,
          "right",
          skipOverlay.getAttribute(PLAYBACK_SKIP_BASE_RIGHT_ATTR) || "",
        );
        skipOverlay.removeAttribute(PLAYBACK_SKIP_BASE_RIGHT_ATTR);
      }
      if (skipOverlay.hasAttribute(PLAYBACK_SKIP_BASE_TRANSFORM_ATTR)) {
        setStyleIfChanged(
          skipOverlay,
          "transform",
          skipOverlay.getAttribute(PLAYBACK_SKIP_BASE_TRANSFORM_ATTR) || "",
        );
        skipOverlay.removeAttribute(PLAYBACK_SKIP_BASE_TRANSFORM_ATTR);
      }
    }

    function applyManagedFooterChildSizing(footer, safeAreaWidth) {
      if (!footer) return;

      const metadata = footer.querySelector(
        PLAYBACK_CONTROLS_LAYOUT.metadataSelector,
      );
      const progress = footer.querySelector(
        PLAYBACK_CONTROLS_LAYOUT.progressSelector,
      );
      const tabs = footer.querySelector(PLAYBACK_CONTROLS_LAYOUT.tabsSelector);
      const autoSubsNote = footer.querySelector(
        PLAYBACK_CONTROLS_LAYOUT.autoSubsNoteSelector,
      );

      [metadata, progress, tabs].forEach((el, index) => {
        const scope = ["metadata", "progress", "tabs"][index];
        if (!el) return;
        applyManagedInlineStyle(el, scope, "minWidth", "0");
        applyManagedInlineStyle(el, scope, "maxWidth", "100%");
        applyManagedInlineStyle(el, scope, "overflow", "hidden");
        applyManagedInlineStyle(el, scope, "flexShrink", "1");
      });

      if (progress) {
        applyManagedInlineStyle(progress, "progress", "width", "100%");
      }

      if (autoSubsNote) {
        applyManagedInlineStyle(
          autoSubsNote,
          "auto-subs-note",
          "maxWidth",
          "100%",
        );
        applyManagedInlineStyle(
          autoSubsNote,
          "auto-subs-note",
          "overflow",
          "hidden",
        );
        applyManagedInlineStyle(
          autoSubsNote,
          "auto-subs-note",
          "flexShrink",
          "1",
        );
        if (safeAreaWidth < 1200) {
          applyManagedInlineStyle(
            autoSubsNote,
            "auto-subs-note",
            "display",
            "none",
          );
        } else {
          clearManagedInlineStyle(autoSubsNote, "auto-subs-note", "display");
        }
      }
    }

    function clearManagedFooterChildSizing(footer) {
      if (!footer) return;

      const metadata = footer.querySelector(
        PLAYBACK_CONTROLS_LAYOUT.metadataSelector,
      );
      const progress = footer.querySelector(
        PLAYBACK_CONTROLS_LAYOUT.progressSelector,
      );
      const tabs = footer.querySelector(PLAYBACK_CONTROLS_LAYOUT.tabsSelector);
      const autoSubsNote = footer.querySelector(
        PLAYBACK_CONTROLS_LAYOUT.autoSubsNoteSelector,
      );

      [
        [metadata, "metadata"],
        [progress, "progress"],
        [tabs, "tabs"],
      ].forEach(([el, scope]) => {
        clearManagedInlineStyle(el, scope, "minWidth");
        clearManagedInlineStyle(el, scope, "maxWidth");
        clearManagedInlineStyle(el, scope, "overflow");
        clearManagedInlineStyle(el, scope, "flexShrink");
      });

      clearManagedInlineStyle(progress, "progress", "width");

      clearManagedInlineStyle(autoSubsNote, "auto-subs-note", "maxWidth");
      clearManagedInlineStyle(autoSubsNote, "auto-subs-note", "overflow");
      clearManagedInlineStyle(autoSubsNote, "auto-subs-note", "flexShrink");
      clearManagedInlineStyle(autoSubsNote, "auto-subs-note", "display");
    }

    function _getPlaybackPanelLayoutAnchor() {
      return (
        document.querySelector(PLAYBACK_CONTROLS_LAYOUT.panelSelector) ||
        secondarySubtitleDom?.getElement()
      );
    }

    function computePlaybackVisibleArea(panelAnchor, video) {
      if (!isVisibleElement(panelAnchor) || !isVisibleElement(video)) {
        return null;
      }

      const videoRect = video.getBoundingClientRect();
      const panelRect = panelAnchor.getBoundingClientRect();
      const safeGutter = PLAYBACK_CONTROLS_LAYOUT.footerSafeGutterPx;
      const safeAreaLeft = videoRect.left + safeGutter;
      const safeAreaRight =
        Math.min(videoRect.right, panelRect.left) - safeGutter;
      const safeAreaWidth = Math.max(0, safeAreaRight - safeAreaLeft);

      return {
        panelRect,
        videoRect,
        safeAreaLeft,
        safeAreaRight,
        safeAreaWidth,
      };
    }

    function clampManagedShiftX(
      rect,
      existingShiftX,
      nextShiftX,
      minLeft,
      maxRight,
    ) {
      if (!rect) return 0;

      let shiftX = nextShiftX;
      const projectLeft = (candidateShiftX) =>
        rect.left + (candidateShiftX - existingShiftX);
      const projectRight = (candidateShiftX) =>
        rect.right + (candidateShiftX - existingShiftX);

      if (projectRight(shiftX) > maxRight) {
        shiftX -= projectRight(shiftX) - maxRight;
      }

      if (projectLeft(shiftX) < minLeft) {
        shiftX += minLeft - projectLeft(shiftX);
      }

      if (shiftX > 0) {
        shiftX = 0;
      }

      return shiftX;
    }

    function getShadowProgressTargets() {
      const host = document.querySelector("amp-playback-controls-progress");
      const root = host?.shadowRoot;
      if (!root) {
        return { host: null, bar: null, remaining: null };
      }

      return {
        host,
        bar: root.querySelector("#playback-progress"),
        remaining: root.querySelector("time.remaining"),
      };
    }

    function clearPlaybackControlsTransforms() {
      const { header, controls, progress, skipOverlay, footer, unified, volume } =
        getPlaybackControlsLayoutTargets();
      const { bar, remaining } = getShadowProgressTargets();
      clearManagedHeaderSizing(header);
      clearManagedTranslateX(controls);
      clearManagedProgressInset(progress);
      clearManagedTranslateX(bar);
      clearManagedTranslateX(remaining);
      clearManagedSkipPosition(skipOverlay);
      clearManagedTranslateX(skipOverlay);
      clearManagedTranslateX(footer);
      clearManagedFooterSizing(footer);
      clearManagedFooterChildSizing(footer);
      clearManagedTranslateX(unified);
      clearManagedTranslateX(volume);
    }

    function clearPlaybackControlsLayoutState({
      header,
      controls,
      progress,
      skipOverlay,
      footer,
      unified,
      volume,
      shadowProgressBar,
      shadowRemainingTime,
    }) {
      clearManagedHeaderSizing(header);
      clearManagedTranslateX(controls);
      clearManagedProgressInset(progress);
      clearManagedTranslateX(shadowProgressBar);
      clearManagedTranslateX(shadowRemainingTime);
      clearManagedSkipPosition(skipOverlay);
      clearManagedTranslateX(skipOverlay);
      clearManagedFooterSizing(footer);
      clearManagedFooterChildSizing(footer);
      clearManagedTranslateX(unified);
      clearManagedTranslateX(volume);
    }

    function adjustPlaybackControlsForPanel(reason = "unknown") {
      const {
        panel,
        header,
        controls,
        progress,
        skipOverlay,
        footer,
        unified,
        volume,
        video,
      } = getPlaybackControlsLayoutTargets();
      const { bar: shadowProgressBar, remaining: shadowRemainingTime } =
        getShadowProgressTargets();

      if (
        !header &&
        !controls &&
        !progress &&
        !skipOverlay &&
        !footer &&
        !unified &&
        !volume &&
        !shadowProgressBar &&
        !shadowRemainingTime
      ) {
        return;
      }

      const visibleArea = computePlaybackVisibleArea(panel, video);
      if (!visibleArea) {
        clearManagedTranslateX(footer);
        clearPlaybackControlsLayoutState({
          header,
          controls,
          progress,
          skipOverlay,
          footer,
          unified,
          volume,
          shadowProgressBar,
          shadowRemainingTime,
        });
        return;
      }

      const { panelRect, safeAreaLeft, safeAreaRight, safeAreaWidth } =
        visibleArea;
      const visibleRight = safeAreaRight;
      const visibleWidth = safeAreaWidth;

      if (header) {
        if (visibleWidth > 0) {
          applyManagedHeaderSizing(header, visibleWidth, safeAreaLeft);
        } else {
          clearManagedHeaderSizing(header);
        }
      }

      clearManagedTranslateX(footer);
      if (footer) {
        if (visibleWidth > 0) {
          applyManagedFooterSizing(footer, visibleWidth, safeAreaLeft);
          applyManagedFooterChildSizing(footer, visibleWidth);
        } else {
          clearManagedFooterSizing(footer);
          clearManagedFooterChildSizing(footer);
        }
      }

      clearManagedProgressInset(progress);

      if (visibleWidth <= 0) {
        clearPlaybackControlsLayoutState({
          header,
          controls,
          progress,
          skipOverlay,
          footer,
          unified,
          volume,
          shadowProgressBar,
          shadowRemainingTime,
        });
        return;
      }

      const targetCenterX = safeAreaLeft + visibleWidth / 2;
      const unifiedMaxRight = panelRect.left - 16;
      const unifiedMinLeft = safeAreaLeft + 16;
      const controlsTargetRight = panelRect.left - 40;
      const controlsMinLeft = safeAreaLeft + 16;
      const volumeTargetRight = panelRect.left - 60;
      const volumeMinLeft = safeAreaLeft + 16;
      const progressTargetRight = panelRect.left - 40;
      const progressMinLeft = safeAreaLeft + 24;
      const remainingTargetRight = panelRect.left - 60;
      const remainingMinLeft = safeAreaLeft + 24;

      if (unified) {
        const unifiedRect = unified.getBoundingClientRect();
        const unifiedExistingShiftX = getManagedShiftX(unified);
        const unifiedCenterX = unifiedRect.left + unifiedRect.width / 2;
        let unifiedShiftX =
          unifiedExistingShiftX + (targetCenterX - unifiedCenterX);

        unifiedShiftX = clampManagedShiftX(
          unifiedRect,
          unifiedExistingShiftX,
          unifiedShiftX,
          unifiedMinLeft,
          unifiedMaxRight,
        );

        applyManagedTranslateX(unified, unifiedShiftX);

        if (DEBUG_SECONDARY_SUBS) {
          logContent("unified controls recentered", {
            reason,
            unifiedShiftX: Number(unifiedShiftX.toFixed(2)),
            visibleRight: Number(visibleRight.toFixed(2)),
            targetCenterX: Number(targetCenterX.toFixed(2)),
          });
        }
      }

      if (
        volume &&
        !(unified && (volume === unified || unified.contains(volume)))
      ) {
        const volumeRect = volume.getBoundingClientRect();
        const volumeExistingShiftX = getManagedShiftX(volume);
        let volumeShiftX = volumeExistingShiftX;
        if (volumeRect.right > volumeTargetRight) {
          volumeShiftX += volumeTargetRight - volumeRect.right;
        }
        volumeShiftX = clampManagedShiftX(
          volumeRect,
          volumeExistingShiftX,
          volumeShiftX,
          volumeMinLeft,
          volumeTargetRight,
        );
        applyManagedTranslateX(volume, volumeShiftX);
      }

      if (controls) {
        const controlsRect = controls.getBoundingClientRect();
        const controlsExistingShiftX = getManagedShiftX(controls);
        let controlsShiftX = controlsExistingShiftX;
        if (controlsRect.right > controlsTargetRight) {
          controlsShiftX += controlsTargetRight - controlsRect.right;
        }
        controlsShiftX = clampManagedShiftX(
          controlsRect,
          controlsExistingShiftX,
          controlsShiftX,
          controlsMinLeft,
          controlsTargetRight,
        );
        applyManagedTranslateX(controls, controlsShiftX);
      }

      if (shadowProgressBar) {
        const progressRect = shadowProgressBar.getBoundingClientRect();
        const progressExistingShiftX = getManagedShiftX(shadowProgressBar);
        let progressShiftX = progressExistingShiftX;
        if (progressRect.right > progressTargetRight) {
          progressShiftX += progressTargetRight - progressRect.right;
        }

        progressShiftX = clampManagedShiftX(
          progressRect,
          progressExistingShiftX,
          progressShiftX,
          progressMinLeft,
          progressTargetRight,
        );

        applyManagedTranslateX(shadowProgressBar, progressShiftX);
      }

      if (shadowRemainingTime) {
        const remainingRect = shadowRemainingTime.getBoundingClientRect();
        const remainingExistingShiftX = getManagedShiftX(shadowRemainingTime);
        let remainingShiftX = remainingExistingShiftX;
        if (remainingRect.right > remainingTargetRight) {
          remainingShiftX += remainingTargetRight - remainingRect.right;
        }
        remainingShiftX = clampManagedShiftX(
          remainingRect,
          remainingExistingShiftX,
          remainingShiftX,
          remainingMinLeft,
          remainingTargetRight,
        );
        applyManagedTranslateX(shadowRemainingTime, remainingShiftX);
      }

      if (skipOverlay) {
        clearManagedTranslateX(skipOverlay);
        applyManagedSkipPosition(skipOverlay, safeAreaRight);
      }
    }

    return {
      PLAYBACK_CONTROLS_LAYOUT,
      getPlaybackControlsLayoutTargets,
      clearPlaybackControlsTransforms,
      adjustPlaybackControlsForPanel,
    };
  }

  const root = (window.ATVB = window.ATVB || {});
  root.playbackControlsLayout = {
    PLAYBACK_CONTROLS_LAYOUT,
    createPlaybackControlsLayout,
  };
})();
