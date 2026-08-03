// =============================================================
// Apple TV+ Bilingual Subtitles - settings-runtime.js
//
// 役割:
// - content 側の settings load / merge / restart orchestration を担当する。
// - requested settings と effective settings を分けて保持し、
//   未設定状態と言語選択完了後の通常起動を切り替える。
// - runtime message 経由の SETTINGS_CHANGED / GET_LANGUAGES を処理する。
//
// このファイルのメンテナンス方針:
// - storage / settingsBridge から読んだ「requested」と、
//   fallback 適用後の「effective」を明確に分けて扱う。
// - secondaryLang の補完は applySecondaryLangFallback() に集約し、
//   空値補完の条件を他関数へ分散させない。
// - 問題切り分け時は requestedSecondaryLang と contentSettings.secondaryLang を
//   同時にログへ出し、設定起因か resolver 起因かを見分けやすくする。
// =============================================================
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
      prepareForRestart,
      startBilingual,
      isPlaybackPageReady,
      getPlaybackContextLogPayload,
      getUniqueTracks,
      cueController,
      renderSecondarySubtitle,
    } = deps;

    // secondaryLang が未設定のときだけ browser language を補う。
    // 既に指定済みの secondaryLang はここで上書きしない。
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

    // SETTINGS_CHANGED を requested/effective の二段階で解釈する。
    // bridge が処理済みなら bridge 結果を優先し、そうでなければ content 側で merge する。
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

    // requested / stored / effective の3層をスナップショットとして取得する。
    // ここではまだ state へ反映せず、呼び出し側で適用する。
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

          // requested と effective のズレ確認用ログ。
          // secondaryLang の不具合切り分けで最初に見る観測点。
          logContentSettings("settings snapshot applied", {
            requestedSettings: { ...state.requestedContentSettings },
            effectiveSettings: { ...state.contentSettings },
            requestedSecondaryLang: state.requestedSecondaryLang,
            effectiveSecondaryLang: state.contentSettings.secondaryLang || "",
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

    function restartBilingual(nextSettings = null, reason = "unknown", options = {}) {
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

        const wasPanelVisible =
          typeof options.keepPanelVisible === "boolean"
            ? options.keepPanelVisible
            : state.panelVisible;

        prepareForRestart();
        startBilingual({ keepPanelVisible: wasPanelVisible });

        logContentSettings("restartBilingual done", { reason });
      } finally {
        state.restarting = false;
      }
    }

    const onRuntimeMessage = (message, sender, sendResponse) => {
      if (
        message.type === "SETTINGS_CHANGED" ||
        message.type === "APPLY_SETTINGS_TO_APPLE_TV"
      ) {
        if (!isPlaybackPageReady()) {
          logContent("SETTINGS_CHANGED skipped: playback not ready", {
            ...getPlaybackContextLogPayload(),
            reason: message.reason || "unknown",
          });
          sendResponse({ ok: true, skipped: "playback_not_ready" });
          return true;
        }

        const triggerReason = message.reason || "unknown";
        const incoming = { ...(message.settings || {}) };
        const resolvedShowSidebar =
          incoming.showSidebar ?? state.panelVisible;
        const next = applySecondaryLangFallback({
          ...state.contentSettings,
          ...incoming,
          showSidebar: resolvedShowSidebar,
        });

        state.requestedSecondaryLang =
          incoming.secondaryLang ?? state.requestedSecondaryLang ?? "";

        state.requestedContentSettings = {
          ...state.requestedContentSettings,
          ...incoming,
          showSidebar: resolvedShowSidebar,
        };

        state.contentSettings = {
          ...state.contentSettings,
          ...next,
          showSidebar: resolvedShowSidebar,
        };

        state.panelVisible = resolvedShowSidebar !== false;

        logContentSettings("SETTINGS_CHANGED received", {
          triggerReason,
          settings: {
            ...incoming,
            appliedSecondaryLang: state.contentSettings.secondaryLang,
            requestedSecondaryLang: state.requestedSecondaryLang,
          },
        });

        if (state.video && state.contentSettings.secondaryLang) {
          cueController.syncSecondarySubtitleTrack(
            state.video,
            state.contentSettings.secondaryLang,
            renderSecondarySubtitle,
          );
          state.secondaryTrack = cueController.getBoundSecondaryTrack();
          cueController.onPrimaryCueChange?.();
        }

        restartBilingual(
          {
            ...state.contentSettings,
          },
          "SETTINGS_CHANGED",
          {
            keepPanelVisible: state.contentSettings.showSidebar !== false,
          },
        );

        logContentSettings("content applied settings to tracks", {
          triggerReason,
          hasVideo: !!state.video,
          primaryLang: state.contentSettings.primaryLang,
          secondaryLang: state.contentSettings.secondaryLang,
          requestedSecondaryLang: state.requestedSecondaryLang,
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