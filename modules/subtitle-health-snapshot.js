// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-health-snapshot.js
// 役割:
// - 現在の primary / secondary track の cue 状態をまとめて読む。
// - recovery 判定に必要な subtitle health snapshot を 1 箇所で生成する。
// - DOM / TextTrack を内部保持せず、都度プレーンな snapshot を返す。
// =============================================================

(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  /**
   * @param {{
   *   state: object,
   *   getTrackActiveCuesLength?: Function,
   *   getCurrentCueText?: Function,
   *   normalizeSubtitleText?: Function,
   *   getMergedSubtitleHealthSnapshot?: Function,
   *   buildResolverObservation?: Function,
   * }} deps
   */
  function createSubtitleHealthSnapshot(deps = {}) {
    const {
      state,
      getTrackActiveCuesLength,
      getCurrentCueText,
      normalizeSubtitleText,
      getMergedSubtitleHealthSnapshot,
      buildResolverObservation,
    } = deps;

    function normalizeText(value) {
      return normalizeSubtitleText?.(value) ?? "";
    }

    function readSyncIntervalSnapshot(now, effectiveSecondaryLanguage) {
      const secondaryActiveCues =
        getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;
      const primaryActiveCues =
        getTrackActiveCuesLength?.(state.primaryTrack) ?? 0;

      const secondaryCueText = normalizeText(
        getCurrentCueText?.(state.secondaryTrack),
      );
      const primaryCueText = normalizeText(
        getCurrentCueText?.(state.primaryTrack),
      );
      const currentPrimaryText = normalizeText(
        state.currentSubtitleBlock?.primaryText || state.lastPrimaryText || "",
      );

      const hasPrimaryLiveSignal =
        primaryActiveCues > 0 || Boolean(primaryCueText);
      const hasFreshCurrentPrimary =
        Boolean(currentPrimaryText) &&
        state.lastCurrentSubtitleBlockAt > 0 &&
        now - state.lastCurrentSubtitleBlockAt <= 3000;
      const hasSecondarySignal =
        secondaryActiveCues > 0 || Boolean(secondaryCueText);
      const hasPrimarySignal = hasPrimaryLiveSignal || hasFreshCurrentPrimary;

      const resolverObservation =
        buildResolverObservation?.(effectiveSecondaryLanguage) ?? null;
      const mergedSubtitleHealth =
        getMergedSubtitleHealthSnapshot?.() ?? null;

      return {
        now,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueTextLength: secondaryCueText.length,
        primaryCueTextLength: primaryCueText.length,
        currentPrimaryTextLength: currentPrimaryText.length,
        hasPrimaryLiveSignal,
        hasFreshCurrentPrimary,
        hasSecondarySignal,
        hasPrimarySignal,
        mergedSubtitleHealth,
        resolverObservation,
      };
    }

    function buildSyncContextSummary(snapshot) {
      return JSON.stringify({
        trackCount: state.video?.textTracks?.length ?? 0,
        primaryTrackFound: Boolean(state.primaryTrack),
        secondaryTrackFound: Boolean(state.secondaryTrack),
        secondaryTrackLanguage: state.secondaryTrack?.language || "",
        secondaryActiveCues: snapshot?.secondaryActiveCues ?? 0,
        primaryActiveCues: snapshot?.primaryActiveCues ?? 0,
        primaryCueTextLength: snapshot?.primaryCueTextLength ?? 0,
        currentPrimaryTextLength: snapshot?.currentPrimaryTextLength ?? 0,
        hasFreshCurrentPrimary: snapshot?.hasFreshCurrentPrimary ?? false,
        sameTrackUnreadableNow:
          snapshot?.resolverObservation?.sameTrackUnreadableNow ?? false,
        resolvedSecondaryTrackLanguage:
          snapshot?.resolverObservation?.resolvedSecondaryTrackLanguage || "",
        resolvedSecondaryCueTextLength:
          snapshot?.resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
      });
    }

    return {
      readSyncIntervalSnapshot,
      buildSyncContextSummary,
    };
  }

  root.createSubtitleHealthSnapshot = createSubtitleHealthSnapshot;
})();
