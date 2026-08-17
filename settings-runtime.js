// =============================================================
// Apple TV+ Bilingual Subtitles - settings-runtime.js
//
// 役割:
// - content 側の settings load / merge / restart orchestration を担当する。
// - requested settings と effective settings を分けて保持し、
//   未設定状態と言語選択完了後の通常起動を切り替える。
// - runtime message 経由の SETTINGS_CHANGED / GET_LANGUAGES を処理する。
// - F-4 対応として、SETTINGS_CHANGED の非同期 sendResponse を
//   1 回だけ安全に返す責務をここで担保する。
//
// このファイルのメンテナンス方針:
// - storage / settingsBridge から読んだ「requested」と、
//   fallback 適用後の「effective」を明確に分けて扱う。
// - secondaryLang の補完は applySecondaryLangFallback() に集約し、
//   空値補完の条件を他関数へ分散させない。
// - 問題切り分け時は requestedSecondaryLang と contentSettings.secondaryLang を
//   同時にログへ出し、設定起因か resolver 起因かを見分けやすくする。
// - runtime message 応答は分岐ごとに直接 sendResponse せず、
//   できるだけ 1 箇所へ寄せて漏れと二重送信を防ぐ。
// =============================================================
(function (root) {
  function createSettingsRuntime(deps) {
        const {
      state,
      DEFAULT_SETTINGS,
      isLanguageSelectionReady,
      logContent,
      logContentError,
      logContentSettings,
      detachForDisabled,
      prepareForRestart,
      startBilingual,
      isPlaybackPageReady,
      getVideoAndDialog,
      cueController,
      syncIntervalOrchestrator,
      panelUi,
    } = deps;

    let initialAutoStartCleanup = null;
    let initialAutoStartToken = 0;

    // -------------------------------------------------------------
    // 初回 auto-start 用ヘルパー
    // -------------------------------------------------------------

    // 初回自動起動のために張った addtrack / poll / timeout 監視を解除する。
    // 再起動や video 差し替え時に古い監視が残らないようにする。
    function cleanupInitialAutoStartWatch() {
      if (typeof initialAutoStartCleanup === "function") {
        try {
          initialAutoStartCleanup();
        } catch {
        }
      }
      initialAutoStartCleanup = null;
    }

    // textTracks から「字幕として使えそうな track」だけを抽出する。
    // metadata / id3 を除外し、subtitles / captions / language 付き track を候補にする。
    function getSubtitleLikeTracks(video) {
      const tracks = Array.from(video?.textTracks || []);
      return tracks.filter((track) => {
        const kind = String(track?.kind || "").toLowerCase();
        const label = String(track?.label || "").toLowerCase();
        const language = String(track?.language || "").trim();

        if (kind === "metadata") return false;
        if (label === "id3") return false;

        return (
          kind === "subtitles" ||
          kind === "captions" ||
          Boolean(language)
        );
      });
    }

    // bilingual 起動に使える字幕系 track が1本以上あるかを返す。
    // 初回起動を遅延させる判定の共通入口として使う。
    function _hasUsableSubtitleTracks(video) {
      return getSubtitleLikeTracks(video).length > 0;
    }

    // 初回 settings load 後の auto-start を、字幕 track が揃うまで待って実行する。
    // metadata / id3 しか無い早すぎる時点で startBilingual しないための待機入口。
    function startBilingualWhenTracksReady(reason = "unknown") {
      cleanupInitialAutoStartWatch();
      initialAutoStartToken += 1;
      const token = initialAutoStartToken;

      const video = state.video;
      if (!video) {
        logContent?.("initial auto-start skipped: no video", { reason });
        return;
      }

      const maybeStart = (triggerReason) => {
        if (token !== initialAutoStartToken) return false;
        if (!state.video || state.video !== video) return false;

        const subtitleLikeTrackCount = getSubtitleLikeTracks(video).length;
        const ready = subtitleLikeTrackCount > 0;

        logContent?.("initial auto-start track readiness", {
          reason,
          triggerReason,
          ready,
          totalTrackCount: video?.textTracks?.length ?? 0,
          subtitleLikeTrackCount,
        });

        if (!ready) return false;

        cleanupInitialAutoStartWatch();

        logContent?.("initial auto-start firing", {
          reason,
          triggerReason,
          totalTrackCount: video?.textTracks?.length ?? 0,
          subtitleLikeTrackCount,
        });

        startBilingual({
          reason: `settings_runtime:${reason}:${triggerReason}`,
          // ランタイムUI状態をそのまま引き継ぐ（設定値 panelDefaultOpen ではない）。
          keepPanelOpen: state.panelOpen,
        });

        return true;
      };

      if (maybeStart("immediate")) return;

      const textTracks = video?.textTracks || null;
      let pollTimer = null;
      let timeoutTimer = null;

      const onAddTrack = () => {
        maybeStart("textTracks_addtrack");
      };

      if (textTracks && typeof textTracks.addEventListener === "function") {
        textTracks.addEventListener("addtrack", onAddTrack);
      }

      pollTimer = window.setInterval(() => {
        maybeStart("poll");
      }, 250);

      timeoutTimer = window.setTimeout(() => {
        logContent?.("initial auto-start track wait timeout", {
          reason,
          totalTrackCount: video?.textTracks?.length ?? 0,
          subtitleLikeTrackCount: getSubtitleLikeTracks(video).length,
        });
        cleanupInitialAutoStartWatch();
      }, 8000);

      initialAutoStartCleanup = () => {
        if (textTracks && typeof textTracks.removeEventListener === "function") {
          textTracks.removeEventListener("addtrack", onAddTrack);
        }
        if (pollTimer) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
        if (timeoutTimer) {
          window.clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
      };
    }

    // -------------------------------------------------------------
    // secondary fallback / settings load
    // -------------------------------------------------------------

    // secondaryLang 未設定時の補完ロジックを 1 箇所へ寄せる。
    // requested と effective の差分を追えるように、戻り値は文字列だけにする。
    function applySecondaryLangFallback(settings) {
      const primaryLang = String(settings?.primaryLang || "").trim();
      const secondaryLang = String(settings?.secondaryLang || "").trim();

      if (secondaryLang) return secondaryLang;
      if (primaryLang && primaryLang !== "ja") return "ja";
      if (primaryLang === "ja") return "en";
      return "";
    }

    function resolveSettingsChangeNextSettings(incoming = {}) {
      const requestedBase = {
        ...DEFAULT_SETTINGS,
        ...state.requestedContentSettings,
      };

      const requestedNext = {
        ...requestedBase,
        ...incoming,
      };

      const effectiveNext = {
        ...requestedNext,
        secondaryLang: applySecondaryLangFallback(requestedNext),
      };

      return effectiveNext;
    }

    async function loadSettingsSnapshot() {
      const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);

      const requestedSettings = {
        ...DEFAULT_SETTINGS,
        ...result,
      };

      const effectiveSettings = {
        ...requestedSettings,
        secondaryLang: applySecondaryLangFallback(requestedSettings),
      };

      state.requestedContentSettings = {
        ...requestedSettings,
      };
      state.contentSettings = {
        ...effectiveSettings,
      };
      state.requestedSecondaryLang = requestedSettings.secondaryLang || "";

      return {
        requestedSettings,
        effectiveSettings,
      };
    }

    async function loadSettingsFromSync() {
      const { requestedSettings, effectiveSettings } = await loadSettingsSnapshot();

      logContentSettings("settings loaded from sync", {
        extensionEnabled: effectiveSettings.extensionEnabled,
        primaryLang: effectiveSettings.primaryLang,
        secondaryLang: effectiveSettings.secondaryLang,
        requestedSecondaryLang: requestedSettings.secondaryLang || "",
        panelDefaultOpen: effectiveSettings.panelDefaultOpen,
      });

      if (!effectiveSettings.extensionEnabled) {
        state.panelOpen = false;
        detachForDisabled();
        panelUi?.watchForPlayerTabs?.();
        return;
      }

      if (!isLanguageSelectionReady?.(effectiveSettings)) {
        logContent?.("language selection not ready yet; skip start");
        return;
      }

      startBilingualWhenTracksReady("load_settings_from_sync");
    }

    // -------------------------------------------------------------
    // restart orchestration
    // -------------------------------------------------------------

    function applyRestartSettings(settings, options = {}) {
      const {
        keepPanelOpen = state.panelOpen,
      } = options;

      state.contentSettings = {
        ...state.contentSettings,
        ...settings,
      };

      state.requestedContentSettings = {
        ...state.requestedContentSettings,
        ...settings,
      };

      state.requestedSecondaryLang = state.requestedContentSettings.secondaryLang || "";
      state.contentSettings.secondaryLang = applySecondaryLangFallback(
        state.contentSettings,
      );

      // panelOpen は「今の UI 状態」が正本なので、設定値で上書きしない。
      state.panelOpen = Boolean(keepPanelOpen);

      logContentSettings("applyRestartSettings", {
        keepPanelOpen: state.panelOpen,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLang: state.requestedSecondaryLang,
        extensionEnabled: state.contentSettings.extensionEnabled,
      });
    }

    function restartBilingual(settings, reason = "unknown", options = {}) {
      applyRestartSettings(settings, options);

      if (!state.contentSettings.extensionEnabled) {
        logContent?.("restartBilingual skipped because extension is disabled", {
          reason,
        });
        return;
      }

      prepareForRestart?.({
        reason,
      });

      startBilingual({
        reason,
        keepPanelOpen: state.panelOpen,
      });
    }

    // -------------------------------------------------------------
    // runtime message
    // -------------------------------------------------------------

    async function syncAppleTvNativeSubtitleToSecondaryLang(secondaryLang, triggerReason) {
      try {
        await cueController?.syncSecondarySubtitleTrack?.(secondaryLang, {
          reason: `settings_changed:${triggerReason}`,
        });
      } catch (error) {
        logContentError("syncAppleTvNativeSubtitleToSecondaryLang failed", {
          triggerReason,
          secondaryLang,
          message: error?.message || String(error),
        });
        throw error;
      }
    }

    const onRuntimeMessage = (message, sender, sendResponse) => {
      if (!message || typeof message !== "object") return false;

      if (message.type === "SETTINGS_CHANGED") {
        const incoming = message.settings || {};
        const triggerReason = message.reason || "runtime_message";

        const safeSendResponse = (() => {
          let responded = false;
          return (payload) => {
            if (responded) return;
            responded = true;
            try {
              sendResponse(payload);
            } catch (error) {
              logContentError("SETTINGS_CHANGED sendResponse failed", {
                triggerReason,
                message: error?.message || String(error),
              });
            }
          };
        })();

        const waitForPlaybackReady = async ({
          timeoutMs = 4000,
          intervalMs = 200,
        } = {}) => {
          const startedAt = Date.now();

          while (Date.now() - startedAt < timeoutMs) {
            const playbackReady = Boolean(isPlaybackPageReady?.());
            const playbackRef = getVideoAndDialog?.();

            if (playbackReady && playbackRef?.video) {
              return playbackRef;
            }

            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }

          return null;
        };

        const applySettingsAsync = async () => {
          state.requestedContentSettings = {
            ...state.requestedContentSettings,
            ...incoming,
          };

          const nextSettings = resolveSettingsChangeNextSettings(incoming);
          state.contentSettings = {
            ...nextSettings,
          };
          state.requestedSecondaryLang = state.contentSettings.secondaryLang || "";

          logContentSettings("SETTINGS_CHANGED received", {
            triggerReason,
            incoming,
            extensionEnabled: state.contentSettings.extensionEnabled,
            panelOpen: state.panelOpen,
            requestedSecondaryLang: state.requestedSecondaryLang,
          });

          if (!state.contentSettings.extensionEnabled) {
            state.requestedContentSettings = {
              ...state.requestedContentSettings,
              extensionEnabled: false,
            };
            state.contentSettings = {
              ...state.contentSettings,
              extensionEnabled: false,
            };
            state.panelOpen = false;

            logContentSettings("SETTINGS_CHANGED disable-branch", {
              triggerReason,
              incoming,
              contentExtensionEnabled: state.contentSettings.extensionEnabled,
              requestedExtensionEnabled:
                state.requestedContentSettings.extensionEnabled,
            });

            logContentSettings("ネイティブトグル OFF apply start", {
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });

            cueController?.restoreNativeSubtitles?.();
            panelUi?.destroyUiHosts?.();
            panelUi?.watchForPlayerTabs?.();
            detachForDisabled();

            logContentSettings("ネイティブトグル OFF apply done", {
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });

            syncIntervalOrchestrator?.stop?.();
            cleanupInitialAutoStartWatch();
            state.booted = false;

            return { ok: true, reason: "disabled" };
          }

          const playbackRef = await waitForPlaybackReady();

          if (!playbackRef?.video) {
            logContentSettings("SETTINGS_CHANGED playback not ready", {
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });
            return { ok: false, error: "playback_not_ready" };
          }

          state.video = playbackRef.video;
          if (playbackRef.dialog) {
            state.dialogEl = playbackRef.dialog;
          }

          await syncAppleTvNativeSubtitleToSecondaryLang(
            state.contentSettings.secondaryLang,
            triggerReason,
          );

          logContentSettings("ネイティブトグル ON restart begin", {
            triggerReason,
            panelOpen: state.panelOpen,
            extensionEnabled: state.contentSettings.extensionEnabled,
            hasVideo: !!state.video,
          });

          restartBilingual(
            {
              ...state.contentSettings,
            },
            "SETTINGS_CHANGED",
            {
              keepPanelOpen: state.panelOpen,
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

          return { ok: true };
        };

        applySettingsAsync()
          .then((payload) => {
            safeSendResponse(payload);
          })
          .catch((error) => {
            logContentError("SETTINGS_CHANGED apply failed", {
              triggerReason,
              message: error?.message || String(error),
            });
            safeSendResponse({
              ok: false,
              error: error?.message || String(error),
            });
          });

        return true;
      }

      if (message.type === "GET_LANGUAGES") {
        try {
          const langs = Array.isArray(state.availableLanguages)
            ? state.availableLanguages
            : [];
          sendResponse(langs.map((l) => ({ lang: l.lang, label: l.label })));
        } catch (error) {
          logContentError("GET_LANGUAGES failed", {
            message: error?.message || String(error),
          });
          sendResponse([]);
        }
        return false;
      }

      return false;
    };

    // content script 側の runtime message listener を一度だけ登録する。
    // 二重登録を防ぎつつ SETTINGS_CHANGED / GET_LANGUAGES を受け取れるようにする。
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