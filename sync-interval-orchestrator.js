// =============================================================
// Apple TV+ Bilingual Subtitles - sync-interval-orchestrator.js
// version: 1.1.0
// Issue #32 Round 11: large-seek 直後の initial cue recovery entry を接続
//
// Role（責務）
// - 定期 sync interval（periodic sync）から呼ばれる3つの処理を担当する
//   1) refreshPlaybackContext : video/dialog の再取得、content key 切替検知
//   2) detectLargeSeek        : 大きな seek の検出と、検出後の1回限りの
//                                initial cue recovery（large-seek断面）dispatch
//   3) runSecondaryRecoveryPass : secondary track の継続的な missing 監視、
//                                missCount / termination を含む periodic recovery
//
// initial cue recovery（Round 11 追加分）との役割分担
// - detectLargeSeek 内の dispatch は「1回だけ」の即時描画ブリッジ
// - runSecondaryRecoveryPass は missCount / termination を持つ継続監視
//   （この2つの責務は混ぜない）
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

      const SAME_TRACK_UNREADABLE_RECOVERY_MISS_COUNT = 3;
      const SAME_TRACK_UNREADABLE_SEEK_WINDOW_MS = 30000;

      // ---------------------------------------------------------
      // refreshPlaybackContext
      // video/dialog を再取得し、currentSrc の変化や content key の切替を検知する。
      // video 自体が変わった場合は reloadSettingsAndReinitialize で再初期化する。
      // ---------------------------------------------------------
      function refreshPlaybackContext() {
        const found = getVideoAndDialog();
        const nextVideo = found?.video || state.video;
        const nextVideoSrcKey = getCurrentVideoSrcKey(nextVideo);
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

        // video オブジェクト自体が変わった、または currentSrc が変わった場合は
        // 再生コンテキストを丸ごと再初期化する（トラック再解決を含む）。
        if (found && (found.video !== state.video || hasCurrentSrcChanged)) {
          state.video = found.video;
          state.dialogEl = found.dialog;
          state.lastVideoSrcKey = nextVideoSrcKey;
          state.lastObservedVideoTime = null;
          reloadSettingsAndReinitialize?.("video_changed");
          return;
        }

        // video は同じだが content key（タイトル等）が切り替わった場合は
        // history context だけ切り替えて再描画する。
        if (found && state.video) {
          const switched =
            syncHistoryContextWithPlayback("content_key_changed");
          if (switched) {
            renderCurrentSnapshot();
            renderPanel();
          }
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

        panelUi.applyPanelState("sync_interval_large_seek_resync");

        initialCueRecovery?.dispatch("large-seek", {
          video: state.video,
          requestedSecondaryLang: getRequestedSecondaryLang?.(),
          cueController,
        });
      }

      // ---------------------------------------------------------
      // buildSecondarySyncLogPayload
      // secondary sync 関連ログの共通 payload を組み立てるヘルパー。
      // ---------------------------------------------------------
      function buildSecondarySyncLogPayload({
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
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
          secondaryActiveCues,
          primaryActiveCues,
          currentSecondaryTextLength: secondaryCueText.length,
          primaryCueTextLength: primaryCueText.length,
          currentPrimaryTextLength: currentPrimaryText.length,
          hasFreshCurrentPrimary,
          mergedPrimaryHealthy:
            mergedSubtitleHealth?.derived?.primaryHealthy ?? null,
          mergedSecondaryHealthy:
            mergedSubtitleHealth?.derived?.secondaryHealthy ?? null,
          mergedShouldRecoverSecondary:
            mergedSubtitleHealth?.derived?.shouldRecoverSecondary ?? null,
          mergedShouldForceSecondaryRebind:
            mergedSubtitleHealth?.derived?.shouldForceSecondaryRebind ?? null,
          secondaryRecoveryMissCount:
            cueController?.getLaneStates?.()?.secondary?.missCount ?? null,
          ...extra,
        };
      }

      function buildResolverObservation(effectiveSecondaryLanguage) {
        const resolvedSecondaryTrack =
          resolverDeps?.resolveSecondarySubtitleTrack?.(
            state.video,
            effectiveSecondaryLanguage,
          ) ?? null;
        const currentTime = Number(state.video?.currentTime ?? NaN);
        const resolvedSecondaryCuesLength =
          resolverDeps?.getTrackCuesLength?.(resolvedSecondaryTrack) ?? 0;
        const resolvedSecondaryActiveCuesLength =
          getTrackActiveCuesLength?.(resolvedSecondaryTrack) ?? 0;
        const resolvedSecondaryCueTextLength =
          resolverDeps?.getCurrentCueTextLength?.(
            resolvedSecondaryTrack,
            currentTime,
          ) ?? 0;
        const resolvedSecondaryHasCueOverlapAtCurrentTime =
          resolverDeps?.hasCueOverlapAtTime?.(
            resolvedSecondaryTrack,
            currentTime,
          ) ?? false;
        const sameTrackUnreadableNow =
          Boolean(resolvedSecondaryTrack) &&
          resolvedSecondaryCuesLength > 0 &&
          resolvedSecondaryActiveCuesLength === 0 &&
          !resolvedSecondaryHasCueOverlapAtCurrentTime &&
          resolvedSecondaryCueTextLength === 0;

        return {
          resolvedSecondaryTrack,
          currentTime,
          resolvedSecondaryTrackLanguage:
            resolvedSecondaryTrack?.language || "",
          resolvedSecondaryTrackKind: resolvedSecondaryTrack?.kind || "",
          resolvedSecondaryTrackMode: resolvedSecondaryTrack?.mode || "",
          resolvedSecondaryCuesLength,
          resolvedSecondaryActiveCuesLength,
          resolvedSecondaryCueTextLength,
          resolvedSecondaryHasCueOverlapAtCurrentTime,
          sameTrackUnreadableNow,
        };
      }

      // ---------------------------------------------------------
      // buildSyncIntervalSubtitleSnapshot
      // 現在の primary/secondary track の cue 状態をまとめて取得するスナップショット。
      // periodic recovery の判定材料として使う。
      // ---------------------------------------------------------
      function buildSyncIntervalSubtitleSnapshot(now, effectiveSecondaryLanguage) {
        const secondaryActiveCues =
          getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;
        const primaryActiveCues =
          getTrackActiveCuesLength?.(state.primaryTrack) ?? 0;
        const secondaryCueText =
          normalizeSubtitleText?.(
            getCurrentCueText?.(state.secondaryTrack),
          ) ?? "";
        const primaryCueText =
          normalizeSubtitleText?.(
            getCurrentCueText?.(state.primaryTrack),
          ) ?? "";
        const currentPrimaryText =
          normalizeSubtitleText?.(
            state.currentSubtitleBlock?.primaryText || state.lastPrimaryText || "",
          ) ?? "";
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
          buildResolverObservation(effectiveSecondaryLanguage);

        return {
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasPrimaryLiveSignal,
          hasFreshCurrentPrimary,
          hasSecondarySignal,
          hasPrimarySignal,
          mergedSubtitleHealth: getMergedSubtitleHealthSnapshot?.() ?? null,
          resolverObservation,
        };
      }


      // ---------------------------------------------------------
      // logSecondarySyncContextIfNeeded
      // 前回ログした状態と変化がある場合のみ sync context ログを出す（ログ肥大化防止）。
      // ---------------------------------------------------------
      function logSecondarySyncContextIfNeeded({
        previousSecondaryTrack,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
        resolverObservation,
      }) {
        const syncContextSummary = JSON.stringify({
          trackCount: state.video?.textTracks?.length ?? 0,
          primaryTrackFound: Boolean(state.primaryTrack),
          secondaryTrackFound: Boolean(state.secondaryTrack),
          secondaryTrackLanguage: state.secondaryTrack?.language || "",
          secondaryActiveCues,
          primaryActiveCues,
          primaryCueTextLength: primaryCueText.length,
          currentPrimaryTextLength: currentPrimaryText.length,
          hasFreshCurrentPrimary,
          sameTrackUnreadableNow:
            resolverObservation?.sameTrackUnreadableNow ?? false,
          resolvedSecondaryTrackLanguage:
            resolverObservation?.resolvedSecondaryTrackLanguage || "",
          resolvedSecondaryCueTextLength:
            resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
        });

        const shouldLogSyncContext =
          previousSecondaryTrack !== state.secondaryTrack ||
          syncContextSummary !== state.lastSecondarySyncContext;

        if (!shouldLogSyncContext) return;

        state.lastSecondarySyncContext = syncContextSummary;
        logContent?.(
          "secondary track sync context",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueText,
            primaryCueText,
            currentPrimaryText,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              reason: "sync_interval",
              sameTrackUnreadableNow:
                resolverObservation?.sameTrackUnreadableNow ?? false,
              resolvedSecondaryTrackLanguage:
                resolverObservation?.resolvedSecondaryTrackLanguage || "",
              resolvedSecondaryTrackKind:
                resolverObservation?.resolvedSecondaryTrackKind || "",
              resolvedSecondaryTrackMode:
                resolverObservation?.resolvedSecondaryTrackMode || "",
              resolvedSecondaryCuesLength:
                resolverObservation?.resolvedSecondaryCuesLength ?? 0,
              resolvedSecondaryActiveCuesLength:
                resolverObservation?.resolvedSecondaryActiveCuesLength ?? 0,
              resolvedSecondaryCueTextLength:
                resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
              resolvedSecondaryHasCueOverlapAtCurrentTime:
                resolverObservation?.resolvedSecondaryHasCueOverlapAtCurrentTime ??
                false,
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
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
        resolverObservation,
        millisSinceLargeSeek,
      }) {
        if (recoveryDecision.action !== "terminated") return;

        logContent?.(
          "secondary recovery terminated",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueText,
            primaryCueText,
            currentPrimaryText,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              reason: "sync_interval",
              missCount: recoveryDecision.secondaryLane.missCount,
              millisSinceLargeSeek,
              sameTrackUnreadableNow:
                resolverObservation?.sameTrackUnreadableNow ?? false,
              primaryHealthy:
                mergedSubtitleHealth?.derived?.primaryHealthy ?? null,
              secondaryHealthy:
                mergedSubtitleHealth?.derived?.secondaryHealthy ?? null,
              resolvedSecondaryTrackLanguage:
                resolverObservation?.resolvedSecondaryTrackLanguage || "",
              resolvedSecondaryTrackKind:
                resolverObservation?.resolvedSecondaryTrackKind || "",
              resolvedSecondaryTrackMode:
                resolverObservation?.resolvedSecondaryTrackMode || "",
              resolvedSecondaryCuesLength:
                resolverObservation?.resolvedSecondaryCuesLength ?? 0,
              resolvedSecondaryActiveCuesLength:
                resolverObservation?.resolvedSecondaryActiveCuesLength ?? 0,
              resolvedSecondaryCueTextLength:
                resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
              resolvedSecondaryHasCueOverlapAtCurrentTime:
                resolverObservation?.resolvedSecondaryHasCueOverlapAtCurrentTime ??
                false,
            },
          }),
        );
      }

      // ---------------------------------------------------------
      // runSecondaryResolverProbeIfNeeded
      // デバッグ用: 現在の secondary track と resolver が選び直す track を比較するプローブ。
      // debugPanelProbe が false の場合は何もしない。
      // ---------------------------------------------------------
      function runSecondaryResolverProbeIfNeeded({
        effectiveSecondaryLanguage,
        secondaryCueText,
        resolverObservation,
      }) {
        if (!debugPanelProbe) return;

        const secondaryCandidates =
          resolverDeps?.getSecondarySubtitleTrackCandidates?.(
            state.video,
            effectiveSecondaryLanguage,
          ) ?? [];
        const resolvedSecondaryTrack =
          resolverObservation?.resolvedSecondaryTrack ?? null;

        logContent?.("secondary resolver probe", {
          reason: "sync_interval",
          effectiveSecondaryLanguage,
          currentSecondaryTrackLanguage: state.secondaryTrack?.language || "",
          currentSecondaryTrackKind: state.secondaryTrack?.kind || "",
          currentSecondaryTrackMode: state.secondaryTrack?.mode || "",
          currentSecondaryCuesLength:
            resolverDeps?.getTrackCuesLength?.(state.secondaryTrack) ?? 0,
          currentSecondaryActiveCuesLength:
            getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0,
          currentSecondaryCueTextLength: secondaryCueText.length,
          resolvedSecondaryTrackLanguage:
            resolverObservation?.resolvedSecondaryTrackLanguage || "",
          resolvedSecondaryTrackKind:
            resolverObservation?.resolvedSecondaryTrackKind || "",
          resolvedSecondaryTrackMode:
            resolverObservation?.resolvedSecondaryTrackMode || "",
          resolvedSecondaryCuesLength:
            resolverObservation?.resolvedSecondaryCuesLength ?? 0,
          resolvedSecondaryActiveCuesLength:
            resolverObservation?.resolvedSecondaryActiveCuesLength ?? 0,
          resolvedSecondaryCueTextLength:
            resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
          resolvedSecondaryHasCueOverlapAtCurrentTime:
            resolverObservation?.resolvedSecondaryHasCueOverlapAtCurrentTime ??
            false,
          sameTrackUnreadableNow:
            resolverObservation?.sameTrackUnreadableNow ?? false,
          resolvedSecondaryTrackExists: Boolean(resolvedSecondaryTrack),
          secondaryCandidates,
        });
      }

      // ---------------------------------------------------------
      // triggerSecondaryRecovery
      // recoveryDecision が recover / force-rebind のときだけ実際に
      // syncSecondarySubtitleTrack を呼び、前後の状態をログに残す。
      // これは periodic sync の一部であり、missCount を持つ継続監視の実行部分。
      // ---------------------------------------------------------
      function triggerSecondaryRecovery({
        recoveryDecision,
        effectiveSecondaryLanguage,
        secondaryActiveCues,
        primaryActiveCues,
        secondaryCueText,
        primaryCueText,
        currentPrimaryText,
        hasFreshCurrentPrimary,
        mergedSubtitleHealth,
        resolverObservation,
      }) {
        if (
          recoveryDecision.action !== "recover" &&
          recoveryDecision.action !== "force-rebind"
        ) {
          return;
        }

        const secondaryTrackFoundBefore = Boolean(state.secondaryTrack);
        const secondaryActiveCuesLengthBefore =
          getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;

        runSecondaryResolverProbeIfNeeded({
          effectiveSecondaryLanguage,
          secondaryCueText,
          resolverObservation,
        });

        logContent?.("secondary recovery trigger started", {
          effectiveSecondaryLanguage,
          secondaryTrackFoundBefore,
          secondaryActiveCuesLengthBefore,
          renderInvoked: false,
          sameTrackUnreadableNow:
            resolverObservation?.sameTrackUnreadableNow ?? false,
        });

        logContent?.(
          "secondary recovery trigger",
          buildSecondarySyncLogPayload({
            effectiveSecondaryLanguage,
            secondaryActiveCues,
            primaryActiveCues,
            secondaryCueText,
            primaryCueText,
            currentPrimaryText,
            hasFreshCurrentPrimary,
            mergedSubtitleHealth,
            extra: {
              reason: "sync_interval",
              missCount: recoveryDecision.secondaryLane.missCount,
              forceRebind: recoveryDecision.action === "force-rebind",
              terminated: recoveryDecision.secondaryLane.terminated,
              missLimitReached: recoveryDecision.action === "terminated",
              sameTrackUnreadableNow:
                resolverObservation?.sameTrackUnreadableNow ?? false,
              resolvedSecondaryTrackLanguage:
                resolverObservation?.resolvedSecondaryTrackLanguage || "",
              resolvedSecondaryCueTextLength:
                resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
            },
          }),
        );

        syncSecondarySubtitleTrack?.({
          reason: recoveryDecision.reason,
          forceRebind: recoveryDecision.action === "force-rebind",
        });

        const secondaryTrackFoundAfter = Boolean(state.secondaryTrack);
        const secondaryActiveCuesLengthAfter =
          getTrackActiveCuesLength?.(state.secondaryTrack) ?? 0;

        logContent?.("secondary recovery trigger finished", {
          effectiveSecondaryLanguage,
          secondaryTrackFoundBefore,
          secondaryTrackFoundAfter,
          secondaryActiveCuesLengthBefore,
          secondaryActiveCuesLengthAfter,
          renderInvoked: true,
          sameTrackUnreadableNow:
            resolverObservation?.sameTrackUnreadableNow ?? false,
        });
      }

      // ---------------------------------------------------------
      // runSecondaryRecoveryPass
      // periodic sync の本体。secondary track の再バインド確認、
      // 現在の cue 健全性スナップショット取得、recoveryDecision の評価、
      // 必要なら triggerSecondaryRecovery を呼ぶ、までの一連の流れ。
      // missCount / termination の判定は cueController.evaluateSecondaryRecovery に委ねる。
      // ---------------------------------------------------------
      function runSecondaryRecoveryPass(effectiveSecondaryLanguage) {
        const previousSecondaryTrack = state.secondaryTrack;
        syncSecondarySubtitleTrackBinding?.(
          state.video,
          effectiveSecondaryLanguage,
          renderSecondarySubtitle,
          { suppressRender: true },
        );
        state.secondaryTrack = cueController?.getBoundSecondaryTrack?.() ?? null;

        const now = Date.now();
        const millisSinceLargeSeek =
          state.lastLargeSeekAt > 0 ? now - state.lastLargeSeekAt : null;

        logContent?.("secondary recovery pass started", {
          effectiveSecondaryLanguage,
          currentTime: Number(state.video?.currentTime ?? 0),
          lastLargeSeekAt: state.lastLargeSeekAt ?? null,
          millisSinceLargeSeek,
          hasVideo: Boolean(state.video),
          textTrackCount: state.video?.textTracks?.length ?? 0,
          hasPrimaryTrackObject: Boolean(state.primaryTrack),
          hasSecondaryTrackObject: Boolean(state.secondaryTrack),
        });

        const {
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          hasSecondarySignal,
          hasPrimarySignal,
          mergedSubtitleHealth,
          resolverObservation,
        } = buildSyncIntervalSubtitleSnapshot(now, effectiveSecondaryLanguage);

        logSecondarySyncContextIfNeeded({
          previousSecondaryTrack,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
          resolverObservation,
        });

        // cueController 側の lane state（missCount/terminated 等）を使って
        // idle / recover / force-rebind / terminated のいずれかを決定する。
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
              primaryTextLength: primaryCueText.length,
              secondaryTextLength: secondaryCueText.length,
              currentPrimaryTextLength: currentPrimaryText.length,
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
            resolvedSecondaryCueTextLength:
              resolverObservation?.resolvedSecondaryCueTextLength ?? 0,
          });
        }

        logSecondaryRecoveryTermination({
          recoveryDecision,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
          resolverObservation,
          millisSinceLargeSeek,
        });

        triggerSecondaryRecovery({
          recoveryDecision,
          effectiveSecondaryLanguage,
          secondaryActiveCues,
          primaryActiveCues,
          secondaryCueText,
          primaryCueText,
          currentPrimaryText,
          hasFreshCurrentPrimary,
          mergedSubtitleHealth,
          resolverObservation,
        });

        return {
          now,
          hasSecondarySignal,
          hasPrimarySignal,
        };
      }

      return {
        refreshPlaybackContext,
        detectLargeSeek,
        runSecondaryRecoveryPass,
      };
    };
})();