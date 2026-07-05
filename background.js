// =============================================================
// background.js - Service Worker
// version: 2.6.0
// Issue #4: Debug ログ保存を saveAs ダイアログ経由で扱う
// 既存の SETTINGS_CHANGED 導線は維持し、最小差分で追加する
// =============================================================

const DEBUG_LOGS_KEY = "debugLogs";
const DEBUG_LOGS_MAX = 400;
let trackedAppleTvTabId = null;

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
  const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
    await chrome.storage.local.get(DEBUG_LOGS_KEY);
  debugLogs.push(line);
  if (debugLogs.length > DEBUG_LOGS_MAX) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
  }
  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
}

async function logBackground(message, payload = null) {
  const line = debugLog("background", message, payload);
  await appendDebugLog(line);
}

async function fetchJsonWithLogging(url, meta = {}) {
  const start = Date.now();
  const response = await fetch(url);

  await logBackground(`${meta.label} response`, {
    ...meta,
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - start,
  });

  if (!response.ok) {
    throw new Error(`${meta.label} failed with status ${response.status}`);
  }

  return response.json();
}

function isAppleTvUrl(url) {
  return typeof url === "string" && url.startsWith("https://tv.apple.com/");
}

async function updateTrackedAppleTvTab(tabId, url, reason) {
  if (!Number.isInteger(tabId) || !isAppleTvUrl(url)) return;
  const changed = trackedAppleTvTabId !== tabId;
  trackedAppleTvTabId = tabId;
  if (changed) {
    await logBackground("tracked Apple TV tab updated", {
      tabId,
      url,
      reason,
    });
  }
}

async function findAppleTvTabId() {
  if (Number.isInteger(trackedAppleTvTabId)) {
    try {
      const tab = await chrome.tabs.get(trackedAppleTvTabId);
      if (isAppleTvUrl(tab?.url)) {
        return trackedAppleTvTabId;
      }
    } catch (_) {}
  }

  const tabs = await chrome.tabs.query({ url: ["https://tv.apple.com/*"] });
  const candidate = tabs && tabs.length ? tabs[0] : null;
  if (candidate?.id && isAppleTvUrl(candidate.url)) {
    await updateTrackedAppleTvTab(candidate.id, candidate.url, "tabs_query");
    return candidate.id;
  }

  trackedAppleTvTabId = null;
  return null;
}

async function sendSettingsChangedWithRecovery(
  tabId,
  reason = "tab_activated",
  settings = null,
) {
  const message = {
    type: "SETTINGS_CHANGED",
    reason,
  };
  if (settings && typeof settings === "object") {
    message.settings = settings;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    await logBackground("SETTINGS_CHANGED sent", { tabId, reason });
    return { ok: true, tabId, reason, response: response ?? null };
  } catch (error) {
    const errorText = String(error);
    await logBackground("SETTINGS_CHANGED send failed", {
      tabId,
      reason,
      error: errorText,
    });

    if (!errorText.includes("Receiving end does not exist")) {
      return { ok: false, tabId, reason, error: errorText };
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["overlay.css"],
      });
      await logBackground("content script reinjected", { tabId, reason });
    } catch (injectError) {
      const injectErrorText = String(injectError);
      await logBackground("content script reinject failed", {
        tabId,
        reason,
        error: injectErrorText,
      });
      return { ok: false, tabId, reason, error: injectErrorText };
    }

    try {
      const retryResponse = await chrome.tabs.sendMessage(tabId, message);
      await logBackground("SETTINGS_CHANGED sent after reinject", {
        tabId,
        reason,
      });
      return {
        ok: true,
        tabId,
        reason,
        retried: true,
        response: retryResponse ?? null,
      };
    } catch (retryError) {
      const retryErrorText = String(retryError);
      await logBackground("SETTINGS_CHANGED retry failed", {
        tabId,
        reason,
        error: retryErrorText,
      });
      return { ok: false, tabId, reason, error: retryErrorText };
    }
  }
}

async function notifySettingsChangedToTab(tabId, reason = "tab_activated") {
  await sendSettingsChangedWithRecovery(tabId, reason);
}

// Keep the service worker alive and claim clients immediately on activation.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ATV-Bilingual] background.js installed/updated");
  logBackground("background.js installed/updated").catch(() => {});
});

// Apply saved settings when the user returns to an Apple TV+ tab.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (!isAppleTvUrl(tab?.url)) {
      return;
    }

    await updateTrackedAppleTvTab(tabId, tab.url, "tabs_onActivated");

    await notifySettingsChangedToTab(tabId, "tab_activated");
  } catch (error) {
    await logBackground("tabs.onActivated error", {
      tabId,
      error: String(error),
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    const url = changeInfo.url || tab?.url;
    if (!isAppleTvUrl(url)) return;
    await updateTrackedAppleTvTab(tabId, url, "tabs_onUpdated");
  } catch (error) {
    await logBackground("tabs.onUpdated error", {
      tabId,
      error: String(error),
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (trackedAppleTvTabId === tabId) {
    trackedAppleTvTabId = null;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ---------- Unified settings dispatch ----------
  if (msg.type === "APPLY_SETTINGS_TO_APPLE_TV") {
    (async () => {
      try {
        const settings = msg.settings || null;
        await logBackground("APPLY_SETTINGS_TO_APPLE_TV requested", {
          reason: msg.reason || "unknown",
          settings,
        });

        const tabId = await findAppleTvTabId();
        if (!Number.isInteger(tabId)) {
          await logBackground("Apple TV tab not found", {
            reason: msg.reason || "unknown",
          });
          sendResponse({ ok: false, error: "no_active_apple_tv_tab" });
          return;
        }

        await logBackground("sending SETTINGS_CHANGED to Apple TV tab", {
          tabId,
          reason: msg.reason || "unknown",
          settings,
        });

        const result = await sendSettingsChangedWithRecovery(
          tabId,
          msg.reason || "apply_settings",
          settings,
        );
        sendResponse(result);
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  // ---------- Debug log download (saveAs dialog) ----------
  if (msg.type === "DOWNLOAD_DEBUG_LOG") {
    (async () => {
      try {
        const text = String(msg.text || "");
        const filename = `atvb-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
        const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;

        // 保存先選択を優先して、ユーザーに保存場所を選ばせる。
        const downloadId = await chrome.downloads.download({
          url,
          filename,
          saveAs: true,
          conflictAction: "uniquify",
        });

        await logBackground("debug log download requested", {
          filename,
          downloadId,
          lineCount: text ? text.split("\n").length : 0,
        });

        sendResponse({ ok: true, downloadId });
      } catch (error) {
        await logBackground("debug log download failed", {
          error: String(error),
        });
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }

  // ---------- Dictionary lookup (Jisho) ----------
  if (msg.type === "FETCH_DICT") {
    (async () => {
      try {
        await logBackground("fetchDictionary start", {
          word: msg.word,
          source: "jisho",
        });

        const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(msg.word)}`;
        const data = await fetchJsonWithLogging(url, {
          label: "fetchDictionary",
          word: msg.word,
          source: "jisho",
        });

        const entry = data.data?.[0];
        if (!entry) {
          await logBackground("fetchDictionary not_found", {
            word: msg.word,
            source: "jisho",
          });
          sendResponse({ ok: false, error: "not_found" });
          return;
        }

        const reading = entry.japanese?.[0]?.reading ?? "";
        const senses = (entry.senses ?? []).slice(0, 5);
        const meanings = senses.map((sense) => ({
          definitions: sense.english_definitions ?? [],
          partsOfSpeech: sense.parts_of_speech ?? [],
        }));
        const jlptRaw = entry.jlpt?.[0] ?? "";
        const jlpt = jlptRaw ? jlptRaw.replace("jlpt-", "").toUpperCase() : "";
        const isCommon = entry.is_common ?? false;

        await logBackground("fetchDictionary success", {
          word: msg.word,
          reading,
          meaningsCount: meanings.length,
          jlpt,
          isCommon,
        });

        sendResponse({ ok: true, reading, meanings, jlpt, isCommon });
      } catch (error) {
        await logBackground("fetchDictionary error", {
          word: msg.word,
          error: String(error),
        });
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }

  // ---------- Translation (Google Translate) ----------
  if (msg.type === "FETCH_TRANSLATE") {
    (async () => {
      try {
        await logBackground("fetchTranslate start", {
          textLength: msg.text ? msg.text.length : 0,
          targetLang: "ja",
          source: "translate.googleapis.com",
        });

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(msg.text)}`;
        const data = await fetchJsonWithLogging(url, {
          label: "fetchTranslate",
          textLength: msg.text ? msg.text.length : 0,
          targetLang: "ja",
          source: "translate.googleapis.com",
        });

        const translated = Array.isArray(data?.[0])
          ? data[0].map((x) => x[0]).join("")
          : "";

        await logBackground("fetchTranslate success", {
          textLength: msg.text ? msg.text.length : 0,
          translatedLength: translated.length,
        });

        sendResponse({ ok: true, translated });
      } catch (error) {
        await logBackground("fetchTranslate error", {
          textLength: msg.text ? msg.text.length : 0,
          error: String(error),
        });
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }

  // ---------- Tatoeba example sentences ----------
  if (msg.type === "FETCH_TATOEBA") {
    (async () => {
      try {
        await logBackground("fetchTatoeba start", {
          word: msg.word,
          source: "api.tatoeba.org",
        });

        const url = `https://api.tatoeba.org/unstable/sentences?q=${encodeURIComponent(msg.word)}&lang=eng&trans:lang=jpn&limit=5`;
        const data = await fetchJsonWithLogging(url, {
          label: "fetchTatoeba",
          word: msg.word,
          source: "api.tatoeba.org",
        });

        const results = (data.data ?? []).slice(0, 5).map((sentence) => ({
          text: sentence.text,
          translation: sentence.translations?.[0]?.[0]?.text ?? "",
        }));

        await logBackground("fetchTatoeba success", {
          word: msg.word,
          resultCount: results.length,
        });

        sendResponse({ ok: true, results });
      } catch (error) {
        await logBackground("fetchTatoeba error", {
          word: msg.word,
          error: String(error),
        });
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }
});
