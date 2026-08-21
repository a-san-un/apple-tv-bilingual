// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-startup-coordinator.js
//
// 役割:
// - video 検出後の attachTracks と自動 startBilingual をまとめる。
// - 保存済み settings が有効な場合だけ、自動起動の可否を判定する。
// - textTracks が実際に利用可能になるまで待ってから startBilingual を呼ぶ。
// - readiness は「requested track が存在するか」だけを見る（cue readiness は見ない）。
// - 待機がtimeoutした場合も、track自体は見えていればfallbackでstartBilingualへ進む。
// - SPA直後に初回 start が空振りした場合に備えて、1回だけ delayed retry を入れる。
// - playback target の変化を監視し、content switch 時の cleanup と再起動を仲介する。
// - playback target change が短時間に連発しても、同じ旧セッションへの cleanup は一度だけに絞る。
// - startBilingual 本体の feature logic は持たず、起動前段の coordination に留める。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  // 再生開始前後の attach / auto start / playback target 切替監視をまとめる。
  // startBilingual 本体には踏み込まず、起動前段の coordination だけを担う。
  function createPlaybackStartupCoordinator({
    state,
    services = {},
  }) {
    const {
      logContent,
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
    // cleanup helpers
    // -------------------------------------------------------

    /** textTracks readiness 待ちの watch を止める */
    function cleanupStartupWatch() {
      if (typeof startupWatchCleanup === "function") {
        try {
          startupWatchCleanup();
        } catch (_) {}
      }
      startupWatchCleanup = null;
    }

    /** delayed retry timer を止める */
    function cleanupDelayedRetry() {
      if (delayedRetryTimer) {
        clearTimeout(delayedRetryTimer);
        delayedRetryTimer = null;
      }
      delayedRetryVideoSrcKey = "";
    }

    /** playback target 監視用 MutationObserver と debounce timer を止める */
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
     * startup watch / delayed retry の世代を進める。
     * 旧 video にぶら下がる非同期経路をまとめて失効させたいときに使う。
     */
    function invalidateStartupAttempts() {
      startupAttemptToken += 1;
      cleanupStartupWatch();
      cleanupDelayedRetry();
    }

    // -------------------------------------------------------
    // saved settings / startup gating
    // -------------------------------------------------------

    /** 保存済み settings から自動起動可能かどうかを返す */
    function canAutoStartFromSavedSettings() {
      return isLanguageSelectionReady?.(state.requestedContentSettings || {});
    }

    /** startup 判定ログ用の requestedContentSettings snapshot を返す */
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

      logContent?.("startup coordinator track snapshot", {
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
      logContent?.("startup coordinator attach", {
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
     * textTracks が ready なら startBilingual を呼ぶ。
     * ready でない場合は false を返して watch 継続へ回す。
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

      logContent?.("startup coordinator track readiness", {
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

      cleanupStartupWatch();

      logTrackSnapshot(video, `ready:${triggerReason}`);

      startBilingual?.({
        reason: `startup_coordinator:${startupReason}:${triggerReason}`,
        ...(typeof keepPanelOpen === "boolean" ? { keepPanelOpen } : {}),
      });

      return true;
    }

    /**
     * textTracks が遅れて生えるケースに備えて、
     * addtrack + poll で readiness を待つ。
     * 待機が timeout した場合も、requested track 自体が見えていれば
     * fallback で startBilingual まで進める（詰まりを防ぐ）。
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
        // requested track が揃わないまま timeout したケースを残す。
        // SPA 遷移直後の track 遅延か、resolver 側の言語一致条件かを切り分けるためのログ。
        const readiness = getTrackReadinessSnapshot(video);

        logContent?.("startup coordinator track wait timeout", {
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

        // track 自体が見えているなら、fallback として startBilingual まで進める。
        // ready にならず watch が終了したまま何も起動しない状態を避けるための保険。
        const canFallbackStart =
          readiness.subtitleLikeTrackCount > 0 &&
          readiness.hasRequestedPrimaryTrack &&
          readiness.hasRequestedSecondaryTrack;

        if (!canFallbackStart) return;

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

        logContent?.("startup coordinator delayed retry", {
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
     * video を attach し、保存済み settings が有効なら
     * tracks ready 待ちを経由して startBilingual まで進める。
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
    // playback target change detection
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
     *   同じ旧 session に対する cleanup は一度だけにする。
     * - cleanup 自体を skip しても、新しい target 探索と attach は継続する。
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

      // 古い delayed retry はここで止める。
      // cleanup を skip する場合でも、旧 video 向け retry は残さない。
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

      logContent?.("playback target reattach candidate", {
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
     * 初回の attach/start と playback target 監視開始をまとめて行う。
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
