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
  "use strict";
  const DEFAULT_SETTINGS = {
    primaryLang: "en",
    secondaryLang: "",
    showSidebar: true,
    pinSidebar: false,
    playWordAudio: true,
    enableAiTooltip: false,
    preferredAiProvider: "auto",
  };

  const DEBUG_SECONDARY_SUBS = false;
  // Optional probe logs for #19 regressions. Keep false in normal operation.
  const DEBUG_PANEL_PROBE = false;
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
  const PANEL_PRIMARY_GRACE_MS = 600;
  const SUBTITLE_HISTORY_MAX_PER_CONTENT = 500;
  const PLAYBACK_CONTROLS_LAYOUT = {
    headerSelector: ".video-player__header",
    controlsSelector: ".video-player__controls",
    progressSelector: ".video-player__progress",
    metadataSelector: ".video-player__metadata",
    tabsSelector: ".video-player__tabs",
    autoSubsNoteSelector: ".video-player__auto-subs-note",
    skipOverlaySelector:
      ".skip-overlay__button-container, .skip-overlay__controls-container",
    footerSelector: ".video-player__footer.scrubbing-enabled",
    footerFallbackSelector: ".video-player__footer",
    unifiedSelector: ".unified-controls",
    volumeSelector: "amp-volume-control-unified",
    volumeFallbackSelector: ".volume-unified",
    panelSelector: "#atv-panel-host",
    videoSelector: ".video-player__video-container",
    footerGapPx: 8,
    footerSafeGutterPx: 16,
  };
  const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";
  const PLAYBACK_CONTROLS_BASE_TRANSFORM_ATTR = "data-atvb-base-transform";
  const PLAYBACK_CONTROLS_MANAGED_ATTR = "data-atvb-layout-managed";
  const PLAYBACK_CONTROLS_SHIFT_X_ATTR = "data-atvb-shift-x";
  const PLAYBACK_HEADER_BASE_WIDTH_ATTR = "data-atvb-header-base-width";
  const PLAYBACK_HEADER_BASE_MAX_WIDTH_ATTR = "data-atvb-header-base-max-width";
  const PLAYBACK_FOOTER_BASE_WIDTH_ATTR = "data-atvb-footer-base-width";
  const PLAYBACK_FOOTER_BASE_MAX_WIDTH_ATTR = "data-atvb-footer-base-max-width";
  const PLAYBACK_PROGRESS_BASE_MIN_WIDTH_ATTR =
    "data-atvb-progress-base-min-width";
  const PLAYBACK_PROGRESS_BASE_WIDTH_ATTR = "data-atvb-progress-base-width";
  const PLAYBACK_PROGRESS_BASE_MAX_WIDTH_ATTR =
    "data-atvb-progress-base-max-width";
  const PLAYBACK_SKIP_BASE_LEFT_ATTR = "data-atvb-skip-base-left";
  const PLAYBACK_SKIP_BASE_RIGHT_ATTR = "data-atvb-skip-base-right";
  const PLAYBACK_SKIP_BASE_TRANSFORM_ATTR = "data-atvb-skip-base-transform";

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
    lastPanelRenderSnapshot: null,
    lastAfterRenderSecondarySnapshotSignature: "",
    lastSecondarySyncContext: "",
    lastPrimaryRecoveryAttemptAt: 0,
    lastPrimarySnapshotAt: 0,
    lastObservedVideoTime: null,
    lastPrimaryText: "",
    panelVisible: true,
    ejdictMap: null,
    waitTimer: null,
    secondaryHideTimer: null,
    overlayRoot: null,
    panelShadowRoot: null,
    popupShadowRoot: null,
    debugPanelRoot: null,
    popupDocClickHandler: null,
    messageListenerAttached: false,
    playbackControlsRafId: 0,
    playbackControlsMutationObserver: null,
    playbackControlsResizeObserver: null,
    playbackControlsResizeTargets: new Set(),
    playbackControlsResizeHandler: null,
    playbackControlsOrientationHandler: null,
    playbackControlsApplying: false,
    playbackControlsRetryTimers: [],
    trackResolveRetryTimers: [],
    controlSettlingTimers: [],
    initialCueRecoveryTimers: [],
    initialCueRecoveryCleanup: [],
  };

  let secondaryTrackCleanup = null;
  let secondaryTrackBound = null;
  let secondaryTrackSyncInterval = null;
  let layoutRetryTimers = [];
  let startupCompletedLogged = false;
  let lastSecondaryText = "";
  let lastSecondaryTextAt = 0;

  // logger API の debugLog へ橋渡しする。
  const debugLog = (...args) => window.ATVB?.logger?.debugLog?.(...args);
  // logger API の appendDebugLog へ橋渡しする。
  const appendDebugLog = (...args) =>
    window.ATVB?.logger?.appendDebugLog?.(...args);
  // logger API の logContent へ橋渡しする。
  // 既存の logContent(message, payload) 互換を維持しつつ contentKey を付与する。
  function logContent(...args) {
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
      const normalizedFirst = String(first || "").toLowerCase();
      const isCategory =
        Object.values(LOG_CATEGORIES).includes(normalizedFirst);
      if (isCategory && typeof second === "string") {
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

  // vtt API の normalizeSubtitleText へ橋渡しする。
  const normalizeSubtitleText = (...args) =>
    window.ATVB?.vtt?.normalizeSubtitleText?.(...args) ?? "";
  // vtt API の cleanCueText へ橋渡しする。
  const cleanCueText = (...args) =>
    window.ATVB?.vtt?.cleanCueText?.(...args) ?? "";
  // vtt API の formatTime へ橋渡しする。
  const formatTime = (...args) => window.ATVB?.vtt?.formatTime?.(...args) ?? "";

  // resolver API の getUniqueTracks へ橋渡しする。
  const getUniqueTracks = (...args) =>
    window.ATVB?.resolver?.getUniqueTracks?.(...args) ?? [];
  // resolver API の getTrackCuesLength へ橋渡しする。
  const getTrackCuesLength = (...args) =>
    window.ATVB?.resolver?.getTrackCuesLength?.(...args) ?? 0;
  // resolver API の getTrackActiveCuesLength へ橋渡しする。
  const getTrackActiveCuesLength = (...args) =>
    window.ATVB?.resolver?.getTrackActiveCuesLength?.(...args) ?? 0;
  // resolver API の pickBestSubtitleTrack へ橋渡しする。
  const pickBestSubtitleTrack = (...args) =>
    window.ATVB?.resolver?.pickBestSubtitleTrack?.(...args) ?? null;
  // resolver API の resolveSecondarySubtitleTrack へ橋渡しする。
  const resolveSecondarySubtitleTrack = (...args) =>
    window.ATVB?.resolver?.resolveSecondarySubtitleTrack?.(...args) ?? null;

  // logger の更新通知を Debug パネル更新へ接続する。
  function registerDebugLogUpdateCallback() {
    window.ATVB?.logger?.setOnLogUpdated?.(() => {
      updateLiveDebugPanel();
    });
  }

  function applySecondaryLangFallback(settings) {
    const result = { ...settings };
    if (!result.secondaryLang) {
      const browserLang = (navigator.language || navigator.userLanguage || "en")
        .toLowerCase()
        .split("-")[0];
      result.secondaryLang = browserLang;
      logContentSettings(
        "secondaryLang empty: applying browser language fallback",
        browserLang,
      );
    }
    return result;
  }

  function loadSettingsSnapshot(reason = "unknown") {
    const loadFromStorage = () =>
      new Promise((resolve, reject) => {
        chrome.storage.sync.get(null, (storedSettings = {}) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          const requestedSettings = { ...DEFAULT_SETTINGS, ...storedSettings };
          const effectiveSettings =
            applySecondaryLangFallback(requestedSettings);
          resolve({
            storedSettings: { ...storedSettings },
            requestedSettings,
            effectiveSettings,
            requestedSecondaryLang: storedSettings.secondaryLang || "",
          });
        });
      });

    const settingsBridge = window.ATVB?.settingsBridge;
    if (!settingsBridge?.loadSettings) {
      return loadFromStorage();
    }

    return settingsBridge
      .loadSettings({
        defaults: DEFAULT_SETTINGS,
        applyFallback: applySecondaryLangFallback,
      })
      .then(() => {
        const snapshot = settingsBridge.getCurrentSettings?.() || {};
        const storedSettings = { ...(snapshot.storedSettings || {}) };
        const requestedSettings = {
          ...DEFAULT_SETTINGS,
          ...(snapshot.requestedSettings || storedSettings),
        };
        const effectiveSettings =
          snapshot.effectiveSettings || snapshot.settings || requestedSettings;
        return {
          storedSettings,
          requestedSettings,
          effectiveSettings: { ...effectiveSettings },
          requestedSecondaryLang:
            snapshot.requestedSecondaryLang ??
            storedSettings.secondaryLang ??
            "",
        };
      })
      .catch((error) => {
        logContentError("settings bridge load failed", {
          reason,
          error: String(error),
        });
        return loadFromStorage();
      });
  }

  (async function loadEJDict() {
    try {
      const url = chrome.runtime.getURL("dict/ejdict.json");
      const res = await fetch(url);
      state.ejdictMap = await res.json();
      logContentApi("EJDict loaded", {
        entries: Object.keys(state.ejdictMap).length,
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

  function waitForVideo(cb) {
    const check = () => {
      const found = getVideoAndDialog();
      if (found) {
        state.dialogEl = found.dialog;
        logContent("waitForVideo resolved", {
          hasVideo: true,
          trackCount: found.video.textTracks.length,
          injectedIntoDialog: Boolean(found.dialog),
        });
        cb(found.video);
        return;
      }
      state.waitTimer = window.setTimeout(check, 500);
    };
    if (state.waitTimer) clearTimeout(state.waitTimer);
    check();
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
    return cleanCueText(getCurrentCue(track, time));
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
        requestedSettings.primaryLang || state.contentSettings.primaryLang || "",
      secondaryLang:
        requestedSettings.secondaryLang ||
        state.requestedSecondaryLang ||
        state.contentSettings.secondaryLang ||
        "",
    };

    if (!isLanguageSelectionReady(effectiveSettings)) {
      return null;
    }

    ensurePanelSlotLayerStyle();

    const allExisting = document.querySelectorAll(
      "[data-secondary-subtitle], .dual-subtitles-secondary",
    );
    if (allExisting.length > 1) {
      const keep = allExisting[0];
      for (let i = 1; i < allExisting.length; i++) {
        allExisting[i].remove();
      }
      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary duplicate elements cleaned",
          getSecondaryRenderLogPayload(
            keep.textContent || "",
            secondaryTrackBound,
            allExisting.length,
          ),
        );
      }
      if (!keep.hasAttribute("data-secondary-subtitle")) {
        keep.setAttribute("data-secondary-subtitle", "");
      }
      if (!keep.classList.contains("dual-subtitles-secondary")) {
        keep.classList.add("dual-subtitles-secondary");
      }
      return keep;
    }

    if (allExisting.length === 1) {
      const only = allExisting[0];
      if (!only.hasAttribute("data-secondary-subtitle")) {
        only.setAttribute("data-secondary-subtitle", "");
      }
      if (!only.classList.contains("dual-subtitles-secondary")) {
        only.classList.add("dual-subtitles-secondary");
      }
      return only;
    }

    let panelHost = getTarget().querySelector("#atv-panel-host");
    if (!panelHost) {
      createRightPanel();
      panelHost = getTarget().querySelector("#atv-panel-host");
    }
    if (!panelHost) return null;

    // createRightPanel may have already ensured it during setup.
    const ensuredAfterPanel = document.querySelector(
      "[data-secondary-subtitle]",
    );
    if (ensuredAfterPanel) return ensuredAfterPanel;

    let panel = document.querySelector("[data-dual-subtitles-panel]");
    if (!panel) {
      panel = document.querySelector(".dual-subtitles-panel");
    }
    if (!panel && panelHost.shadowRoot) {
      panel = panelHost.shadowRoot.querySelector(
        "[data-dual-subtitles-panel], .dual-subtitles-panel",
      );
    }

    if (panel && panelHost.shadowRoot?.contains(panel)) {
      panel.setAttribute("data-dual-subtitles-panel", "");
      panel.classList.add("dual-subtitles-panel");
    }

    const el = document.createElement("div");
    el.setAttribute("data-secondary-subtitle", "");
    el.className = "dual-subtitles-secondary";
    el.slot = "secondary-subtitle-slot";
    panelHost.appendChild(el);

    if (DEBUG_SECONDARY_SUBS) {
      logContent("secondary element ensured");
    }
    return el;
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
      lastSecondaryText = finalText;
      lastSecondaryTextAt = now;
    } else if (
      !finalText &&
      activeCuesLength === 0 &&
      lastSecondaryText &&
      now - lastSecondaryTextAt <= SECONDARY_SUBTITLE_GRACE_MS
    ) {
      finalText = lastSecondaryText;
      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary subtitle retained during grace period",
          getSecondaryRenderLogPayload(finalText, track, elementCount),
        );
      }
    } else if (
      !finalText &&
      now - lastSecondaryTextAt > SECONDARY_SUBTITLE_GRACE_MS
    ) {
      if (el.textContent) {
        if (DEBUG_SECONDARY_SUBS) {
          logContent(
            "secondary subtitle cleared after grace period",
            getSecondaryRenderLogPayload("", track, elementCount),
          );
        }
      }
      lastSecondaryText = "";
      lastSecondaryTextAt = 0;
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
      const secondaryEl = panelHost?.querySelector("[data-secondary-subtitle]");
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
        getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
      );
    }

    const track = resolveSecondarySubtitleTrack(video, requestedLang);

    if (!track) {
      unbindSecondarySubtitleTrack();
      renderSecondarySubtitle("", null);
      return;
    }

    if (secondaryTrackBound !== track) {
      bindSecondarySubtitleTrack(track, renderSecondarySubtitle);
      return;
    }

    // Same track, just refresh.
    renderSecondarySubtitle(getCurrentCueText(track), track);
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
      state.secondaryTrack = secondaryTrackBound;

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

  function clearPlaybackControlRetryTimers() {
    if (!state.playbackControlsRetryTimers.length) return;
    state.playbackControlsRetryTimers.forEach((timerId) =>
      clearTimeout(timerId),
    );
    state.playbackControlsRetryTimers = [];
  }

  function scheduleAdjustPlaybackControls(
    reason = "unknown",
    retryDelays = [],
    options = {},
  ) {
    const immediate = options.immediate !== false;

    const runOnce = (runReason) => {
      if (state.playbackControlsRafId) return;
      state.playbackControlsRafId = window.requestAnimationFrame(() => {
        state.playbackControlsRafId = 0;
        adjustPlaybackControlsForPanel(runReason);
      });
    };

    clearPlaybackControlRetryTimers();
    if (immediate) runOnce(reason);

    retryDelays.forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        runOnce(`${reason}-retry-${delayMs}`);
      }, delayMs);
      state.playbackControlsRetryTimers.push(timerId);
    });
  }

  function clearControlSettlingTimers() {
    if (!state.controlSettlingTimers.length) return;
    state.controlSettlingTimers.forEach((timerId) => clearTimeout(timerId));
    state.controlSettlingTimers = [];
  }

  function scheduleControlSettlingBurst(
    reason = "unknown",
    delays = [180, 420, 800, 1300, 1900, 2700, 3800],
  ) {
    clearControlSettlingTimers();

    delays.forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        if (!state.panelVisible) return;
        scheduleAdjustPlaybackControls(`${reason}-settle-${delayMs}`, [], {
          immediate: true,
        });
      }, delayMs);
      state.controlSettlingTimers.push(timerId);
    });
  }

  function getPlaybackControlsLayoutTargets() {
    return {
      panel: getPlaybackPanelLayoutAnchor(),
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

  function refreshPlaybackControlResizeObserverTargets() {
    const ro = state.playbackControlsResizeObserver;
    if (!ro) return;

    const { panel, footer, unified, volume, video } =
      getPlaybackControlsLayoutTargets();
    const targets = [panel, footer, unified, volume, video].filter(Boolean);

    for (const target of targets) {
      if (state.playbackControlsResizeTargets.has(target)) continue;
      ro.observe(target);
      state.playbackControlsResizeTargets.add(target);
    }

    for (const prev of [...state.playbackControlsResizeTargets]) {
      if (targets.includes(prev) && prev.isConnected) continue;
      ro.unobserve(prev);
      state.playbackControlsResizeTargets.delete(prev);
    }
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
    if (state.playbackControlsApplying) return;

    state.playbackControlsApplying = true;
    try {
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
    } finally {
      state.playbackControlsApplying = false;
    }
  }

  // [observer/layout]
  function stopPlaybackControlLayoutObservers() {
    if (state.playbackControlsMutationObserver) {
      state.playbackControlsMutationObserver.disconnect();
      state.playbackControlsMutationObserver = null;
    }

    if (state.playbackControlsResizeObserver) {
      state.playbackControlsResizeObserver.disconnect();
      state.playbackControlsResizeObserver = null;
    }

    state.playbackControlsResizeTargets.clear();

    if (state.playbackControlsResizeHandler) {
      window.removeEventListener("resize", state.playbackControlsResizeHandler);
      state.playbackControlsResizeHandler = null;
    }

    if (state.playbackControlsOrientationHandler) {
      window.removeEventListener(
        "orientationchange",
        state.playbackControlsOrientationHandler,
      );
      state.playbackControlsOrientationHandler = null;
    }
  }

  function startPlaybackControlLayoutObservers() {
    const schedulePlaybackLayoutRefresh = (
      reason = "unknown",
      options = {},
    ) => {
      if (!state.panelVisible) return;

      refreshPlaybackControlResizeObserverTargets();
      scheduleAdjustPlaybackControls(
        reason,
        options.retryDelays || [160, 420],
        {
          immediate: options.immediate !== false,
        },
      );

      if (options.settle !== false) {
        scheduleControlSettlingBurst(
          reason,
          options.settleDelays || [180, 520, 1100],
        );
      }
    };

    if (!state.playbackControlsResizeHandler) {
      state.playbackControlsResizeHandler = () => {
        schedulePlaybackLayoutRefresh("window_resize", {
          retryDelays: [120, 320, 700],
          settleDelays: [180, 520, 1100, 1800],
        });
      };
      window.addEventListener("resize", state.playbackControlsResizeHandler, {
        passive: true,
      });
    }

    if (!state.playbackControlsOrientationHandler) {
      state.playbackControlsOrientationHandler = () => {
        schedulePlaybackLayoutRefresh("orientation_change", {
          retryDelays: [120, 320, 700],
          settleDelays: [180, 520, 1100, 1800],
        });
      };
      window.addEventListener(
        "orientationchange",
        state.playbackControlsOrientationHandler,
      );
    }

    if (
      typeof ResizeObserver !== "undefined" &&
      !state.playbackControlsResizeObserver
    ) {
      state.playbackControlsResizeObserver = new ResizeObserver(() => {
        schedulePlaybackLayoutRefresh("playback_resize_observer", {
          retryDelays: [120, 320],
          settle: false,
        });
      });
    }

    if (!state.playbackControlsMutationObserver) {
      const mutationRoot = state.dialogEl || document.body;
      if (mutationRoot) {
        state.playbackControlsMutationObserver = new MutationObserver(
          (mutations) => {
            if (!state.panelVisible) return;

            const hasRelevantMutation = mutations.some((mutation) => {
              const target = mutation.target;
              if (!(target instanceof Element))
                return mutation.type === "childList";

              return (
                target.matches?.(
                  ".video-player__header, .video-player__controls, .video-player__progress, .video-player__footer, .unified-controls, amp-volume-control-unified, .video-player__video-container, #atv-panel-host",
                ) ||
                target.closest?.(
                  ".video-player__header, .video-player__controls, .video-player__progress, .video-player__footer, .unified-controls, amp-volume-control-unified, .video-player__video-container, #atv-panel-host",
                )
              );
            });

            if (!hasRelevantMutation) return;

            schedulePlaybackLayoutRefresh("playback_mutation_observer", {
              retryDelays: [120, 320, 700],
              settle: false,
            });
          },
        );

        state.playbackControlsMutationObserver.observe(mutationRoot, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "hidden", "aria-hidden"],
        });
      }
    }

    refreshPlaybackControlResizeObserverTargets();
  }

  function applyLayout(show) {
    const clearLayoutRetryTimers = () => {
      if (!layoutRetryTimers.length) return;
      layoutRetryTimers.forEach((timerId) => clearTimeout(timerId));
      layoutRetryTimers = [];
    };

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

    clearLayoutRetryTimers();
    applyLayoutToTargets(getLayoutTargets(), show);

    const overlayHost = getTarget().querySelector("#atv-overlay-host");
    if (overlayHost) {
      // Bottom custom subtitle overlay is unnecessary while panel is visible.
      overlayHost.style.display = show ? "none" : "";
    }

    scheduleAdjustPlaybackControls("applyLayout", show ? [1200] : [], {
      immediate: !show,
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
      if (settings.showSidebar === false) {
        hideRightPanel();
      } else if (state.panelVisible) {
        showRightPanel();
      } else {
        hideRightPanel();
      }
    }

    if (settings.pinSidebar) {
      pinRightPanel();
    } else {
      unpinRightPanel();
    }

    logContent("Applied settings to UI", {
      showSidebar: settings.showSidebar,
      pinSidebar: settings.pinSidebar,
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
    removeHost("atv-overlay-host");
    state.panelShadowRoot = null;
    state.popupShadowRoot = null;
    state.debugPanelRoot = null;
    state.overlayRoot = null;
  }

  // [UI shell: panel/debug]

  // [UI shell: debug] パネル内 debug セクションの HTML 骨格を返す。
  // wiring・mount は行わない。buildPanelShellHTML から呼ばれる。
  function buildPanelDebugShellHTML() {
    return `
      <div id="debug-section" class="debug-section">
        <div class="debug-section__header">
          <span class="debug-section__title">デバッグログ（開発者向け）</span>
          <button
            id="debugSectionToggle"
            class="debug-toggle-button"
            type="button"
            aria-expanded="false"
            aria-controls="debugSectionBody"
          >▶</button>
        </div>
        <div id="debugSectionBody" class="debug-section__body" hidden>
          <div class="debug-toolbar">
            <button id="debugCopyBtn" class="debug-btn" type="button">Copy</button>
            <button id="debugDownloadBtn" class="debug-btn" type="button">Download</button>
            <button id="debugClearBtn" class="debug-btn" type="button">Clear</button>
          </div>
          <textarea id="debug-log" readonly></textarea>
        </div>
      </div>
    `;
  }

  // [UI shell: panel] パネル全体の HTML 骨格（CSS link・header・debug shell・scroll area）を返す。
  // DOM への挿入・wiring・mount は createRightPanel / wirePanelHeaderActions が担う。
  function buildPanelShellHTML() {
    const panelCssUrl = chrome.runtime.getURL("panel.css");
    return `
      <link rel="stylesheet" href="${panelCssUrl}">
      <div id="panel" class="dual-subtitles-panel" data-dual-subtitles-panel>
        <div id="panel-header">
          <span>📋 字幕履歴</span>
          <div class="panel-header-actions">
            <button id="settings-btn" type="button" title="設定">⚙️</button>
            <button id="close-btn" type="button">✕ 閉じる</button>
          </div>
        </div>
        ${buildPanelDebugShellHTML()}
        <div id="panel-scroll">
          <slot name="secondary-subtitle-slot"></slot>
          <div id="subtitle-list"></div>
        </div>
      </div>
    `;
  }

  // [wiring: panel header] パネルヘッダー（設定/閉じるボタン）の UI イベントを panel shell に接続する。
  // shell の構造自体は buildPanelShellHTML が担い、ここではヘッダー操作の wiring のみを行う。
  function wirePanelHeaderActions() {
    const root = state.panelShadowRoot;
    if (!root) return;

    root
      .getElementById("close-btn")
      ?.addEventListener("click", () => togglePanel(false));
    root.getElementById("settings-btn")?.addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
      } catch (_) {}
    });
  }

  // [UI shell: panel host] host 再利用・mount・shadow shell 注入・header wiring をまとめて行う。
  function createRightPanel() {
    const target = getTarget();
    const existingHost = target.querySelector("#atv-panel-host");
    if (existingHost) {
      state.panelShadowRoot = existingHost.shadowRoot || state.panelShadowRoot;
      ensureSecondarySubtitleElement();
      return;
    }

    // [shell: panel host mount] panel host を生成して playback target に追加する。
    const host = document.createElement("div");
    host.id = "atv-panel-host";
    host.style.cssText = [
      "position:fixed",
      "top:0",
      "right:0",
      "width:30%",
      "height:100vh",
      "z-index:999997",
      "pointer-events:auto",
      "box-sizing:border-box",
    ].join(";");
    target.appendChild(host);

    // [shell: panel slot layer] secondary subtitle slot 用の light DOM style を確保する。
    ensurePanelSlotLayerStyle();

    // [shell: panel shadow mount] shadow root を attach し、panel shell HTML を注入する。
    state.panelShadowRoot = host.attachShadow({ mode: "open" });
    state.panelShadowRoot.innerHTML = buildPanelShellHTML();

    // [wiring: panel header] header action ボタンを shell に接続する。
    wirePanelHeaderActions();

    // [render: panel secondary slot] panel shell 内の secondary subtitle 要素を確保する。
    ensureSecondarySubtitleElement();
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

  function showLanguageSetupNotice() {
    const target = getTarget();
    if (!target) return;

    let notice = target.querySelector(`#${LANGUAGE_SETUP_NOTICE_ID}`);
    if (notice) return;

    notice = document.createElement("div");
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
    target.appendChild(notice);
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
      togglePanel(true);
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
      <div id="popup">
        <div id="popup-header">
          <div id="popup-header-left">
            <div id="popup-word-row">
              <span id="popup-word"></span>
              <span id="popup-badges"></span>
            </div>
            <div id="popup-reading"></div>
          </div>
          <button id="popup-close">✕</button>
        </div>
        <div id="popup-tabs">
          <button class="popup-tab active" data-tab="dict">📖 辞書</button>
          <button class="popup-tab" data-tab="ai">🤖 AI翻訳</button>
        </div>
        <div class="popup-pane active" id="pane-dict"><span class="loading">検索中...</span></div>
        <div class="popup-pane" id="pane-ai"><span class="loading">翻訳中...</span></div>
      </div>
    `;
  }

  // [wiring: subtitle popup] close / tab / dynamic word link の UI イベントを subtitle popup shell に接続する。
  function wireSubtitlePopupUiEvents() {
    const root = state.popupShadowRoot;
    if (!root) return;

    const popup = root.getElementById("popup");
    if (!popup) return;

    root.getElementById("popup-close")?.addEventListener("click", () => {
      popup.style.display = "none";
    });

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

    // subtitle popup 外クリックで閉じるための document listener 登録
    state.popupDocClickHandler = () => {
      popup.style.display = "none";
    };
    document.addEventListener("click", state.popupDocClickHandler);

    // subtitle popup 内の動的単語リンククリックを拾う listener 登録
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.classList.contains("atv-word-link")) return;

      e.stopPropagation();
      const word = target.textContent.trim();
      if (!word) return;

      const rect = target.getBoundingClientRect();
      showPopup(word, word, rect);
    });
  }

  // [UI shell: subtitle popup host] host 再利用・mount・shadow shell 注入・popup wiring をまとめて行う。
  function createPopupHost() {
    const target = getTarget();
    const existingHost = target.querySelector("#atv-popup-host");
    if (existingHost) {
      state.popupShadowRoot = existingHost.shadowRoot || state.popupShadowRoot;
      return;
    }

    // [shell: subtitle popup host mount] popup host を生成して playback target に追加する。
    const host = document.createElement("div");
    host.id = "atv-popup-host";
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:999999;pointer-events:none;";
    target.appendChild(host);

    // [shell: subtitle popup shadow mount] shadow root を attach し、subtitle popup shell HTML を注入する。
    state.popupShadowRoot = host.attachShadow({ mode: "open" });
    state.popupShadowRoot.innerHTML = buildPopupShellHTML();

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

  // [render: subtitle popup display] subtitle popup の表示内容を初期化し、位置を決めて辞書/翻訳取得を開始する。
  function showPopup(word, sentence, anchorRect) {
    if (!state.popupShadowRoot) return;

    const clean = word.replace(
      /[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF]/g,
      "",
    );
    if (!clean) return;

    logContent("showPopup", {
      word: clean,
      sentenceLength: (sentence || "").length,
    });

    const popup = state.popupShadowRoot.getElementById("popup");
    state.popupShadowRoot.getElementById("popup-word").textContent = clean;
    state.popupShadowRoot.getElementById("popup-reading").textContent = "";
    state.popupShadowRoot.getElementById("popup-badges").innerHTML = "";
    state.popupShadowRoot.getElementById("pane-dict").innerHTML =
      '<span class="loading">検索中...</span>';
    state.popupShadowRoot.getElementById("pane-ai").innerHTML =
      '<span class="loading">翻訳中...</span>';

    state.popupShadowRoot
      .querySelectorAll(".popup-tab")
      .forEach((b) => b.classList.remove("active"));
    state.popupShadowRoot
      .querySelectorAll(".popup-pane")
      .forEach((b) => b.classList.remove("active"));
    state.popupShadowRoot
      .querySelector('[data-tab="dict"]')
      .classList.add("active");
    state.popupShadowRoot.getElementById("pane-dict").classList.add("active");

    popup.style.display = "block";
    const pw = 340;
    let left = anchorRect.left;
    let top = anchorRect.top - 200;
    if (left + pw > window.innerWidth) left = window.innerWidth - pw - 8;
    if (top < 8) top = anchorRect.bottom + 8;
    popup.style.left = left + "px";
    popup.style.top = top + "px";

    fetchDictionary(clean);
    fetchTranslation(sentence || clean);
  }

  function fetchDictionary(word) {
    const paneDict = state.popupShadowRoot.getElementById("pane-dict");
    const badgesEl = state.popupShadowRoot.getElementById("popup-badges");
    const readingEl = state.popupShadowRoot.getElementById("popup-reading");

    logContent("fetchDictionary UI start", { word });

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

    paneDict.innerHTML =
      ejHtml +
      `<div class="dict-section" id="jisho-section"><span class="loading">Jisho 検索中...</span></div>` +
      `<div class="dict-section" id="tatoeba-section"><span class="loading">例文取得中...</span></div>`;

    sendToBackground({ type: "FETCH_DICT", word }, (res) => {
      const jishoEl = state.popupShadowRoot?.getElementById("jisho-section");
      if (!jishoEl) return;

      if (!res?.ok) {
        logContent("fetchDictionary Jisho failed", {
          word,
          error: res?.error ?? "unknown",
        });

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
    });

    sendToBackground({ type: "FETCH_TATOEBA", word }, (res) => {
      const tatEl = state.popupShadowRoot?.getElementById("tatoeba-section");
      if (!tatEl) return;

      if (!res?.ok || !res.results?.length) {
        tatEl.innerHTML = "";
        logContent("fetchTatoeba UI empty", {
          word,
          ok: !!res?.ok,
          resultCount: res?.results?.length ?? 0,
        });
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
    });
  }

  function fetchTranslation(text) {
    const el = state.popupShadowRoot.getElementById("pane-ai");

    logContent("fetchTranslation UI start", {
      textLength: (text || "").length,
    });

    sendToBackground({ type: "FETCH_TRANSLATE", text }, (res) => {
      if (!state.popupShadowRoot) return;

      if (res?.ok) {
        el.innerHTML = `<div class="ai-label" style="padding:12px 14px 0">翻訳：</div><div class="ai-result" style="padding:4px 14px 12px">${res.translated}</div>`;
        logContent("fetchTranslation UI success", {
          translatedLength: (res.translated || "").length,
        });
      } else {
        el.innerHTML = `<span class="error">エラー: ${res?.error ?? "unknown"}</span>`;
        logContent("fetchTranslation UI error", {
          error: res?.error ?? "unknown",
        });
      }
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

  // [render: panel block html] subtitle block 1件分の HTML を組み立てる。
  function buildPanelBlockHtml(block) {
    const isCurrent = block.state === "current";
    const cls = "subtitle-block";
    const mid = isCurrent ? 'id="current-block"' : "";
    const mark = isCurrent
      ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><polygon class="play-core" points="10,8 17,12 10,16" /></svg>`
      : "";
    const pText = makeClickableSpans(block.primary, block.primary);
    const sText = makeClickableSpans(block.secondary, block.primary);
    return `
        <div class="${cls}" ${mid} data-time="${block.startTime}">
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

  // [wiring: panel word interactions] block 内の単語 hover / click を subtitle popup へ接続する。
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
        showPopup(
          span.dataset.word,
          decodeURIComponent(span.dataset.sentence),
          span.getBoundingClientRect(),
        );
      });
    });
  }

  // [wiring: panel block interactions] block click と word click を panel list DOM に接続する。
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

  // [render: panel list blocks - future] current time より後ろの cue から future block 群を組み立てる。
  function collectFuturePanelBlocks(currentTime) {
    const blocks = [];
    if (!state.primaryTrack || !state.primaryTrack.cues) return blocks;

    for (let i = 0; i < state.primaryTrack.cues.length; i++) {
      const c = state.primaryTrack.cues[i];
      if (c.startTime > currentTime + 0.1) {
        const sc = findCueAt(state.secondaryTrack, c.startTime + 0.05);
        blocks.push({
          startTime: c.startTime,
          endTime: c.endTime,
          primary: cleanCueText(c),
          secondary: cleanCueText(sc),
          state: "future",
        });
      }
    }

    return blocks;
  }

  // [render: panel list blocks - current] primary / secondary の現在 cue から current block を組み立てる。
  function buildCurrentPanelBlock(currentTime) {
    const curPrimaryCue = getCurrentCue(state.primaryTrack, currentTime);
    const curSecondaryCue = findCueAt(state.secondaryTrack, currentTime);
    if (!curPrimaryCue && !curSecondaryCue) {
      return { block: null, curPrimaryCue: null };
    }

    const currentCue = curPrimaryCue || curSecondaryCue;
    let currentPrimaryText = curPrimaryCue ? cleanCueText(curPrimaryCue) : "";

    if (
      !currentPrimaryText &&
      state.primaryTrack &&
      curSecondaryCue &&
      state.lastPrimaryText
    ) {
      const elapsedSincePrimarySnapshot =
        Date.now() - state.lastPrimarySnapshotAt;
      if (
        state.lastPrimarySnapshotAt > 0 &&
        elapsedSincePrimarySnapshot <= PANEL_PRIMARY_GRACE_MS
      ) {
        currentPrimaryText = state.lastPrimaryText;
      }
    }

    const currentSecondaryText = cleanCueText(curSecondaryCue);
    if (DEBUG_PANEL_PROBE) {
      logContent("panel render current block probe", {
        currentTime,
        settingsPrimaryLang: state.contentSettings.primaryLang,
        primaryTrackLanguage: state.primaryTrack?.language,
        primaryTrackLabel: state.primaryTrack?.label,
        secondaryTrackLanguage: state.secondaryTrack?.language,
        secondaryTrackLabel: state.secondaryTrack?.label,
        curPrimaryCueText: cleanCueText(curPrimaryCue).slice(0, 40),
        curSecondaryCueText: currentSecondaryText.slice(0, 40),
        resolvedPrimary: currentPrimaryText.slice(0, 40),
        currentBlockSecondary: currentSecondaryText.slice(0, 40),
      });
    }

    return {
      curPrimaryCue,
      block: {
        startTime: currentCue.startTime,
        endTime: currentCue.endTime,
        primary: currentPrimaryText,
        secondary: currentSecondaryText,
        state: "current",
      },
    };
  }

  // [render: panel snapshot] current block と primary snapshot の最終描画状態を保持する。
  function updatePanelRenderSnapshot(allBlocks, curPrimaryCue) {
    const currentSubtitleBlock = allBlocks.find((b) => b.state === "current");
    state.lastPanelRenderSnapshot = {
      allBlocksCount: allBlocks.length,
      currentSubtitleBlock: currentSubtitleBlock
        ? {
            primaryText: currentSubtitleBlock.primary || "",
            secondaryText: currentSubtitleBlock.secondary || "",
          }
        : null,
    };

    if (curPrimaryCue && currentSubtitleBlock?.primary) {
      state.lastPrimarySnapshotAt = Date.now();
    }
  }

  // [render: panel list apply]
  function renderPanel() {
    if (!state.panelShadowRoot) return;
    const list = state.panelShadowRoot.getElementById("subtitle-list");
    if (!list) return;

    const currentTime = state.video ? state.video.currentTime : 0;
    const allBlocks = [];

    state.subtitleHistory.forEach((h) => {
      if (h.endTime <= currentTime) allBlocks.push({ ...h, state: "past" });
    });

    // [render: panel list blocks - current]
    // primary は state.primaryTrack、secondary は state.secondaryTrack の cue だけを使う。
    const { block: currentBlock, curPrimaryCue } =
      buildCurrentPanelBlock(currentTime);
    if (currentBlock) {
      allBlocks.push(currentBlock);
    }

    // [render: panel list blocks - future / snapshot]
    allBlocks.push(...collectFuturePanelBlocks(currentTime));

    updatePanelRenderSnapshot(allBlocks, curPrimaryCue);

    // [render: panel list DOM apply]
    list.innerHTML = allBlocks
      .map((block) => buildPanelBlockHtml(block))
      .join("");

    // [wiring: panel list interactions]
    bindPanelBlockInteractions(list);

    scrollCurrentPanelBlockIntoView();
  }

  // [render: panel scroll] current block が見切れる場合だけ panel scroll position を補正する。
  function scrollCurrentPanelBlockIntoView() {
    const currentBlock = state.panelShadowRoot?.getElementById("current-block");
    const panelScroll = state.panelShadowRoot?.getElementById("panel-scroll");
    if (!currentBlock || !panelScroll) return;

    const scrollRect = panelScroll.getBoundingClientRect();
    const currentRect = currentBlock.getBoundingClientRect();
    const topThresholdY =
      scrollRect.top + Math.max(32, currentRect.height * 0.8);
    const bottomThresholdY =
      scrollRect.bottom - Math.max(48, currentRect.height * 1.5);

    if (
      currentRect.top < topThresholdY ||
      currentRect.bottom > bottomThresholdY
    ) {
      const targetTopOffset = Math.max(28, Math.min(72, currentRect.height));
      const targetTopY = scrollRect.top + targetTopOffset;
      const scrollBy = currentRect.top - targetTopY;
      panelScroll.scrollTo({
        top: Math.max(0, panelScroll.scrollTop + scrollBy),
        behavior: "smooth",
      });
    }
  }

  // [UI shell: overlay/panel anchor]

  // [UI shell: overlay] overlay の style と primary / secondary line の HTML 骨格を返す。
  function buildOverlayShellHTML() {
    return `
      <style>
        #overlay {
          display: inline-block; background: rgba(0,0,0,0.7);
          border-radius: 6px; padding: 6px 16px;
          max-width: 80%; text-align: center; pointer-events: auto;
        }
        .sub-line {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 18px; font-weight: 500; color: #fff;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9); line-height: 1.4;
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

  // [wiring: overlay] overlay 内の単語 click を subtitle popup 表示へ接続する。
  function wireOverlayUiEvents() {
    const root = state.overlayRoot;
    if (!root) return;

    root.addEventListener("click", (e) => {
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
      );
    });
  }

  // [UI shell: overlay host] host 再利用・mount・shadow shell 注入・overlay wiring をまとめて行う。
  function createOverlay() {
    const target = getTarget();
    const existingHost = target.querySelector("#atv-overlay-host");
    if (existingHost) {
      state.overlayRoot = existingHost.shadowRoot || state.overlayRoot;
      return;
    }

    // [shell: overlay host mount] overlay host を生成して playback target に追加する。
    const host = document.createElement("div");
    host.id = "atv-overlay-host";
    host.style.cssText = [
      "position:fixed",
      "bottom:80px",
      "left:0",
      "width:70%",
      "z-index:99998",
      "pointer-events:none",
      "text-align:center",
    ].join(";");
    target.appendChild(host);

    // [shell: overlay shadow mount] shadow root を attach し、overlay shell HTML を注入する。
    state.overlayRoot = host.attachShadow({ mode: "open" });
    state.overlayRoot.innerHTML = buildOverlayShellHTML();

    // [wiring: overlay] overlay click handler を shell に接続する。
    wireOverlayUiEvents();
  }

  // [render: overlay shell apply]
  function updateOverlay(primaryText, secondaryText) {
    const root = state.overlayRoot;
    if (!root) return;
    const p = root.getElementById("ov-primary");
    const s = root.getElementById("ov-secondary");
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

  function togglePanel(force) {
    const previousPanelVisible = state.panelVisible;
    if (typeof force === "boolean") state.panelVisible = force;
    else state.panelVisible = !state.panelVisible;
    logContent("togglePanel trace", {
      previousPanelVisible,
      nextPanelVisible: state.panelVisible,
      force: typeof force === "boolean" ? force : null,
    });
    console.trace("togglePanel trace");

    if (state.panelVisible) {
      // NOTE:
      // パネル open 時の自動 settings 再読込は、タブ復帰や再適用経路で
      // 意図せず panel reopen を引き起こすため停止する。
      // 明示的な設定変更は SETTINGS_CHANGED / restartBilingual 側で反映する。
    }

    applyLayout(state.panelVisible);

    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost = getTarget().querySelector("#atv-overlay-host");
    const toggleBtn = getTarget().querySelector("#atv-toggle-btn");

    if (panelHost) panelHost.style.display = state.panelVisible ? "" : "none";
    if (overlayHost) {
      overlayHost.style.width = state.panelVisible ? "70%" : "100%";
      overlayHost.style.display = state.panelVisible ? "none" : "";
    }
    if (toggleBtn)
      toggleBtn.style.display = state.panelVisible ? "none" : "block";

    scheduleAdjustPlaybackControls(
      "togglePanel",
      state.panelVisible ? [700, 1600] : [],
      { immediate: !state.panelVisible },
    );
    if (state.panelVisible) {
      scheduleControlSettlingBurst("togglePanel", [180, 420, 900, 1500]);
    }

    persistPanelVisibility();
    logContent("togglePanel", { panelVisible: state.panelVisible });
  }

  function loadPanelVisibility() {
    return new Promise((resolve) => {
      chrome.storage.local.get("panelVisible", (result = {}) => {
        if (chrome.runtime.lastError) {
          logContentError("panelVisible load failed", {
            error: chrome.runtime.lastError.message,
          });
          resolve(true);
          return;
        }

        if (Object.prototype.hasOwnProperty.call(result, "panelVisible")) {
          resolve(result.panelVisible !== false);
          return;
        }

        resolve(true);
      });
    });
  }

  function persistPanelVisibility() {
    chrome.storage.local.set({ panelVisible: state.panelVisible }, () => {
      if (chrome.runtime.lastError) {
        logContentError("panelVisible persist failed", {
          error: chrome.runtime.lastError.message,
          panelVisible: state.panelVisible,
        });
        return;
      }

      logContent("panelVisible persisted", {
        panelVisible: state.panelVisible,
      });
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

  // [binder/cue: attach] primary / secondary track の選択・bind・unbind を扱うセクション。
  // attach 軸では track selection と listener binding の境界をコメントで追える状態に保つ。
  function clearTrackResolveRetryTimers() {
    if (!state.trackResolveRetryTimers.length) return;
    state.trackResolveRetryTimers.forEach((timerId) => clearTimeout(timerId));
    state.trackResolveRetryTimers = [];
  }

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
    clearTrackBindings();

    // [attach: primary/secondary reset] 既存 bind を一度解除してから今回の track 選択に入る。

    const tracks = video.textTracks;
    let primaryListenerBound = false;

    // [attach: primary] primary resolver → mode 設定 → cuechange bind
    state.primaryTrack = pickBestSubtitleTrack(tracks, primaryLang);
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
      syncSecondarySubtitleTrack(video, secondaryLang, renderSecondarySubtitle);
    } else {
      unbindSecondarySubtitleTrack();
      renderSecondarySubtitle("", null);
    }

    state.secondaryTrack = secondaryTrackBound;

    return {
      reason,
      trackCount: tracks.length,
      primaryTrackFound: Boolean(state.primaryTrack),
      secondaryTrackFound: Boolean(state.secondaryTrack),
      primaryListenerBound,
      secondaryListenerBound: Boolean(secondaryTrackBound),
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
    const tracks = [
      state.primaryTrack,
      state.secondaryTrack,
      secondaryTrackBound,
    ];

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!canReadCueFromTrack(track)) continue;
      if (getTrackActiveCuesLength(track) > 0) return true;
      if (getCurrentCueText(track, currentTime)) return true;
    }

    return false;
  }

  // [render: panel secondary recovery]
  // panel shell 適用後、secondary subtitle が空なら直近 history から最小差分で補完する。
  function applySecondarySubtitleFallback(reason = "unknown") {
    const panelHost = getTarget().querySelector("#atv-panel-host");
    const secondaryEl = panelHost?.querySelector("[data-secondary-subtitle]");
    let secondaryText = normalizeSubtitleText(secondaryEl?.textContent || "");

    logSubtitlePanelState("before-secondary-fallback");

    if (!secondaryText && secondaryEl && state.subtitleHistory.length > 0) {
      const latestHistory =
        state.subtitleHistory[state.subtitleHistory.length - 1];
      const fallbackText = normalizeSubtitleText(
        latestHistory?.secondary || latestHistory?.primary || "",
      );
      if (fallbackText) {
        secondaryEl.textContent = fallbackText;
        secondaryText = fallbackText;
        logContent("panel secondary text fallback applied", {
          reason,
          contentKey: state.currentContentKey,
          fallbackSource: latestHistory?.secondary ? "secondary" : "primary",
          fallbackTextLength: fallbackText.length,
        });
      }
    }

    return {
      panelHost,
      secondaryText,
    };
  }

  // [render: panel shell state sync]
  function applyCurrentStateToPanel(reason = "unknown") {
    renderCurrentSnapshot();
    renderPanel();

    const { panelHost, secondaryText } = applySecondarySubtitleFallback(reason);

    logContent("panel state applied", {
      reason,
      contentKey: state.currentContentKey,
      panelVisible: state.panelVisible,
      hasPanelHost: Boolean(panelHost),
      secondaryTextLength: secondaryText.length,
      historySize: state.subtitleHistory.length,
    });
  }

  function clearInternalSubtitleState(reason = "unknown") {
    lastSecondaryText = "";
    lastSecondaryTextAt = 0;
    state.lastPrimaryText = "";
    state.lastPrimarySnapshotAt = 0;

    const panelHost = getTarget().querySelector("#atv-panel-host");
    const secondaryEl = panelHost?.querySelector("[data-secondary-subtitle]");
    if (secondaryEl) {
      secondaryEl.textContent = "";
      secondaryEl.innerHTML = "";
    }

    logContent("internal subtitle state cleared", {
      reason,
      contentKey: state.currentContentKey,
      hasPanelHost: Boolean(panelHost),
      hasSecondaryElement: Boolean(secondaryEl),
    });
  }

  // [binder/cue: recovery] attach / recovery の再初期化入口。
  // track 再選択・listener 再接続・panel 反映を最小差分でまとめて行う。
  function reinitializeSubtitlePipeline(reason = "unknown") {
    const switched = syncHistoryContextWithPlayback(reason);
    clearInternalSubtitleState(reason);

    const effectiveSecondaryLanguage =
      state.requestedSecondaryLang || state.contentSettings.secondaryLang;
    const trackSelection = selectPrimaryAndSecondaryTracks(
      state.video,
      state.contentSettings.primaryLang,
      effectiveSecondaryLanguage,
      reason,
    );
    const primaryTrackFound = trackSelection.primaryTrackFound;
    const secondaryTrackFound = trackSelection.secondaryTrackFound;
    const primaryListenerBound = trackSelection.primaryListenerBound;
    const secondaryListenerBound = trackSelection.secondaryListenerBound;

    logContentSubtitle("tracks resolved", {
      reason,
      switchedHistoryContext: switched,
      primaryTrackFound,
      secondaryTrackFound,
      trackCount: trackSelection.trackCount,
      primaryTrack: trackSelection.primaryTrack,
      secondaryTrack: trackSelection.secondaryTrack,
    });

    logContentSubtitle("cuechange listeners rebound", {
      reason,
      primaryListenerBound,
      secondaryTrackBound: secondaryListenerBound,
    });

    applyCurrentStateToPanel(reason);
    logContent("panel state reapplied", {
      reason,
      contentKey: state.currentContentKey,
      panelVisible: state.panelVisible,
    });

    return {
      reason,
      primaryTrackFound,
      secondaryTrackFound,
      primaryListenerBound,
      secondaryListenerBound,
      ready:
        primaryTrackFound &&
        secondaryTrackFound &&
        primaryListenerBound &&
        secondaryListenerBound,
    };
  }

  // [binder/cue: recovery] track resolve retry タイマーを管理する。
  function scheduleTrackResolveRetry(reason = "video_changed") {
    clearTrackResolveRetryTimers();

    logContentSubtitle("track resolve retry scheduled", {
      reason,
      retryDelaysMs: TRACK_RESOLVE_RETRY_DELAYS_MS,
    });

    TRACK_RESOLVE_RETRY_DELAYS_MS.forEach((delayMs, retryIndex) => {
      const timerId = window.setTimeout(() => {
        if (state.restarting || !state.video) return;

        const attempt = retryIndex + 1;
        logContentSubtitle("track resolve retry attempt", {
          reason,
          attempt,
          delayMs,
        });

        const found = getVideoAndDialog();
        if (found) {
          state.video = found.video;
          state.dialogEl = found.dialog;
          state.lastVideoSrcKey = getCurrentVideoSrcKey(found.video);
        }

        const retryResult = reinitializeSubtitlePipeline(
          `${reason}:retry_${attempt}`,
        );

        if (retryResult.ready) {
          logContentSubtitle("track resolve retry success", {
            reason,
            attempt,
          });
          clearTrackResolveRetryTimers();
          return;
        }

        if (attempt === TRACK_RESOLVE_RETRY_DELAYS_MS.length) {
          logContentError("track resolve retry exhausted", {
            reason,
            attempts: TRACK_RESOLVE_RETRY_DELAYS_MS.length,
            primaryTrackFound: retryResult.primaryTrackFound,
            secondaryTrackFound: retryResult.secondaryTrackFound,
            primaryListenerBound: retryResult.primaryListenerBound,
            secondaryListenerBound: retryResult.secondaryListenerBound,
          });
          clearTrackResolveRetryTimers();
        }
      }, delayMs);

      state.trackResolveRetryTimers.push(timerId);
    });
  }

  // [settings reinit path: partial]
  // 設定を再読込し、現在の video / track に対して subtitle pipeline を再解決する。
  // UI 全体の teardown / rebuild までは行わない軽量な再初期化入口。

  function reloadSettingsAndReinitialize(reason = "unknown") {
    if (state.restarting) return;

    const proceedWithReinitialize = () => {
      const found = getVideoAndDialog();
      if (found) {
        state.video = found.video;
        state.dialogEl = found.dialog;
      }

      if (!state.video) return;

      const run = () => {
        state.lastVideoSrcKey = getCurrentVideoSrcKey(state.video);
        const result = reinitializeSubtitlePipeline(reason);

        if (reason === "video_changed") {
          if (result.ready) {
            clearTrackResolveRetryTimers();
          } else {
            scheduleTrackResolveRetry(reason);
          }
        }
      };

      if (reason === "video_changed") {
        loadPanelVisibility()
          .then((panelVisible) => {
            state.panelVisible = panelVisible;
            logContent("panelVisible reloaded before reinitialize", {
              reason,
              panelVisible: state.panelVisible,
            });
            run();
          })
          .catch(() => {
            run();
          });
        return;
      }

      run();
    };

    loadSettingsSnapshot(reason)
      .then((snapshot) => {
        state.requestedContentSettings = {
          ...(snapshot.storedSettings || {}),
        };
        state.requestedSecondaryLang = snapshot.requestedSecondaryLang || "";
        state.contentSettings = { ...snapshot.effectiveSettings };
        proceedWithReinitialize();
      })
      .catch((error) => {
        logContentError("settings load failed", {
          reason,
          error: String(error),
        });
      });
  }

  function runInitialCueRecoveryRender(reason = "unknown") {
    if (!hasRecoverableInitialCue()) return false;

    applyCurrentStateToPanel(`initial_recovery:${reason}`);
    logContent("initial cue recovery render", {
      reason,
      primaryActiveCues: getTrackActiveCuesLength(state.primaryTrack),
      secondaryActiveCues: getTrackActiveCuesLength(state.secondaryTrack),
    });
    return true;
  }

  function bindInitialCueRecoveryListeners(completeRecovery) {
    // [initial cue recovery: event-driven path]
    // cuechange / timeupdate を一時的に監視し、初回 cue が取れた瞬間に
    // render を再試行して recovery を完了させる。
    const attachRecoveryListener = (target, eventName, label) => {
      if (!target || typeof target.addEventListener !== "function") return;

      const onRecoveryEvent = () => {
        if (!runInitialCueRecoveryRender(`${eventName}:${label}`)) return;
        completeRecovery();
      };

      target.addEventListener(eventName, onRecoveryEvent);
      state.initialCueRecoveryCleanup.push(() => {
        target.removeEventListener(eventName, onRecoveryEvent);
      });
    };

    // 初回 cue 到着時は delay ではなくイベントで回復描画を確定させる。
    attachRecoveryListener(state.primaryTrack, "cuechange", "primary");
    attachRecoveryListener(state.secondaryTrack, "cuechange", "secondary");
    if (secondaryTrackBound && secondaryTrackBound !== state.secondaryTrack) {
      attachRecoveryListener(
        secondaryTrackBound,
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
        if (!runInitialCueRecoveryRender(`delay:${delayMs}`)) return;
        completeRecovery();
      }, delayMs);
      state.initialCueRecoveryTimers.push(timerId);
    });
  }

  // [binder/cue: recovery] 初回 cue recovery の event-driven / delayed retry を束ねる。
  function scheduleInitialCueRecovery() {
    clearInitialCueRecoveryTimers();
    clearInitialCueRecoveryCleanup();

    let recovered = false;
    const completeRecovery = () => {
      if (recovered) return;
      recovered = true;
      clearInitialCueRecoveryTimers();
      clearInitialCueRecoveryCleanup();
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

    reloadSettingsAndReinitialize("panel_open_settings_reloaded");

    logContent("panel open settings reloaded", {
      primaryLang: state.contentSettings.primaryLang,
      secondaryLang: state.contentSettings.secondaryLang,
      requestedSecondaryLang: state.requestedSecondaryLang,
      trackCount: state.video?.textTracks?.length ?? 0,
    });
  }

  // [binder/cue: attach] secondary track binder
  // [binder/cue: attach] secondary cuechange listener を detach し、bound track 参照を外す。
  function unbindSecondarySubtitleTrack() {
    // [attach: secondary detach] secondary binder cleanup を実行する。
    if (secondaryTrackCleanup) {
      secondaryTrackCleanup();
      secondaryTrackCleanup = null;
    }
    secondaryTrackBound = null;
  }

  // [binder/cue: attach] secondary track を bind し、cuechange を panel render 側へ接続する。
  function bindSecondarySubtitleTrack(track, renderSecondarySubtitle) {
    if (!track || typeof renderSecondarySubtitle !== "function") return;

    // [attach: secondary rebind] 既存 secondary binding を解除してから今回の track を bind する。
    unbindSecondarySubtitleTrack();

    try {
      track.mode = "showing";
    } catch (_) {}

    if (DEBUG_SECONDARY_SUBS) {
      logContent("secondary track forced to showing", {
        trackLanguage: track?.language || "",
        cuesLength: getTrackCuesLength(track),
        activeCuesLength: getTrackActiveCuesLength(track),
      });
    }

    // [attach: secondary cuechange -> render] secondary cuechange を secondary render / panel render へ配信する。
    const onSecondaryCueChange = () => {
      if (DEBUG_SECONDARY_SUBS) {
        const effectiveSecondaryLanguage =
          state.requestedSecondaryLang || state.contentSettings.secondaryLang;
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(effectiveSecondaryLanguage, track),
        );
      }
      renderSecondarySubtitle(getCurrentCueText(track), track);
      renderPanel();
    };

    track.addEventListener("cuechange", onSecondaryCueChange);

    // [attach: secondary detach handle] detach 時に使う cleanup を保持する。
    secondaryTrackCleanup = () => {
      track.removeEventListener("cuechange", onSecondaryCueChange);
    };

    secondaryTrackBound = track;

    // [attach: secondary initial paint] bind 直後に current cue で初期描画する。
    renderSecondarySubtitle(getCurrentCueText(track), track);
  }

  // [binder/cue: fan-out] primary cuechange fan-out
  // [binder/cue: fan-out] binder から overlay render への配信。
  function updateCueOverlay(pText, sText) {
    updateOverlay(pText, sText);
  }

  // [binder/cue: fan-out] binder から subtitle history への配信。
  function appendCueHistory(pCue, pText, sText) {
    if (!pText || pText === state.lastPrimaryText || !pCue) return;

    state.lastPrimaryText = pText;
    appendSubtitleHistory({
      startTime: pCue.startTime,
      endTime: pCue.endTime,
      primary: pText,
      secondary: sText,
    });
  }

  // [binder/cue: fan-out] binder から panel render への配信。
  function renderCuePanel(sText) {
    if (state.secondaryTrack) {
      renderSecondarySubtitle(sText, state.secondaryTrack);
    }

    renderPanel();
  }

  // [binder/cue: fan-out] cuechange fan-out:
  // track(primary/secondary) → binder → overlay/history/panel render
  function onCueChange() {
    // [fan-out: track -> binder] primary / secondary の current cue を取得する。
    const currentTime = state.video?.currentTime ?? 0;
    const pCue = getCurrentCue(state.primaryTrack, currentTime);
    const pText = cleanCueText(pCue);
    const sCue = getCurrentCue(state.secondaryTrack, currentTime);
    const sText = cleanCueText(sCue);

    if (DEBUG_PANEL_PROBE) {
      // Probe cuechange source tracks/texts when reproducing #19 symptoms.
      logContent("cuechange track probe", {
        primaryTrackLanguage: state.primaryTrack?.language,
        secondaryTrackLanguage: state.secondaryTrack?.language,
        pText: pText.slice(0, 40),
        sText: sText.slice(0, 40),
      });
    }

    // [fan-out: binder -> overlay render]
    updateCueOverlay(pText, sText);

    // [fan-out: binder -> history]
    appendCueHistory(pCue, pText, sText);

    // [fan-out: binder -> panel render]
    renderCuePanel(sText);
  }

  // [binder/cue: attach] primary / secondary の listener・timer・mode をまとめて解除する。
  function clearTrackBindings() {
    // [attach: detach timers] retry / recovery timer 群を先に解除する。
    clearTrackResolveRetryTimers();
    clearInitialCueRecoveryTimers();
    clearInitialCueRecoveryCleanup();
    unbindSecondarySubtitleTrack();

    // [attach: detach primary listener] primary cuechange listener を解除する。
    if (state.primaryTrack) {
      try {
        state.primaryTrack.removeEventListener("cuechange", onCueChange);
      } catch (_) {}
    }

    // [attach: detach track modes] textTracks を hidden に戻す。
    if (state.video?.textTracks) {
      for (let i = 0; i < state.video.textTracks.length; i++) {
        try {
          state.video.textTracks[i].mode = "hidden";
        } catch (_) {}
      }
    }

    // [attach: detach secondary timer] secondary hide timer を解除する。
    if (state.secondaryHideTimer) {
      clearTimeout(state.secondaryHideTimer);
      state.secondaryHideTimer = null;
    }

    // [attach: detach state reset] binder が保持する track 参照をクリアする。
    state.primaryTrack = null;
    state.secondaryTrack = null;
  }

  function resetRuntimeState(options = {}) {
    if (options.clearCurrentHistory === true) {
      state.subtitleHistory = [];
      saveHistoryForContentKey(state.currentContentKey, []);
    }
    state.lastPrimaryText = "";
    state.lastPrimarySnapshotAt = 0;
    state.lastObservedVideoTime = null;
  }

  function teardownForRestart() {
    clearTrackBindings();
    clearPlaybackControlRetryTimers();
    clearControlSettlingTimers();
    clearInitialCueRecoveryTimers();
    stopPlaybackControlLayoutObservers();

    if (state.playbackControlsRafId) {
      window.cancelAnimationFrame(state.playbackControlsRafId);
      state.playbackControlsRafId = 0;
    }
    clearPlaybackControlsTransforms();

    if (state.popupDocClickHandler) {
      // createPopupHost で登録した document listener の解除
      document.removeEventListener("click", state.popupDocClickHandler);
      state.popupDocClickHandler = null;
    }

    destroyUiHosts();
    applyLayout(false);
  }

  // [binder/cue: attach] bootstrap から呼ばれる track bind の薄い入口。
  function bindTracks() {
    return selectPrimaryAndSecondaryTracks(
      state.video,
      state.contentSettings.primaryLang,
      state.requestedSecondaryLang || state.contentSettings.secondaryLang,
      "bindTracks",
    );
  }

  // [bootstrap]

  function buildUi() {
    createOverlay();
    createRightPanel();
    ensureSecondarySubtitleElement();
    createPopupHost();
    createToggleButton();
    createDebugPanel();
    startPlaybackControlLayoutObservers();
    scheduleAdjustPlaybackControls("buildUi", [700, 1600], {
      immediate: false,
    });
  }

  // [binder/cue: recovery] initial snapshot apply
  // [binder/cue: recovery] 起動時に取得済み cue を即時適用し、未取得なら recovery 経路へ委譲する。
  function renderCurrentSnapshot() {
    ensureSecondarySubtitleElement();

    // [initial snapshot policy]
    // 起動時に cue が既に読めるなら通常の cuechange 経路を即時実行する。
    // まだ cue が無ければ recovery 側に任せ、ここでは待機ログだけ出す。

    const hasInitialCue = hasRecoverableInitialCue();
    if (hasInitialCue) {
      onCueChange();
    } else {
      // 初回 activeCues=0 は空描画で確定せず、cuechange 回復導線へ委譲する。
      logContent("initial snapshot waiting for first cue", {
        primaryActiveCues: getTrackActiveCuesLength(state.primaryTrack),
        secondaryActiveCues: getTrackActiveCuesLength(state.secondaryTrack),
      });
    }

    applySettingsToUI(state.contentSettings, { syncPanelVisibility: false });
    if (secondaryTrackBound) {
      renderSecondarySubtitle(
        getCurrentCueText(secondaryTrackBound),
        secondaryTrackBound,
      );
    }
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

    syncHistoryContextWithPlayback("startBilingual");

    bindTracks();
    const effectiveSecondaryLanguage =
      state.requestedSecondaryLang || state.contentSettings.secondaryLang;
    if (state.video && effectiveSecondaryLanguage) {
      syncSecondarySubtitleTrack(
        state.video,
        effectiveSecondaryLanguage,
        renderSecondarySubtitle,
      );
      state.secondaryTrack = secondaryTrackBound;
    }

    logContentSubtitle("Selected tracks detail", {
      requestedPrimaryLang: state.contentSettings.primaryLang,
      requestedSecondaryLang: state.contentSettings.secondaryLang,
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

    if (typeof options.keepPanelVisible === "boolean") {
      state.panelVisible = options.keepPanelVisible;
    } else {
      state.panelVisible = await loadPanelVisibility();
    }
    logContent("startBilingual panelVisible applied", {
      panelVisible: state.panelVisible,
      keepPanelVisible:
        typeof options.keepPanelVisible === "boolean"
          ? options.keepPanelVisible
          : null,
    });
    console.trace("startBilingual panelVisible applied");

    buildUi();
    ensureSecondarySubtitleElement();

    if (state.secondaryTrack) {
      renderSecondarySubtitle(
        getCurrentCueText(state.secondaryTrack),
        state.secondaryTrack,
      );
    }

    applyCurrentStateToPanel("startBilingual_ready");
    scheduleInitialCueRecovery();
    scheduleControlSettlingBurst("startBilingual");

    logContentSubtitle("startBilingual ready", {
      injectedInto: state.dialogEl ? "dialog.playback-view" : "document.body",
      contentKey: state.currentContentKey,
      primaryLang: state.contentSettings.primaryLang,
      secondaryLang: state.contentSettings.secondaryLang,
      primaryTrackFound: !!state.primaryTrack,
      secondaryTrackFound: !!state.secondaryTrack,
      ejdictLoaded: !!state.ejdictMap,
    });
  }

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

  // [settings load path: initial snapshot]
  // 初回ロード時に sync storage / bridge から設定 snapshot を読む入口。
  // requested settings と effective settings を整え、未設定時は DEFAULT_SETTINGS に退避する。
  // 実際の起動は startBilingual に委譲する。
  function loadSettingsFromSync() {
    loadSettingsSnapshot("initial_load")
      .then((snapshot) => {
        state.requestedContentSettings = {
          ...(snapshot.storedSettings || {}),
        };
        state.requestedSecondaryLang = snapshot.requestedSecondaryLang || "";

        const hasCompleteRequestedSettings = isLanguageSelectionReady(
          state.requestedContentSettings,
        );

        state.contentSettings = hasCompleteRequestedSettings
          ? { ...snapshot.effectiveSettings }
          : { ...DEFAULT_SETTINGS };

        if (hasCompleteRequestedSettings) {
          const effectiveSecondaryLanguage =
            state.requestedSecondaryLang || state.contentSettings.secondaryLang;
          if (state.video && effectiveSecondaryLanguage) {
            syncSecondarySubtitleTrack(
              state.video,
              effectiveSecondaryLanguage,
              renderSecondarySubtitle,
            );
            state.secondaryTrack = secondaryTrackBound;
          }
        } else {
          state.secondaryTrack = null;
          unbindSecondarySubtitleTrack();
        }

        logContentSettings("Loaded settings from sync", {
          ...state.contentSettings,
          requestedSecondaryLang: state.requestedSecondaryLang,
          hasCompleteRequestedSettings,
        });

        if (!hasCompleteRequestedSettings) {
          logContentSettings("initial load routed to language setup notice", {
            requestedSettings: { ...state.requestedContentSettings },
            requestedSecondaryLang: state.requestedSecondaryLang,
          });
        }

        startBilingual();
      })
      .catch((error) => {
        logContentError("settings load failed", {
          reason: "initial_load",
          error: String(error),
        });
      });
  }

  // [settings reinit path: full restart]
  // runtime state と UI を teardown してから起動シーケンスをやり直す。
  // 設定変更反映や大きな再初期化が必要なケースの入口。

  function restartBilingual(nextSettings = null, reason = "unknown") {
    logContent("restartBilingual trace", {
      reason,
      panelVisible: state.panelVisible,
    });
    console.trace("restartBilingual trace");
    if (state.restarting) {
      logContent("restartBilingual skipped: already restarting", { reason });
      return;
    }

    state.restarting = true;
    try {
      if (nextSettings) {
        state.requestedContentSettings = {
          ...state.requestedContentSettings,
          ...nextSettings,
        };
        state.requestedSecondaryLang = nextSettings.secondaryLang || "";

        if (isLanguageSelectionReady(state.requestedContentSettings)) {
          state.contentSettings = applySecondaryLangFallback({
            ...state.contentSettings,
            ...nextSettings,
          });
        } else {
          state.contentSettings = { ...DEFAULT_SETTINGS };
          state.secondaryTrack = null;
          unbindSecondarySubtitleTrack();
          logContentSettings("restartBilingual routed to language setup notice", {
            reason,
            requestedSettings: { ...state.requestedContentSettings },
            requestedSecondaryLang: state.requestedSecondaryLang,
          });
        }
      }

      const found = getVideoAndDialog();
      if (found) {
        state.video = found.video;
        state.dialogEl = found.dialog;
      }

      logContentSettings("restartBilingual begin", {
        reason,
        hasVideo: !!state.video,
        trackCount: state.video?.textTracks?.length ?? 0,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLang: state.requestedSecondaryLang,
      });

      const wasPanelVisible = state.panelVisible;
      teardownForRestart();
      resetRuntimeState();
      startBilingual({ keepPanelVisible: wasPanelVisible });

      logContentSettings("restartBilingual done", { reason });
    } finally {
      state.restarting = false;
    }
  }

  const onRuntimeMessage = (message, sender, sendResponse) => {
    // [runtime message path: settings changed]
    // popup / options からの設定変更を受ける入口。
    // requested settings を更新し、secondaryLang fallback を解決してから restartBilingual に委譲する。
    // playback 未準備時は適用をスキップする。
    if (message.type === "SETTINGS_CHANGED") {
      if (!isPlaybackPageReady()) {
        logContent("SETTINGS_CHANGED skipped: playback not ready", {
          ...getPlaybackContextLogPayload(),
          reason: message.reason || "unknown",
        });
        sendResponse({ ok: true, skipped: "playback_not_ready" });
        return true;
      }

      const updated = { ...message.settings };
      const bridgeResult = window.ATVB?.settingsBridge?.handleRuntimeMessage?.(
        message,
        { applyFallback: applySecondaryLangFallback },
      );

      let next;
      if (bridgeResult?.handled) {
        state.requestedContentSettings = {
          ...(bridgeResult.storedSettings ||
            bridgeResult.requestedSettings ||
            updated),
        };
        state.requestedSecondaryLang =
          bridgeResult.requestedSecondaryLang ?? "";

        if (isLanguageSelectionReady(state.requestedContentSettings)) {
          next = { ...bridgeResult.settings };
        } else {
          next = { ...DEFAULT_SETTINGS };
          state.secondaryTrack = null;
          unbindSecondarySubtitleTrack();
        }
      } else {
        state.requestedContentSettings = {
          ...state.requestedContentSettings,
          ...updated,
        };
        state.requestedSecondaryLang = updated.secondaryLang ?? "";

        if (isLanguageSelectionReady(state.requestedContentSettings)) {
          next = applySecondaryLangFallback({
            ...state.contentSettings,
            ...updated,
          });
        } else {
          next = { ...DEFAULT_SETTINGS };
          state.secondaryTrack = null;
          unbindSecondarySubtitleTrack();
        }
      }
      const requestedSecondaryLang = state.requestedSecondaryLang;
      const resolvedSecondaryLanguage = next.secondaryLang;
      const triggerReason = message.reason || "unknown";

      logContentSettings("SETTINGS_CHANGED received", {
        triggerReason,
        settings: {
          ...next,
          requestedSecondaryLang,
          resolvedSecondaryLanguage,
        },
      });

      if (state.video && resolvedSecondaryLanguage) {
        syncSecondarySubtitleTrack(
          state.video,
          resolvedSecondaryLanguage,
          renderSecondarySubtitle,
        );
        state.secondaryTrack = secondaryTrackBound;
      }

      restartBilingual(next, "SETTINGS_CHANGED");

      const appliedRequestedSecondaryLang = state.requestedSecondaryLang;
      const appliedResolvedSecondaryLanguage = resolvedSecondaryLanguage;

      logContentSettings("content applied settings to tracks", {
        triggerReason,
        hasVideo: !!state.video,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLang: appliedRequestedSecondaryLang,
        resolvedSecondaryLanguage: appliedResolvedSecondaryLanguage,
        selectedSecondaryTrackLanguage: state.secondaryTrack?.language || "",
        primaryTrackFound: !!state.primaryTrack,
        secondaryTrackFound: !!state.secondaryTrack,
      });

      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "GET_LANGUAGES") {
      const langs = state.video ? getUniqueTracks(state.video.textTracks) : [];
      logContent("GET_LANGUAGES handled", { count: langs.length });
      sendResponse(langs.map((l) => ({ lang: l.lang, label: l.label })));
      return true;
    }
  };

  function ensureMessageListener() {
    if (state.messageListenerAttached) return;
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    state.messageListenerAttached = true;
    logContent("content message listener registered");
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    registerDebugLogUpdateCallback();
    logContent("content startup begin");
    ensureMessageListener();
    ensureSecondaryTrackSyncInterval();
    waitForVideo(attachTracks);
  }

  boot();
})();
