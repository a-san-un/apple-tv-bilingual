// =============================================================
// Apple TV+ Bilingual Subtitles - content.js v2.5
// =============================================================
//
// Architecture notes:
//
// 1. TOP LAYER PROBLEM
//    Apple TV+ renders its player inside a <dialog class="playback-view">
//    element. The browser promotes <dialog> to the "top layer", which
//    sits above all z-index stacking contexts in document.body.
//    Solution: inject all UI elements directly into the <dialog>.
//
// 2. CORS PROBLEM
//    fetch() calls from tv.apple.com to jisho.org are blocked by CORS.
//    Solution: route all external API calls through background.js,
//    which runs as a service worker and is not subject to CORS.
//
// 3. SW KEEPALIVE PROBLEM
//    Manifest V3 service workers auto-stop after ~30s of inactivity.
//    Solution: sendToBackground() retries once after 300ms if the SW
//    was asleep and didn't respond.
//
// 4. LAYOUT
//    - Video container is shrunk to 70% width to make room for the panel.
//    - Right panel (30% width) shows subtitle history + future lines.
//    - Overlay shows the current bilingual subtitle at the bottom-left.
//    - Toggle button (top-right at 60px, only when panel is hidden) reopens panel.
//
// 5. EJDICT (v2.5)
//    - ejdict.json (47,010 entries, CC0) is bundled at dict/ejdict.json.
//    - Loaded once at startup via chrome.runtime.getURL, stored in ejdictMap.
//    - Used as fast local fallback / Japanese gloss in the dict pane.
//
// =============================================================

(function () {
  "use strict";

  // -------------------------------------------------------
  // Default settings (mirrors options.js)
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // secondaryLang fallback: use browser language if not set
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  let video = null;
  let primaryTrack = null;
  let secondaryTrack = null;
  let contentSettings = { ...DEFAULT_SETTINGS };
  let subtitleHistory = [];
  let panelVisible = true;
  let shadowRoot = null;
  let popupShadowRoot = null;
  let dialogEl = null;
  let ejdictMap = null;
  let debugPanelRoot = null;
  let lastPrimaryText = "";

  // -------------------------------------------------------
  // Debug helpers
  // -------------------------------------------------------
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

        if (typeof value === "object" && value !== null) {
          walk(value);
        }
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

  // -------------------------------------------------------
  // EJDict: load dict/ejdict.json at startup
  // -------------------------------------------------------
  (async function loadEJDict() {
    try {
      const url = chrome.runtime.getURL("dict/ejdict.json");
      const res = await fetch(url);
      ejdictMap = await res.json();
      logContent("EJDict loaded", {
        entries: Object.keys(ejdictMap).length,
      });
    } catch (e) {
      logContent("EJDict load failed", { error: e.message });
      console.warn("[ATV-Bilingual] EJDict load failed:", e.message);
    }
  })();

  function ejdictLookup(word) {
    if (!ejdictMap) return null;
    return ejdictMap[word] || ejdictMap[word.toLowerCase()] || null;
  }

  // -------------------------------------------------------
  // Utilities
  // -------------------------------------------------------
  function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function cleanCueText(cue) {
    if (!cue) return "";
    if (cue.getCueAsHTML) return cue.getCueAsHTML().textContent || "";
    return (cue.text || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function findCueAt(track, time) {
    if (!track || !track.cues) return null;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      if (c.startTime <= time + 0.1 && time < c.endTime + 0.1) return c;
    }
    return null;
  }

  // -------------------------------------------------------
  // sendToBackground
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // Injection target
  // -------------------------------------------------------
  function getTarget() {
    return dialogEl || document.body;
  }

  // -------------------------------------------------------
  // Boot: wait until <video>, textTracks, and <dialog> are ready
  // -------------------------------------------------------
  function waitForVideo(cb) {
    const check = () => {
      const v = document.querySelector("video");
      const d = document.querySelector("dialog.playback-view");
      if (v && v.textTracks && v.textTracks.length > 1 && d) {
        dialogEl = d;
        logContent("waitForVideo resolved", {
          hasVideo: true,
          trackCount: v.textTracks.length,
          injectedIntoDialog: true,
        });
        cb(v);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  }

  // -------------------------------------------------------
  // Track helpers
  // -------------------------------------------------------
  function getUniqueTracks(textTracks) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if (t.kind !== "subtitles" && t.kind !== "captions") continue;
      const key = t.language + "::" + t.label.trim();
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          index: i,
          lang: t.language,
          label: t.label.trim(),
          track: t,
        });
      }
    }
    return result;
  }

  function findBestTrack(textTracks, lang) {
    const candidates = [];
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if (
        (t.kind === "subtitles" || t.kind === "captions") &&
        t.language === lang
      ) {
        candidates.push(t);
      }
    }
    if (candidates.length === 0) return null;
    return candidates.find((t) => t.cues && t.cues.length > 0) || candidates[0];
  }

  // -------------------------------------------------------
  // Layout
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // Apply settings to UI
  // -------------------------------------------------------
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

  function showRightPanel() {
    if (!panelVisible) togglePanel();
  }

  function hideRightPanel() {
    if (panelVisible) togglePanel();
  }

  function pinRightPanel() {}

  function unpinRightPanel() {}

  // -------------------------------------------------------
  // Right panel
  // -------------------------------------------------------
  function createRightPanel() {
    if (getTarget().querySelector("#atv-panel-host")) return;

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

    shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
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
        .atv-word { cursor: pointer; border-radius: 2px; padding: 0 1px; }
        .atv-word:hover { background: rgba(255,220,80,0.3); }
      </style>
      <div id="panel">
        <div id="panel-header">
          <span>📋 字幕履歴</span>
          <button id="close-btn">✕ 閉じる</button>
        </div>
        <div id="panel-scroll"><div id="subtitle-list"></div></div>
      </div>
    `;

    shadowRoot
      .getElementById("close-btn")
      .addEventListener("click", () => togglePanel());
  }

  // -------------------------------------------------------
  // Toggle button
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // Popup
  // -------------------------------------------------------
  function createPopupHost() {
    if (getTarget().querySelector("#atv-popup-host")) return;

    const host = document.createElement("div");
    host.id = "atv-popup-host";
    host.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;z-index:999999;pointer-events:none;";
    getTarget().appendChild(host);

    popupShadowRoot = host.attachShadow({ mode: "open" });
    popupShadowRoot.innerHTML = `
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

    const popup = popupShadowRoot.getElementById("popup");

    popupShadowRoot
      .getElementById("popup-close")
      .addEventListener("click", () => {
        popup.style.display = "none";
      });

    popupShadowRoot.querySelectorAll(".popup-tab").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        popupShadowRoot
          .querySelectorAll(".popup-tab")
          .forEach((b) => b.classList.remove("active"));
        popupShadowRoot
          .querySelectorAll(".popup-pane")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        popupShadowRoot
          .getElementById("pane-" + btn.dataset.tab)
          .classList.add("active");
      });
    });

    document.addEventListener("click", () => {
      popup.style.display = "none";
    });

    popupShadowRoot.addEventListener("click", (e) => {
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

  // -------------------------------------------------------
  // Debug panel
  // -------------------------------------------------------
  function createDebugPanel() {
    if (getTarget().querySelector("#atv-debug-panel-host")) return;

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
    debugPanelRoot = host.attachShadow({ mode: "open" });

    debugPanelRoot.innerHTML = `
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

    debugPanelRoot
      .getElementById("debug-refresh")
      .addEventListener("click", () => {
        updateLiveDebugPanel();
      });

    debugPanelRoot
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
    if (!debugPanelRoot) return;
    try {
      const text = await getDebugLogText();
      const textarea = debugPanelRoot.getElementById("debug-log");
      if (!textarea) return;
      textarea.value = text;
      textarea.scrollTop = textarea.scrollHeight;
    } catch (error) {
      console.warn("[ATV-Bilingual] updateLiveDebugPanel failed:", error);
    }
  }

  // -------------------------------------------------------
  // Show popup
  // -------------------------------------------------------
  function showPopup(word, sentence, anchorRect) {
    if (!popupShadowRoot) return;

    const clean = word.replace(
      /[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF]/g,
      "",
    );
    if (!clean) return;

    logContent("showPopup", {
      word: clean,
      sentenceLength: (sentence || "").length,
    });

    const popup = popupShadowRoot.getElementById("popup");
    popupShadowRoot.getElementById("popup-word").textContent = clean;
    popupShadowRoot.getElementById("popup-reading").textContent = "";
    popupShadowRoot.getElementById("popup-badges").innerHTML = "";
    popupShadowRoot.getElementById("pane-dict").innerHTML =
      '<span class="loading">検索中...</span>';
    popupShadowRoot.getElementById("pane-ai").innerHTML =
      '<span class="loading">翻訳中...</span>';

    popupShadowRoot
      .querySelectorAll(".popup-tab")
      .forEach((b) => b.classList.remove("active"));
    popupShadowRoot
      .querySelectorAll(".popup-pane")
      .forEach((b) => b.classList.remove("active"));
    popupShadowRoot.querySelector('[data-tab="dict"]').classList.add("active");
    popupShadowRoot.getElementById("pane-dict").classList.add("active");

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

  // -------------------------------------------------------
  // Dictionary fetch
  // -------------------------------------------------------
  function fetchDictionary(word) {
    const paneDict = popupShadowRoot.getElementById("pane-dict");
    const badgesEl = popupShadowRoot.getElementById("popup-badges");
    const readingEl = popupShadowRoot.getElementById("popup-reading");

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
      const jishoEl = popupShadowRoot.getElementById("jisho-section");
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
      const tatEl = popupShadowRoot.getElementById("tatoeba-section");
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

  // -------------------------------------------------------
  // Translation fetch
  // -------------------------------------------------------
  function fetchTranslation(text) {
    const el = popupShadowRoot.getElementById("pane-ai");

    logContent("fetchTranslation UI start", {
      textLength: (text || "").length,
    });

    sendToBackground({ type: "FETCH_TRANSLATE", text }, (res) => {
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

  // -------------------------------------------------------
  // Render clickable word spans
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // Right panel rendering
  // -------------------------------------------------------
  function renderPanel() {
    if (!shadowRoot) return;
    const list = shadowRoot.getElementById("subtitle-list");
    if (!list) return;

    const currentTime = video ? video.currentTime : 0;
    const allBlocks = [];

    subtitleHistory.forEach((h) => {
      if (h.endTime <= currentTime) allBlocks.push({ ...h, state: "past" });
    });

    const curPrimaryCue = findCueAt(primaryTrack, currentTime);
    const curSecondaryCue = findCueAt(secondaryTrack, currentTime);
    if (curPrimaryCue) {
      allBlocks.push({
        startTime: curPrimaryCue.startTime,
        endTime: curPrimaryCue.endTime,
        primary: cleanCueText(curPrimaryCue),
        secondary: cleanCueText(curSecondaryCue),
        state: "current",
      });
    }

    if (primaryTrack && primaryTrack.cues) {
      for (let i = 0; i < primaryTrack.cues.length; i++) {
        const c = primaryTrack.cues[i];
        if (c.startTime > currentTime + 0.1) {
          const sc = findCueAt(secondaryTrack, c.startTime + 0.05);
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
        if (video && !isNaN(t)) {
          video.currentTime = t;
          setTimeout(() => renderPanel(), 100);
        }
      });
    });

    const currentBlock = shadowRoot.getElementById("current-block");
    if (currentBlock) {
      currentBlock.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // -------------------------------------------------------
  // Overlay
  // -------------------------------------------------------
  function createOverlay() {
    if (getTarget().querySelector("#atv-overlay-host")) return;

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

    const overlayRoot = host.attachShadow({ mode: "open" });
    overlayRoot.innerHTML = `
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
    window.__atvOverlayRoot = overlayRoot;
  }

  function updateOverlay(primaryText, secondaryText) {
    const root = window.__atvOverlayRoot;
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

  // -------------------------------------------------------
  // Toggle panel open/close
  // -------------------------------------------------------
  function togglePanel() {
    panelVisible = !panelVisible;
    applyLayout(panelVisible);

    const panelHost = getTarget().querySelector("#atv-panel-host");
    const overlayHost = getTarget().querySelector("#atv-overlay-host");
    const toggleBtn = getTarget().querySelector("#atv-toggle-btn");

    if (panelHost) panelHost.style.display = panelVisible ? "" : "none";
    if (overlayHost) overlayHost.style.width = panelVisible ? "70%" : "100%";
    if (toggleBtn) toggleBtn.style.display = panelVisible ? "none" : "block";

    logContent("togglePanel", { panelVisible });
  }

  // -------------------------------------------------------
  // cuechange handler
  // -------------------------------------------------------
  function onCueChange() {
    const pCue = primaryTrack?.activeCues?.[0] ?? null;
    const pText = cleanCueText(pCue);
    const sCue = findCueAt(secondaryTrack, video?.currentTime ?? 0);
    const sText = cleanCueText(sCue);

    updateOverlay(pText, sText);

    if (pText && pText !== lastPrimaryText && pCue) {
      lastPrimaryText = pText;
      subtitleHistory.push({
        startTime: pCue.startTime,
        endTime: pCue.endTime,
        primary: pText,
        secondary: sText,
      });
      if (subtitleHistory.length > 500) subtitleHistory.shift();
    }

    renderPanel();
  }

  // -------------------------------------------------------
  // Initialise tracks and build UI
  // -------------------------------------------------------
  function attachTracks(v) {
    video = v;
    logContent("attachTracks", { trackCount: v?.textTracks?.length ?? 0 });
    loadSettingsFromSync();
  }

  function startBilingual() {
    if (!video) return;

    const tracks = video.textTracks;
    if (primaryTrack)
      primaryTrack.removeEventListener("cuechange", onCueChange);

    for (let i = 0; i < tracks.length; i++) tracks[i].mode = "hidden";

    primaryTrack = findBestTrack(tracks, contentSettings.primaryLang);
    secondaryTrack = findBestTrack(tracks, contentSettings.secondaryLang);

    if (secondaryTrack) {
      secondaryTrack.mode = "showing";
      setTimeout(() => {
        if (secondaryTrack) secondaryTrack.mode = "hidden";
      }, 500);
    }

    if (primaryTrack) {
      primaryTrack.mode = "hidden";
      primaryTrack.addEventListener("cuechange", onCueChange);
    }

    createOverlay();
    createRightPanel();
    createPopupHost();
    createToggleButton();
    createDebugPanel();

    panelVisible = true;
    applySettingsToUI(contentSettings);

    logContent("startBilingual ready", {
      injectedInto: dialogEl ? "dialog.playback-view" : "document.body",
      primaryLang: contentSettings.primaryLang,
      secondaryLang: contentSettings.secondaryLang,
      primaryTrackFound: !!primaryTrack,
      secondaryTrackFound: !!secondaryTrack,
      ejdictLoaded: !!ejdictMap,
    });

    console.log(
      "[ATV-Bilingual] v2.5 ready | injected into:",
      dialogEl ? "dialog.playback-view ✅" : "document.body (fallback)",
      "| tracks:",
      contentSettings.primaryLang,
      "+",
      contentSettings.secondaryLang,
      "| EJDict:",
      ejdictMap ? Object.keys(ejdictMap).length + " entries" : "loading...",
    );
  }

  function loadSettingsFromSync() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (rawSettings) => {
      contentSettings = applySecondaryLangFallback(rawSettings);
      logContent("Loaded settings from sync", contentSettings);
      startBilingual();
    });
  }

  // -------------------------------------------------------
  // Messages
  // -------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SETTINGS_CHANGED") {
      const updated = applySecondaryLangFallback(message.settings || {});
      contentSettings = { ...contentSettings, ...updated };

      logContent("SETTINGS_CHANGED received", {
        settings: updated,
      });

      subtitleHistory = [];
      lastPrimaryText = "";

      if (video) startBilingual();

      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "GET_LANGUAGES") {
      const langs = video ? getUniqueTracks(video.textTracks) : [];
      logContent("GET_LANGUAGES handled", { count: langs.length });
      sendResponse(langs.map((l) => ({ lang: l.lang, label: l.label })));
      return true;
    }
  });

  // -------------------------------------------------------
  // Boot
  // -------------------------------------------------------
  logContent("content script boot");
  waitForVideo(attachTracks);
})();
