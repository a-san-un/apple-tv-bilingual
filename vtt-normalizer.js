// =============================================================
// Apple TV+ Bilingual Subtitles - vtt-normalizer.js
// version: 2.6.0
// 役割: 字幕テキスト整形と cue 正規化の純関数群を担当する。
// Phase A: content.js から VTT 正規化責務を切り出して window.ATVB.vtt で公開する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  // 秒数をパネル表示向けの時刻文字列へ整形する。
  function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // WebVTT 由来のタグや実体参照を表示用テキストへ正規化する。
  function normalizeSubtitleText(raw) {
    return String(raw || "")
      .replace(/\r\n?/g, "\n")
      .replace(/<c(\.[^>]+)?>/g, "")
      .replace(/<\/c>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  // cue から表示テキストを取り出して正規化する。
  function cleanCueText(cue) {
    if (!cue) return "";
    if (cue.getCueAsHTML) {
      return normalizeSubtitleText(cue.getCueAsHTML().textContent || "");
    }
    return normalizeSubtitleText(cue.text || "");
  }

  window.ATVB.vtt = {
    formatTime,
    normalizeSubtitleText,
    cleanCueText,
  };
})();
