// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-startup-coordinator.js
//
// 役割:
// - video 検出後の attachTracks と自動 startBilingual をまとめる。
// - 保存済み settings が有効な場合だけ、自動起動の可否を判定する。
// - textTracks が実際に利用可能になるまで待ってから startBilingual を呼ぶ。
// - startBilingual 本体の feature logic は持たず、起動前段の coordination に留める。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  function createPlaybackStartupCoordinator({
    state,
    services = {},
  }) {
    const {
      logContent,
      isLanguageSelectionReady,
      getVideoAndDialog,
      waitForVideo,
      attachTracks,
      startBilingual,
      clearSubtitles,
    } = services;

    let startupWatchCleanup = null;
    let startupAttemptToken = 0;

    function cleanupStartupWatch() {
      if (typeof startupWatchCleanup === "function") {
        try {
          startupWatchCleanup();
        } catch (_) {}
      }
      startupWatchCleanup = null;
    }

    function canAutoStartFromSavedSettings() {
      return isLanguageSelectionReady?.(state.requestedContentSettings || {});
    }

    function getRequestedContentSettingsSnapshot() {
      return {
        primaryLang: state.requestedContentSettings?.primaryLang || "",
        secondaryLang: state.requestedContentSettings?.secondaryLang || "",
        showSidebar: state.requestedContentSettings?.showSidebar ?? null,
      };
    }

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

    function getTrackReadinessSnapshot(video) {
      return {
        totalTrackCount: video?.textTracks?.length ?? 0,
        subtitleLikeTrackCount: getSubtitleLikeTracks(video).length,
      };
    }

    function logTrackSnapshot(video, reason) {
      const tracks = Array.from(video?.textTracks || []).map((track, index) => ({
        index,
        kind: track?.kind || "",
        label: track?.label || "",
        language: track?.language || "",
        mode: track?.mode || "",
        cuesLength: track?.cues?.length ?? 0,
      }));

      logContent?.("startup coordinator track snapshot", {
        reason,
        ...getTrackReadinessSnapshot(video),
        tracks,
      });
    }

    function logStartupAttach(video, reason) {
      logContent?.("startup coordinator attach", {
        reason,
        hasVideo: Boolean(video),
        trackCount: video?.textTracks?.length ?? 0,
        canAutoStart: canAutoStartFromSavedSettings(),
        requestedContentSettings: getRequestedContentSettingsSnapshot(),
      });
    }

    function shouldAbortStartupAttempt(token, video) {
      if (token !== startupAttemptToken) return true;
      if (!state.video || state.video !== video) return true;
      return false;
    }

    function tryStartWhenTracksReady({ token, video, startupReason, triggerReason }) {
      if (shouldAbortStartupAttempt(token, video)) return false;

      const readiness = getTrackReadinessSnapshot(video);
      const ready = readiness.subtitleLikeTrackCount > 0;

      logContent?.("startup coordinator track readiness", {
        triggerReason,
        ready,
        ...readiness,
      });

      if (!ready) return false;

      cleanupStartupWatch();

      logTrackSnapshot(video, `ready:${triggerReason}`);

      startBilingual?.({
        reason: `startup_coordinator:${startupReason}:${triggerReason}`,
      });

      return true;
    }

    function watchTrackReadiness(video, startupReason) {
      cleanupStartupWatch();
      startupAttemptToken += 1;
      const token = startupAttemptToken;

      if (
        tryStartWhenTracksReady({
          token,
          video,
          startupReason,
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
          startupReason,
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
          startupReason,
          triggerReason: "poll",
        });
      }, 250);

      timeoutTimer = window.setTimeout(() => {
        logContent?.("startup coordinator track wait timeout", {
          ...getTrackReadinessSnapshot(video),
        });

        cleanupStartupWatch();
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

    function attachAndMaybeStart(video, reason = "unknown") {
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

      if (!canAutoStartFromSavedSettings()) return;

      watchTrackReadiness(video, reason);
    }

    function boot() {
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
    };
  }

  root.createPlaybackStartupCoordinator = createPlaybackStartupCoordinator;
})();
