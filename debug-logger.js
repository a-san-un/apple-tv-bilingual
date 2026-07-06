// =============================================================
// Apple TV+ Bilingual Subtitles - debug-logger.js
// version: 2.6.0
// 役割: Debug ログの整形・保存・通知を担当する。
// Phase A: content.js から logger 責務を切り出して window.ATVB.logger で公開する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const DEBUG_LOGS_KEY = "debugLogs";
  const DEBUG_LOGS_MAX = 400;

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

  // [ATVB] 形式で 1 行ログを生成して console 出力する。
  function debugLog(scope, message, payload = null) {
    const time = new Date().toISOString();
    const safePayload = sanitizeForLog(payload);
    console.log(`[ATVB][${time}][${scope}] ${message}`, safePayload ?? "");
    return { time, scope, message, payload: safePayload };
  }

  // storage.local にログを追記し、更新 callback を通知する。
  async function appendDebugLog(line) {
    try {
      const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
        await chrome.storage.local.get(DEBUG_LOGS_KEY);
      debugLogs.push(line);
      if (debugLogs.length > DEBUG_LOGS_MAX) {
        debugLogs.splice(0, debugLogs.length - DEBUG_LOGS_MAX);
      }
      await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: debugLogs });
      onLogUpdated();
    } catch (error) {
      console.warn("[ATV-Bilingual] appendDebugLog failed:", error);
    }
  }

  // content スコープの標準ログ導線を提供する。
  function logContent(message, payload = null) {
    const line = debugLog("content", message, payload);
    appendDebugLog(line);
  }

  // ログ 1 件を表示用テキストへ整形する。
  function formatDebugLine(line) {
    const payloadText =
      line.payload != null ? ` ${JSON.stringify(line.payload)}` : "";
    return `[${line.time}] [${line.scope}] ${line.message}${payloadText}`;
  }

  // 保存済みログを結合して全文テキストで返す。
  async function getDebugLogText() {
    const { [DEBUG_LOGS_KEY]: debugLogs = [] } =
      await chrome.storage.local.get(DEBUG_LOGS_KEY);
    return debugLogs.map(formatDebugLine).join("\n");
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
    debugLog,
    appendDebugLog,
    logContent,
    formatDebugLine,
    getDebugLogText,
    clearDebugLogs,
  };
})();
