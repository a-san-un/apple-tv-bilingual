// =============================================================
// Apple TV+ Bilingual Subtitles - content.js v2.5 (rewritten)
// =============================================================
//
// Goals of this rewrite:
// - Keep the current UI/feature set intact.
// - Make init and re-init follow the same lifecycle.
// - Prevent listener / timer / DOM duplication after SETTINGS_CHANGED.
// - Keep textTracks hidden and render subtitles in custom UI only.
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

  const DEBUG_LOGS_KEY = "debugLogs";
  const DEBUG_LOGS_MAX = 400;
  const DEBUG_SECONDARY_SUBS = false;
  const SECONDARY_SUBTITLE_GRACE_MS = 1200;

  const state = {
    booted: false,
    restarting: false,
    video: null,
    dialogEl: null,
    contentSettings: { ...DEFAULT_SETTINGS },
    requestedSecondaryLang: "",
    primaryTrack: null,
    secondaryTrack: null,
    subtitleHistory: [],
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
  };

  let secondaryTrackCleanup = null;
  let secondaryTrackBound = null;
  let secondaryTrackSyncInterval = null;
  let startupCompletedLogged = false;
  let lastSecondaryText = "";
  let lastSecondaryTextAt = 0;

  function maskSensitive(value) {
    if (typeof value !== "string") return value;
    if (!value) return "";
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}...${value.slice(-2)}`;
  }

  function sanitizeForLog(payload) {
    if (payload == null) return payload;
    let cloned;
    try {
      cloned = JSON.parse(JSON.stringify(payload));
    } catch (_) {
      return { note: "unserializable payload" };
    }
    function walk(obj) {
      if (!obj || typeof obj !== "object") return obj;
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (key === "googleAiStudioApiKey" || key === "groqApiKey") {
          obj[key] = value ? maskSensitive(value) : "";
          continue;
        }
        if (typeof value === "object" && value !== null) walk(value);
      }
      return obj;
    }
    return walk(cloned);
  }

  function debugLog(scope, message, payload = null) {
    const time = new Date().toISOString();
    const safePayload = sanitizeForLog(payload);
    console.log(`[ATVB][${time}][${scope}] ${message}`, safePayload ?? "");
    return { time, scope, message, payload: safePayload };
  }

  async function appendDebugLog(line) {
    try {
      const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
        await chrome.storage.local.get(DEBUG_LOGS_KEY);
      debugLogs.push(line);
      if (debugLogs.length > DEBUG_LOGS_MAX) {
        debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
      }
      await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
      updateLiveDebugPanel();
    } catch (error) {
      console.warn("[ATV-Bilingual] appendDebugLog failed:", error);
    }
  }

  function logContent(message, payload = null) {
    const line = debugLog("content", message, payload);
    appendDebugLog(line);
  }

  function formatDebugLine(line) {
    const payloadText =
      line.payload != null ? ` ${JSON.stringify(line.payload)}` : "";
    return `[${line.time}] [${line.scope}] ${line.message}${payloadText}`;
  }

  async function getDebugLogText() {
    const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
      await chrome.storage.local.get(DEBUG_LOGS_KEY);
    return debugLogs.map(formatDebugLine).join("\n");
  }

  function applySecondaryLangFallback(settings) {
    const result = { ...settings };
    if (!result.secondaryLang) {
      const browserLang = (navigator.language || navigator.userLanguage || "en")
        .toLowerCase()
        .split("-")[0];
      result.secondaryLang = browserLang;
    }
    return result;
  }

  (async function loadEJDict() {
    try {
      const url = chrome.runtime.getURL("dict/ejdict.json");
      const res = await fetch(url);
      state.ejdictMap = await res.json();
      logContent("EJDict loaded", {
        entries: Object.keys(state.ejdictMap).length,
      });
    } catch (e) {
      logContent("EJDict load failed", { error: e.message });
      console.warn("[ATV-Bilingual] EJDict load failed:", e.message);
    }
  })();

  function ejdictLookup(word) {
    if (!state.ejdictMap) return null;
    return state.ejdictMap[word] || state.ejdictMap[word.toLowerCase()] || null;
  }

  function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function normalizeSubtitleText(raw) {
    return String(raw || "")
      .replace(/\r\n?/g, "\n")
      .replace(/<c(\.[^>]+)?>/g, "")
      .replace(/<\/c>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function cleanCueText(cue) {
    if (!cue) return "";
    if (cue.getCueAsHTML) {
      return normalizeSubtitleText(cue.getCueAsHTML().textContent || "");
    }
    return normalizeSubtitleText(cue.text || "");
  }

  function findCueAt(track, time) {
    if (!track || !track.cues) return null;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      if (c.startTime <= time + 0.1 && time < c.endTime + 0.1) return c;
    }
    return null;
  }

  function sendToBackground(msg, callback) {
    logContent("sendToBackground start", { type: msg?.type ?? null });

    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        logContent("sendToBackground first attempt failed", {
          type: msg?.type ?? null,
          error: chrome.runtime.lastError.message,
        });

        setTimeout(() => {
          chrome.runtime.sendMessage(msg, (res2) => {
            if (chrome.runtime.lastError) {
              logContent("sendToBackground retry failed", {
                type: msg?.type ?? null,
                error: chrome.runtime.lastError.message,
              });
              callback({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              logContent("sendToBackground retry success", {
                type: msg?.type ?? null,
                ok: res2?.ok ?? null,
              });
              callback(res2);
            }
          });
        }, 300);
      } else {
        logContent("sendToBackground success", {
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

  function getVideoAndDialog() {
    const v = document.querySelector("video");
    const d = document.querySelector("dialog.playback-view");
    if (v && v.textTracks && v.textTracks.length > 1 && d) {
      return { video: v, dialog: d };
    }
    return null;
  }

  function waitForVideo(cb) {
    const check = () => {
      const found = getVideoAndDialog();
      if (found) {
        state.dialogEl = found.dialog;
        logContent("waitForVideo resolved", {
          hasVideo: true,
          trackCount: found.video.textTracks.length,
          injectedIntoDialog: true,
        });
        cb(found.video);
        return;
      }
      state.waitTimer = window.setTimeout(check, 500);
    };
    if (state.waitTimer) clearTimeout(state.waitTimer);
    check();
  }

  function normalizeTrackLabel(label) {
    return String(label || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normalizeTrackLanguage(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function matchesRequestedLanguage(track, requestedLang) {
    const lang = normalizeTrackLanguage(track.language);
    const requested = normalizeTrackLanguage(requestedLang);

    if (!lang || !requested) return false;

    // Chinese family handling:
    // zh should match zh, zh-Hans, zh-Hant, zh-CN, zh-TW, etc.
    if (requested === "zh") {
      return lang === "zh" || lang.startsWith("zh-");
    }

    return lang === requested || lang.startsWith(`${requested}-`);
  }

  function isForcedLikeTrack(track) {
    const label = normalizeTrackLabel(track?.label).toLowerCase();
    return /\(forced\)|forced/.test(label);
  }

  function getUniqueTracks(textTracks) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if (t.kind !== "subtitles" && t.kind !== "captions") continue;
      if (isForcedLikeTrack(t)) continue;
      const key = `${t.language}::${normalizeTrackLabel(t.label)}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          index: i,
          lang: t.language,
          label: normalizeTrackLabel(t.label),
          track: t,
        });
      }
    }
    return result;
  }

  function getTrackCuesLength(track) {
    try {
      return track?.cues ? track.cues.length : 0;
    } catch {
      return 0;
    }
  }

  function getTrackActiveCuesLength(track) {
    try {
      return track?.activeCues ? track.activeCues.length : 0;
    } catch {
      return 0;
    }
  }

  function getSecondaryTrackDebugPayload(requestedSecondaryLanguage, track) {
    return {
      requestedSecondaryLanguage: requestedSecondaryLanguage || "",
      selectedTrackLanguage: track?.language || "",
      cuesLength: getTrackCuesLength(track),
      activeCuesLength: getTrackActiveCuesLength(track),
    };
  }

  function scoreSubtitleTrack(track, index) {
    const cuesLength = getTrackCuesLength(track);
    const activeCuesLength = getTrackActiveCuesLength(track);

    let score = 0;

    if (track.kind === "subtitles") score += 20;
    if (track.mode !== "disabled") score += 10;

    // Most important: avoid empty duplicate tracks.
    if (cuesLength > 0) score += 1000;

    // Prefer tracks currently producing text.
    if (activeCuesLength > 0) score += 200;

    // Small tie-breaker: more cues is usually the real content track.
    score += Math.min(cuesLength, 100);

    // Very small tie-breaker: later indices often looked more "real" in this Apple TV+ case.
    score += index * 0.001;

    return score;
  }

  function pickBestSubtitleTrack(textTracks, requestedLang) {
    const candidates = [...textTracks]
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => matchesRequestedLanguage(track, requestedLang));

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => {
      return (
        scoreSubtitleTrack(b.track, b.index) -
        scoreSubtitleTrack(a.track, a.index)
      );
    });

    return candidates[0].track;
  }

  function resolveSecondarySubtitleTrack(video, requestedLang) {
    if (!video || !video.textTracks) return null;

    const selectedTrack = pickBestSubtitleTrack(
      video.textTracks,
      requestedLang,
    );

    if (!selectedTrack) {
      return null;
    }

    // Keep hidden so native subtitle UI is not forced onscreen,
    // but activeCues / cuechange still work.
    if (selectedTrack.mode === "disabled") {
      selectedTrack.mode = "hidden";
    } else if (
      selectedTrack.mode !== "hidden" &&
      selectedTrack.mode !== "showing"
    ) {
      selectedTrack.mode = "hidden";
    }

    return selectedTrack;
  }

  function getCurrentCueText(track) {
    try {
      const cue = track?.activeCues?.[0];
      return normalizeSubtitleText(cue?.text || "");
    } catch {
      return "";
    }
  }

  function unbindSecondarySubtitleTrack() {
    if (secondaryTrackCleanup) {
      secondaryTrackCleanup();
      secondaryTrackCleanup = null;
    }
    secondaryTrackBound = null;
  }

  function bindSecondarySubtitleTrack(track, renderSecondarySubtitle) {
    if (!track || typeof renderSecondarySubtitle !== "function") return;

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

    const onSecondaryCueChange = () => {
      if (DEBUG_SECONDARY_SUBS) {
        const requestedSecondaryLanguage =
          state.requestedSecondaryLang || state.contentSettings.secondaryLang;
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(requestedSecondaryLanguage, track),
        );
      }
      renderSecondarySubtitle(getCurrentCueText(track), track);
    };

    track.addEventListener("cuechange", onSecondaryCueChange);

    secondaryTrackCleanup = () => {
      track.removeEventListener("cuechange", onSecondaryCueChange);
    };

    secondaryTrackBound = track;

    // Initial paint
    renderSecondarySubtitle(getCurrentCueText(track), track);
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
      if (found && found.video !== state.video) {
        state.video = found.video;
        state.dialogEl = found.dialog;
        bindTracks();
        renderCurrentSnapshot();
      }

      const requestedSecondaryLanguage =
        state.requestedSecondaryLang || state.contentSettings.secondaryLang;
      if (!state.video || !requestedSecondaryLanguage) return;

      syncSecondarySubtitleTrack(
        state.video,
        requestedSecondaryLanguage,
        renderSecondarySubtitle,
      );
      state.secondaryTrack = secondaryTrackBound;
    }, 2000);
  }

  function applyLayout(show) {
    const vc = document.querySelector(".video-player__video-container");
    if (!vc) return;

    if (show) {
      vc.style.width = "70%";
      vc.style.maxWidth = "70%";
      vc.style.flexShrink = "0";
    } else {
      vc.style.width = "";
      vc.style.maxWidth = "";
      vc.style.flexShrink = "";
    }
  }

  function showRightPanel() {
    if (!state.panelVisible) togglePanel();
  }

  function hideRightPanel() {
    if (state.panelVisible) togglePanel();
  }

  function pinRightPanel() {}

  function unpinRightPanel() {}

  function applySettingsToUI(settings) {
    if (settings.showSidebar) {
      showRightPanel();
    } else {
      hideRightPanel();
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
    });
  }

  function removeHost(id) {
    const root = getTarget();
    const el = root.querySelector(`#${id}`);
    if (el) el.remove();
  }

  function destroyUiHosts() {
    removeHost("atv-panel-host");
    removeHost("atv-toggle-btn");
    removeHost("atv-popup-host");
    removeHost("atv-debug-panel-host");
    removeHost("atv-overlay-host");
    state.panelShadowRoot = null;
    state.popupShadowRoot = null;
    state.debugPanelRoot = null;
    state.overlayRoot = null;
  }

  function createRightPanel() {
    if (getTarget().querySelector("#atv-panel-host")) {
      state.panelShadowRoot =
        getTarget().querySelector("#atv-panel-host")?.shadowRoot ||
        state.panelShadowRoot;
      ensureSecondarySubtitleElement();
      return;
    }

    const host = document.createElement("div");
    host.id = "atv-panel-host";
    host.style.cssText = [
      "position:fixed",
      "top:0",
      "right:0",
      "width:30%",
      "height:100vh",
      "z-index:99999",
      "pointer-events:auto",
      "box-sizing:border-box",
    ].join(";");
    getTarget().appendChild(host);

    state.panelShadowRoot = host.attachShadow({ mode: "open" });
    state.panelShadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        #panel {
          width: 100%; height: 100%;
          background: #1a1a1a; color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px; display: flex; flex-direction: column;
          overflow: hidden; box-sizing: border-box;
        }
        #panel-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 14px; background: #111;
          border-bottom: 1px solid #333; flex-shrink: 0;
        }
        #panel-header span {
          font-size: 12px; color: #888; font-weight: 600;
          letter-spacing: 0.05em; text-transform: uppercase;
        }
        #close-btn {
          background: none; border: 1px solid #444; color: #aaa;
          cursor: pointer; border-radius: 4px; padding: 2px 8px; font-size: 11px;
        }
        #close-btn:hover { background: #333; color: #fff; }
        #panel-scroll {
          flex: 1; overflow-y: auto; padding: 12px 14px; scroll-behavior: smooth;
        }
        #panel-scroll::-webkit-scrollbar { width: 4px; }
        #panel-scroll::-webkit-scrollbar-track { background: #222; }
        #panel-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
        .subtitle-block {
          margin-bottom: 12px; padding-bottom: 12px;
          border-bottom: 1px solid #2a2a2a; cursor: pointer;
        }
        .subtitle-block:hover { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 4px 6px; }
        .subtitle-block.current {
          background: #2a2a2a; border-radius: 6px; padding: 8px;
          border-left: 2px solid #ffe566; border-bottom: none; margin-bottom: 12px;
        }
        .subtitle-time {
          font-size: 10px; color: #555; margin-bottom: 4px; font-variant-numeric: tabular-nums;
        }
        .subtitle-block.current .subtitle-time { color: #ffe566; }
        .subtitle-primary { color: #aaa; font-size: 12px; line-height: 1.5; margin-bottom: 2px; }
        .subtitle-block.current .subtitle-primary { color: #fff; font-size: 14px; font-weight: 500; }
        .subtitle-secondary { color: #666; font-size: 11px; line-height: 1.5; }
        .subtitle-block.current .subtitle-secondary { color: #ccc; font-size: 13px; }
        .subtitle-future .subtitle-primary  { color: #555; }
        .subtitle-future .subtitle-secondary { color: #444; }
        .subtitle-future .subtitle-time      { color: #3a3a3a; }
        .dual-subtitles-secondary {
          color: #cfcfcf;
          font-size: 12px;
          line-height: 1.5;
          margin: 0 0 12px;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
        }
        ::slotted([data-secondary-subtitle]) {
          display: block;
          color: #cfcfcf;
          font-size: 12px;
          line-height: 1.5;
          margin: 0 0 12px;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          white-space: pre-wrap;
        }
        .atv-word { cursor: pointer; border-radius: 2px; padding: 0 1px; }
        .atv-word:hover { background: rgba(255,220,80,0.3); }
      </style>
      <div id="panel" class="dual-subtitles-panel" data-dual-subtitles-panel>
        <div id="panel-header">
          <span>📋 字幕履歴</span>
          <button id="close-btn">✕ 閉じる</button>
        </div>
        <div id="panel-scroll">
          <slot name="secondary-subtitle-slot"></slot>
          <div id="subtitle-list"></div>
        </div>
      </div>
    `;

    state.panelShadowRoot
      .getElementById("close-btn")
      .addEventListener("click", () => togglePanel());

    ensureSecondarySubtitleElement();
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
      togglePanel();
    });

    getTarget().appendChild(btn);
  }

  function createPopupHost() {
    if (getTarget().querySelector("#atv-popup-host")) {
      state.popupShadowRoot =
        getTarget().querySelector("#atv-popup-host")?.shadowRoot ||
        state.popupShadowRoot;
      return;
    }

    const host = document.createElement("div");
    host.id = "atv-popup-host";
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:999999;pointer-events:none;";
    getTarget().appendChild(host);

    state.popupShadowRoot = host.attachShadow({ mode: "open" });
    state.popupShadowRoot.innerHTML = `
      <style>
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

    const popup = state.popupShadowRoot.getElementById("popup");

    state.popupShadowRoot
      .getElementById("popup-close")
      .addEventListener("click", () => {
        popup.style.display = "none";
      });

    state.popupShadowRoot.querySelectorAll(".popup-tab").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.popupShadowRoot
          .querySelectorAll(".popup-tab")
          .forEach((b) => b.classList.remove("active"));
        state.popupShadowRoot
          .querySelectorAll(".popup-pane")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.popupShadowRoot
          .getElementById("pane-" + btn.dataset.tab)
          .classList.add("active");
      });
    });

    state.popupDocClickHandler = () => {
      popup.style.display = "none";
    };
    document.addEventListener("click", state.popupDocClickHandler);

    state.popupShadowRoot.addEventListener("click", (e) => {
      if (e.target.classList.contains("atv-word-link")) {
        e.stopPropagation();
        const word = e.target.textContent.trim();
        if (word) {
          const rect = e.target.getBoundingClientRect();
          showPopup(word, word, rect);
        }
      }
    });
  }

  function createDebugPanel() {
    if (getTarget().querySelector("#atv-debug-panel-host")) {
      state.debugPanelRoot =
        getTarget().querySelector("#atv-debug-panel-host")?.shadowRoot ||
        state.debugPanelRoot;
      return;
    }

    const host = document.createElement("div");
    host.id = "atv-debug-panel-host";
    host.style.cssText = [
      "position:fixed",
      "left:16px",
      "top:16px",
      "z-index:999999",
      "pointer-events:auto",
    ].join(";");

    getTarget().appendChild(host);
    state.debugPanelRoot = host.attachShadow({ mode: "open" });

    state.debugPanelRoot.innerHTML = `
      <style>
        #debug-wrap {
          width: 360px;
          background: rgba(12,12,14,0.92);
          color: #f3f5f7;
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.45);
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        }
        #debug-head {
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:8px;
          padding:10px 12px;
          background: rgba(255,255,255,0.05);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        #debug-title {
          font-size:12px;
          font-weight:700;
          letter-spacing:0.04em;
          color:#ffe566;
          text-transform:uppercase;
        }
        #debug-actions {
          display:flex;
          gap:6px;
        }
        .debug-btn {
          min-height:28px;
          border:1px solid rgba(255,255,255,0.14);
          border-radius:8px;
          background:#23262d;
          color:#fff;
          font-size:11px;
          cursor:pointer;
          padding:0 10px;
        }
        .debug-btn:hover {
          background:#2d323b;
        }
        #debug-log {
          display:block;
          width:100%;
          height:220px;
          resize:vertical;
          border:none;
          outline:none;
          padding:12px;
          margin:0;
          background:#111318;
          color:#d8dee9;
          font-size:11px;
          line-height:1.5;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          box-sizing:border-box;
        }
      </style>
      <div id="debug-wrap">
        <div id="debug-head">
          <div id="debug-title">ATV Debug</div>
          <div id="debug-actions">
            <button id="debug-refresh" class="debug-btn" type="button">更新</button>
            <button id="debug-copy" class="debug-btn" type="button">コピー</button>
          </div>
        </div>
        <textarea id="debug-log" readonly></textarea>
      </div>
    `;

    state.debugPanelRoot
      .getElementById("debug-refresh")
      .addEventListener("click", () => {
        updateLiveDebugPanel();
      });

    state.debugPanelRoot
      .getElementById("debug-copy")
      .addEventListener("click", async () => {
        const text = await getDebugLogText();
        try {
          await navigator.clipboard.writeText(text);
          logContent("Debug panel copied logs");
        } catch (error) {
          logContent("Debug panel copy failed", { error: String(error) });
        }
      });

    updateLiveDebugPanel();
  }

  async function updateLiveDebugPanel() {
    if (!state.debugPanelRoot) return;
    try {
      const text = await getDebugLogText();
      const textarea = state.debugPanelRoot.getElementById("debug-log");
      if (!textarea) return;
      textarea.value = text;
      textarea.scrollTop = textarea.scrollHeight;
    } catch (error) {
      console.warn("[ATV-Bilingual] updateLiveDebugPanel failed:", error);
    }
  }

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

  function renderPanel() {
    if (!state.panelShadowRoot) return;
    const list = state.panelShadowRoot.getElementById("subtitle-list");
    if (!list) return;

    const currentTime = state.video ? state.video.currentTime : 0;
    const allBlocks = [];

    state.subtitleHistory.forEach((h) => {
      if (h.endTime <= currentTime) allBlocks.push({ ...h, state: "past" });
    });

    const curPrimaryCue = findCueAt(state.primaryTrack, currentTime);
    const curSecondaryCue = findCueAt(state.secondaryTrack, currentTime);
    if (curPrimaryCue) {
      allBlocks.push({
        startTime: curPrimaryCue.startTime,
        endTime: curPrimaryCue.endTime,
        primary: cleanCueText(curPrimaryCue),
        secondary: cleanCueText(curSecondaryCue),
        state: "current",
      });
    }

    if (state.primaryTrack && state.primaryTrack.cues) {
      for (let i = 0; i < state.primaryTrack.cues.length; i++) {
        const c = state.primaryTrack.cues[i];
        if (c.startTime > currentTime + 0.1) {
          const sc = findCueAt(state.secondaryTrack, c.startTime + 0.05);
          allBlocks.push({
            startTime: c.startTime,
            endTime: c.endTime,
            primary: cleanCueText(c),
            secondary: cleanCueText(sc),
            state: "future",
          });
        }
      }
    }

    list.innerHTML = allBlocks
      .map((block) => {
        const isCurrent = block.state === "current";
        const isFuture = block.state === "future";
        const cls = isCurrent
          ? "subtitle-block current"
          : isFuture
            ? "subtitle-block subtitle-future"
            : "subtitle-block";
        const mid = isCurrent ? 'id="current-block"' : "";
        const pText = makeClickableSpans(block.primary, block.primary);
        const sText = makeClickableSpans(block.secondary, block.primary);
        return `
        <div class="${cls}" ${mid} data-time="${block.startTime}">
          <div class="subtitle-time">${isCurrent ? "▶ " : ""}${formatTime(block.startTime)}</div>
          <div class="subtitle-primary">${pText}</div>
          ${sText ? `<div class="subtitle-secondary">${sText}</div>` : ""}
        </div>
      `;
      })
      .join("");

    list.querySelectorAll(".subtitle-block").forEach((blockEl) => {
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

    const currentBlock = state.panelShadowRoot.getElementById("current-block");
    if (currentBlock) {
      currentBlock.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function createOverlay() {
    if (getTarget().querySelector("#atv-overlay-host")) {
      state.overlayRoot =
        getTarget().querySelector("#atv-overlay-host")?.shadowRoot ||
        state.overlayRoot;
      return;
    }

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
    getTarget().appendChild(host);

    state.overlayRoot = host.attachShadow({ mode: "open" });
    state.overlayRoot.innerHTML = `
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

    p.querySelectorAll(".atv-word").forEach((span) => {
      span.addEventListener("click", (e) => {
        e.stopPropagation();
        showPopup(
          span.dataset.word,
          decodeURIComponent(span.dataset.sentence),
          span.getBoundingClientRect(),
        );
      });
    });
  }

  function togglePanel(force) {
    if (typeof force === "boolean") state.panelVisible = force;
    else state.panelVisible = !state.panelVisible;

    applyLayout(state.panelVisible);

    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost = getTarget().querySelector("#atv-overlay-host");
    const toggleBtn = getTarget().querySelector("#atv-toggle-btn");

    if (panelHost) panelHost.style.display = state.panelVisible ? "" : "none";
    if (overlayHost)
      overlayHost.style.width = state.panelVisible ? "70%" : "100%";
    if (toggleBtn)
      toggleBtn.style.display = state.panelVisible ? "none" : "block";

    logContent("togglePanel", { panelVisible: state.panelVisible });
  }

  function onCueChange() {
    const pCue = state.primaryTrack?.activeCues?.[0] ?? null;
    const pText = cleanCueText(pCue);
    const sCue = findCueAt(state.secondaryTrack, state.video?.currentTime ?? 0);
    const sText = cleanCueText(sCue);

    updateOverlay(pText, sText);

    if (pText && pText !== state.lastPrimaryText && pCue) {
      state.lastPrimaryText = pText;
      state.subtitleHistory.push({
        startTime: pCue.startTime,
        endTime: pCue.endTime,
        primary: pText,
        secondary: sText,
      });
      if (state.subtitleHistory.length > 500) state.subtitleHistory.shift();
    }

    renderPanel();
  }

  function clearTrackBindings() {
    unbindSecondarySubtitleTrack();

    if (state.primaryTrack) {
      try {
        state.primaryTrack.removeEventListener("cuechange", onCueChange);
      } catch (_) {}
    }

    if (state.video?.textTracks) {
      for (let i = 0; i < state.video.textTracks.length; i++) {
        try {
          state.video.textTracks[i].mode = "hidden";
        } catch (_) {}
      }
    }

    if (state.secondaryHideTimer) {
      clearTimeout(state.secondaryHideTimer);
      state.secondaryHideTimer = null;
    }

    state.primaryTrack = null;
    state.secondaryTrack = null;
  }

  function resetRuntimeState(options = {}) {
    state.subtitleHistory = [];
    state.lastPrimaryText = "";
    if (options.keepPanelVisible !== true) state.panelVisible = true;
  }

  function teardownForRestart() {
    clearTrackBindings();

    if (state.popupDocClickHandler) {
      document.removeEventListener("click", state.popupDocClickHandler);
      state.popupDocClickHandler = null;
    }

    destroyUiHosts();
    applyLayout(false);
  }

  function bindTracks() {
    const tracks = state.video?.textTracks;
    if (!tracks) return;

    clearTrackBindings();

    state.primaryTrack = pickBestSubtitleTrack(
      tracks,
      state.contentSettings.primaryLang,
    );
    const requestedSecondaryLanguage =
      state.requestedSecondaryLang || state.contentSettings.secondaryLang;
    syncSecondarySubtitleTrack(
      state.video,
      requestedSecondaryLanguage,
      renderSecondarySubtitle,
    );
    state.secondaryTrack = secondaryTrackBound;

    if (state.primaryTrack) {
      try {
        state.primaryTrack.mode = "hidden";
        state.primaryTrack.addEventListener("cuechange", onCueChange);
      } catch (_) {}
    }
  }

  function buildUi() {
    createOverlay();
    createRightPanel();
    ensureSecondarySubtitleElement();
    createPopupHost();
    createToggleButton();
    createDebugPanel();
  }

  function renderCurrentSnapshot() {
    ensureSecondarySubtitleElement();
    onCueChange();
    applySettingsToUI(state.contentSettings);
    if (secondaryTrackBound) {
      renderSecondarySubtitle(
        getCurrentCueText(secondaryTrackBound),
        secondaryTrackBound,
      );
    }
  }

  function startBilingual() {
    if (!state.video) return;

    bindTracks();
    const requestedSecondaryLanguage =
      state.requestedSecondaryLang || state.contentSettings.secondaryLang;
    if (state.video && requestedSecondaryLanguage) {
      syncSecondarySubtitleTrack(
        state.video,
        requestedSecondaryLanguage,
        renderSecondarySubtitle,
      );
      state.secondaryTrack = secondaryTrackBound;
    }

    logContent("Selected tracks detail", {
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

    buildUi();
    ensureSecondarySubtitleElement();

    if (state.secondaryTrack) {
      renderSecondarySubtitle(
        getCurrentCueText(state.secondaryTrack),
        state.secondaryTrack,
      );
    }

    state.panelVisible = true;
    renderCurrentSnapshot();

    logContent("startBilingual ready", {
      injectedInto: state.dialogEl ? "dialog.playback-view" : "document.body",
      primaryLang: state.contentSettings.primaryLang,
      secondaryLang: state.contentSettings.secondaryLang,
      primaryTrackFound: !!state.primaryTrack,
      secondaryTrackFound: !!state.secondaryTrack,
      ejdictLoaded: !!state.ejdictMap,
    });

    console.log(
      "[ATV-Bilingual] v2.5 ready | injected into:",
      state.dialogEl ? "dialog.playback-view ✅" : "document.body (fallback)",
      "| tracks:",
      state.contentSettings.primaryLang,
      "+",
      state.contentSettings.secondaryLang,
      "| EJDict:",
      state.ejdictMap
        ? Object.keys(state.ejdictMap).length + " entries"
        : "loading...",
    );
  }

  function attachTracks(v) {
    state.video = v;
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

  function loadSettingsFromSync() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (rawSettings) => {
      state.requestedSecondaryLang = rawSettings.secondaryLang || "";
      state.contentSettings = applySecondaryLangFallback(rawSettings);
      const requestedSecondaryLanguage =
        state.requestedSecondaryLang || state.contentSettings.secondaryLang;
      if (state.video && requestedSecondaryLanguage) {
        syncSecondarySubtitleTrack(
          state.video,
          requestedSecondaryLanguage,
          renderSecondarySubtitle,
        );
        state.secondaryTrack = secondaryTrackBound;
      }
      logContent("Loaded settings from sync", {
        ...state.contentSettings,
        requestedSecondaryLang: state.requestedSecondaryLang,
      });
      startBilingual();
    });
  }

  function restartBilingual(nextSettings = null, reason = "unknown") {
    if (state.restarting) {
      logContent("restartBilingual skipped: already restarting", { reason });
      return;
    }

    state.restarting = true;
    try {
      if (nextSettings) {
        state.requestedSecondaryLang = nextSettings.secondaryLang || "";
        state.contentSettings = applySecondaryLangFallback({
          ...state.contentSettings,
          ...nextSettings,
        });
      }

      const found = getVideoAndDialog();
      if (found) {
        state.video = found.video;
        state.dialogEl = found.dialog;
      }

      logContent("restartBilingual begin", {
        reason,
        hasVideo: !!state.video,
        trackCount: state.video?.textTracks?.length ?? 0,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLang: state.requestedSecondaryLang,
      });

      teardownForRestart();
      resetRuntimeState();
      startBilingual();
      ensureSecondarySubtitleElement();

      logContent("restartBilingual done", { reason });
    } finally {
      state.restarting = false;
    }
  }

  const onRuntimeMessage = (message, sender, sendResponse) => {
    if (message.type === "SETTINGS_CHANGED") {
      const updated = { ...message.settings };
      const next = applySecondaryLangFallback({
        ...state.contentSettings,
        ...updated,
      });

      logContent("SETTINGS_CHANGED received", {
        settings: {
          ...next,
          requestedSecondaryLang:
            updated.secondaryLang ?? state.requestedSecondaryLang,
        },
      });

      const requestedSecondaryLanguage =
        updated.secondaryLang ?? next.secondaryLang;
      if (state.video && requestedSecondaryLanguage) {
        syncSecondarySubtitleTrack(
          state.video,
          requestedSecondaryLanguage,
          renderSecondarySubtitle,
        );
        state.secondaryTrack = secondaryTrackBound;
      }

      restartBilingual(updated, "SETTINGS_CHANGED");

      logContent("content applied settings to tracks", {
        hasVideo: !!state.video,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLanguage:
          state.requestedSecondaryLang || state.contentSettings.secondaryLang,
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
    logContent("content startup begin");
    ensureMessageListener();
    ensureSecondaryTrackSyncInterval();
    waitForVideo(attachTracks);
  }

  boot();
})();
