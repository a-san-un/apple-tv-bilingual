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
    // startup logging helpers
    // -------------------------------------------------------

    /** 現在見えている subtitle-like track の状態をログへ残す */
    function logTrackSnapshot(video, triggerReason = "unknown") {
      const subtitleLikeTracks = getSubtitleLikeTracks(video);

      logStartupProbe?.("startup coordinator track snapshot", {
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

    /** attach 開始時点の playback 文脈をログへ残す */
    function logStartupAttach(video, reason = "unknown") {
      logStartupProbe?.("startup coordinator attach", {
        reason,
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        readyState: video?.readyState ?? null,
        paused: typeof video?.paused === "boolean" ? video.paused : null,
        videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
        stateVideoSrcKey: state.lastVideoSrcKey || "",
        contentKey: resolvePlaybackContentKey?.() || "",
        requestedContentSettings: getRequestedContentSettingsSnapshot(),
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

    /**
     * 現在の startup request について track readiness を評価し、
     * requested track が揃っていれば attach 済み target で startBilingual を起動する。
     *
     * @param {Object} input
     * @param {number} input.token
     * @param {HTMLVideoElement|null} input.video
     * @param {string} input.startupReason
     * @param {string} input.triggerReason
     * @param {boolean} [input.keepPanelOpen]
     * @returns {boolean}
     */
    function tryStartWhenTracksReady({
      token,
      video,
      startupReason,
      triggerReason,
      keepPanelOpen,
    }) {
      if (shouldAbortStartupAttempt(token, video)) return false;

      const readiness = getTrackReadinessSnapshot(video);
      const ready =
        readiness.subtitleLikeTrackCount > 0 &&
        readiness.hasRequestedPrimaryTrack &&
        readiness.hasRequestedSecondaryTrack;

      logStartupProbe?.("startup coordinator track readiness", {
        triggerReason,
        startupReason,
        ready,
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        readyState: video?.readyState ?? null,
        paused: typeof video?.paused === "boolean" ? video.paused : null,
        videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
        stateVideoSrcKey: state.lastVideoSrcKey || "",
        requestedContentSettings: getRequestedContentSettingsSnapshot(),
        ...readiness,
      });

      if (!ready) return false;

      // readiness 判定で起動条件を満たした時点で、
      // 同じ target に対する delayed retry は不要になる。
      // 同一 target への重複 startup request / start 実行を防ぐ。
      cleanupDelayedRetry();
      cleanupStartupWatch();

      logTrackSnapshot(video, `ready:${triggerReason}`);

      startBilingual?.({
        reason: `startup_coordinator:${startupReason}:${triggerReason}`,
        ...(typeof keepPanelOpen === "boolean" ? { keepPanelOpen } : {}),
      });

      return true;
    }

    /**
     * 現在の startup request について textTracks readiness を待機する。
     * addtrack と poll を使って requested track の出現を監視し、
     * timeout 時も起動条件を満たしていれば fallback で start へ進める。
     */
    function watchTrackReadiness(video, startupReason, options = {}) {
      cleanupStartupWatch();
      startupAttemptToken += 1;
      const token = startupAttemptToken;
      const { keepPanelOpen } = options;

      if (
        tryStartWhenTracksReady({
          token,
          video,
          startupReason,
          triggerReason: "immediate",
          keepPanelOpen,
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
          startupReason,
          triggerReason: "textTracks_addtrack",
          keepPanelOpen,
        });
      };

      if (textTracks && typeof textTracks.addEventListener === "function") {
        textTracks.addEventListener("addtrack", onAddTrack);
      }

      pollTimer = window.setInterval(() => {
        tryStartWhenTracksReady({
          token,
          video,
          startupReason,
          triggerReason: "poll",
          keepPanelOpen,
        });
      }, 250);

      timeoutTimer = window.setTimeout(() => {
        // startup request が readiness 未達のまま timeout したケースを残す。
        // SPA 遷移直後の track 遅延か、resolver 側の一致条件かを切り分けるためのログ。
        const readiness = getTrackReadinessSnapshot(video);

        logStartupProbe?.("startup coordinator track wait timeout", {
          startupReason,
          keepPanelOpen: typeof keepPanelOpen === "boolean" ? keepPanelOpen : null,
          currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
          readyState: video?.readyState ?? null,
          paused: typeof video?.paused === "boolean" ? video.paused : null,
          videoSrcKey: getCurrentVideoSrcKey?.(video) || "",
          stateVideoSrcKey: state.lastVideoSrcKey || "",
          requestedContentSettings: getRequestedContentSettingsSnapshot(),
          ...readiness,
        });

        cleanupStartupWatch();

        if (shouldAbortStartupAttempt(token, video)) return;

        // requested track が見えているなら、fallback として start へ進める。
        // readiness watch だけ終了して startup request が詰まる状態を避けるための保険。
        const canFallbackStart =
          readiness.subtitleLikeTrackCount > 0 &&
          readiness.hasRequestedPrimaryTrack &&
          readiness.hasRequestedSecondaryTrack;

        if (!canFallbackStart) return;

        // timeout fallback で start へ進める場合も、
        // 同時に走っている delayed retry を止めて同一 target への重複起動を防ぐ。
        cleanupDelayedRetry();

        logTrackSnapshot(video, `timeout_fallback:${startupReason}`);

        startBilingual?.({
          reason: `startup_coordinator:${startupReason}:timeout_fallback`,
          ...(typeof keepPanelOpen === "boolean" ? { keepPanelOpen } : {}),
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
     * 1回だけ遅延 start を試す。
     */
    function scheduleDelayedStartRetry(video, startupReason, options = {}) {
      cleanupDelayedRetry();

      const videoSrcKey = getCurrentVideoSrcKey?.(video) || "";
      if (!video || !videoSrcKey) return;

      delayedRetryVideoSrcKey = videoSrcKey;
      const { keepPanelOpen } = options;

      delayedRetryTimer = window.setTimeout(() => {
        delayedRetryTimer = null;

        if (!state.video || state.video !== video) return;
        if ((getCurrentVideoSrcKey?.(video) || "") !== delayedRetryVideoSrcKey) {
          return;
        }

        logStartupProbe?.("startup coordinator delayed retry", {
          startupReason,
          keepPanelOpen:
            typeof keepPanelOpen === "boolean" ? keepPanelOpen : null,
          videoSrcKey,
        });

        startBilingual?.({
          reason: `startup_coordinator:${startupReason}:delayed_retry`,
          ...(typeof keepPanelOpen === "boolean" ? { keepPanelOpen } : {}),
        });
      }, 1200);
    }

    // -------------------------------------------------------
    // attach / startup orchestration
    // -------------------------------------------------------

    /**
     * 指定された playback target を attach し、
     * 現在の requested settings で起動条件を満たせる場合は
     * tracks readiness wait と delayed retry を含む startup request を開始する。
     *
     * playback startup coordinator は、
     * settings change / SPA target change / retry など複数入口に対する
     * attach → readiness → start 判定の primary owner。
     * settings-runtime.js など他入口は、独自の track wait / direct start を持たず、
     * この関数経由の startup request に収束させる。
     */
    function attachAndMaybeStart(video, reason = "unknown", options = {}) {
      if (!video) return;

      if (state.video && state.video !== video) {
        clearSubtitles?.({
          reason: `startup_coordinator:video_change:${reason}`,
        });
      }

      const current = getVideoAndDialog?.();
      state.video = video;
      state.dialogEl = current?.dialog || state.dialogEl || null;

      attachTracks?.(video);
      logStartupAttach(video, reason);

      // 新しい video へ attach できたら、
      // その video に対する将来の content switch cleanup は
      // まだ未実行として扱えるようにガードを戻す。
      const attachedVideoSrcKey = getCurrentVideoSrcKey?.(video) || "";
      if (attachedVideoSrcKey && attachedVideoSrcKey !== lastCleanedUpVideoSrcKey) {
        lastCleanedUpVideoSrcKey = "";
      }

      if (!canAutoStartFromSavedSettings()) return;

      watchTrackReadiness(video, reason, options);
      scheduleDelayedStartRetry(video, reason, options);
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

      logStartupProbe?.("playback target reattach candidate", {
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
        attachAndMaybeStart(found.video, "boot_found_video");
        return;
      }

      waitForVideo?.((video) => {
        attachAndMaybeStart(video, "boot_waitForVideo");
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
