// =============================================================
// Apple TV+ Bilingual Subtitles - secondary-subtitle-dom.js
// version: 1.0.0
// Issue #32 Round 11: content.js の Section 3 から secondary subtitle DOM を分離
//
// Role（責務）
// - secondary subtitle 用 DOM ノードの ensure / render / clear のみを担当する
// - panel shell 本体（panel-ui.js）/ overlay / history / current-truth は持たない
// - subtitle truth（今どの track / cue が正しいか）は一切保持しない。
//   呼び出し側（content.js 経由の cue-controller.js / sync-interval-orchestrator.js）
//   から text / track / reason を渡してもらい、DOM に反映するだけの薄い module。
//
// API（既存呼び出し互換のため positional 引数を採用）
// - ensure()                    : secondary subtitle 用 DOM ノードを確保して返す
// - render(text, track, reason) : cue text を DOM に描画する（idle clear の保持判定を含む）
//                                 reason は省略可能（ログ用途のみ）
// - clear(reason)                : secondary subtitle DOM を明示的にクリアする
//                                 reason は省略可能（ログ用途のみ）
// - cleanup()                    : 重複ノードなどの後始末整理（destroy ではない）
// =============================================================

(function () {
  'use strict';

  const root = window.ATVB || (window.ATVB = {});

  function createSecondarySubtitleDom(deps) {
    const {
      getTarget,
      isSecondaryDomReady = () => true,
      getTrackActiveCuesLength,
      getCurrentCueText,
      normalizeSubtitleText,
      logContentSubtitle = () => {},
      isDebugEnabled = () => false,
      idleClearMs = 3200,
      panelSlotLayerStyleId = 'atv-panel-slot-layer-style',
    } = deps || {};

    // --- DOM module 内部だけで使う「表示保持」用の状態 ---
    // これは subtitle truth ではなく、あくまで「直前に描画した文字列を
    // どこまで保持するか」という UI 表示上のグレースだけを管理する。
    let lastSecondaryText = '';
    let lastSecondaryTextAt = 0;
    let lastSecondarySignalAt = 0;

    // ------------------------------------------------------
    // ログ payload 生成（デバッグ用）
    // ------------------------------------------------------
    function buildRenderLogPayload(text, track, elementCount) {
      return {
        textPreview: String(text || '').slice(0, 40),
        trackLanguage: track?.language || null,
        activeCuesLength: getTrackActiveCuesLength ? getTrackActiveCuesLength(track) : null,
        secondaryElementCount: elementCount,
      };
    }

    // ------------------------------------------------------
    // DOM ノード取得系
    // ------------------------------------------------------
    function getSecondarySubtitleElements() {
      return document.querySelectorAll(
        '[data-secondary-subtitle], .dual-subtitles-secondary'
      );
    }

    function countSecondarySubtitleElements() {
      return getSecondarySubtitleElements().length;
    }

    function normalizeSecondarySubtitleElement(el) {
      if (!el) return null;
      if (!el.hasAttribute('data-secondary-subtitle')) {
        el.setAttribute('data-secondary-subtitle', '');
      }
      if (!el.classList.contains('dual-subtitles-secondary')) {
        el.classList.add('dual-subtitles-secondary');
      }
      return el;
    }

    function getOrCreatePanelHost() {
      const target = getTarget?.();
      if (!target) return null;

      const panelHost = target.querySelector('#atv-panel-host');
      return panelHost || null;
    }

    function findSecondarySubtitlePanel(panelHost) {
      let panel = document.querySelector('[data-dual-subtitles-panel]');
      if (!panel) panel = document.querySelector('.dual-subtitles-panel');
      if (!panel && panelHost?.shadowRoot) {
        panel = panelHost.shadowRoot.querySelector(
          '[data-dual-subtitles-panel], .dual-subtitles-panel'
        );
      }
      if (panel && panelHost?.shadowRoot?.contains(panel)) {
        panel.setAttribute('data-dual-subtitles-panel', '');
        panel.classList.add('dual-subtitles-panel');
      }
      return panel || null;
    }

    // ------------------------------------------------------
    // hidden layer style（Apple 標準字幕 UI と衝突しないための非表示スタイル）
    // ------------------------------------------------------
    function ensurePanelSlotLayerStyle() {
      if (document.getElementById(panelSlotLayerStyleId)) return;
      const style = document.createElement('style');
      style.id = panelSlotLayerStyleId;
      style.textContent = `
        #atv-panel-host .dual-subtitles-secondary,
        #atv-panel-host [data-secondary-subtitle] {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    // ------------------------------------------------------
    // ensure: secondary subtitle 用 DOM ノードを確保する
    // ------------------------------------------------------
    function ensure() {
      if (!isSecondaryDomReady()) return null;

      ensurePanelSlotLayerStyle();

      const allExisting = getSecondarySubtitleElements();

      if (allExisting.length > 1) {
        const keep = normalizeSecondarySubtitleElement(allExisting[0]);
        for (let i = 1; i < allExisting.length; i++) {
          allExisting[i].remove();
        }
        if (isDebugEnabled()) {
          logContentSubtitle('secondary-dom duplicate elements cleaned', {
            textPreview: keep.textContent || '',
            existingElementCount: allExisting.length,
          });
        }
        return keep;
      }

      if (allExisting.length === 1) {
        return normalizeSecondarySubtitleElement(allExisting[0]);
      }

      const panelHost = getOrCreatePanelHost();
      if (!panelHost) {
        if (isDebugEnabled()) {
          logContentSubtitle('secondary element ensure skipped: panel host missing', {});
        }
        return null;
      }

      const ensuredAfterPanel = panelHost.querySelector('[data-secondary-subtitle]');
      if (ensuredAfterPanel) {
        return normalizeSecondarySubtitleElement(ensuredAfterPanel);
      }

      findSecondarySubtitlePanel(panelHost);

      const el = document.createElement('div');
      el.setAttribute('data-secondary-subtitle', '');
      el.className = 'dual-subtitles-secondary';
      el.slot = 'secondary-subtitle-slot';
      panelHost.appendChild(el);

      if (isDebugEnabled()) {
        logContentSubtitle('secondary element ensured', {});
      }
      return el;
    }

    // ------------------------------------------------------
    // render: cue text を DOM に反映する（idle clear の保持判定込み）
    // reason 例: 'attach' | 'rebind' | 'large-seek' | 'onPrimaryCueChange' |
    //           'onCueChange' | 'nearbyRebuild' | 'syncSecondarySubtitleTrack'
    // reason は省略可能（未指定時は 'unspecified'）
    // ------------------------------------------------------
    function render(text, track, reason = 'unspecified') {
      let el = ensure();
      if (!el) return;

      const elementCountBefore = countSecondarySubtitleElements();
      if (elementCountBefore > 1) {
        if (isDebugEnabled()) {
          logContentSubtitle(
            'secondary duplicate elements cleaned',
            buildRenderLogPayload(text, track, elementCountBefore)
          );
        }
        el = ensure();
      }
      if (!el) return;

      const activeCuesLength = getTrackActiveCuesLength ? getTrackActiveCuesLength(track) : 0;
      let resolvedText = text;
      if (!resolvedText && activeCuesLength > 0 && getCurrentCueText) {
        resolvedText = getCurrentCueText(track);
      }
      resolvedText = normalizeSubtitleText ? normalizeSubtitleText(resolvedText) : resolvedText;

      const now = Date.now();
      if (activeCuesLength > 0 && resolvedText) {
        lastSecondarySignalAt = now;
      }

      let finalText = resolvedText;
      const willRetainPreviousText =
        !finalText &&
        !!lastSecondaryText &&
        lastSecondarySignalAt > 0 &&
        now - lastSecondarySignalAt < idleClearMs;

      if (finalText) {
        lastSecondaryText = finalText;
        lastSecondaryTextAt = now;
      } else if (willRetainPreviousText) {
        finalText = lastSecondaryText;
        if (isDebugEnabled()) {
          logContentSubtitle(
            'secondary subtitle retained until next cue or idle clear',
            { ...buildRenderLogPayload(finalText, track, countSecondarySubtitleElements()), reason }
          );
        }
      } else if (!finalText && lastSecondarySignalAt > 0 && now - lastSecondarySignalAt >= idleClearMs) {
        if (el.textContent && isDebugEnabled()) {
          logContentSubtitle('secondary subtitle cleared after idle timeout', {
            ...buildRenderLogPayload('', track, countSecondarySubtitleElements()),
            reason,
          });
        }
        lastSecondaryText = '';
        lastSecondaryTextAt = 0;
        lastSecondarySignalAt = 0;
      }

      if (isDebugEnabled()) {
        logContentSubtitle('secondary-dom render', {
          ...buildRenderLogPayload(finalText, track, countSecondarySubtitleElements()),
          reason,
        });
      }

      el.textContent = finalText || '';
      el.dataset.language = track?.language || '';
    }

    // ------------------------------------------------------
    // clear: 明示的にクリアする（idle clear とは別の即時クリア用）
    // reason は省略可能（未指定時は 'unspecified'）
    // ------------------------------------------------------
    function clear(reason = 'unspecified') {
      const el = ensure();
      if (!el) return;
      if (isDebugEnabled()) {
        logContentSubtitle('secondary-dom explicit clear', { reason });
      }
      el.textContent = '';
      lastSecondaryText = '';
      lastSecondaryTextAt = 0;
      lastSecondarySignalAt = 0;
    }

    // ------------------------------------------------------
    // cleanup: 重複ノードの整理のみ（destroy はしない）
    // ------------------------------------------------------
    function cleanup() {
      const allExisting = getSecondarySubtitleElements();
      if (allExisting.length <= 1) return;
      for (let i = 1; i < allExisting.length; i++) {
        allExisting[i].remove();
      }
    }

    return { ensure, render, clear, cleanup };
  }

  root.createSecondarySubtitleDom = createSecondarySubtitleDom;
})();