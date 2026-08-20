// =============================================================
// Apple TV+ Bilingual Subtitles - sync-interval-orchestrator.js
// version: 1.2.1
// Issue #32 Round 12.1: hard-seek 後 secondary recovery 観測ログを補強
//
// Role（責務）
// - 定期 sync interval（periodic sync）から呼ばれる3つの処理を担当する
//   1) refreshPlaybackContext : video/dialog の再取得、content key 切替検知
//   2) detectLargeSeek        : 大きな seek の検出と、検出後の1回限りの
//                                initial cue recovery（large-seek断面）dispatch
//   3) runSecondaryRecoveryPass : secondary track の継続的な missing 監視、
//                                missCount / termination を含む periodic recovery
//
// hard-seek recovery（Round 12 追加分）との役割分担
// - detectLargeSeek 内の dispatch は「1回だけ」の即時描画ブリッジ
// - runSecondaryRecoveryEntry は secondary recovery の共通入口
//   （通常時は binding 再同期、hard seek 直後は direct sync まで含めて補強）
// - runSecondaryRecoveryPass は missCount / termination を持つ継続監視
// =============================================================

(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  window.ATVB.createSyncIntervalOrchestrator =
    function createSyncIntervalOrchestrator({
      state,
      controllers = {},
      services = {},
    }) {
      const { cueController } = controllers;

      const {
        logContent,
        getVideoAndDialog,
        getCurrentVideoSrcKey,
        syncHistoryContextWithPlayback,
        renderCurrentSnapshot,
        renderPanel,
        reloadSettingsAndReinitialize,
        clearPlaybackSessionUiState,
        debugPanelProbe,
        getTrackActiveCuesLength,
        getCurrentCueText,
        normalizeSubtitleText,
        getMergedSubtitleHealthSnapshot,
        syncSecondarySubtitleTrackBinding,
        syncSecondarySubtitleTrack,
        renderSecondarySubtitle,
        resolverDeps,
        panelUi,
        // Issue #32 Round 11: large-seek 直後の initial cue recovery entry
        initialCueRecovery,
        getRequestedSecondaryLang,
        createSubtitleHealthSnapshot,
      } = services;

      void state;
      void cueController;
      void logContent;
      void getVideoAndDialog;
      void getCurrentVideoSrcKey;
      void syncHistoryContextWithPlayback;
      void renderCurrentSnapshot;
      void renderPanel;
      void reloadSettingsAndReinitialize;
      void clearPlaybackSessionUiState;
      void debugPanelProbe;
      void getTrackActiveCuesLength;
      void getCurrentCueText;
      void normalizeSubtitleText;
      void getMergedSubtitleHealthSnapshot;
      void syncSecondarySubtitleTrackBinding;
      void syncSecondarySubtitleTrack;
      void renderSecondarySubtitle;
      void resolverDeps;
      void panelUi;
      void initialCueRecovery;
      void getRequestedSecondaryLang;
      void createSubtitleHealthSnapshot;

      const subtitleHealthSnapshot = createSubtitleHealthSnapshot
        ? createSubtitleHealthSnapshot({
            state,
            getTrackActiveCuesLength,
            getCurrentCueText,
            normalizeSubtitleText,
            getMergedSubtitleHealthSnapshot,
            buildResolverObservation,
          })
        : null;

      // ---------------------------------------------------------
      // refreshPlaybackContext
      // video/dialog を再取得し、currentSrc の変化や content key の切替を検知する。
      // video 自体が変わった場合は reloadSettingsAndReinitialize で再初期化する。
      // ---------------------------------------------------------
      function refreshPlaybackContext() {
        const found = getVideoAndDialog();
        const nextVideo = found?.video || state.video;
        const nextVideoSrcKey = getCurrentVideoSrcKey(nextVideo);
        const currentlyPlaybackReady = !!found?.video;
        const wasPlaybackReady =
          !!state.video && (state.video?.textTracks?.length ?? 0) > 0;

        if (wasPlaybackReady && !currentlyPlaybackReady) {
          clearPlaybackSessionUiState?.(
            "playback ended or playback surface disappeared",
          );
          return;
        }

        const hasCurrentSrcChanged =
          Boolean(nextVideoSrcKey) &&
          Boolean(state.lastVideoSrcKey) &&
          nextVideoSrcKey !== state.lastVideoSrcKey;

        logContent("sync interval playback context", {
          hasFoundVideo: Boolean(found?.video),
          hasStateVideo: Boolean(state.video),
          sameVideoObject: Boolean(found?.video && found.video === state.video),
          previousVideoSrcKey: state.lastVideoSrcKey || "",
          nextVideoSrcKey: nextVideoSrcKey || "",
          hasCurrentSrcChanged,
          currentTime: Number(nextVideo?.currentTime ?? 0),
          lastObservedVideoTime: Number(state.lastObservedVideoTime),
        });

        if (hasCurrentSrcChanged) {
          logContent("currentSrc changed", {
            previousVideoSrcKey: state.lastVideoSrcKey,
            nextVideoSrcKey,
          });
        }

        if (found && (found.video !== state.video || hasCurrentSrcChanged)) {
          const previousObservedVideoTime = Number(state.lastObservedVideoTime);
          const previousLastLargeSeekAt = Number(state.lastLargeSeekAt ?? 0);

          state.lastObservedVideoTime = null;
          state.lastLargeSeekAt = 0;

          logContent("large seek baseline reset on playback target change", {
            previousObservedVideoTime,
            previousLastLargeSeekAt,
            previousVideoSrcKey: state.lastVideoSrcKey || "",
            nextVideoSrcKey: nextVideoSrcKey || "",
            reason: hasCurrentSrcChanged
              ? "current_src_changed"
              : "video_object_changed",
          });

          state.video = found.video;
          state.dialogEl = found.dialog || state.dialogEl || null;
          state.lastVideoSrcKey = nextVideoSrcKey || "";
          reloadSettingsAndReinitialize?.({
            reason: hasCurrentSrcChanged
              ? "current_src_changed"
              : "video_object_changed",
            suppressSettingsReload: true,
          });
          return;
        }

        if (found?.dialog) {
          state.dialogEl = found.dialog;
        }
        if (nextVideo) {
          state.video = nextVideo;
          state.lastVideoSrcKey = nextVideoSrcKey || state.lastVideoSrcKey || "";
        }

        const switched = syncHistoryContextWithPlayback?.("interval_tick");
        if (switched) {
          renderCurrentSnapshot?.();
          renderPanel?.();
        }
      }

      // ---------------------------------------------------------
      // detectLargeSeek
      // 前回観測した currentTime との差分が閾値(3秒)を超えたら large seek とみなす。
      // 検出後は panel state を再適用し、
      // Round 11 で追加した initial cue recovery（large-seek 断面）を1回 dispatch する。
      // missCount/termination はここでは扱わない（それは runSecondaryRecoveryPass 側）。
      // ---------------------------------------------------------
      function detectLargeSeek() {
        const currentVideoTime = Number(state.video?.currentTime ?? 0);
        const previousObservedTime = Number(state.lastObservedVideoTime);
        const delta = Math.abs(currentVideoTime - previousObservedTime);
        const largeSeekDetected =
          Number.isFinite(previousObservedTime) &&
          Number.isFinite(currentVideoTime) &&
          delta > 3;

        logContent("large seek baseline", {
          previousObservedTime,
          currentVideoTime,
          delta,
          previousObservedTimeFinite: Number.isFinite(previousObservedTime),
          currentVideoTimeFinite: Number.isFinite(currentVideoTime),
          largeSeekDetected,
          lastLargeSeekAt: state.lastLargeSeekAt ?? 0,
        });

        state.lastObservedVideoTime = Number.isFinite(currentVideoTime)
          ? currentVideoTime
          : null;

        if (!largeSeekDetected) return;

        state.lastLargeSeekAt = Date.now();

        window.ATVB?.subtitleSyncControllerInstance?.notifyLargeSeek?.(
          state.lastLargeSeekAt,
        );
        logContent("large seek detected", {
          previousObservedTime,
          currentVideoTime,
          delta,
          lastLargeSeekAt: state.lastLargeSeekAt,
          requestedSecondaryLang: state.requestedSecondaryLang || "",
          activeSecondaryLanguage: state.secondaryTrack?.language || "",
          textTrackCount: state.video?.textTracks?.length ?? 0,
        });

        cueController?.resetSecondaryRecoveryLane?.("large-seek");

        panelUi?.applyPanelState?.("sync_interval_large_seek_resync");

        renderCurrentSnapshot?.();
        renderPanel?.();

        initialCueRecovery?.dispatch?.("large-seek", {
          video: state.video,
          requestedSecondaryLang: getRequestedSecondaryLang?.(),
          cueController,
        });
      }

      // ---------------------------------------------------------
      // getTrackCueMetrics
      // track から cue 本数 / active cue 本数 / 現在 cue text 長を取得する。
      // 既存 service を使って recovery 観測ログを共通化する。
      // ---------------------------------------------------------
      function getTrackCueMetrics(track) {
        const currentTime = Number(state.video?.currentTime ?? 0);
        const currentCueText = normalizeSubtitleText?.(
          getCurrentCueText?.(track, currentTime) || "",
        ) || "";

        return {
          cueCount: track?.cues?.length ?? 0,
          activeCues: getTrackActiveCuesLength?.(track) ?? 0,
          currentTextLength: currentCueText.length,
        };
      }

      // ---------------------------------------------------------
      // buildSecondarySyncLogPayload
      // secondary sync 関連ログの共通 payload を組み立てるヘルパー。
      // ---------------------------------------------------------
      function buildSecondarySyncLogPayload({
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueTextLength,
        primaryCueTextLength,
        currentPrimaryTextLength,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth = null,
        extra = {},
      }) {
        return {
          effectiveSecondaryLanguage,
          trackCount: state.video?.textTracks?.length ?? 0,
          primaryTrackFound: Boolean(state.primaryTrack),
          secondaryTrackFound: Boolean(state.secondaryTrack),
          secondaryTrackLanguage: state.secondaryTrack?.language || "",
          secondaryTrackMode: state.secondaryTrack?.mode || "",
          secondaryTrackCueCount: state.secondaryTrack?.cues?.length ?? 0,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueTextLength,
          primaryCueTextLength,
          currentPrimaryTextLength,
          hasFreshCurrentPrimary,
          mergedSequenceKind: mergedSubtitleHealth?.sequence?.kind || "",
          mergedSequenceOffsetMs:
            mergedSubtitleHealth?.sequence?.offsetMs ?? null,
          mergedDerivedMissingSecondary:
            mergedSubtitleHealth?.derived?.missingSecondary ?? false,
          mergedDerivedPrimaryStable:
            mergedSubtitleHealth?.derived?.primaryStable ?? false,
          ...extra,
        };
      }

      // ---------------------------------------------------------
      // buildResolverObservation
      // resolver / direct-bind 観測値を secondary recovery 判定用にまとめる。
      // ---------------------------------------------------------
      function buildResolverObservation(effectiveSecondaryLanguage) {
        const resolvedSecondaryTrack =
          resolverDeps?.resolveSecondarySubtitleTrack?.(
            state.video,
            effectiveSecondaryLanguage,
          ) || null;

        const resolvedMetrics = getTrackCueMetrics(resolvedSecondaryTrack);

        const sameTrackUnreadableNow = Boolean(
          resolvedSecondaryTrack &&
            state.secondaryTrack &&
            resolvedSecondaryTrack === state.secondaryTrack &&
            resolvedMetrics.activeCues === 0 &&
            resolvedMetrics.currentTextLength === 0,
        );

        return {
          resolvedSecondaryTrackFound: Boolean(resolvedSecondaryTrack),
          resolvedSecondaryTrackLanguage:
            resolvedSecondaryTrack?.language || "",
          resolvedSecondaryCueCount: resolvedMetrics.cueCount,
          resolvedSecondaryActiveCues: resolvedMetrics.activeCues,
          resolvedSecondaryCueTextLength: resolvedMetrics.currentTextLength,
          sameTrackUnreadableNow,
        };
      }

      // ---------------------------------------------------------
      // logSecondarySyncContextIfNeeded
      // 必要時だけ secondary sync 周辺の観測値をまとめて記録する。
      // ---------------------------------------------------------
      function logSecondarySyncContextIfNeeded({
        previousSecondaryTrack,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueTextLength,
        primaryCueTextLength,
        currentPrimaryTextLength,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
        resolverObservation,
      }) {
        const previousTrackLanguage = previousSecondaryTrack?.language || "";
        const nextTrackLanguage = state.secondaryTrack?.language || "";
        const secondaryTrackChanged =
          previousSecondaryTrack !== state.secondaryTrack;
        const sameTrackUnreadableNow =
          resolverObservation?.sameTrackUnreadableNow ?? false;

        if (
          !secondaryTrackChanged &&
          secondaryActiveCues > 0 &&
          secondaryCueTextLength > 0 &&
          !sameTrackUnreadableNow
        ) {
          return;
        }

        logContent?.(
          "secondary sync context",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueTextLength,
            primaryCueTextLength,
            currentPrimaryTextLength,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              previousTrackLanguage,
              nextTrackLanguage,
              secondaryTrackChanged,
              sameTrackUnreadableNow,
              resolvedSecondaryTrackLanguage:
                resolverObservation?.resolvedSecondaryTrackLanguage || "",
              resolvedSecondaryCueCount:
                resolverObservation?.resolvedSecondaryCueCount ?? 0,
              resolvedSecondaryActiveCues:
                resolverObservation?.resolvedSecondaryActiveCues ?? 0,
              resolvedSecondaryCueTextLength:
                resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
            },
          }),
        );
      }

      // ---------------------------------------------------------
      // logSecondaryRecoveryTermination
      // recovery が missCount 上限などで terminated になった場合にログを残す。
      // ---------------------------------------------------------
      function logSecondaryRecoveryTermination({
        recoveryDecision,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueTextLength,
        primaryCueTextLength,
        currentPrimaryTextLength,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
        resolverObservation,
        millisSinceLargeSeek,
      }) {
        if (recoveryDecision?.action !== "terminated") return;

        logContent?.(
          "secondary recovery terminated",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueTextLength,
            primaryCueTextLength,
            currentPrimaryTextLength,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              action: recoveryDecision.action,
              reason: recoveryDecision.reason,
              missCount: recoveryDecision.secondaryLane?.missCount ?? null,
              millisSinceLargeSeek,
              sameTrackUnreadableNow:
                resolverObservation?.sameTrackUnreadableNow ?? false,
              resolvedSecondaryTrackLanguage:
                resolverObservation?.resolvedSecondaryTrackLanguage || "",
              resolvedSecondaryCueCount:
                resolverObservation?.resolvedSecondaryCueCount ?? 0,
              resolvedSecondaryActiveCues:
                resolverObservation?.resolvedSecondaryActiveCues ?? 0,
              resolvedSecondaryCueTextLength:
                resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
            },
          }),
        );
      }

      // ---------------------------------------------------------
      // runSecondaryRecoveryEntry
      // secondary recovery の入口を共通化する。
      // 通常時は binding 再同期だけを行い、
      // hard seek 直後は direct sync まで含めて secondary を積極的に復旧する。
      // ---------------------------------------------------------
      async function runSecondaryRecoveryEntry(
        effectiveSecondaryLanguage,
        options = {},
      ) {
        const {
          forceTrackResync = false,
          reason = "periodic",
        } = options;

        const previousSecondaryTrack = state.secondaryTrack || null;
        const currentTime = Number(state.video?.currentTime ?? 0);

        const beforeMetrics = getTrackCueMetrics(previousSecondaryTrack);

        if (
          forceTrackResync &&
          state.video &&
          effectiveSecondaryLanguage &&
          typeof syncSecondarySubtitleTrack === "function"
        ) {
          await syncSecondarySubtitleTrack(
            state.video,
            effectiveSecondaryLanguage,
            {
              primaryLang: state.primaryTrack?.language || "",
              suppressRender: true,
              reason: `secondary-recovery-entry:${reason}`,
            },
          );
        }

        syncSecondarySubtitleTrackBinding?.(
          state.video,
          effectiveSecondaryLanguage,
          renderSecondarySubtitle,
          { suppressRender: true },
        );

        state.secondaryTrack = cueController?.getBoundSecondaryTrack?.() ?? null;

        const rebound = previousSecondaryTrack !== state.secondaryTrack;
        const afterMetrics = getTrackCueMetrics(state.secondaryTrack);
        const resolverObservation =
          buildResolverObservation(effectiveSecondaryLanguage);

        logContent?.("secondary recovery entry", {
          reason,
          forceTrackResync,
          effectiveSecondaryLanguage,
          currentTime,
          previousSecondaryTrackFound: Boolean(previousSecondaryTrack),
          previousSecondaryTrackLanguage: previousSecondaryTrack?.language || "",
          previousSecondaryTrackCueCount: beforeMetrics.cueCount,
          previousSecondaryActiveCues: beforeMetrics.activeCues,
          previousSecondaryTextLength: beforeMetrics.currentTextLength,
          secondaryTrackFoundAfter: Boolean(state.secondaryTrack),
          secondaryTrackLanguageAfter: state.secondaryTrack?.language || "",
          secondaryTrackCueCountAfter: afterMetrics.cueCount,
          secondaryActiveCuesAfter: afterMetrics.activeCues,
          currentSecondaryTextLengthAfter: afterMetrics.currentTextLength,
          rebound,
          sameTrackUnreadableNow:
            resolverObservation?.sameTrackUnreadableNow ?? false,
          resolvedSecondaryTrackLanguage:
            resolverObservation?.resolvedSecondaryTrackLanguage || "",
          resolvedSecondaryCueCount:
            resolverObservation?.resolvedSecondaryCueCount ?? 0,
          resolvedSecondaryActiveCues:
            resolverObservation?.resolvedSecondaryActiveCues ?? 0,
          resolvedSecondaryCueTextLength:
            resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
        });

        if (
          forceTrackResync &&
          state.secondaryTrack &&
          typeof renderSecondarySubtitle === "function"
        ) {
          renderSecondarySubtitle();
        }

        return {
          previousSecondaryTrack,
          rebound,
          resolverObservation,
        };
      }

      // ---------------------------------------------------------
      // triggerSecondaryRecovery
      // recoveryDecision に応じて実際の secondary recovery を発火する。
      // ---------------------------------------------------------
      async function triggerSecondaryRecovery({
        recoveryDecision,
        effectiveSecondaryLanguage,
        resolverObservation,
      }) {
        if (
          recoveryDecision?.action !== "recover" &&
          recoveryDecision?.action !== "force-rebind"
        ) {
          return;
        }

        const beforeMetrics = getTrackCueMetrics(state.secondaryTrack);

        logContent?.("secondary recovery trigger started", {
          effectiveSecondaryLanguage,
          action: recoveryDecision.action,
          reason: recoveryDecision.reason,
          secondaryTrackFoundBefore: Boolean(state.secondaryTrack),
          secondaryTrackLanguageBefore: state.secondaryTrack?.language || "",
          secondaryTrackCueCountBefore: beforeMetrics.cueCount,
          secondaryActiveCuesLengthBefore: beforeMetrics.activeCues,
          currentSecondaryTextLengthBefore: beforeMetrics.currentTextLength,
          sameTrackUnreadableNow:
            resolverObservation?.sameTrackUnreadableNow ?? false,
        });

        await syncSecondarySubtitleTrack?.(state.video, effectiveSecondaryLanguage, {
          primaryLang: state.primaryTrack?.language || "",
          suppressRender: true,
          reason: `secondary-recovery-trigger:${recoveryDecision.action}`,
          forceRebind: recoveryDecision.action === "force-rebind",
        });

        const afterMetrics = getTrackCueMetrics(state.secondaryTrack);
        const resolvedAfter = buildResolverObservation(effectiveSecondaryLanguage);

        logContent?.("secondary recovery trigger finished", {
          effectiveSecondaryLanguage,
          secondaryTrackFoundBefore: Boolean(state.secondaryTrack),
          secondaryTrackFoundAfter: Boolean(state.secondaryTrack),
          secondaryTrackLanguageAfter: state.secondaryTrack?.language || "",
          secondaryTrackCueCountAfter: afterMetrics.cueCount,
          secondaryActiveCuesLengthAfter: afterMetrics.activeCues,
          currentSecondaryTextLengthAfter: afterMetrics.currentTextLength,
          renderInvoked: true,
          sameTrackUnreadableNow:
            resolvedAfter?.sameTrackUnreadableNow ?? false,
          resolvedSecondaryTrackLanguage:
            resolvedAfter?.resolvedSecondaryTrackLanguage || "",
          resolvedSecondaryCueCount:
            resolvedAfter?.resolvedSecondaryCueCount ?? 0,
          resolvedSecondaryActiveCues:
            resolvedAfter?.resolvedSecondaryActiveCues ?? 0,
          resolvedSecondaryCueTextLength:
            resolvedAfter?.resolvedSecondaryCueTextLength ?? 0,
        });
      }

      // ---------------------------------------------------------
      // runSecondaryRecoveryPass
      // periodic sync の本体。先頭で secondary recovery entry を通し、
      // その後に現在の cue 健全性スナップショット取得、recoveryDecision の評価、
      // 必要なら triggerSecondaryRecovery を呼ぶ、までの一連の流れ。
      // missCount / termination の判定は cueController.evaluateSecondaryRecovery に委ねる。
      // ---------------------------------------------------------
      async function runSecondaryRecoveryPass(effectiveSecondaryLanguage) {
        const now = Date.now();
        const millisSinceLargeSeek =
          state.lastLargeSeekAt > 0 ? now - state.lastLargeSeekAt : null;
        const shouldForceTrackResync =
          Number.isFinite(millisSinceLargeSeek) && millisSinceLargeSeek <= 2500;

        const {
          previousSecondaryTrack,
          resolverObservation: entryResolverObservation,
        } = await runSecondaryRecoveryEntry(effectiveSecondaryLanguage, {
          forceTrackResync: shouldForceTrackResync,
          reason: shouldForceTrackResync
            ? "hard-seek-secondary-recovery"
            : "periodic-secondary-recovery",
        });

        logContent?.("secondary recovery pass started", {
          effectiveSecondaryLanguage,
          currentTime: Number(state.video?.currentTime ?? 0),
          lastLargeSeekAt: state.lastLargeSeekAt ?? null,
          millisSinceLargeSeek,
          shouldForceTrackResync,
          hasVideo: Boolean(state.video),
          textTrackCount: state.video?.textTracks?.length ?? 0,
          hasPrimaryTrackObject: Boolean(state.primaryTrack),
          hasSecondaryTrackObject: Boolean(state.secondaryTrack),
          secondaryTrackLanguage: state.secondaryTrack?.language || "",
          secondaryTrackCueCount: state.secondaryTrack?.cues?.length ?? 0,
          secondaryActiveCues:
            getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0,
          currentSecondaryTextLength:
            getTrackCueMetrics(state.secondaryTrack).currentTextLength,
          entrySameTrackUnreadableNow:
            entryResolverObservation?.sameTrackUnreadableNow ?? false,
        });

        const {
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueTextLength,
          primaryCueTextLength,
          currentPrimaryTextLength,
          hasFreshCurrentPrimary,
          hasSecondarySignal,
          hasPrimarySignal,
          mergedSubtitleHealth,
          resolverObservation,
        } = subtitleHealthSnapshot?.readSyncIntervalSnapshot(
          now,
          effectiveSecondaryLanguage,
        ) ?? {
          secondaryActiveCues: 0,
          primaryActiveCues: 0,
          secondaryCueTextLength: 0,
          primaryCueTextLength: 0,
          currentPrimaryTextLength: 0,
          hasPrimaryLiveSignal: false,
          hasFreshCurrentPrimary: false,
          hasSecondarySignal: false,
          hasPrimarySignal: false,
          mergedSubtitleHealth: null,
          resolverObservation: null,
        };

        logSecondarySyncContextIfNeeded({
          previousSecondaryTrack,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueTextLength,
          primaryCueTextLength,
          currentPrimaryTextLength,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
          resolverObservation,
        });

        const recoveryDecision =
          cueController?.evaluateSecondaryRecovery?.({
            now,
            runtime: {
              primaryTrackFound: Boolean(state.primaryTrack),
              secondaryTrackFound: Boolean(state.secondaryTrack),
              primaryActiveCues,
              secondaryActiveCues,
            },
            currentCue: {
              primaryTextLength: primaryCueTextLength,
              secondaryTextLength: secondaryCueTextLength,
              currentPrimaryTextLength: currentPrimaryTextLength,
              hasFreshCurrentPrimary,
            },
            sequence: mergedSubtitleHealth?.sequence || null,
            derived: mergedSubtitleHealth?.derived || null,
          }) ?? {
            action: "idle",
            reason: "orchestrator_unavailable",
            secondaryLane: null,
          };

        if (recoveryDecision.action !== "idle") {
          const millisSinceLastRecovery =
            recoveryDecision.secondaryLane?.lastRecoveredAt > 0
              ? now - recoveryDecision.secondaryLane.lastRecoveredAt
              : null;

          logContent?.("secondary recovery action evaluated", {
            hasPrimarySignal,
            hasSecondarySignal,
            shouldRecover:
              recoveryDecision.action === "recover" ||
              recoveryDecision.action === "force-rebind",
            reason: recoveryDecision.reason,
            cooldownActive:
              recoveryDecision.reason === "secondary_cooldown_active",
            millisSinceLastRecovery,
            millisSinceLargeSeek,
            action: recoveryDecision.action,
            missCount: recoveryDecision.secondaryLane?.missCount ?? null,
            sameTrackUnreadableNow:
              resolverObservation?.sameTrackUnreadableNow ?? false,
            resolvedSecondaryTrackLanguage:
              resolverObservation?.resolvedSecondaryTrackLanguage || "",
            resolvedSecondaryCueCount:
              resolverObservation?.resolvedSecondaryCueCount ?? 0,
            resolvedSecondaryActiveCues:
              resolverObservation?.resolvedSecondaryActiveCues ?? 0,
            resolvedSecondaryCueTextLength:
              resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
          });
        }

        logSecondaryRecoveryTermination({
          recoveryDecision,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueTextLength,
          primaryCueTextLength,
          currentPrimaryTextLength,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
          resolverObservation,
          millisSinceLargeSeek,
        });

        await triggerSecondaryRecovery({
          recoveryDecision,
          effectiveSecondaryLanguage,
          resolverObservation,
        });
      }

      return {
        refreshPlaybackContext,
        detectLargeSeek,
        runSecondaryRecoveryPass,
      };
    };
})();
