// =============================================================
// Apple TV+ Bilingual Subtitles - modules/subtitle-state-reset.js
//
// 役割:
// - 字幕の一時 state（テキスト・タイムスタンプ・block/panel snapshot）の
//   リセットを担当する。
// - reason 文字列ではなく options オブジェクトで振る舞いを制御する。
// - 通常の subtitle clear と、拡張 ON/OFF トグル時の完全リセットを分け、
//   古い字幕参照を次回セッションへ持ち越さないようにする。
// - block runtime mirror / panel render snapshot の reset は内部 helper に分離し、
//   owner API 置換前でも reset 責務の境界を追いやすくする。
// - panel host / popup host / toggle button / observer の teardown は
//   panel-ui.dispose() が担当し、このモジュールは subtitle state reset に専念する。
//
// clearSubtitleState(options):
//   options.preserveSecondaryDom  = true  → パネルの secondary DOM は保持する
//                                 = false → パネルの secondary テキストも消去する
//
// resetSubtitleStateForToggle(options):
//   拡張 OFF / restart 前に字幕関連 state をまとめて初期化する。
//   トグル相関ログ用の toggleOpId を受け取り、何を解放したかを追跡できるようにする。
// =============================================================
(() => {
  "use strict";

  const root = (window.ATVB = window.ATVB || {});

  // subtitle state reset 用 API を生成するファクトリ。
  // 通常 clear とトグル完全リセットの両方を同じ責務境界で扱えるようにする。
  function createSubtitleStateReset({ state, secondarySubtitleDom, logContent }) {
    // -------------------------------------------------------
    // 内部 helper
    // -------------------------------------------------------

    // ログ用に、字幕関連 state の保持状況を軽量スナップショット化する。
    // complete reset の前後で比較しやすいように boolean / 件数中心で返す。
    function buildSubtitleStateSnapshot() {
      return {
        hasLastPrimaryText: Boolean(state.lastPrimaryText),
        hasLastSecondaryText: Boolean(state.lastSecondaryText),
        lastPrimarySnapshotAt: state.lastPrimarySnapshotAt || 0,
        lastSecondaryTextAt: state.lastSecondaryTextAt || 0,
        lastSecondarySignalAt: state.lastSecondarySignalAt || 0,
        subtitleHistoryCount: Array.isArray(state.subtitleHistory)
          ? state.subtitleHistory.length
          : 0,
        subtitleBlocksCount: Array.isArray(state.subtitleBlocks)
          ? state.subtitleBlocks.length
          : 0,
        panelPastBlocksCount: Array.isArray(state.panelPastBlocks)
          ? state.panelPastBlocks.length
          : 0,
        subtitleCurrentIndex: Number.isFinite(state.subtitleCurrentIndex)
          ? state.subtitleCurrentIndex
          : -1,
        hasCurrentSubtitleBlock: Boolean(state.currentSubtitleBlock),
        hasSubtitleBlockMeta: Boolean(state.subtitleBlockMeta),
        hasLastPanelRenderSnapshot: Boolean(state.lastPanelRenderSnapshot),
        hasAfterRenderSecondarySnapshotSignature: Boolean(
          state.lastAfterRenderSecondarySnapshotSignature
        ),
        lastCurrentSubtitleBlockAt: state.lastCurrentSubtitleBlockAt || 0,
        lastObservedVideoTime:
          typeof state.lastObservedVideoTime === "number"
            ? state.lastObservedVideoTime
            : null,
        lastLargeSeekAt: state.lastLargeSeekAt || 0,
      };
    }

    // テキスト / timestamp 系の軽量 state を初期化する。
    // 通常 clear と complete reset で共通利用するため、共通 helper に分ける。
    function resetSubtitleTextState() {
      state.lastSecondaryText = "";
      state.lastSecondaryTextAt = 0;
      state.lastSecondarySignalAt = 0;
      state.lastPrimaryText = "";
      state.lastPrimarySnapshotAt = 0;
    }

    // block sequence owner 正本ではなく、
    // reset module から見える current block mirror だけを初期化する。
    // owner API へ移行する前でも runtime mirror reset の責務を分離しておく。
    function resetSubtitleBlockRuntimeMirrorState() {
      state.currentSubtitleBlock = null;
      state.lastCurrentSubtitleBlockAt = 0;
    }

    // panel UI owner が持つ描画アーティファクト本体ではなく、
    // subtitle state reset 側で触る snapshot 参照だけを初期化する。
    // 将来 panel owner API へ差し替えるための中継 helper として置いている。
    function resetPanelRenderSnapshotState() {
      state.lastPanelRenderSnapshot = null;
    }

    // block 配列 / panel past blocks / current index / meta と、
    // panel render snapshot・block runtime mirror・seek 観測系 state をまとめて初期化する。
    // complete reset の責務はここに残しつつ、snapshot / mirror の個別 reset は helper に委譲する。
    // これにより、次回 session で古い block 系参照に基づく debug / render 判定を持ち越さない。
    function resetSubtitleBlockState() {
      state.subtitleHistory = [];
      state.panelPastBlocks = [];
      state.subtitleBlocks = [];
      state.subtitleCurrentIndex = -1;
      state.subtitleBlockMeta = null;

      resetPanelRenderSnapshotState();
      resetSubtitleBlockRuntimeMirrorState();

      state.lastAfterRenderSecondarySnapshotSignature = "";
      state.lastObservedVideoTime = null;
      state.lastLargeSeekAt = 0;
    }


    // -------------------------------------------------------
    // 通常 clear
    // -------------------------------------------------------

    // 字幕表示に関する軽量 state をクリアする。
    // secondary DOM を消すかどうかは preserveSecondaryDom で切り替える。
    function clearSubtitleState(options = {}) {
      const preserveSecondaryDom =
        typeof options.preserveSecondaryDom === "boolean"
          ? options.preserveSecondaryDom
          : false;

      resetSubtitleTextState();

      if (!preserveSecondaryDom) {
        secondarySubtitleDom.clearPanelSecondaryText();
      }

      logContent?.("subtitle state cleared", {
        preserveSecondaryDom,
        contentKey: state.currentContentKey,
      });
    }

    // -------------------------------------------------------
    // トグル完全リセット
    // -------------------------------------------------------

    // 拡張 ON/OFF トグルや restart 前に、字幕関連 state をまとめて初期化する。
    // 古い text / block / panel snapshot / seek 観測値を完全に断ち切り、
    // 次回の再取得で前セッション由来の参照を使わないようにする。
    function resetSubtitleStateForToggle(options = {}) {
      const preserveSecondaryDom =
        typeof options.preserveSecondaryDom === "boolean"
          ? options.preserveSecondaryDom
          : false;
      const toggleOpId =
        typeof options.toggleOpId === "string" && options.toggleOpId
          ? options.toggleOpId
          : null;
      const reason =
        typeof options.reason === "string" && options.reason
          ? options.reason
          : "toggle_reset";

      const before = buildSubtitleStateSnapshot();

      resetSubtitleTextState();
      resetSubtitleBlockState();

      if (!preserveSecondaryDom) {
        secondarySubtitleDom.clearPanelSecondaryText();
      }

      const after = buildSubtitleStateSnapshot();

      logContent?.("subtitle state fully reset for toggle", {
        toggleOpId,
        reason,
        preserveSecondaryDom,
        contentKey: state.currentContentKey,
        before,
        after,
      });
    }

    // -------------------------------------------------------
    // エクスポート
    // -------------------------------------------------------
    return {
      clearSubtitleState,
      resetSubtitleStateForToggle,
    };
  }

  // -------------------------------------------------------
  // エクスポート
  // -------------------------------------------------------
  root.createSubtitleStateReset = createSubtitleStateReset;
})();
