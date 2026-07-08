// =============================================================
// Apple TV+ Bilingual Subtitles - settings-bridge.js
// version: 2.6.2
// 役割: content.js の設定読込・通知入口を薄く橋渡しする。
// Phase C: API スケルトンを先に固定し、責務分離の接続口を作る。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const listeners = new Set();
  let currentSettings = null;

  function cloneSettings(settings) {
    if (!settings || typeof settings !== "object") return {};
    return { ...settings };
  }

  function applyFallbackIfNeeded(settings, applyFallback) {
    if (typeof applyFallback !== "function") return cloneSettings(settings);
    const resolved = applyFallback(cloneSettings(settings));
    return cloneSettings(resolved);
  }

  function notifySettingsChanged(payload) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (_) {}
    }
  }

  function getCurrentSettings() {
    return cloneSettings(currentSettings);
  }

  function loadSettings(options = {}) {
    const defaults = cloneSettings(
      options.defaults || options.defaultSettings || {},
    );
    const applyFallback = options.applyFallback;
    const onLoaded =
      typeof options.onLoaded === "function" ? options.onLoaded : null;

    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(defaults, (rawSettings = {}) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const merged = { ...defaults, ...cloneSettings(rawSettings) };
        const resolved = applyFallbackIfNeeded(merged, applyFallback);
        currentSettings = cloneSettings(resolved);

        if (onLoaded) {
          onLoaded(cloneSettings(currentSettings), cloneSettings(rawSettings));
        }

        resolve(cloneSettings(currentSettings));
      });
    });
  }

  function onSettingsChanged(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  function handleRuntimeMessage(message, options = {}) {
    if (!message || message.type !== "SETTINGS_CHANGED") {
      return { handled: false };
    }

    const incoming =
      message.settings && typeof message.settings === "object"
        ? cloneSettings(message.settings)
        : {};
    const requestedSecondaryLang = incoming.secondaryLang ?? "";
    const base = currentSettings ? cloneSettings(currentSettings) : {};
    const merged = { ...base, ...incoming };
    const resolved = applyFallbackIfNeeded(merged, options.applyFallback);

    currentSettings = cloneSettings(resolved);

    const payload = {
      handled: true,
      reason: message.reason || "unknown",
      settings: cloneSettings(currentSettings),
      requestedSecondaryLang,
      resolvedSecondaryLanguage: currentSettings.secondaryLang || "",
    };

    notifySettingsChanged(payload);
    return payload;
  }

  window.ATVB.settingsBridge = {
    getCurrentSettings,
    loadSettings,
    onSettingsChanged,
    handleRuntimeMessage,
  };
})();
