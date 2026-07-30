// =============================================================
// Apple TV+ Bilingual Subtitles - initial-cue-recovery.js
// version: 1.0.0
// Issue #32 Round 11: large-seek 直後の secondary 復帰を1回 dispatch する共通 entry
//
// Round 11 スコープ注記（重要）
// - attach 直後の cue recovery は content.js の scheduleInitialCueRecovery /
//   scheduleInitialCueRecoveryRetries / bindInitialCueRecoveryListeners /
//   tryCompleteInitialCueRecovery / runInitialCueRecoveryRender が
//   既に event-driven + retry で実装済みのため、本 module では対象としない。
// - rebind 直後の recovery は settings-runtime.js の restartBilingual 経路が
//   既に再初期化を行っているため、本 module では対象としない。
// - 本 module は "large-seek" 断面のみを対象にした薄い1回 dispatch entry とする。
//   attach / rebind の既存導線を本 module に統合するのは次ラウンド以降の課題。
//
// Role（責務）
// - large seek 直後に、既存の resolve → mode policy → bind → render
//   （cueController.syncSecondarySubtitleTrack）を1回だけ実行するトリガー
//
// 持たせない責務
// - missCount / termination 判定（periodic sync 側の責務）
// - 長い retry loop（sync-interval-orchestrator.js の責務）
// - history truth の更新本体
// - panel / overlay 独自の policy 決定
//
// API
// - dispatch(reason, { video, requestedSecondaryLang, cueController, forceRebind })
//   reason: 'large-seek'（本ラウンドではこの値のみを想定）
//   forceRebind は省略可能。省略時は reason === 'large-seek' で true になる。
// =============================================================

(function () {
  'use strict';

  const root = window.ATVB || (window.ATVB = {});

  function createInitialCueRecovery(deps) {
    const { logContentSubtitle = () => {} } = deps || {};

    function dispatch(reason, options = {}) {
      const { video, requestedSecondaryLang, cueController, forceRebind } = options;
      const effectiveForceRebind = forceRebind ?? reason === 'large-seek';

      if (!video || !cueController?.syncSecondarySubtitleTrack) {
        logContentSubtitle('initial-cue-recovery skipped', {
          reason,
          hasVideo: Boolean(video),
          hasSyncFn: typeof cueController?.syncSecondarySubtitleTrack === 'function',
        });
        return;
      }

      logContentSubtitle('initial-cue-recovery dispatch', {
        reason,
        forceRebind: effectiveForceRebind,
        requestedSecondaryLang: requestedSecondaryLang || null,
      });

      // 既存の resolve → mode policy → bind → render を1回だけ実行する。
      cueController.syncSecondarySubtitleTrack(video, requestedSecondaryLang, undefined, {
        forceRebind: effectiveForceRebind,
      });

      logContentSubtitle('initial-cue-recovery dispatch done', { reason });
    }

    return { dispatch };
  }

  root.createInitialCueRecovery = createInitialCueRecovery;
})();