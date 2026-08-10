// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-sync-controller.js
//
// 役割:
// - secondary 字幕の同期処理をまとめる。
// - resolver が選んだ secondary track を direct bind する。
// - direct bind で成立しない作品だけ native menu sync へフォールバックする。
//
// 設計方針:
// - state への直接書き込みは行わない。
//   呼び出し側（content.js）が戻り値の track を見て state を更新する。
// - bindSecondaryTrack には cueController が期待する modeDecision 形式で渡す。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  function createSubtitleSyncController({ services = {} }) {
    const {
      logContent,
      resolver,
      syncNativeSubtitleSelection,
      bindSecondaryTrack,
    } = services;

    function getTrackReadability(track, currentTime = NaN) {
      if (!track) {
        return {
          cuesLength: 0,
          activeCuesLength: 0,
          currentCueTextLength: 0,
          hasCueOverlapAtCurrentTime: false,
          readable: false,
        };
      }

      const cuesLength = resolver?.getTrackCuesLength?.(track) ?? 0;
      const activeCuesLength = resolver?.getTrackActiveCuesLength?.(track) ?? 0;
      const currentCueTextLength = Number.isFinite(currentTime)
        ? resolver?.getCurrentCueTextLength?.(track, currentTime) ?? 0
        : 0;
      const hasCueOverlapAtCurrentTime = Number.isFinite(currentTime)
        ? Boolean(resolver?.hasCueOverlapAtTime?.(track, currentTime))
        : false;

      return {
        cuesLength,
        activeCuesLength,
        currentCueTextLength,
        hasCueOverlapAtCurrentTime,
        readable: Boolean(
          cuesLength > 0 ||
            activeCuesLength > 0 ||
            currentCueTextLength > 0 ||
            hasCueOverlapAtCurrentTime,
        ),
      };
    }

    // bindSecondaryTrack に渡す modeDecision を組み立てる。
    // cueController.bindSecondarySubtitleTrack が期待する形式に統一する。
    function _buildModeDecision(reason, options = {}) {
      return {
        requestedMode: options.requestedMode ?? "hidden",
        policy: options.policy ?? "subtitle-sync-controller",
        rationale: options.rationale ?? reason,
        reason,
        unreadableSnapshot: options.unreadableSnapshot ?? null,
      };
    }

    // secondary track を解決して bind する。
    // state への書き込みは行わず、bind した track（または null）を返す。
    // 呼び出し側が戻り値を受け取って state.secondaryTrack を更新すること。
    async function syncSecondarySubtitleTrack(
      video,
      requestedLang,
      options = {},
    ) {
      if (!video || !requestedLang) return null;

      const currentTime = Number(video.currentTime ?? NaN);
      const selectedTrack =
        resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) || null;

      if (selectedTrack) {
        const readability = getTrackReadability(selectedTrack, currentTime);

        bindSecondaryTrack?.(
          selectedTrack,
          _buildModeDecision("secondary-sync-direct-bind", options),
        );

        logContent?.("subtitle sync direct selected track", {
          requestedLang,
          currentTime,
          selectedLanguage: selectedTrack?.language ?? "",
          selectedLabel: selectedTrack?.label ?? "",
          selectedMode: selectedTrack?.mode ?? "",
          readability,
        });

        return selectedTrack;
      }

      logContent?.("subtitle sync direct fallback to native", {
        requestedLang,
        currentTime,
      });

      await syncNativeSubtitleSelection?.({
        primaryLang: options?.primaryLang ?? "",
        secondaryLang: requestedLang,
        preferredSource: requestedLang,
      });

      const fallbackTrack =
        resolver?.resolveSecondarySubtitleTrack?.(video, requestedLang) || null;

      if (fallbackTrack) {
        bindSecondaryTrack?.(
          fallbackTrack,
          _buildModeDecision("secondary-sync-native-fallback", options),
        );
      }

      logContent?.("subtitle sync native fallback result", {
        requestedLang,
        fallbackFound: Boolean(fallbackTrack),
        fallbackLanguage: fallbackTrack?.language ?? "",
      });

      return fallbackTrack;
    }

    return {
      getTrackReadability,
      syncSecondarySubtitleTrack,
    };
  }

  root.subtitleSyncController = root.subtitleSyncController || {};
  root.subtitleSyncController.createSubtitleSyncController =
    createSubtitleSyncController;
})();
