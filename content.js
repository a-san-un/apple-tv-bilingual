// =============================================================
// Apple TV+ Bilingual Subtitles - content.js v2.5
// =============================================================
//
// Architecture notes:
//
// 1. TOP LAYER PROBLEM
//    Apple TV+ renders its player inside a <dialog class="playback-view">
//    element. The browser promotes <dialog> to the "top layer", which
//    sits above all z-index stacking contexts in document.body.
//    Solution: inject all UI elements directly into the <dialog>.
//
// 2. CORS PROBLEM
//    fetch() calls from tv.apple.com to jisho.org / tatoeba.org are
//    blocked by CORS. Solution: route all external API calls through
//    background.js, which runs as a service worker and is not subject
//    to CORS.
//
// 3. SW KEEPALIVE PROBLEM
//    Manifest V3 service workers auto-stop after ~30s of inactivity.
//    Solution: sendToBackground() retries once after 300ms if the SW
//    was asleep and didn't respond.
//
// 4. LAYOUT
//    - Video container is shrunk to 70% width to make room for the panel.
//    - Right panel (30% width) shows subtitle history + future lines.
//    - Overlay shows the current bilingual subtitle at the bottom-left.
//    - Toggle button (top-right at 60px, only when panel is hidden) reopens panel.
//
// 5. DICTIONARY POPUP (v2.5)
//    3-section layout: header (word + badges + reading),
//    meanings section, example sentences section (Tatoeba, max 5).
//    Hovering an example sentence shows the Japanese translation as a
//    CSS tooltip (data-ja attribute). Clicking any word inside an
//    example sentence re-searches that word (no back button).
//
// =============================================================

(function () {
  'use strict';

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  let video           = null;
  let primaryTrack    = null;
  let secondaryTrack  = null;
  let settings        = { primaryLang: 'en', secondaryLang: 'ja' };
  let subtitleHistory = [];
  let panelVisible    = true;
  let shadowRoot      = null;
  let popupShadowRoot = null;
  let dialogEl        = null;

  // -------------------------------------------------------
  // Utilities
  // -------------------------------------------------------

  function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function cleanCueText(cue) {
    if (!cue) return '';
    if (cue.getCueAsHTML) return cue.getCueAsHTML().textContent || '';
    return (cue.text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>');
  }

  function findCueAt(track, time) {
    if (!track || !track.cues) return null;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      if (c.startTime <= time + 0.1 && time < c.endTime + 0.1) return c;
    }
    return null;
  }

  // -------------------------------------------------------
  // sendToBackground — retries once if the SW was asleep
  // -------------------------------------------------------
  function sendToBackground(msg, callback) {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        setTimeout(() => {
          chrome.runtime.sendMessage(msg, (res2) => {
            if (chrome.runtime.lastError) {
              callback({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              callback(res2);
            }
          });
        }, 300);
      } else {
        callback(res);
      }
    });
  }

  function getTarget() {
    return dialogEl || document.body;
  }

  // -------------------------------------------------------
  // Boot: wait until <video>, textTracks, and <dialog> are ready
  // -------------------------------------------------------
  function waitForVideo(cb) {
    const check = () => {
      const v = document.querySelector('video');
      const d = document.querySelector('dialog.playback-view');
      if (v && v.textTracks && v.textTracks.length > 1 && d) {
        dialogEl = d;
        cb(v);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  }

  // -------------------------------------------------------
  // Track helpers
  // -------------------------------------------------------

  function getUniqueTracks(textTracks) {
    const seen   = new Set();
    const result = [];
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      const key = t.language + '::' + t.label.trim();
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ index: i, lang: t.language, label: t.label.trim(), track: t });
      }
    }
    return result;
  }

  function findBestTrack(textTracks, lang) {
    const candidates = [];
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if ((t.kind === 'subtitles' || t.kind === 'captions') && t.language === lang) {
        candidates.push(t);
      }
    }
    if (candidates.length === 0) return null;
    return candidates.find(t => t.cues && t.cues.length > 0) || candidates[0];
  }

  // -------------------------------------------------------
  // Layout
  // -------------------------------------------------------
  function applyLayout(show) {
    const vc = document.querySelector('.video-player__video-container');
    if (!vc) return;
    if (show) {
      vc.style.width      = '70%';
      vc.style.maxWidth   = '70%';
      vc.style.flexShrink = '0';
    } else {
      vc.style.width      = '';
      vc.style.maxWidth   = '';
      vc.style.flexShrink = '';
    }
  }

  // -------------------------------------------------------
  // Right panel (Shadow DOM)
  // -------------------------------------------------------
  function createRightPanel() {
    if (getTarget().querySelector('#atv-panel-host')) return;

    const host = document.createElement('div');
    host.id = 'atv-panel-host';
    host.style.cssText = [
      'position:fixed', 'top:0', 'right:0',
      'width:30%',      'height:100vh',
      'z-index:99999',  'pointer-events:auto',
      'box-sizing:border-box',
    ].join(';');
    getTarget().appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        #panel {
          width: 100%; height: 100%;
          background: #1a1a1a; color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px; display: flex; flex-direction: column;
          overflow: hidden; box-sizing: border-box;
        }
        #panel-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 14px; background: #111;
          border-bottom: 1px solid #333; flex-shrink: 0;
        }
        #panel-header span {
          font-size: 12px; color: #888; font-weight: 600;
          letter-spacing: 0.05em; text-transform: uppercase;
        }
        #close-btn {
          background: none; border: 1px solid #444; color: #aaa;
          cursor: pointer; border-radius: 4px; padding: 2px 8px; font-size: 11px;
        }
        #close-btn:hover { background: #333; color: #fff; }
        #panel-scroll {
          flex: 1; overflow-y: auto; padding: 12px 14px; scroll-behavior: smooth;
        }
        #panel-scroll::-webkit-scrollbar { width: 4px; }
        #panel-scroll::-webkit-scrollbar-track { background: #222; }
        #panel-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
        .subtitle-block {
          margin-bottom: 12px; padding-bottom: 12px;
          border-bottom: 1px solid #2a2a2a; cursor: pointer;
        }
        .subtitle-block:hover { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 4px 6px; }
        .subtitle-block.current {
          background: #2a2a2a; border-radius: 6px; padding: 8px;
          border-left: 2px solid #ffe566; border-bottom: none; margin-bottom: 12px;
        }
        .subtitle-time {
          font-size: 10px; color: #555; margin-bottom: 4px; font-variant-numeric: tabular-nums;
        }
        .subtitle-block.current .subtitle-time { color: #ffe566; }
        .subtitle-primary { color: #aaa; font-size: 12px; line-height: 1.5; margin-bottom: 2px; }
        .subtitle-block.current .subtitle-primary { color: #fff; font-size: 14px; font-weight: 500; }
        .subtitle-secondary { color: #666; font-size: 11px; line-height: 1.5; }
        .subtitle-block.current .subtitle-secondary { color: #ccc; font-size: 13px; }
        .subtitle-future .subtitle-primary  { color: #555; }
        .subtitle-future .subtitle-secondary { color: #444; }
        .subtitle-future .subtitle-time      { color: #3a3a3a; }
        .atv-word { cursor: pointer; border-radius: 2px; padding: 0 1px; }
        .atv-word:hover { background: rgba(255,220,80,0.3); }
      </style>
      <div id="panel">
        <div id="panel-header">
          <span>📋 字幕履歴</span>
          <button id="close-btn">✕ 閉じる</button>
        </div>
        <div id="panel-scroll"><div id="subtitle-list"></div></div>
      </div>
    `;

    shadowRoot.getElementById('close-btn').addEventListener('click', () => togglePanel());
  }

  // -------------------------------------------------------
  // Toggle button
  // -------------------------------------------------------
  function createToggleButton() {
    if (getTarget().querySelector('#atv-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'atv-toggle-btn';
    btn.textContent = '📋';
    btn.title = '字幕パネルを開く';
    btn.style.cssText = [
      'position:fixed', 'top:60px', 'right:16px', 'z-index:999999',
      'background:rgba(0,0,0,0.7)', 'color:white',
      'border:1px solid rgba(255,255,255,0.25)', 'border-radius:8px',
      'padding:4px 10px', 'font-size:16px', 'cursor:pointer',
      'backdrop-filter:blur(4px)', 'display:none',
    ].join(';');
    btn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    getTarget().appendChild(btn);
  }

  // -------------------------------------------------------
  // Word popup (Shadow DOM) — v2.5: 3-section dictionary layout
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

        /* ---- Meanings section ---- */
        .section-label {
          font-size: 11px; font-weight: 600; color: #888;
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: 8px; display: flex; align-items: center; gap: 4px;
        }
        .dict-sense { margin-bottom: 10px; }
        .dict-pos   { font-size: 10px; color: #888; font-style: italic; margin-bottom: 3px; }
        .dict-def   { color: #fff; font-size: 13px; line-height: 1.5; }
        .dict-def-num { color: #ffe566; font-size: 11px; margin-right: 4px; }

        /* ---- Examples section ---- */
        .examples-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 8px;
        }
        .tatoeba-link {
          font-size: 10px; color: #4a9eff;
          text-decoration: none;
        }
        .tatoeba-link:hover { text-decoration: underline; }
        .example-item {
          position: relative; margin-bottom: 8px; padding: 6px 8px;
          background: rgba(255,255,255,0.04); border-radius: 6px;
          cursor: default;
        }
        .example-item:last-child { margin-bottom: 0; }
        .example-en {
          color: #e0e0e0; font-size: 13px; line-height: 1.5;
        }
        .example-en .atv-ex-word {
          cursor: pointer; border-radius: 2px; padding: 0 1px;
        }
        .example-en .atv-ex-word:hover { background: rgba(255,220,80,0.3); }

        /* Japanese translation tooltip (CSS only) */
        .example-item[data-ja]:hover::after {
          content: attr(data-ja);
          position: absolute;
          bottom: calc(100% + 5px);
          left: 0;
          background: rgba(0,0,0,0.92);
          color: #fff;
          padding: 5px 9px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.4;
          white-space: pre-wrap;
          max-width: 300px;
          pointer-events: none;
          z-index: 9999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.6);
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
    let top  = anchorRect.top - 180;
    if (left + pw > window.innerWidth) left = window.innerWidth - pw - 8;
    if (top < 8) top = anchorRect.bottom + 8;
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';

    fetchDictionary(clean);
    fetchTranslation(sentence || clean);
  }

  // -------------------------------------------------------
  // Dictionary fetch — builds 3-section layout in pane-dict
  // -------------------------------------------------------
  function fetchDictionary(word) {
    sendToBackground({ type: 'FETCH_DICT', word }, (res) => {
      // Update header badges and reading
      const badgesEl  = popupShadowRoot.getElementById('popup-badges');
      const readingEl = popupShadowRoot.getElementById('popup-reading');
      const paneDict  = popupShadowRoot.getElementById('pane-dict');

      if (!res?.ok) {
        badgesEl.innerHTML  = '';
        readingEl.textContent = '';
        paneDict.innerHTML = res?.error === 'not_found'
          ? '<span class="loading">見つかりませんでした</span>'
          : `<span class="error">エラー: ${res?.error ?? 'unknown'}</span>`;
        fetchTatoeba(word, paneDict);
        return;
      }

      // Header badges
      badgesEl.innerHTML = [
        res.isCommon ? '<span class="badge badge-common">よく使われる語</span>' : '',
        res.jlpt     ? `<span class="badge badge-jlpt">${res.jlpt}</span>`       : ''
      ].filter(Boolean).join('');

      // Header reading
      readingEl.textContent = res.reading ? `/${res.reading}/` : '';

      // Meanings section
      const sensesHtml = (res.meanings ?? []).map((sense, i) => {
        const pos  = sense.partsOfSpeech?.join(', ') ?? '';
        const defs = sense.definitions ?? [];
        if (defs.length === 0) return '';
        return `
          <div class="dict-sense">
            ${pos ? `<div class="dict-pos">${pos}</div>` : ''}
            ${defs.map((d, j) =>
              `<div class="dict-def"><span class="dict-def-num">${i * defs.length + j + 1}.</span>${d}</div>`
            ).join('')}
          </div>
        `;
      }).join('');

      paneDict.innerHTML = `
        <div class="section-label">📖 意味</div>
        ${sensesHtml || '<span class="loading">定義なし</span>'}
        <div id="examples-section"></div>
      `;

      // Fetch and inject examples
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
            const popup  = popupShadowRoot.getElementById('popup');
            const rect   = span.getBoundingClientRect();
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
  // Clickable word spans
  // -------------------------------------------------------
  function makeClickableSpans(text, sentence) {
    if (!text) return '';
    return text.split('\n').map(line =>
      line.split(' ').map(word => {
        if (!word.trim()) return ' ';
        const esc = word
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<span class="atv-word" data-word="${esc}" data-sentence="${encodeURIComponent(sentence)}">${esc}</span>`;
      }).join(' ')
    ).join('<br>');
  }

  // -------------------------------------------------------
  // Right panel rendering
  // -------------------------------------------------------
  function renderPanel() {
    if (!shadowRoot) return;
    const list = shadowRoot.getElementById('subtitle-list');
    if (!list) return;

    const currentTime = video ? video.currentTime : 0;
    const allBlocks   = [];

    subtitleHistory.forEach(h => {
      if (h.endTime <= currentTime) allBlocks.push({ ...h, state: 'past' });
    });

    const curPrimaryCue   = findCueAt(primaryTrack,   currentTime);
    const curSecondaryCue = findCueAt(secondaryTrack, currentTime);
    if (curPrimaryCue) {
      allBlocks.push({
        startTime: curPrimaryCue.startTime,
        endTime:   curPrimaryCue.endTime,
        primary:   cleanCueText(curPrimaryCue),
        secondary: cleanCueText(curSecondaryCue),
        state:     'current'
      });
    }

    if (primaryTrack && primaryTrack.cues) {
      for (let i = 0; i < primaryTrack.cues.length; i++) {
        const c = primaryTrack.cues[i];
        if (c.startTime > currentTime + 0.1) {
          const sc = findCueAt(secondaryTrack, c.startTime + 0.05);
          allBlocks.push({
            startTime: c.startTime,
            endTime:   c.endTime,
            primary:   cleanCueText(c),
            secondary: cleanCueText(sc),
            state:     'future'
          });
        }
      }
    }

    list.innerHTML = allBlocks.map(block => {
      const isCurrent = block.state === 'current';
      const isFuture  = block.state === 'future';
      const cls = isCurrent ? 'subtitle-block current'
                : isFuture  ? 'subtitle-block subtitle-future'
                :              'subtitle-block';
      const mid   = isCurrent ? 'id="current-block"' : '';
      const pText = makeClickableSpans(block.primary,   block.primary);
      const sText = makeClickableSpans(block.secondary, block.primary);
      return `
        <div class="${cls}" ${mid} data-time="${block.startTime}">
          <div class="subtitle-time">${isCurrent ? '▶ ' : ''}${formatTime(block.startTime)}</div>
          <div class="subtitle-primary">${pText}</div>
          ${sText ? `<div class="subtitle-secondary">${sText}</div>` : ''}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.subtitle-block').forEach(blockEl => {
      blockEl.querySelectorAll('.atv-word').forEach(span => {
        span.addEventListener('mouseenter', () => span.style.background = 'rgba(255,220,80,0.3)');
        span.addEventListener('mouseleave', () => span.style.background = '');
        span.addEventListener('click', (e) => {
          e.stopPropagation(); e.preventDefault();
          showPopup(
            span.dataset.word,
            decodeURIComponent(span.dataset.sentence),
            span.getBoundingClientRect()
          );
        });
      });

      blockEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('atv-word')) return;
        e.stopPropagation(); e.preventDefault();
        const t = parseFloat(blockEl.dataset.time);
        if (video && !isNaN(t)) {
          video.currentTime = t;
          setTimeout(() => renderPanel(), 100);
        }
      });
    });

    const currentBlock = shadowRoot.getElementById('current-block');
    if (currentBlock) currentBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // -------------------------------------------------------
  // Overlay (bottom-left of the 70% video area)
  // -------------------------------------------------------
  function createOverlay() {
    if (getTarget().querySelector('#atv-overlay-host')) return;
    const host = document.createElement('div');
    host.id = 'atv-overlay-host';
    host.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:0',
      'width:70%', 'z-index:99998',
      'pointer-events:none', 'text-align:center',
    ].join(';');
    getTarget().appendChild(host);

    const overlayRoot = host.attachShadow({ mode: 'open' });
    overlayRoot.innerHTML = `
      <style>
        #overlay {
          display: inline-block; background: rgba(0,0,0,0.7);
          border-radius: 6px; padding: 6px 16px;
          max-width: 80%; text-align: center; pointer-events: auto;
        }
        .sub-line {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 18px; font-weight: 500; color: #fff;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9); line-height: 1.4;
        }
        .atv-word { cursor: pointer; border-radius: 2px; padding: 0 1px; }
        .atv-word:hover { background: rgba(255,220,80,0.4); }
      </style>
      <div id="overlay">
        <span class="sub-line" id="ov-primary"></span>
        <span class="sub-line" id="ov-secondary"></span>
      </div>
    `;
    window.__atvOverlayRoot = overlayRoot;
  }

  function updateOverlay(primaryText, secondaryText) {
    const root = window.__atvOverlayRoot;
    if (!root) return;
    const p = root.getElementById('ov-primary');
    const s = root.getElementById('ov-secondary');
    if (!p || !s) return;
    if (!primaryText) { p.innerHTML = ''; s.innerHTML = ''; return; }

    p.innerHTML = primaryText.split(' ').map(word => {
      const esc = word.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      return `<span class="atv-word" data-word="${esc}" data-sentence="${encodeURIComponent(primaryText)}">${esc}</span>`;
    }).join(' ');
    s.textContent = secondaryText || '';

    p.querySelectorAll('.atv-word').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        showPopup(
          span.dataset.word,
          decodeURIComponent(span.dataset.sentence),
          span.getBoundingClientRect()
        );
      });
    });
  }

  // -------------------------------------------------------
  // Toggle panel
  // -------------------------------------------------------
  function togglePanel() {
    panelVisible = !panelVisible;
    applyLayout(panelVisible);

    const panelHost   = getTarget().querySelector('#atv-panel-host');
    const overlayHost = getTarget().querySelector('#atv-overlay-host');
    const toggleBtn   = getTarget().querySelector('#atv-toggle-btn');

    if (panelHost)   panelHost.style.display  = panelVisible ? '' : 'none';
    if (overlayHost) overlayHost.style.width  = panelVisible ? '70%' : '100%';
    if (toggleBtn)   toggleBtn.style.display  = panelVisible ? 'none' : 'block';
  }

  // -------------------------------------------------------
  // cuechange handler
  // -------------------------------------------------------
  let lastPrimaryText = '';

  function onCueChange() {
    const pCue  = primaryTrack?.activeCues?.[0] ?? null;
    const pText = cleanCueText(pCue);
    const sCue  = findCueAt(secondaryTrack, video?.currentTime ?? 0);
    const sText = cleanCueText(sCue);

    updateOverlay(pText, sText);

    if (pText && pText !== lastPrimaryText && pCue) {
      lastPrimaryText = pText;
      subtitleHistory.push({
        startTime: pCue.startTime,
        endTime:   pCue.endTime,
        primary:   pText,
        secondary: sText
      });
      if (subtitleHistory.length > 500) subtitleHistory.shift();
    }

    renderPanel();
  }

  // -------------------------------------------------------
  // Initialise tracks and build UI
  // -------------------------------------------------------
  function attachTracks(v) {
    video = v;
    chrome.storage.local.get(['primaryLang', 'secondaryLang'], (result) => {
      settings.primaryLang   = result.primaryLang   || 'en';
      settings.secondaryLang = result.secondaryLang || 'ja';
      startBilingual();
    });
  }

  function startBilingual() {
    const tracks = video.textTracks;

    if (primaryTrack) primaryTrack.removeEventListener('cuechange', onCueChange);

    for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'hidden';

    primaryTrack   = findBestTrack(tracks, settings.primaryLang);
    secondaryTrack = findBestTrack(tracks, settings.secondaryLang);

    if (secondaryTrack) {
      secondaryTrack.mode = 'showing';
      setTimeout(() => { if (secondaryTrack) secondaryTrack.mode = 'hidden'; }, 500);
    }
    if (primaryTrack) {
      primaryTrack.mode = 'hidden';
      primaryTrack.addEventListener('cuechange', onCueChange);
    }

    applyLayout(true);
    createOverlay();
    createRightPanel();
    createPopupHost();
    createToggleButton();

    console.log(
      '[ATV-Bilingual] v2.5 ready | injected into:',
      dialogEl ? 'dialog.playback-view ✅' : 'document.body (fallback)',
      '| tracks:', settings.primaryLang, '+', settings.secondaryLang
    );
  }

  // -------------------------------------------------------
  // Messages from popup.html
  // -------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      settings.primaryLang   = msg.primaryLang;
      settings.secondaryLang = msg.secondaryLang;
      subtitleHistory = [];
      lastPrimaryText = '';
      if (video) startBilingual();
    }
    if (msg.type === 'GET_LANGUAGES') {
      const langs = video ? getUniqueTracks(video.textTracks) : [];
      sendResponse(langs.map(l => ({ lang: l.lang, label: l.label })));
      return true;
    }
  });

  // -------------------------------------------------------
  // Boot
  // -------------------------------------------------------
  waitForVideo(attachTracks);

})();
