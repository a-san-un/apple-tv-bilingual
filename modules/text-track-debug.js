// =============================================================
// Apple TV+ Bilingual Subtitles - modules/text-track-debug.js
// 役割: textTrack のデバッグスナップショット生成を担当する。
//       cue-controller.js から debug 系を切り出した facade 向けモジュール。
// =============================================================

(() => {
  const root = (window.ATVB = window.ATVB || {});

  /**
   * createTextTrackDebug
   * @param {object} deps
   * @param {Function} deps.logContent
   * @param {Function} deps.getTrackCuesLength
   * @param {Function} deps.getTrackActiveCuesLength
   * @param {Function} deps.getVideoElement
   * @returns {{ getUsableTrackDebugPayload, dumpTextTrackSnapshot }}
   */
  function createTextTrackDebug({
    logContent,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    getVideoElement,
  }) {
    function getUsableTrackDebugPayload(track) {
      return {
        language: track?.language || "",
        label: track?.label || "",
        kind: track?.kind || "",
        mode: track?.mode || "",
        cuesLength: getTrackCuesLength(track),
        activeCuesLength: getTrackActiveCuesLength(track),
      };
    }

    function dumpTextTrackSnapshot(
      reason = "unknown",
      extra = {},
      { primaryTrackBound = null, secondaryTrackBound = null } = {},
    ) {
      const video = getVideoElement?.();
      const tracks = Array.from(video?.textTracks || []);

      const payload = {
        reason,
        currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : null,
        paused: Boolean(video?.paused),
        readyState: Number.isFinite(video?.readyState) ? video.readyState : null,
        textTrackCount: tracks.length,
        primaryBoundTrack: getUsableTrackDebugPayload(primaryTrackBound),
        secondaryBoundTrack: getUsableTrackDebugPayload(secondaryTrackBound),
        tracks: tracks.map((track, index) => ({
          index,
          language: track?.language || "",
          label: track?.label || "",
          kind: track?.kind || "",
          mode: track?.mode || "",
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
          isPrimaryBound: track === primaryTrackBound,
          isSecondaryBound: track === secondaryTrackBound,
        })),
        ...extra,
      };

      logContent("text track snapshot", payload);
      return payload;
    }

    return { getUsableTrackDebugPayload, dumpTextTrackSnapshot };
  }

  root.createTextTrackDebug = createTextTrackDebug;
})();
