// =============================================================
// Apple TV+ Bilingual Subtitles - content.js v2.3
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
//    fetch() calls from tv.apple.com to jisho.org are blocked by CORS.
//    Solution: route all external API calls through background.js,
//    which runs as a service worker and is not subject to CORS.
//
// 3. LAYOUT
//    - Video container is shrunk to 70% width to make room for the panel.
//    - Right panel (30% width) shows subtitle history + future lines.
//    - Overlay shows the current bilingual subtitle at the bottom-left.
//    - Toggle button (top-right, only when panel is hidden) reopens panel.
//
// =============================================================

(function () {
  'use strict';

  // -------------------------------------------------------
  // State
  // -------------------------------------------------------
  let video          = null;
  let primaryTrack   = null;
  let secondaryTrack = null;
  let settings       = { primaryLang: 'en', secondaryLang: 'ja' };
  let subtitleHistory = [];   // past subtitle entries
  let panelVisible   = true;
  let shadowRoot     = null;  // shadow root for the right panel
  let popupShadowRoot = null; // shadow root for the word popup
  let dialogEl       = null;  // reference to <dialog class="playback-view">

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

  // Strip HTML tags from a VTTCue and return plain text
  function cleanCueText(cue) {
    if (!cue) return '';
    if (cue.getCueAsHTML) return cue.getCueAsHTML().textContent || '';
    return (cue.text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>');
  }

  // Find the cue active at a given time in a TextTrack
  function findCueAt(track, time) {
    if (!track || !track.cues) return null;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      if (c.startTime <= time + 0.1 && time < c.endTime + 0.1) return c;
    }
    return null;
  }

  // -------------------------------------------------------
  // Injection target
  // Inject into <dialog> to appear in the browser's top layer.
  // Falls back to document.body if the dialog is not yet present.
  // -------------------------------------------------------
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

  // Return deduplicated list of subtitle/caption tracks
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

  // Find the best track for a language (prefer one with cues already loaded)
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
  // Layout: shrink the video container to make room for the panel
  // -------------------------------------------------------
  function applyLayout(show) {
    const vc = document.querySelector('.video-player__video-container');
    if (!vc) return;
    if (show) {
      vc.style.width       = '70%';
      vc.style.maxWidth    = '70%';
      vc.style.flexShrink  = '0';
    } else {
      vc.style.width       = '';
      vc.style.maxWidth    = '';
      vc.style.flexShrink  = '';
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
        /* ---- header ---- */
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
        /* ---- scroll area ---- */
        #panel-scroll {
          flex: 1; overflow-y: auto; padding: 12px 14px; scroll-behavior: smooth;
        }
        #panel-scroll::-webkit-scrollbar { width: 4px; }
        #panel-scroll::-webkit-scrollbar-track { background: #222; }
        #panel-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
        /* ---- subtitle blocks ---- */
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
        /* future lines are dimmed */
        .subtitle-future .subtitle-primary  { color: #555; }
        .subtitle-future .subtitle-secondary { color: #444; }
        .subtitle-future .subtitle-time      { color: #3a3a3a; }
        /* clickable words */
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
  // Toggle button (shown only when panel is hidden, top-right)
  // -------------------------------------------------------
  function createToggleButton() {
    if (getTarget().querySelector('#atv-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'atv-toggle-btn';
    btn.textContent = '📋';
    btn.title = '字幕パネルを開く';
    btn.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:999999',
      'background:rgba(0,0,0,0.7)', 'color:white',
      'border:1px solid rgba(255,255,255,0.25)', 'border-radius:8px',
      'padding:4px 10px', 'font-size:16px', 'cursor:pointer',
      'backdrop-filter:blur(4px)', 'display:none', // hidden by default (panel is open)
    ].join(';');
    btn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    getTarget().appendChild(btn);
  }

  // -------------------------------------------------------
  // Word popup (Shadow DOM)
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
          display: none; position: fixed; width: 300px;
          background: #1c1c1e; border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.8);
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px; color: #f0f0f0; pointer-events: auto; z-index: 999999;
        }
        #popup-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 14px; background: rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        #popup-word { font-size: 1.1rem; font-weight: 700; color: #ffe566; }
        #popup-close {
          background: none; border: none; color: rgba(255,255,255,0.5);
          cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px;
        }
        #popup-close:hover { color: #fff; }
        #popup-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .popup-tab {
          flex: 1; padding: 8px; background: none; border: none;
          color: #aaa; cursor: pointer; font-size: 12px;
        }
        .popup-tab.active { background: rgba(255,255,255,0.08); color: #fff; }
        .popup-tab:hover  { background: rgba(255,255,255,0.05); }
        .popup-pane {
          padding: 12px 14px; min-height: 60px; max-height: 200px;
          overflow-y: auto; display: none;
        }
        .popup-pane.active { display: block; }
        .dict-reading { color: #aaa; font-size: 11px; margin-bottom: 4px; }
        .dict-meaning { color: #fff; font-size: 13px; }
        .ai-label  { color: #aaa; font-size: 11px; margin-bottom: 6px; }
        .ai-result { color: #fff; font-size: 13px; line-height: 1.5; }
        .loading   { color: #666; font-size: 12px; }
        .error     { color: #ff6b6b; font-size: 12px; }
      </style>
      <div id="popup">
        <div id="popup-header">
          <span id="popup-word"></span>
          <button id="popup-close">✕</button>
        </div>
        <div id="popup-tabs">
          <button class="popup-tab active" data-tab="dict">📖 辞書</button>
          <button class="popup-tab"         data-tab="ai"  >🤖 AI翻訳</button>
        </div>
        <div class="popup-pane active" id="pane-dict"><span class="loading">検索中...</span></div>
        <div class="popup-pane"        id="pane-ai"  ><span class="loading">翻訳中...</span></div>
      </div>
    `;

    const popup = popupShadowRoot.getElementById('popup');

    // Close button
    popupShadowRoot.getElementById('popup-close')
      .addEventListener('click', () => { popup.style.display = 'none'; });

    // Tab switching
    popupShadowRoot.querySelectorAll('.popup-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        popupShadowRoot.querySelectorAll('.popup-tab').forEach(b => b.classList.remove('active'));
        popupShadowRoot.querySelectorAll('.popup-pane').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        popupShadowRoot.getElementById('pane-' + btn.dataset.tab).classList.add('active');
      });
    });

    // Close on outside click
    document.addEventListener('click', () => { popup.style.display = 'none'; });
  }

  // -------------------------------------------------------
  // Show popup at a word
  // -------------------------------------------------------
  function showPopup(word, sentence, anchorRect) {
    if (!popupShadowRoot) return;

    // Strip punctuation; keep Latin, Hiragana, Katakana, CJK
    const clean = word.replace(/[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF]/g, '');
    if (!clean) return;

    const popup = popupShadowRoot.getElementById('popup');
    popupShadowRoot.getElementById('popup-word').textContent = clean;
    popupShadowRoot.getElementById('pane-dict').innerHTML = '<span class="loading">検索中...</span>';
    popupShadowRoot.getElementById('pane-ai').innerHTML   = '<span class="loading">翻訳中...</span>';

    // Reset tabs to 'dict'
    popupShadowRoot.querySelectorAll('.popup-tab').forEach(b => b.classList.remove('active'));
    popupShadowRoot.querySelectorAll('.popup-pane').forEach(b => b.classList.remove('active'));
    popupShadowRoot.querySelector('[data-tab="dict"]').classList.add('active');
    popupShadowRoot.getElementById('pane-dict').classList.add('active');

    // Position popup above the word (flip down if too close to top)
    popup.style.display = 'block';
    const pw = 300;
    let left = anchorRect.left;
    let top  = anchorRect.top - 120;
    if (left + pw > window.innerWidth) left = window.innerWidth - pw - 8;
    if (top < 8) top = anchorRect.bottom + 8;
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';

    // Fetch via background.js to avoid CORS
    fetchDictionary(clean);
    fetchTranslation(sentence || clean);
  }

  // Route through background.js service worker (CORS-free)
  function fetchDictionary(word) {
    const el = popupShadowRoot.getElementById('pane-dict');
    chrome.runtime.sendMessage({ type: 'FETCH_DICT', word }, (res) => {
      if (res?.ok) {
        el.innerHTML = `
          <div class="dict-reading">${res.reading}</div>
          <div class="dict-meaning">${res.meanings || '定義なし'}</div>
        `;
      } else {
        el.innerHTML = res?.error === 'not_found'
          ? '<span class="loading">見つかりませんでした</span>'
          : `<span class="error">エラー: ${res?.error ?? 'unknown'}</span>`;
      }
    });
  }

  function fetchTranslation(text) {
    const el = popupShadowRoot.getElementById('pane-ai');
    chrome.runtime.sendMessage({ type: 'FETCH_TRANSLATE', text }, (res) => {
      if (res?.ok) {
        el.innerHTML = `<div class="ai-label">翻訳：</div><div class="ai-result">${res.translated}</div>`;
      } else {
        el.innerHTML = `<span class="error">エラー: ${res?.error ?? 'unknown'}</span>`;
      }
    });
  }

  // -------------------------------------------------------
  // Render clickable word spans
  // Used for ALL subtitle blocks (past, current, future)
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

    // Past entries from history
    subtitleHistory.forEach(h => {
      if (h.endTime <= currentTime) allBlocks.push({ ...h, state: 'past' });
    });

    // Current cue
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

    // Future cues
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

    // Render all blocks — ALL are clickable (makeClickableSpans for every state)
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

    // Attach word click handlers to ALL blocks
    list.querySelectorAll('.subtitle-block').forEach(blockEl => {
      // Click on a word → popup
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

      // Click on a block (not a word) → seek video
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

    // Scroll current block into view
    const currentBlock = shadowRoot.getElementById('current-block');
    if (currentBlock) {
      currentBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
  // Toggle panel open/close
  // -------------------------------------------------------
  function togglePanel() {
    panelVisible = !panelVisible;
    applyLayout(panelVisible);

    const panelHost  = getTarget().querySelector('#atv-panel-host');
    const overlayHost = getTarget().querySelector('#atv-overlay-host');
    const toggleBtn  = getTarget().querySelector('#atv-toggle-btn');

    if (panelHost)   panelHost.style.display   = panelVisible ? '' : 'none';
    if (overlayHost) overlayHost.style.width   = panelVisible ? '70%' : '100%';
    // Toggle button is visible only when panel is hidden
    if (toggleBtn)   toggleBtn.style.display   = panelVisible ? 'none' : 'block';
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

    // Record new subtitle entry in history
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

    // Remove previous listener before re-initialising
    if (primaryTrack) primaryTrack.removeEventListener('cuechange', onCueChange);

    // Hide all native tracks
    for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'hidden';

    primaryTrack   = findBestTrack(tracks, settings.primaryLang);
    secondaryTrack = findBestTrack(tracks, settings.secondaryLang);

    // Briefly set secondary to 'showing' to trigger cue loading, then hide
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
      '[ATV-Bilingual] v2.3 ready | injected into:',
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
      subtitleHistory  = [];
      lastPrimaryText  = '';
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
