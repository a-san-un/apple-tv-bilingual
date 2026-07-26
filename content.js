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

  // logger API の logContent へ橋渡しする。
  // 既存の logContent(message, payload) 互換を維持しつつ contentKey を付与する。
  function logContent(...args) {
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

  // logger の更新通知を Debug パネル更新へ接続する。
  function registerDebugLogUpdateCallback() {
    window.ATVB?.logger?.setOnLogUpdated?.(() => {
      updateLiveDebugPanel();
    });
  }

// =====================================================================
// Section 2: Playback Context Bridge
// Role:
// - playback DOM / textTrack 状態から context を検出
// - contentKey / history context の切替
// Keep in content.js:
// - playback context の入口 / content 切替 trigger
// Move to modules:
// - context build / content key normalize / history bucket management
// =====================================================================

  // future module controller slots
  // playbackContext は最初に外出ししやすい候補として、
  // controller 受け皿をここに置く前提で整理を進める。
  const playbackContextController =
    window.ATVB?.createPlaybackContextController?.({
      state,
      logContentSubtitle,
      subtitleHistoryMaxPerContent: SUBTITLE_HISTORY_MAX_PER_CONTENT,
    }) ?? null;
  
  // 再生準備の判定に必要な DOM / track 状態を集める。
  // 字幕同期や UI 更新の判断はここで持たない。
  function getPlaybackContext() {
    if (playbackContextController?.getPlaybackContext) {
      return playbackContextController.getPlaybackContext();
    }

    const video = document.querySelector("video");
    const playbackDialog = document.querySelector("dialog.playback-view");
    const playbackView = document.querySelector(
      '[data-testid="playback-view"]',
    );
    const textTrackCount = video?.textTracks?.length ?? 0;

    // 再生判定は URL ではなく DOM 条件を基準にする。
    const isPlaybackReady =
    Boolean(video) &&
    (Boolean(playbackDialog) || Boolean(playbackView));

    return {
      video,
      playbackDialog,
      playbackView,
      textTrackCount,
      isPlaybackReady,
    };
  }

  function getVideoAndDialog() {
    if (playbackContextController?.getVideoAndDialog) {
      return playbackContextController.getVideoAndDialog();
    }

    const ctx = getPlaybackContext();
    if (!ctx.isPlaybackReady) return null;

    const resolvedDialog =
      ctx.playbackDialog || ctx.playbackView?.closest("dialog") || null;

    if (!resolvedDialog && !ctx.playbackView) return null;

    return { video: ctx.video, dialog: resolvedDialog };
  }

  function isPlaybackPageReady() {
    if (playbackContextController?.isPlaybackPageReady) {
      return playbackContextController.isPlaybackPageReady();
    }

    return getPlaybackContext().isPlaybackReady;
  }

  // playback context detection helpers
  // playback readiness の観測結果を、logging や上位判断へ渡すための補助関数群。
  function getPlaybackContextLogPayload() {
    if (playbackContextController?.getPlaybackContextLogPayload) {
      return playbackContextController.getPlaybackContextLogPayload();
    }

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
    if (playbackContextController?.normalizeContentKeyPart) {
      return playbackContextController.normalizeContentKeyPart(value);
    }

    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function normalizeMediaSourceKey(rawSrc) {
    if (playbackContextController?.normalizeMediaSourceKey) {
      return playbackContextController.normalizeMediaSourceKey(rawSrc);
    }

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
    if (playbackContextController?.getPlaybackTitleKey) {
      return playbackContextController.getPlaybackTitleKey();
    }

    const rawTitle = String(document.title || "");
    const cleanedTitle = rawTitle
      .replace(/\s*[|｜-]\s*apple tv\+\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return normalizeContentKeyPart(cleanedTitle);
  }

  function resolvePlaybackContentKey(ctx = getPlaybackContext()) {
    if (playbackContextController?.resolvePlaybackContentKey) {
      return playbackContextController.resolvePlaybackContentKey(ctx);
    }

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
    if (playbackContextController?.getCurrentVideoSrcKey) {
      return playbackContextController.getCurrentVideoSrcKey(video);
    }

    return normalizeMediaSourceKey(
      video?.currentSrc || video?.getAttribute("src") || "",
    );
  }

  // playback history context helpers
  // content key ごとの履歴バケット切替と保存先選択だけを担当する。
  function getHistoryBucketForContentKey(contentKey) {
    if (playbackContextController?.getHistoryBucketForContentKey) {
      return playbackContextController.getHistoryBucketForContentKey(
        contentKey,
      );
    }

    if (!contentKey) return null;
    return state.subtitleHistoryStore.get(contentKey) || null;
  }

  function loadHistoryForContentKey(contentKey) {
    if (playbackContextController?.loadHistoryForContentKey) {
      return playbackContextController.loadHistoryForContentKey(contentKey);
    }

    const bucket = getHistoryBucketForContentKey(contentKey);
    const items = Array.isArray(bucket?.items) ? bucket.items : [];
    state.subtitleHistory = items.slice(-SUBTITLE_HISTORY_MAX_PER_CONTENT);
  }

  function saveHistoryForContentKey(
    contentKey,
    history = state.subtitleHistory,
  ) {
    if (playbackContextController?.saveHistoryForContentKey) {
      return playbackContextController.saveHistoryForContentKey(
        contentKey,
        history,
      );
    }

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
    if (playbackContextController?.switchHistoryContext) {
      return playbackContextController.switchHistoryContext(
        nextContentKey,
        reason,
      );
    }

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
    if (playbackContextController?.syncHistoryContextWithPlayback) {
      return playbackContextController.syncHistoryContextWithPlayback(reason);
    }

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


// =====================================================================
// Section 3: UI - Secondary Subtitle DOM
// Role:
// - secondary subtitle element / panel host の確保
// - secondary subtitle の描画入口
// Keep in content.js:
// - host ensure / render 呼び出し順 / minimal DOM bridge
// Move to modules:
// - panel shell / subtitle block / overlay render details
// =====================================================================

  // secondary subtitle render 時の debug log 用 payload。
  // DOM 重複や cue 解決結果を短く追える最小情報だけをまとめる。
  function getSecondaryRenderLogPayload(text, track, elementCount) {
    return {
      textPreview: String(text || "").slice(0, 40),
      trackLanguage: track?.language || "",
      activeCuesLength: getTrackActiveCuesLength(track),
      secondaryElementCount: elementCount,
    };
  }

  // secondary subtitle 要素は panel host 配下と既存 panel 配下の両方を考慮しつつ、
  // data 属性 / class のどちらでも拾えるようにしておく。
  function getSecondarySubtitleElements() {
    return document.querySelectorAll(
      "[data-secondary-subtitle], .dual-subtitles-secondary",
    );
  }

  function countSecondarySubtitleElements() {
    return getSecondarySubtitleElements().length;
  }

  // 既存要素が古い class / data 属性の片方しか持っていない場合でも、
  // 現行セレクタで再利用できるように normalize する。
  function normalizeSecondarySubtitleElement(el) {
    if (!el) return null;

    if (!el.hasAttribute("data-secondary-subtitle")) {
      el.setAttribute("data-secondary-subtitle", "");
    }
    if (!el.classList.contains("dual-subtitles-secondary")) {
      el.classList.add("dual-subtitles-secondary");
    }

    return el;
  }

  // secondary subtitle を差し込む panel host を確保する。
  // host がまだ無い場合だけ right panel を生成し、再取得して返す。
  function getOrCreatePanelHost() {
    let panelHost = getTarget().querySelector("#atv-panel-host");
    if (!panelHost) {
      panelUi.createRightPanel();
      panelHost = getTarget().querySelector("#atv-panel-host");
    }
    return panelHost || null;
  }

  // secondary subtitle panel 本体を通常 DOM / shadowRoot の両方から探し、
  // 見つかった既存 panel には現行セレクタを補って再利用しやすくする。
  function findSecondarySubtitlePanel(panelHost) {
    let panel = document.querySelector("[data-dual-subtitles-panel]");
    if (!panel) {
      panel = document.querySelector(".dual-subtitles-panel");
    }
    if (!panel && panelHost?.shadowRoot) {
      panel = panelHost.shadowRoot.querySelector(
        "[data-dual-subtitles-panel], .dual-subtitles-panel",
      );
    }

    if (panel && panelHost?.shadowRoot?.contains(panel)) {
      panel.setAttribute("data-dual-subtitles-panel", "");
      panel.classList.add("dual-subtitles-panel");
    }

    return panel || null;
  }

  // panel host 直下の secondary subtitle 要素は表示しない。
  // 実表示は slot / panel shell 側に委ねるため、直下要素は hidden layer として扱う。
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

  // secondary subtitle 表示先の element を 1 個だけ保証する。
  // 既存要素が複数あれば先頭だけ残して normalize し、
  // 何も無ければ panel host / panel shell を確保して新規作成する。
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

    if (DEBUGSECONDARYSUBS) {
      logContent("secondary-dom ensure-start", {
        existingElementCount: getSecondarySubtitleElements().length,
        hasDialogEl: Boolean(state.dialogEl),
        hasPanelShadowRoot: Boolean(state.panelShadowRoot),
        requestedSecondaryLang: effectiveSettings.secondaryLang || "",
      });
    }

    if (!isLanguageSelectionReady(effectiveSettings)) {
      return null;
    }

    ensurePanelSlotLayerStyle();

    const allExisting = getSecondarySubtitleElements();
    if (allExisting.length > 1) {
      const keep = normalizeSecondarySubtitleElement(allExisting[0]);

      for (let i = 1; i < allExisting.length; i++) {
        allExisting[i].remove();
      }

      if (DEBUGSECONDARYSUBS) {
        logContent(
          "secondary duplicate elements cleaned",
          getSecondaryRenderLogPayload(
            keep.textContent || "",
            secondaryTrackBound,
            allExisting.length,
          ),
        );
      }

      return keep;
    }

    if (allExisting.length === 1) {
      return normalizeSecondarySubtitleElement(allExisting[0]);
    }

    const panelHost = getOrCreatePanelHost();

    if (DEBUGSECONDARYSUBS) {
      logContent("secondary-dom host-resolved", {
        hasPanelHost: Boolean(panelHost),
        existingElementCount: getSecondarySubtitleElements().length,
      });
    }

    if (!panelHost) return null;

    const ensuredAfterPanel = document.querySelector(
      "[data-secondary-subtitle]",
    );
    if (ensuredAfterPanel) {
      return normalizeSecondarySubtitleElement(ensuredAfterPanel);
    }

    findSecondarySubtitlePanel(panelHost);

    if (DEBUGSECONDARYSUBS) {
      logContent("secondary-dom create-element", {
        hasPanelHost: Boolean(panelHost),
        panelHasShadowRoot: Boolean(panelHost?.shadowRoot),
        existingElementCount: getSecondarySubtitleElements().length,
      });
    }

    const el = document.createElement("div");
    el.setAttribute("data-secondary-subtitle", "");
    el.className = "dual-subtitles-secondary";
    el.slot = "secondary-subtitle-slot";
    panelHost.appendChild(el);

    if (DEBUGSECONDARYSUBS) {
      logContent("secondary element ensured");
    }

    return el;
  }

  // [render: panel shell apply]
  // secondary subtitle の描画は、要素確保 → cue text 解決 → idle clear 判定 →
  // text / language 反映、の順で行う。
  function renderSecondarySubtitle(text, track) {
    if (DEBUGSECONDARYSUBS) {
      logContent("secondary-dom render-entry", {
        textLength: String(text || "").length,
        trackLanguage: track?.language || "",
        trackMode: track?.mode || "",
        activeCuesLength: getTrackActiveCuesLength(track),
        existingElementCount: countSecondarySubtitleElements(),
        lastSecondaryTextLength: String(lastSecondaryText || "").length,
        lastSecondarySignalAt,
      });
    }

    let el = ensureSecondarySubtitleElement();
    if (!el) return;

    const elementCountBefore = countSecondarySubtitleElements();
    if (elementCountBefore > 1) {
      if (DEBUGSECONDARYSUBS) {
        logContent(
          "secondary duplicate elements cleaned",
          getSecondaryRenderLogPayload(text, track, elementCountBefore),
        );
      }
      el = ensureSecondarySubtitleElement();
    }

    if (!el) {
      if (DEBUGSECONDARYSUBS) {
        logContent("secondary element missing, recreating");
      }
      el = ensureSecondarySubtitleElement();
    }
    if (!el) return;

    const elementCount = countSecondarySubtitleElements();
    const activeCuesLength = getTrackActiveCuesLength(track);

    let resolvedText = text || "";
    if (!resolvedText && activeCuesLength > 0) {
      resolvedText = getCurrentCueText(track) || "";
      if (DEBUGSECONDARYSUBS) {
        logContent(
          "secondary cue text resolved",
          getSecondaryRenderLogPayload(resolvedText, track, elementCount),
        );
      }
    }

    resolvedText = normalizeSubtitleText(resolvedText);
    let finalText = resolvedText;
    const now = Date.now();

    if (activeCuesLength > 0 || resolvedText) {
      lastSecondarySignalAt = now;
    }

    const willRetainPreviousText =
      !finalText &&
      !!lastSecondaryText &&
      lastSecondarySignalAt > 0 &&
      now - lastSecondarySignalAt <= SECONDARYSUBTITLEIDLECLEARMS;

    if (finalText) {
      lastSecondaryText = finalText;
      lastSecondaryTextAt = now;
    } else if (willRetainPreviousText) {
      finalText = lastSecondaryText;
      if (DEBUGSECONDARYSUBS) {
        logContent(
          "secondary subtitle retained until next cue or idle clear",
          getSecondaryRenderLogPayload(finalText, track, elementCount),
        );
      }
    } else if (
      !finalText &&
      lastSecondarySignalAt > 0 &&
      now - lastSecondarySignalAt > SECONDARYSUBTITLEIDLECLEARMS
    ) {
      if (el.textContent && DEBUGSECONDARYSUBS) {
        logContent(
          "secondary subtitle cleared after idle timeout",
          getSecondaryRenderLogPayload("", track, elementCount),
        );
      }
      lastSecondaryText = "";
      lastSecondaryTextAt = 0;
      lastSecondarySignalAt = 0;
    }

    if (DEBUGSECONDARYSUBS) {
      logContent("secondary-dom render-final", {
        resolvedTextLength: String(resolvedText || "").length,
        finalTextLength: String(finalText || "").length,
        activeCuesLength,
        elementCount,
        willClear: !finalText,
        willRetainPreviousText,
      });
    }

    if (DEBUGSECONDARYSUBS) {
      logContent(
        "secondary render called",
        getSecondaryRenderLogPayload(finalText, track, elementCount),
      );
    }

    el.textContent = finalText;
    el.dataset.language = track?.language || "";
    if (DEBUGSECONDARYSUBS) {
      logContent("secondary-dom render-applied", {
        appliedTextLength: String(el.textContent || "").length,
        appliedLanguage: el.dataset.language || "",
        isConnected: Boolean(el.isConnected),
        elementTagName: el.tagName || "",
        elementClassName: el.className || "",
        elementDataSecondarySubtitle:
          el.getAttribute("data-secondary-subtitle"),
      });
    }

    logSubtitlePanelState("after-renderSecondarySubtitle");
  }

  function logSubtitlePanelState(tag) {
    try {
      const panelHost = getTarget().querySelector("#atv-panel-host");
      const secondaryEl = panelHost?.querySelector("[data-secondary-subtitle]");
      const snapshot = state.lastPanelRenderSnapshot || {};
      const currentSubtitleBlock =
        state.currentSubtitleBlock || snapshot.currentSubtitleBlock || null;
      const payload = {
        tag,
        allBlocksCount: snapshot.allBlocksCount ?? 0,
        historyCount: state.subtitleHistory.length,
        panelPastCount: Array.isArray(state.panelPastBlocks)
          ? state.panelPastBlocks.length
          : 0,
        hasCurrentBlock: Boolean(currentSubtitleBlock),
        currentPrimary: currentSubtitleBlock?.primaryText || "",
        currentSecondary: currentSubtitleBlock?.secondaryText || "",
        secondaryElText: secondaryEl?.textContent || "",
      };

      if (tag === "after-renderSecondarySubtitle") {
        const signature = JSON.stringify({
          allBlocksCount: payload.allBlocksCount,
          historyCount: payload.historyCount,
          panelPastCount: payload.panelPastCount,
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

// =====================================================================
// Section 4: Sync Interval - Periodic Orchestration
// Role:
// - sync interval ごとの playback context refresh
// - large seek detection / secondary recovery pass 起動
// Keep in content.js:
// - scheduling / runtime snapshot entry / orchestration order
// Move to modules:
// - recovery decision / lane state / track resolve details
// =====================================================================

  // sync interval 本体では、
  // playback context 更新 → large seek 検知 → secondary recovery pass →
  // 必要時のみ primary recovery という順序で処理する。
  function ensureSecondaryTrackSyncInterval() {
    if (secondaryTrackSyncInterval) return;

    secondaryTrackSyncInterval = window.setInterval(() => {
      const orchestrator = ensureSyncIntervalOrchestrator();

      logContent("sync interval tick", {
        restarting: state.restarting,
        hasSyncIntervalOrchestrator: Boolean(orchestrator),
        hasVideo: Boolean(state.video),
        requestedSecondaryLang:
          state.requestedSecondaryLang ||
          state.contentSettings.secondaryLang ||
          "",
        currentTime: Number(state.video?.currentTime ?? 0),
      });

      if (state.restarting) return;
      if (!orchestrator) return;

      orchestrator.refreshPlaybackContext();
      orchestrator.detectLargeSeek();

      const effectiveSecondaryLanguage =
        state.requestedSecondaryLang || state.contentSettings.secondaryLang;
      if (!state.video || !effectiveSecondaryLanguage) return;

      const { now, hasSecondarySignal, hasPrimarySignal } =
        orchestrator.runSecondaryRecoveryPass(effectiveSecondaryLanguage);

      const trackCount = state.video?.textTracks?.length ?? 0;
      const shouldAttemptPrimaryRecovery =
        hasSecondarySignal && !hasPrimarySignal && trackCount > 1;

      if (!shouldAttemptPrimaryRecovery) {
        if (hasPrimarySignal) state.lastPrimaryRecoveryAttemptAt = 0;
        return;
      }

      if (
        state.lastPrimaryRecoveryAttemptAt &&
        now - state.lastPrimaryRecoveryAttemptAt < 4000
      ) {
        return;
      }

      state.lastPrimaryRecoveryAttemptAt = now;
      const recoveryResult =
        reinitializeCoordinator?.reinitializeSubtitlePipeline?.(
          "syncintervalprimaryrecovery",
        ) ?? {};

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

// =====================================================================
// Section 5: Layout - Playback Controls Adjustment
// Role:
// - playback controls の位置・幅・translate 調整
// - layout retry / settling の配線
// Keep in content.js:
// - layout apply trigger / retry timing orchestration
// Move to modules:
// - layout calculation / managed style apply-clear details
// =====================================================================

  function clearPlaybackControlRetryTimers() {
    if (!state.playbackControlsRetryTimers.length) return;
    state.playbackControlsRetryTimers.forEach((timerId) =>
      clearTimeout(timerId),
    );
    state.playbackControlsRetryTimers = [];
  }

  function requestPlaybackControlsAdjustment(reason = "unknown") {
    if (state.playbackControlsRafId) return;
    state.playbackControlsRafId = window.requestAnimationFrame(() => {
      state.playbackControlsRafId = 0;
      adjustPlaybackControlsForPanel(reason);
    });
  }

  function scheduleAdjustPlaybackControls(
    reason = "unknown",
    retryDelays = [],
    options = {},
  ) {
    const immediate = options.immediate !== false;

    clearPlaybackControlRetryTimers();
    if (immediate) requestPlaybackControlsAdjustment(reason);

    retryDelays.forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        requestPlaybackControlsAdjustment(`${reason}-retry-${delayMs}`);
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

  function clearPlaybackControlsTransforms() {
    return clearPlaybackControlsTransformsFromModule();
  }

  function adjustPlaybackControlsForPanel(reason = "unknown") {
    if (state.playbackControlsApplying) return;

    state.playbackControlsApplying = true;
    try {
      return adjustPlaybackControlsForPanelFromModule(reason);
    } finally {
      state.playbackControlsApplying = false;
    }
  }

  function clearLayoutRetryTimers() {
    if (!layoutRetryTimers.length) return;
    layoutRetryTimers.forEach((timerId) => clearTimeout(timerId));
    layoutRetryTimers = [];
  }

  function getLayoutTargets() {
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
  }

  function applyLayoutToTargets(targets, visible) {
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
  }

  // [observer/layout]
  function applyLayout(show) {
    clearLayoutRetryTimers();
    applyLayoutToTargets(getLayoutTargets(), show);

    setOverlayVisible(!show);

    scheduleAdjustPlaybackControls("applyLayout", show ? [1200] : [], {
      immediate: !show,
    });
  }

// =====================================================================
// Section 6: Observer - Runtime Monitoring
// Role:
// - mutation / resize / raf observers の登録・解除
// - runtime 変化に応じた trigger 配線
// Keep in content.js:
// - observer attach-detach / reinitialize-layout-render entrypoints
// Move to modules:
// - re-evaluation / reconnect / reposition implementation details
// =====================================================================




// =====================================================================
// Section 7: Lifecycle - Boot & Teardown
// Role:
// - boot / restart / teardown
// - message listener / roots / timer cleanup
// Keep in content.js:
// - extension lifecycle entrypoints / top-level wiring
// Move to modules:
// - per-module internal init / dispose details
// =====================================================================

  // [binder/cue: attach] primary / secondary の listener・timer・mode をまとめて解除する。
  function clearSecondaryTrackState() {
    state.secondaryTrack = null;
    cueController.unbindSecondarySubtitleTrack();
  }

  function clearTrackBindings() {
    // [attach: detach timers] track resolve retry timer を解除する。
    reinitializeCoordinator?.clearTrackResolveRetryTimers();
    clearSecondaryTrackState();

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
  }

  function resetRuntimeState(options = {}) {
    if (options.clearCurrentHistory === true) {
      state.subtitleHistory = [];
      saveHistoryForContentKey(state.currentContentKey, []);
    }
    state.subtitleBlocks = [];
    state.subtitleCurrentIndex = -1;
    state.subtitleBlockMeta = null;
    state.panelPastBlocks = [];
    state.currentSubtitleBlock = null;
    state.lastCurrentSubtitleBlockAt = 0;
    state.lastPanelRenderSnapshot = null;
    state.lastPrimaryText = "";
    state.lastPrimarySnapshotAt = 0;
    state.lastObservedVideoTime = null;
  }

  function teardownPlaybackControlsUi() {
    stopPlaybackControlLayoutObservers();

    if (state.playbackControlsRafId) {
      window.cancelAnimationFrame(state.playbackControlsRafId);
      state.playbackControlsRafId = 0;
    }

    clearPlaybackControlsTransforms();
  }

  function teardownUiHostsAndListeners() {
    if (state.popupDocClickHandler) {
      // createPopupHost で登録した document listener の解除
      document.removeEventListener("click", state.popupDocClickHandler);
      state.popupDocClickHandler = null;
    }

    destroyUiHosts();
    applyLayout(false);
  }

  function teardownRuntimeBindingsForRestart() {
    clearTrackBindings();
    clearInitialCueRecovery();
    clearPlaybackControlRetryTimers();
    clearControlSettlingTimers();
  }

  function teardownForRestart() {
    teardownRuntimeBindingsForRestart();
    teardownPlaybackControlsUi();
    teardownUiHostsAndListeners();
  }

  function prepareForRestart() {
    teardownForRestart();
    resetRuntimeState();
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
    panelUi.createRightPanel();
    ensureSecondarySubtitleElement();
    createPopupHost();
    createToggleButton();
    panelUi.createDebugPanel();
    startPlaybackControlLayoutObservers();
    scheduleAdjustPlaybackControls("buildUi", [700, 1600], {
      immediate: false,
    });
  }

  function applyInitialCueSnapshotOrWait() {
    // [initial snapshot policy]
    // 起動時に cue が既に読めるなら通常の cuechange 経路を即時実行する。
    // まだ cue が無ければ recovery 側に任せ、ここでは待機ログだけ出す。

    if (hasRecoverableInitialCue()) {
      onCueChange();
      return;
    }

    // 初回 activeCues=0 は空描画で確定せず、cuechange 回復導線へ委譲する。
    logContent("initial snapshot waiting for first cue", {
      primaryActiveCues: getTrackActiveCuesLength(state.primaryTrack),
      secondaryActiveCues: getTrackActiveCuesLength(state.secondaryTrack),
    });
  }

  // [settings load path: initial snapshot]
  // 初回ロード時に sync storage / bridge から設定 snapshot を読む入口。
  // requested settings と effective settings を整え、未設定時は DEFAULT_SETTINGS に退避する。
  // 実際の起動は startBilingual に委譲する。
  // [settings reinit path: full restart]
  // runtime state と UI を teardown してから起動シーケンスをやり直す。
  // 設定変更反映や大きな再初期化が必要なケースの入口。

  function boot() {
    if (state.booted) return;
    state.booted = true;
    registerDebugLogUpdateCallback();
    logContent("content startup begin");
    ensureMessageListener();
    ensureSecondaryTrackSyncInterval();
    waitForVideo(attachTracks);
  }


  let secondaryTrackCleanup = null;
  let secondaryTrackBound = null;
  let secondaryTrackSyncInterval = null;
  let layoutRetryTimers = [];
  let startupCompletedLogged = false;
  let lastSecondaryText = "";
  let lastSecondaryTextAt = 0;
  let lastSecondarySignalAt = 0;



  function getMergedSubtitleHealthSnapshot() {
    try {
      return cueController?.getMergedSubtitleHealth?.() || null;
    } catch (_) {
      return null;
    }
  }

  function computeCurrentSubtitleBlock(reason = "unknown") {
    const currentBlock = state.currentSubtitleBlock || null;
    const primaryText = normalizeSubtitleText(
      currentBlock?.primaryText || state.lastPrimaryText || "",
    );
    const secondaryText = normalizeSubtitleText(
      currentBlock?.secondaryText || "",
    );

    return {
      startTime: currentBlock?.startTime ?? null,
      endTime: currentBlock?.endTime ?? null,
      primaryText,
      secondaryText,
      hasPrimarySignal: Boolean(primaryText),
      hasSecondarySignal: Boolean(secondaryText),
      sourceReason: reason,
      updatedAt: Date.now(),
    };
  }

  function setSubtitleBlocks(result, reason = "unknown") {
    const nextBlocks = Array.isArray(result?.blocks) ? result.blocks : [];
    const nextCurrentIndex =
      typeof result?.currentIndex === "number" ? result.currentIndex : -1;
    const nextPanelPastBlocks = nextBlocks.filter(
      (block) => block?.state === "past",
    );

    state.subtitleBlocks = nextBlocks;
    state.subtitleCurrentIndex = nextCurrentIndex;
    state.subtitleBlockMeta = result?.meta || null;
    state.panelPastBlocks = nextPanelPastBlocks;

    logContent("subtitle blocks updated", {
      reason,
      blockCount: nextBlocks.length,
      currentIndex: nextCurrentIndex,
      panelPastCount: nextPanelPastBlocks.length,
    });
  }

  /* subtitle block sequence の truth snapshot を返す。 */
  function getSubtitleBlockSequence() {
    return {
      blocks: state.subtitleBlocks,
      currentIndex: state.subtitleCurrentIndex,
      meta: state.subtitleBlockMeta,
    };
  }

  /* subtitle block sequence から current block を取り出す。 */
  function getCurrentSubtitleBlockFromSequence(sequenceResult = null) {
    const blocks = Array.isArray(sequenceResult?.blocks)
      ? sequenceResult.blocks
      : state.subtitleBlocks;
    const currentIndex =
      typeof sequenceResult?.currentIndex === "number"
        ? sequenceResult.currentIndex
        : state.subtitleCurrentIndex;

    if (
      !Array.isArray(blocks) ||
      currentIndex < 0 ||
      currentIndex >= blocks.length
    ) {
      return null;
    }

    const block = blocks[currentIndex];
    if (!block) return null;

    return {
      startTime: block.startTime ?? null,
      endTime: block.endTime ?? null,
      primaryText: block.primaryText || block.primary || "",
      secondaryText: block.secondaryText || block.secondary || "",
      hasPrimarySignal: Boolean(block.primaryText || block.primary),
      hasSecondarySignal: Boolean(block.secondaryText || block.secondary),
      sourceReason: "subtitleBlockSequence",
      updatedAt: Date.now(),
      key: block.key || null,
      stable: block.stable ?? false,
    };
  }

  // 現在字幕の更新と一時的なテキスト巻き戻りの抑止
  function setCurrentSubtitleBlock(block, reason = "unknown") {
    const previousBlock = state.currentSubtitleBlock || null;

    const isSameTimeWindow =
      previousBlock &&
      block &&
      previousBlock.startTime === block.startTime &&
      previousBlock.endTime === block.endTime;

    const shouldKeepPreviousTexts =
      isSameTimeWindow &&
      previousBlock.hasPrimarySignal &&
      previousBlock.primaryText &&
      block?.hasPrimarySignal &&
      block.primaryText &&
      previousBlock.primaryText !== block.primaryText &&
      state.lastPrimaryText === previousBlock.primaryText;

    const nextBlock = shouldKeepPreviousTexts
      ? {
          ...block,
          primaryText: previousBlock.primaryText,
          secondaryText:
            previousBlock.secondaryText || block.secondaryText || "",
          hasPrimarySignal: previousBlock.hasPrimarySignal,
          hasSecondarySignal:
            previousBlock.hasSecondarySignal || block.hasSecondarySignal,
        }
      : block;

    state.currentSubtitleBlock = nextBlock;
    state.lastCurrentSubtitleBlockAt = Date.now();

    if (
      nextBlock?.hasPrimarySignal &&
      nextBlock.primaryText &&
      nextBlock.primaryText !== state.lastPrimaryText
    ) {
      state.lastPrimaryText = nextBlock.primaryText;

      appendSubtitleHistory({
        startTime: nextBlock.startTime ?? null,
        endTime: nextBlock.endTime ?? null,
        primary: nextBlock.primaryText,
        secondary: nextBlock.secondaryText || "",
      });
    }

    logContent("current subtitle block updated", {
      reason,
      hasBlock: Boolean(nextBlock),
      primaryTextLength: nextBlock?.primaryText?.length || 0,
      secondaryTextLength: nextBlock?.secondaryText?.length || 0,
      hasPrimarySignal: Boolean(nextBlock?.hasPrimarySignal),
      hasSecondarySignal: Boolean(nextBlock?.hasSecondarySignal),
      blockStartTime: nextBlock?.startTime ?? null,
      blockEndTime: nextBlock?.endTime ?? null,
    });
  }



  const vttApi = window.ATVB?.vtt || {};
  const resolverApi = window.ATVB?.resolver || {};
  const subtitleBlocksApi = window.ATVB?.subtitleBlocks || {};
  const subtitleBlockResolverApi = window.ATVB?.subtitleBlockResolver || {};

  const vttDeps = {
    normalizeSubtitleText: (...args) =>
      vttApi.normalizeSubtitleText?.(...args) ?? "",
    cleanCueText: (...args) => vttApi.cleanCueText?.(...args) ?? "",
    formatTime: (...args) => vttApi.formatTime?.(...args) ?? "",
  };

  const resolverDeps = {
    getUniqueTracks: (...args) => resolverApi.getUniqueTracks?.(...args) ?? [],
    getTrackCuesLength: (...args) =>
      resolverApi.getTrackCuesLength?.(...args) ?? 0,
    getTrackActiveCuesLength: (...args) =>
      resolverApi.getTrackActiveCuesLength?.(...args) ?? 0,
    pickBestSubtitleTrack: (...args) =>
      resolverApi.pickBestSubtitleTrack?.(...args) ?? null,
    getSecondarySubtitleTrackCandidates: (...args) =>
      resolverApi.getSecondarySubtitleTrackCandidates?.(...args) ?? [],
    resolveSecondarySubtitleTrack: (...args) =>
      resolverApi.resolveSecondarySubtitleTrack?.(...args) ?? null,
  };

  const { normalizeSubtitleText, cleanCueText } = vttDeps;

  const {
    buildSubtitleBlockSequence = () => ({
      blocks: [],
      currentIndex: -1,
      meta: null,
    }),
  } = subtitleBlocksApi;

  const { getTrackActiveCuesLength } = resolverDeps;

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

    let activeCues = null;
    try {
      activeCues = track.activeCues;
    } catch (_) {
      activeCues = null;
    }

    if (activeCues && activeCues.length > 0) {
      let bestActiveCue = null;
      let bestActiveScore = Infinity;

      for (let i = 0; i < activeCues.length; i++) {
        const cue = activeCues[i];
        if (!cue) continue;

        const center = (cue.startTime + cue.endTime) / 2;
        const score = Math.abs(center - time);

        if (score < bestActiveScore) {
          bestActiveScore = score;
          bestActiveCue = cue;
        }
      }

      if (bestActiveCue) return bestActiveCue;
    }

    let cues = null;
    try {
      cues = track.cues;
    } catch (_) {
      cues = null;
    }
    if (!cues) return null;

    let bestCue = null;
    let bestScore = Infinity;

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (!cue) continue;

      const overlapsLoosely =
        cue.startTime <= time + 0.35 && time <= cue.endTime + 0.35;

      if (!overlapsLoosely) continue;

      const center = (cue.startTime + cue.endTime) / 2;
      const score = Math.abs(center - time);

      if (score < bestScore) {
        bestScore = score;
        bestCue = cue;
      }
    }

    return bestCue;
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

  // -----------------------------------------------------------------------------
  // playback / content context coordinator helpers
  // content.js に残す上位入口として、再生対象の把握と content context の切替だけを扱う。
  // subtitle sync / recovery / DOM 描画の詳細は下位 helper 側へ寄せる。
  //
  // 将来の playbackContext module 候補:
  // - getPlaybackContext
  // - getVideoAndDialog
  // - isPlaybackPageReady
  // - getPlaybackContextLogPayload
  // - resolvePlaybackContentKey
  // - getCurrentVideoSrcKey
  // - syncHistoryContextWithPlayback
  //
  // まずは context 解決と history context 切替だけを外出し候補にし、
  // appendSubtitleHistory や panel / render 側責務はここへ混ぜない。
  // -----------------------------------------------------------------------------


  function getSecondaryTrackDebugPayload(effectiveSecondaryLanguage, track) {
    return {
      effectiveSecondaryLanguage: effectiveSecondaryLanguage || "",
      selectedTrackLanguage: track?.language || "",
      cuesLength: resolverDeps.getTrackCuesLength(track),
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

  // cueController の secondary track 同期を content.js から呼ぶための低レベル helper。
  // 通常同期では、video / language / render 関数を明示して bind 状態をそろえる。
  function syncSecondarySubtitleTrackBinding(
    video,
    requestedLang,
    renderFn,
    options = {},
  ) {
    const forceRebind = options?.forceRebind === true;
    const suppressRender = options?.suppressRender === true;
    const previousTrack = state.secondaryTrack || null;

    logContent("secondary track binding sync requested", {
      requestedLang: requestedLang || "",
      forceRebind,
      suppressRender,
      hasVideo: Boolean(video),
      previousTrackExists: Boolean(previousTrack),
      previousTrackLanguage: previousTrack?.language || "",
      previousTrackMode: previousTrack?.mode || "",
    });

    cueController.syncSecondarySubtitleTrack(
      video,
      requestedLang,
      renderFn,
      options,
    );

    const boundTrack = cueController.getBoundSecondaryTrack?.() || null;

    logContent("secondary track binding sync finished", {
      requestedLang: requestedLang || "",
      forceRebind,
      suppressRender,
      previousTrackExists: Boolean(previousTrack),
      boundTrackExists: Boolean(boundTrack),
      sameTrackRef: Boolean(previousTrack && boundTrack && previousTrack === boundTrack),
      boundTrackLanguage: boundTrack?.language || "",
      boundTrackMode: boundTrack?.mode || "",
      boundTrackCuesLength: (() => {
        try {
          return boundTrack?.cues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })(),
      boundTrackActiveCuesLength: (() => {
        try {
          return boundTrack?.activeCues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })(),
    });
  }


  // secondary missing 復旧のための再同期要求を処理する。
  // ここでは現在の state から video / language を解決し、
  // 必要なら forceRebind を付けて cueController 側へ再同期を委譲する。
  function syncSecondarySubtitleTrack({
    reason = "unknown",
    forceRebind = false,
  } = {}) {
    const video = state.video;
    const requestedLang =
      state.requestedSecondaryLang || state.contentSettings.secondaryLang;

    const previousTrack = state.secondaryTrack || null;

    logContent("secondary track resync requested", {
      reason,
      forceRebind,
      requestedLang: requestedLang || "",
      hasVideo: Boolean(video),
      previousTrackExists: Boolean(previousTrack),
      previousTrackLanguage: previousTrack?.language || "",
      previousTrackMode: previousTrack?.mode || "",
      previousTrackCuesLength: (() => {
        try {
          return previousTrack?.cues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })(),
      previousTrackActiveCuesLength: (() => {
        try {
          return previousTrack?.activeCues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })(),
    });

    if (!video || !requestedLang) {
      logContent("secondary sync result: skipped before binding", {
        reason,
        forceRebind,
        requestedLang: requestedLang || "",
        hasVideo: Boolean(video),
      });
      return;
    }

    try {
      syncSecondarySubtitleTrackBinding(
        video,
        requestedLang,
        renderSecondarySubtitle,
        {
          forceRebind,
          suppressRender: true,
        },
      );
    } catch (error) {
      logContent("secondary sync result: binding threw", {
        reason,
        forceRebind,
        requestedLang,
        message: String(error?.message || error || ""),
      });
      throw error;
    }

    state.secondaryTrack = cueController.getBoundSecondaryTrack?.() || null;
    const currentTrack = state.secondaryTrack;

    if (!currentTrack) {
      logContent("secondary sync result: no track resolved (clearing)", {
        reason,
        forceRebind,
        requestedLang,
      });
    } else if (previousTrack !== currentTrack || forceRebind) {
      logContent("secondary sync result: track re-bound", {
        reason,
        forceRebind,
        requestedLang,
        trackLang: currentTrack.language || "",
        trackMode: currentTrack.mode || "",
        cuesLength: (() => {
          try {
            return currentTrack?.cues?.length ?? 0;
          } catch (_) {
            return -1;
          }
        })(),
        activeCuesLength: (() => {
          try {
            return currentTrack?.activeCues?.length ?? 0;
          } catch (_) {
            return -1;
          }
        })(),
      });
    } else {
      logContent("secondary sync result: same track (no re-bind needed)", {
        reason,
        forceRebind,
        requestedLang,
        trackLang: currentTrack.language || "",
        trackMode: currentTrack.mode || "",
        cuesLength: (() => {
          try {
            return currentTrack?.cues?.length ?? 0;
          } catch (_) {
            return -1;
          }
        })(),
        activeCuesLength: (() => {
          try {
            return currentTrack?.activeCues?.length ?? 0;
          } catch (_) {
            return -1;
          }
        })(),
      });
    }
  }


  function isVisibleElement(el) {
    if (!el) return false;
    if (!el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    return getComputedStyle(el).display !== "none";
  }

  function setStyleIfChanged(el, propertyName, value) {
    if (!el) return;
    const next = String(value || "");
    if (el.style[propertyName] === next) return;
    el.style[propertyName] = next;
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
        <div id="popup-body">
          <div class="popup-pane active" id="pane-dict"><span class="loading">検索中...</span></div>
          <div class="popup-pane" id="pane-ai"><span class="loading">翻訳中...</span></div>
        </div>
      </div>
    `;
  }

  function registerPopupOutsideClickHandler(popup) {
    // subtitle popup 外クリックで閉じるための document listener 登録
    state.popupDocClickHandler = () => {
      popup.style.display = "none";
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

    const popup = root.getElementById("popup");
    if (!popup) return;

    root.getElementById("popup-close")?.addEventListener("click", () => {
      popup.style.display = "none";
    });

    wirePopupTabEvents(root);
    registerPopupOutsideClickHandler(popup);
    registerPopupWordLinkHandler(root);
  }

  function mountPopupHost(target) {
    // [shell: subtitle popup host mount] popup host を生成して playback target に追加する。
    const host = document.createElement("div");
    host.id = "atv-popup-host";
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:999999;pointer-events:none;";
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
    popup.style.display = "block";
    ensurePopupResizeObserver();
    repositionPopup("initial");
  }

  // [render: subtitle popup display] subtitle popup の表示内容を初期化し、位置を決めて辞書/翻訳取得を開始する。
  function showPopup(word, sentence, anchorRect, options = {}) {
    if (!state.popupShadowRoot) return;

    const clean = word.replace(
      /[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF]/g,
      "",
    );
    if (!clean) return;

    const popupSource = options.source || "unknown";
    const popupContext = buildPopupDisplayContext(
      clean,
      sentence,
      anchorRect,
      popupSource,
    );

    logContent("showPopup", popupContext);
    state.popupLastContext = popupContext;

    const popup = resetPopupDisplayState(clean);
    if (!popup) return;

    openPopupDisplay(popup);

    fetchDictionary(clean);
    fetchTranslation(sentence || clean);
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
    clearPlaybackControlsTransforms: clearPlaybackControlsTransformsFromModule,
    adjustPlaybackControlsForPanel: adjustPlaybackControlsForPanelFromModule,
  } = playbackControlsLayout;

  const { createOverlayController } = root.overlayController;
  const overlayController = createOverlayController({
    getOverlayRoot: () => state.overlayRoot,
    setOverlayRoot: (rootNode) => {
      state.overlayRoot = rootNode;
    },
    getTarget,
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
    getPreviousSubtitleBlocks: () => state.subtitleBlocks || [],
    buildSubtitleBlockSequence,
    setSubtitleBlocks,
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence,
    setCurrentSubtitleBlock,
    DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    updateOverlay: (...args) => overlayController.updateOverlay(...args),
    updateOverlayFromView: (view) =>
      overlayController.updateOverlayFromView(view),
    updateOverlayFromBlock: (block) =>
      overlayController.updateOverlayFromBlock(block),
    renderPanel,
  });

  const panelUi = createPanelUi({
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
    scheduleAdjustPlaybackControls,
    scheduleControlSettlingBurst,
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
        normalizeSubtitleText,
        getMergedSubtitleHealthSnapshot,
        syncSecondarySubtitleTrackBinding,
        syncSecondarySubtitleTrack,
        renderSecondarySubtitle,
        resolverDeps,
        panelUi,
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
      ...state.contentSettings,
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
    clearTrackBindings();

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
      syncSecondarySubtitleTrackBinding(
        video,
        secondaryLang,
        renderSecondarySubtitle,
      );
    } else {
      cueController.unbindSecondarySubtitleTrack();
      renderSecondarySubtitle("", null);
    }

    state.secondaryTrack = cueController.getBoundSecondaryTrack();

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

  function clearInternalSubtitleState(reason = "unknown") {
    lastSecondaryText = "";
    lastSecondaryTextAt = 0;
    lastSecondarySignalAt = 0;
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
  }



  // [binder/cue: recovery] initial snapshot apply
  // [binder/cue: recovery] 起動時に取得済み cue を即時適用し、未取得なら recovery 経路へ委譲する。
  function renderCurrentSnapshot() {
    ensureSecondarySubtitleElement();
    applyInitialCueSnapshotOrWait();

    applySettingsToUI(state.contentSettings, { syncPanelVisibility: false });

    const secondaryBoundTrack = cueController.getBoundSecondaryTrack();
    const subtitleViewResolver = window.ATVB?.subtitleViewResolver || null;
    const overlaySequence =
      typeof getSubtitleBlockSequence === "function"
        ? getSubtitleBlockSequence()
        : null;
    const uiView =
      subtitleViewResolver &&
      typeof subtitleViewResolver.resolveUiSubtitleView === "function"
        ? subtitleViewResolver.resolveUiSubtitleView(
            overlaySequence?.blocks,
            overlaySequence?.currentIndex,
            overlaySequence?.meta,
          )
        : null;

    const resolvedSecondaryText =
      Array.isArray(uiView?.subLines) && uiView.subLines.length > 0
        ? uiView.subLines.join("\n")
        : getCurrentCueText(secondaryBoundTrack);

    if (secondaryBoundTrack) {
      renderSecondarySubtitle(resolvedSecondaryText, secondaryBoundTrack);
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
    });
    console.trace("startBilingual panelVisible applied");

    buildUi();
    ensureSecondarySubtitleElement();
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
      primaryTrackFound: !!state.primaryTrack,
      secondaryTrackFound: !!state.secondaryTrack,
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
