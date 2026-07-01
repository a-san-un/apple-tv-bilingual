// =====================================================================
// content.js — Apple TV+ Bilingual Subtitles (v2.5)
// =====================================================================
// Responsibilities:
//   1. Bilingual subtitle overlay (right panel)
//   2. Word-click dictionary popup (3-section: header / meanings / examples)
//   3. Tatoeba example sentences with JP hover tooltip
//   4. In-example word click → re-search (no back button)
// =====================================================================

(function () {
  'use strict';

  if (window.__atvBilingualLoaded) return;
  window.__atvBilingualLoaded = true;

  // -------------------------------------------------------
  // Config
  // -------------------------------------------------------
  const CONFIG = {
    subtitleSelector: '.web-subtitle-player-subtitle',
    targetSelector:   'body',
    panelId:          'atv-bilingual-panel',
    popupHostId:      'atv-popup-host',
  };

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  let panelEl         = null;
  let panelOpen       = false;
  let popupShadowRoot = null;
  let subtitleObs     = null;

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  function getTarget() {
    return document.querySelector(CONFIG.targetSelector) ?? document.body;
  }

  function sendToBackground(msg, cb) {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('[ATV-Bilingual]', chrome.runtime.lastError.message);
        cb?.(null);
      } else {
        cb?.(res);
      }
    });
  }

  // -------------------------------------------------------
  // Panel
  // -------------------------------------------------------
  function createPanel() {
    if (document.getElementById(CONFIG.panelId)) return;

    panelEl = document.createElement('div');
    panelEl.id = CONFIG.panelId;
    panelEl.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'width:320px', 'height:100vh',
      'background:rgba(0,0,0,0.85)', 'color:#f0f0f0',
      'font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif',
      'font-size:14px', 'z-index:999998', 'display:flex', 'flex-direction:column',
      'transform:translateX(100%)', 'transition:transform 0.25s ease',
      'pointer-events:auto',
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.12);flex-shrink:0;';
    header.innerHTML = '<span style="font-weight:700;font-size:13px;">📺 字幕ログ</span>';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:16px;';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    header.appendChild(closeBtn);
    panelEl.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.id = 'atv-panel-content';
    content.style.cssText = 'flex:1;overflow-y:auto;padding:10px 14px;';
    panelEl.appendChild(content);

    getTarget().appendChild(panelEl);
  }

  function togglePanel() {
    if (!panelEl) createPanel();
    panelOpen = !panelOpen;
    panelEl.style.transform = panelOpen ? 'translateX(0)' : 'translateX(100%)';
  }

  function addSubtitleToPanel(text) {
    if (!panelEl) return;
    const content = panelEl.querySelector('#atv-panel-content');
    if (!content) return;
    const item = document.createElement('div');
    item.style.cssText = 'padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;line-height:1.5;';
    item.textContent = text;
    content.appendChild(item);
    content.scrollTop = content.scrollHeight;
  }

  // -------------------------------------------------------
  // Subtitle observer
  // -------------------------------------------------------
  function startSubtitleObserver() {
    if (subtitleObs) return;
    subtitleObs = new MutationObserver(() => {
      const els = document.querySelectorAll(CONFIG.subtitleSelector);
      els.forEach(el => {
        const text = el.textContent.trim();
        if (text) addSubtitleToPanel(text);
      });
    });
    subtitleObs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // -------------------------------------------------------
  // Popup — Shadow DOM host
  // -------------------------------------------------------
  function createPopupHost() {
    if (getTarget().querySelector('#atv-popup-host')) return;
    const host = document.createElement('div');
    host.id = 'atv-popup-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:999999;pointer-events:none;';
    getTarget().appendChild(host);

    popupShadowRoot = host.attachShadow({ mode: 'open' });
    popupShadowRoot.innerHTML = `
      <style>
        #popup {
          display: none; position: fixed; width: 340px;
          background: #1c1c1e; border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.8);
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px; color: #f0f0f0; pointer-events: auto; z-index: 999999;
        }

        /* ---- Header ---- */
        #popup-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 12px 14px 10px; background: rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        #popup-header-left { display: flex; flex-direction: column; gap: 4px; }
        #popup-word-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        #popup-word { font-size: 1.2rem; font-weight: 700; color: #ffe566; }
        .badge {
          display: inline-block; font-size: 10px; font-weight: 600;
          padding: 2px 7px; border-radius: 10px; letter-spacing: 0.03em;
        }
        .badge-common { background: rgba(80,200,120,0.2); color: #50c878; border: 1px solid rgba(80,200,120,0.3); }
        .badge-jlpt   { background: rgba(255,229,102,0.15); color: #ffe566; border: 1px solid rgba(255,229,102,0.3); }
        #popup-reading { color: #aaa; font-size: 12px; }
        #popup-close {
          background: none; border: none; color: rgba(255,255,255,0.5);
          cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; flex-shrink: 0;
        }
        #popup-close:hover { color: #fff; }

        /* ---- Tabs ---- */
        #popup-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .popup-tab {
          flex: 1; padding: 8px; background: none; border: none;
          color: #aaa; cursor: pointer; font-size: 12px;
        }
        .popup-tab.active { background: rgba(255,255,255,0.08); color: #fff; }
        .popup-tab:hover  { background: rgba(255,255,255,0.05); }

        /* ---- Panes ---- */
        .popup-pane {
          padding: 12px 14px; min-height: 60px; max-height: 260px;
          overflow-y: auto; display: none;
        }
        .popup-pane.active { display: block; }
        .popup-pane::-webkit-scrollbar { width: 4px; }
        .popup-pane::-webkit-scrollbar-track { background: #222; }
        .popup-pane::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }

        /* ---- Section label ---- */
        .section-label {
          font-size: 11px; font-weight: 600; color: #888;
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 8px; display: flex; align-items: center; gap: 4px;
        }

        /* ---- POS block (Free Dictionary) ---- */
        .pos-block { margin-bottom: 12px; }
        .pos-block:last-of-type { margin-bottom: 0; }
        .pos-header {
          display: flex; align-items: baseline; gap: 8px;
          margin-bottom: 5px; flex-wrap: wrap;
        }
        .pos-label {
          font-size: 11px; font-weight: 700; color: #ffe566;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .pos-jp { font-size: 12px; color: #ccc; }

        /* ---- Example items (Free Dictionary & Tatoeba) ---- */
        .examples-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 6px;
        }
        .tatoeba-link { font-size: 10px; color: #4a9eff; text-decoration: none; }
        .tatoeba-link:hover { text-decoration: underline; }
        .example-item {
          position: relative; margin-bottom: 5px; padding: 5px 8px;
          border-radius: 5px; cursor: default;
          color: #ccc; font-size: 13px; line-height: 1.5;
        }
        .example-item:hover { background: rgba(255,255,255,0.04); }
        .example-item:last-child { margin-bottom: 0; }
        .atv-ex-word { cursor: pointer; border-radius: 2px; padding: 0 1px; }
        .atv-ex-word:hover { background: rgba(255,220,80,0.3); }

        /* Japanese translation tooltip (CSS only, Shadow DOM) */
        .example-item[data-ja]:hover::after {
          content: attr(data-ja);
          position: absolute;
          bottom: calc(100% + 5px);
          left: 0;
          background: rgba(0,0,0,0.93);
          color: #fff;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.4;
          white-space: pre-wrap;
          max-width: 300px;
          pointer-events: none;
          z-index: 9999;
          box-shadow: 0 4px 14px rgba(0,0,0,0.7);
        }

        /* ---- AI translation pane ---- */
        .ai-label  { color: #aaa; font-size: 11px; margin-bottom: 6px; }
        .ai-result { color: #fff; font-size: 13px; line-height: 1.5; }

        /* ---- Shared states ---- */
        .loading { color: #666; font-size: 12px; }
        .error   { color: #ff6b6b; font-size: 12px; }
      </style>

      <div id="popup">
        <!-- Header: word + badges + reading -->
        <div id="popup-header">
          <div id="popup-header-left">
            <div id="popup-word-row">
              <span id="popup-word"></span>
              <span id="popup-badges"></span>
            </div>
            <div id="popup-reading"></div>
          </div>
          <button id="popup-close">✕</button>
        </div>

        <!-- Tabs -->
        <div id="popup-tabs">
          <button class="popup-tab active" data-tab="dict">📖 辞書</button>
          <button class="popup-tab"         data-tab="ai"  >🤖 AI翻訳</button>
        </div>

        <!-- Dict pane: meanings + examples -->
        <div class="popup-pane active" id="pane-dict">
          <span class="loading">検索中...</span>
        </div>

        <!-- AI translation pane -->
        <div class="popup-pane" id="pane-ai">
          <span class="loading">翻訳中...</span>
        </div>
      </div>
    `;

    const popup = popupShadowRoot.getElementById('popup');

    popupShadowRoot.getElementById('popup-close')
      .addEventListener('click', () => { popup.style.display = 'none'; });

    // Tab switching — stopPropagation prevents the document click handler
    // from closing the popup when a tab is clicked (tab bug fix)
    popupShadowRoot.querySelectorAll('.popup-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // ← fix: prevent bubbling to document close handler
        popupShadowRoot.querySelectorAll('.popup-tab').forEach(b => b.classList.remove('active'));
        popupShadowRoot.querySelectorAll('.popup-pane').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        popupShadowRoot.getElementById('pane-' + btn.dataset.tab).classList.add('active');
      });
    });

    document.addEventListener('click', () => { popup.style.display = 'none'; });
  }

  // -------------------------------------------------------
  // Show popup at a word
  // -------------------------------------------------------
  function showPopup(word, sentence, anchorRect) {
    if (!popupShadowRoot) return;

    const clean = word.replace(/[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF]/g, '');
    if (!clean) return;

    const popup = popupShadowRoot.getElementById('popup');

    // Reset header
    popupShadowRoot.getElementById('popup-word').textContent    = clean;
    popupShadowRoot.getElementById('popup-badges').innerHTML    = '';
    popupShadowRoot.getElementById('popup-reading').textContent = '';

    // Reset pane content
    popupShadowRoot.getElementById('pane-dict').innerHTML = '<span class="loading">検索中...</span>';
    popupShadowRoot.getElementById('pane-ai').innerHTML   = '<span class="loading">翻訳中...</span>';

    // Reset to dict tab
    popupShadowRoot.querySelectorAll('.popup-tab').forEach(b => b.classList.remove('active'));
    popupShadowRoot.querySelectorAll('.popup-pane').forEach(b => b.classList.remove('active'));
    popupShadowRoot.querySelector('[data-tab="dict"]').classList.add('active');
    popupShadowRoot.getElementById('pane-dict').classList.add('active');

    // Position
    popup.style.display = 'block';
    const pw = 340;
    let left = anchorRect.left;
    let top  = anchorRect.bottom + 8;
    if (left + pw > window.innerWidth - 8)  left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + 320 > window.innerHeight - 8) top = anchorRect.top - 320 - 8;
    if (top < 8) top = 8;
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';

    fetchDictionary(clean);
    fetchTranslation(sentence || clean);
  }

  // -------------------------------------------------------
  // Dictionary fetch — Free Dictionary + EJDict + Jisho badges
  // -------------------------------------------------------
  function fetchDictionary(word) {
    sendToBackground({ type: 'FETCH_DICT', word }, (res) => {
      const badgesEl  = popupShadowRoot.getElementById('popup-badges');
      const readingEl = popupShadowRoot.getElementById('popup-reading');
      const paneDict  = popupShadowRoot.getElementById('pane-dict');

      if (!res?.ok) {
        badgesEl.innerHTML    = '';
        readingEl.textContent = '';
        paneDict.innerHTML    = res?.error === 'not_found'
          ? '<span class="loading">見つかりませんでした</span>'
          : `<span class="error">エラー: ${res?.error ?? 'unknown'}</span>`;
        fetchTatoeba(word, paneDict);
        return;
      }

      // --- Header: badges + reading (phonetic) ---
      badgesEl.innerHTML = [
        res.isCommon ? '<span class="badge badge-common">よく使われる語</span>' : '',
        res.jlpt     ? `<span class="badge badge-jlpt">${res.jlpt}</span>`       : '',
      ].filter(Boolean).join('');

      const readingParts = [];
      if (res.phonetic) readingParts.push(res.phonetic);
      if (res.reading)  readingParts.push(res.reading);
      readingEl.textContent = readingParts.join('　');

      // --- EJDict fallback line ---
      const ejdictHtml = res.ejdict
        ? `<div style="color:#aaa;font-size:12px;margin-bottom:10px;padding:5px 8px;background:rgba(255,255,255,0.04);border-radius:5px;">${
            res.ejdict.replace(/</g,'&lt;').replace(/>/g,'&gt;')
          }</div>`
        : '';

      // --- POS blocks (Free Dictionary) ---
      const posHtml = (res.meanings ?? []).map(m => {
        if (!m.examples?.length) return '';
        const exHtml = m.examples.map(ex => {
          const jaEsc = (ex.ja || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
          const esc   = ex.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          return `<div class="example-item"${jaEsc ? ` data-ja="${jaEsc}"` : ''}>${esc}</div>`;
        }).join('');
        const jpEsc = (m.posJa || m.pos || '').replace(/</g,'&lt;');
        return `
          <div class="pos-block">
            <div class="pos-header">
              <span class="pos-label">${jpEsc}</span>
            </div>
            ${exHtml}
          </div>`;
      }).filter(Boolean).join('');

      paneDict.innerHTML = `
        ${ejdictHtml}
        ${posHtml || '<span class="loading" style="font-size:12px;">定義なし</span>'}
        <div id="examples-section"></div>
      `;

      // Tatoeba セクションを追加
      fetchTatoeba(word, paneDict);
    });
  }

  // -------------------------------------------------------
  // Tatoeba example sentences fetch
  // -------------------------------------------------------
  function fetchTatoeba(word, paneDict) {
    const exSection = paneDict.querySelector('#examples-section');
    if (!exSection) return;

    exSection.innerHTML = `
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin:10px 0;"></div>
      <div class="section-label" style="margin-top:8px;">💬 例文 <span class="loading" style="font-weight:400;text-transform:none;letter-spacing:0;">(取得中...)</span></div>
    `;

    sendToBackground({ type: 'FETCH_TATOEBA', word }, (res) => {
      const tatoebaUrl = `https://tatoeba.org/en/sentences/search?from=eng&to=jpn&query=${encodeURIComponent(word)}`;
      const headerHtml = `
        <div style="border-top:1px solid rgba(255,255,255,0.08);margin:10px 0;"></div>
        <div class="examples-header">
          <div class="section-label" style="margin-bottom:0;">💬 例文</div>
          <a href="${tatoebaUrl}" target="_blank" rel="noopener noreferrer" class="tatoeba-link">Tatoeba ↗</a>
        </div>
      `;

      if (!res?.ok || !res.results?.length) {
        exSection.innerHTML = headerHtml + '<span class="loading" style="font-size:11px;">例文なし</span>';
        return;
      }

      const itemsHtml = res.results.map(ex => {
        const jaEscaped = (ex.translation || '')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const enWords = ex.text.split(/\b/).map(tok => {
          if (!/\w/.test(tok)) return tok;
          const esc = tok.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          return `<span class="atv-ex-word" data-word="${esc}">${esc}</span>`;
        }).join('');
        return `
          <div class="example-item" data-ja="${jaEscaped}">
            <div class="example-en">${enWords}</div>
          </div>
        `;
      }).join('');

      exSection.innerHTML = headerHtml + itemsHtml;

      // Clicking a word in an example sentence re-searches that word
      exSection.querySelectorAll('.atv-ex-word').forEach(span => {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          const w = span.dataset.word;
          if (w) {
            const rect = span.getBoundingClientRect();
            showPopup(w, w, rect);
          }
        });
      });
    });
  }

  // -------------------------------------------------------
  // Translation fetch
  // -------------------------------------------------------
  function fetchTranslation(text) {
    const el = popupShadowRoot.getElementById('pane-ai');
    sendToBackground({ type: 'FETCH_TRANSLATE', text }, (res) => {
      if (res?.ok) {
        el.innerHTML = `<div class="ai-label">翻訳：</div><div class="ai-result">${res.translated}</div>`;
      } else {
        el.innerHTML = `<span class="error">エラー: ${res?.error ?? 'unknown'}</span>`;
      }
    });
  }

  // -------------------------------------------------------
  // Subtitle click → word popup
  // -------------------------------------------------------
  function makeSubtitleClickable(subtitleEl) {
    if (subtitleEl.dataset.atvProcessed) return;
    subtitleEl.dataset.atvProcessed = '1';

    const text = subtitleEl.textContent;
    subtitleEl.innerHTML = '';

    const tokens = text.split(/\b/);
    tokens.forEach(tok => {
      if (/[a-zA-Z]/.test(tok)) {
        const span = document.createElement('span');
        span.textContent = tok;
        span.style.cssText = 'cursor:pointer;border-radius:2px;padding:0 1px;transition:background 0.15s;';
        span.addEventListener('mouseenter', () => { span.style.background = 'rgba(255,220,80,0.3)'; });
        span.addEventListener('mouseleave', () => { span.style.background = ''; });
        span.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          showPopup(tok, text, span.getBoundingClientRect());
        });
        subtitleEl.appendChild(span);
      } else {
        subtitleEl.appendChild(document.createTextNode(tok));
      }
    });
  }

  // -------------------------------------------------------
  // Subtitle observer (for word click)
  // -------------------------------------------------------
  function observeSubtitlesForClick() {
    const obs = new MutationObserver(() => {
      document.querySelectorAll(CONFIG.subtitleSelector).forEach(makeSubtitleClickable);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // -------------------------------------------------------
  // Floating toggle button
  // -------------------------------------------------------
  function createToggleButton() {
    if (document.getElementById('atv-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'atv-toggle-btn';
    btn.textContent = '📺';
    btn.title = '字幕パネルを開く/閉じる';
    btn.style.cssText = [
      'position:fixed', 'bottom:80px', 'right:20px',
      'width:40px', 'height:40px', 'border-radius:50%',
      'background:rgba(0,0,0,0.7)', 'border:1px solid rgba(255,255,255,0.2)',
      'color:#fff', 'font-size:18px', 'cursor:pointer',
      'z-index:999998', 'display:flex', 'align-items:center', 'justify-content:center',
      'transition:background 0.2s',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(50,50,50,0.9)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.7)'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
    getTarget().appendChild(btn);
  }

  // -------------------------------------------------------
  // Entry point
  // -------------------------------------------------------
  function init() {
    createPanel();
    createPopupHost();
    createToggleButton();
    startSubtitleObserver();
    observeSubtitlesForClick();
    console.log('[ATV-Bilingual] v2.5 loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
