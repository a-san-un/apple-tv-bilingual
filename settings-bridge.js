// =============================================================
// Apple TV+ Bilingual Subtitles - settings-bridge.js
// version: 2.6.3
// 役割: content.js の設定読込・通知入口を薄く橋渡しする。
// Phase C: API スケルトンを先に固定し、責務分離の接続口を作る。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  const listeners = new Set();
  let bridgeState = {
    storedSettings: {},
    requestedSettings: {},
    effectiveSettings: {},
    requestedSecondaryLang: "",
    resolvedSecondaryLanguage: "",
  };

  function cloneSettings(settings) {
    if (!settings || typeof settings !== "object") return {};
    return { ...settings };
  }

  function applyFallbackIfNeeded(settings, applyFallback) {
    if (typeof applyFallback !== "function") return cloneSettings(settings);
    const resolved = applyFallback(cloneSettings(settings));
    return cloneSettings(resolved);
  }

  function setBridgeState(storedSettings, requestedSettings, effectiveSettings) {
    const nextStored = cloneSettings(storedSettings);
    const nextRequested = cloneSettings(requestedSettings);
    const nextEffective = cloneSettings(effectiveSettings);
    bridgeState = {
      storedSettings: nextStored,
      requestedSettings: nextRequested,
      effectiveSettings: nextEffective,
      requestedSecondaryLang: nextStored.secondaryLang ?? "",
      resolvedSecondaryLanguage: nextEffective.secondaryLang ?? "",
    };
    return getCurrentSettings();
  }

  function notifySettingsChanged(payload) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (_) {}
    }
  }

  function getCurrentSettings() {
    return {
      storedSettings: cloneSettings(bridgeState.storedSettings),
      requestedSettings: cloneSettings(bridgeState.requestedSettings),
      effectiveSettings: cloneSettings(bridgeState.effectiveSettings),
      requestedSecondaryLang: bridgeState.requestedSecondaryLang || "",
      resolvedSecondaryLanguage: bridgeState.resolvedSecondaryLanguage || "",
      // 既存呼び出しとの互換のため、effective settings を settings にも積む。
      settings: cloneSettings(bridgeState.effectiveSettings),
    };
  }

  function loadSettings(options = {}) {
    const defaults = cloneSettings(
      options.defaults || options.defaultSettings || {},
    );
    const applyFallback = options.applyFallback;
    const onLoaded =
      typeof options.onLoaded === "function" ? options.onLoaded : null;

    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(null, (storedSettings = {}) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const requested = { ...defaults, ...cloneSettings(storedSettings) };
        const resolved = applyFallbackIfNeeded(requested, applyFallback);
        const snapshot = setBridgeState(storedSettings, requested, resolved);

        if (onLoaded) {
          onLoaded(
            cloneSettings(snapshot.effectiveSettings),
            cloneSettings(storedSettings),
            snapshot,
          );
        }

        resolve(cloneSettings(snapshot.effectiveSettings));
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
    const baseStored = cloneSettings(bridgeState.storedSettings);
    const baseRequested = cloneSettings(bridgeState.requestedSettings);
    const nextStored = { ...baseStored, ...incoming };
    const merged = { ...baseRequested, ...incoming };
    const resolved = applyFallbackIfNeeded(merged, options.applyFallback);
    const snapshot = setBridgeState(nextStored, merged, resolved);

    const payload = {
      handled: true,
      reason: message.reason || "unknown",
      settings: cloneSettings(snapshot.effectiveSettings),
      storedSettings: cloneSettings(snapshot.storedSettings),
      requestedSettings: cloneSettings(snapshot.requestedSettings),
      effectiveSettings: cloneSettings(snapshot.effectiveSettings),
      requestedSecondaryLang: snapshot.requestedSecondaryLang,
      resolvedSecondaryLanguage: snapshot.resolvedSecondaryLanguage,
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
