(function (root) {
  function createSettingsRuntime(deps) {
    const {
      state,
      DEFAULT_SETTINGS,
      isLanguageSelectionReady,
      clearSecondaryTrackState,
      logContent,
      logContentError,
      logContentSettings,
      getVideoAndDialog,
      teardownForRestart,
      resetRuntimeState,
      startBilingual,
      isPlaybackPageReady,
      getPlaybackContextLogPayload,
      getUniqueTracks,
      cueController,
      renderSecondarySubtitle,
    } = deps;

    function applySecondaryLangFallback(settings) {
      const result = { ...settings };
      if (!result.secondaryLang) {
        const browserLang = (navigator.language || navigator.userLanguage || "en")
          .toLowerCase()
          .split("-")[0];
        result.secondaryLang = browserLang;
        logContentSettings(
          "secondaryLang empty: applying browser language fallback",
          browserLang,
        );
      }
      return result;
    }

    function resolveSettingsChangeNextSettings(updated, bridgeResult) {
      if (bridgeResult?.handled) {
        state.requestedContentSettings = {
          ...(bridgeResult.storedSettings ||
            bridgeResult.requestedSettings ||
            updated),
        };
        state.requestedSecondaryLang = bridgeResult.requestedSecondaryLang ?? "";

        if (isLanguageSelectionReady(state.requestedContentSettings)) {
          return { ...bridgeResult.settings };
        }

        clearSecondaryTrackState();
        return { ...DEFAULT_SETTINGS };
      }

      state.requestedContentSettings = {
        ...state.requestedContentSettings,
        ...updated,
      };
      state.requestedSecondaryLang = updated.secondaryLang ?? "";

      if (isLanguageSelectionReady(state.requestedContentSettings)) {
        return applySecondaryLangFallback({
          ...state.contentSettings,
          ...updated,
        });
      }

      clearSecondaryTrackState();
      return { ...DEFAULT_SETTINGS };
    }

    function loadSettingsSnapshot(reason = "unknown") {
      const loadFromStorage = () =>
        new Promise((resolve, reject) => {
          chrome.storage.sync.get(null, (storedSettings = {}) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            const requestedSettings = { ...DEFAULT_SETTINGS, ...storedSettings };
            const effectiveSettings =
              applySecondaryLangFallback(requestedSettings);
            resolve({
              storedSettings: { ...storedSettings },
              requestedSettings,
              effectiveSettings,
              requestedSecondaryLang: storedSettings.secondaryLang || "",
            });
          });
        });

      const settingsBridge = window.ATVB?.settingsBridge;
      if (!settingsBridge?.loadSettings) {
        return loadFromStorage();
      }

      return settingsBridge
        .loadSettings({
          defaults: DEFAULT_SETTINGS,
          applyFallback: applySecondaryLangFallback,
        })
        .then(() => {
          const snapshot = settingsBridge.getCurrentSettings?.() || {};
          const storedSettings = { ...(snapshot.storedSettings || {}) };
          const requestedSettings = {
            ...DEFAULT_SETTINGS,
            ...(snapshot.requestedSettings || storedSettings),
          };
          const effectiveSettings =
            snapshot.effectiveSettings || snapshot.settings || requestedSettings;
          return {
            storedSettings,
            requestedSettings,
            effectiveSettings: { ...effectiveSettings },
            requestedSecondaryLang:
              snapshot.requestedSecondaryLang ??
              storedSettings.secondaryLang ??
              "",
          };
        })
        .catch((error) => {
          logContentError("settings bridge load failed", {
            reason,
            error: String(error),
          });
          return loadFromStorage();
        });
    }

    function loadSettingsFromSync() {
      loadSettingsSnapshot("initial_load")
        .then((snapshot) => {
          state.requestedContentSettings = {
            ...(snapshot.storedSettings || {}),
          };
          state.requestedSecondaryLang = snapshot.requestedSecondaryLang || "";

          const hasCompleteRequestedSettings = isLanguageSelectionReady(
            state.requestedContentSettings,
          );

          state.contentSettings = hasCompleteRequestedSettings
            ? { ...snapshot.effectiveSettings }
            : { ...DEFAULT_SETTINGS };

          if (hasCompleteRequestedSettings) {
            const effectiveSecondaryLanguage =
              state.requestedSecondaryLang || state.contentSettings.secondaryLang;
            if (state.video && effectiveSecondaryLanguage) {
              cueController.syncSecondarySubtitleTrack(
                state.video,
                effectiveSecondaryLanguage,
                renderSecondarySubtitle,
              );
              state.secondaryTrack = cueController.getBoundSecondaryTrack();
            }
          } else {
            clearSecondaryTrackState();
          }

          logContentSettings("Loaded settings from sync", {
            ...state.contentSettings,
            requestedSecondaryLang: state.requestedSecondaryLang,
            hasCompleteRequestedSettings,
          });

          if (!hasCompleteRequestedSettings) {
            logContentSettings("initial load routed to language setup notice", {
              requestedSettings: { ...state.requestedContentSettings },
              requestedSecondaryLang: state.requestedSecondaryLang,
            });
          }

          startBilingual();
        })
        .catch((error) => {
          logContentError("settings load failed", {
            reason: "initial_load",
            error: String(error),
          });
        });
    }

    function applyRestartSettings(nextSettings, reason = "unknown") {
      state.requestedContentSettings = {
        ...state.requestedContentSettings,
        ...nextSettings,
      };
      state.requestedSecondaryLang = nextSettings.secondaryLang || "";

      if (isLanguageSelectionReady(state.requestedContentSettings)) {
        state.contentSettings = applySecondaryLangFallback({
          ...state.contentSettings,
          ...nextSettings,
        });
        return;
      }

      state.contentSettings = { ...DEFAULT_SETTINGS };
      clearSecondaryTrackState();
      logContentSettings("restartBilingual routed to language setup notice", {
        reason,
        requestedSettings: { ...state.requestedContentSettings },
        requestedSecondaryLang: state.requestedSecondaryLang,
      });
    }

    function restartBilingual(nextSettings = null, reason = "unknown") {
      logContent("restartBilingual trace", {
        reason,
        panelVisible: state.panelVisible,
      });
      console.trace("restartBilingual trace");
      if (state.restarting) {
        logContent("restartBilingual skipped: already restarting", { reason });
        return;
      }

      state.restarting = true;
      try {
        if (nextSettings) {
          applyRestartSettings(nextSettings, reason);
        }

        const found = getVideoAndDialog();
        if (found) {
          state.video = found.video;
          state.dialogEl = found.dialog;
        }

        logContentSettings("restartBilingual begin", {
          reason,
          hasVideo: !!state.video,
          trackCount: state.video?.textTracks?.length ?? 0,
          primaryLang: state.contentSettings.primaryLang,
          secondaryLang: state.contentSettings.secondaryLang,
          requestedSecondaryLang: state.requestedSecondaryLang,
        });

        const wasPanelVisible = state.panelVisible;
        teardownForRestart();
        resetRuntimeState();
        startBilingual({ keepPanelVisible: wasPanelVisible });

        logContentSettings("restartBilingual done", { reason });
      } finally {
        state.restarting = false;
      }
    }

    const onRuntimeMessage = (message, sender, sendResponse) => {
      if (message.type === "SETTINGS_CHANGED") {
        if (!isPlaybackPageReady()) {
          logContent("SETTINGS_CHANGED skipped: playback not ready", {
            ...getPlaybackContextLogPayload(),
            reason: message.reason || "unknown",
          });
          sendResponse({ ok: true, skipped: "playback_not_ready" });
          return true;
        }

        const updated = { ...message.settings };
        const bridgeResult = window.ATVB?.settingsBridge?.handleRuntimeMessage?.(
          message,
          { applyFallback: applySecondaryLangFallback },
        );

        const next = resolveSettingsChangeNextSettings(updated, bridgeResult);
        const requestedSecondaryLang = state.requestedSecondaryLang;
        const resolvedSecondaryLanguage = next.secondaryLang;
        const triggerReason = message.reason || "unknown";

        logContentSettings("SETTINGS_CHANGED received", {
          triggerReason,
          settings: {
            ...next,
            requestedSecondaryLang,
            resolvedSecondaryLanguage,
          },
        });

        if (state.video && resolvedSecondaryLanguage) {
          cueController.syncSecondarySubtitleTrack(
            state.video,
            resolvedSecondaryLanguage,
            renderSecondarySubtitle,
          );
          state.secondaryTrack = cueController.getBoundSecondaryTrack();
        }

        restartBilingual(next, "SETTINGS_CHANGED");

        const appliedRequestedSecondaryLang = state.requestedSecondaryLang;
        const appliedResolvedSecondaryLanguage = resolvedSecondaryLanguage;

        logContentSettings("content applied settings to tracks", {
          triggerReason,
          hasVideo: !!state.video,
          primaryLang: state.contentSettings.primaryLang,
          secondaryLang: state.contentSettings.secondaryLang,
          requestedSecondaryLang: appliedRequestedSecondaryLang,
          resolvedSecondaryLanguage: appliedResolvedSecondaryLanguage,
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

    return {
      applySecondaryLangFallback,
      resolveSettingsChangeNextSettings,
      loadSettingsSnapshot,
      loadSettingsFromSync,
      applyRestartSettings,
      restartBilingual,
      onRuntimeMessage,
      ensureMessageListener,
    };
  }

  root.settingsRuntime = {
    createSettingsRuntime,
  };
})(window.ATVB || (window.ATVB = {}));
