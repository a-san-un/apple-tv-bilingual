// =============================================================
// Apple TV+ Bilingual Subtitles - content.js
// version: 2.6.3
// Issue #4: Debug 配置修正と再生ページ限定 build、初回字幕回復導線を最小差分で整理
// 既存の起動導線は維持し、layout/observer/retry/polling は変更しない
// Phase A: VTT 正規化と logger を外部モジュールへ分離し、ここでは橋渡しを担当する。
// =============================================================
// Phase D/#19: current 行の primary 非対称を最小差分で補正する。
// secondary cue の短いギャップ時のみ panel primary を一時補完する。
//

(function () {
  ("use strict");
  const DEFAULT_SETTINGS = {
    primaryLang: "en",
    secondaryLang: "",
    showSidebar: true,
    playWordAudio: true,
    enableAiTooltip: false,
    preferredAiProvider: "auto",
  };

  const DEBUG_SECONDARY_SUBS = false;
  // Optional probe logs for #19 regressions. Keep false in normal operation.
  const DEBUG_PANEL_PROBE = true;
  const LOG_CATEGORIES = Object.freeze({
    SETTINGS: "settings",
    SUBTITLE: "subtitle",
    UI: "ui",
    API: "api",
    ERROR: "error",
    DEFAULT: "default",
  });
  const CONTENT_DEFAULT_DEBUG_CATEGORIES = [
    LOG_CATEGORIES.SUBTITLE,
    LOG_CATEGORIES.UI,
    LOG_CATEGORIES.ERROR,
  ];
  const TRACK_RESOLVE_RETRY_DELAYS_MS = [120, 260, 420, 680];
  const SECONDARY_SUBTITLE_GRACE_MS = 1200;
  const SECONDARY_SUBTITLE_IDLE_CLEAR_MS = 3200;
  const PANEL_PRIMARY_GRACE_MS = 600;
  const SUBTITLE_HISTORY_MAX_PER_CONTENT = 500;
  const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";
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
  const PLAYBACK_SKIP_BASE_RIGHT_ATTR = "data-atvb-playback-skip-base-right";
  const PLAYBACK_SKIP_BASE_TRANSFORM_ATTR =
    "data-atvb-playback-skip-base-transform";

  const state = {
    booted: false,
    restarting: false,
    video: null,
    dialogEl: null,
    contentSettings: { ...DEFAULT_SETTINGS },
    requestedContentSettings: {},
    requestedSecondaryLang: "",
    primaryTrack: null,
    secondaryTrack: null,
    lastVideoSrcKey: "",
    currentContentKey: "",
    subtitleHistoryStore: new Map(),
    subtitleHistory: [],
    panelPastBlocks: [],
    subtitleBlocks: [],
    subtitleCurrentIndex: -1,
    subtitleBlockMeta: null,
    lastPanelRenderSnapshot: null,
    currentSubtitleBlock: null,
    lastCurrentSubtitleBlockAt: 0,
    lastAfterRenderSecondarySnapshotSignature: "",
    lastSecondarySyncContext: "",
    lastPrimaryRecoveryAttemptAt: 0,
    lastPrimarySnapshotAt: 0,
    lastObservedVideoTime: null,
    lastLargeSeekAt: 0,
    lastPrimaryText: "",
    lastSecondaryText: "",
    lastSecondaryTextAt: 0,
    lastSecondarySignalAt: 0,
    panelVisible: true,
    ejdictMap: null,
    secondaryHideTimer: null,
    overlayRoot: null,
    panelShadowRoot: null,
    popupShadowRoot: null,
    debugPanelRoot: null,
    popupDocClickHandler: null,
    popupResizeObserver: null,
    popupLastContext: null,
    messageListenerAttached: false,
    playbackControlsRafId: 0,
    playbackControlsApplying: false,
    playbackControlsRetryTimers: [],
    trackResolveRetryTimers: [],
    controlSettlingTimers: [],
    initialCueRecoveryTimers: [],
    initialCueRecoveryCleanup: [],
  };

  let panelUi = null;
  let secondaryTrackSyncInterval = null;
// =====================================================================
// Section 1: Logger & Debug Bridge
// Role:
// - logger / debug panel への橋渡し
// - contentKey 付き payload への正規化
// Keep in content.js:
// - log entrypoint / debug update callback / scoped payload bridge
// Move to modules:
// - log storage / filtering / panel rendering details
// =====================================================================

function appendContentDebugBufferEntry(args) {
  try {
    const buffer = (window.__atvDebugLogs = window.__atvDebugLogs || []);
    const entry = {
      ts: new Date().toISOString(),
      message: String(args[0] ?? ""),
      payload: args[1] ?? null,
    };
    buffer.push(entry);
    if (buffer.length > 400) buffer.splice(0, buffer.length - 400);
  } catch (_) {}
}

function isContentLogCategoryPair(first, second) {
  const normalizedFirst = String(first || "").toLowerCase();
  const isCategory = Object.values(LOG_CATEGORIES).includes(normalizedFirst);
  return isCategory && typeof second === "string";
}

function forwardContentLog(...args) {
  const logger = window.ATVB?.logger;
  if (!logger?.logContent) return;

  if (args.length >= 3) {
    const [category, message, payload] = args;
    return logger.logContent(
      category,
      message,
      buildContentScopedPayload(payload),
    );
  }

  if (args.length === 2) {
    const [first, second] = args;
    if (isContentLogCategoryPair(first, second)) {
      return logger.logContent(
        first,
        second,
        buildContentScopedPayload(null),
      );
    }
    return logger.logContent(first, buildContentScopedPayload(second));
  }

  if (args.length === 1) {
    return logger.logContent(args[0], buildContentScopedPayload(null));
  }

  return logger.logContent();
}

  // logger API の logContent へ橋渡しする。
  // 既存の logContent(message, payload) 互換を維持しつつ contentKey を付与する。
  function logContent(...args) {
    appendContentDebugBufferEntry(args);
    return forwardContentLog(...args);
  }
  // logger API の getDebugLogText へ橋渡しする。
  const getDebugLogText = async (...args) =>
    (await window.ATVB?.logger?.getDebugLogText?.(...args)) ?? "";
  // logger API の clearDebugLogs へ橋渡しする。
  const clearDebugLogs = async (...args) =>
    (await window.ATVB?.logger?.clearDebugLogs?.(...args)) ?? undefined;

  function buildContentScopedPayload(payload = null) {
    const contentKey = String(state.currentContentKey || "").trim();
    const scopedContentKey = contentKey || "content:unknown";
    if (payload == null) {
      return { contentKey: scopedContentKey };
    }
    if (Array.isArray(payload)) {
      return { value: payload, contentKey: scopedContentKey };
    }
    if (typeof payload === "object") {
      return {
        ...payload,
        contentKey:
          String(payload.contentKey || payload.nextContentKey || "").trim() ||
          scopedContentKey,
      };
    }
    return { value: payload, contentKey: scopedContentKey };
  }

  const logContentSettings = (message, payload = null) =>
    logContent(
      LOG_CATEGORIES.SETTINGS,
      message,
      buildContentScopedPayload(payload),
    );
  const logContentSubtitle = (message, payload = null) =>
    logContent(
      LOG_CATEGORIES.SUBTITLE,
      message,
      buildContentScopedPayload(payload),
    );
  const logContentUi = (message, payload = null) =>
    logContent(LOG_CATEGORIES.UI, message, buildContentScopedPayload(payload));
  const logContentApi = (message, payload = null) =>
    logContent(LOG_CATEGORIES.API, message, buildContentScopedPayload(payload));
  const logContentError = (message, payload = null) =>
    logContent(
      LOG_CATEGORIES.ERROR,
      message,
      buildContentScopedPayload(payload),
    );

  function getLiveDebugLogFilter() {
    const filter = {
      categories: CONTENT_DEFAULT_DEBUG_CATEGORIES,
      scopes: ["content"],
    };
    const contentKey = String(state.currentContentKey || "").trim();
    if (contentKey) {
      filter.contentKey = contentKey;
    }
    return filter;
  }

  // logger の更新通知を Debug パネル更新へ接続する。
  function registerDebugLogUpdateCallback() {
    window.ATVB?.logger?.setOnLogUpdated?.(() => {
      updateLiveDebugPanel();
    });
  }

  (async function loadEJDict() {
    try {
      const url = chrome.runtime.getURL("dict/ejdict.json");
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`);
      }

      state.ejdictMap = await res.json();
      logContentApi("EJDict loaded", {
        entries: Object.keys(state.ejdictMap).length,
        url,
      });
    } catch (e) {
      logContentError("EJDict load failed", { error: e.message });
      console.warn("[ATV-Bilingual] EJDict load failed:", e.message);
    }
  })();

  function ejdictLookup(word) {
    if (!state.ejdictMap) return null;
    return state.ejdictMap[word] || state.ejdictMap[word.toLowerCase()] || null;
  }

  function findCueAt(track, time) {
    if (!track) return null;
    let cues = null;
    // mode 遷移中は cues アクセスが例外/ null になり得るので保護する。
    try {
      cues = track.cues;
    } catch (_) {
      cues = null;
    }
    if (!cues) return null;
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (c.startTime <= time + 0.1 && time < c.endTime + 0.1) return c;
    }
    return null;
  }

  function sendToBackground(msg, callback) {
    logContentApi("sendToBackground start", { type: msg?.type ?? null });

    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        logContentError("sendToBackground first attempt failed", {
          type: msg?.type ?? null,
          error: chrome.runtime.lastError.message,
        });

        setTimeout(() => {
          chrome.runtime.sendMessage(msg, (res2) => {
            if (chrome.runtime.lastError) {
              logContentError("sendToBackground retry failed", {
                type: msg?.type ?? null,
                error: chrome.runtime.lastError.message,
              });
              callback({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              logContentApi("sendToBackground retry success", {
                type: msg?.type ?? null,
                ok: res2?.ok ?? null,
              });
              callback(res2);
            }
          });
        }, 300);
      } else {
        logContentApi("sendToBackground success", {
          type: msg?.type ?? null,
          ok: res?.ok ?? null,
        });
        callback(res);
      }
    });
  }

  function getTarget() {
    return state.dialogEl || document.body;
  }

  function getPlaybackContext() {
    const video = document.querySelector("video");
    const playbackDialog = document.querySelector("dialog.playback-view");
    const playbackView = document.querySelector(
      '[data-testid="playback-view"]',
    );
    const textTrackCount = video?.textTracks?.length ?? 0;

    // 再生判定は URL ではなく DOM 条件を基準にする。
    const isPlaybackReady = Boolean(video) && textTrackCount > 0;

    return {
      video,
      playbackDialog,
      playbackView,
      textTrackCount,
      isPlaybackReady,
    };
  }

  function getVideoAndDialog() {
    const ctx = getPlaybackContext();
    if (!ctx.isPlaybackReady) return null;

    const resolvedDialog =
      ctx.playbackDialog || ctx.playbackView?.closest("dialog") || null;
    return { video: ctx.video, dialog: resolvedDialog };
  }

  function isPlaybackPageReady() {
    return getPlaybackContext().isPlaybackReady;
  }

  // playback context detection helpers
  // playback readiness の観測結果を、logging や上位判断へ渡すための補助関数群。
  function getPlaybackContextLogPayload() {
    const ctx = getPlaybackContext();
    return {
      hasVideo: Boolean(ctx.video),
      hasPlaybackDialog: Boolean(ctx.playbackDialog),
      hasPlaybackView: Boolean(ctx.playbackView),
      textTrackCount: ctx.textTrackCount,
      isPlaybackReady: ctx.isPlaybackReady,
    };
  }

  // content key resolver helpers
  // 現在の再生対象から安定した content key を組み立てるための下位 helper 群。
  function normalizeContentKeyPart(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function normalizeMediaSourceKey(rawSrc) {
    const src = String(rawSrc || "").trim();
    if (!src) return "";

    try {
      const parsed = new URL(src, location.href);
      return `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch (_) {
      return src.split("?")[0].split("#")[0].toLowerCase();
    }
  }

  function getPlaybackTitleKey() {
    const rawTitle = String(document.title || "");
    const cleanedTitle = rawTitle
      .replace(/\s*[|｜-]\s*apple tv\+\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return normalizeContentKeyPart(cleanedTitle);
  }

  function resolvePlaybackContentKey(ctx = getPlaybackContext()) {
    const mediaSourceKey = normalizeMediaSourceKey(
      ctx.video?.currentSrc || ctx.video?.getAttribute("src") || "",
    );
    // エピソード識別は currentSrc を最優先にする。
    if (mediaSourceKey) {
      return `media:${mediaSourceKey}`;
    }

    const titleKey = getPlaybackTitleKey();
    const attrCandidates = [
      ctx.playbackView?.getAttribute("data-automation-id"),
      ctx.playbackView?.getAttribute("data-testid"),
      ctx.playbackView?.getAttribute("aria-label"),
      ctx.playbackDialog?.getAttribute("aria-label"),
    ];
    const stableIdKey = attrCandidates
      .map((value) => normalizeContentKeyPart(value))
      .find(Boolean);

    const keyParts = [];
    if (titleKey) keyParts.push(`title:${titleKey}`);
    if (stableIdKey) keyParts.push(`id:${stableIdKey}`);

    if (!keyParts.length) return "content:unknown";
    return keyParts.join("|");
  }

  function getCurrentVideoSrcKey(video = state.video) {
    return normalizeMediaSourceKey(
      video?.currentSrc || video?.getAttribute("src") || "",
    );
  }

  function getHistoryBucketForContentKey(contentKey) {
    if (!contentKey) return null;
    return state.subtitleHistoryStore.get(contentKey) || null;
  }

  function loadHistoryForContentKey(contentKey) {
    const bucket = getHistoryBucketForContentKey(contentKey);
    const items = Array.isArray(bucket?.items) ? bucket.items : [];
    state.subtitleHistory = items.slice(-SUBTITLE_HISTORY_MAX_PER_CONTENT);
  }

  function saveHistoryForContentKey(
    contentKey,
    history = state.subtitleHistory,
  ) {
    if (!contentKey) return;
    const items = Array.isArray(history)
      ? history.slice(-SUBTITLE_HISTORY_MAX_PER_CONTENT)
      : [];
    state.subtitleHistoryStore.set(contentKey, {
      items,
      updatedAt: Date.now(),
    });
  }

  function switchHistoryContext(nextContentKey, reason = "unknown") {
    const resolvedContentKey = nextContentKey || "content:unknown";
    const previousContentKey = state.currentContentKey;

    if (previousContentKey === resolvedContentKey) return false;

    if (
      previousContentKey &&
      resolvedContentKey &&
      previousContentKey !== resolvedContentKey
    ) {
      overlayController.clearOverlayState?.();
    }

    if (previousContentKey) {
      saveHistoryForContentKey(previousContentKey);
    }

    state.currentContentKey = resolvedContentKey;
    loadHistoryForContentKey(resolvedContentKey);
    state.lastPrimaryText = "";

    logContentSubtitle("history context switched", {
      reason,
      previousContentKey,
      nextContentKey: resolvedContentKey,
      historySize: state.subtitleHistory.length,
    });

    return true;
  }

  function syncHistoryContextWithPlayback(reason = "unknown") {
    return switchHistoryContext(resolvePlaybackContentKey(), reason);
  }

  function appendSubtitleHistory(entry) {
    if (!entry) return;

    const nextHistory = state.subtitleHistory
      .concat(entry)
      .slice(-SUBTITLE_HISTORY_MAX_PER_CONTENT);
    state.subtitleHistory = nextHistory;
    saveHistoryForContentKey(state.currentContentKey, nextHistory);
  }

  function getSecondaryTrackDebugPayload(effectiveSecondaryLanguage, track) {
    return {
      effectiveSecondaryLanguage: effectiveSecondaryLanguage || "",
      selectedTrackLanguage: track?.language || "",
      cuesLength: getTrackCuesLength(track),
      activeCuesLength: getTrackActiveCuesLength(track),
    };
  }

  function canReadCueFromTrack(track) {
    if (!track) return false;
    return track.mode === "hidden" || track.mode === "showing";
  }

  function getCurrentCue(track, time = state.video?.currentTime ?? 0) {
    if (!track) return null;

    try {
      const activeCue = track.activeCues?.[0] ?? null;
      if (activeCue) return activeCue;
    } catch (_) {}

    return findCueAt(track, time);
  }

  function getCurrentCueText(track, time = state.video?.currentTime ?? 0) {
    return vttDeps.cleanCueText(getCurrentCue(track, time));
  }

  function getSecondaryRenderLogPayload(text, track, elementCount) {
    return {
      textPreview: String(text || "").slice(0, 40),
      trackLanguage: track?.language || "",
      activeCuesLength: getTrackActiveCuesLength(track),
      secondaryElementCount: elementCount,
    };
  }

  function ensureSecondarySubtitleElement() {
  const requestedSettings = state.requestedContentSettings || {};
  const effectiveSettings = {
    primaryLang:
      requestedSettings.primaryLang ||
      state.contentSettings.primaryLang ||
      "",
    secondaryLang:
      requestedSettings.secondaryLang ||
      state.requestedSecondaryLang ||
      state.contentSettings.secondaryLang ||
      "",
  };

  if (!isLanguageSelectionReady(effectiveSettings)) {
    return null;
  }

  let panelHost = getTarget().querySelector("#atv-panel-host");
  if (!panelHost) {
    panelUi?.createRightPanel?.();
    panelHost = getTarget().querySelector("#atv-panel-host");
  }
  if (!panelHost) return null;

  const shadowRoot = panelHost.shadowRoot || null;
  if (!shadowRoot) return null;

  let secondaryEl = shadowRoot.querySelector(
    "[data-secondary-subtitle], .dual-subtitles-secondary",
  );
  if (secondaryEl) {
    if (!secondaryEl.hasAttribute("data-secondary-subtitle")) {
      secondaryEl.setAttribute("data-secondary-subtitle", "");
    }
    if (!secondaryEl.classList.contains("dual-subtitles-secondary")) {
      secondaryEl.classList.add("dual-subtitles-secondary");
    }
    return secondaryEl;
  }

  let panelScroll = shadowRoot.getElementById("panel-scroll");
  if (!panelScroll) {
    const panel = shadowRoot.querySelector(
      "[data-dual-subtitles-panel], .dual-subtitles-panel",
    );
    panelScroll = panel || null;
  }
  if (!panelScroll) return null;

  secondaryEl = document.createElement("div");
  secondaryEl.setAttribute("data-secondary-subtitle", "");
  secondaryEl.className = "dual-subtitles-secondary";
  secondaryEl.dataset.language = "";
  panelScroll.insertBefore(secondaryEl, panelScroll.firstChild || null);

  if (DEBUG_SECONDARY_SUBS) {
    logContent("secondary element ensured");
  }
  return secondaryEl;
}
  function ensurePanelSlotLayerStyle() {
    if (document.getElementById(PANEL_SLOT_LAYER_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = PANEL_SLOT_LAYER_STYLE_ID;
    style.textContent = `
      #atv-panel-host > .dual-subtitles-secondary,
      #atv-panel-host > [data-secondary-subtitle] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  // [render: panel shell apply]
  function renderSecondarySubtitle(text, track) {
    let el = ensureSecondarySubtitleElement();
    if (!el) return;

    const elementCountBefore = document.querySelectorAll(
      "[data-secondary-subtitle], .dual-subtitles-secondary",
    ).length;
    if (elementCountBefore > 1) {
      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary duplicate elements cleaned",
          getSecondaryRenderLogPayload(text, track, elementCountBefore),
        );
      }
      el = ensureSecondarySubtitleElement();
    }

    if (!el) {
      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary element missing, recreating");
      }
      el = ensureSecondarySubtitleElement();
    }
    if (!el) return;

    const activeCuesLength = getTrackActiveCuesLength(track);
    let resolvedText = text || "";
    if (!resolvedText && activeCuesLength > 0) {
      resolvedText = getCurrentCueText(track) || "";
      const elementCount = document.querySelectorAll(
        "[data-secondary-subtitle], .dual-subtitles-secondary",
      ).length;
      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary cue text resolved",
          getSecondaryRenderLogPayload(resolvedText, track, elementCount),
        );
      }
    }

    const elementCount = document.querySelectorAll(
      "[data-secondary-subtitle], .dual-subtitles-secondary",
    ).length;

    resolvedText = normalizeSubtitleText(resolvedText);

    let finalText = resolvedText;
    const now = Date.now();

    if (finalText) {
      state.lastSecondaryText = finalText;
      state.lastSecondaryTextAt = now;
    } else if (
      !finalText &&
      activeCuesLength === 0 &&
      state.lastSecondaryText &&
      now - state.lastSecondaryTextAt <= SECONDARY_SUBTITLE_GRACE_MS
    ) {
      finalText = state.lastSecondaryText;
      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary subtitle retained during grace period",
          getSecondaryRenderLogPayload(finalText, track, elementCount),
        );
      }
    } else if (
      !finalText &&
      now - state.lastSecondaryTextAt > SECONDARY_SUBTITLE_GRACE_MS
    ) {
      if (el.textContent) {
        if (DEBUG_SECONDARY_SUBS) {
          logContent(
            "secondary subtitle cleared after grace period",
            getSecondaryRenderLogPayload("", track, elementCount),
          );
        }
      }
      state.lastSecondaryText = "";
      state.lastSecondaryTextAt = 0;
    }

    if (DEBUG_SECONDARY_SUBS) {
      logContent(
        "secondary render called",
        getSecondaryRenderLogPayload(finalText, track, elementCount),
      );
    }

    el.textContent = finalText;
    el.dataset.language = track?.language || "";
    logSubtitlePanelState("after-renderSecondarySubtitle");
  }

  function logSubtitlePanelState(tag) {
    try {
      const panelHost = getTarget().querySelector("#atv-panel-host");
      const secondaryEl =
        panelHost?.shadowRoot?.querySelector("[data-secondary-subtitle]") || null;
      const snapshot = state.lastPanelRenderSnapshot || {};
      const currentSubtitleBlock = snapshot.currentSubtitleBlock || null;
      const payload = {
        tag,
        allBlocksCount: snapshot.allBlocksCount ?? 0,
        historyCount: state.subtitleHistory.length,
        hasCurrentBlock: Boolean(currentSubtitleBlock),
        currentPrimary: currentSubtitleBlock?.primaryText || "",
        currentSecondary: currentSubtitleBlock?.secondaryText || "",
        secondaryElText: secondaryEl?.textContent || "",
      };

      if (tag === "after-renderSecondarySubtitle") {
        const signature = JSON.stringify({
          allBlocksCount: payload.allBlocksCount,
          historyCount: payload.historyCount,
          hasCurrentBlock: payload.hasCurrentBlock,
          currentPrimary: payload.currentPrimary,
          currentSecondary: payload.currentSecondary,
          secondaryElText: payload.secondaryElText,
        });
        if (signature === state.lastAfterRenderSecondarySnapshotSignature) {
          return;
        }
        state.lastAfterRenderSecondarySnapshotSignature = signature;
      }
    } catch (error) {
      console.warn("[ATVB] panel state snapshot failed", {
        tag,
        error: String(error),
      });
    }
  }

  function syncSecondarySubtitleTrack(
    video,
    requestedLang,
    renderSecondarySubtitle,
  ) {
    if (!video) return;

    if (DEBUG_SECONDARY_SUBS) {
      logContent(
        "secondary sync",
        getSecondaryTrackDebugPayload(
          requestedLang,
          cueController.getBoundSecondaryTrack(),
        ),
      );
    }

    cueController.syncSecondarySubtitleTrack(
      video,
      requestedLang,
      renderSecondarySubtitle,
    );
    state.secondaryTrack = cueController.getBoundSecondaryTrack();
  }

  function ensureSecondaryTrackSyncInterval() {
    if (secondaryTrackSyncInterval) return;

    secondaryTrackSyncInterval = window.setInterval(() => {
      if (state.restarting) return;

      const found = getVideoAndDialog();
      const nextVideo = found?.video || state.video;
      const nextVideoSrcKey = getCurrentVideoSrcKey(nextVideo);
      const hasCurrentSrcChanged =
        Boolean(nextVideoSrcKey) &&
        Boolean(state.lastVideoSrcKey) &&
        nextVideoSrcKey !== state.lastVideoSrcKey;

      if (hasCurrentSrcChanged) {
        logContent("currentSrc changed", {
          previousVideoSrcKey: state.lastVideoSrcKey,
          nextVideoSrcKey,
        });
      }

      if (found && (found.video !== state.video || hasCurrentSrcChanged)) {
        state.video = found.video;
        state.dialogEl = found.dialog;
        state.lastVideoSrcKey = nextVideoSrcKey;
        state.lastObservedVideoTime = null;
        reloadSettingsAndReinitialize("video_changed");
      } else if (found && state.video) {
        const switched = syncHistoryContextWithPlayback("content_key_changed");
        if (switched) {
          renderCurrentSnapshot();
          renderPanel();
        }
      }

      const currentVideoTime = Number(state.video?.currentTime ?? 0);
      const previousObservedTime = Number(state.lastObservedVideoTime);
      const largeSeekDetected =
        Number.isFinite(previousObservedTime) &&
        Number.isFinite(currentVideoTime) &&
        Math.abs(currentVideoTime - previousObservedTime) > 6;
      state.lastObservedVideoTime = Number.isFinite(currentVideoTime)
        ? currentVideoTime
        : null;

      if (largeSeekDetected) {
        applyCurrentStateToPanel("sync_interval_large_seek_resync");
      }

      const effectiveSecondaryLanguage =
        state.requestedSecondaryLang || state.contentSettings.secondaryLang;
      if (!state.video || !effectiveSecondaryLanguage) return;

      const previousSecondaryTrack = state.secondaryTrack;
      syncSecondarySubtitleTrack(
        state.video,
        effectiveSecondaryLanguage,
        renderSecondarySubtitle,
      );
      state.secondaryTrack = cueController.getBoundSecondaryTrack();

      const secondaryActiveCues = getTrackActiveCuesLength(
        state.secondaryTrack,
      );
      const primaryActiveCues = getTrackActiveCuesLength(state.primaryTrack);
      const secondaryCueText = normalizeSubtitleText(
        getCurrentCueText(state.secondaryTrack),
      );
      const primaryCueText = normalizeSubtitleText(
        getCurrentCueText(state.primaryTrack),
      );
      const snapshotPrimaryText = normalizeSubtitleText(
        state.lastPanelRenderSnapshot?.currentSubtitleBlock?.primaryText || "",
      );
      const hasPrimaryLiveSignal =
        primaryActiveCues > 0 || Boolean(primaryCueText);
      const now = Date.now();
      const hasFreshPrimarySnapshot =
        Boolean(snapshotPrimaryText) &&
        state.lastPrimarySnapshotAt > 0 &&
        now - state.lastPrimarySnapshotAt <= 3000;
      const hasSecondarySignal =
        secondaryActiveCues > 0 || Boolean(secondaryCueText);
      const hasPrimarySignal = hasPrimaryLiveSignal || hasFreshPrimarySnapshot;

      const syncContextSummary = JSON.stringify({
        trackCount: state.video?.textTracks?.length ?? 0,
        primaryTrackFound: Boolean(state.primaryTrack),
        secondaryTrackFound: Boolean(state.secondaryTrack),
        secondaryTrackLanguage: state.secondaryTrack?.language || "",
        secondaryActiveCues,
        primaryActiveCues,
        primaryCueTextLength: primaryCueText.length,
        snapshotPrimaryTextLength: snapshotPrimaryText.length,
        hasFreshPrimarySnapshot,
      });
      const shouldLogSyncContext =
        previousSecondaryTrack !== state.secondaryTrack ||
        syncContextSummary !== state.lastSecondarySyncContext;
      if (shouldLogSyncContext) {
        state.lastSecondarySyncContext = syncContextSummary;
        logContent("secondary track sync context", {
          reason: "sync_interval",
          effectiveSecondaryLanguage,
          trackCount: state.video?.textTracks?.length ?? 0,
          primaryTrackFound: Boolean(state.primaryTrack),
          secondaryTrackFound: Boolean(state.secondaryTrack),
          secondaryTrackLanguage: state.secondaryTrack?.language || "",
          secondaryActiveCues,
          primaryActiveCues,
          primaryCueTextLength: primaryCueText.length,
          snapshotPrimaryTextLength: snapshotPrimaryText.length,
          hasFreshPrimarySnapshot,
        });
      }

      const trackCount = state.video?.textTracks?.length ?? 0;
      const shouldAttemptPrimaryRecovery =
        hasSecondarySignal && !hasPrimarySignal && trackCount > 1;

      // [binder/cue: recovery - sync interval path]
      // secondary signal はあるが primary signal が無い場合、
      // sync interval 経由で primary recovery を試行する。

      if (!shouldAttemptPrimaryRecovery) {
        if (hasPrimarySignal) {
          state.lastPrimaryRecoveryAttemptAt = 0;
        }
        return;
      }

      if (
        state.lastPrimaryRecoveryAttemptAt &&
        now - state.lastPrimaryRecoveryAttemptAt < 4000
      ) {
        return;
      }

      state.lastPrimaryRecoveryAttemptAt = now;
      const recoveryResult = reinitializeSubtitlePipeline(
        "sync_interval_primary_recovery",
      );
      logContent("sync interval primary recovery", {
        trackCount,
        primaryTrackFound: recoveryResult.primaryTrackFound,
        secondaryTrackFound: recoveryResult.secondaryTrackFound,
        primaryListenerBound: recoveryResult.primaryListenerBound,
        secondaryListenerBound: recoveryResult.secondaryListenerBound,
      });

      if (recoveryResult.primaryTrackFound) {
        state.lastPrimaryRecoveryAttemptAt = 0;
      }
    }, 2000);
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

  function applyManagedProgressInset(progress) {
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

  function getPlaybackPanelLayoutAnchor() {
    return (
      document.querySelector(PLAYBACK_CONTROLS_LAYOUT.panelSelector) ||
      document.querySelector(".dual-subtitles-secondary") ||
      document.querySelector("[data-secondary-subtitle]")
    );
  }

  function computePlaybackVisibleArea(panelAnchor, video) {
    if (!isVisibleElement(panelAnchor) || !isVisibleElement(video)) return null;

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

  function scheduleAdjustPlaybackControls(
    reason = "unknown",
    retryDelays = [],
    options = {},
  ) {
    layoutController.requestPlaybackControlsAdjustment(reason, {
      delays: retryDelays,
      immediate: options.immediate !== false,
    });
  }

  // ============================================================
  // 再生 UI レイアウト調整: window resize トリガー
  // パネル開閉だけでなく、ブラウザサイズ変更時にも
  // playback controls の位置・サイズを再調整する。
  // ============================================================
  (function setupPlaybackControlsResizeTracking() {
    if (typeof scheduleAdjustPlaybackControls !== "function") {
      return;
    }

    let resizeAdjustTimer = null;

    function scheduleOnResize() {
      if (resizeAdjustTimer) {
        clearTimeout(resizeAdjustTimer);
      }

      resizeAdjustTimer = setTimeout(() => {
        try {
          scheduleAdjustPlaybackControls("windowResize", [0, 300], {
            immediate: true,
          });
        } catch (error) {
          console.error(
            "[ATVB] scheduleAdjustPlaybackControls(windowResize) failed",
            error,
          );
        }
      }, 150);
    }

    window.addEventListener("resize", scheduleOnResize, { passive: true });
  })();

  function scheduleControlSettlingBurst(
    reason = "unknown",
    delays = [180, 420, 800, 1300, 1900, 2700, 3800],
  ) {
    layoutController.requestPlaybackControlsAdjustment(reason, {
      delays: [],
      immediate: false,
      settle: true,
      settleDelays: delays,
    });
  }

  // [observer/layout]
  function applyLayout(show) {
    const getLayoutTargets = () => {
      const opaqueVideoContainer =
        document.querySelector(".video-container.svelte-1psbnd5.is-opaque") ||
        document.querySelector(".video-container.is-opaque") ||
        document.querySelector(".video-container");

      return {
        vc: document.querySelector(".video-player__video-container"),
        content: document.querySelector(".video-player__content"),
        htmlVideo: document.querySelector("video"),
        opaqueVideoContainer,
        backgroundVideo: document.querySelector(".background-video"),
      };
    };

    const applyLayoutToTargets = (targets, visible) => {
      const { vc, content, htmlVideo, opaqueVideoContainer, backgroundVideo } =
        targets;

      if (visible) {
        if (vc) {
          vc.style.width = "70%";
          vc.style.maxWidth = "70%";
          vc.style.flexShrink = "0";
          vc.style.marginRight = "";
        }
        if (content) {
          content.style.width = "";
          content.style.maxWidth = "";
          content.style.flexShrink = "";
          content.style.marginRight = "";
        }
        if (htmlVideo) {
          htmlVideo.style.maxWidth = "100%";
        }
        if (opaqueVideoContainer) {
          opaqueVideoContainer.style.right = "30%";
        }
        if (backgroundVideo) {
          backgroundVideo.style.right = "30%";
        }
      } else {
        if (vc) {
          vc.style.width = "";
          vc.style.maxWidth = "";
          vc.style.flexShrink = "";
          vc.style.marginRight = "";
        }
        if (content) {
          content.style.width = "";
          content.style.maxWidth = "";
          content.style.flexShrink = "";
          content.style.marginRight = "";
        }
        if (htmlVideo) {
          htmlVideo.style.maxWidth = "";
        }
        if (opaqueVideoContainer) {
          opaqueVideoContainer.style.right = "";
        }
        if (backgroundVideo) {
          backgroundVideo.style.right = "";
        }
      }
    };

    applyLayoutToTargets(getLayoutTargets(), show);

    overlayController.setOverlayVisible(!show);

    layoutController.onPanelVisibilityChanged(show, {
      reason: "applyLayout",
      retryDelays: show ? [1200] : [],
      immediate: !show,
      settlingDelays: [180, 420, 900, 1500],
    });
  }


  function showRightPanel() {
    if (!state.panelVisible) {
      togglePanel(true);
      return;
    }
    applyLayout(true);
    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost = getTarget().querySelector("#atv-overlay-host");
    const toggleBtn = getTarget().querySelector("#atv-toggle-btn");
    if (panelHost) panelHost.style.display = "";
    if (overlayHost) {
      overlayHost.style.width = "70%";
      overlayHost.style.display = "none";
    }
    if (toggleBtn) toggleBtn.style.display = "none";
  }

  function hideRightPanel() {
    if (state.panelVisible) {
      togglePanel(false);
      return;
    }
    applyLayout(false);
    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost = getTarget().querySelector("#atv-overlay-host");
    const toggleBtn = getTarget().querySelector("#atv-toggle-btn");
    if (panelHost) panelHost.style.display = "none";
    if (overlayHost) {
      overlayHost.style.width = "100%";
      overlayHost.style.display = "";
    }
    if (toggleBtn) toggleBtn.style.display = "block";
  }

  function pinRightPanel() {}

  function unpinRightPanel() {}

  function applySettingsToUI(settings, options = {}) {
    const shouldSyncPanelVisibility = options.syncPanelVisibility !== false;

    if (shouldSyncPanelVisibility) {
      const sidebarEnabled = settings.showSidebar !== false;
      if (sidebarEnabled) {
        panelUi.showRightPanel();
      } else {
        panelUi.hideRightPanel();
      }
      state.panelVisible = sidebarEnabled;
    }

    logContent("Applied settings to UI", {
      showSidebar: settings.showSidebar,
      playWordAudio: settings.playWordAudio,
      enableAiTooltip: settings.enableAiTooltip,
      preferredAiProvider: settings.preferredAiProvider,
      syncPanelVisibility: shouldSyncPanelVisibility,
      panelVisible: state.panelVisible,
    });
  }

  function removeHost(id) {
    const root = getTarget();
    const el = root.querySelector(`#${id}`);
    if (el) el.remove();
  }

  function destroyUiHosts() {
    // restart 時は UI を一度全破棄し、buildUi で再生成する。
    window.ATVB?.debugPanel?.unmount?.();
    removeHost("atv-panel-host");
    removeHost("atv-toggle-btn");
    removeHost("atv-popup-host");
    destroyOverlay();
    state.panelShadowRoot = null;
    state.popupShadowRoot = null;
    state.debugPanelRoot = null;
  }

  const LANGUAGE_SETUP_NOTICE_ID = "atv-language-setup-notice";

  function isLanguageSelectionReady(settings = {}) {
    const primaryLang = String(settings.primaryLang || "").trim();
    const secondaryLang = String(settings.secondaryLang || "").trim();
    return Boolean(primaryLang && secondaryLang);
  }

  function hideLanguageSetupNotice() {
    const target = getTarget();
    if (!target) return;
    const existing = target.querySelector(`#${LANGUAGE_SETUP_NOTICE_ID}`);
    if (existing) existing.remove();
  }

  function createLanguageSetupNotice() {
    const notice = document.createElement("div");
    notice.id = LANGUAGE_SETUP_NOTICE_ID;
    notice.style.cssText = [
      "position:fixed",
      "top:72px",
      "right:16px",
      "z-index:999999",
      "max-width:320px",
      "background:rgba(20,20,20,0.92)",
      "color:#fff",
      "border:1px solid rgba(255,255,255,0.16)",
      "border-radius:12px",
      "padding:12px 14px",
      "box-shadow:0 8px 24px rgba(0,0,0,0.28)",
      "font-size:13px",
      "line-height:1.5",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "字幕設定が未完了です";
    title.style.cssText = "font-weight:600;margin-bottom:6px;";

    const body = document.createElement("div");
    body.textContent =
      "主言語と副言語の両方を設定すると、二言語字幕を開始できます。";
    body.style.cssText = "opacity:0.92;";

    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;gap:8px;margin-top:10px;justify-content:flex-end;";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "設定を開く";
    openBtn.style.cssText = [
      "background:#fff",
      "color:#111",
      "border:none",
      "border-radius:8px",
      "padding:6px 10px",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
    ].join(";");
    openBtn.addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
      } catch (_) {}
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "閉じる";
    closeBtn.style.cssText = [
      "background:transparent",
      "color:#fff",
      "border:1px solid rgba(255,255,255,0.24)",
      "border-radius:8px",
      "padding:6px 10px",
      "font-size:12px",
      "cursor:pointer",
    ].join(";");
    closeBtn.addEventListener("click", () => {
      hideLanguageSetupNotice();
    });

    actions.appendChild(closeBtn);
    actions.appendChild(openBtn);
    notice.appendChild(title);
    notice.appendChild(body);
    notice.appendChild(actions);
    return notice;
  }

  function showLanguageSetupNotice() {
    const target = getTarget();
    if (!target) return;

    const existing = target.querySelector(`#${LANGUAGE_SETUP_NOTICE_ID}`);
    if (existing) return;

    target.appendChild(createLanguageSetupNotice());
  }

  function createToggleButton() {
    if (getTarget().querySelector("#atv-toggle-btn")) return;

    const btn = document.createElement("button");
    btn.id = "atv-toggle-btn";
    btn.textContent = "📋";
    btn.title = "字幕パネルを開く";
    btn.style.cssText = [
      "position:fixed",
      "top:60px",
      "right:16px",
      "z-index:999999",
      "background:rgba(0,0,0,0.7)",
      "color:white",
      "border:1px solid rgba(255,255,255,0.25)",
      "border-radius:8px",
      "padding:4px 10px",
      "font-size:16px",
      "cursor:pointer",
      "backdrop-filter:blur(4px)",
      "display:none",
    ].join(";");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      panelUi.togglePanel(true);
    });

    getTarget().appendChild(btn);
  }

  // [UI shell: subtitle popup]
  // [UI shell: subtitle popup style]
  function buildPopupShellStyleText() {
    return `
        #popup {
          display: none; position: fixed; width: 340px;
          background: #1c1c1e; border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.8);
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px; color: #f0f0f0; pointer-events: auto; z-index: 999999;
        }
        #popup-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 12px 14px 10px; background: rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        #popup-header-left { display: flex; flex-direction: column; gap: 4px; flex: 1; }
        #popup-word-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        #popup-word { font-size: 1.2rem; font-weight: 700; color: #ffe566; }
        #popup-reading { font-size: 12px; color: #888; margin-top: 2px; }
        .badge {
          display: inline-block; font-size: 10px; font-weight: 600;
          padding: 2px 7px; border-radius: 10px; letter-spacing: 0.03em;
        }
        .badge-common { background: rgba(80,200,120,0.2); color: #50c878; border: 1px solid rgba(80,200,120,0.3); }
        .badge-jlpt   { background: rgba(255,229,102,0.15); color: #ffe566; border: 1px solid rgba(255,229,102,0.3); }
        #popup-close {
          background: none; border: none; color: rgba(255,255,255,0.5);
          cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; flex-shrink: 0;
        }
        #popup-close:hover { color: #fff; }
        #popup-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .popup-tab {
          flex: 1; padding: 8px; background: none; border: none;
          color: #aaa; cursor: pointer; font-size: 12px;
        }
        .popup-tab.active { background: rgba(255,255,255,0.08); color: #fff; }
        .popup-tab:hover  { background: rgba(255,255,255,0.05); }
        .popup-pane {
          min-height: 60px; max-height: 300px;
          overflow-y: auto; display: none;
        }
        #popup-body {
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .popup-pane.active { display: block; }
        .dict-section {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .dict-section:last-child { border-bottom: none; }
        .dict-section-title {
          font-size: 11px; color: #666; font-weight: 600;
          letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px;
        }
        .ejdict-gloss {
          color: #ddd; font-size: 13px; line-height: 1.7; margin-bottom: 6px;
        }
        .ejdict-gloss span { color: #888; margin: 0 4px; }
        .dict-sense { margin-bottom: 8px; }
        .dict-pos {
          font-size: 10px; color: #888; font-style: italic; margin-bottom: 3px;
        }
        .dict-def {
          color: #bbb; font-size: 12px; line-height: 1.5;
        }
        .dict-def-num { color: #ffe566; font-size: 11px; margin-right: 4px; }
        .tatoeba-link {
          font-size: 10px; color: #666; text-decoration: none; float: right;
        }
        .tatoeba-link:hover { color: #aaa; }
        .example-sentence {
          position: relative; cursor: default;
          color: #ccc; font-size: 12px; line-height: 1.8;
          padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .example-sentence:last-child { border-bottom: none; }
        .example-sentence:hover { color: #fff; }
        .example-sentence::after {
          content: attr(data-ja);
          display: none;
          position: absolute;
          bottom: calc(100% + 4px); left: 0;
          background: rgba(20,20,20,0.97); color: #ffe566;
          border: 1px solid rgba(255,229,102,0.25);
          padding: 5px 10px; border-radius: 6px;
          font-size: 12px; white-space: nowrap;
          pointer-events: none; z-index: 99999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        }
        .example-sentence:hover::after { display: block; }
        .atv-word-link {
          cursor: pointer;
          border-radius: 2px;
          padding: 0 1px;
        }
        .atv-word-link:hover { background: rgba(255,220,80,0.3); color: #fff; }
        .ai-label  { color: #aaa; font-size: 11px; margin-bottom: 6px; }
        .ai-result { color: #fff; font-size: 13px; line-height: 1.5; }
        .loading   { color: #666; font-size: 12px; display: block; padding: 12px 14px; }
        .error     { color: #ff6b6b; font-size: 12px; display: block; padding: 12px 14px; }
    `;
  }

  // [UI shell: subtitle popup] subtitle popup の style 参照・header・tabs・pane の HTML 骨格を返す。
  function buildPopupShellHTML() {
    return `
      <style>
        ${buildPopupShellStyleText()}
      </style>
      <div id="popup" aria-hidden="true">
        <div id="popup-header">
          <div id="popup-header-left">
            <div id="popup-word-row">
              <span id="popup-word"></span>
              <span id="popup-badges"></span>
            </div>
            <div id="popup-reading"></div>
          </div>
          <button id="popup-close" type="button" aria-label="Close popup">✕</button>
        </div>
        <div id="popup-tabs">
          <button class="popup-tab active" data-tab="dict" type="button">📖 辞書</button>
          <button class="popup-tab" data-tab="ai" type="button">🤖 AI翻訳</button>
        </div>
        <div id="popup-body">
          <div class="popup-pane active" id="pane-dict"><span class="loading">検索中...</span></div>
          <div class="popup-pane" id="pane-ai"><span class="loading">翻訳中...</span></div>
        </div>
      </div>
    `;
  }

  // popup を閉じる共通処理。
  // close button / outside click のどちらからでも同じ状態へ戻す。
  function hidePopupDisplay() {
    const popup = state.popupShadowRoot?.getElementById("popup");
    if (!popup) return;

    popup.hidden = true;
    popup.setAttribute("aria-hidden", "true");
    popup.style.display = "none";
  }

  function registerPopupOutsideClickHandler(popup) {
    // 既存 handler があれば先に外し、二重登録を避ける。
    if (state.popupDocClickHandler) {
      document.removeEventListener("click", state.popupDocClickHandler);
    }

    // popup 外クリックだけで閉じる。
    state.popupDocClickHandler = (e) => {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (path.includes(popup)) return;
      hidePopupDisplay();
    };

    document.addEventListener("click", state.popupDocClickHandler);
  }

  function wirePopupTabEvents(root) {
    root.querySelectorAll(".popup-tab").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        root
          .querySelectorAll(".popup-tab")
          .forEach((b) => b.classList.remove("active"));
        root
          .querySelectorAll(".popup-pane")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        root.getElementById("pane-" + btn.dataset.tab)?.classList.add("active");
      });
    });
  }

  function registerPopupWordLinkHandler(root) {
    // subtitle popup 内の動的単語リンククリックを拾う listener 登録
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.classList.contains("atv-word-link")) return;

      e.stopPropagation();
      const word = target.textContent.trim();
      if (!word) return;

      const rect = target.getBoundingClientRect();
      showPopup(word, word, rect, { source: "panel" });
    });
  }

  // [wiring: subtitle popup] close / tab / dynamic word link の UI イベントを subtitle popup shell に接続する。
  function wireSubtitlePopupUiEvents() {
    const root = state.popupShadowRoot;
    if (!root) return;
    if (root.__atvbPopupUiWired === true) return;

    const popup = root.getElementById("popup");
    if (!popup) return;

    root.getElementById("popup-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopupDisplay();
    });

    wirePopupTabEvents(root);
    registerPopupOutsideClickHandler(popup);
    registerPopupWordLinkHandler(root);

    // 同じ shadow root へ重ねて bind しないためのフラグ。
    root.__atvbPopupUiWired = true;
  }

  function mountPopupHost(target) {
    // [shell: subtitle popup host mount] popup host を生成して playback target に追加する。
    const host = document.createElement("div");
    host.id = "atv-popup-host";
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:auto;";
    target.appendChild(host);

    // [shell: subtitle popup shadow mount] shadow root を attach し、subtitle popup shell HTML を注入する。
    state.popupShadowRoot = host.attachShadow({ mode: "open" });
    state.popupShadowRoot.innerHTML = buildPopupShellHTML();
  }

  // [UI shell: subtitle popup host] host 再利用・mount・shadow shell 注入・popup wiring をまとめて行う。
  function createPopupHost() {
    const target = getTarget();
    const existingHost = target.querySelector("#atv-popup-host");
    if (existingHost) {
      state.popupShadowRoot = existingHost.shadowRoot || state.popupShadowRoot;
      wireSubtitlePopupUiEvents();
      return;
    }

    mountPopupHost(target);

    // [wiring: subtitle popup] popup UI event handlers を shell に接続する。
    wireSubtitlePopupUiEvents();
  }

  // [debug mount] debug panel モジュールを panelShadowRoot にマウントする。
  // HTML shell は buildPanelDebugShellHTML が担い、UI wiring は debugPanel.mount 側へ委ねる。
  function createDebugPanel() {
    if (!state.panelShadowRoot) return;
    state.debugPanelRoot = state.panelShadowRoot;
    const debugPanel = window.ATVB?.debugPanel;
    if (!debugPanel?.mount) return;

    debugPanel.mount(state.debugPanelRoot, {
      getFilter: getLiveDebugLogFilter,
      getLogText: getDebugLogText,
      clearLogs: clearDebugLogs,
      downloadLogs: (text, done) => {
        // 保存先ダイアログは background 側の downloads API で開く。
        sendToBackground({ type: "DOWNLOAD_DEBUG_LOG", text }, (res) => {
          if (typeof done === "function") {
            done({
              ok: !!res?.ok,
              downloadId: res?.downloadId ?? null,
              error: res?.error ?? "unknown",
            });
          }
        });
      },
      logInfo: logContentUi,
      logError: logContentError,
    });
  }
  
  async function updateLiveDebugPanel() {
    try {
      await window.ATVB?.debugPanel?.update?.();
    } catch (error) {
      console.warn("[ATV-Bilingual] updateLiveDebugPanel failed:", error);
    }
  }

  function repositionPopup(reason = "manual") {
    if (!state.popupShadowRoot || !state.popupLastContext) return;

    const popup = state.popupShadowRoot.getElementById("popup");
    if (!popup || popup.style.display === "none") return;

    popup.style.maxHeight =
      Math.max(220, Math.min(window.innerHeight * 0.7, 520)) + "px";
    popup.style.overflow = "hidden";

    const popupBody = state.popupShadowRoot.getElementById("popup-body");
    if (popupBody) {
      popupBody.style.maxHeight =
        Math.max(120, Math.min(window.innerHeight * 0.7, 520) - 96) + "px";
      popupBody.style.overflowY = "auto";
      popupBody.style.overscrollBehavior = "contain";
    }

    const { anchorRect, popupSource, word, sentenceLength } =
      state.popupLastContext;
    if (!anchorRect) return;

    const pw = 340;
    const ph = popup.offsetHeight || 360;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const videoRect =
      popupSource === "overlay"
        ? state.video?.getBoundingClientRect?.() ||
          document.querySelector("video")?.getBoundingClientRect?.() ||
          null
        : null;

    const minLeft = videoRect ? videoRect.left + margin : margin;
    const maxRight = videoRect ? videoRect.right - margin : vw - margin;
    const minTop = videoRect ? videoRect.top + margin : margin;
    const maxBottom = videoRect ? videoRect.bottom - margin : vh - margin;

    const topAbove = anchorRect.top - ph - margin;
    const topBelow = anchorRect.bottom + margin;

    let top = topAbove;
    let placement = "above";
    if (topAbove >= minTop) {
      top = topAbove;
      placement = "above";
    } else if (topBelow + ph <= maxBottom) {
      top = topBelow;
      placement = "below";
    } else {
      top = Math.max(minTop, maxBottom - ph);
      placement = "clamped";
    }

    let left = anchorRect.left;
    left = Math.min(left, maxRight - pw);
    left = Math.max(left, minLeft);

    popup.style.left = left + "px";
    popup.style.top = top + "px";

    logContent("showPopup position", {
      word,
      sentenceLength,
      popupSource,
      reason,
      placement,
      popupWidth: pw,
      popupHeight: ph,
      finalLeft: left,
      finalTop: top,
      anchorRect: anchorRect
        ? {
            left: anchorRect.left,
            top: anchorRect.top,
            right: anchorRect.right,
            bottom: anchorRect.bottom,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null,
      videoRect: videoRect
        ? {
            left: videoRect.left,
            top: videoRect.top,
            right: videoRect.right,
            bottom: videoRect.bottom,
            width: videoRect.width,
            height: videoRect.height,
          }
        : null,
    });
  }

  function ensurePopupResizeObserver() {
    if (state.popupResizeObserver || typeof ResizeObserver === "undefined")
      return;

    const popup = state.popupShadowRoot?.getElementById("popup");
    if (!popup) return;

    state.popupResizeObserver = new ResizeObserver(() => {
      if (!state.popupLastContext) return;
      repositionPopup("resize_observer");
    });

    state.popupResizeObserver.observe(popup);
  }

  function resetPopupDisplayState(clean) {
    const root = state.popupShadowRoot;
    const popup = root?.getElementById("popup");
    if (!root || !popup) return null;

    root.getElementById("popup-word").textContent = clean;
    root.getElementById("popup-reading").textContent = "";
    root.getElementById("popup-badges").innerHTML = "";
    root.getElementById("pane-dict").innerHTML =
      '<span class="loading">検索中...</span>';
    root.getElementById("pane-ai").innerHTML =
      '<span class="loading">翻訳中...</span>';

    root
      .querySelectorAll(".popup-tab")
      .forEach((b) => b.classList.remove("active"));
    root
      .querySelectorAll(".popup-pane")
      .forEach((b) => b.classList.remove("active"));
    root.querySelector('[data-tab="dict"]')?.classList.add("active");
    root.getElementById("pane-dict")?.classList.add("active");

    return popup;
  }

  function buildPopupDisplayContext(word, sentence, anchorRect, popupSource) {
    return {
      word,
      sentenceLength: (sentence || "").length,
      popupSource,
      anchorRect: anchorRect
        ? {
            left: anchorRect.left,
            top: anchorRect.top,
            right: anchorRect.right,
            bottom: anchorRect.bottom,
            width: anchorRect.width,
            height: anchorRect.height,
          }
        : null,
    };
  }

  function openPopupDisplay(popup) {
    popup.hidden = false;
    popup.setAttribute("aria-hidden", "false");
    popup.style.display = "block";
    ensurePopupResizeObserver();
    repositionPopup("initial");
  }

  function positionPopup(anchorRect, word = "") {
    if (!state.popupShadowRoot) return;

    const popup = state.popupShadowRoot.getElementById("popup");
    const host = document.getElementById("atv-popup-host");
    if (!popup || !host || !anchorRect) return;

    const popupRect = popup.getBoundingClientRect();
    const margin = 12;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;

    let left = anchorRect.left + anchorRect.width / 2 - popupRect.width / 2;
    let top = anchorRect.bottom + 10;

    if (left < margin) left = margin;
    if (left + popupRect.width > viewportWidth - margin) {
      left = viewportWidth - popupRect.width - margin;
    }

    if (top + popupRect.height > viewportHeight - margin) {
      top = anchorRect.top - popupRect.height - 10;
    }

    if (top < margin) top = margin;

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;

    logContent("showPopup position", {
      word,
      anchorLeft: Math.round(anchorRect.left),
      anchorTop: Math.round(anchorRect.top),
      anchorWidth: Math.round(anchorRect.width),
      anchorHeight: Math.round(anchorRect.height),
      popupWidth: Math.round(popupRect.width),
      popupHeight: Math.round(popupRect.height),
      left: Math.round(left),
      top: Math.round(top),
    });
  }

  // [render: subtitle popup display] subtitle popup の表示内容を初期化し、位置を決めて辞書/翻訳取得を開始する。
  function showPopup(word, sentence, anchorRect, options = {}) {
    if (!state.popupShadowRoot) return;

    const clean = String(word || "")
      .trim()
      .replace(/[’]/g, "'")
      .replace(
        /^[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF']+|[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF']+$/g,
        "",
      )
      .replace(/^'+|'+$/g, "");
    if (!clean) return;

    const popupSource = options.source || "unknown";
    const popupContext = buildPopupDisplayContext(
      clean,
      sentence,
      anchorRect,
      popupSource,
    );

    state.popupLastContext = popupContext;

    const popup = state.popupShadowRoot.getElementById("popup");
    if (!popup) return;

    popup.style.display = "block";
    popup.setAttribute("aria-hidden", "false");

    const root = state.popupShadowRoot;
    root.getElementById("popup-word").textContent = clean;
    root.getElementById("popup-reading").textContent = "";

    const paneDict = root.getElementById("pane-dict");
    const badgesEl = root.getElementById("popup-badges");
    const readingEl = root.getElementById("popup-reading");

    if (badgesEl) badgesEl.innerHTML = "";
    if (paneDict) paneDict.innerHTML = buildDictionaryLoadingHtml(clean);

    positionPopup(anchorRect, clean);
    requestPopupDictionaryData(clean, badgesEl, readingEl);

    logContent("showPopup", popupContext);
  }

  function applyJishoDictionaryResult(word, res, badgesEl, readingEl) {
    const jishoEl = state.popupShadowRoot?.getElementById("jisho-section");
    if (!jishoEl) return;

    if (!res?.ok) {
      logContent("fetchDictionary Jisho failed", {
        word,
        error: res?.error ?? "unknown",
      });

      repositionPopup("dictionary_failed");

      jishoEl.innerHTML =
        res?.error === "not_found"
          ? ""
          : `<span class="error">Jisho エラー: ${res?.error ?? "unknown"}</span>`;
      return;
    }

    const badges = [
      res.isCommon
        ? '<span class="badge badge-common">よく使われる語</span>'
        : "",
      res.jlpt ? `<span class="badge badge-jlpt">${res.jlpt}</span>` : "",
    ]
      .filter(Boolean)
      .join("");

    if (badgesEl) badgesEl.innerHTML = badges;
    if (readingEl)
      readingEl.textContent = res.reading ? `/${res.reading}/` : "";

    const sensesHtml = (res.meanings ?? [])
      .map((sense, i) => {
        const pos = sense.partsOfSpeech?.join(", ") ?? "";
        const defs = sense.definitions ?? [];
        if (defs.length === 0) return "";
        return `
          <div class="dict-sense">
            ${pos ? `<div class="dict-pos">${pos}</div>` : ""}
            ${defs
              .map(
                (d, j) =>
                  `<div class="dict-def"><span class="dict-def-num">${i * defs.length + j + 1}.</span>${d}</div>`,
              )
              .join("")}
          </div>
        `;
      })
      .join("");

    jishoEl.innerHTML = sensesHtml
      ? `<div class="dict-section-title" style="margin-bottom:8px">🔤 Jisho</div>${sensesHtml}`
      : "";

    logContent("fetchDictionary Jisho success", {
      word,
      reading: res.reading || "",
      meaningsCount: (res.meanings ?? []).length,
      jlpt: res.jlpt || "",
      isCommon: !!res.isCommon,
    });
    repositionPopup("dictionary_loaded");
  }

  function applyTatoebaExamplesResult(word, res) {
    const tatEl = state.popupShadowRoot?.getElementById("tatoeba-section");
    if (!tatEl) return;

    if (!res?.ok || !res.results?.length) {
      tatEl.innerHTML = "";
      logContent("fetchTatoeba UI empty", {
        word,
        ok: !!res?.ok,
        resultCount: res?.results?.length ?? 0,
      });
      repositionPopup("tatoeba_empty");
      return;
    }

    const sentencesHtml = res.results
      .map((r) => {
        const enEsc = r.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const jaEsc = (r.translation || "")
          .replace(/"/g, "&quot;")
          .replace(/&/g, "&amp;");
        const tokenized = enEsc.replace(
          /\b([a-zA-Z']+)\b/g,
          '<span class="atv-word-link">$1</span>',
        );
        return `<div class="example-sentence" data-ja="${jaEsc}">${tokenized}</div>`;
      })
      .join("");

    tatEl.innerHTML = `
      <div class="dict-section-title">
        💬 例文
        <a class="tatoeba-link" href="https://tatoeba.org/ja/sentences/search?query=${encodeURIComponent(word)}" target="_blank" rel="noopener">Tatoeba ↗</a>
      </div>
      ${sentencesHtml}
    `;

    logContent("fetchTatoeba UI success", {
      word,
      resultCount: res.results.length,
    });
    repositionPopup("tatoeba_loaded");
  }

  function buildDictionaryLoadingHtml(word) {
    const ejGloss = ejdictLookup(word);
    const ejHtml = ejGloss
      ? `<div class="dict-section">
           <div class="dict-section-title">📖 意味</div>
           <div class="ejdict-gloss">${ejGloss
             .split("/")
             .map((s) => s.trim())
             .filter(Boolean)
             .map(
               (s, i) =>
                 `<span style="color:#ffe566;font-size:11px">${i + 1}.</span> ${s}`,
             )
             .join("<br>")}</div>
         </div>`
      : "";

    return (
      ejHtml +
      `<div class="dict-section" id="jisho-section"><span class="loading">Jisho 検索中...</span></div>` +
      `<div class="dict-section" id="tatoeba-section"><span class="loading">例文取得中...</span></div>`
    );
  }

  function requestPopupDictionaryData(word, badgesEl, readingEl) {
    sendToBackground({ type: "FETCH_DICT", word }, (res) => {
      applyJishoDictionaryResult(word, res, badgesEl, readingEl);
    });

    sendToBackground({ type: "FETCH_TATOEBA", word }, (res) => {
      applyTatoebaExamplesResult(word, res);
    });
  }

  function fetchDictionary(word) {
    const paneDict = state.popupShadowRoot.getElementById("pane-dict");
    const badgesEl = state.popupShadowRoot.getElementById("popup-badges");
    const readingEl = state.popupShadowRoot.getElementById("popup-reading");

    logContent("fetchDictionary UI start", { word });

    paneDict.innerHTML = buildDictionaryLoadingHtml(word);
    requestPopupDictionaryData(word, badgesEl, readingEl);
  }

  function applyTranslationResult(el, res) {
    if (res?.ok) {
      el.innerHTML = `<div class="ai-label" style="padding:12px 14px 0">翻訳：</div><div class="ai-result" style="padding:4px 14px 12px">${res.translated}</div>`;
      logContent("fetchTranslation UI success", {
        translatedLength: (res.translated || "").length,
      });
      repositionPopup("translation_loaded");
      return;
    }

    el.innerHTML = `<span class="error">エラー: ${res?.error ?? "unknown"}</span>`;
    logContent("fetchTranslation UI error", {
      error: res?.error ?? "unknown",
    });
    repositionPopup("translation_failed");
  }

  function fetchTranslation(text) {
    const el = state.popupShadowRoot.getElementById("pane-ai");

    logContent("fetchTranslation UI start", {
      textLength: (text || "").length,
    });

    sendToBackground({ type: "FETCH_TRANSLATE", text }, (res) => {
      if (!state.popupShadowRoot) return;
      applyTranslationResult(el, res);
    });
  }

  function makeClickableSpans(text, sentence) {
    if (!text) return "";
    return text
      .split("\n")
      .map((line) =>
        line
          .split(" ")
          .map((word) => {
            if (!word.trim()) return " ";
            const esc = word
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;");
            return `<span class="atv-word" data-word="${esc}" data-sentence="${encodeURIComponent(sentence)}">${esc}</span>`;
          })
          .join(" "),
      )
      .join("<br>");
  }

  const createPanelUi = window.ATVB?.panelUi?.createPanelUi;

  if (typeof createPanelUi !== "function") {
    throw new Error("ATVB panelUi.createPanelUi is not available");
  }

  const createPanelRenderer = window.ATVB?.panelRenderer?.createPanelRenderer;
  const subtitleBlockResolverApi = window.ATVB?.subtitleBlockResolver || {};
  const {
    resolvePanelBlocksForRender = () => ({
      blocks: [],
      currentBlocks: [],
      usedCurrentFallback: false,
      sameWindowGroups: new Map(),
    }),
  } = subtitleBlockResolverApi;
  const createCueController = window.ATVB?.cueController?.createCueController;


  if (typeof createPanelRenderer !== "function") {
    throw new Error("ATVB panelRenderer.createPanelRenderer is not available");
  }

  if (typeof createCueController !== "function") {
    throw new Error("ATVB cueController.createCueController is not available");
  }

  const root = (window.ATVB = window.ATVB || {});
  const vttDeps = window.ATVB?.vtt || {};
  const resolverDeps = window.ATVB?.resolver || {};
  const subtitleBlocksDeps = window.ATVB?.subtitleBlocks || {};
  const { buildSubtitleBlockSequence } = subtitleBlocksDeps;

  function getTrackCuesLength(track) {
    return resolverDeps.getTrackCuesLength?.(track) ?? 0;
  }

  function getTrackActiveCuesLength(track) {
    return resolverDeps.getTrackActiveCuesLength?.(track) ?? 0;
  }

  function normalizeSubtitleText(text) {
    return vttDeps.normalizeSubtitleText?.(text) ?? "";
  }

  function setSubtitleBlocks(blocks) {
    state.subtitleBlocks = Array.isArray(blocks) ? blocks : [];
  }

  function getSubtitleBlockSequence() {
    return Array.isArray(state.subtitleBlocks) ? state.subtitleBlocks : [];
  }

  function getCurrentSubtitleBlockFromSequence() {
    return state.currentSubtitleBlock || null;
  }

  function setCurrentSubtitleBlock(block, meta = null) {
    state.currentSubtitleBlock = block || null;
    state.subtitleBlockMeta = meta || null;
  }

  function clearSecondaryTrackState() {
    state.secondaryTrack = null;
    state.lastSecondarySyncContext = null;

    if (state.secondaryHideTimer) {
      clearTimeout(state.secondaryHideTimer);
      state.secondaryHideTimer = null;
    }

    renderSecondarySubtitle("", null);
  }

  function teardownForRestart() {
    stopPlaybackControlLayoutObservers();
    layoutController?.teardownPlaybackControlsUi?.();

    clearInitialCueRecovery();
    clearSecondaryTrackState();
    overlayController.clearOverlayState?.();
    destroyOverlay();
    destroyUiHosts();
  }

  function prepareForRestart() {
    clearInternalSubtitleState("prepareForRestart");

    state.primaryTrack = null;
    state.secondaryTrack = null;
    state.currentSubtitleBlock = null;
    state.subtitleBlockMeta = null;
    state.lastPanelRenderSnapshot = null;

    state.subtitleHistory = [];
    state.panelPastBlocks = [];
    state.subtitleBlocks = [];
    state.subtitleCurrentIndex = -1;
  }

  const { renderPanel } = createPanelRenderer({
    resolvePanelBlocksForRender,
    state,
    makeClickableSpans,
    formatTime: vttDeps.formatTime,
    showPopup,
    findCueAt,
    getCurrentCue,
    cleanCueText: vttDeps.cleanCueText,
    logContent,
    PANEL_PRIMARY_GRACE_MS,
    DEBUG_PANEL_PROBE,
  });

  const { createPlaybackControlsLayout } = root.playbackControlsLayout;
  const playbackControlsLayout = createPlaybackControlsLayout({
    PLAYBACK_HEADER_BASE_WIDTH_ATTR,
    PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR,
    PLAYBACK_FOOTER_BASE_WIDTH_ATTR,
    PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR,
    PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR,
    PLAYBACK_PROGRESS_BASE_WIDTH_ATTR,
    PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR,
    PLAYBACK_SKIP_BASE_LEFT_ATTR,
    PLAYBACK_SKIP_BASE_RIGHT_ATTR,
    PLAYBACK_SKIP_BASE_TRANSFORM_ATTR,
    DEBUG_SECONDARY_SUBS,
    logContent,
  });

  const {
    PLAYBACK_CONTROLS_LAYOUT,
    getPlaybackControlsLayoutTargets:
      getPlaybackControlsLayoutTargetsFromModule,
  } = playbackControlsLayout;

  const { createLayoutController } = root;

  if (typeof createLayoutController !== "function") {
    throw new Error("ATVB createLayoutController is not available");
  }

  const layoutController = createLayoutController({
    playbackControlsLayoutApi: playbackControlsLayout,
    logContent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });

  layoutController.initForPanelVisible(state.panelVisible);

  const { createOverlayController } = root.overlayController;
  const overlayController = createOverlayController({
    getOverlayRoot: () => state.overlayRoot,
    setOverlayRoot: (rootNode) => {
      state.overlayRoot = rootNode;
    },
    getTarget,
    makeClickableSpans,
    showPopup,
    getPlaybackControlsLayoutTargets:
      getPlaybackControlsLayoutTargetsFromModule,
    PLAYBACK_CONTROLS_LAYOUT,
    setStyleIfChanged,
  });

  const cueController = createCueController({
    state,
    logContent,
    DEBUG_SECONDARY_SUBS,
    getSecondaryTrackDebugPayload,
    resolveSecondarySubtitleTrack: resolverDeps.resolveSecondarySubtitleTrack,
    getCurrentCueText,
    getTrackCuesLength: resolverDeps.getTrackCuesLength,
    getTrackActiveCuesLength: resolverDeps.getTrackActiveCuesLength,
    getRequestedSecondaryLanguage: () =>
      state.requestedSecondaryLang || state.contentSettings.secondaryLang,
    getPrimaryTrack: () => state.primaryTrack,
    getSecondaryTrack: () => state.secondaryTrack,
    getCurrentCue,
    cleanCueText: vttDeps.cleanCueText,
    getCurrentTime: () => state.video?.currentTime ?? 0,
    getPrimaryTrackCues: () => state.primaryTrack?.cues || [],
    getSecondaryTrackCues: () => state.secondaryTrack?.cues || [],
    getPreviousSubtitleBlocks: () => getSubtitleBlockSequence() || [],
    buildSubtitleBlockSequence,
    setSubtitleBlocks,
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence,
    setCurrentSubtitleBlock,
    DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    updateOverlay: (...args) => overlayController.updateOverlay(...args),
    updateOverlayFromView: (view) =>
      overlayController.updateOverlayFromView(view, {
        contentKey: state.currentContentKey || "",
      }),
    updateOverlayFromBlock: (block) =>
      overlayController.updateOverlayFromBlock(block, {
        contentKey: state.currentContentKey || "",
      }),
    renderPanel,
  });

  panelUi = createPanelUi({
    state,
    getTarget,
    ensureSecondarySubtitleElement,
    getLiveDebugLogFilter,
    getDebugLogText,
    clearDebugLogs,
    sendToBackground,
    onClosePanel: () => panelUi.togglePanel(false),
    applyLayout,
    persistPanelVisibility,
    logContent,
    renderCurrentSnapshot,
    renderPanel,
  });



  const { createRuntimeObservers } = root.runtimeObservers;
  const runtimeObservers = createRuntimeObservers({
    state,
    logContent,
    getPlaybackContext,
    getPlaybackControlsLayoutTargets:
      getPlaybackControlsLayoutTargetsFromModule,
    scheduleAdjustPlaybackControls,
    scheduleControlSettlingBurst,
  });

  const { createSettingsRuntime } = root.settingsRuntime;
  const settingsRuntime = createSettingsRuntime({
    state,
    DEFAULT_SETTINGS,
    isLanguageSelectionReady,
    clearSecondaryTrackState,
    logContent,
    logContentError,
    logContentSettings,
    getVideoAndDialog,
    teardownForRestart,
    prepareForRestart,
    startBilingual,
    isPlaybackPageReady,
    getPlaybackContextLogPayload,
    getUniqueTracks: resolverDeps.getUniqueTracks,
    cueController,
    renderSecondarySubtitle,
  });

  const {
    loadSettingsSnapshot,
    loadSettingsFromSync,
    restartBilingual,
    ensureMessageListener,
  } = settingsRuntime;

  ensureMessageListener();

  const createReinitializeCoordinator =
    root.createReinitializeCoordinator || null;
  const reinitializeCoordinator = createReinitializeCoordinator
    ? createReinitializeCoordinator({
        state,
        panelUi,
        loadSettingsSnapshot,
        getVideoAndDialog,
        getCurrentVideoSrcKey,
        syncHistoryContextWithPlayback,
        clearInternalSubtitleState,
        selectPrimaryAndSecondaryTracks,
        TRACK_RESOLVE_RETRY_DELAYS_MS,
        logContent,
        logContentSubtitle,
        logContentError,
      })
    : null;

  const initialCueRecovery = window.ATVB?.createInitialCueRecovery?.({
    state,
    cueController,
    services: {
      logContent,
      panelUi,
      getTrackActiveCuesLength: resolverDeps.getTrackActiveCuesLength,
      getCurrentCueText,
      renderSecondarySubtitle,
      clearInitialCueRecovery,
      hasRecoverableInitialCue,
      tryCompleteInitialCueRecovery,
      bindInitialCueRecoveryListeners,
      scheduleInitialCueRecoveryRetries,
      getRequestedSecondaryLang: () =>
        state.requestedSecondaryLang || state.contentSettings.secondaryLang,
    },
  }) ?? null;

let syncIntervalOrchestrator = null;

function ensureSyncIntervalOrchestrator() {
  if (syncIntervalOrchestrator) return syncIntervalOrchestrator;
  if (!window.ATVB?.createSyncIntervalOrchestrator) return null;

  syncIntervalOrchestrator =
    window.ATVB.createSyncIntervalOrchestrator({
      state,
      controllers: {
        cueController,
      },
      services: {
        logContent,
        getVideoAndDialog,
        getCurrentVideoSrcKey,
        syncHistoryContextWithPlayback,
        renderCurrentSnapshot,
        renderPanel,
        reloadSettingsAndReinitialize: (reason) =>
          reinitializeCoordinator?.reloadSettingsAndReinitialize?.(reason),
        debugPanelProbe: DEBUG_PANEL_PROBE,
        getTrackActiveCuesLength,
        getCurrentCueText,
        normalizeSubtitleText: vttDeps.normalizeSubtitleText,
        getMergedSubtitleHealthSnapshot,
        syncSecondarySubtitleTrackBinding,
        syncSecondarySubtitleTrack,
        renderSecondarySubtitle,
        resolverDeps,
        panelUi,
        initialCueRecovery,
        getRequestedSecondaryLang: () => state.requestedSecondaryLang,
      },
    }) || null;

  return syncIntervalOrchestrator;
}

  const { setOverlayVisible, destroyOverlay, createOverlay } =
    overlayController;

  const {
    waitForVideo,
    refreshPlaybackControlResizeObserverTargets,
    startPlaybackControlLayoutObservers,
    stopPlaybackControlLayoutObservers,
  } = runtimeObservers;

  function loadPanelVisibility() {
    return Promise.resolve(state.contentSettings.showSidebar !== false);
  }

  function persistPanelVisibility() {
    const nextSettings = {
      showSidebar: state.panelVisible,
    };

    chrome.storage.sync.set(nextSettings, () => {
      if (chrome.runtime.lastError) {
        logContentError("showSidebar persist failed", {
          error: chrome.runtime.lastError.message,
          showSidebar: state.panelVisible,
        });
        return;
      }

      state.contentSettings = {
        ...state.contentSettings,
        showSidebar: state.panelVisible,
      };

      logContent("showSidebar persisted from playback toggle", {
        showSidebar: state.panelVisible,
      });

      chrome.runtime.sendMessage(
        {
          type: "APPLY_SETTINGS_TO_APPLE_TV",
          reason: "playback_toggle",
          settings: nextSettings,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            logContentError("playback toggle settings dispatch failed", {
              error: chrome.runtime.lastError.message,
              showSidebar: state.panelVisible,
            });
            return;
          }

          logContent("playback toggle settings dispatched", {
            showSidebar: state.panelVisible,
            ok: response?.ok ?? null,
          });
        },
      );
    });
  }

  function clearInitialCueRecoveryTimers() {
    if (!state.initialCueRecoveryTimers.length) return;
    state.initialCueRecoveryTimers.forEach((timerId) => clearTimeout(timerId));
    state.initialCueRecoveryTimers = [];
  }

  function clearInitialCueRecoveryCleanup() {
    if (!state.initialCueRecoveryCleanup.length) return;
    state.initialCueRecoveryCleanup.forEach((cleanup) => {
      try {
        cleanup();
      } catch (_) {}
    });
    state.initialCueRecoveryCleanup = [];
  }

  function clearInitialCueRecovery() {
    clearInitialCueRecoveryTimers();
    clearInitialCueRecoveryCleanup();
  }

  // [binder/cue: attach] primary / secondary track の選択・bind・unbind を扱うセクション。
  // attach 軸では track selection と listener binding の境界をコメントで追える状態に保つ。

  // [binder/cue: attach] track selection
  // [binder/cue: attach] primary / secondary track を選択し、listener bind の入口をまとめる。
  // overlay / panel への描画更新は fan-out 側が担い、この関数では track attach の責務を読む。
  function selectPrimaryAndSecondaryTracks(
    video,
    primaryLang,
    secondaryLang,
    reason = "unknown",
  ) {
    if (!video?.textTracks) {
      return {
        reason,
        trackCount: 0,
        primaryTrackFound: false,
        secondaryTrackFound: false,
        primaryListenerBound: false,
        secondaryListenerBound: false,
      };
    }

  state.video = video;

  if (state.primaryTrack) {
    try {
      state.primaryTrack.removeEventListener("cuechange", onCueChange);
    } catch (_) {}
    state.primaryTrack = null;
  }

  cueController.unbindSecondarySubtitleTrack();
  state.secondaryTrack = null;

    // [attach: primary/secondary reset] 既存 bind を一度解除してから今回の track 選択に入る。

    const tracks = video.textTracks;
    let primaryListenerBound = false;

    // [attach: primary] primary resolver → mode 設定 → cuechange bind
    state.primaryTrack = resolverDeps.pickBestSubtitleTrack(
      tracks,
      primaryLang,
    );
    if (state.primaryTrack) {
      try {
        // 非英語 primary track の cue 可用性を上げるため secondary と同じ showing にする。
        // ネイティブ字幕表示は overlay.css の video::cue 非表示で抑止済み。
        state.primaryTrack.mode = "showing";
        state.primaryTrack.addEventListener("cuechange", onCueChange);
        primaryListenerBound = true;
      } catch (_) {
        primaryListenerBound = false;
      }
    }

    // [attach: secondary] secondary resolver / binder は sync helper 側へ委譲する。
    if (secondaryLang) {
        cueController.syncSecondarySubtitleTrack(
          video,
          secondaryLang,
          renderSecondarySubtitle,
        );
    } else {
      cueController.unbindSecondarySubtitleTrack();
      renderSecondarySubtitle("", null);
    }

    state.secondaryTrack = cueController.getBoundSecondaryTrack();

    // [debug: secondary sync failure] secondaryLang を指定したにもかかわらず
    // track が bind できなかった場合、textTracks の全量を出して原因を切り分ける。
    // resolver 側（言語一致条件）か、Apple TV+ 側の trackList 提供タイミングかを判別する材料にする。
    if (secondaryLang && !state.secondaryTrack) {
      try {
        const rawTracks = Array.from(video?.textTracks || []);
        logContentError("secondary track sync failed: no track bound", {
          reason,
          requestedSecondaryLang: secondaryLang,
          trackCount: rawTracks.length,
          tracks: rawTracks.map((t, i) => ({
            index: i,
            language: t?.language || "",
            label: t?.label || "",
            kind: t?.kind || "",
            mode: t?.mode || "",
            cuesLength: (() => {
              try {
                return t?.cues ? t.cues.length : 0;
              } catch (_) {
                return 0;
              }
            })(),
          })),
        });
      } catch (error) {
        logContentError("secondary track sync failure logging failed", {
          reason,
          error: String(error),
        });
      }
    }

    return {
      reason,
      trackCount: tracks.length,
      primaryTrackFound: Boolean(state.primaryTrack),
      secondaryTrackFound: Boolean(state.secondaryTrack),
      primaryListenerBound,
      secondaryListenerBound: Boolean(state.secondaryTrack),
      primaryTrack: state.primaryTrack
        ? {
            language: state.primaryTrack.language || "",
            label: state.primaryTrack.label || "",
            kind: state.primaryTrack.kind || "",
            mode: state.primaryTrack.mode || "",
          }
        : null,
      secondaryTrack: state.secondaryTrack
        ? {
            language: state.secondaryTrack.language || "",
            label: state.secondaryTrack.label || "",
            kind: state.secondaryTrack.kind || "",
            mode: state.secondaryTrack.mode || "",
          }
        : null,
    };
  }

  // [binder/cue: recovery] cue availability / recovery gate

  // [binder/cue: recovery] 現在の primary / secondary track から初回 cue を回収できるか判定する。
  function hasRecoverableInitialCue() {
    const currentTime = state.video?.currentTime ?? 0;
    const boundSecondaryTrack = cueController.getBoundSecondaryTrack();
    const tracks = [
      state.primaryTrack,
      state.secondaryTrack,
      boundSecondaryTrack,
    ];

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!canReadCueFromTrack(track)) continue;
      if (getTrackActiveCuesLength(track) > 0) return true;
      if (getCurrentCueText(track, currentTime)) return true;
    }

    return false;
  }

  function clearInternalSubtitleState(reason = "unknown") {
    state.lastSecondaryText = "";
    state.lastSecondaryTextAt = 0;
    state.lastSecondarySignalAt = 0;
    state.lastPrimaryText = "";
    state.lastPrimarySnapshotAt = 0;

    const shouldPreserveSecondaryDom = reason === "prepareForRestart";
    const panelHost = getTarget().querySelector("#atv-panel-host");
    const secondaryEl = panelHost?.querySelector("[data-secondary-subtitle]");
    if (secondaryEl && !shouldPreserveSecondaryDom) {
      secondaryEl.textContent = "";
      secondaryEl.innerHTML = "";
    }

    logContent("internal subtitle state cleared", {
      reason,
      contentKey: state.currentContentKey,
      hasPanelHost: Boolean(panelHost),
      hasSecondaryElement: Boolean(secondaryEl),
      preservedSecondaryDom: shouldPreserveSecondaryDom && Boolean(secondaryEl),
    });
  }

  // -----------------------------------------------------------------------------
  // Subtitle Pipeline: Flow Coordinator
  // 再初期化フロー本体。状態クリアから track 再解決、listener 再接続、
  // panel 反映までの手順を束ねるが、判定本体や retry policy 自体は持たない。
  // 個別の resolver / binder / render 詳細は下位 helper へ委譲する。
  // -----------------------------------------------------------------------------

  // [binder/cue: recovery] attach / recovery の再初期化入口。
  // track 再選択・listener 再接続・panel 反映を最小差分でまとめて行う。
  // clearInternalSubtitleState / selectPrimaryAndSecondaryTracks は
  // coordinator 自身の責務ではなく、将来分離可能な implementation detail として扱う。
  function runInitialCueRecoveryRender(reason = "unknown") {
    if (!hasRecoverableInitialCue()) return false;

    panelUi.applyPanelState(`initial_recovery:${reason}`);
    logContent("initial cue recovery render", {
      reason,
      primaryActiveCues: getTrackActiveCuesLength(state.primaryTrack),
      secondaryActiveCues: getTrackActiveCuesLength(state.secondaryTrack),
    });
    return true;
  }

  function tryCompleteInitialCueRecovery(reason, completeRecovery) {
    if (!runInitialCueRecoveryRender(reason)) return false;
    completeRecovery();
    return true;
  }

  function bindInitialCueRecoveryListeners(completeRecovery) {
    // [initial cue recovery: event-driven path]
    // cuechange / timeupdate を一時的に監視し、初回 cue が取れた瞬間に
    // render を再試行して recovery を完了させる。
    const attachRecoveryListener = (target, eventName, label) => {
      if (!target || typeof target.addEventListener !== "function") return;

      const onRecoveryEvent = () => {
        tryCompleteInitialCueRecovery(
          `${eventName}:${label}`,
          completeRecovery,
        );
      };

      target.addEventListener(eventName, onRecoveryEvent);
      state.initialCueRecoveryCleanup.push(() => {
        target.removeEventListener(eventName, onRecoveryEvent);
      });
    };

    // 初回 cue 到着時は delay ではなくイベントで回復描画を確定させる。
    attachRecoveryListener(state.primaryTrack, "cuechange", "primary");
    attachRecoveryListener(state.secondaryTrack, "cuechange", "secondary");
    const secondaryBoundTrack = cueController.getBoundSecondaryTrack();
    if (secondaryBoundTrack && secondaryBoundTrack !== state.secondaryTrack) {
      attachRecoveryListener(
        secondaryBoundTrack,
        "cuechange",
        "secondaryBound",
      );
    }
    attachRecoveryListener(state.video, "timeupdate", "video");
  }

  function scheduleInitialCueRecoveryRetries(completeRecovery, isRecovered) {
    // [initial cue recovery: delayed retry path]
    // イベントだけでは初回 cue を拾えないケースに備えて、
    // 短い遅延で数回だけ render を再試行する。
    const delays = [220, 650, 1300];
    delays.forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        if (!state.video || !state.primaryTrack) return;
        if (isRecovered()) return;

        if (!hasRecoverableInitialCue()) return;
        tryCompleteInitialCueRecovery(`delay:${delayMs}`, completeRecovery);
      }, delayMs);
      state.initialCueRecoveryTimers.push(timerId);
    });
  }

  // [binder/cue: recovery] 初回 cue recovery の event-driven / delayed retry を束ねる。
  function scheduleInitialCueRecovery() {
    clearInitialCueRecovery();

    let recovered = false;
    const completeRecovery = () => {
      if (recovered) return;
      recovered = true;
      clearInitialCueRecovery();
    };
    const isRecovered = () => recovered;

    bindInitialCueRecoveryListeners(completeRecovery);

    logContent("initial cue recovery scheduled", {
      primaryMode: state.primaryTrack?.mode || "",
      secondaryMode: state.secondaryTrack?.mode || "",
      primaryActiveCues: getTrackActiveCuesLength(state.primaryTrack),
      secondaryActiveCues: getTrackActiveCuesLength(state.secondaryTrack),
    });

    scheduleInitialCueRecoveryRetries(completeRecovery, isRecovered);
  }

  function refreshSettingsOnPanelOpen() {
    if (!state.panelVisible) return;

    reinitializeCoordinator?.reloadSettingsAndReinitialize(
      "panel_open_settings_reloaded",
    );

    logContent("panel open settings reloaded", {
      primaryLang: state.contentSettings.primaryLang,
      secondaryLang: state.contentSettings.secondaryLang,
      requestedSecondaryLang: state.requestedSecondaryLang,
      trackCount: state.video?.textTracks?.length ?? 0,
    });
  }

  // [binder/cue: attach] secondary track binder

  // [binder/cue: fan-out] cuechange fan-out:
  // track(primary/secondary) → binder → overlay/history/panel render
  function onCueChange() {
    cueController.onPrimaryCueChange();
    logContentSubtitle(
      "secondary resolver snapshot",
      buildSecondaryResolverSnapshot("onCueChange"),
    );
  }

  function buildSecondaryResolverSnapshot(reason = "") {
    const requestedLang =
      state.contentSettings?.secondaryLang ||
      state.requestedSecondaryLang ||
      "";

    const video = state.video;
    const resolver = window.ATVB?.resolver;
    const candidatesFn = resolver?.getSecondarySubtitleTrackCandidates;
    const resolveFn = resolver?.resolveSecondarySubtitleTrack;

    const candidates =
      video && typeof candidatesFn === "function"
        ? candidatesFn(video, requestedLang)
        : [];

    const resolvedTrack =
      video && typeof resolveFn === "function"
        ? resolveFn(video, requestedLang)
        : null;

    return {
      reason,
      requestedSecondaryLang: requestedLang,
      requestedSecondaryLangState: state.requestedSecondaryLang || "",
      currentTime: Number(video?.currentTime ?? NaN),
      trackCount: video?.textTracks?.length ?? 0,
      candidates,
      resolvedTrack: resolvedTrack
        ? {
            language: resolvedTrack.language || "",
            label: resolvedTrack.label || "",
            kind: resolvedTrack.kind || "",
            mode: resolvedTrack.mode || "",
            cues: resolvedTrack.cues ? resolvedTrack.cues.length : 0,
            activeCues: resolvedTrack.activeCues
              ? resolvedTrack.activeCues.length
              : 0,
          }
        : null,
    };
  }



  // [binder/cue: recovery] initial snapshot apply
  // [binder/cue: recovery] 起動時に取得済み cue を即時適用し、未取得なら recovery 経路へ委譲する。
  function renderCurrentSnapshot() {
    const sequence = getSubtitleBlockSequence();
    const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
    const currentIndex = Number.isInteger(sequence?.currentIndex)
      ? sequence.currentIndex
      : -1;
    const meta = sequence?.meta || null;

    const subtitleViewResolver = window.ATVB?.subtitleViewResolver || null;

    const view =
      subtitleViewResolver &&
      typeof subtitleViewResolver.resolveUiSubtitleView === "function"
        ? subtitleViewResolver.resolveUiSubtitleView(blocks, currentIndex, {
            ...(meta || {}),
            contentKey: state.currentContentKey || "",
          })
        : {
            primary: "",
            secondary: "",
            isVisible: false,
            currentBlock: null,
            meta: meta || null,
          };

    const primaryText = String(view?.primary || "");
    const secondaryText = String(view?.secondary || "");

    state.subtitleViewPrimary = primaryText;
    state.subtitleViewSecondary = secondaryText;
    state.currentSubtitleView = view || null;

    // panel 側が別名 state を見ていても値が渡るように同期しておく
    state.currentPrimaryText = primaryText;
    state.currentSecondaryText = secondaryText;
    state.lastPrimaryText = primaryText;
    state.lastSecondaryText = secondaryText;

    overlayController.updateOverlayFromView?.(view, {
      contentKey: state.currentContentKey || "",
    });

    renderPanel();
  }

  // [startup path: initial bilingual start]
  // 設定完了時の通常起動入口。
  // 未設定時は notice 表示と panel close のみを行い、通常の track attach / UI build は進めない。
  // track 選択・panelVisible 復元・UI 構築をこの経路でまとめて行う。
  async function startBilingual(options = {}) {
    logContent("startBilingual trace", {
      panelVisible: state.panelVisible,
      keepPanelVisible:
        typeof options.keepPanelVisible === "boolean"
          ? options.keepPanelVisible
          : null,
      requestedContentSettings: {
        primaryLang: state.requestedContentSettings?.primaryLang || "",
        secondaryLang: state.requestedContentSettings?.secondaryLang || "",
        showSidebar:
          state.requestedContentSettings?.showSidebar ?? null,
      },
      contentSettings: {
        primaryLang: state.contentSettings?.primaryLang || "",
        secondaryLang: state.contentSettings?.secondaryLang || "",
        showSidebar: state.contentSettings?.showSidebar ?? null,
      },
      requestedSecondaryLang: state.requestedSecondaryLang || "",
    });
    console.trace("startBilingual trace");
    if (!state.video) return;

    const requestedSettings = state.requestedContentSettings || {};
    if (!isLanguageSelectionReady(requestedSettings)) {
      state.panelVisible = false;
      destroyUiHosts();
      applyLayout(false);
      showLanguageSetupNotice();
      logContentSettings(
        "startBilingual skipped: language selection incomplete",
        {
          primaryLang: requestedSettings.primaryLang || "",
          secondaryLang: requestedSettings.secondaryLang || "",
        },
      );
      return;
    }

    hideLanguageSetupNotice();

    if (!isPlaybackPageReady()) {
      logContent("startBilingual skipped: playback not ready", {
        ...getPlaybackContextLogPayload(),
      });
      return;
    }

    logContentSubtitle("startBilingual language inputs", {
      requestedContentSettings: {
        primaryLang: requestedSettings.primaryLang || "",
        secondaryLang: requestedSettings.secondaryLang || "",
        showSidebar: requestedSettings.showSidebar ?? null,
      },
      contentSettings: {
        primaryLang: state.contentSettings.primaryLang || "",
        secondaryLang: state.contentSettings.secondaryLang || "",
        showSidebar: state.contentSettings.showSidebar ?? null,
      },
      requestedSecondaryLang: state.requestedSecondaryLang || "",
    });

    syncHistoryContextWithPlayback("startBilingual");

    // [debug: textTracks snapshot] track 選定直前の video.textTracks 一覧をまとめてログする。
    // ko / ko-KR / kor / Korean などの表記ゆれ切り分け用に、
    // language/label/kind/mode/cues を resolver 呼び出し前の「生の状態」として残す。
    try {
      const rawTracks = Array.from(state.video?.textTracks || []);
      logContentSubtitle("textTracks snapshot before track selection", {
        reason: "startBilingual",
        requestedPrimaryLang: state.contentSettings.primaryLang || "",
        requestedSecondaryLang: state.contentSettings.secondaryLang || "",
        trackCount: rawTracks.length,
        tracks: rawTracks.map((t, i) => ({
          index: i,
          language: t?.language || "",
          label: t?.label || "",
          kind: t?.kind || "",
          mode: t?.mode || "",
          cuesLength: (() => {
            try {
              return t?.cues ? t.cues.length : 0;
            } catch (_) {
              return 0;
            }
          })(),
        })),
      });
    } catch (error) {
      logContentError("textTracks snapshot logging failed", {
        reason: "startBilingual",
        error: String(error),
      });
    }

    selectPrimaryAndSecondaryTracks(
      state.video,
      state.contentSettings.primaryLang,
      state.contentSettings.secondaryLang,
      "startBilingual",
    );


    logContentSubtitle("secondary resolver snapshot", buildSecondaryResolverSnapshot("startBilingual"));

    logContentSubtitle("Selected tracks detail", {
      requestedPrimaryLang: state.contentSettings.primaryLang,
      requestedSecondaryLang: state.contentSettings.secondaryLang,
      requestedSecondaryLangState: state.requestedSecondaryLang || "",
      primaryTrack: state.primaryTrack
        ? {
            language: state.primaryTrack.language,
            label: state.primaryTrack.label,
            kind: state.primaryTrack.kind,
            mode: state.primaryTrack.mode,
            cues: state.primaryTrack.cues ? state.primaryTrack.cues.length : 0,
            activeCues: state.primaryTrack.activeCues
              ? state.primaryTrack.activeCues.length
              : 0,
          }
        : null,
      secondaryTrack: state.secondaryTrack
        ? {
            language: state.secondaryTrack.language,
            label: state.secondaryTrack.label,
            kind: state.secondaryTrack.kind,
            mode: state.secondaryTrack.mode,
            cues: state.secondaryTrack.cues
              ? state.secondaryTrack.cues.length
              : 0,
            activeCues: state.secondaryTrack.activeCues
              ? state.secondaryTrack.activeCues.length
              : 0,
          }
        : null,
    });

    const sidebarEnabledSetting = state.contentSettings.showSidebar !== false;

    if (typeof options.keepPanelVisible === "boolean") {
      state.panelVisible = options.keepPanelVisible;
    } else {
      state.panelVisible = sidebarEnabledSetting;
    }

    logContent("startBilingual panelVisible applied", {
      panelVisible: state.panelVisible,
      keepPanelVisible:
        typeof options.keepPanelVisible === "boolean"
          ? options.keepPanelVisible
          : null,
      showSidebarSetting: state.contentSettings.showSidebar,
      secondaryLang: state.contentSettings.secondaryLang || "",
      requestedSecondaryLang: state.requestedSecondaryLang || "",
    });
    console.trace("startBilingual panelVisible applied");

    layoutController.initForPanelVisible(state.panelVisible);

    createOverlay();
    createToggleButton();
    panelUi.createRightPanel();
    createPopupHost();
    createDebugPanel();

    applyLayout(state.panelVisible);

    renderCurrentSnapshot();
    renderPanel();

    if (state.panelVisible) panelUi.showRightPanel();
    else panelUi.hideRightPanel();

    if (state.secondaryTrack) {
      renderSecondarySubtitle(
        getCurrentCueText(state.secondaryTrack),
        state.secondaryTrack,
      );
    }

    panelUi.applyPanelState("startBilingual_ready");

    scheduleInitialCueRecovery();
    scheduleControlSettlingBurst("startBilingual");

    logContentSubtitle("startBilingual ready", {
      injectedInto: state.dialogEl ? "dialog.playback-view" : "document.body",
      contentKey: state.currentContentKey,
      primaryLang: state.contentSettings.primaryLang,
      secondaryLang: state.contentSettings.secondaryLang,
      requestedSecondaryLang: state.requestedSecondaryLang || "",
      primaryTrackFound: !!state.primaryTrack,
      secondaryTrackFound: !!state.secondaryTrack,
      secondaryTrackLanguage: state.secondaryTrack?.language || "",
      secondaryTrackLabel: state.secondaryTrack?.label || "",
      ejdictLoaded: !!state.ejdictMap,
    });
  }

  let lastObservedUrl = location.href;

  function handlePotentialNavigationChange(reason = "unknown") {
    if (location.href === lastObservedUrl) return;
    lastObservedUrl = location.href;

    logContent("navigation changed", {
      reason,
      url: location.href,
    });

    teardownForRestart();
    prepareForRestart();

    const found = getVideoAndDialog();
    if (found) {
      state.video = found.video;
      state.dialogEl = found.dialog;
      state.lastVideoSrcKey = getCurrentVideoSrcKey(found.video);
      startBilingual();
      return;
    }

    state.video = null;
    state.dialogEl = null;
    state.lastVideoSrcKey = "";
    destroyUiHosts();
    applyLayout(false);

    logContent("navigation changed: playback target not ready yet", {
      reason,
      url: location.href,
      ...getPlaybackContextLogPayload(),
    });
  }

  const navigationObserver = new MutationObserver(() => {
    handlePotentialNavigationChange("mutation_observer");
  });

  navigationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  function boot() {
    const found = getVideoAndDialog();
    if (found?.video) {
      state.video = found.video;
      state.dialogEl = found.dialog;
      attachTracks(found.video);
      return;
    }

    waitForVideo((video) => {
      const current = getVideoAndDialog();
      state.video = video;
      state.dialogEl = current?.dialog || null;
      attachTracks(video);
    });
  }
  
  let startupCompletedLogged = false;

  function attachTracks(v) {
    state.video = v;
    state.lastVideoSrcKey = getCurrentVideoSrcKey(v);
    logContent("attachTracks", { trackCount: v?.textTracks?.length ?? 0 });
    if (!startupCompletedLogged) {
      startupCompletedLogged = true;
      logContent("content startup completed", {
        hasVideo: !!state.video,
        trackCount: v?.textTracks?.length ?? 0,
      });
    }
    loadSettingsFromSync();
  }

  boot();
})();
