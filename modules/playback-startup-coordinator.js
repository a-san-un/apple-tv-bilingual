// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-startup-coordinator.js
//
// 役割:
// - video 検出後の attachTracks と自動 startBilingual をまとめる。
// - 保存済み settings が有効なら、動画再生開始時に Apply なしで自動起動させる。
// - ただし startBilingual は textTracks が実際に揃ってから呼ぶ。
//   （metadata/id3 しか無い早すぎる時点で起動して空振りしないため）
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

    function hasUsableSubtitleTracks(video) {
      return getSubtitleLikeTracks(video).length > 0;
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
        totalTrackCount: video?.textTracks?.length ?? 0,
        subtitleLikeTrackCount: getSubtitleLikeTracks(video).length,
        tracks,
      });
    }

    function attachAndMaybeStart(video, reason = "unknown") {
      if (!video) return;

      // 既に video が設定済み（= 切り替え）のときだけクリア
      if (state.video && state.video !== video) {
        clearSubtitles?.({ reason: `startup_coordinator:video_change:${reason}` });
      }

      const current = getVideoAndDialog?.();
      state.video = video;
      state.dialogEl = current?.dialog || state.dialogEl || null;

      attachTracks?.(video);

      logContent?.("startup coordinator attach", {
        reason,
        hasVideo: Boolean(video),
        trackCount: video?.textTracks?.length ?? 0,
        canAutoStart: canAutoStartFromSavedSettings(),
        requestedContentSettings: {
          primaryLang: state.requestedContentSettings?.primaryLang || "",
          secondaryLang: state.requestedContentSettings?.secondaryLang || "",
          showSidebar: state.requestedContentSettings?.showSidebar ?? null,
        },
      });

      if (!canAutoStartFromSavedSettings()) return;

      cleanupStartupWatch();
      startupAttemptToken += 1;
      const token = startupAttemptToken;

      const maybeStart = (triggerReason) => {
        if (token !== startupAttemptToken) return false;
        if (!state.video || state.video !== video) return false;

        const ready = hasUsableSubtitleTracks(video);

        logContent?.("startup coordinator track readiness", {
          triggerReason,
          ready,
          totalTrackCount: video?.textTracks?.length ?? 0,
          subtitleLikeTrackCount: getSubtitleLikeTracks(video).length,
        });

        if (!ready) return false;

        cleanupStartupWatch();

        logTrackSnapshot(video, `ready:${triggerReason}`);

        startBilingual?.({
          reason: `startup_coordinator:${reason}:${triggerReason}`,
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
        logContent?.("startup coordinator track wait timeout", {
          totalTrackCount: video?.textTracks?.length ?? 0,
          subtitleLikeTrackCount: getSubtitleLikeTracks(video).length,
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
