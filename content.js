// =============================================================
// Apple TV+ Bilingual Subtitles - content.js
// version: 2.6.3
// Issue #4: Debug 配置修正と再生ページ限定 build、初回字幕回復導線を最小差分で整理
// 既存の起動導線は維持し、layout/observer/retry/polling は変更しない
/* global createSubtitleHistoryStore */
// Phase A: VTT 正規化と logger を外部モジュールへ分離し、ここでは橋渡しを担当する。
// =============================================================
// Phase D/#19: current 行の primary 非対称を最小差分で補正する。
// secondary cue の短いギャップ時のみ panel primary を一時補完する。
//

(function () {
  ("use strict");

  // 二重 inject ガード（SPA reinject 対策）
  if (window.atvbContentInjected) {
    return;
  }
  window.atvbContentInjected = true;

  const DEFAULT_SETTINGS = {
    extensionEnabled: false,
    primaryLang: "en",
    secondaryLang: "",
    panelDefaultOpen: true,
    playWordAudio: true,
    enableAiTooltip: false,
    preferredAiProvider: "auto",
  };

  const DEBUG_SECONDARY_SUBS = false; // Subtitle probe logs. Keep false in normal operation.
  const DEBUG_PANEL_PROBE = false; // Panel/UI probe logs. Keep false in normal operation.
  const DEBUG_MEMORY_PROBE = true; // Memory lifecycle probe logs. Keep false in normal operation.
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
  const SECONDARY_SUBTITLE_IDLE_CLEAR_MS = 3200;
  const PANEL_PRIMARY_GRACE_MS = 600;
  const SUBTITLE_HISTORY_MAX_PER_CONTENT = 500;
  const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

  const state = {
    booted: false,
    bilingualSessionSeq: 0,
    activeBilingualSessionId: null,
    restarting: false,
    video: null,
    dialogEl: null,
    contentSettings: { ...DEFAULT_SETTINGS },
    requestedContentSettings: {},
    requestedSecondaryLang: "",
    primaryTrack: null,
    secondaryTrack: null,
    lastVideoSrcKey: "",
    subtitleHistory: [],
    panelPastBlocks: [],
    subtitleBlocks: [],
    subtitleCurrentIndex: -1,
    subtitleBlockMeta: null,
    lastPanelRenderSnapshot: null,
    currentSubtitleBlock: null,
    lastCurrentSubtitleBlockAt: 0,
    lastAfterRenderSecondarySnapshotSignature: "",
    lastPrimarySnapshotAt: 0,
    lastObservedVideoTime: null,
    lastLargeSeekAt: 0,
    lastPrimaryText: "",
    lastSecondaryText: "",
    lastSecondaryTextAt: 0,
    lastSecondarySignalAt: 0,
    panelOpen: false,
    ejdictMap: null,
    secondaryHideTimer: null,
    overlayRoot: null,
    panelShadowRoot: null,
    popupShadowRoot: null,
    debugPanelRoot: null,
    popupDocClickHandler: null,
    playbackCloseClickHandler: null,
    popupResizeObserver: null,
    toggleButtonResizeHandler: null,
    popupLastContext: null,
    messageListenerAttached: false,
    playbackControlsRafId: 0,
    playbackControlsApplying: false,
    playbackControlsRetryTimers: [],
    trackResolveRetryTimers: [],
    controlSettlingTimers: [],
    initialCueRecoveryTimers: [],
    initialCueRecoveryCleanup: [],
    // Native subtitle menu sync: 最後に "成功して適用できた" 言語だけを記録する。
    // secondaryLang が同じでも前回失敗していれば再同期させるため、
    // "要求した言語" ではなく "成功した言語" を保持する点に注意。
    lastNativeSubtitleSyncLang: "",
    lastNativeSubtitleSyncOk: false,
    allowSecondaryOnlyUntil: 0,
  };

  window.ATVB = window.ATVB || {};
  window.ATVB.state = state;

  let panelUi = null;
  let secondaryTrackSyncInterval = null;
  const historyStore = createSubtitleHistoryStore(SUBTITLE_HISTORY_MAX_PER_CONTENT);

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
  function summarizeDebugValue(value, depth = 0) {
    if (value == null) return value;

    if (typeof value === "string") {
      return value.length > 160 ? `${value.slice(0, 160)}…` : value;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return value;
    }

    if (typeof value === "function") {
      return `[Function ${value.name || "anonymous"}]`;
    }

    if (depth >= 2) {
      if (Array.isArray(value)) {
        return `[Array(${value.length})]`;
      }
      return `[Object ${value?.constructor?.name || "Object"}]`;
    }

    if (Array.isArray(value)) {
      return {
        __type: "Array",
        length: value.length,
        items: value.slice(0, 5).map((item) => summarizeDebugValue(item, depth + 1)),
      };
    }

    if (typeof Node !== "undefined" && value instanceof Node) {
      return {
        __type: "DOMNode",
        nodeName: value.nodeName,
        id: value.id || "",
        className:
          typeof value.className === "string" ? value.className.slice(0, 120) : "",
      };
    }

    const constructorName = value?.constructor?.name || "Object";

    if (constructorName === "TextTrack") {
      return {
        __type: "TextTrack",
        kind: value.kind || "",
        label: value.label || "",
        language: value.language || "",
        mode: value.mode || "",
        cuesLength: getTrackCuesLength(value),
        activeCuesLength: getTrackActiveCuesLength(value),
      };
    }

    if (constructorName === "VTTCue" || constructorName === "TextTrackCue") {
      return {
        __type: constructorName,
        id: value.id || "",
        startTime: Number.isFinite(value.startTime) ? value.startTime : null,
        endTime: Number.isFinite(value.endTime) ? value.endTime : null,
        text:
          typeof value.text === "string"
            ? value.text.slice(0, 120)
            : "",
      };
    }

    const summary = {
      __type: constructorName,
    };

    const entries = Object.entries(value).slice(0, 12);
    for (const [key, child] of entries) {
      if (
        key === "cues" ||
        key === "activeCues" ||
        key === "track" ||
        key === "tracks" ||
        key === "video" ||
        key === "element" ||
        key === "elements" ||
        key === "node" ||
        key === "target" ||
        key === "currentSubtitleBlock" ||
        key === "panelPastBlocks" ||
        key === "subtitleBlocks" ||
        key === "subtitleHistory"
      ) {
        if (Array.isArray(child)) {
          summary[key] = `[Array(${child.length}) omitted]`;
        } else if (child && typeof child === "object") {
          summary[key] = `[${child?.constructor?.name || "Object"} omitted]`;
        } else {
          summary[key] = child ?? null;
        }
        continue;
      }

      summary[key] = summarizeDebugValue(child, depth + 1);
    }

    return summary;
  }

  try {
    const buffer = (window.__atvDebugLogs = window.__atvDebugLogs || []);
    const category = args.length >= 3 ? args[0] : null;
    const message = args.length >= 3 ? args[1] : args[0];
    const payload = args.length >= 3 ? args[2] : args[1];

    const entry = {
      ts: new Date().toISOString(),
      category: category == null ? null : String(category),
      message: String(message ?? ""),
      payload: summarizeDebugValue(payload),
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
    const contentKey = String(historyStore.getCurrentKey() || "").trim();
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

  function logSubtitleProbe(message, payload = null) {
    if (!DEBUG_SECONDARY_SUBS) return;
    logContentSubtitle(message, payload);
  }

  function logPanelProbe(message, payload = null) {
    if (!DEBUG_PANEL_PROBE) return;
    logContentUi(message, payload);
  }

  function logMemoryProbe(message, payload = null) {
    if (!DEBUG_MEMORY_PROBE) return;
    logContentUi(message, payload);
  }

  function getLiveDebugLogFilter() {
    return {
      categories: CONTENT_DEFAULT_DEBUG_CATEGORIES,
      scopes: ["content"],
    };
  }

  // logger の更新通知を Debug パネル更新へ接続する。
  function _registerDebugLogUpdateCallback() {
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
      if (false) {
        logContentApi("EJDict loaded", {
          entries: Object.keys(state.ejdictMap).length,
          url,
        });
      }
    } catch (e) {
      logContentError("EJDict load failed", { error: e.message });
      // eslint-disable-next-line no-console
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


  function switchHistoryContext(nextContentKey, reason = "unknown") {
    const switched = historyStore.switchContext(nextContentKey, {
      reason,
      onBeforeSwitch: (prevKey, nextKey) => {
        if (prevKey && nextKey && prevKey !== nextKey) {
          overlayController.clearOverlayState?.();
        }
        secondarySubtitleDom?.clearPanelSecondaryText?.();
        state.holdBlockCandidate = null;
      },
    });

    if (!switched) return false;

    // state.subtitleHistory をブリッジ同期（既存参照箇所との互換維持）
    state.subtitleHistory = historyStore.getActiveHistory();
    state.lastPrimaryText = "";

    logContentSubtitle("history context switched", {
      reason,
      previousContentKey: historyStore.getCurrentKey(),
      nextContentKey: historyStore.getCurrentKey(),
      historySize: state.subtitleHistory.length,
    });
    return true;
  }


  function syncHistoryContextWithPlayback(reason = "unknown") {
    return switchHistoryContext(resolvePlaybackContentKey(), reason);
  }

  function _appendSubtitleHistory(entry) {
    if (!entry) return;
    historyStore.append(entry);
    // state.subtitleHistory をブリッジ同期（panel-renderer 等の既存参照を維持）
    state.subtitleHistory = historyStore.getActiveHistory();
  }

  function getSecondaryTrackDebugPayload(effectiveSecondaryLanguage, track) {
    return {
      effectiveSecondaryLanguage: effectiveSecondaryLanguage || "",
      selectedTrackLanguage: track?.language || "",
      cuesLength: getTrackCuesLength(track),
      activeCuesLength: getTrackActiveCuesLength(track),
    };
  }

  function _canReadCueFromTrack(track) {
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

  function _getSecondaryRenderLogPayload(text, track, elementCount) {
    return {
      textPreview: String(text || "").slice(0, 40),
      trackLanguage: track?.language || "",
      activeCuesLength: getTrackActiveCuesLength(track),
      secondaryElementCount: elementCount,
    };
  }

  function _ensurePanelSlotLayerStyle() {
    if (!secondarySubtitleDom?.ensure) return;
    secondarySubtitleDom.ensure();
  }

  // [render: secondary subtitle dom]
  function renderSecondarySubtitle(text, track, reason = "unspecified") {
    if (!secondarySubtitleDom?.render) return;
    secondarySubtitleDom.render(text, track, reason);
    logSubtitlePanelState("after-renderSecondarySubtitle");
  }

  function logSubtitlePanelState(tag) {
    try {
      const _panelHost = getTarget().querySelector("#atv-panel-host");
      const nonPanelSecondaryEls = secondarySubtitleDom?.getNonPanelElements?.() ?? [];
      const secondaryEl = nonPanelSecondaryEls[0] ?? null;

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
        secondaryElCount: nonPanelSecondaryEls.length,
      };

      if (tag === "after-renderSecondarySubtitle") {
        const signature = JSON.stringify({
          allBlocksCount: payload.allBlocksCount,
          historyCount: payload.historyCount,
          hasCurrentBlock: payload.hasCurrentBlock,
          currentPrimary: payload.currentPrimary,
          currentSecondary: payload.currentSecondary,
          secondaryElText: payload.secondaryElText,
          secondaryElCount: payload.secondaryElCount,
        });
        if (signature === state.lastAfterRenderSecondarySnapshotSignature) {
          return;
        }
        state.lastAfterRenderSecondarySnapshotSignature = signature;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[ATVB] panel state snapshot failed", {
        tag,
        error: String(error),
      });
    }
  }

  function ensureSecondaryTrackSyncInterval() {
    if (secondaryTrackSyncInterval) return;

    secondaryTrackSyncInterval = window.setInterval(async () => {
      if (state.restarting) return;
      if (syncIntervalOrchestrator?.isPaused?.()) return;

      syncIntervalOrchestrator?.refreshPlaybackContext?.();

      const effectiveSecondaryLanguage =
        getResolverRequestedSecondaryLanguage();

      syncIntervalOrchestrator?.detectLargeSeek?.();

      if (!state.video || !effectiveSecondaryLanguage) return;

      await syncIntervalOrchestrator?.runSecondaryRecoveryPass?.(
        effectiveSecondaryLanguage,
      );
    }, 1000);
  }

  function _getShadowProgressTargets() {
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
          // eslint-disable-next-line no-console
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
    layoutController.applyPanelLayout(show, {
      reason: "applyLayout",
      retryDelays: show ? [1200] : [],
      immediate: !show,
      settlingDelays: [180, 420, 900, 1500],
    });
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
      const root = state.debugPanelRoot;
      if (!root) return;                         // ← root 未確立なら即 return
      await window.ATVB?.debugPanel?.update?.(root);
    } catch (error) {
      // eslint-disable-next-line no-console
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

  function _resetPopupDisplayState(clean) {
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

  function _openPopupDisplay(popup) {
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

  function _fetchDictionary(word) {
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

  function _fetchTranslation(text) {
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
  const createCueTrackBinder = window.ATVB?.cueTrackBinder?.createCueTrackBinder;
  const createTrackListenerBinding =
    window.ATVB?.cueTrackBinder?.createTrackListenerBinding || null;
  const createSubtitleSyncController =
    window.ATVB?.subtitleSyncController?.createSubtitleSyncController;


  if (typeof createPanelRenderer !== "function") {
    throw new Error("ATVB panelRenderer.createPanelRenderer is not available");
  }

  if (typeof createCueController !== "function") {
    throw new Error("ATVB cueController.createCueController is not available");
  }

  if (typeof createSubtitleSyncController !== "function") {
    throw new Error("ATVB subtitleSyncController.createSubtitleSyncController is not available");
  }

  const root = (window.ATVB = window.ATVB || {});
  const vttDeps = window.ATVB?.vtt || {};
  const resolverDeps = window.ATVB?.resolver || {};
  const subtitleBlocksDeps = window.ATVB?.subtitleBlocks || {};
  const createSecondarySubtitleDom = root.createSecondarySubtitleDom || null;
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
  const secondarySubtitleDom = createSecondarySubtitleDom
  ? createSecondarySubtitleDom({
      getTarget,
      isSecondaryDomReady: () => true,
      getTrackActiveCuesLength,
      getCurrentCueText,
      normalizeSubtitleText,
      logContentSubtitle,
      isDebugEnabled: () => DEBUG_SECONDARY_SUBS,
      idleClearMs: SECONDARY_SUBTITLE_IDLE_CLEAR_MS,
      panelSlotLayerStyleId: PANEL_SLOT_LAYER_STYLE_ID,
    })
  : null;

  function setSubtitleBlocks(blocksOrSequence, options = null) {
    const MAX_SUBTITLE_BLOCKS = 200;

    function trimSequenceBlocks(sequenceLike) {
      const blocks = Array.isArray(sequenceLike?.blocks)
        ? sequenceLike.blocks
        : Array.isArray(sequenceLike)
          ? sequenceLike
          : [];

      if (blocks.length <= MAX_SUBTITLE_BLOCKS) {
        return {
          blocks,
          currentIndex: Number.isInteger(sequenceLike?.currentIndex)
            ? sequenceLike.currentIndex
            : -1,
          meta: sequenceLike?.meta || null,
        };
      }

      const trimmedBlocks = blocks.slice(-MAX_SUBTITLE_BLOCKS);
      const rawCurrentIndex = Number.isInteger(sequenceLike?.currentIndex)
        ? sequenceLike.currentIndex
        : -1;
      const droppedCount = blocks.length - trimmedBlocks.length;
      const adjustedCurrentIndex =
        rawCurrentIndex >= droppedCount
          ? rawCurrentIndex - droppedCount
          : -1;

      const trimmedSequence = {
        blocks: trimmedBlocks,
        currentIndex: adjustedCurrentIndex,
        meta: {
          ...(sequenceLike?.meta || null),
          trimmedBlockCount: droppedCount,
          maxSubtitleBlocks: MAX_SUBTITLE_BLOCKS,
        },
      };

      return trimmedSequence;
    }

    const beforeCount = Array.isArray(state.subtitleBlocks?.blocks)
      ? state.subtitleBlocks.blocks.length
      : Array.isArray(state.subtitleBlocks)
        ? state.subtitleBlocks.length
        : 0;

    const incomingCount = Array.isArray(blocksOrSequence?.blocks)
      ? blocksOrSequence.blocks.length
      : Array.isArray(blocksOrSequence)
        ? blocksOrSequence.length
        : 0;

    let nextSequence;

    if (Array.isArray(blocksOrSequence)) {
      nextSequence = trimSequenceBlocks({
        blocks: blocksOrSequence,
        currentIndex: -1,
        meta: null,
      });
    } else if (blocksOrSequence && typeof blocksOrSequence === "object") {
      nextSequence = trimSequenceBlocks(blocksOrSequence);
    } else {
      nextSequence = {
        blocks: [],
        currentIndex: -1,
        meta: null,
      };
    }

    state.subtitleBlocks = nextSequence;

    const afterCount = Array.isArray(nextSequence?.blocks)
      ? nextSequence.blocks.length
      : 0;
    const sourceTag = options?.sourceTag || "unknown";
    const reason = options?.reason || "";

    if (afterCount > beforeCount || incomingCount !== afterCount) {
      logSubtitleProbe("subtitle blocks set", {
        sourceTag,
        reason,
        beforeCount,
        incomingCount,
        afterCount,
        trimmed: incomingCount > afterCount,
        currentTime: Number.isFinite(state.video?.currentTime)
          ? state.video.currentTime
          : null,
        readyState: state.video?.readyState ?? null,
        paused:
          typeof state.video?.paused === "boolean"
            ? state.video.paused
            : null,
        videoSrc: state.video?.currentSrc || state.video?.src || "",
        primaryTrackLanguage: state.primaryTrack?.language || "",
        primaryTrackMode: state.primaryTrack?.mode || "",
        primaryTrackCuesLength: state.primaryTrack?.cues?.length ?? 0,
        primaryTrackActiveCuesLength:
          state.primaryTrack?.activeCues?.length ?? 0,
        secondaryTrackLanguage: state.secondaryTrack?.language || "",
        secondaryTrackMode: state.secondaryTrack?.mode || "",
        secondaryTrackCuesLength: state.secondaryTrack?.cues?.length ?? 0,
        secondaryTrackActiveCuesLength:
          state.secondaryTrack?.activeCues?.length ?? 0,
      });
    }
  }

  function getSubtitleBlockSequence() {
    if (state.subtitleBlocks && typeof state.subtitleBlocks === "object") {
      return state.subtitleBlocks;
    }
    if (Array.isArray(state.subtitleBlocks)) {
      return {
        blocks: state.subtitleBlocks,
        currentIndex: -1,
        meta: null,
      };
    }
    return {
      blocks: [],
      currentIndex: -1,
      meta: null,
    };
  }

  function getCurrentSubtitleBlockFromSequence() {
    return state.currentSubtitleBlock || null;
  }

  function setCurrentSubtitleBlock(block, meta = null) {
    state.currentSubtitleBlock = block || null;
    state.subtitleBlockMeta = meta || null;
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
    DEBUG_SECONDARY_SUBS,
    secondarySubtitleDom,
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

  root.layoutController = layoutController;

  layoutController.initForPanelOpen(state.panelOpen);

  const { createOverlayController } = root.overlayController;
  const createTextTrackDebug =
    root.textTrackDebug?.createTextTrackDebug || null;
  const createCueSequenceBuilder =
    root.createCueSequenceBuilder || null;
  const createCueRenderCoordinator =
    root.cueRenderCoordinator?.createCueRenderCoordinator || null;
  const createSecondaryTrackRecovery =
    root.secondaryTrackRecovery?.createSecondaryTrackRecovery || null;
  const overlayController = createOverlayController({
    getOverlayRoot: () => state.overlayRoot,
    setOverlayRoot: (rootNode) => {
      state.overlayRoot = rootNode;
    },
    getPanelOpen: () => state.panelOpen,
    getTarget,
    makeClickableSpans,
    showPopup,
    getPlaybackControlsLayoutTargets:
      getPlaybackControlsLayoutTargetsFromModule,
    PLAYBACK_CONTROLS_LAYOUT,
  });

  const { setOverlayVisible, destroyOverlay, createOverlay } =
    overlayController;

  const textTrackDebug = createTextTrackDebug
    ? createTextTrackDebug({
        logContent,
        getVideoElement: () => state.video ?? null,
        getTrackCuesLength: resolverDeps.getTrackCuesLength,
        getTrackActiveCuesLength: resolverDeps.getTrackActiveCuesLength,
      })
    : null;

  const cueSequenceBuilder = createCueSequenceBuilder
    ? createCueSequenceBuilder({
        state,
        logContent,
        DEBUG_SECONDARY_SUBS,
        getCurrentTime: () => state.video?.currentTime ?? 0,
        getCurrentCue,
        cleanCueText: vttDeps.cleanCueText,
        getPrimaryTrackCues: () => state.primaryTrack?.cues || [],
        getSecondaryTrackCues: () => state.secondaryTrack?.cues || [],
        getPreviousSubtitleBlocks: () => getSubtitleBlockSequence() || [],
        buildSubtitleBlockSequence,
        setSubtitleBlocks,
        setCurrentSubtitleBlock,
        getBoundPrimaryTrack: () => state.primaryTrack,
        getBoundSecondaryTrack: () => state.secondaryTrack,
      })
    : null;

  const cueRenderCoordinator = createCueRenderCoordinator
    ? createCueRenderCoordinator({
        getTrackActiveCuesLength: resolverDeps.getTrackActiveCuesLength,
      })
    : null;

  const secondaryTrackRecovery = createSecondaryTrackRecovery
    ? createSecondaryTrackRecovery({
        logContent,
        SECONDARY_RECOVERY_WINDOW_MS: 1000,
        SECONDARY_FORCE_REBIND_MISS_COUNT: 2,
        SECONDARY_RECOVERY_MISS_LIMIT: 8,
        SECONDARY_TERMINATED_RETRY_MS: 10_000,
        SECONDARY_RECOVERY_DEBOUNCE_MS: 200,
      })
    : null;

  const createSubtitleRecoveryManager =
    root.createSubtitleRecoveryManager || null;
  const subtitleRecoveryManager = createSubtitleRecoveryManager
    ? createSubtitleRecoveryManager({
        logContent,
        cooldownMs: 4000,
        secondaryTrackRecovery,
      })
    : null;

  let cueController = null;

  const cueServices = {
    logContent,
    DEBUG_SECONDARY_SUBS,
    DEBUG_MEMORY_PROBE,
    getSecondaryTrackDebugPayload,
    resolveSecondarySubtitleTrack: resolverDeps.resolveSecondarySubtitleTrack,
    getCurrentCueText,
    getTrackCuesLength: resolverDeps.getTrackCuesLength,
    getTrackActiveCuesLength: resolverDeps.getTrackActiveCuesLength,
    getRequestedSecondaryLanguage: () =>
      getResolverRequestedSecondaryLanguage(),
    getPrimaryTrack: () => state.primaryTrack,
    getSecondaryTrack: () => state.secondaryTrack,
    getCurrentCue,
    cleanCueText: vttDeps.cleanCueText,
    getCurrentTime: () => state.video?.currentTime ?? 0,
    getVideoElement: () => state.video ?? null,
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
    renderCurrentSnapshot,
    updateOverlay: (...args) => overlayController.updateOverlay(...args),
    updateOverlayFromView: (view) =>
      overlayController.updateOverlayFromView(view, {
        contentKey: historyStore.getCurrentKey() || "",
      }),
    updateOverlayFromBlock: (block) =>
      overlayController.updateOverlayFromBlock(block, {
        contentKey: historyStore.getCurrentKey() || "",
      }),
    renderPanel,
    matchesRequestedLanguage: resolverDeps.matchesRequestedLanguage,
    isForcedLikeTrack: resolverDeps.isForcedLikeTrack,
    textTrackDebug,
    cueSequenceBuilder,
    cueRenderCoordinator,
    subtitleRecoveryManager,
    createTrackListenerBinding,
  };

  // =============================================================
  // subtitleSyncServices
  //
  // 役割: subtitle-sync-controller.js へ渡す DI object を組み立てる。
  //       primary / secondary の track 解決・bind・native fallback を
  //       roles.primary / roles.secondary の adapter として分離し、
  //       content.js 側は bind 実装の分岐を持たない DI 層に留める。
  //
  // 依存:
  //   - resolverDeps.resolveRequestedSubtitleTrack (primary 選択)
  //   - resolverDeps.resolveSecondarySubtitleTrack (secondary 選択)
  //   - resolverDeps.syncNativeSubtitleSelectionViaMenu (native fallback)
  //   - cueController.bindPrimarySubtitleTrack / bindSecondarySubtitleTrack
  //
  // 設計原則:
  //   - resolveTrack / bindTrack / syncNativeSelection の3点だけを
  //     role ごとに満たせば controller 側が動く。
  //   - bind の実 mode / policy はここでは決めず、
  //     controller から渡された options をそのまま使う。
  // =============================================================
  const subtitleSyncServices = {
    logContent,
    createSyncIntervalOrchestrator:
      window.ATVB?.createSyncIntervalOrchestrator,
    createSubtitleHealthSnapshot:
      window.ATVB?.createSubtitleHealthSnapshot,
    resolver: resolverDeps,

    // -------------------------------------------------------
    // role adapters
    // -------------------------------------------------------
    // primary / secondary それぞれの resolve / bind / native fallback を
    // subtitle-sync-controller 側の role-aware API に合わせて注入する。
    // content.js はここで adapter を渡すだけに留め、bind の実装分岐は持たない。
    roles: {
      primary: {
        // primary track を現在時刻基準で解決する。cue を持つ候補を優先する。
        resolveTrack: (video, requestedLang) =>
          resolverDeps.resolveRequestedSubtitleTrack?.(
            video?.textTracks || [],
            requestedLang,
            Number(video?.currentTime ?? NaN),
          ) || null,

        // primary track を cue-controller 経由で bind し、onCueChange を接続する。
        bindTrack: async (track, options = {}) => {
          return cueController?.bindPrimarySubtitleTrack?.(
            track,
            onCueChange,
            {
              video: state.video || null,
              requestedLang: options?.requestedLang || "",
              reason: options?.reason || "subtitle-sync-controller-primary",
            },
          );
        },

        // native 字幕メニュー経由で primary 言語選択を同期する fallback。
        syncNativeSelection: async ({ requestedLang, reason = "" } = {}) => {
          return await resolverDeps.syncNativeSubtitleSelectionViaMenu?.({
            primaryLang: requestedLang || "",
            secondaryLang: "",
            preferredSource: "",
            reason,
          });
        },
      },

      secondary: {
        // secondary track を専用 resolver で解決する。
        resolveTrack: (video, requestedLang) =>
          resolverDeps.resolveSecondarySubtitleTrack?.(
            video,
            requestedLang,
          ) || null,

        // secondary track を cue-controller 経由で bind する。mode は hidden を基本とする。
        bindTrack: async (track, options = {}) => {
          const modeDecision = {
            requestedMode: options?.requestedMode || "hidden",
            policy: options?.policy || "subtitle-sync-controller",
            rationale: options?.reason || "subtitle-sync-controller-bind",
            reason: options?.reason || "subtitle-sync-controller",
            unreadableSnapshot: options?.unreadableSnapshot || null,
          };

          return cueController?.bindSecondarySubtitleTrack?.(
            track,
            modeDecision,
          );
        },

        // native 字幕メニュー経由で secondary 言語選択を同期する fallback。
        syncNativeSelection: async ({ requestedLang, reason = "" } = {}) => {
          return await resolverDeps.syncNativeSubtitleSelectionViaMenu?.({
            primaryLang: "",
            secondaryLang: requestedLang || "",
            preferredSource: "",
            reason,
          });
        },
      },
    },

    pollIntervalMs: 100,
    activationHoldMs: 500,
    activationTimeoutMs: 1500,
  };

  // subtitleSyncServices（role adapters込み）から controller を生成する。
  // content.js はここで DI するだけで、bind/fallback の実装は controller 側に閉じる。
  const subtitleSyncController = createSubtitleSyncController({
    state,
    services: subtitleSyncServices,
  });

  cueController = createCueController({
    state,
    ...cueServices,
    buildSecondarySyncDecision:
      subtitleSyncController.buildSecondarySyncDecision,
    resolveSecondaryWaitOutcome:
      subtitleSyncController.resolveSecondaryWaitOutcome,
  });

  const cueTrackBinder = createCueTrackBinder
    ? createCueTrackBinder({ cueController })
    : null;

  root.cueTrackBinder = root.cueTrackBinder ?? {};
  if (cueTrackBinder) root.cueTrackBinder.instance = cueTrackBinder;

  function rebuildSubtitleBlocksForPanelOpen(reason = "panel_open") {
    const sequence = getSubtitleBlockSequence();
    const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
    const currentIndex = Number.isInteger(sequence?.currentIndex)
      ? sequence.currentIndex
      : -1;
    const shouldRebuild = blocks.length === 0 || currentIndex < 0;

    logContent("panel open rebuild check", {
      reason,
      blockCount: blocks.length,
      currentIndex,
      shouldRebuild,
    });

    if (!shouldRebuild) return null;

    const rebuildResult =
      cueController?.rebuildCurrentSceneSubtitleBlocks?.() || null;

    logContent("panel open rebuild result", {
      reason,
      rebuildResult,
    });

    return rebuildResult;
  }


let syncIntervalOrchestrator = null;

  panelUi = createPanelUi({
    state,
    getTarget,
    getLiveDebugLogFilter,
    getDebugLogText,
    clearDebugLogs,
    sendToBackground,
    applyLayout,
    persistPanelVisibility,
    logContent,
    renderCurrentSnapshot,
    renderPanel,
    rebuildSubtitleBlocksForPanelOpen,
    destroyOverlay,
    overlayController,
    onPanelClose: () => {
      // ① まず tick を止めて renderCurrentSnapshot が走らないようにする
      syncIntervalOrchestrator?.stop?.();
      // ② その後 overlay を非表示・state リセット
      setOverlayVisible(false);
      overlayController.clearOverlayState?.();
      // ③ cue unbind（secondary monitor cleanup は unbindSecondarySubtitleTrack 経由で一本化）
      cueController.handoffPrimarySubtitleToNative();
      cueController.unbindSecondarySubtitleTrack({ restoreMode: false });
      // ④ interval 停止
      if (secondaryTrackSyncInterval) {
        clearInterval(secondaryTrackSyncInterval);
        secondaryTrackSyncInterval = null;
      }

      logContent("panel closed: extension paused");
    },

    onPanelOpen: () => {
      // 1. オーバーレイを再表示
      setOverlayVisible(true);
      // 2. secondaryTrackSyncInterval を再開
      ensureSecondaryTrackSyncInterval();
      // 3. syncIntervalOrchestrator を再開
      syncIntervalOrchestrator?.start?.();
      // 4. 字幕パイプラインを再初期化
      reinitializeCoordinator.reinitializeSubtitlePipeline("panel-reopen");

      logContent("panel opened: extension resumed");
    },

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
    clearSecondaryTrackState: (...args) =>
      playbackSessionCleanup?.clearSecondaryTrackState?.(...args),
    logContent,
    logContentError,
    logContentSettings,
    getVideoAndDialog,
    teardownForRestart: (...args) =>
      playbackSessionCleanup?.teardownForRestart?.(...args),
    detachForDisabled: (...args) =>
      playbackSessionCleanup?.detachForDisabled?.(...args),
    prepareForRestart: (...args) =>
      playbackSessionCleanup?.prepareForRestart?.(...args),
    startBilingual,
    isPlaybackPageReady,
    getPlaybackContextLogPayload,
    getUniqueTracks: resolverDeps.getUniqueTracks,
    get cueController() { return cueController; },
    renderSecondarySubtitle,
    get syncIntervalOrchestrator() { return syncIntervalOrchestrator; },
    mountToggleOnlyUi: () => panelUi?.watchForPlayerTabs?.(),
    get panelUi() { return panelUi; }, 
  });

  const {
    loadSettingsSnapshot,
    loadSettingsFromSync,
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
    get cueController() { return cueController; },
    services: {
      logContent,
      panelUi,
      getTrackActiveCuesLength: resolverDeps.getTrackActiveCuesLength,
      getCurrentCueText,
      renderSecondarySubtitle,
      requestSnapshotRefresh,
      getCurrentSubtitleView: () => state.currentSubtitleView || null,
      getRequestedSecondaryLang: () =>
        getResolverRequestedSecondaryLanguage(),
    },
  }) ?? null;

  const {
    waitForVideo,
    stopPlaybackControlLayoutObservers,
  } = runtimeObservers;

  const playbackSessionCleanup =
    window.ATVB?.createPlaybackSessionCleanup?.({
      state,
      logContent,
      teardownDeps: {
        stopPlaybackControlLayoutObservers,
        layoutController,
        clearInitialCueRecovery,
        renderSecondarySubtitle,
        overlayController,
        destroyOverlay,
        destroyUiHosts: () => panelUi?.destroyUiHosts?.(),
        destroyFeatureUiHosts: () => panelUi?.destroyFeatureUiHosts?.(),
        applyLayout,
        clearInternalSubtitleState,
        cueController,
        subtitleRecoveryManager,
        runtimeObservers,
      },
    }) ?? null;

  // playback 起動前段の coordination を担当する。
  // 初回 boot だけでなく、playback target 切替時の cleanup → 再 attach → 再 start もここへ寄せる。
  const playbackStartupCoordinator =
    window.ATVB?.createPlaybackStartupCoordinator?.({
      state,
      services: {
        logContent,
        isLanguageSelectionReady,
        getPlaybackContext,
        getPlaybackContextLogPayload,
        getVideoAndDialog,
        getCurrentVideoSrcKey,
        resolvePlaybackContentKey,
        waitForVideo,
        attachTracks,
        startBilingual,
        clearSubtitles: () =>
          clearInternalSubtitleState({ preserveSecondaryDom: false }),
        playbackSessionCleanup,
      },
    }) ?? null;
    

  function persistPanelVisibility() {
    globalThis.ATVB_PANEL_VISIBILITY.persist(state.panelOpen, (msg, data) => {
      logContent(msg, data);
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

  // primary/secondary の既存 bind を解除し、pending な同期タスクも停止してから
  // 新しい track 選択に入るための初期化処理。
  function resetSubtitleTrackBindings() {
    // -------------------------------------------------------
    // bind / pending task reset
    // -------------------------------------------------------

    // [attach: primary/secondary reset] 既存 bind を一度解除してから今回の track 選択に入る。
    // 前回の再生状態を残したまま再初期化しないよう、
    // まず subtitle-sync-controller 側の pending wait / fallback task を停止し、
    // その後 listener bind と state を空にする。
    subtitleSyncController?.cancelAllPendingSyncTasks?.(
      "reset-subtitle-track-bindings",
    );

    cueController.unbindPrimarySubtitleTrack();
    cueController.unbindSecondarySubtitleTrack();
    state.primaryTrack = null;
    state.secondaryTrack = null;
  }

  function attachPrimarySubtitleTrack(video, tracks, primaryLang) {
    let primaryListenerBound = false;

    // [attach: primary] primary は同期的に最良候補を選び、その場で bind する。
    state.primaryTrack = resolverDeps.pickBestSubtitleTrack(
      tracks,
      primaryLang,
    );

    if (state.primaryTrack) {
      primaryListenerBound = cueController.bindPrimarySubtitleTrack(
        state.primaryTrack,
        onCueChange,
        {
          video,
          requestedLang: primaryLang,
          reason: "primary-bind",
        },
      );
    } else {
      cueController.unbindPrimarySubtitleTrack();
      primaryListenerBound = false;
    }

    return {
      primaryListenerBound,
      primaryTrackFound: Boolean(state.primaryTrack),
    };
  }

  async function attachSecondarySubtitleTrack(
    video,
    primaryLang,
    secondaryLang,
    reason = "unknown",
  ) {
    // [attach: secondary] secondary は selection / readability / recovery を
    // subtitle-sync-controller 側 decision に集約し、
    // cue-controller 側 orchestration で action を実行する。
    // ここでは完了を待って、最終的に bind された track を state に反映する。
    if (secondaryLang) {
      await cueController.syncSecondaryTrackOrchestration(
        video,
        secondaryLang,
        renderSecondarySubtitle,
        {
          suppressRender: false,
          forceRebind: false,
        },
      );

      // orchestration 完了後の binder/cue-controller 側の最終結果を確定値として読む。
      state.secondaryTrack = cueController.getBoundSecondaryTrack();
      requestSnapshotRefresh("secondary_sync_completed");
    } else {
      cueController.unbindSecondarySubtitleTrack();
      renderSecondarySubtitle("", null);
      state.secondaryTrack = null;
    }

    // [debug: secondary sync failure] secondary 指定ありなのに bind できなかった場合だけ
    // textTracks 全量を残し、初回起動タイミング問題か resolver 条件問題かを切り分ける。
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
      secondaryListenerBound: Boolean(state.secondaryTrack),
      secondaryTrackFound: Boolean(state.secondaryTrack),
    };
  }

  function serializeTrackSummary(track) {
    if (!track) return null;

    return {
      language: track.language || "",
      label: track.label || "",
      kind: track.kind || "",
      mode: track.mode || "",
    };
  }

  // [binder/cue: attach] primary / secondary track の選択と bind 完了までをまとめて扱う。
  // secondary は非同期同期を含むため、完了を待ってから state へ反映し startBilingual に返す。
  async function selectPrimaryAndSecondaryTracks(
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
        primaryTrack: null,
        secondaryTrack: null,
      };
    }

    state.video = video;

    resetSubtitleTrackBindings();

    const tracks = video.textTracks;

    const { primaryListenerBound } = attachPrimarySubtitleTrack(
      video,
      tracks,
      primaryLang,
    );

    const { secondaryListenerBound } = await attachSecondarySubtitleTrack(
      video,
      primaryLang,
      secondaryLang,
      reason,
    );

    return {
      reason,
      trackCount: tracks.length,
      primaryTrackFound: Boolean(state.primaryTrack),
      secondaryTrackFound: Boolean(state.secondaryTrack),
      primaryListenerBound,
      secondaryListenerBound,
      primaryTrack: serializeTrackSummary(state.primaryTrack),
      secondaryTrack: serializeTrackSummary(state.secondaryTrack),
    };
  }

  // subtitle-state-reset モジュール初期化
  const subtitleStateReset = window.ATVB.createSubtitleStateReset({
    state,
    secondarySubtitleDom,
    logContent,
  });

  // options オブジェクト形式で呼び出し可能。
  // 後方互換のため reason 文字列も受け付けるが、
  // 新規呼び出しは { preserveSecondaryDom: bool } 形式を使うこと。
  //
  // completeReset=true の場合は、トグル OFF / セッション完全撤収向けの
  // 完全リセット経路へ切り替える。
  // subtitle-state-reset.js 側の resetSubtitleStateForToggle() を使い、
  // 古い字幕 block / snapshot / text 参照を次回 session へ持ち越さない。
  function clearInternalSubtitleState(reasonOrOptions = {}) {
    let preserveSecondaryDom = false;
    let resetReason = "clear-internal-subtitle-state";
    let completeReset = false;
    let toggleOpId = null;

    if (typeof reasonOrOptions === "string") {
      preserveSecondaryDom =
        reasonOrOptions === "prepareForRestart" ||
        reasonOrOptions === "panelToggle";
      resetReason = reasonOrOptions || resetReason;
    } else {
      preserveSecondaryDom =
        typeof reasonOrOptions.preserveSecondaryDom === "boolean"
          ? reasonOrOptions.preserveSecondaryDom
          : false;
      resetReason =
        typeof reasonOrOptions.reason === "string" && reasonOrOptions.reason
          ? reasonOrOptions.reason
          : resetReason;
      completeReset = reasonOrOptions.completeReset === true;
      toggleOpId =
        typeof reasonOrOptions.toggleOpId === "string" &&
        reasonOrOptions.toggleOpId
          ? reasonOrOptions.toggleOpId
          : null;
    }

    subtitleRecoveryManager?.reset?.(resetReason);

    if (completeReset) {
      subtitleStateReset.resetSubtitleStateForToggle({
        preserveSecondaryDom,
        reason: resetReason,
        toggleOpId,
      });
      return;
    }

    subtitleStateReset.clearSubtitleState({
      preserveSecondaryDom,
    });
  }


  function _refreshSettingsOnPanelOpen() {
    if (!state.panelOpen) return;

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
    if (false) {
      logContentSubtitle(
        "secondary resolver snapshot",
        buildSecondaryResolverSnapshot("onCueChange"),
      );
    }
  }

  // resolver / secondary track sync / native menu sync に渡す副言語を一箇所で決める。
  // requestedSecondaryLang を優先し、無ければ effective settings 側の secondaryLang を使う。
  function getResolverRequestedSecondaryLanguage() {
    return (
      state.requestedSecondaryLang ||
      state.contentSettings.secondaryLang ||
      ""
    );
  }

  function buildSecondaryResolverSnapshot(reason = "") {
    const requestedLang = getResolverRequestedSecondaryLanguage();

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

  function requestSnapshotRefresh(reason = "") {
    logContentSubtitle("snapshot refresh requested", {
      contentKey: historyStore.getCurrentKey() || "",
      reason: String(reason || ""),
      currentTime: Number(state.video?.currentTime ?? 0),
      hasPrimaryTrack: Boolean(state.primaryTrack),
      hasSecondaryTrack: Boolean(state.secondaryTrack),
    });

    renderCurrentSnapshot();
    renderPanel();
  }

  // [binder/cue: recovery] initial snapshot apply
  // 起動直後に取得済み cue を即時適用し、current block 未確定時は failure ではなく waiting 状態として扱う。
  function renderCurrentSnapshot() {
    if (syncIntervalOrchestrator?.isPaused?.()) return;

    const sequence = getSubtitleBlockSequence();
    const blocks = Array.isArray(sequence?.blocks) ? sequence.blocks : [];
    const currentIndex = Number.isInteger(sequence?.currentIndex)
      ? sequence.currentIndex
      : -1;
    const meta = sequence?.meta || null;

    const subtitleViewResolver = window.ATVB?.subtitleViewResolver || null;

    const currentBlockFromSequence =
      currentIndex >= 0 && currentIndex < blocks.length
        ? blocks[currentIndex] || null
        : null;

    if (false) {
      logContentSubtitle("current subtitle view snapshot input", {
        contentKey: historyStore.getCurrentKey() || "",
        totalBlockCount: blocks.length,
        currentIndex,
        sequenceMeta: meta || null,
        currentBlockFromSequence: currentBlockFromSequence
          ? {
              key: currentBlockFromSequence.key || "",
              startTime: Number(currentBlockFromSequence.startTime ?? 0),
              endTime: Number(currentBlockFromSequence.endTime ?? 0),
              state: currentBlockFromSequence.state || "",
              primaryText: String(currentBlockFromSequence.primaryText || ""),
              secondaryText: String(currentBlockFromSequence.secondaryText || ""),
              hasPrimarySignal: Boolean(currentBlockFromSequence.hasPrimarySignal),
              hasSecondarySignal: Boolean(currentBlockFromSequence.hasSecondarySignal),
            }
          : null,
        holdBlockCandidate:
          state.nearbyRebuildHoldView?.currentBlock ||
          state.currentSubtitleView?.currentBlock ||
          state.currentSubtitleBlock ||
          null,
        blocksPreview: blocks
          .slice(
            Math.max(0, currentIndex - 2),
            currentIndex >= 0 ? currentIndex + 3 : Math.min(blocks.length, 5),
          )
          .map((block) => ({
            key: block?.key || "",
            startTime: Number(block?.startTime ?? 0),
            endTime: Number(block?.endTime ?? 0),
            state: block?.state || "",
            primaryText: String(block?.primaryText || ""),
            secondaryText: String(block?.secondaryText || ""),
            hasPrimarySignal: Boolean(block?.hasPrimarySignal),
            hasSecondarySignal: Boolean(block?.hasSecondarySignal),
          })),
      });
    }

    const view =
      subtitleViewResolver &&
      typeof subtitleViewResolver.resolveUiSubtitleView === "function"
      ? subtitleViewResolver.resolveUiSubtitleView(blocks, currentIndex, {
          ...(meta || {}),
          DEBUG_PANEL_PROBE,
          now: state.video?.currentTime ?? 0,
          currentTime: state.video?.currentTime ?? 0,
          contentKey: historyStore.getCurrentKey() || "",
          holdView: state.nearbyRebuildHoldView || null,
          holdBlock:
            state.nearbyRebuildHoldView?.currentBlock ||
            state.currentSubtitleView?.currentBlock ||
            state.currentSubtitleBlock ||
            null,
          holdBlockTotalBlockCount: Array.isArray(
            state.nearbyRebuildHoldView?.blocks,
          )
            ? state.nearbyRebuildHoldView.blocks.length
            : Array.isArray(blocks)
            ? blocks.length
            : 0,
        })
        : {
            primary: "",
            secondary: "",
            isVisible: false,
            currentBlock: null,
            meta: {
              ...(meta || {}),
              viewStatus: "waiting",
              waitingReason: blocks.length === 0
                ? "empty_sequence"
                : "waiting_for_current_cue",
              totalBlockCount: blocks.length,
              currentIndex: Number.isInteger(currentIndex) ? currentIndex : null,
            },
          };

    const primaryText = String(view?.primary || "");
    const secondaryText = String(view?.secondary || "");
    const viewMeta =
      view?.meta && typeof view.meta === "object" ? view.meta : null;
    const viewStatus = String(viewMeta?.viewStatus || "");
    const waitingReason = String(viewMeta?.waitingReason || "");

    state.subtitleViewPrimary = primaryText;
    state.subtitleViewSecondary = secondaryText;
    state.currentSubtitleView = view || null;

    // panel / overlay 以外の observer でも参照できるよう、view meta の状態を state に残す。
    state.currentSubtitleViewStatus = viewStatus;
    state.currentSubtitleViewWaitingReason = waitingReason;

    // panel 側が別名 state を見ていても値が渡るように同期しておく
    state.currentPrimaryText = primaryText;
    state.currentSecondaryText = secondaryText;
    state.lastPrimaryText = primaryText;
    state.lastSecondaryText = secondaryText;

    // 空 view は異常ではなく「まだ現在位置の cue が来ていない待機状態」。
    // 起動直後の観測で waiting / ready を見分けやすいよう snapshot ログを残す。
    if (false) {
      logContentSubtitle("current subtitle view snapshot", {
        contentKey: historyStore.getCurrentKey() || "",
        totalBlockCount: blocks.length,
        currentIndex,
        subtitleViewPrimary: primaryText,
        subtitleViewSecondary: secondaryText,
        isVisible: Boolean(view?.isVisible),
        hasCurrentBlock: Boolean(view?.currentBlock),
        viewStatus,
        waitingReason,
      });
    }

    overlayController.updateOverlayFromView?.(view, {
      contentKey: historyStore.getCurrentKey() || "",
    });

    if (!syncIntervalOrchestrator?.isPaused?.()) {
      overlayController.updateOverlayFromView?.(view, {
        contentKey: historyStore.getCurrentKey() || "",
      });
    }
    renderPanel();
  }

  // [startup path: initial bilingual start]
  // 設定完了時の通常起動入口。
  // 未設定時は notice 表示と panel close のみを行い、通常の track attach / UI build は進めない。
  // track 選択・panelOpen 復元・UI 構築をこの経路でまとめて行う。
  async function startBilingual(options = {}) {
    // 拡張 OFF 中は再生画面の UI 構築を進めない
    if (state.contentSettings?.extensionEnabled === false) {
      logContent("startBilingual skipped: disabled");
      return;
    }

    // 起動時点の panelOpen / panelDefaultOpen / keepPanelOpen をログへ残す
    // 起動時点の panelOpen / panelDefaultOpen / keepPanelOpen をログへ残す
    logContent("startBilingual trace", {
      panelOpen: state.panelOpen,
      keepPanelOpen:
        typeof options.keepPanelOpen === "boolean"
          ? options.keepPanelOpen
          : null,
      requestedContentSettings: {
        primaryLang: state.requestedContentSettings?.primaryLang || "",
        secondaryLang: state.requestedContentSettings?.secondaryLang || "",
        panelDefaultOpen:
          state.requestedContentSettings?.panelDefaultOpen ?? null,
      },
      contentSettings: {
        primaryLang: state.contentSettings?.primaryLang || "",
        secondaryLang: state.contentSettings?.secondaryLang || "",
        panelDefaultOpen: state.contentSettings?.panelDefaultOpen ?? null,
      },
      requestedSecondaryLang: state.requestedSecondaryLang || "",
      currentTime: Number.isFinite(state.video?.currentTime)
        ? state.video.currentTime
        : null,
      readyState: state.video?.readyState ?? null,
      paused:
        typeof state.video?.paused === "boolean" ? state.video.paused : null,
      videoSrc: state.video?.currentSrc || state.video?.src || "",
      textTrackCount: state.video?.textTracks?.length ?? 0,
    });

    state.bilingualSessionSeq += 1;
    state.activeBilingualSessionId = state.bilingualSessionSeq;

    logMemoryProbe("startBilingual session-start", {
      sessionId: state.activeBilingualSessionId,
      reason: options.reason || "",
      currentTime: Number.isFinite(state.video?.currentTime)
        ? state.video.currentTime
        : null,
      videoSrc: state.video?.currentSrc || state.video?.src || "",
      textTrackCount: state.video?.textTracks?.length ?? 0,
    });


    // console.trace("startBilingual trace");

    // video が無ければここでは初期化できない
    if (!state.video) return;

    const requestedSettings = state.requestedContentSettings || {};

    // 言語設定が未完了なら panelOpen=false に寄せて UI を閉じる
    if (!isLanguageSelectionReady(requestedSettings)) {
      state.panelOpen = false;
      panelUi.destroyUiHosts();
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

    // 言語設定が揃っていれば setup notice は閉じる
    hideLanguageSetupNotice();

    // 再生画面がまだ未準備なら後続 build を進めない
    if (!isPlaybackPageReady()) {
      logContent("startBilingual skipped: playback not ready", {
        ...getPlaybackContextLogPayload(),
      });
      return;
    }

    // 今回の言語入力値を resolver 前の状態としてログへ残す
    logContentSubtitle("startBilingual language inputs", {
      requestedContentSettings: {
        primaryLang: requestedSettings.primaryLang || "",
        secondaryLang: requestedSettings.secondaryLang || "",
        panelDefaultOpen: requestedSettings.panelDefaultOpen ?? null,
      },
      contentSettings: {
        primaryLang: state.contentSettings.primaryLang || "",
        secondaryLang: state.contentSettings.secondaryLang || "",
        panelDefaultOpen: state.contentSettings.panelDefaultOpen ?? null,
      },
      requestedSecondaryLang: state.requestedSecondaryLang || "",
    });

    // 履歴側の contentKey を現在の playback に合わせる
    syncHistoryContextWithPlayback("startBilingual");

    // resolver 前の textTracks 生状態をログする
    try {
      const rawTracks = Array.from(state.video?.textTracks || []);

      const normalizedTracks = rawTracks.map((t, i) => {
        const cuesLength = (() => {
          try {
            return t?.cues ? t.cues.length : 0;
          } catch (_) {
            return 0;
          }
        })();

        const activeCuesLength = (() => {
          try {
            return t?.activeCues ? t.activeCues.length : 0;
          } catch (_) {
            return 0;
          }
        })();

        return {
          index: i,
          language: t?.language || "",
          label: t?.label || "",
          kind: t?.kind || "",
          mode: t?.mode || "",
          cuesLength,
          activeCuesLength,
        };
      });

      const groupMap = new Map();
      for (const track of normalizedTracks) {
        const key = [
          track.language,
          track.label,
          track.kind,
          track.mode,
          track.cuesLength > 0 ? "hasCues" : "noCues",
        ].join(" | ");

        const prev = groupMap.get(key) || {
          language: track.language,
          label: track.label,
          kind: track.kind,
          mode: track.mode,
          cueState: track.cuesLength > 0 ? "hasCues" : "noCues",
          count: 0,
        };

        prev.count += 1;
        groupMap.set(key, prev);
      }

    } catch (error) {
      logContentError("textTracks snapshot logging failed", {
        reason: "startBilingual",
        error: String(error),
      });
    }

    const resolverRequestedSecondaryLanguage =
      getResolverRequestedSecondaryLanguage();

    // 先に Apple TV 側のネイティブ字幕選択を同期する
    await window.ATVB?.resolver?.syncNativeSubtitleSelectionViaMenu?.({
      primaryLang: state.contentSettings.primaryLang || "",
      secondaryLang: resolverRequestedSecondaryLanguage,
      preferredSource:
        resolverRequestedSecondaryLanguage ||
        state.contentSettings.primaryLang ||
        "",
    });

    // その後で primary / secondary track を確定する
    await selectPrimaryAndSecondaryTracks(
      state.video,
      state.contentSettings.primaryLang,
      state.contentSettings.secondaryLang,
      "startBilingual",
    );

    // resolver 結果をログへ残す
    if (false) {
      logContentSubtitle(
        "secondary resolver snapshot",
        buildSecondaryResolverSnapshot("startBilingual"),
      );
    }

    // 選択できた track の詳細を確認用に残す
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

    // panelDefaultOpen は通常起動時の panelOpen 初期値としてだけ使う
    const panelDefaultOpenSetting = state.contentSettings.panelDefaultOpen !== false;

    // panelOpen を確定してから UI をまとめて build する
    function _applyPanelVisibleAndBuild(panelOpen) {
      state.panelOpen = panelOpen;
      logContent("字幕パネル開閉ボタン/右側字幕パネル build start", {
        panelOpen,
        extensionEnabled: state.contentSettings?.extensionEnabled,
      });

      // 確定した panelOpen をログへ残す
      logContent("startBilingual panelOpen applied", {
        panelOpen: state.panelOpen,
        panelDefaultOpenSetting: state.contentSettings.panelDefaultOpen,
        secondaryLang: state.contentSettings.secondaryLang || "",
        requestedSecondaryLang: state.requestedSecondaryLang || "",
      });

      // panelOpen に合わせて layout controller を初期化する
      layoutController.initForPanelOpen(state.panelOpen);
      logContent("字幕パネル開閉ボタン/右側字幕パネル build done", {
        panelOpen: state.panelOpen,
        hasSubtitlePanelToggleButton: Boolean(document.body.querySelector("#atv-toggle-btn")),
        hasPanelHost: Boolean(document.querySelector("#atv-panel-host")),
      });

      // 再生画面で使う UI を順番に build する
      logPanelProbe("startBilingual ui build step", {
        step: "before_createOverlay",
        panelOpen: state.panelOpen,
      });
      createOverlay();

      logPanelProbe("startBilingual ui build step", {
        step: "before_createToggleButton",
        panelOpen: state.panelOpen,
      });
      panelUi.createToggleButton();

      logPanelProbe("startBilingual ui build step", {
        step: "after_createToggleButton",
        hasToggleButton: Boolean(document.body.querySelector("#atv-toggle-btn")),
      });
      panelUi.createRightPanel();

      logPanelProbe("startBilingual ui build step", {
        step: "after_createRightPanel",
        hasPanelHost: Boolean(document.querySelector("#atv-panel-host")),
      });
      panelUi.watchForPlayerTabs();

      logPanelProbe("startBilingual ui build step", {
        step: "after_watchForPlayerTabs",
        hasNativeToggle: Boolean(document.getElementById("atvb-native-toggle")),
      });
      createPopupHost();
      createDebugPanel();

      // build 後に panelOpen を各 UI へ反映する
      logPanelProbe("startBilingual ui build step", {
        step: "before_applyPanelVisibility",
        panelOpen: state.panelOpen,
      });
      applyLayout(state.panelOpen);
      renderCurrentSnapshot();
      renderPanel();
      panelUi.applyPanelVisibility(state.panelOpen);

      logPanelProbe("startBilingual ui build step", {
        step: "after_applyPanelVisibility",
        hasToggleButton: Boolean(document.body.querySelector("#atv-toggle-btn")),
        hasPanelHost: Boolean(document.querySelector("#atv-panel-host")),
      });
    }

    // restart 時は keepPanelOpen を優先する
    if (typeof options.keepPanelOpen === "boolean") {
      _applyPanelVisibleAndBuild(options.keepPanelOpen);
    } else {
      // 通常起動時だけ panelDefaultOpen を初期値として local の保存値を復元する
      globalThis.ATVB_PANEL_VISIBILITY.load(panelDefaultOpenSetting).then((restored) => {
        _applyPanelVisibleAndBuild(restored);
      });
    }

    // secondary track があれば初回表示を出す
    if (state.secondaryTrack) {
      renderSecondarySubtitle(
        getCurrentCueText(state.secondaryTrack),
        state.secondaryTrack,
      );
    }

    // 起動直後の secondary-only 許容時間をセットする
    state.allowSecondaryOnlyUntil = Date.now() + 3000;

    // パネル内の描画状態を ready として反映する
    panelUi.applyPanelState("startBilingual_ready");

    // attach 直後の補助処理を起動する
    initialCueRecovery?.schedule?.("attach");
    scheduleControlSettlingBurst("startBilingual");

    // 起動完了ログを残す
    logContentSubtitle("startBilingual ready", {
      injectedInto: state.dialogEl ? "dialog.playback-view" : "document.body",
      contentKey: historyStore.getCurrentKey(),
      primaryLang: state.contentSettings.primaryLang,
      secondaryLang: state.contentSettings.secondaryLang,
      requestedSecondaryLang: state.requestedSecondaryLang || "",
      primaryTrackFound: !!state.primaryTrack,
      secondaryTrackFound: !!state.secondaryTrack,
      secondaryTrackLanguage: state.secondaryTrack?.language || "",
      secondaryTrackLabel: state.secondaryTrack?.label || "",
      ejdictLoaded: !!state.ejdictMap,
    });

    // secondary track の同期監視を有効化する
    ensureSecondaryTrackSyncInterval();
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
    panelUi?.watchForPlayerTabs?.();
    loadSettingsFromSync();
  }

  playbackSessionCleanup?.ensureCloseClickListener?.();
  playbackStartupCoordinator?.boot?.();
})();
