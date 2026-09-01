// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-startup-coordinator.js
//
// 役割:
// - playback startup / rebuild request の唯一入口として、target / readiness / retry / attach を調停する。
// - settings change・SPA target change・delayed retry など複数入口を同じ起動判定経路へ収束させる。
// - textTracks readiness はこの coordinator だけが待機し、settings-runtime.js など他入口へ待機責務を持たせない。
// - readiness は「requested track が存在するか」を基準に判定し、cue readiness までは扱わない。
// - readiness 待機が timeout しても、requested track が見えていれば fallback で attach / start へ進める。
// - playback target change を監視し、旧 session cleanup の一度化と新 target への再接続を仲介する。
// - delayed retry は startup request の補助手段として扱い、同じ target への重複再試行を抑える。
// - 同一 target に対する重複 request は、この coordinator が dedupe / skip / replace を判断し、
//   requestId 付き compact log で decision reason を残す。
// - startBilingual 本体の feature logic や UI 構築は持たず、起動前段の coordination に限定する。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  // playback startup / rebuild request 前段の調停をまとめる。
  // settings・SPA・retry など複数入口を同じ attach → readiness → start 判定へ収束させる。
  function createPlaybackStartupCoordinator({
    state,
    services = {},
  }) {
    const {
      logContent,
      logStartupProbe,
      isLanguageSelectionReady,
      getPlaybackContext,
      getPlaybackContextLogPayload,
      getVideoAndDialog,
      getCurrentVideoSrcKey,
      resolvePlaybackContentKey,
      waitForVideo,
      attachTracks,
      startBilingual,
      clearSubtitles,
      playbackSessionCleanup,
    } = services;

    let startupWatchCleanup = null;
    let startupAttemptToken = 0;
    let targetObserver = null;
    let lastObservedPlaybackTarget = null;
    let targetChangeDebounceTimer = null;
    let delayedRetryTimer = null;
    let delayedRetryVideoSrcKey = "";

    // 現在進行中の startup request を compact log で相関するための状態。
    // request 単位の識別は requestId、watch/retry の失効判定は startupAttemptToken が担う。
    let startupRequestSequence = 0;
    let activeStartupRequestContext = null;
    let pendingStartupRequestContext = null;
    let lastTrackReadinessSignature = "";

    // 同じ旧 playback session に対して resetForContentSwitch() を
    // 何度も打たないためのガード。
    // SPA / hard seek 中の中間状態で target change が連発しても、
    // 旧 videoSrcKey が同じなら cleanup は一度だけにする。
    let lastCleanedUpVideoSrcKey = "";

    // -------------------------------------------------------
    // startup lifecycle cleanup helpers
    // -------------------------------------------------------

    /** startup request に紐づく textTracks readiness watch を解除する */
    function cleanupStartupWatch() {
      if (typeof startupWatchCleanup === "function") {
        try {
          startupWatchCleanup();
        } catch (_) {}
      }
      startupWatchCleanup = null;
    }

    /** 現在の startup request に紐づく delayed retry timer を解除する */
    function cleanupDelayedRetry() {
      if (delayedRetryTimer) {
        clearTimeout(delayedRetryTimer);
        delayedRetryTimer = null;
      }
      delayedRetryVideoSrcKey = "";
    }

    /** playback target change 監視と、その派生 startup request タイマー群を解除する */
    function cleanupTargetObserver() {
      if (targetObserver) {
        try {
          targetObserver.disconnect();
        } catch (_) {}
      }
      targetObserver = null;

      if (targetChangeDebounceTimer) {
        clearTimeout(targetChangeDebounceTimer);
        targetChangeDebounceTimer = null;
      }

      cleanupDelayedRetry();
      cleanupStartupWatch();
    }

    /**
     * 現在の startup request 世代を進め、旧 target にぶら下がる watch / retry を失効させる。
     * target 切替や rebuild request の再発行時に、古い非同期経路が attach / start へ進まないようにする。
     */
    function invalidateStartupAttempts() {
      startupAttemptToken += 1;
      cleanupStartupWatch();
      cleanupDelayedRetry();
    }

    // -------------------------------------------------------
    // startup request gating
    // -------------------------------------------------------

    /** 現在の requested settings で startup request を進められるか判定する */
    function canAutoStartFromSavedSettings() {
      return isLanguageSelectionReady?.(state.requestedContentSettings || {});
    }

    /** startup request 判定ログ用の requestedContentSettings snapshot を返す */
    function getRequestedContentSettingsSnapshot() {
      return {
        primaryLang: state.requestedContentSettings?.primaryLang || "",
        secondaryLang: state.requestedContentSettings?.secondaryLang || "",
        panelDefaultOpen: state.requestedContentSettings?.panelDefaultOpen ?? null,
      };
    }

    // -------------------------------------------------------
    // track readiness helpers
    // -------------------------------------------------------

    /** subtitles/captions 相当の textTrack だけを抽出する */
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

    /** requested language に合う候補 track が見えているかを判定する */
    function hasRequestedLanguageTrack(video, requestedLang) {
      if (!requestedLang) return true;

      const normalizedRequested = String(requestedLang).trim().toLowerCase();
      if (!normalizedRequested) return true;

      return getSubtitleLikeTracks(video).some((track) => {
        const language = String(track?.language || "").trim().toLowerCase();
        return language === normalizedRequested;
      });
    }

    /**
     * startBilingual を呼べるか判定するための track readiness 情報を返す。
     * subtitle-like track の総数だけでなく、
     * requested primary / secondary が実際に見えているかも含めて判定する。
     * cue の有無は見ない（存在確認のみ）。
     */
    function getTrackReadinessSnapshot(video) {
      const requestedPrimaryLang =
        state.requestedContentSettings?.primaryLang || "";
      const requestedSecondaryLang =
        state.requestedContentSettings?.secondaryLang || "";

      const subtitleLikeTracks = getSubtitleLikeTracks(video);

      return {
        subtitleLikeTrackCount: subtitleLikeTracks.length,
        subtitleLikeTrackLanguages: subtitleLikeTracks.map(
          (track) => track?.language || "",
        ),
        requestedPrimaryLang,
        requestedSecondaryLang,
        hasRequestedPrimaryTrack: hasRequestedLanguageTrack(
          video,
          requestedPrimaryLang,
        ),
        hasRequestedSecondaryTrack: hasRequestedLanguageTrack(
          video,
          requestedSecondaryLang,
        ),
      };
    }

    // -------------------------------------------------------
    // startup request context / compact logging
    // -------------------------------------------------------

    /** startup request を一意に識別する requestId を採番する */
    function createStartupRequestId(reason = "unknown") {
      startupRequestSequence += 1;
      const normalizedReason = String(reason || "unknown")
        .trim()
        .replace(/[^a-zA-Z0-9:_-]+/g, "_")
        .slice(0, 48) || "unknown";
      return `startup-${startupRequestSequence}:${normalizedReason}`;
    }

    /**
     * startup coordinator 内で使う request context を正規化する。
     * 入口が requestId を持っていなくても、この coordinator が採番して相関可能にする。
     *
     * @param {Object} [input]
     * @param {string} [input.reason]
     * @param {string} [input.requestId]
     * @param {string} [input.source]
     * @param {string} [input.videoSrcKey]
     * @param {boolean} [input.keepPanelOpen]
     * @returns {Object}
     */
    function normalizeStartupRequestContext(input = {}) {
      const reason =
        typeof input.reason === "string" && input.reason.trim()
          ? input.reason.trim()
          : "unknown";
      const requestId =
        typeof input.requestId === "string" && input.requestId.trim()
          ? input.requestId.trim()
          : createStartupRequestId(reason);

      return {
        requestId,
        reason,
        source:
          typeof input.source === "string" && input.source.trim()
            ? input.source.trim()
            : "startup_coordinator",
        videoSrcKey:
          typeof input.videoSrcKey === "string" ? input.videoSrcKey : "",
        keepPanelOpen:
          typeof input.keepPanelOpen === "boolean"
            ? input.keepPanelOpen
            : undefined,
      };
    }

    /** compact log 用に startup request 状態を要約する */
    function getStartupRequestStateSnapshot() {
      return {
        activeRequestId: activeStartupRequestContext?.requestId || "",
        activeReason: activeStartupRequestContext?.reason || "",
        activeVideoSrcKey: activeStartupRequestContext?.videoSrcKey || "",
        pendingRequestId: pendingStartupRequestContext?.requestId || "",
        pendingReason: pendingStartupRequestContext?.reason || "",
        pendingVideoSrcKey: pendingStartupRequestContext?.videoSrcKey || "",
      };
    }

    /** 通常ログ向けの subtitle-like track 要約を返す */
    function getTrackReadinessSummary(readiness) {
      return {
        trackCount: readiness?.subtitleLikeTrackCount ?? 0,
        candidateCount: Array.isArray(readiness?.subtitleLikeTrackLanguages)
          ? readiness.subtitleLikeTrackLanguages.filter(Boolean).length
          : 0,
        requestedPrimaryLang: readiness?.requestedPrimaryLang || "",
        requestedSecondaryLang: readiness?.requestedSecondaryLang || "",
        hasRequestedPrimaryTrack: Boolean(readiness?.hasRequestedPrimaryTrack),
        hasRequestedSecondaryTrack: Boolean(readiness?.hasRequestedSecondaryTrack),
        availableLanguages: Array.isArray(readiness?.subtitleLikeTrackLanguages)
          ? readiness.subtitleLikeTrackLanguages.filter(Boolean)
          : [],
      };
    }

    /** 現在見えている全 track 情報は opt-in probe 用にだけ残す */
    function logTrackSnapshotOptIn(video, requestContext, triggerReason = "unknown") {
      const subtitleLikeTracks = getSubtitleLikeTracks(video);

      logStartupProbe?.("startup coordinator track snapshot", {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        triggerReason,
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        readyState: video?.readyState ?? null,
        paused: typeof video?.paused === "boolean" ? video.paused : null,
        videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
        stateVideoSrcKey: state.lastVideoSrcKey || "",
        requestedContentSettings: getRequestedContentSettingsSnapshot(),
        tracks: subtitleLikeTracks.map((track, index) => ({
          index,
          kind: track?.kind || "",
          label: track?.label || "",
          language: track?.language || "",
          mode: track?.mode || "",
          cueCount:
            Number.isFinite(track?.cues?.length) ? track.cues.length : null,
        })),
      });
    }

    /** startup coordinator の通常ログを compact な形で残す */
    function logStartupLifecycle(eventName, payload = {}) {
      logStartupProbe?.(eventName, {
        ...getStartupRequestStateSnapshot(),
        ...payload,
      });
    }

    /** attach 開始時点の startup request を compact に残す */
    function logStartupAttach(video, requestContext, payload = {}) {
      logStartupLifecycle("startup coordinator attach", {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        source: requestContext?.source || "startup_coordinator",
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        readyState: video?.readyState ?? null,
        paused: typeof video?.paused === "boolean" ? video.paused : null,
        videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
        stateVideoSrcKey: state.lastVideoSrcKey || "",
        contentKey: resolvePlaybackContentKey?.() || "",
        requestedContentSettings: getRequestedContentSettingsSnapshot(),
        ...payload,
      });
    }

    // -------------------------------------------------------
    // startup request decision helpers
    // -------------------------------------------------------

    /**
     * startup request decision を compact log へ残す。
     * attach 実行前の dedupe / skip / replace 判定を、
     * request 単位で比較できる形に揃える。
     *
     * @param {Object} requestContext
     * @param {Object} decision
     */
    function logStartupDecision(requestContext, decision = {}) {
      logStartupLifecycle("startup coordinator decision", {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        source: requestContext?.source || "startup_coordinator",
        videoSrcKey: requestContext?.videoSrcKey || "",
        decision: decision?.decision || "attach",
        decisionReason: decision?.decisionReason || "",
        replacedPendingRequestId: decision?.replacedPendingRequestId || "",
        matchedPendingRequestId: decision?.matchedPendingRequestId || "",
        matchedActiveRequestId: decision?.matchedActiveRequestId || "",
        shouldAttach: Boolean(decision?.shouldAttach),
        shouldWatch: Boolean(decision?.shouldWatch),
        shouldScheduleRetry: Boolean(decision?.shouldScheduleRetry),
      });
    }

    /**
     * startup request を pending / active request 状態と比較し、
     * attach 前に実行すべき decision を返す。
     *
     * decision 一覧:
     * - attach: 新しい request として attach / readiness watch へ進める
     * - dedupe_pending_same_target: 同じ target を待機中の pending request があるため吸収する
     * - skip_active_same_target: 同じ target で既に active request が start dispatch 済みのため見送る
     * - replace_pending_new_target: 別 target の pending request を新 request で置き換える
     *
     * @param {HTMLVideoElement|null} video
     * @param {Object} requestContext
     * @returns {Object}
     */
    function resolveStartupRequestDecision(video, requestContext) {
      const requestVideoSrcKey =
        requestContext?.videoSrcKey ||
        getCurrentVideoSrcKey?.(video) ||
        "";

      const hasPendingRequest = Boolean(pendingStartupRequestContext?.requestId);
      const hasActiveRequest = Boolean(activeStartupRequestContext?.requestId);

      const pendingVideoSrcKey = pendingStartupRequestContext?.videoSrcKey || "";
      const activeVideoSrcKey = activeStartupRequestContext?.videoSrcKey || "";

      const samePendingTarget =
        Boolean(requestVideoSrcKey) &&
        Boolean(pendingVideoSrcKey) &&
        requestVideoSrcKey === pendingVideoSrcKey;

      const sameActiveTarget =
        Boolean(requestVideoSrcKey) &&
        Boolean(activeVideoSrcKey) &&
        requestVideoSrcKey === activeVideoSrcKey;

      if (hasPendingRequest && samePendingTarget) {
        return {
          decision: "dedupe_pending_same_target",
          decisionReason: "pending_request_already_waiting_for_same_video_src",
          matchedPendingRequestId:
            pendingStartupRequestContext?.requestId || "",
          shouldAttach: false,
          shouldWatch: false,
          shouldScheduleRetry: false,
        };
      }

      if (hasActiveRequest && sameActiveTarget) {
        return {
          decision: "skip_active_same_target",
          decisionReason: "active_request_already_started_for_same_video_src",
          matchedActiveRequestId:
            activeStartupRequestContext?.requestId || "",
          shouldAttach: false,
          shouldWatch: false,
          shouldScheduleRetry: false,
        };
      }

      if (
        hasPendingRequest &&
        pendingVideoSrcKey &&
        requestVideoSrcKey &&
        pendingVideoSrcKey !== requestVideoSrcKey
      ) {
        return {
          decision: "replace_pending_new_target",
          decisionReason: "pending_request_target_changed",
          replacedPendingRequestId:
            pendingStartupRequestContext?.requestId || "",
          shouldAttach: true,
          shouldWatch: true,
          shouldScheduleRetry: true,
        };
      }

      return {
        decision: "attach",
        decisionReason: hasPendingRequest
          ? "pending_request_replaced_without_video_src_match"
          : "new_startup_request",
        replacedPendingRequestId:
          hasPendingRequest ? pendingStartupRequestContext?.requestId || "" : "",
        shouldAttach: true,
        shouldWatch: true,
        shouldScheduleRetry: true,
      };
    }

    /**
     * pending request を新 request へ更新し、置換時は相関ログを残す。
     *
     * @param {Object} requestContext
     * @param {Object} decision
     */
    function setPendingStartupRequestContext(requestContext, decision = {}) {
      const previousPendingRequestId =
        pendingStartupRequestContext?.requestId || "";

      pendingStartupRequestContext = requestContext;

      if (
        previousPendingRequestId &&
        previousPendingRequestId !== requestContext?.requestId
      ) {
        logStartupLifecycle("startup coordinator pending request replaced", {
          requestId: requestContext?.requestId || "",
          reason: requestContext?.reason || "unknown",
          replacedPendingRequestId:
            decision?.replacedPendingRequestId || previousPendingRequestId,
          videoSrcKey: requestContext?.videoSrcKey || "",
          replaceReason: decision?.decisionReason || "",
        });
      }
    }

    /**
     * pending request を active request へ昇格させる直前に clear し、
     * pending → active の移行を compact log で残す。
     *
     * @param {Object} requestContext
     * @param {string} triggerReason
     * @param {string} videoSrcKey
     */
    function clearPendingStartupRequestContextForStart(
      requestContext,
      triggerReason,
      videoSrcKey,
    ) {
      const clearedRequestId = pendingStartupRequestContext?.requestId || "";
      pendingStartupRequestContext = null;

      logStartupLifecycle("startup coordinator pending request cleared", {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        clearedPendingRequestId: clearedRequestId,
        triggerReason,
        videoSrcKey: videoSrcKey || "",
      });
    }

    // -------------------------------------------------------
    // startup attempt helpers
    // -------------------------------------------------------

    /** watch 中の起動試行がまだ有効かどうかを判定する */
    function shouldAbortStartupAttempt(token, video) {
      if (token !== startupAttemptToken) return true;
      if (!state.video || state.video !== video) return true;
      return false;
    }

    /** readiness の通常ログを、変化したときだけ compact に残す */
    function logTrackReadinessCompact({
      requestContext,
      triggerReason,
      video,
      readiness,
      ready,
    }) {
      const summary = getTrackReadinessSummary(readiness);
      const signature = JSON.stringify({
        requestId: requestContext?.requestId || "",
        triggerReason,
        videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
        ready,
        ...summary,
      });

      if (signature === lastTrackReadinessSignature) {
        return;
      }
      lastTrackReadinessSignature = signature;

      logStartupLifecycle("startup coordinator track readiness", {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        triggerReason,
        ready,
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        readyState: video?.readyState ?? null,
        paused: typeof video?.paused === "boolean" ? video.paused : null,
        videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
        stateVideoSrcKey: state.lastVideoSrcKey || "",
        ...summary,
      });
    }

    /**
     * 現在の startup request について track readiness を評価し、
     * requested track が揃っていれば attach 済み target で startBilingual を起動する。
     *
     * @param {Object} input
     * @param {number} input.token
     * @param {HTMLVideoElement|null} input.video
     * @param {Object} input.requestContext
     * @param {string} input.triggerReason
     * @returns {boolean}
     */
    function tryStartWhenTracksReady({
      token,
      video,
      requestContext,
      triggerReason,
    }) {
      if (shouldAbortStartupAttempt(token, video)) return false;

      const readiness = getTrackReadinessSnapshot(video);
      const ready =
        readiness.subtitleLikeTrackCount > 0 &&
        readiness.hasRequestedPrimaryTrack &&
        readiness.hasRequestedSecondaryTrack;

      logTrackReadinessCompact({
        requestContext,
        triggerReason,
        video,
        readiness,
        ready,
      });

      if (!ready) return false;

      cleanupDelayedRetry();
      cleanupStartupWatch();

      activeStartupRequestContext = {
        ...requestContext,
        videoSrcKey:
          getCurrentVideoSrcKey?.(video) ||
          requestContext?.videoSrcKey ||
          "",
      };
      clearPendingStartupRequestContextForStart(
        activeStartupRequestContext,
        triggerReason,
        activeStartupRequestContext.videoSrcKey,
      );

      logStartupLifecycle("startup coordinator start dispatched", {
        requestId: requestContext?.requestId || "",
        reason: requestContext?.reason || "unknown",
        triggerReason,
        videoSrcKey: activeStartupRequestContext.videoSrcKey,
        startReason: `startup_coordinator:${requestContext?.reason || "unknown"}:${triggerReason}`,
      });

      logTrackSnapshotOptIn(
        video,
        activeStartupRequestContext,
        `ready:${triggerReason}`,
      );

      startBilingual?.({
        reason: `startup_coordinator:${requestContext?.reason || "unknown"}:${triggerReason}`,
        requestContext: activeStartupRequestContext,
        ...(typeof requestContext?.keepPanelOpen === "boolean"
          ? { keepPanelOpen: requestContext.keepPanelOpen }
          : {}),
      });

      return true;
    }

    /**
     * 現在の startup request について textTracks readiness を待機する。
     * addtrack と poll を使って requested track の出現を監視し、
     * timeout 時も起動条件を満たしていれば fallback で start へ進める。
     */
    function watchTrackReadiness(video, requestContext) {
      cleanupStartupWatch();
      startupAttemptToken += 1;
      const token = startupAttemptToken;
      lastTrackReadinessSignature = "";

      if (
        tryStartWhenTracksReady({
          token,
          video,
          requestContext,
          triggerReason: "immediate",
        })
      ) {
        return;
      }

      const textTracks = video?.textTracks || null;
      let pollTimer = null;
      let timeoutTimer = null;

      const onAddTrack = () => {
        tryStartWhenTracksReady({
          token,
          video,
          requestContext,
          triggerReason: "textTracks_addtrack",
        });
      };

      if (textTracks && typeof textTracks.addEventListener === "function") {
        textTracks.addEventListener("addtrack", onAddTrack);
      }

      pollTimer = window.setInterval(() => {
        tryStartWhenTracksReady({
          token,
          video,
          requestContext,
          triggerReason: "poll",
        });
      }, 250);

      timeoutTimer = window.setTimeout(() => {
        const readiness = getTrackReadinessSnapshot(video);
        const summary = getTrackReadinessSummary(readiness);

        logStartupLifecycle("startup coordinator track wait timeout", {
          requestId: requestContext?.requestId || "",
          reason: requestContext?.reason || "unknown",
          currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
          readyState: video?.readyState ?? null,
          paused: typeof video?.paused === "boolean" ? video.paused : null,
          videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
          stateVideoSrcKey: state.lastVideoSrcKey || "",
          ...summary,
        });

        cleanupStartupWatch();

        if (shouldAbortStartupAttempt(token, video)) return;

        const canFallbackStart =
          readiness.subtitleLikeTrackCount > 0 &&
          readiness.hasRequestedPrimaryTrack &&
          readiness.hasRequestedSecondaryTrack;

        if (!canFallbackStart) return;

        cleanupDelayedRetry();

        activeStartupRequestContext = {
          ...requestContext,
          videoSrcKey:
            getCurrentVideoSrcKey?.(video) ||
            requestContext?.videoSrcKey ||
            "",
        };
        clearPendingStartupRequestContextForStart(
          activeStartupRequestContext,
          "timeout_fallback",
          activeStartupRequestContext.videoSrcKey,
        );

        logStartupLifecycle("startup coordinator start dispatched", {
          requestId: requestContext?.requestId || "",
          reason: requestContext?.reason || "unknown",
          triggerReason: "timeout_fallback",
          videoSrcKey: activeStartupRequestContext.videoSrcKey,
          startReason: `startup_coordinator:${requestContext?.reason || "unknown"}:timeout_fallback`,
        });

        logTrackSnapshotOptIn(
          video,
          activeStartupRequestContext,
          "timeout_fallback",
        );

        startBilingual?.({
          reason: `startup_coordinator:${requestContext?.reason || "unknown"}:timeout_fallback`,
          requestContext: activeStartupRequestContext,
          ...(typeof requestContext?.keepPanelOpen === "boolean"
            ? { keepPanelOpen: requestContext.keepPanelOpen }
            : {}),
        });
      }, 10000);

      startupWatchCleanup = () => {
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

    /**
     * SPA 直後に tracks ready 判定が空振りした場合に備えて、
     * 同じ startup request にぶら下げて 1回だけ遅延 start を試す。
     */
    function scheduleDelayedStartRetry(video, requestContext) {
      cleanupDelayedRetry();

      const videoSrcKey = getCurrentVideoSrcKey?.(video) || "";
      if (!video || !videoSrcKey) return;

      delayedRetryVideoSrcKey = videoSrcKey;

      delayedRetryTimer = window.setTimeout(() => {
        delayedRetryTimer = null;

        if (!state.video || state.video !== video) return;
        if ((getCurrentVideoSrcKey?.(video) || "") !== delayedRetryVideoSrcKey) {
          return;
        }

        activeStartupRequestContext = {
          ...requestContext,
          videoSrcKey,
        };
        clearPendingStartupRequestContextForStart(
          activeStartupRequestContext,
          "delayed_retry",
          videoSrcKey,
        );

        logStartupLifecycle("startup coordinator delayed retry", {
          requestId: requestContext?.requestId || "",
          reason: requestContext?.reason || "unknown",
          videoSrcKey,
        });

        startBilingual?.({
          reason: `startup_coordinator:${requestContext?.reason || "unknown"}:delayed_retry`,
          requestContext: activeStartupRequestContext,
          ...(typeof requestContext?.keepPanelOpen === "boolean"
            ? { keepPanelOpen: requestContext.keepPanelOpen }
            : {}),
        });
      }, 1200);
    }

    // -------------------------------------------------------
    // attach / startup orchestration
    // -------------------------------------------------------

    /**
     * 指定された playback target を attach し、
     * requestId 付きの startup request として readiness wait / retry / start を開始する。
     *
     * この関数は startup request の primary owner として、
     * 同一 target request の dedupe / skip / replace decision を attach 前に確定する。
     *
     * @param {HTMLVideoElement|null} video
     * @param {string} [reason="unknown"]
     * @param {Object} [options={}]
     * @param {string} [options.requestId]
     * @param {string} [options.source]
     * @param {boolean} [options.keepPanelOpen]
     */
    function attachAndMaybeStart(video, reason = "unknown", options = {}) {
      if (!video) return;

      const videoSrcKey = getCurrentVideoSrcKey?.(video) || "";
      const requestContext = normalizeStartupRequestContext({
        reason,
        requestId: options?.requestId,
        source: options?.source,
        videoSrcKey,
        keepPanelOpen: options?.keepPanelOpen,
      });

      logStartupLifecycle("startup coordinator request", {
        requestId: requestContext.requestId,
        reason: requestContext.reason,
        source: requestContext.source,
        videoSrcKey,
        keepPanelOpen:
          typeof requestContext.keepPanelOpen === "boolean"
            ? requestContext.keepPanelOpen
            : null,
      });

      if (!canAutoStartFromSavedSettings()) {
        logStartupLifecycle("startup coordinator request skipped", {
          requestId: requestContext.requestId,
          reason: requestContext.reason,
          source: requestContext.source,
          skipReason: "language_selection_not_ready",
          videoSrcKey,
        });
        return;
      }

      const decision = resolveStartupRequestDecision(video, requestContext);
      logStartupDecision(requestContext, decision);

      if (!decision.shouldAttach) {
        return;
      }

      if (state.video && state.video !== video) {
        clearSubtitles?.({
          reason: `startup_coordinator:video_change:${reason}`,
        });
      }

      setPendingStartupRequestContext(requestContext, decision);

      const current = getVideoAndDialog?.();
      state.video = video;
      state.dialogEl = current?.dialog || state.dialogEl || null;

      attachTracks?.(video, {
        requestContext,
      });
      logStartupAttach(video, requestContext, {
        decision: decision.decision,
        decisionReason: decision.decisionReason,
      });

      // 新しい video へ attach できたら、
      // その video に対する将来の content switch cleanup は
      // まだ未実行として扱えるようにガードを戻す。
      if (videoSrcKey && videoSrcKey !== lastCleanedUpVideoSrcKey) {
        lastCleanedUpVideoSrcKey = "";
      }

      if (decision.shouldWatch) {
        watchTrackReadiness(video, requestContext);
      }

      if (decision.shouldScheduleRetry) {
        scheduleDelayedStartRetry(video, requestContext);
      }
    }

    // -------------------------------------------------------
    // playback target change handling
    // -------------------------------------------------------

    /**
     * 現在の playback target を表す最小 snapshot を返す。
     * URL ではなく contentKey / videoSrcKey / readiness を基準に比較する。
     */
    function getPlaybackTargetSnapshot() {
      const ctx = getPlaybackContext?.() || {};
      const found = getVideoAndDialog?.();

      const video =
        found?.video ||
        ctx.video ||
        null;

      const dialog =
        found?.dialog ||
        ctx.playbackDialog ||
        ctx.playbackView?.closest?.("dialog") ||
        null;

      const isPlaybackReady = Boolean(ctx.isPlaybackReady);
      const contentKey = isPlaybackReady
        ? resolvePlaybackContentKey?.(ctx) || ""
        : state.currentContentKey || "";

      const videoSrcKey = video
        ? getCurrentVideoSrcKey?.(video) || ""
        : "";

      return {
        hasPlaybackReady: isPlaybackReady,
        hasVideo: Boolean(video),
        hasDialog: Boolean(dialog),
        contentKey,
        videoSrcKey,
      };
    }

    /** 前回 snapshot と比較して playback target が切り替わったかを返す */
    function hasPlaybackTargetChanged(previousSnapshot, nextSnapshot) {
      if (!previousSnapshot) return false;

      return (
        previousSnapshot.contentKey !== nextSnapshot.contentKey ||
        previousSnapshot.videoSrcKey !== nextSnapshot.videoSrcKey ||
        previousSnapshot.hasPlaybackReady !== nextSnapshot.hasPlaybackReady ||
        previousSnapshot.hasVideo !== nextSnapshot.hasVideo ||
        previousSnapshot.hasDialog !== nextSnapshot.hasDialog
      );
    }

    /**
     * 旧 playback target を cleanup 一度化の観点で識別するキーを返す。
     * まずは旧 videoSrcKey を基準にし、空なら state.lastVideoSrcKey を使う。
     */
    function getSessionCleanupKey(snapshot) {
      if (!snapshot) return "";
      return snapshot.videoSrcKey || state.lastVideoSrcKey || "";
    }

    /**
     * playback target が切り替わったときの共通経路。
     * cleanup を実行し、新しい target があれば attach → start へ進める。
     *
     * 重要:
     * - MutationObserver の burst や SPA 中間状態で target change が連発しても、
     *   同じ旧 session に対する cleanup request は一度だけにする。
     * - cleanup を skip しても、新しい target の探索と次の startup request 判定は継続する。
     */
    function handlePlaybackTargetChange(reason = "unknown") {
      const nextTarget = getPlaybackTargetSnapshot();

      if (!hasPlaybackTargetChanged(lastObservedPlaybackTarget, nextTarget)) {
        return;
      }

      const previousTarget = lastObservedPlaybackTarget;
      lastObservedPlaybackTarget = nextTarget;

      const previousContentKey =
        previousTarget?.contentKey || state.currentContentKey || "";
      const previousVideoSrcKey =
        previousTarget?.videoSrcKey || state.lastVideoSrcKey || "";
      const cleanupKey = getSessionCleanupKey(previousTarget);
      const alreadyCleanedUp =
        Boolean(cleanupKey) && cleanupKey === lastCleanedUpVideoSrcKey;

      logContent?.("playback target changed", {
        reason,
        previousContentKey,
        nextContentKey: nextTarget.contentKey,
        previousVideoSrcKey,
        nextVideoSrcKey: nextTarget.videoSrcKey,
        previousPlaybackReady: previousTarget?.hasPlaybackReady ?? false,
        nextPlaybackReady: nextTarget.hasPlaybackReady,
        previousHasVideo: previousTarget?.hasVideo ?? false,
        nextHasVideo: nextTarget.hasVideo,
        previousHasDialog: previousTarget?.hasDialog ?? false,
        nextHasDialog: nextTarget.hasDialog,
        cleanupKey,
        alreadyCleanedUp,
      });

      // 古い target に紐づく delayed retry はここで止める。
      // cleanup を skip する場合でも、旧 target 向け retry は残さない。
      cleanupDelayedRetry();

      if (!alreadyCleanedUp) {
        playbackSessionCleanup?.resetForContentSwitch?.(
          "playback_target_changed",
        );

        if (cleanupKey) {
          lastCleanedUpVideoSrcKey = cleanupKey;
        }

        // 旧 session に紐づく readiness watch / poll / timeout fallback を
        // この時点でまとめて失効させる。
        invalidateStartupAttempts();
      } else {
        logContent?.("playback target changed cleanup skipped", {
          reason,
          cleanupKey,
          previousContentKey,
          previousVideoSrcKey,
          nextContentKey: nextTarget.contentKey,
          nextVideoSrcKey: nextTarget.videoSrcKey,
        });
      }

      const found = getVideoAndDialog?.();

      logStartupLifecycle("playback target reattach candidate", {
        reason,
        foundVideo: Boolean(found?.video),
        foundDialog: Boolean(found?.dialog || found?.dialogEl),
        currentTime: Number.isFinite(found?.video?.currentTime)
          ? found.video.currentTime
          : null,
        nextContentKey: nextTarget.contentKey,
        nextVideoSrcKey: nextTarget.videoSrcKey,
      });

      if (found?.video) {
        attachAndMaybeStart(found.video, "playback_target_changed", {
          source: "playback_target_change",
          keepPanelOpen: state.panelOpen,
        });
        return;
      }

      state.video = null;
      state.dialogEl = null;
      state.lastVideoSrcKey = "";

      playbackSessionCleanup?.handleNavigationTargetMissing?.({
        reason,
        playbackContext: {
          ...(getPlaybackContextLogPayload?.() || {}),
          nextContentKey: nextTarget.contentKey,
          nextVideoSrcKey: nextTarget.videoSrcKey,
        },
      });
    }

    /** MutationObserver の burst を少しまとめて recheck する */
    function schedulePlaybackTargetRecheck(reason = "mutation_observer") {
      if (targetChangeDebounceTimer) {
        clearTimeout(targetChangeDebounceTimer);
      }

      targetChangeDebounceTimer = window.setTimeout(() => {
        targetChangeDebounceTimer = null;
        handlePlaybackTargetChange(reason);
      }, 80);
    }

    /** playback target 変化監視を開始する */
    function startPlaybackTargetObserver() {
      cleanupTargetObserver();
      lastObservedPlaybackTarget = getPlaybackTargetSnapshot();

      targetObserver = new MutationObserver(() => {
        schedulePlaybackTargetRecheck("mutation_observer");
      });

      targetObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------

    /**
     * coordinator の起動エントリ。
     * 現在の playback target に対する最初の起動評価と、
     * 以後の playback target change 監視開始をまとめて行う。
     */
    function boot() {
      startPlaybackTargetObserver();

      const found = getVideoAndDialog?.();
      if (found?.video) {
        attachAndMaybeStart(found.video, "boot_found_video", {
          source: "boot",
        });
        return;
      }

      waitForVideo?.((video) => {
        attachAndMaybeStart(video, "boot_waitForVideo", {
          source: "boot",
        });
      });
    }

    return {
      canAutoStartFromSavedSettings,
      attachAndMaybeStart,
      boot,
      cleanupStartupWatch,
      cleanupTargetObserver,
      handlePlaybackTargetChange,
    };
  }

  root.createPlaybackStartupCoordinator = createPlaybackStartupCoordinator;
})();
