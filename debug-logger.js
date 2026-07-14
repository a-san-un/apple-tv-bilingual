// =============================================================
// Apple TV+ Bilingual Subtitles - debug-logger.js
// version: 2.6.3
// 役割: Debug ログの整形・保存・通知を担当する。
// Phase A: content.js から logger 責務を切り出して window.ATVB.logger で公開する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const DEBUG_LOGS_KEY = "debugLogs";
  const RETAINED_DEBUG_LOGS_LIMIT = 300;
  const LOG_CATEGORIES = Object.freeze({
    SETTINGS: "settings",
    SUBTITLE: "subtitle",
    UI: "ui",
    API: "api",
    ERROR: "error",
    DEFAULT: "default",
  });
  const KNOWN_CATEGORIES = new Set(Object.values(LOG_CATEGORIES));
  const DEFAULT_CATEGORY = LOG_CATEGORIES.UI;

  let onLogUpdated = () => {};

  // ログ更新時に呼ぶ callback を登録する。
  function setOnLogUpdated(fn) {
    onLogUpdated = typeof fn === "function" ? fn : () => {};
  }

  // 機密値をマスクしてログ出力を安全化する。
  function maskSensitive(value) {
    if (typeof value !== "string") return value;
    if (!value) return "";
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}...${value.slice(-2)}`;
  }

  // ログ payload を直列化しつつ機密キーをマスクする。
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

  function normalizeCategory(category) {
    const normalized = String(category || "")
      .trim()
      .toLowerCase();
    if (KNOWN_CATEGORIES.has(normalized)) return normalized;
    return DEFAULT_CATEGORY;
  }

  // [ATVB] 形式で 1 行ログを生成する。
  // 互換性のため debugLog(scope, message, payload) も受け付ける。
  function debugLog(scope, categoryOrMessage, messageOrPayload, payloadMaybe) {
    const source = String(scope || "unknown");

    let category = DEFAULT_CATEGORY;
    let message = "";
    let payload = null;

    if (
      typeof categoryOrMessage === "string" &&
      KNOWN_CATEGORIES.has(String(categoryOrMessage).toLowerCase())
    ) {
      category = normalizeCategory(categoryOrMessage);
      message = String(messageOrPayload || "");
      payload = payloadMaybe ?? null;
    } else {
      message = String(categoryOrMessage || "");
      payload = messageOrPayload ?? null;
    }

    const time = new Date().toISOString();
    return {
      time,
      scope: source,
      source,
      category,
      message,
      payload: sanitizeForLog(payload),
    };
  }

  function ensureLogShape(line) {
    if (!line || typeof line !== "object") return null;
    const source = String(line.source || line.scope || "unknown");
    const message = String(line.message || "");
    const normalized = {
      time: line.time || new Date().toISOString(),
      scope: source,
      source,
      category: normalizeCategory(line.category),
      message,
      payload: sanitizeForLog(line.payload ?? null),
    };
    return normalized;
  }

  function padNumber(value, width = 2) {
    return String(value).padStart(width, "0");
  }

  // 保存済みUTC時刻を、表示時のみローカル時刻へ変換する。
  function formatLocalTimestamp(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return String(timestamp || "");

    const year = date.getFullYear();
    const month = padNumber(date.getMonth() + 1);
    const day = padNumber(date.getDate());
    const hours = padNumber(date.getHours());
    const minutes = padNumber(date.getMinutes());
    const seconds = padNumber(date.getSeconds());
    const milliseconds = padNumber(date.getMilliseconds(), 3);

    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = padNumber(Math.floor(absOffsetMinutes / 60));
    const offsetRemainder = padNumber(absOffsetMinutes % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainder}`;
  }

  // storage.local にログを追記し、更新 callback を通知する。
  async function appendDebugLog(line) {
    try {
      if (!globalThis.chrome?.runtime?.id) return;

      const normalizedLine = ensureLogShape(line);
      if (!normalizedLine) return;

      const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
        await chrome.storage.local.get(DEBUG_LOGS_KEY);

      debugLogs.push(normalizedLine);
      if (debugLogs.length > RETAINED_DEBUG_LOGS_LIMIT) {
        debugLogs.splice(0, debugLogs.length - RETAINED_DEBUG_LOGS_LIMIT);
      }
      await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
      onLogUpdated();
    } catch (error) {
      const message =
        error && typeof error.message === "string" ? error.message : String(error);
      if (message.includes("Extension context invalidated")) return;
      console.warn("[ATV-Bilingual] appendDebugLog failed:", error);
    }
  }

  // content スコープの標準ログ導線を提供する。
  // 互換性のため logContent(message, payload) も受け付ける。
  function logContent(categoryOrMessage, messageOrPayload, payloadMaybe) {
    const line = debugLog(
      "content",
      categoryOrMessage,
      messageOrPayload,
      payloadMaybe,
    );
    appendDebugLog(line);
  }

  // ログ 1 件を表示用テキストへ整形する。
  function formatDebugLine(line) {
    const payloadText =
      line.payload != null ? ` ${JSON.stringify(line.payload)}` : "";
    const source = line.source || line.scope || "unknown";
    const category = normalizeCategory(line.category);
    const localTime = formatLocalTimestamp(line.time);
    return `[${localTime}] [${category}] [${source}] ${line.message}${payloadText}`;
  }

  function filterDebugLogs(logs, filter = {}) {
    const categories = Array.isArray(filter.categories)
      ? new Set(filter.categories.map((item) => normalizeCategory(item)))
      : null;
    const scopes = Array.isArray(filter.scopes)
      ? new Set(filter.scopes.map((item) => String(item || "").trim()))
      : null;
    const contentKey = String(filter.contentKey || "").trim();

    function extractContentKey(payload) {
      if (!payload || typeof payload !== "object") return "";
      const candidates = [
        payload.contentKey,
        payload.nextContentKey,
        payload.currentContentKey,
      ];
      const found = candidates.find((item) => String(item || "").trim());
      return found ? String(found).trim() : "";
    }

    return (logs || []).filter((line) => {
      const normalized = ensureLogShape(line);
      if (!normalized) return false;
      if (categories && !categories.has(normalized.category)) return false;
      if (scopes && !scopes.has(normalized.source)) return false;
      if (contentKey) {
        const lineContentKey = extractContentKey(normalized.payload);
        if (!lineContentKey) return false;
        if (lineContentKey !== contentKey) return false;
      }
      return true;
    });
  }

  // 保存済みログを結合して全文テキストで返す。
  async function getDebugLogText(filter = {}) {
    const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
      await chrome.storage.local.get(DEBUG_LOGS_KEY);
    return filterDebugLogs(debugLogs, filter).map(formatDebugLine).join("\n");
  }

  // 保存済みログを全削除して更新 callback を通知する。
  async function clearDebugLogs() {
    await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: [] });
    onLogUpdated();
  }

  window.ATVB.logger = {
    setOnLogUpdated,
    maskSensitive,
    sanitizeForLog,
    normalizeCategory,
    debugLog,
    ensureLogShape,
    formatLocalTimestamp,
    appendDebugLog,
    logContent,
    formatDebugLine,
    filterDebugLogs,
    getDebugLogText,
    clearDebugLogs,
    LOG_CATEGORIES,
    RETAINED_DEBUG_LOGS_LIMIT,
  };
})();
