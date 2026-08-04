// =============================================================
// Apple TV+ Bilingual Subtitles - modules/playback-startup-coordinator.js
//
// 役割:
// - video 検出後の attachTracks 呼び出しだけをまとめる。
// - startBilingual の自動実行は loadSettingsFromSync 側の責務のままにする
//   （settings 読込前に auto-start 判定してしまう事故を防ぐため）。
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
      getVideoAndDialog,
      waitForVideo,
      attachTracks,
    } = services;

    // video / dialog を state に反映し、track attach だけを行う。
    // attachTracks 内で loadSettingsFromSync が呼ばれ、
    // settings 読込完了後の startBilingual 判断はそちら側に委ねる。
    function attachAndBoot(video, reason = "unknown") {
      if (!video) return;

      const current = getVideoAndDialog?.();
      state.video = video;
      state.dialogEl = current?.dialog || state.dialogEl || null;

      attachTracks?.(video);

      logContent?.("startup coordinator attach", {
        reason,
        hasVideo: Boolean(video),
        trackCount: video?.textTracks?.length ?? 0,
      });
    }

    // playback ready な video が既にあれば即 attach、なければ waitForVideo で待つ。
    // 自動起動の判定は行わず、attach の入口だけを一元化する。
    function boot() {
      const found = getVideoAndDialog?.();
      if (found?.video) {
        attachAndBoot(found.video, "boot_found_video");
        return;
      }

      waitForVideo?.((video) => {
        attachAndBoot(video, "boot_waitForVideo");
      });
    }

    return {
      attachAndBoot,
      boot,
    };
  }

  root.createPlaybackStartupCoordinator = createPlaybackStartupCoordinator;
})();
