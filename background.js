// =============================================================
// background.js - Service Worker (v2.5)
// =============================================================
// Content scripts run in the page context and are subject to
// the page's CORS policy. Fetches from tv.apple.com to external
// APIs (jisho.org, translate.googleapis.com) are blocked.
//
// Solution: route all external API calls through this service
// worker, which is NOT subject to CORS restrictions.
//
// SW Keepalive: Manifest V3 service workers auto-stop after
// ~30 seconds of inactivity. The activate handler + onInstalled
// listener help keep the SW registered and responsive.
// =============================================================

const DEBUG_LOGS_KEY = "debugLogs";
const DEBUG_LOGS_MAX = 400;

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

// Keep the service worker alive and claim clients immediately on activation
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ATV-Bilingual] background.js installed/updated");
  logBackground("background.js installed/updated").catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

  // ---------- Tatoeba 例文取得 ----------
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
