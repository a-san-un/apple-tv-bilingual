// =============================================================
// Apple TV+ Bilingual Subtitles - settings-runtime.js
//
// 役割:
// - content 側の設定読み込み・設定反映・再起動開始の流れをまとめて扱う。
// - 保存済み設定から requested settings と effective settings を組み立て、
//   どの設定がユーザー入力そのままの値で、どの設定が補完後の実行値かを分けて保持する。
// - runtime message 経由の SETTINGS_CHANGED / GET_LANGUAGES を受け取り、
//   再生中の設定変更を content 側へ安全に反映する。
// - 拡張 OFF 時は、native 字幕へ制御を戻しつつ、
//   settings-runtime.js が直接持つ playback 参照を明示的に手放す。
// - 拡張 ON 時は、現在の playback 参照を取り直してから
//   bilingual 再起動へつなぎ、古い video / track 参照を再利用しないようにする。
// - トグル操作ごとの相関ログを出し、OFF 側の処理完了と
//   ON 側の再起動完了を同じ操作単位で追跡できるようにする。
//
// このファイルのメンテナンス方針:
// - storage から読んだ設定値と、実際に動作へ使う設定値を混同しない。
// - secondaryLang の補完条件は 1 箇所に集約し、他の分岐へ散らさない。
// - 設定変更時は requestedSecondaryLang と contentSettings.secondaryLang を
//   併記して、設定値の問題か補完後の反映問題かを切り分けやすくする。
// - runtime message の sendResponse は 1 回だけ返す前提を守り、
//   分岐ごとの多重応答や応答漏れを防ぐ。
// - ON/OFF 切り替え時は「既存参照を片付けてから取り直す」順序を崩さず、
//   古い playback state を次の起動へ持ち越さない。
// =============================================================
(function (root) {
  // settings 関連の runtime 処理一式を生成するファクトリ。
  // content 側 state と各種依存関数を受け取り、設定反映と再起動の入口をまとめて返す。
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

    // -------------------------------------------------------
    // トグル操作ログ相関
    // -------------------------------------------------------
    let toggleOpSeq = 0;
    let pendingToggleOffOpId = null;

    // OFF 側トグル操作の相関 ID を発番して保持する。
    // 次に来る ON 側ログと対にするため、最新の OFF 操作 ID を返す。
    function beginToggleOffOp() {
      toggleOpSeq += 1;
      const toggleOpId = `toggle-off-${Date.now()}-${toggleOpSeq}`;
      pendingToggleOffOpId = toggleOpId;
      return toggleOpId;
    }

    // ON 側で使う相関 ID を確定する。
    // 直前の OFF 操作 ID が残っていればそれを再利用し、無ければ単独 ON 用に新規発番する。
    function resolveToggleOnOp() {
      if (pendingToggleOffOpId) {
        const toggleOpId = pendingToggleOffOpId;
        pendingToggleOffOpId = null;
        return { toggleOpId, pairedWithOff: true };
      }

      toggleOpSeq += 1;
      const toggleOpId = `toggle-on-${Date.now()}-${toggleOpSeq}`;
      return { toggleOpId, pairedWithOff: false };
    }

    // -------------------------------------------------------
    // 初回 auto-start 用ヘルパー
    // -------------------------------------------------------

    // 初回 auto-start のために張った監視を解除する。
    // addtrack / polling / timeout の残留を防ぎ、古い video 監視を次回へ持ち越さない。
    function cleanupInitialAutoStartWatch() {
      if (typeof initialAutoStartCleanup === "function") {
        try {
          initialAutoStartCleanup();
        } catch {
        }
      }
      initialAutoStartCleanup = null;
    }

    // textTracks から字幕候補になりうる track だけを抽出する。
    // metadata や id3 を除外し、subtitles / captions / language 付き track を返す。
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

    // 起動に使える字幕系 track が存在するかだけを返す。
    // 初回起動や再取得待ちの readiness 判定を 1 箇所で揃えるための小さな helper。
    function _hasUsableSubtitleTracks(video) {
      return getSubtitleLikeTracks(video).length > 0;
    }

    // 字幕 track が揃うまで待ってから startBilingual する。
    // 初回読み込み直後の「track はまだ無いが video はある」状態で早すぎる起動を避ける。
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

    // -------------------------------------------------------
    // secondary fallback / settings load
    // -------------------------------------------------------

    // secondaryLang 未設定時の補完値を決める。
    // requested settings をそのまま書き換えず、実行時に使う effective 値だけを返す。
    function applySecondaryLangFallback(settings) {
      const primaryLang = String(settings?.primaryLang || "").trim();
      const secondaryLang = String(settings?.secondaryLang || "").trim();

      if (secondaryLang) return secondaryLang;
      if (primaryLang && primaryLang !== "ja") return "ja";
      if (primaryLang === "ja") return "en";
      return "";
    }

    // SETTINGS_CHANGED で使う次回設定を組み立てる。
    // default / 現在 state / incoming の順に merge し、反映前の基準値を揃える。
    function resolveSettingsChangeNextSettings(incoming = {}) {
      return {
        ...DEFAULT_SETTINGS,
        ...state.contentSettings,
        ...incoming,
      };
    }

    // storage から設定スナップショットを読み込み、
    // requested settings と effective settings の両方を state に反映して返す。
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

    // 保存済み設定を読み込んで、現在の playback へ反映を始める。
    // extensionEnabled / language selection readiness を見て、起動するか待機するかを決める。
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
        detachForDisabled({
          reason: "load_settings_from_sync:disabled",
        });
        panelUi?.watchForPlayerTabs?.();
        return;
      }

      if (!isLanguageSelectionReady?.(effectiveSettings)) {
        logContent?.("language selection not ready yet; skip start");
        return;
      }

      startBilingualWhenTracksReady("load_settings_from_sync");
    }

    // -------------------------------------------------------
    // restart orchestration
    // -------------------------------------------------------

    // restart 前に state 上の設定値を更新する。
    // requested / effective / panelOpen を揃え、次の startBilingual が参照する値を整える。
    function applyRestartSettings(settings, options = {}) {
      const { keepPanelOpen = state.panelOpen } = options;

      state.contentSettings = {
        ...state.contentSettings,
        ...settings,
      };

      state.requestedContentSettings = {
        ...state.requestedContentSettings,
        ...settings,
      };

      state.requestedSecondaryLang =
        state.requestedContentSettings.secondaryLang || "";

      state.panelOpen = Boolean(keepPanelOpen);

      logContentSettings("applyRestartSettings", {
        keepPanelOpen: state.panelOpen,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLang: state.requestedSecondaryLang,
        extensionEnabled: state.contentSettings.extensionEnabled,
      });
    }

    // 設定反映後に bilingual の再起動を始める。
    // 再起動前 cleanup と startBilingual 呼び出しをつなぐ orchestrator として使う。
    // toggleOpId は cleanup ログとトグル ON 操作を相関するため、
    // prepareForRestart() へ透過的に引き渡す。
    function restartBilingual(settings, reason = "unknown", options = {}) {
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;

      applyRestartSettings(settings, options);

      if (!state.contentSettings.extensionEnabled) {
        logContent?.("restartBilingual skipped because extension is disabled", {
          reason,
          toggleOpId,
        });
        return;
      }

      prepareForRestart?.({
        reason,
        toggleOpId,
      });

      startBilingual({
        reason,
        toggleOpId,
        keepPanelOpen: state.panelOpen,
      });
    }


    // -------------------------------------------------------
    // トグル完全リセット
    // -------------------------------------------------------

    // settings-runtime.js が直接持っている playback 参照を明示的に切る。
    // OFF 後の再取得で古い video / dialog / track を再利用しないための top-level cleanup。
    function resetTopLevelPlaybackRefsForToggleOff(toggleOpId) {
      const before = {
        toggleOpId,
        hadVideo: Boolean(state.video),
        hadDialogEl: Boolean(state.dialogEl),
        hadPrimaryTrack: Boolean(state.primaryTrack),
        hadSecondaryTrack: Boolean(state.secondaryTrack),
      };

      state.video = null;
      state.dialogEl = null;
      state.primaryTrack = null;
      state.secondaryTrack = null;

      logContentSettings("トグル完全リセット: top-level playback 参照を解放", {
        ...before,
        hasVideoAfter: Boolean(state.video),
        hasDialogElAfter: Boolean(state.dialogEl),
        hasPrimaryTrackAfter: Boolean(state.primaryTrack),
        hasSecondaryTrackAfter: Boolean(state.secondaryTrack),
      });
    }

    // -------------------------------------------------------
    // runtime message
    // -------------------------------------------------------

    // Apple TV+ 側の secondary 字幕選択を現在設定へ同期する。
    // settings 変更後の再起動前に、native 側の字幕状態を拡張設定と揃えるために使う。
    async function syncAppleTvNativeSubtitleToSecondaryLang(
      secondaryLang,
      triggerReason
    ) {
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

    // runtime message を受け取り、設定変更や言語一覧要求を処理する。
    // SETTINGS_CHANGED は非同期で処理し、sendResponse は必ず 1 回だけ返す。
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

        // playback page と video 参照が揃うまで待つ。
        // SETTINGS_CHANGED が早すぎるタイミングで来ても、再生準備完了まで短時間だけ待機する。
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

        // SETTINGS_CHANGED を実際に state と playback へ反映する本体処理。
        // ON/OFF 分岐、native への引き渡し、参照リセット、再起動開始までをここでまとめて行う。
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

          if (false) {
            logContentSettings("SETTINGS_CHANGED received", {
              triggerReason,
              incoming,
              extensionEnabled: state.contentSettings.extensionEnabled,
              panelOpen: state.panelOpen,
              requestedSecondaryLang: state.requestedSecondaryLang,
            });
          }

          const shouldIgnoreDisableTransition =
            state.booted === false &&
            incoming &&
            Object.prototype.hasOwnProperty.call(incoming, "extensionEnabled") &&
            incoming.extensionEnabled !== false &&
            !isLanguageSelectionReady?.(state.contentSettings);

          if (shouldIgnoreDisableTransition) {
            logContentSettings("SETTINGS_CHANGED disable-branch skipped", {
              triggerReason,
              incoming,
              contentExtensionEnabled: state.contentSettings.extensionEnabled,
              requestedExtensionEnabled:
                state.requestedContentSettings.extensionEnabled,
              booted: state.booted,
              primaryLang: state.contentSettings.primaryLang,
              secondaryLang: state.contentSettings.secondaryLang,
            });
          } else if (!state.contentSettings.extensionEnabled) {
            const toggleOpId = beginToggleOffOp();

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
              toggleOpId,
              triggerReason,
              incoming,
              contentExtensionEnabled: state.contentSettings.extensionEnabled,
              requestedExtensionEnabled:
                state.requestedContentSettings.extensionEnabled,
            });

            logContentSettings("ネイティブトグル OFF apply start", {
              toggleOpId,
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });

            syncIntervalOrchestrator?.stop?.();
            cleanupInitialAutoStartWatch();

            logContentSettings("ネイティブトグル OFF cleanup delegated", {
              toggleOpId,
              triggerReason,
              hasCueController: Boolean(cueController),
              cleanupApi: "detachForDisabled",
              primaryHandoffApi:
                typeof cueController?.handoffPrimarySubtitleToNative ===
                "function",
              secondaryUnbindApi:
                typeof cueController?.unbindSecondarySubtitleTrack ===
                "function",
            });

            panelUi?.dispose?.();
            panelUi?.watchForPlayerTabs?.();

            detachForDisabled({
              reason: `settings_changed:${triggerReason}:toggle_off`,
              toggleOpId,
            });

            resetTopLevelPlaybackRefsForToggleOff(toggleOpId);

            logContentSettings("ネイティブトグル OFF apply done", {
              toggleOpId,
              triggerReason,
              panelOpen: state.panelOpen,
              extensionEnabled: state.contentSettings.extensionEnabled,
            });

            state.booted = false;

            return { ok: true, reason: "disabled", toggleOpId };
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
            triggerReason
          );

          const { toggleOpId, pairedWithOff } = resolveToggleOnOp();

          logContentSettings("ネイティブトグル ON restart begin", {
            toggleOpId,
            pairedWithOff,
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
              toggleOpId,
            }
          );

          logContentSettings("ネイティブトグル ON restart done", {
            toggleOpId,
            pairedWithOff,
            triggerReason,
            hasVideo: !!state.video,
            primaryLang: state.contentSettings.primaryLang,
            secondaryLang: state.contentSettings.secondaryLang,
            requestedSecondaryLang: state.requestedSecondaryLang,
            selectedSecondaryTrackLanguage: state.secondaryTrack?.language || "",
            primaryTrackFound: !!state.primaryTrack,
            secondaryTrackFound: !!state.secondaryTrack,
          });

          logContentSettings("content applied settings to tracks", {
            toggleOpId,
            triggerReason,
            hasVideo: !!state.video,
            primaryLang: state.contentSettings.primaryLang,
            secondaryLang: state.contentSettings.secondaryLang,
            requestedSecondaryLang: state.requestedSecondaryLang,
            selectedSecondaryTrackLanguage: state.secondaryTrack?.language || "",
            primaryTrackFound: !!state.primaryTrack,
            secondaryTrackFound: !!state.secondaryTrack,
          });

          return { ok: true, toggleOpId, pairedWithOff };
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
      if (false) {
        logContent("content message listener registered");
      }
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------
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
