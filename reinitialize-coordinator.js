// =============================================================
// Apple TV+ Bilingual Subtitles - reinitialize-coordinator.js
// version: 2.7.0
//
// 役割:
// - subtitle pipeline rebuild request の reason 分類と要求発行を coordinator としてまとめる。
// - content.js / sync interval / panel reopen など複数入口からの rebuild 要求を
//   共通 reason / option 形式へ正規化し、settings reload 要否を含めて扱う。
// - settings reload が必要なケースと、すでに state に反映済み設定を使って
//   再評価だけ進めたいケースを options で切り替える。
// - video object 変更 / currentSrc 変更のような video-change 系 reason では、
//   stale な playback を再利用しないよう current playback を取り直してから進める。
// - UI teardown や startup readiness wait そのものは担当せず、
//   rebuild request の分類・再評価要求・retry 制御に限定する。
//
// 設計メモ:
// - cleanup owner の teardown 責務や startup coordinator の readiness wait は侵食しない。
// - reloadSettingsAndReinitialize() は文字列 reason と options object の両方を受け、
//   既存 call site 互換を保ちつつ reason / option 正規化と video-change 経路の suppressSettingsReload を扱える。
// =============================================================

(function () {
  "use strict";

  /**
   * subtitle pipeline rebuild request coordinator を生成する。
   * settings reload 要否の判定、reason / option の正規化、
   * current playback の再取得、retry 制御をまとめて提供する。
   *
   * @param {Object} deps coordinator 依存関係。
   * @param {Object} deps.state content runtime state。
   * @param {Object} deps.panelUi panel UI 制御 API。
   * @param {(reason?: string) => Promise<Object>} deps.loadSettingsSnapshot
   *   保存済み設定 snapshot を取得する関数。
   * @param {() => ({ video: HTMLVideoElement, dialog: Element | null } | null)}
   *   deps.getVideoAndDialog 現在の playback target を返す関数。
   * @param {(video: HTMLVideoElement | null) => string} deps.getCurrentVideoSrcKey
   *   video から currentSrc 識別子を作る関数。
   * @param {(reason?: string) => boolean} deps.syncHistoryContextWithPlayback
   *   current playback と history context を同期する関数。
   * @param {(options?: Object) => void} deps.clearInternalSubtitleState
   *   subtitle runtime state を内部的に初期化する関数。
   * @param {(
   *   video: HTMLVideoElement | null,
   *   primaryLang: string,
   *   secondaryLang: string,
   *   reason?: string,
   * ) => Promise<{
   *   primaryTrackFound: boolean,
   *   secondaryTrackFound: boolean,
   *   primaryListenerBound: boolean,
   *   secondaryListenerBound: boolean,
   *   trackCount: number,
   *   primaryTrack: *,
   *   secondaryTrack: *,
   * }>} deps.selectPrimaryAndSecondaryTracks
   *   primary / secondary track を再選択し、listener を接続する関数。
   * @param {number[]} deps.TRACK_RESOLVE_RETRY_DELAYS_MS retry delay 一覧。
   * @param {(message: string, payload?: Object) => void} [deps.logContent]
   *   汎用 content log。
   * @param {(message: string, payload?: Object) => void} [deps.logContentSubtitle]
   *   subtitle 系 log。
   * @param {(message: string, payload?: Object) => void} [deps.logContentError]
   *   error 系 log。
   * @returns {{
   *   clearTrackResolveRetryTimers: () => void,
   *   reinitializeSubtitlePipeline: (reason?: string) => Promise<Object>,
   *   reloadSettingsAndReinitialize: (input?: string | Object) => void,
   * }} public API。
   */
  function createReinitializeCoordinator(deps) {
    const {
      state,
      panelUi,
      loadSettingsSnapshot,
      getVideoAndDialog,
      getCurrentVideoSrcKey,
      syncHistoryContextWithPlayback,
      clearInternalSubtitleState,
      selectPrimaryAndSecondaryTracks,
      TRACK_RESOLVE_RETRY_DELAYS_MS,
      logContent,
      logContentSubtitle,
      logContentError,
    } = deps;

    // -----------------------------------------------------------------------------
    // Retry timer ownership
    // track resolve retry timer の所有者はこの coordinator。
    // detach / restart 側からも cleanup できるよう public API に出す。
    // -----------------------------------------------------------------------------

    /**
     * track resolve retry timer をすべて解除する。
     * coordinator が所有している retry timer の後始末だけを担当する。
     *
     * @returns {void}
     */
    function clearTrackResolveRetryTimers() {
      if (!state.trackResolveRetryTimers.length) return;
      state.trackResolveRetryTimers.forEach((timerId) => clearTimeout(timerId));
      state.trackResolveRetryTimers = [];
    }

    // -----------------------------------------------------------------------------
    // Reason / option normalization
    // 文字列 reason と options object の両方を受ける入口を正規化し、
    // video-change 判定や settings reload 要否を 1 箇所で揃える。
    // -----------------------------------------------------------------------------

    /**
     * 渡された reason / options を正規化する。
     *
     * 受け付ける形:
     * - "panel_reopen"
     * - { reason: "current_src_changed", suppressSettingsReload: true }
     *
     * @param {string|Object} [input="unknown"] reinitialize 実行入力。
     * @returns {{
     *   reason: string,
     *   suppressSettingsReload: boolean,
     *   isVideoChange: boolean,
     * }} 正規化済み options。
     */
    function normalizeReinitializeOptions(input = "unknown") {
      if (typeof input === "string") {
        return {
          reason: input,
          suppressSettingsReload: false,
          isVideoChange: input === "video_changed",
        };
      }

      const reason =
        typeof input?.reason === "string" && input.reason
          ? input.reason
          : "unknown";

      return {
        reason,
        suppressSettingsReload: Boolean(input?.suppressSettingsReload),
        isVideoChange:
          input?.isVideoChange === true ||
          reason === "video_changed" ||
          reason === "current_src_changed" ||
          reason === "video_object_changed",
      };
    }

    /**
     * 正規化済み reason を使って、現在の state / playback に対する
     * subtitle pipeline の再評価を実行する。
     *
     * reloadSettingsAndReinitialize() などの上位入口から呼ばれ、
     * track 再解決・listener 再接続・panel state 再適用と、
     * その結果に応じた retry 判定材料の生成を担う。
     *
     * @param {string} [reason="unknown"] 正規化済み rebuild reason。
     * @returns {Promise<{
     *   reason: string,
     *   primaryTrackFound: boolean,
     *   secondaryTrackFound: boolean,
     *   primaryListenerBound: boolean,
     *   secondaryListenerBound: boolean,
     *   ready: boolean,
     * }>} 現在の playback に対する再評価結果。
     */
    async function reinitializeSubtitlePipeline(reason = "unknown") {
      const switched = syncHistoryContextWithPlayback(reason);
      clearInternalSubtitleState({
        reason,
        preserveSecondaryDom: true,
      });

      const effectiveSecondaryLanguage =
        state.requestedSecondaryLang || state.contentSettings.secondaryLang;

      const trackSelection = await selectPrimaryAndSecondaryTracks(
        state.video,
        state.contentSettings.primaryLang,
        effectiveSecondaryLanguage,
        reason,
      );

      const primaryTrackFound = trackSelection.primaryTrackFound;
      const secondaryTrackFound = trackSelection.secondaryTrackFound;
      const primaryListenerBound = trackSelection.primaryListenerBound;
      const secondaryListenerBound = trackSelection.secondaryListenerBound;

      logContentSubtitle?.("tracks resolved", {
        reason,
        switchedHistoryContext: switched,
        primaryTrackFound,
        secondaryTrackFound,
        trackCount: trackSelection.trackCount,
        primaryTrack: trackSelection.primaryTrack,
        secondaryTrack: trackSelection.secondaryTrack,
      });

      logContentSubtitle?.("cuechange listeners rebound", {
        reason,
        primaryListenerBound,
        secondaryTrackBound: secondaryListenerBound,
      });

      // panel 反映も coordinator から起動するが、
      // 実 UI 更新の詳細は panelUi 側に残す。
      panelUi.applyPanelState(reason);

      logContent?.("panel state reapplied", {
        reason,
        contentKey: state.currentContentKey,
        panelOpen: state.panelOpen,
      });

      return {
        reason,
        primaryTrackFound,
        secondaryTrackFound,
        primaryListenerBound,
        secondaryListenerBound,
        ready:
          primaryTrackFound &&
          secondaryTrackFound &&
          primaryListenerBound &&
          secondaryListenerBound,
      };
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Entry Points
    // 現在の playback context を取り直し、coordinator 本体へ渡すための入口。
    // video / dialog 更新だけを担当し、再初期化ルール自体は持たない。
    // -----------------------------------------------------------------------------

    /**
     * 再初期化前に current playback target を取り直し、state を更新する。
     *
     * @returns {boolean} 再初期化可能な video を持てたとき true。
     */
    function refreshPlaybackContextForReinitialize() {
      const found = getVideoAndDialog();

      if (found) {
        state.video = found.video;
        state.dialogEl = found.dialog;
      }

      if (!state.video) return false;

      state.lastVideoSrcKey = getCurrentVideoSrcKey(state.video);
      return true;
    }

    /**
     * current playback を再取得してから subtitle pipeline 再初期化を実行する。
     *
     * @param {string} [reason="unknown"] 再初期化 reason。
     * @returns {Promise<Object|null>} 再初期化結果。video が無ければ null。
     */
    async function runReinitializeFromCurrentPlayback(reason = "unknown") {
      if (!refreshPlaybackContextForReinitialize()) return null;
      return await reinitializeSubtitlePipeline(reason);
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Retry Control
    // video-change 系 reason 後に track 解決が遅れるケースを対象に、
    // retry 間隔とタイマーのライフサイクルを管理する。
    // retry 条件の判定本体は持ち込まず、再試行の orchestration に限定する。
    // -----------------------------------------------------------------------------

    /**
     * video-change 系再初期化の retry を予約する。
     * 各試行では current playback を取り直してから再初期化する。
     *
     * @param {string} [reason="video_changed"] retry の親 reason。
     * @returns {void}
     */
    async function scheduleTrackResolveRetry(reason = "video_changed") {
      clearTrackResolveRetryTimers();

      logContentSubtitle?.("track resolve retry scheduled", {
        reason,
        retryDelaysMs: TRACK_RESOLVE_RETRY_DELAYS_MS,
      });

      TRACK_RESOLVE_RETRY_DELAYS_MS.forEach((delayMs, retryIndex) => {
        const timerId = window.setTimeout(async () => {
          if (state.sessionRebuildInProgress || !state.video) return;

          const attempt = retryIndex + 1;

          logContentSubtitle?.("track resolve retry attempt", {
            reason,
            attempt,
            delayMs,
          });

          const retryResult = await runReinitializeFromCurrentPlayback(
            `${reason}:retry_${attempt}`,
          );

          if (!retryResult) return;

          if (retryResult.ready) {
            logContentSubtitle?.("track resolve retry success", {
              reason,
              attempt,
            });
            clearTrackResolveRetryTimers();
            return;
          }

          if (attempt === TRACK_RESOLVE_RETRY_DELAYS_MS.length) {
            logContentError?.("track resolve retry exhausted", {
              reason,
              attempts: TRACK_RESOLVE_RETRY_DELAYS_MS.length,
              primaryTrackFound: retryResult.primaryTrackFound,
              secondaryTrackFound: retryResult.secondaryTrackFound,
              primaryListenerBound: retryResult.primaryListenerBound,
              secondaryListenerBound: retryResult.secondaryListenerBound,
            });
            clearTrackResolveRetryTimers();
          }
        }, delayMs);

        state.trackResolveRetryTimers.push(timerId);
      });
    }

    // -----------------------------------------------------------------------------
    // Subtitle Pipeline: Settings & Result Bridge
    // settings snapshot の state 反映と、再初期化結果の後処理を橋渡しする。
    // content.js に残すのはイベント入口で、reload → reflect → reinitialize の
    // 手順はこの coordinator に寄せる。
    // -----------------------------------------------------------------------------

    /**
     * video-change 系再初期化の結果に応じて retry を制御する。
     *
     * @param {Object|null} result 再初期化結果。
     * @param {string} [reason="video_changed"] 親 reason。
     * @returns {void}
     */
    function applyVideoChangedReinitializeResult(
      result,
      reason = "video_changed",
    ) {
      if (!result) return;

      if (result.ready) {
        clearTrackResolveRetryTimers();
        return;
      }

      scheduleTrackResolveRetry(reason);
    }

    /**
     * 再初期化結果の後処理を行う。
     * 現在は video-change 系 reason の retry 制御だけを担当する。
     *
     * @param {Object|null} result 再初期化結果。
     * @param {Object} [options={}] 判定オプション。
     * @param {string} [options.reason="unknown"] 実行 reason。
     * @param {boolean} [options.isVideoChange=false] video-change 系かどうか。
     * @returns {void}
     */
    function applyReinitializeResult(
      result,
      { reason = "unknown", isVideoChange = false } = {},
    ) {
      if (!isVideoChange) return;
      applyVideoChangedReinitializeResult(result, reason);
    }

    /**
     * settings 読込結果を state へ反映するだけの薄い bridge。
     * requested settings と effective settings を coordinator 側から同期する。
     *
     * @param {Object} snapshot settings snapshot。
     * @returns {void}
     */
    function applySettingsSnapshotToState(snapshot) {
      state.requestedContentSettings = {
        ...(snapshot.storedSettings || {}),
      };
      state.requestedSecondaryLang = snapshot.requestedSecondaryLang || "";
      state.contentSettings = { ...snapshot.effectiveSettings };
    }

    /**
     * rebuild reason を正規化し、必要なら settings を再読込してから
     * 現在の playback に対する再評価 / 再接続経路を進める。
     *
     * @param {string|Object} [input="unknown"]
     * @returns {void}
     */
    function reloadSettingsAndReinitialize(input = "unknown") {
      if (state.sessionRebuildInProgress) return;

      const {
        reason,
        suppressSettingsReload,
        isVideoChange,
      } = normalizeReinitializeOptions(input);

      const run = async () => {
        if (!suppressSettingsReload) {
          const snapshot = await loadSettingsSnapshot(reason);
          applySettingsSnapshotToState(snapshot);
        }

        const result = await runReinitializeFromCurrentPlayback(reason);
        applyReinitializeResult(result, {
          reason,
          isVideoChange,
        });
      };

      run().catch((error) => {
        logContentError?.("settings load or reinitialize failed", {
          reason,
          suppressSettingsReload,
          isVideoChange,
          error: String(error),
        });
      });
    }

    // -----------------------------------------------------------------------------
    // エクスポート
    // -----------------------------------------------------------------------------

    return {
      clearTrackResolveRetryTimers,
      reinitializeSubtitlePipeline,
      reloadSettingsAndReinitialize,
    };
  }

  window.ATVB = window.ATVB || {};
  window.ATVB.createReinitializeCoordinator = createReinitializeCoordinator;
})();
