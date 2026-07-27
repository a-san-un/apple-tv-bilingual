// =============================================================
// Apple TV+ Bilingual Subtitles - cue-controller.js
// version: 2.6.3
// 役割: cue change を起点に current subtitle / subtitle blocks / overlay / panel 更新を統括する。
// Phase J: secondary missing の runtime 監視、recovery 判定、nearby rebuild の 1 回保護を担当する。
// =============================================================

(() => {
  // ATVB 名前空間を取得し、cue controller を公開する先を固定する。
  const root = (window.ATVB = window.ATVB || {});

  // cue-controller 全体の依存を受け取り、
  // cue change・subtitle blocks・overlay / panel 更新をまとめて扱う中核を作る。
  function createCueController({
    state,
    logContent,
    DEBUG_SECONDARY_SUBS,
    getSecondaryTrackDebugPayload,
    resolveSecondarySubtitleTrack,
    getCurrentCueText,
    getTrackCuesLength,
    getTrackActiveCuesLength,
    getRequestedSecondaryLanguage,
    getPrimaryTrack,
    getSecondaryTrack,
    getCurrentCue,
    cleanCueText,
    getCurrentTime,
    getPrimaryTrackCues,
    getSecondaryTrackCues,
    getPreviousSubtitleBlocks,
    setSubtitleBlocks,
    getSubtitleBlockSequence,
    getCurrentSubtitleBlockFromSequence,
    setCurrentSubtitleBlock,
    DEBUG_PANEL_PROBE,
    renderSecondarySubtitle,
    updateOverlay,
    updateOverlayFromView,
    updateOverlayFromBlock,
    renderPanel,
  }) {
    // 現在 bind されている secondary listener の解除関数を保持する。
    let secondaryTrackCleanup = null;

    // 現在 bind 済みの secondary track を保持する。
    let secondaryTrackBound = null;

    // 最新の merged subtitle health を観測・外部参照用に保持する。
    let lastMergedSubtitleHealth = null;

    // nearby rebuild の current block 保護を 1 回だけ成立させる guard を保持する。
    let nearbyRebuildGuard = null;

    // nearby rebuild 直後に一時利用する hold view の格納先を初期化する。
    state.nearbyRebuildHoldView ??= null;

    // secondary missing が recovery 対象になるまで待つ継続時間を定義する。
    const SECONDARY_RECOVERY_WINDOW_MS = 1000;

    // repeated miss 後に force-rebind へ進める missCount の下限を定義する。
    const SECONDARY_FORCE_REBIND_MISS_COUNT = 2;

    // recovery 試行を打ち切って terminated に入る missCount 上限を定義する。
    const SECONDARY_RECOVERY_MISS_LIMIT = 8;

    // large seek 直後として nearby rebuild を許可する時間窓を定義する。
    const NEARBY_REBUILD_SEEK_WINDOW_MS = 4000;

    // lane ごとの欠落状態を保持する初期オブジェクトを作る。
    function createLaneState(lane) {
      return {
        lane,
        healthy: false,
        isMissing: false,
        missingSince: 0,
        missingDurationMs: 0,
        missCount: 0,
        terminated: false,
        lastDecision: "idle",
      };
    }

    // primary / secondary の lane state を 1 か所で管理する。
    const laneStates = {
      primary: createLaneState("primary"),
      secondary: createLaneState("secondary"),
    };

    // 欠落監視に使う lane state を初期状態へ戻す。
    function resetLaneState(laneState) {
      laneState.isMissing = false;
      laneState.missingSince = 0;
      laneState.missingDurationMs = 0;
      laneState.missCount = 0;
      laneState.terminated = false;
      laneState.lastDecision = "idle";
    }

    function resetSecondaryRecoveryLane(reason = "manual-reset") {
      const before = {
        missCount: laneStates.secondary?.missCount ?? null,
        terminated: laneStates.secondary?.terminated ?? null,
        missingSince: laneStates.secondary?.missingSince ?? null,
        missingDurationMs: laneStates.secondary?.missingDurationMs ?? null,
        lastDecision: laneStates.secondary?.lastDecision ?? null,
      };

      resetLaneState(laneStates.secondary);

      logContent?.("secondary recovery lane reset", {
        reason,
        before,
        after: {
          missCount: laneStates.secondary?.missCount ?? null,
          terminated: laneStates.secondary?.terminated ?? null,
          missingSince: laneStates.secondary?.missingSince ?? null,
          missingDurationMs: laneStates.secondary?.missingDurationMs ?? null,
          lastDecision: laneStates.secondary?.lastDecision ?? null,
        },
      });

      return laneStates.secondary;
    }

    // 現在の観測結果で lane state を更新する。
    function updateLaneState(laneState, { now, healthy, isMissing }) {
      laneState.healthy = healthy === true;
      laneState.isMissing = isMissing === true;

      if (!laneState.isMissing) {
        laneState.missingSince = 0;
        laneState.missingDurationMs = 0;
        laneState.missCount = 0;
        laneState.terminated = false;
        laneState.lastDecision = "idle";
        return laneState;
      }

      if (!laneState.missingSince) {
        laneState.missingSince = now;
      }

      laneState.missingDurationMs = Math.max(0, now - laneState.missingSince);
      return laneState;
    }

    // secondary track の identity / readable 状態を Round 8 用に揃えて観測する。
    function getSecondaryTrackObservation(track, prefix = "track") {
      const currentTime = getCurrentTime();
      const currentCue = getCurrentCue(track, currentTime);
      const currentCueText = cleanCueText(currentCue);

      return {
        [`${prefix}Label`]: track?.label || "",
        [`${prefix}Language`]: track?.language || "",
        [`${prefix}Kind`]: track?.kind || "",
        [`${prefix}Mode`]: track?.mode || "",
        [`${prefix}CuesLength`]: getTrackCuesLength(track),
        [`${prefix}ActiveCuesLength`]: getTrackActiveCuesLength(track),
        [`${prefix}CurrentCueTextLength`]: currentCueText.length,
        [`${prefix}HasCueOverlapAtCurrentTime`]: Boolean(currentCue),
      };
    }

    // secondary lane の runtime missing が一定時間続き、
    // merged assists も recovery 対象と示したときだけ recover / force-rebind / terminated を判定する。
    // 主に large seek 後の secondary missing を対象とし、通常再生での短い gap はここでは扱わない。
    function evaluateSecondaryRecovery({
      now,
      runtime,
      currentCue,
      sequence,
      derived,
    }) {
      const primaryLane = updateLaneState(laneStates.primary, {
        now,
        healthy: derived?.primaryHealthy === true,
        isMissing: false,
      });

      const secondaryRuntimeMissing =
        derived?.primaryHealthy === true &&
        currentCue?.secondaryTextLength === 0 &&
        runtime?.secondaryTrackFound === true &&
        runtime?.secondaryActiveCues === 0;

      const secondaryRecovered =
        runtime?.secondaryTrackFound === true &&
        (
          runtime?.secondaryActiveCues > 0 ||
          currentCue?.secondaryTextLength > 0
        );

      const secondaryLane = updateLaneState(laneStates.secondary, {
        now,
        healthy: secondaryRecovered,
        isMissing: secondaryRuntimeMissing,
      });

      if (secondaryRecovered) {
        resetLaneState(secondaryLane);
      }

      if (!secondaryLane.isMissing) {
        secondaryLane.lastDecision = "idle";
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_not_missing",
        };
      }

      if (secondaryLane.terminated) {
        secondaryLane.lastDecision = "terminated";
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_terminated",
        };
      }

      const shouldRecoverSecondary =
        secondaryLane.missingDurationMs >= SECONDARY_RECOVERY_WINDOW_MS &&
        (derived?.shouldRecoverSecondary === true || secondaryLane.isMissing);

      if (!shouldRecoverSecondary) {
        secondaryLane.lastDecision = "idle";
        return {
          primaryLane,
          secondaryLane,
          action: "idle",
          reason: "secondary_missing_waiting_window",
        };
      }

      secondaryLane.missCount += 1;

      if (
        secondaryLane.missCount >= SECONDARY_RECOVERY_MISS_LIMIT &&
        derived?.shouldRecoverSecondary !== true
      ) {
        secondaryLane.terminated = true;
        secondaryLane.lastDecision = "terminated";
        return {
          primaryLane,
          secondaryLane,
          action: "terminated",
          reason: "secondary_recovery_miss_limit",
        };
      }

      const shouldForceSecondaryRebind =
        derived?.shouldForceSecondaryRebind === true ||
        secondaryLane.missCount >= SECONDARY_FORCE_REBIND_MISS_COUNT;

      secondaryLane.lastDecision = shouldForceSecondaryRebind
        ? "force-rebind"
        : "recover";

      return {
        primaryLane,
        secondaryLane,
        action: secondaryLane.lastDecision,
        reason: shouldForceSecondaryRebind
          ? "secondary_force_rebind_after_repeated_miss"
          : "secondary_current_missing_with_primary_present",
      };
    }

    // 現在 bind 済みの secondary track を返す。
    function getBoundSecondaryTrack() {
      return secondaryTrackBound;
    }

    // bind 済みの secondary track listener を解除する。
    function unbindSecondarySubtitleTrack() {
      if (secondaryTrackCleanup) {
        secondaryTrackCleanup();
        secondaryTrackCleanup = null;
      }
      secondaryTrackBound = null;
    }

    // secondary bind 時の mode を、実行文脈と readable snapshot から決定する。
    // Round 10:
    // - 既定は hidden
    // - same track / unreadable snapshot 成立時だけ showing へ readability-promote する
    // - DEBUG 時は showing を強制できる
    function resolveSecondaryTrackModePolicy({
      track,
      reason,
      debugForceShowing = false,
      allowShowing = true,
      unreadableSnapshot = null,
    }) {
      if (!track) {
        return {
          requestedMode: "hidden",
          policy: "no-track",
          rationale: "track_missing",
          reason: reason || "unknown",
        };
      }

      if (debugForceShowing) {
        return {
          requestedMode: "showing",
          policy: "debug-force-showing",
          rationale: "debug_override",
          reason: reason || "unknown",
        };
      }

      const unreadable =
        unreadableSnapshot &&
        unreadableSnapshot.cuesLength > 0 &&
        unreadableSnapshot.activeCuesLength === 0 &&
        !unreadableSnapshot.hasCueOverlapAtCurrentTime &&
        unreadableSnapshot.currentCueTextLength === 0;

      if (allowShowing && unreadable) {
        return {
          requestedMode: "showing",
          policy: "readability-promote",
          rationale: "same_track_unreadable_in_hidden_mode",
          reason: reason || "unknown",
        };
      }

      return {
        requestedMode: "hidden",
        policy: "default-hidden",
        rationale: "no_readability_issue_detected",
        reason: reason || "unknown",
      };
    }

    // secondary cue change を受けて secondary 表示と primary 側更新を進める。
    function onCueChange(track) {
      if (track && DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary cuechange render",
          getSecondaryTrackDebugPayload(getRequestedSecondaryLanguage(), track),
        );
      }

      if (track) {
        const currentTime = getCurrentTime();
        const cueText = getCurrentCueText(track, currentTime);
        const overlapCue = getCurrentCue(track, currentTime);

        if (DEBUG_SECONDARY_SUBS) {
          logContent("secondary-sync render-entry", {
            reason: "onCueChange",
            currentTime,
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            trackMode: track?.mode || "",
            cueTextLength: cueText?.length ?? 0,
            overlapCueExists: Boolean(overlapCue),
            overlapCueStartTime: overlapCue?.startTime ?? null,
            overlapCueEndTime: overlapCue?.endTime ?? null,
            willRenderEmpty: !cueText,
          });
        }

        renderSecondarySubtitle(cueText, track);
      }

      onPrimaryCueChange();
    }

    // secondary track を bind して cuechange 監視を始める。
    // mode の決定は呼び出し側で行い、ここでは mode 適用 + listener attach / cleanup のみを担う。
    function bindSecondarySubtitleTrack(track, modeDecision) {
      if (!track) return;

      const previousBoundTrack = secondaryTrackBound;
      unbindSecondarySubtitleTrack();

      const previousMode = track?.mode || "";
      const requestedMode = modeDecision?.requestedMode || "hidden";

      try {
        track.mode = requestedMode;
      } catch (error) {
        logContent("secondary-sync mode-apply failed", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          requestedMode,
          previousMode,
          policy: modeDecision?.policy || "",
          rationale: modeDecision?.rationale || "",
          decisionReason: modeDecision?.reason || "",
          message: String(error?.message || error || ""),
        });
      }

      logContent("secondary-sync mode-applied", {
        trackLanguage: track?.language || "",
        trackKind: track?.kind || "",
        requestedMode,
        appliedMode: track?.mode || "",
        policy: modeDecision?.policy || "",
        rationale: modeDecision?.rationale || "",
        decisionReason: modeDecision?.reason || "",
        cuesLength: getTrackCuesLength(track),
        activeCuesLength: getTrackActiveCuesLength(track),
        sameAsPreviousBound: previousBoundTrack === track,
        currentTime: getCurrentTime(),
      });

      if (DEBUG_SECONDARY_SUBS) {
        logContent("secondary track bind", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackMode: track?.mode || "",
          policy: modeDecision?.policy || "",
          rationale: modeDecision?.rationale || "",
          decisionReason: modeDecision?.reason || "",
          cuesLength: getTrackCuesLength(track),
          activeCuesLength: getTrackActiveCuesLength(track),
          sameAsPreviousBound: previousBoundTrack === track,
          currentTime: getCurrentTime(),
        });
      }

      const handler = () => {
        if (DEBUG_SECONDARY_SUBS) {
          logContent("secondary-sync cuechange-fired", {
            reason: "secondaryTrackEvent",
            currentTime: getCurrentTime(),
            ...getSecondaryTrackObservation(track, "track"),
          });

          logContent("secondary cuechange raw", {
            currentTime: getCurrentTime(),
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            trackMode: track?.mode || "",
            activeCuesLength: (() => {
              try {
                return track?.activeCues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            cuesLength: (() => {
              try {
                return track?.cues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            currentCueTextLength: getCurrentCueText(track)?.length ?? 0,
          });
        }

        const currentTime = getCurrentTime();
        const overlapCue = getCurrentCue(track, currentTime);
        const overlapCueText = cleanCueText(overlapCue);
        const currentCueText = getCurrentCueText(track, currentTime);

        if (DEBUG_SECONDARY_SUBS) {
          logContent("secondary-sync cue-readable-snapshot", {
            reason: "secondaryTrackEvent",
            currentTime,
            trackLanguage: track?.language || "",
            trackKind: track?.kind || "",
            trackMode: track?.mode || "",
            activeCuesLength: (() => {
              try {
                return track?.activeCues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            cuesLength: (() => {
              try {
                return track?.cues?.length ?? 0;
              } catch (_) {
                return -1;
              }
            })(),
            overlapCueExists: Boolean(overlapCue),
            overlapCueStartTime: overlapCue?.startTime ?? null,
            overlapCueEndTime: overlapCue?.endTime ?? null,
            overlapCueTextLength: overlapCueText.length,
            currentCueTextLength: currentCueText?.length ?? 0,
            cueReadableByActiveCues: (() => {
              try {
                return (track?.activeCues?.length ?? 0) > 0;
              } catch (_) {
                return false;
              }
            })(),
            cueReadableByOverlap: Boolean(overlapCue),
            cueReadableByText: Boolean(currentCueText),
          });
        }

        onCueChange(track);
      };

      try {
        track.addEventListener("cuechange", handler);
      } catch (error) {
        logContent("secondary track bind failed", {
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackMode: track?.mode || "",
          policy: modeDecision?.policy || "",
          rationale: modeDecision?.rationale || "",
          decisionReason: modeDecision?.reason || "",
          message: String(error?.message || error || ""),
        });
        return;
      }

      secondaryTrackCleanup = () => {
        try {
          track.removeEventListener("cuechange", handler);
        } catch (_) {}
      };

      secondaryTrackBound = track;

      logContent("secondary-sync bind-result", {
        trackLanguage: track?.language || "",
        trackKind: track?.kind || "",
        trackMode: track?.mode || "",
        policy: modeDecision?.policy || "",
        rationale: modeDecision?.rationale || "",
        decisionReason: modeDecision?.reason || "",
        cuesLength: getTrackCuesLength(track),
        activeCuesLength: getTrackActiveCuesLength(track),
        boundTrackExists: Boolean(secondaryTrackBound),
        hasCleanup: typeof secondaryTrackCleanup === "function",
      });
    }

    // secondary track の再解決と再同期を行い、必要なら nearby rebuild まで進める。
    function syncSecondarySubtitleTrack(
      video,
      requestedLang,
      renderSecondarySubtitleOverride,
      options = {},
    ) {
      if (!video) return;

      const suppressRender = options.suppressRender === true;
      const forceRebind = options.forceRebind === true;
      const previousBoundTrack = secondaryTrackBound;

      if (DEBUG_SECONDARY_SUBS) {
        logContent(
          "secondary sync",
          getSecondaryTrackDebugPayload(requestedLang, secondaryTrackBound),
        );
      }

      if (forceRebind) {
        unbindSecondarySubtitleTrack();
      }

      const track = resolveSecondarySubtitleTrack(video, requestedLang);
      const sameTrackRef = Boolean(track && previousBoundTrack === track);
      const currentTime = getCurrentTime();
      const resolvedTrackActiveCuesLength = (() => {
        try {
          return track?.activeCues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })();
      const resolvedTrackCuesLength = (() => {
        try {
          return track?.cues?.length ?? 0;
        } catch (_) {
          return -1;
        }
      })();
      const resolvedTrackCurrentCue = getCurrentCue(track, currentTime);
      const resolvedTrackCurrentCueText = cleanCueText(resolvedTrackCurrentCue);

      logContent("secondary-sync resolver-selected", {
        reason: "syncSecondarySubtitleTrack",
        requestedLang: requestedLang || "",
        forceRebind,
        suppressRender,
        currentTime,
        boundTrackExistsBefore: Boolean(previousBoundTrack),
        sameTrackRef,
        previousBoundTrackLanguage: previousBoundTrack?.language || "",
        previousBoundTrackMode: previousBoundTrack?.mode || "",
        selectedTrackExists: Boolean(track),
        ...getSecondaryTrackObservation(track, "selectedTrack"),
      });

      logContent("secondary sync raw", {
        requestedLang: requestedLang || "",
        suppressRender,
        forceRebind,
        boundTrackExistsBefore: Boolean(previousBoundTrack),
        resolvedTrackExists: Boolean(track),
        sameTrackRef,
        boundTrackLanguageBefore: previousBoundTrack?.language || "",
        boundTrackModeBefore: previousBoundTrack?.mode || "",
        resolvedTrackLanguage: track?.language || "",
        resolvedTrackKind: track?.kind || "",
        resolvedTrackMode: track?.mode || "",
        resolvedTrackCuesLength,
        resolvedTrackActiveCuesLength,
        resolvedTrackCurrentCueTextLength: resolvedTrackCurrentCueText.length,
        resolvedTrackHasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
        currentTime,
      });

      if (!track) {
        unbindSecondarySubtitleTrack();
        if (!suppressRender) {
          (renderSecondarySubtitleOverride || renderSecondarySubtitle)("", null);
        }
        return;
      }

      const unreadableSnapshot = {
        cuesLength: resolvedTrackCuesLength,
        activeCuesLength: resolvedTrackActiveCuesLength,
        hasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
        currentCueTextLength: resolvedTrackCurrentCueText.length,
      };

      const shouldRebindBecauseUnreadable =
        sameTrackRef &&
        unreadableSnapshot.cuesLength > 0 &&
        unreadableSnapshot.activeCuesLength === 0 &&
        !unreadableSnapshot.hasCueOverlapAtCurrentTime &&
        unreadableSnapshot.currentCueTextLength === 0;

      if (shouldRebindBecauseUnreadable) {
        logContent("secondary-sync rebind-required", {
          reason: "sameTrackButUnreadableAtCurrentTime",
          requestedLang: requestedLang || "",
          currentTime,
          sameTrackRef,
          forceRebind,
          resolvedTrackLanguage: track?.language || "",
          resolvedTrackMode: track?.mode || "",
          resolvedTrackCuesLength,
          resolvedTrackActiveCuesLength,
          resolvedTrackCurrentCueTextLength: resolvedTrackCurrentCueText.length,
          resolvedTrackHasCueOverlapAtCurrentTime: Boolean(resolvedTrackCurrentCue),
        });
      }

      const modeDecision = resolveSecondaryTrackModePolicy({
        track,
        reason: forceRebind
          ? "forceRebind"
          : shouldRebindBecauseUnreadable
            ? "sameTrackUnreadable"
            : "syncSecondarySubtitleTrack",
        debugForceShowing: DEBUG_SECONDARY_SUBS,
        allowShowing: true,
        unreadableSnapshot,
      });

      if (modeDecision.policy === "readability-promote") {
        logContent("secondary-sync mode-policy readability-promote", {
          requestedLang: requestedLang || "",
          currentTime,
          sameTrackRef,
          forceRebind,
          trackLanguage: track?.language || "",
          trackKind: track?.kind || "",
          trackModeBefore: track?.mode || "",
          requestedMode: modeDecision.requestedMode,
          policy: modeDecision.policy,
          rationale: modeDecision.rationale,
          decisionReason: modeDecision.reason,
          unreadableSnapshot,
        });
      }

      if (
        secondaryTrackBound !== track ||
        forceRebind ||
        shouldRebindBecauseUnreadable
      ) {
        bindSecondarySubtitleTrack(track, modeDecision);
        rebuildCurrentSceneSubtitleBlocks();
        return;
      }

      if (!suppressRender) {
        (renderSecondarySubtitleOverride || renderSecondarySubtitle)(
          getCurrentCueText(track),
          track,
        );
      }

      rebuildCurrentSceneSubtitleBlocks();
    }

    // runtime / current cue / sequence を 1 つにまとめ、
    // controller が recovery 判定に使う merged subtitle health を組み立てる。
    // truth source は SubtitleBlockSequence 側の sequenceHealth で、runtime は補助観測として扱う。
    function buildMergedSubtitleHealth({
      primaryTrack,
      secondaryTrack,
      pCue,
      pText,
      sCue,
      sText,
      sequenceHealth,
    }) {
      // 現在 bind / active な track 状態を runtime 観測値としてまとめる。
      const runtime = {
        primaryTrackFound: Boolean(primaryTrack),
        secondaryTrackFound: Boolean(secondaryTrack),
        primaryActiveCues: getTrackActiveCuesLength(primaryTrack),
        secondaryActiveCues: getTrackActiveCuesLength(secondaryTrack),
      };

      // 現在 cue と text の有無を current cue 観測値としてまとめる。
      const currentCue = {
        hasPrimaryCue: Boolean(pCue),
        hasSecondaryCue: Boolean(sCue),
        hasFreshCurrentPrimary: Boolean(pCue) && Boolean(pText),
        primaryTextLength: pText.length,
        secondaryTextLength: sText.length,
        hasPrimaryText: Boolean(pText),
        hasSecondaryText: Boolean(sText),
      };

      // SubtitleBlockSequence 由来の current pair health を sequence 観測値としてまとめる。
      const sequence = {
        hasCurrentBlock: Boolean(sequenceHealth?.hasCurrentBlock),
        hasCurrentPrimary: Boolean(sequenceHealth?.hasCurrentPrimary),
        hasCurrentSecondary: Boolean(sequenceHealth?.hasCurrentSecondary),
        currentPairAligned: Boolean(sequenceHealth?.currentPairAligned),
        currentPairMissingSecondary: Boolean(
          sequenceHealth?.currentPairMissingSecondary,
        ),
        previousPairMissingSecondary: Boolean(
          sequenceHealth?.previousPairMissingSecondary,
        ),
        consecutiveCurrentMissingSecondary: Boolean(
          sequenceHealth?.consecutiveCurrentMissingSecondary,
        ),
      };

      // primary lane が現在十分に観測できているかを derived health として求める。
      const primaryHealthy =
        runtime.primaryTrackFound &&
        (runtime.primaryActiveCues > 0 ||
          currentCue.hasPrimaryText ||
          sequence.hasCurrentPrimary);

      // secondary lane が現在十分に観測できているかを derived health として求める。
      const secondaryHealthy =
        runtime.secondaryTrackFound &&
        (runtime.secondaryActiveCues > 0 ||
          currentCue.hasSecondaryText ||
          sequence.hasCurrentSecondary);

      // sequence が「current pair で secondary gap がある」と示しているかを補助 truth に使う。
      const sequenceSuggestsSecondaryGap = sequence.currentPairMissingSecondary;

      // runtime missing を再試行してよい候補かを derived 判定として求める。
      const shouldRecoverSecondary =
        primaryHealthy && !secondaryHealthy && sequenceSuggestsSecondaryGap;

      // consecutive gap が続く場合に force-rebind 側へ進めるべきかを derived 判定として求める。
      const shouldForceSecondaryRebind =
        shouldRecoverSecondary && sequence.consecutiveCurrentMissingSecondary;

      return {
        runtime,
        currentCue,
        sequence,
        derived: {
          primaryHealthy,
          secondaryHealthy,
          shouldRecoverSecondary,
          shouldForceSecondaryRebind,
        },
      };
    }

    // nearby rebuild の 1 回保護状態と hold view をまとめて解除する。
    function clearNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
      state.nearbyRebuildHoldView = null;
    }

    // 次の primary cue change で消費する予定だった guard だけを取り下げる。
    function consumeNearbyRebuildGuard() {
      nearbyRebuildGuard = null;
    }

    // 現在が large seek 直後の nearby rebuild 許可 window 内かを判定する。
    function isWithinNearbyRebuildSeekWindow() {
      const lastLargeSeekAt = Number(state.lastLargeSeekAt ?? 0);
      if (!lastLargeSeekAt) return false;
      return Date.now() - lastLargeSeekAt <= NEARBY_REBUILD_SEEK_WINDOW_MS;
    }

    // nearby rebuild 直後の current block を次の 1 回だけ保護する。
    function armNearbyRebuildGuard(currentBlock) {
      nearbyRebuildGuard = {
        consumeOnNextPrimaryCueChange: true,
        issuedAt: Date.now(),
        blockStartTime: currentBlock?.startTime ?? null,
        blockEndTime: currentBlock?.endTime ?? null,
        sourceReason: currentBlock?.sourceReason ?? "nearbyRebuild",
      };
    }

    // 次の primary cue change で nearby rebuild の current / hold view を優先するか判定する。
    function shouldPreserveNearbyRebuildCurrentBlock() {
      const guardActive = Boolean(
        nearbyRebuildGuard?.consumeOnNextPrimaryCueChange,
      );
      if (!guardActive) return false;

      const hasNearbySource = Boolean(
        state.nearbyRebuildHoldView?.currentBlock?.sourceReason ===
          "nearbyRebuildHold" ||
          state.currentSubtitleBlock?.sourceReason === "nearbyRebuild",
      );
      if (!hasNearbySource) return false;

      return isWithinNearbyRebuildSeekWindow();
    }

    // 現在時刻近傍の cue だけで subtitle blocks を組み直し、current view / current block を更新する。
    function rebuildCurrentSceneSubtitleBlocks() {
      const currentTime = getCurrentTime();
      const primaryTrack = getPrimaryTrack();
      const secondaryTrack = getSecondaryTrack();

      const allPrimaryCues = getPrimaryTrackCues();
      const allSecondaryCues = getSecondaryTrackCues();

      const pCue = getCurrentCue(primaryTrack, currentTime);
      const pText = cleanCueText(pCue);
      const sCue = getCurrentCue(secondaryTrack, currentTime);
      const sText = cleanCueText(sCue);

      // truth の一覧がまだ空のときは、現在の view を short-lived に hold するだけに留める。
      if (!Array.isArray(allPrimaryCues) || allPrimaryCues.length === 0) {
        const previousView = state.currentSubtitleView || null;
        const previousBlock = state.currentSubtitleBlock || null;

        // hold 用の current block を直前 view / block と現在 cue から補完して作る。
        const holdBlock = {
          startTime:
            pCue?.startTime ??
            previousView?.currentBlock?.startTime ??
            previousBlock?.startTime ??
            null,
          endTime:
            pCue?.endTime ??
            previousView?.currentBlock?.endTime ??
            previousBlock?.endTime ??
            null,
          primaryText:
            pText ||
            previousView?.currentBlock?.primaryText ||
            previousBlock?.primaryText ||
            "",
          secondaryText:
            sText ||
            previousView?.currentBlock?.secondaryText ||
            previousBlock?.secondaryText ||
            "",
          hasPrimarySignal: Boolean(
            pText ||
              previousView?.currentBlock?.primaryText ||
              previousBlock?.primaryText,
          ),
          hasSecondarySignal: Boolean(
            sText ||
              previousView?.currentBlock?.secondaryText ||
              previousBlock?.secondaryText,
          ),
          sourceReason: "nearbyRebuildHold",
          updatedAt: Date.now(),
        };

        // overlay / panel が参照する hold view を current block 付きで組み立てる。
        const holdView = {
          currentBlock: holdBlock,
          sourceReason: "nearbyRebuildHold",
          mainLines: holdBlock?.primaryText ? [holdBlock.primaryText] : [],
          subLines: holdBlock?.secondaryText ? [holdBlock.secondaryText] : [],
          isStable: false,
          shouldKeepVisible: true,
          isEmpty: !holdBlock?.primaryText && !holdBlock?.secondaryText,
        };

        state.nearbyRebuildHoldView = holdView;
        armNearbyRebuildGuard(holdBlock);

        logContent("current subtitle view hold updated", {
          reason: "nearbyRebuildHold",
          source: "nearbyRebuild",
          sourceReason: holdBlock?.sourceReason ?? null,
          guardActive: Boolean(
            nearbyRebuildGuard?.consumeOnNextPrimaryCueChange,
          ),
          withinSeekWindow: isWithinNearbyRebuildSeekWindow(),
          startTime: holdBlock?.startTime ?? null,
          endTime: holdBlock?.endTime ?? null,
          hasPrimarySignal: Boolean(holdBlock?.hasPrimarySignal),
          hasSecondarySignal: Boolean(holdBlock?.hasSecondarySignal),
        });

        // truth 台帳は触らず、current shared UI と overlay だけを短時間支える。
        state.currentSubtitleView = holdView;
        updateOverlayFromView(holdView);

        if (secondaryTrack) {
          renderSecondarySubtitle(holdBlock.secondaryText || "", secondaryTrack);
        }

        renderPanel();

        return;
      }

      // primary cue 一覧から現在時刻に最も近い cue index を求める。
      let closestIndex = 0;
      let closestDelta = Number.POSITIVE_INFINITY;
      for (let i = 0; i < allPrimaryCues.length; i++) {
        const cue = allPrimaryCues[i];
        const start = Number(cue?.startTime ?? 0);
        const end = Number(cue?.endTime ?? 0);
        const center = (start + end) / 2;
        const delta = Math.abs(center - currentTime);
        if (delta < closestDelta) {
          closestDelta = delta;
          closestIndex = i;
        }
      }

      // current 近傍だけを切り出した primary window を nearby rebuild 入力として使う。
      const windowStart = Math.max(0, closestIndex - 1);
      const windowEnd = Math.min(allPrimaryCues.length, closestIndex + 2);
      const windowPrimaryCues = allPrimaryCues.slice(windowStart, windowEnd);

      // secondary は full cues を使い、pairing 側に探索余地を残す。
      const windowSecondaryCues = allSecondaryCues;

      // subtitle blocks API の有無を nearby rebuild 前に確認する。
      const blockApi = window.ATVB?.subtitleBlocks || {};
      const hasBuildSubtitleBlockSequence =
        typeof blockApi.buildSubtitleBlockSequence === "function";

      if (!hasBuildSubtitleBlockSequence) {
        logContent("nearby rebuild skipped", {
          reason: "subtitle_blocks_api_missing",
          primaryTrackFound: Boolean(primaryTrack),
          primaryCuesLength: allPrimaryCues.length,
          secondaryTrackFound: Boolean(secondaryTrack),
          secondaryCuesLength: Array.isArray(allSecondaryCues)
            ? allSecondaryCues.length
            : -1,
        });
        return;
      }

      // nearby rebuild 用の入力から SubtitleBlockSequence を再構成する。
      const blockResult = blockApi.buildSubtitleBlockSequence({
        primaryCues: windowPrimaryCues,
        secondaryCues: windowSecondaryCues,
        now: currentTime,
        previousBlocks: getPreviousSubtitleBlocks(),
        cleanCueText,
        rebuildReason: "rebuildCurrentScene",
      });

      setSubtitleBlocks(blockResult, "rebuildCurrentScene");

      const sequenceHealth = blockResult?.meta?.sequenceHealth || null;

      const mergedSubtitleHealth = buildMergedSubtitleHealth({
        primaryTrack,
        secondaryTrack,
        pCue,
        pText,
        sCue,
        sText,
        sequenceHealth,
      });

      lastMergedSubtitleHealth = mergedSubtitleHealth;

      // sequence current が取れない場合でも最低限の fallback block を作る。
      const currentBlock = getCurrentSubtitleBlockFromSequence(blockResult) || {
        startTime: pCue?.startTime ?? null,
        endTime: pCue?.endTime ?? null,
        primaryText: pText || "",
        secondaryText: sText || "",
        hasPrimarySignal: Boolean(pText),
        hasSecondarySignal: Boolean(sText),
        sourceReason: "nearbyRebuild:fallback",
        updatedAt: Date.now(),
      };

      currentBlock.sourceReason = "nearbyRebuild";

      setCurrentSubtitleBlock(currentBlock, "nearbyRebuild");
      armNearbyRebuildGuard(currentBlock);

      logContent("current subtitle block updated", {
        reason: "nearbyRebuild",
        source: "nearbyRebuild",
        sourceReason: currentBlock?.sourceReason ?? null,
        guardActive: Boolean(nearbyRebuildGuard?.consumeOnNextPrimaryCueChange),
        withinSeekWindow: isWithinNearbyRebuildSeekWindow(),
        startTime: currentBlock?.startTime ?? null,
        endTime: currentBlock?.endTime ?? null,
        hasPrimarySignal: Boolean(currentBlock?.hasPrimarySignal),
        hasSecondarySignal: Boolean(currentBlock?.hasSecondarySignal),
      });

      // panel / overlay 共通 view を sequence から解決する。
      const overlaySequence = getSubtitleBlockSequence();
      const subtitleViewResolver = root.subtitleViewResolver || null;
      const subtitleView =
        subtitleViewResolver &&
        typeof subtitleViewResolver.resolveUiSubtitleView === "function"
          ? subtitleViewResolver.resolveUiSubtitleView(
              overlaySequence?.blocks,
              overlaySequence?.currentIndex,
              overlaySequence?.meta,
            )
          : null;

      state.currentSubtitleView = subtitleView;

      if (subtitleView) {
        updateOverlayFromView(subtitleView);
      } else {
        updateOverlayFromBlock(currentBlock);
      }

      if (secondaryTrack) {
        renderSecondarySubtitle(sText, secondaryTrack);
      }

      renderPanel();
    }

    // primary cue change を基準に full rebuild を行い、必要なら 1 回だけ nearby current / hold view を優先する。
    function onPrimaryCueChange() {
      logContent("cue-controller onPrimaryCueChange entered", {
        hasATVB: !!window.ATVB,
      });

      const currentTime = getCurrentTime();
      const primaryTrack = getPrimaryTrack();
      const secondaryTrack = getSecondaryTrack();
      const pCue = getCurrentCue(primaryTrack, currentTime);
      const pText = cleanCueText(pCue);
      const sCue = getCurrentCue(secondaryTrack, currentTime);
      const sText = cleanCueText(sCue);

      if (DEBUG_PANEL_PROBE) {
        logContent("cuechange track probe", {
          primaryTrackLanguage: primaryTrack?.language,
          secondaryTrackLanguage: secondaryTrack?.language,
          pText: pText.slice(0, 40),
          sText: sText.slice(0, 40),
        });
      }

      // full rebuild に使う subtitle blocks API の有無を確認する。
      const blockApi = window.ATVB?.subtitleBlocks || {};
      const hasBuildSubtitleBlockSequence =
        typeof blockApi.buildSubtitleBlockSequence === "function";

      if (DEBUG_PANEL_PROBE) {
        logContent("subtitle blocks api snapshot", {
          hasATVB: !!window.ATVB,
          atvbKeys: Object.keys(window.ATVB || {}),
          hasSubtitleBlocks: !!window.ATVB?.subtitleBlocks,
          hasBuildSubtitleBlockSequence,
        });
      }

      let blockResult = null;

      if (hasBuildSubtitleBlockSequence) {
        blockResult = blockApi.buildSubtitleBlockSequence({
          primaryCues: getPrimaryTrackCues(),
          secondaryCues: getSecondaryTrackCues(),
          now: currentTime,
          previousBlocks: getPreviousSubtitleBlocks(),
          cleanCueText,
          rebuildReason: "onPrimaryCueChange",
        });

        setSubtitleBlocks(blockResult, "onPrimaryCueChange");
      } else {
        logContent("subtitle blocks api missing", {
          reason: "onPrimaryCueChange",
          hasATVB: !!window.ATVB,
          atvbKeys: Object.keys(window.ATVB || {}),
        });
      }

      const sequenceHealth = blockResult?.meta?.sequenceHealth || null;
      const mergedSubtitleHealth = buildMergedSubtitleHealth({
        primaryTrack,
        secondaryTrack,
        pCue,
        pText,
        sCue,
        sText,
        sequenceHealth,
      });

      lastMergedSubtitleHealth = mergedSubtitleHealth;

      if (DEBUG_PANEL_PROBE) {
        logContent("merged subtitle health snapshot", {
          primaryHealthy: mergedSubtitleHealth.derived.primaryHealthy,
          secondaryHealthy: mergedSubtitleHealth.derived.secondaryHealthy,
          shouldRecoverSecondary:
            mergedSubtitleHealth.derived.shouldRecoverSecondary,
          shouldForceSecondaryRebind:
            mergedSubtitleHealth.derived.shouldForceSecondaryRebind,
        });
      }

      if (mergedSubtitleHealth.derived.shouldRecoverSecondary && state.video) {
        if (DEBUG_PANEL_PROBE) {
          logContent("cue-controller secondary recovery observed", {
            hasVideo: Boolean(state.video),
            forceRebind:
              mergedSubtitleHealth.derived.shouldForceSecondaryRebind,
            note: "sync interval handles execution",
          });
        }
      }

      // current sequence block が取れない場合でも current UI 更新用の fallback block を作る。
      const currentBlock = getCurrentSubtitleBlockFromSequence(blockResult) || {
        startTime: pCue?.startTime ?? null,
        endTime: pCue?.endTime ?? null,
        primaryText: pText || "",
        secondaryText: sText || "",
        hasPrimarySignal: Boolean(pText),
        hasSecondarySignal: Boolean(sText),
        sourceReason: "onPrimaryCueChange:fallback",
        updatedAt: Date.now(),
      };

      // nearby rebuild 保護を使うかどうかを現在の guard / seek window から判定する。
      const preserveNearbyCurrent = shouldPreserveNearbyRebuildCurrentBlock();

      // nearby rebuild 直後の hold view を current UI 保護用に参照する。
      const holdView = state.nearbyRebuildHoldView || null;

      // panel / overlay 共通 view を sequence から解決する。
      const overlaySequence = getSubtitleBlockSequence();
      const subtitleViewResolver = root.subtitleViewResolver || null;
      const subtitleView =
        subtitleViewResolver &&
        typeof subtitleViewResolver.resolveUiSubtitleView === "function"
          ? subtitleViewResolver.resolveUiSubtitleView(
              overlaySequence?.blocks,
              overlaySequence?.currentIndex,
              overlaySequence?.meta,
            )
          : null;

      // current subtitleView が空に近い場合だけ hold view を優先して UI 空白を避ける。
      const shouldUseHoldView =
        preserveNearbyCurrent &&
        holdView &&
        (!subtitleView ||
          (!subtitleView.currentBlock?.hasPrimarySignal &&
            !subtitleView.currentBlock?.hasSecondarySignal));

      if (shouldUseHoldView) {
        logContent("current subtitle view hold used", {
          reason: "onPrimaryCueChange:preserveNearbyRebuildHold",
          source: "nearbyRebuild",
          sourceReason: holdView.currentBlock?.sourceReason ?? null,
          guardActive: Boolean(
            nearbyRebuildGuard?.consumeOnNextPrimaryCueChange,
          ),
          withinSeekWindow: isWithinNearbyRebuildSeekWindow(),
          startTime: holdView.currentBlock?.startTime ?? null,
          endTime: holdView.currentBlock?.endTime ?? null,
          hasPrimarySignal: Boolean(holdView.currentBlock?.hasPrimarySignal),
          hasSecondarySignal: Boolean(
            holdView.currentBlock?.hasSecondarySignal,
          ),
        });
        consumeNearbyRebuildGuard();
      } else {
        clearNearbyRebuildGuard();
        setCurrentSubtitleBlock(currentBlock, "onPrimaryCueChange");
        logContent("current subtitle block updated", {
          reason: "onPrimaryCueChange",
          source: "primaryCueChange",
          sourceReason: currentBlock?.sourceReason ?? null,
          guardActive: Boolean(
            nearbyRebuildGuard?.consumeOnNextPrimaryCueChange,
          ),
          withinSeekWindow: isWithinNearbyRebuildSeekWindow(),
          startTime: currentBlock?.startTime ?? null,
          endTime: currentBlock?.endTime ?? null,
          hasPrimarySignal: Boolean(currentBlock?.hasPrimarySignal),
          hasSecondarySignal: Boolean(currentBlock?.hasSecondarySignal),
        });
      }

      if (shouldUseHoldView) {
        state.currentSubtitleView = holdView;
        updateOverlayFromView(holdView);
      } else if (subtitleView) {
        state.currentSubtitleView = subtitleView;
        updateOverlayFromView(subtitleView);
      } else {
        updateOverlayFromBlock(currentBlock);
      }

      if (secondaryTrack) {
        renderSecondarySubtitle(sText, secondaryTrack);
      }

      renderPanel();
    }

    return {
      getBoundSecondaryTrack,
      unbindSecondarySubtitleTrack,
      bindSecondarySubtitleTrack,
      syncSecondarySubtitleTrack,
      onCueChange,
      onPrimaryCueChange,
      getMergedSubtitleHealth: () => lastMergedSubtitleHealth,
      getLaneStates: () => laneStates,
      resetSecondaryRecoveryLane,
      evaluateSecondaryRecovery,
    };
  }

  // cue controller factory を ATVB 名前空間へ公開する。
  root.cueController = {
    createCueController,
  };
})();