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
  const DEFAULT_SETTINGS = {
    enabled: false,
    primaryLang: "en",
    secondaryLang: "",
    showSidebar: true,
    playWordAudio: true,
    enableAiTooltip: false,
    preferredAiProvider: "auto",
  };

  const DEBUG_SECONDARY_SUBS = true;
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
  const SECONDARY_SUBTITLE_IDLE_CLEAR_MS = 3200;
  const PANEL_PRIMARY_GRACE_MS = 600;
  const SUBTITLE_HISTORY_MAX_PER_CONTENT = 500;
  const PANEL_SLOT_LAYER_STYLE_ID = "atv-panel-slot-layer-style";

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
    panelVisible: false,
    ejdictMap: null,
    secondaryHideTimer: null,
    overlayRoot: null,
    panelShadowRoot: null,
    popupShadowRoot: null,
    debugPanelRoot: null,
    popupDocClickHandler: null,
    playbackCloseClickHandler: null,
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
    // Native subtitle menu sync: 最後に "成功して適用できた" 言語だけを記録する。
    // secondaryLang が同じでも前回失敗していれば再同期させるため、
    // "要求した言語" ではなく "成功した言語" を保持する点に注意。
    lastNativeSubtitleSyncLang: "",
    lastNativeSubtitleSyncOk: false,
    allowSecondaryOnlyUntil: 0,
  };

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
      logContentApi("EJDict loaded", {
        entries: Object.keys(state.ejdictMap).length,
        url,
      });
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

  async function syncSecondarySubtitleTrack(
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

    await subtitleSyncController.syncSecondarySubtitleTrack(
      video,
      requestedLang,
      {
        primaryLang: state.contentSettings.primaryLang || "",
        renderSecondarySubtitle,
      },
    );

    state.secondaryTrack = cueController.getBoundSecondaryTrack();
  }

  function ensureSecondaryTrackSyncInterval() {
    if (secondaryTrackSyncInterval) return;

    secondaryTrackSyncInterval = window.setInterval(() => {
      if (state.restarting) return;
      if (syncIntervalOrchestrator?.isPaused?.()) return;

      const found = getVideoAndDialog();
      const nextVideo = found?.video || state.video;
      const nextVideoSrcKey = getCurrentVideoSrcKey(nextVideo);
      const hasCurrentSrcChanged =
        Boolean(nextVideoSrcKey) &&
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
        reinitializeCoordinator?.reloadSettingsAndReinitialize?.("video_changed");
      } else if (found && state.video) {
        const switched = syncHistoryContextWithPlayback("content_key_changed");
        if (switched) {
          requestSnapshotRefresh("content_key_changed");
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
        requestSnapshotRefresh("sync_interval_large_seek_resync");
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
      const recoveryResult = reinitializeCoordinator?.reinitializeSubtitlePipeline?.(
        "sync_interval_primary_recovery",
      );
      if (recoveryResult) {
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
      }
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


  function _showRightPanel() {
    if (!state.panelVisible) {
      panelUi.togglePanel(true);
      return;
    }
    applyLayout(true);
    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost =
      getTarget().querySelector("#atv-overlay-host") ??
      document.querySelector("#atv-overlay-host");
    if (panelHost) panelHost.style.display = "";
    if (overlayHost) {
      overlayHost.style.width = "70%";
      overlayHost.style.display = ""; 
    }
  }

  function _hideRightPanel() {
    if (state.panelVisible) {
      panelUi.togglePanel(false);
      return;
    }
    applyLayout(false);
    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost =
      getTarget().querySelector("#atv-overlay-host") ??
      document.querySelector("#atv-overlay-host");
    if (panelHost) panelHost.style.display = "none";
    if (overlayHost) {
      overlayHost.style.width = "100%";
    }
  }

  function _pinRightPanel() {}

  function _unpinRightPanel() {}

  function _applySettingsToUI(settings, options = {}) {
    const shouldSyncPanelVisibility = options.syncPanelVisibility !== false;

    if (shouldSyncPanelVisibility) {
      const sidebarEnabled = settings.showSidebar !== false;
      // state.panelVisible はランタイムUI状態のため、設定変更で上書きしない。
      // showSidebar（設定値）に基づきパネルホストの表示/非表示だけを UI に反映する。
      panelUi.applyPanelVisibility(sidebarEnabled);
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
    const el = root.querySelector(`#${id}`) ?? document.body.querySelector(`#${id}`);
    if (el) el.remove();
  }

  function destroyFeatureUiHosts() {
    // 字幕パネル開閉ボタンを含むすべての拡張 UI を破棄する。
    window.ATVB?.debugPanel?.unmount?.();
    removeHost("atv-panel-host");
    removeHost("atv-popup-host");
    removeHost("atv-toggle-btn");
    destroyOverlay();
    state.panelShadowRoot = null;
    state.popupShadowRoot = null;
    state.debugPanelRoot = null;
  }

  function destroyUiHosts() {
    // restart 時は UI を一度全破棄し、buildUi で再生成する。
    destroyFeatureUiHosts();
    // atv-toggle-btn は destroyFeatureUiHosts で処理済みのため個別削除不要。
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
      await window.ATVB?.debugPanel?.update?.();
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

  function setSubtitleBlocks(blocksOrSequence) {
    if (Array.isArray(blocksOrSequence)) {
      state.subtitleBlocks = {
        blocks: blocksOrSequence,
        currentIndex: -1,
        meta: null,
      };
      return;
    }

    if (blocksOrSequence && typeof blocksOrSequence === "object") {
      state.subtitleBlocks = {
        blocks: Array.isArray(blocksOrSequence.blocks)
          ? blocksOrSequence.blocks
          : [],
        currentIndex: Number.isInteger(blocksOrSequence.currentIndex)
          ? blocksOrSequence.currentIndex
          : -1,
        meta: blocksOrSequence.meta || null,
      };
      return;
    }

    state.subtitleBlocks = {
      blocks: [],
      currentIndex: -1,
      meta: null,
    };
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

  layoutController.initForPanelVisible(state.panelVisible);

  const { createOverlayController } = root.overlayController;
  const createTextTrackDebug =
    root.textTrackDebug?.createTextTrackDebug || null;
  const createCueSequenceBuilder =
    root.cueSequenceBuilder?.createCueSequenceBuilder || null;
  const createCueRenderCoordinator =
    root.cueRenderCoordinator?.createCueRenderCoordinator || null;
  const createSecondaryTrackRecovery =
    root.secondaryTrackRecovery?.createSecondaryTrackRecovery || null;
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
  });

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
    secondaryTrackRecovery,
  });

  const cueTrackBinder = createCueTrackBinder
    ? createCueTrackBinder({ cueController })
    : null;

  root.cueTrackBinder = root.cueTrackBinder ?? {};
  if (cueTrackBinder) root.cueTrackBinder.instance = cueTrackBinder;

  const subtitleSyncController = createSubtitleSyncController({
    services: {
      logContent,
      createSyncIntervalOrchestrator:
        window.ATVB?.createSyncIntervalOrchestrator,
      resolver: resolverDeps,
      bindSecondaryTrack: (track, options = {}) => {
        const modeDecision = {
          requestedMode: options?.requestedMode || "hidden",
          policy: options?.policy || "subtitle-sync-controller",
          rationale: options?.reason || "subtitle_sync_controller_bind",
          reason: options?.reason || "subtitle-sync-controller",
          unreadableSnapshot: options?.unreadableSnapshot || null,
        };

        cueController.bindSecondarySubtitleTrack(track, modeDecision);
      },
      syncNativeSubtitleSelection: async ({
        primaryLang = "",
        secondaryLang = "",
        preferredSource = "",
      } = {}) => {
        return await resolverDeps.syncNativeSubtitleSelectionViaMenu?.({
          primaryLang,
          secondaryLang,
          preferredSource,
        });
      },
      pollIntervalMs: 100,
      activationHoldMs: 500,
      activationTimeoutMs: 1500,
    },
  });

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
    onPanelClose: () => {
      // ① まず tick を止めて renderCurrentSnapshot が走らないようにする
      syncIntervalOrchestrator?.stop?.();
      // ② その後 overlay を非表示・state リセット
      setOverlayVisible(false);
      overlayController.clearOverlayState?.();
      // ③ cue unbind
      cueController.handoffPrimarySubtitleToNative();
      cueController.unbindSecondarySubtitleTrack(); 
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
    cueController,
    renderSecondarySubtitle,
    get syncIntervalOrchestrator() { return syncIntervalOrchestrator; },
    mountToggleOnlyUi: () => panelUi?.watchForPlayerTabs?.(),
    get panelUi() { return panelUi; }, 
  });

  const {
    loadSettingsSnapshot,
    loadSettingsFromSync,
    restartBilingual: _restartBilingual,
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
      requestSnapshotRefresh,
      getCurrentSubtitleView: () => state.currentSubtitleView || null,
      getRequestedSecondaryLang: () =>
        state.requestedSecondaryLang || state.contentSettings.secondaryLang,
    },
  }) ?? null;

const getMergedSubtitleHealthSnapshot = () =>
  cueController?.getMergedSubtitleHealth?.() ?? null;

const syncSecondarySubtitleTrackBinding = (...args) =>
  cueController?.syncSecondarySubtitleTrack?.(...args);


  function _ensureSyncIntervalOrchestrator() {
    if (syncIntervalOrchestrator) return syncIntervalOrchestrator;

    syncIntervalOrchestrator =
      subtitleSyncController?.ensureSyncIntervalOrchestrator?.({
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
          clearPlaybackSessionUiState: (reason) =>
            playbackSessionCleanup?.clearPlaybackSessionUiState?.(reason),
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
    refreshPlaybackControlResizeObserverTargets: _refreshPlaybackControlResizeObserverTargets,
    startPlaybackControlLayoutObservers: _startPlaybackControlLayoutObservers,
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
        destroyUiHosts,
        destroyFeatureUiHosts,
        applyLayout,
        clearInternalSubtitleState,
        cueController,
        runtimeObservers,
      },
    }) ?? null;

  const playbackStartupCoordinator =
    window.ATVB?.createPlaybackStartupCoordinator?.({
      state,
      services: {
        logContent,
        isLanguageSelectionReady,
        getVideoAndDialog,
        waitForVideo,
        attachTracks,
        startBilingual,
        clearSubtitles: () =>
        clearInternalSubtitleState({ preserveSecondaryDom: false }),
      },
    }) ?? null;
    
  function _loadPanelVisibility() {
    const showSidebar = state.contentSettings?.showSidebar;
    return globalThis.ATVB_PANEL_VISIBILITY.load(showSidebar !== false);
  }

  function persistPanelVisibility() {
    globalThis.ATVB_PANEL_VISIBILITY.persist(state.panelVisible, (msg, data) => {
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
      };
    }

    state.video = video;

    // [attach: primary/secondary reset] 既存 bind を一度解除してから今回の track 選択に入る。
    // 前回の再生状態を残したまま再初期化しないよう、state と listener を先に空にする。
    cueController.unbindPrimarySubtitleTrack();
    cueController.unbindSecondarySubtitleTrack();
    state.primaryTrack = null;
    state.secondaryTrack = null;

    const tracks = video.textTracks;
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

    // [attach: secondary] secondary は showing warmup / native fallback を含むため非同期。
    // ここで await して bind 完了後の実トラックを state に反映する。
    if (secondaryLang) {
      await subtitleSyncController.syncSecondarySubtitleTrack(
        video,
        secondaryLang,
        {
          primaryLang,
          renderSecondarySubtitle,
        },
      );

      // sync helper が最終的に bind したトラックをここで確定値として読む。
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

  // subtitle-state-reset モジュール初期化
  const subtitleStateReset = window.ATVB.createSubtitleStateReset({
    state,
    secondarySubtitleDom,
    logContent,
  });

  // options オブジェクト形式で呼び出し可能。
  // 後方互換のため reason 文字列も受け付けるが、
  // 新規呼び出しは { preserveSecondaryDom: bool } 形式を使うこと。
  function clearInternalSubtitleState(reasonOrOptions = {}) {
    let preserveSecondaryDom = false;

    // 後方互換: 文字列で呼ばれた場合
    if (typeof reasonOrOptions === "string") {
      preserveSecondaryDom =
        reasonOrOptions === "prepareForRestart" ||
        reasonOrOptions === "panelToggle";
    } else {
      preserveSecondaryDom =
        typeof reasonOrOptions.preserveSecondaryDom === "boolean"
          ? reasonOrOptions.preserveSecondaryDom
          : false;
    }

    subtitleStateReset.clearSubtitleState({ preserveSecondaryDom });
  }


  function _refreshSettingsOnPanelOpen() {
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

    const view =
      subtitleViewResolver &&
      typeof subtitleViewResolver.resolveUiSubtitleView === "function"
      ? subtitleViewResolver.resolveUiSubtitleView(blocks, currentIndex, {
          ...(meta || {}),
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
  // track 選択・panelVisible 復元・UI 構築をこの経路でまとめて行う。
  async function startBilingual(options = {}) {
    if (state.contentSettings?.enabled === false) {
      logContent("startBilingual skipped: disabled");
      return;
    }
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
    // eslint-disable-next-line no-console
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

    await window.ATVB?.resolver?.syncNativeSubtitleSelectionViaMenu?.({
      primaryLang: state.contentSettings.primaryLang || "",
      secondaryLang: state.contentSettings.secondaryLang || "",
      preferredSource:
        state.contentSettings.secondaryLang ||
        state.contentSettings.primaryLang ||
        "",
    });

    // secondary の同期完了を待ってから ready フェーズへ進む。
    // 初回自動起動で secondary 未確定のまま UI 初期化が完了するのを防ぐ。
    await selectPrimaryAndSecondaryTracks(
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

    // panelVisible が確定してから UI 構築を実行するヘルパー。
    function _applyPanelVisibleAndBuild(panelVisible) {
      state.panelVisible = panelVisible;

      logContent("startBilingual panelVisible applied", {
        panelVisible: state.panelVisible,
        showSidebarSetting: state.contentSettings.showSidebar,
        secondaryLang: state.contentSettings.secondaryLang || "",
        requestedSecondaryLang: state.requestedSecondaryLang || "",
      });

      layoutController.initForPanelVisible(state.panelVisible);

      createOverlay();
      panelUi.createToggleButton();
      panelUi.createRightPanel();
      panelUi.watchForPlayerTabs();
      createPopupHost();
      createDebugPanel();
      applyLayout(state.panelVisible);
      renderCurrentSnapshot();
      renderPanel();

      panelUi.applyPanelVisibility(state.panelVisible);
    }

    if (typeof options.keepPanelVisible === "boolean") {
      // 再初期化パスなど keepPanelVisible が明示的に渡された場合はそれを使う。
      _applyPanelVisibleAndBuild(options.keepPanelVisible);
    } else {
      // 通常起動: chrome.storage.local の panelVisible を復元してから UI を構築する。
      globalThis.ATVB_PANEL_VISIBILITY.load(sidebarEnabledSetting).then((restored) => {
        _applyPanelVisibleAndBuild(restored);
      });
    }

    if (state.secondaryTrack) {
      renderSecondarySubtitle(
        getCurrentCueText(state.secondaryTrack),
        state.secondaryTrack,
      );
    }

    state.allowSecondaryOnlyUntil = Date.now() + 3000;
    panelUi.applyPanelState("startBilingual_ready");

    initialCueRecovery?.schedule?.("attach");
    scheduleControlSettlingBurst("startBilingual");

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
    ensureSecondaryTrackSyncInterval(); 
  }

  let lastObservedUrl = location.href;

  function handlePotentialNavigationChange(reason = "unknown") {
    if (location.href === lastObservedUrl) return;
    lastObservedUrl = location.href;

    logContent("navigation changed", {
      reason,
      url: location.href,
    });

    playbackSessionCleanup?.clearPlaybackSessionUiState?.(
      "reinitialize_before_attach_tracks",
    );

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

    playbackSessionCleanup?.handleNavigationTargetMissing?.({
      reason,
      url: location.href,
      playbackContext: getPlaybackContextLogPayload(),
    });
  }

  const navigationObserver = new MutationObserver(() => {
    handlePotentialNavigationChange("mutation_observer");
  });

  navigationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

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
