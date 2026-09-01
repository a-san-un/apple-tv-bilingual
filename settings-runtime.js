// =============================================================
// Apple TV+ Bilingual Subtitles - settings-runtime.js
//
// 役割:
// - content 側の設定読み込み・設定反映・再評価要求の流れをまとめて扱う。
// - 保存済み設定から requested settings と effective settings を組み立て、
//   どの設定がユーザー入力そのままの値で、どの設定が補完後の実行値かを分けて保持する。
// - runtime message 経由の SETTINGS_CHANGED / GET_LANGUAGES を受け取り、
//   再生中の設定変更を content 側 state へ安全に反映する。
// - 拡張 OFF 時は native 字幕へ制御を戻し、関連 state を teardown 側へ引き渡す。
// - 拡張 ON 時や設定変更時は playback startup coordinator へ再評価要求を出し、
//   direct start や独自 readiness 待ちは持たない。
// - トグル操作ごとの相関ログを出し、OFF 側の処理完了と
//   ON 側の再評価要求を同じ操作単位で追跡できるようにする。
// - settings runtime 起点の startup request について、requestId / videoSrcKey / source
//   を同じ requestContext として cleanup owner / startup coordinator へ引き回す。
//
// このファイルのメンテナンス方針:
// - storage から読んだ設定値と、実際に動作へ使う設定値を混同しない。
// - secondaryLang の補完条件は 1 箇所に集約し、他の分岐へ散らさない。
// - 設定変更時は requestedSecondaryLang と contentSettings.secondaryLang を
//   併記して、設定値の問題か補完後の反映問題かを切り分けやすくする。
// - runtime message の sendResponse は 1 回だけ返す前提を守り、
//   分岐ごとの多重応答や応答漏れを防ぐ。
// - ON/OFF 切り替え時は「既存参照を片付けてから再評価要求を出す」順序を崩さず、
//   古い playback state を次の session へ持ち越さない。
// =============================================================
(function (root) {
  // settings 関連の runtime 処理一式を生成するファクトリ。
  // content 側 state と各種依存関数を受け取り、設定反映と再評価要求の入口をまとめて返す。
  function createSettingsRuntime(deps) {
    const {
      state,
      DEFAULT_SETTINGS,
      isLanguageSelectionReady,
      logContent,
      logContentError,
      logContentSettings,
      logStartupProbe,
      detachForDisabled,
      prepareForRestart,
      isPlaybackPageReady,
      getVideoAndDialog,
      mountToggleOnlyUi,
      getPlaybackStartupCoordinator,
      getCurrentVideoSrcKey,
    } = deps;

    // -------------------------------------------------------
    // トグル操作ログ相関
    // -------------------------------------------------------
    let toggleOpSeq = 0;
    let pendingToggleOffOpId = null;
    let settingsStartupRequestSeq = 0;

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

    /**
     * settings runtime 起点の startup request context を生成する。
     *
     * @param {string} reason
     * @param {object} [options={}]
     * @param {boolean} [options.keepPanelOpen]
     * @param {string|null} [options.toggleOpId]
     * @param {object} [options.requestContext]
     * @returns {{
     *   requestId: string,
     *   reason: string,
     *   source: string,
     *   videoSrcKey: string,
     *   keepPanelOpen: boolean,
     *   toggleOpId: string|null,
     * }}
     */
    function buildSettingsStartupRequestContext(reason, options = {}) {
      settingsStartupRequestSeq += 1;

      const fallbackVideo =
        state.video || getVideoAndDialog?.()?.video || null;
      const fallbackVideoSrcKey =
        getCurrentVideoSrcKey?.(fallbackVideo) || state.lastVideoSrcKey || "";
      const inherited = options.requestContext || {};

      return {
        requestId:
          typeof inherited.requestId === "string" && inherited.requestId.trim()
            ? inherited.requestId.trim()
            : `settings-startup-${Date.now()}-${settingsStartupRequestSeq}`,
        reason:
          typeof reason === "string" && reason ? reason : "unknown",
        source:
          typeof inherited.source === "string" && inherited.source.trim()
            ? inherited.source.trim()
            : "settings_runtime",
        videoSrcKey:
          typeof inherited.videoSrcKey === "string" && inherited.videoSrcKey
            ? inherited.videoSrcKey
            : fallbackVideoSrcKey,
        keepPanelOpen:
          typeof options.keepPanelOpen === "boolean"
            ? options.keepPanelOpen
            : state.panelOpen,
        toggleOpId:
          typeof options.toggleOpId === "string" && options.toggleOpId
            ? options.toggleOpId
            : null,
      };
    }

    // -------------------------------------------------------
    // startup coordinator への再評価要求
    // -------------------------------------------------------

    /**
     * 現在の playback target について startup coordinator へ再評価要求を出す。
     * settings runtime 自身は readiness wait / addtrack watch / retry を持たず、
     * 起動前段の判断は coordinator に委譲する。
     *
     * @param {string} reason
     * @param {{
     *   keepPanelOpen?: boolean,
     *   toggleOpId?: string|null,
     *   requestContext?: object,
     * }} [options]
     * @returns {boolean}
     */
    function requestStartupReevaluation(
      reason = "unknown",
      options = {},
    ) {
      const coordinator = getPlaybackStartupCoordinator?.() || null;
      const requestContext = buildSettingsStartupRequestContext(reason, options);

      if (!coordinator?.attachAndMaybeStart) {
        logStartupProbe?.("settings runtime startup request skipped", {
          requestId: requestContext.requestId,
          reason: requestContext.reason,
          source: requestContext.source,
          videoSrcKey: requestContext.videoSrcKey,
          keepPanelOpen: requestContext.keepPanelOpen,
          toggleOpId: requestContext.toggleOpId,
          skipReason: "startup_coordinator_unavailable",
        });
        return false;
      }

      const video = state.video || getVideoAndDialog?.()?.video || null;
      if (!video) {
        logStartupProbe?.("settings runtime startup request skipped", {
          requestId: requestContext.requestId,
          reason: requestContext.reason,
          source: requestContext.source,
          videoSrcKey: requestContext.videoSrcKey,
          keepPanelOpen: requestContext.keepPanelOpen,
          toggleOpId: requestContext.toggleOpId,
          skipReason: "no_video",
        });
        return false;
      }

      logStartupProbe?.("settings runtime startup request", {
        requestId: requestContext.requestId,
        reason: requestContext.reason,
        source: requestContext.source,
        videoSrcKey: requestContext.videoSrcKey,
        keepPanelOpen: requestContext.keepPanelOpen,
        toggleOpId: requestContext.toggleOpId,
        requestedContentSettings: {
          primaryLang: state.requestedContentSettings?.primaryLang || "",
          secondaryLang: state.requestedContentSettings?.secondaryLang || "",
          panelDefaultOpen:
            state.requestedContentSettings?.panelDefaultOpen ?? null,
        },
      });

      coordinator.attachAndMaybeStart(video, `settings_runtime:${reason}`, {
        keepPanelOpen: requestContext.keepPanelOpen,
        requestContext,
      });
      return true;
    }

    // -------------------------------------------------------
    // secondary fallback / settings load
    // -------------------------------------------------------

    /**
     * secondaryLang 未設定時の補完値を決める。
     * requested settings をそのまま書き換えず、実行時に使う effective 値だけを返す。
     *
     * @param {Object} settings
     * @returns {string}
     */
    function applySecondaryLangFallback(settings) {
      const primaryLang = String(settings?.primaryLang || "").trim();
      const secondaryLang = String(settings?.secondaryLang || "").trim();

      if (secondaryLang) return secondaryLang;
      if (primaryLang && primaryLang !== "ja") return "ja";
      if (primaryLang === "ja") return "en";
      return "";
    }

    /**
     * SETTINGS_CHANGED で使う次回設定を組み立てる。
     * default / 現在 state / incoming の順に merge し、反映前の基準値を揃える。
     *
     * extensionEnabled は runtime state なので、contentSettings には含めない。
     *
     * @param {Object} incoming
     * @returns {Object}
     */
    function resolveSettingsChangeNextSettings(incoming = {}) {
      const nextIncoming = { ...incoming };
      delete nextIncoming.extensionEnabled;

      return {
        ...DEFAULT_SETTINGS,
        ...state.contentSettings,
        ...nextIncoming,
      };
    }

    /**
     * storage から設定スナップショットを読み込み、
     * requested settings と effective settings の両方を state に反映して返す。
     *
     * extensionEnabled は永続設定ではないため、storage からは読まない。
     *
     * @returns {Promise<{
     *   requestedSettings: Object,
     *   effectiveSettings: Object
     * }>}
     */
    async function loadSettingsSnapshot() {
      const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);

      const requestedSettings = {
        ...DEFAULT_SETTINGS,
        ...result,
      };
      delete requestedSettings.extensionEnabled;

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

    /**
     * 保存済み設定を読み込み、現在の playback へ反映を始める。
     *
     * ここでは永続設定だけを反映する。
     * runtime の enable / disable 判定は state.extensionEnabled を正本とする。
     *
     * @returns {Promise<void>}
     */
    async function loadSettingsFromSync() {
      const { requestedSettings, effectiveSettings } = await loadSettingsSnapshot();

      logContentSettings("settings loaded from sync", {
        runtimeExtensionEnabled: state.extensionEnabled,
        primaryLang: effectiveSettings.primaryLang,
        secondaryLang: effectiveSettings.secondaryLang,
        requestedSecondaryLang: requestedSettings.secondaryLang || "",
        panelDefaultOpen: effectiveSettings.panelDefaultOpen,
      });

      if (state.extensionEnabled === false) {
        state.panelOpen = false;
        detachForDisabled({
          reason: "load_settings_from_sync:disabled",
        });
        mountToggleOnlyUi?.();
        return;
      }

      if (!isLanguageSelectionReady?.(effectiveSettings)) {
        logContent?.("language selection not ready yet; skip startup request", {
          reason: "load_settings_from_sync",
          primaryLang: effectiveSettings.primaryLang || "",
          secondaryLang: effectiveSettings.secondaryLang || "",
          requestedPrimaryLang: state.requestedContentSettings?.primaryLang || "",
          requestedSecondaryLang:
            state.requestedContentSettings?.secondaryLang || "",
        });
        return;
      }

      const requestContext = buildSettingsStartupRequestContext(
        "load_settings_from_sync",
        {
          keepPanelOpen: state.panelOpen,
        },
      );

      requestStartupReevaluation("load_settings_from_sync", {
        keepPanelOpen: state.panelOpen,
        requestContext,
      });
    }

    // -------------------------------------------------------
    // rebuild request orchestration
    // state 反映後の restart request を正規化し、
    // cleanup owner と startup coordinator へ同じ requestContext を渡す。
    // -------------------------------------------------------

    /**
     * rebuild request 前に state 上の設定値を更新する。
     * requested / effective / panelOpen を揃え、次の startup coordinator が参照する値を整える。
     *
     * @param {Object} settings
     * @param {Object} [options]
     * @returns {void}
     */
    function applyRestartSettings(settings, options = {}) {
      const { keepPanelOpen = state.panelOpen } = options;
      const safeSettings = { ...settings };
      delete safeSettings.extensionEnabled;

      state.contentSettings = {
        ...state.contentSettings,
        ...safeSettings,
      };

      state.requestedContentSettings = {
        ...state.requestedContentSettings,
        ...safeSettings,
      };

      state.requestedSecondaryLang =
        state.requestedContentSettings.secondaryLang || "";

      state.panelOpen = Boolean(keepPanelOpen);

      logContentSettings("applyRestartSettings", {
        keepPanelOpen: state.panelOpen,
        runtimeExtensionEnabled: state.extensionEnabled,
        primaryLang: state.contentSettings.primaryLang,
        secondaryLang: state.contentSettings.secondaryLang,
        requestedSecondaryLang: state.requestedSecondaryLang,
      });
    }

    /**
     * 設定反映後に restart request を起票する。
     * state 反映後、cleanup owner に restart 準備を依頼し、
     * startup coordinator へ同一 requestContext 付きで再評価要求を発行する。
     * runtime の enable / disable 判定は state.extensionEnabled を使う。
     *
     * @param {Object} settings
     * @param {string} [reason="unknown"]
     * @param {{
     *   keepPanelOpen?: boolean,
     *   toggleOpId?: string|null,
     * }} [options]
     * @returns {void}
     */
    function requestBilingualRestart(settings, reason = "unknown", options = {}) {
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;

      applyRestartSettings(settings, options);

      if (state.extensionEnabled === false) {
        logContent?.(
          "requestBilingualRestart skipped because extension is disabled",
          {
            reason,
            toggleOpId,
          },
        );
        return;
      }

      state.sessionRebuildInProgress = true;

      logContent?.("requestBilingualRestart request flag set", {
        reason,
        toggleOpId,
        keepPanelOpen: state.panelOpen,
      });

      const requestContext = buildSettingsStartupRequestContext(reason, {
        keepPanelOpen: state.panelOpen,
        toggleOpId,
      });

      prepareForRestart?.({
        reason,
        toggleOpId,
        requestContext,
      });

      requestStartupReevaluation(reason, {
        keepPanelOpen: state.panelOpen,
        toggleOpId,
        requestContext,
      });
    }

    // -------------------------------------------------------
    // toggle-off cleanup
    // -------------------------------------------------------

    /**
     * settings-runtime.js が直接持っている playback 参照を明示的に切る。
     * OFF 後の再取得で古い video / dialog / track を再利用しないための top-level cleanup。
     *
     * @param {string|null} toggleOpId
     * @returns {void}
     */
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

    /**
     * Apple TV+ 側の secondary 字幕選択を現在設定へ同期する。
     * settings 変更後の再評価要求前に、native 側の字幕状態を拡張設定と揃えるために使う。
     *
     * @param {string} secondaryLang
     * @param {string} triggerReason
     * @returns {Promise<void>}
     */
    async function syncAppleTvNativeSubtitleToSecondaryLang(
      secondaryLang,
      triggerReason
    ) {
      try {
        await deps.cueController?.syncSecondarySubtitleTrack?.(secondaryLang, {
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

    /**
     * 利用可能な言語一覧を安全に返す。
     * sendResponse は必ず 1 回だけ呼び、失敗時は空配列を返す。
     *
     * @param {Function} sendResponse
     * @returns {void}
     */
    function safeTryGetLanguages(sendResponse) {
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
    }

    /**
     * runtime message を受け取り、設定変更や言語一覧要求を処理する。
     * SETTINGS_CHANGED は state 反映と再評価要求を非同期で処理し、sendResponse は必ず 1 回だけ返す。
     *
     * @param {Object} message
     * @param {chrome.runtime.MessageSender} sender
     * @param {Function} sendResponse
     * @returns {boolean}
     */
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
          const hasRuntimeExtensionEnabled = Object.prototype.hasOwnProperty.call(
            incoming,
            "extensionEnabled"
          );

          if (hasRuntimeExtensionEnabled) {
            state.extensionEnabled = incoming.extensionEnabled !== false;
          }

          const settingsIncoming = { ...incoming };
          delete settingsIncoming.extensionEnabled;

          state.requestedContentSettings = {
            ...state.requestedContentSettings,
            ...settingsIncoming,
          };

          const nextSettings = resolveSettingsChangeNextSettings(settingsIncoming);
          state.contentSettings = {
            ...nextSettings,
          };
          state.requestedSecondaryLang = state.contentSettings.secondaryLang || "";

          const shouldIgnoreDisableTransition =
            state.booted === false &&
            hasRuntimeExtensionEnabled &&
            state.extensionEnabled !== false &&
            !isLanguageSelectionReady?.(state.contentSettings);

          if (shouldIgnoreDisableTransition) {
            logContentSettings("SETTINGS_CHANGED disable-branch skipped", {
              triggerReason,
              incoming,
              runtimeExtensionEnabled: state.extensionEnabled,
              booted: state.booted,
              primaryLang: state.contentSettings.primaryLang,
              secondaryLang: state.contentSettings.secondaryLang,
            });
          } else if (state.extensionEnabled === false) {
            const toggleOpId = beginToggleOffOp();

            state.panelOpen = false;

            logContentSettings("SETTINGS_CHANGED disable-branch", {
              toggleOpId,
              triggerReason,
              incoming,
              runtimeExtensionEnabled: state.extensionEnabled,
            });

            logContentSettings("ネイティブトグル OFF apply start", {
              toggleOpId,
              triggerReason,
              panelOpen: state.panelOpen,
              runtimeExtensionEnabled: state.extensionEnabled,
            });

            deps.syncIntervalOrchestrator?.stop?.();

            logContentSettings("ネイティブトグル OFF cleanup delegated", {
              toggleOpId,
              triggerReason,
              hasCueController: Boolean(deps.cueController),
              cleanupApi: "detachForDisabled",
              primaryHandoffApi:
                typeof deps.cueController?.handoffPrimarySubtitleToNative ===
                "function",
              secondaryUnbindApi:
                typeof deps.cueController?.unbindSecondarySubtitleTrack ===
                "function",
            });

            deps.panelUi?.dispo
            mountToggleOnlyUi?.();

            detachForDisabled({
              reason: `settings_changed:${triggerReason}:toggle_off`,
              toggleOpId,
            });

            resetTopLevelPlaybackRefsForToggleOff(toggleOpId);

            logContentSettings("ネイティブトグル OFF apply done", {
              toggleOpId,
              triggerReason,
              panelOpen: state.panelOpen,
              runtimeExtensionEnabled: state.extensionEnabled,
            });

            state.booted = false;

            return { ok: true, reason: "disabled", toggleOpId };
          }

          const playbackRef = await waitForPlaybackReady();

          if (!playbackRef?.video) {
            logContentSettings("SETTINGS_CHANGED playback not ready", {
              triggerReason,
              panelOpen: state.panelOpen,
              runtimeExtensionEnabled: state.extensionEnabled,
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

          logContentSettings("ネイティブトグル ON startup request begin", {
            toggleOpId,
            pairedWithOff,
            triggerReason,
            panelOpen: state.panelOpen,
            runtimeExtensionEnabled: state.extensionEnabled,
            hasVideo: !!state.video,
          });

          requestBilingualRestart(
            {
              ...state.contentSettings,
            },
            "SETTINGS_CHANGED",
            {
              keepPanelOpen: state.panelOpen,
              toggleOpId,
            }
          );

          logContentSettings("ネイティブトグル ON startup request dispatched", {
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

          logContentSettings("content applied settings before startup request", {
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
          .then((result) => {
            safeSendResponse(result || { ok: true });
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
        safeTryGetLanguages(sendResponse);
        return true;
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
      requestBilingualRestart,
      onRuntimeMessage,
      ensureMessageListener,
    };
  }

  root.settingsRuntime = {
    createSettingsRuntime,
  };
})(window.ATVB || (window.ATVB = {}));
