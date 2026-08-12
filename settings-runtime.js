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
      detachForDisabled,
      prepareForRestart,
      startBilingual,
      isPlaybackPageReady,
      getPlaybackContextLogPayload,
      getUniqueTracks,
      cueController,
      renderSecondarySubtitle,
      syncIntervalOrchestrator,
      mountToggleOnlyUi,
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
      }, 10000);

      initialAutoStartCleanup = () => {
        if (textTracks && typeof textTracks.removeEventListener === "function") {
          textTracks.removeEventListener("addtrack", onAddTrack);
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
      };
    }

    // -------------------------------------------------------------
    // settings 解釈ヘルパー
    // -------------------------------------------------------------

    // secondaryLang が空のときだけ browser language を補完する。
    // 実装は ATVB_SCHEMA.applySecondaryLangFallback に集約。
    function applySecondaryLangFallback(settings) {
      const result = globalThis.ATVB_SCHEMA.applySecondaryLangFallback(
        settings,
        navigator.language || navigator.userLanguage || "en"
      );
      if (result.secondaryLang !== settings.secondaryLang) {
        logContentSettings(
          "secondaryLang empty: applying browser language fallback",
          result.secondaryLang,
        );
      }
      return result;
    }

    // SETTINGS_CHANGED を requested / effective の二段階で解釈し、次の有効設定を決める。
    // bridge 処理済みなら bridge 結果を優先し、そうでなければ content 側で merge する。
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

    // requested / stored / effective の3層を storage または bridge から取得する。
    // この関数では state に反映せず、呼び出し側が適用タイミングを決める。
    function loadSettingsSnapshot(reason = "unknown") {
      const loadFromStorage = () =>
        new Promise((resolve, reject) => {
          chrome.storage.sync.get(null, (storedSettings = {}) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            const requestedSettings = globalThis.ATVB_SCHEMA.mergeSyncSettings(storedSettings);
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
          defaults: globalThis.ATVB_SCHEMA.DEFAULT_SYNC_SETTINGS,
          applyFallback: applySecondaryLangFallback,
        })
        .then(() => {
          const snapshot = settingsBridge.getCurrentSettings?.() || {};
          const storedSettings = { ...(snapshot.storedSettings || {}) };
          const requestedSettings = globalThis.ATVB_SCHEMA.mergeSyncSettings(
            snapshot.requestedSettings || storedSettings
          );
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

    // -------------------------------------------------------------
    // 初回 settings load
    // -------------------------------------------------------------

    // 初回読み込み時に settings snapshot を state へ反映する。
    // 設定が揃っていれば secondary track を同期し、字幕 track 準備完了後に自動起動する。
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
            return;
          }

          if (state.contentSettings.extensionEnabled !== true) {
            logContent?.("initial auto-start skipped: disabled");
            mountToggleOnlyUi?.();
          } else {
            startBilingualWhenTracksReady("initial_load");
}
        })
        .catch((error) => {
          logContentError("settings load failed", {
            reason: "initial_load",
            error: String(error),
          });
        });
    }

    // -------------------------------------------------------------
    // restart / native subtitle sync
    // -------------------------------------------------------------

    // restart 時に requested / effective settings を更新する。
    // 言語選択が未完了なら DEFAULT_SETTINGS に戻し、secondary track state もクリアする。
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

    // Apple TV+ ネイティブ字幕メニューを best-effort で secondaryLang に合わせる。
    // TextTrack ベースの bilingual pipeline とは独立した補助同期として扱う。
    async function syncAppleTvNativeSubtitleToSecondaryLang(
      secondaryLang,
      reason = "unknown",
    ) {
      // Best-effort only: the TextTrack-based bilingual pipeline remains the source of truth.
      // This briefly opens the Apple TV+ native subtitle menu to align the visible
      // native subtitle language, then closes the menu if it was opened here.
      if (!secondaryLang) {
        logContentSettings("native subtitle sync skipped: empty secondaryLang", {
          reason,
          secondaryLang,
          bestEffort: true,
        });
        return { ok: false, skipped: "empty_secondaryLang", bestEffort: true };
      }

      const resolver = window.ATVB && window.ATVB.resolver;
      if (!resolver || typeof resolver.syncNativeSubtitleSelectionViaMenu !== "function") {
        logContentSettings("native subtitle sync skipped: resolver unavailable", {
          reason,
          secondaryLang,
          bestEffort: true,
        });
        return {
          ok: false,
          skipped: "resolver_unavailable",
          secondaryLang,
          bestEffort: true,
        };
      }

      // 直前に同じ言語へ "成功して" 同期済みなら、メニューの開閉を再実行しない。
      // 言語が変わった場合、または前回失敗していた場合のみ実行する。
      const alreadySyncedSameLang =
        state.lastNativeSubtitleSyncLang === secondaryLang &&
        state.lastNativeSubtitleSyncOk === true;
      if (alreadySyncedSameLang) {
        logContentSettings("native subtitle sync skipped: already synced", {
          reason,
          secondaryLang,
          bestEffort: true,
        });
        return { ok: true, skipped: "already_synced", secondaryLang, bestEffort: true };
      }

      try {
        // eslint-disable-next-line no-console
        console.log("[ATVB] syncAppleTvNativeSubtitleToSecondaryLang entered", {
          reason,
          secondaryLang,
          primaryLang: state.contentSettings?.primaryLang || "",
        });

        const resolvedSecondaryLang =
          state.secondaryTrack?.language || secondaryLang || "";

        const result = await resolver.syncNativeSubtitleSelectionViaMenu({
          secondaryLang: resolvedSecondaryLang,
          preferredSource: resolvedSecondaryLang,
          primaryLang: state.contentSettings?.primaryLang || "",
        });

        logContentSettings("native subtitle sync attempted", {
          reason,
          secondaryLang,
          resolvedSecondaryLang,
          result,
          bestEffort: true,
        });

        const applied = !!result?.applied;
        state.lastNativeSubtitleSyncLang = applied
          ? resolvedSecondaryLang
          : state.lastNativeSubtitleSyncLang;
        state.lastNativeSubtitleSyncOk = applied;

        return {
          ok: applied,
          secondaryLang,
          resolvedSecondaryLang,
          result,
          bestEffort: true,
        };
      } catch (error) {
        logContentSettings("native subtitle sync failed", {
          reason,
          secondaryLang,
          error: String(error && error.message ? error.message : error),
          bestEffort: true,
        });
        state.lastNativeSubtitleSyncOk = false;
        return { ok: false, skipped: "error", secondaryLang, bestEffort: true };
      }
    }

    // 現在の state / video を使って bilingual 表示を再初期化する。
    // settings 変更や UI 再適用時の共通 restart 入口として使う。
    function restartBilingual(nextSettings = null, reason = "unknown", options = {}) {
      logContent("restartBilingual trace", {
        reason,
        panelOpen: state.panelOpen,
      });
      // eslint-disable-next-line no-console
      console.trace("restartBilingual trace");

      if (state.restarting) {
        logContent("restartBilingual skipped: already restarting", { reason });
        return;
      }

      cleanupInitialAutoStartWatch();

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

        const wasPanelOpen =
          typeof options.keepPanelOpen === "boolean"
            ? options.keepPanelOpen
            : state.panelOpen;

        prepareForRestart();
        startBilingual({ keepPanelOpen: wasPanelOpen });

        logContentSettings("restartBilingual done", { reason });
      } finally {
        state.restarting = false;
      }
    }

    // -------------------------------------------------------------
    // runtime message handling
    // -------------------------------------------------------------

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
        // フォールバックは設定値（panelDefaultOpen）にする。ランタイム状態（panelOpen）は使わない。
        const resolvedPanelDefaultOpen =
          incoming.panelDefaultOpen ?? state.contentSettings.panelDefaultOpen;
        const next = applySecondaryLangFallback({
          ...state.contentSettings,
          ...incoming,
          panelDefaultOpen: resolvedPanelDefaultOpen,
        });

        state.requestedSecondaryLang =
          incoming.secondaryLang ?? state.requestedSecondaryLang ?? "";

        state.requestedContentSettings = {
          ...state.requestedContentSettings,
          ...incoming,
          panelDefaultOpen: resolvedPanelDefaultOpen,
        };

        state.contentSettings = {
          ...state.contentSettings,
          ...next,
          panelDefaultOpen: resolvedPanelDefaultOpen,
        };

        // panelOpen は incoming に panelDefaultOpen が明示されている場合のみ更新する。
        // 言語変更など panelDefaultOpen を含まない設定変更では上書きしない。
        if ("panelDefaultOpen" in incoming) {
          state.panelOpen = incoming.panelDefaultOpen !== false;
        }

        logContentSettings("SETTINGS_CHANGED received", {
          triggerReason,
          settings: {
            ...incoming,
            appliedSecondaryLang: state.contentSettings.secondaryLang,
            requestedSecondaryLang: state.requestedSecondaryLang,
          },
        });

        const applySettingsAsync = async () => {

          const nextExtensionEnabled = ('extensionEnabled' in incoming)
            ? incoming.extensionEnabled
            : state.contentSettings.extensionEnabled;

          // extensionEnabled=false の早期リターン直前に UI 隠し処理を追加
          if (nextExtensionEnabled !== true) {
            state.contentSettings.extensionEnabled = false;
            state.requestedContentSettings = {
              ...state.requestedContentSettings,
              extensionEnabled: false,
            };
            state.panelOpen = false;

            logContentSettings("SETTINGS_CHANGED disable-branch", {
              triggerReason,
              incoming,
              contentExtensionEnabled: state.contentSettings.extensionEnabled,
              requestedExtensionEnabled: state.requestedContentSettings.extensionEnabled,
            });

            // ここに追加 ↓
            logContentSettings("ネイティブトグル OFF apply start", {
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });

            detachForDisabled();
            mountToggleOnlyUi?.();
            logContentSettings("ネイティブトグル OFF apply done", {
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });

            syncIntervalOrchestrator?.stop?.();
            cleanupInitialAutoStartWatch();
            state.booted = false;
            sendResponse({ ok: true, reason: "disabled" });
            return;
          }

          await syncAppleTvNativeSubtitleToSecondaryLang(
            state.contentSettings.secondaryLang,
            triggerReason,
          );
          // ここに追加 ↓
          logContentSettings("ネイティブトグル ON restart begin", {
            triggerReason,
            panelOpen: state.panelOpen,
            extensionEnabled: state.contentSettings.extensionEnabled,
          });

          restartBilingual(
            {
              ...state.contentSettings,
            },
            "SETTINGS_CHANGED",
            {
              // ランタイムUI状態をそのまま引き継ぐ（設定値 panelDefaultOpen ではない）。
              keepPanelOpen: state.panelOpen,
            },
          );

          if (state.video && state.contentSettings.secondaryLang) {
            cueController.syncSecondarySubtitleTrack(
              state.video,
              state.contentSettings.secondaryLang,
              renderSecondarySubtitle,
            );
            state.secondaryTrack = cueController.getBoundSecondaryTrack();
            cueController.onPrimaryCueChange?.();
          }

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
        };

        applySettingsAsync().catch((error) => {
          logContentError("SETTINGS_CHANGED apply failed", {
            triggerReason,
            message: error?.message || String(error),
          });
          sendResponse({
            ok: false,
            error: error?.message || String(error),
          });
        });

        return true;
      }

      if (message.type === "GET_LANGUAGES") {
        const langs = state.video ? getUniqueTracks(state.video.textTracks) : [];
        logContent("GET_LANGUAGES handled", { count: langs.length });
        sendResponse(langs.map((l) => ({ lang: l.lang, label: l.label })));
        return true;
      }
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