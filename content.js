// =====================================================
// Apple TV+ Bilingual Subtitles - content.js v2.1
// =====================================================

(function () {
  'use strict';

  // ---------- State ----------
  let video = null;
  let primaryTrack = null;
  let secondaryTrack = null;
  let settings = { primaryLang: 'en', secondaryLang: 'ja' };
  let subtitleHistory = [];
  let panelVisible = true;
  let shadowRoot = null;
  let popupShadowRoot = null;

  // ---------- Helpers ----------
  function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  // HTMLタグを除去してプレーンテキストを返す
  function cleanCueText(cue) {
    if (!cue) return '';
    // VTTCue の getCueAsHTML() を使うのが最も確実
    if (cue.getCueAsHTML) {
      return cue.getCueAsHTML().textContent || '';
    }
    // フォールバック: 正規表現でタグ除去
    return (cue.text || '').replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  }

  function findCueAt(track, time) {
    if (!track || !track.cues) return null;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      if (c.startTime <= time + 0.1 && time < c.endTime + 0.1) return c;
    }
    return null;
  }

  // ---------- Wait for video ----------
  function waitForVideo(cb) {
    const check = () => {
      const v = document.querySelector('video');
      if (v && v.textTracks && v.textTracks.length > 1) {
        cb(v);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  }

  // ---------- Track helpers ----------
  function getUniqueTracks(textTracks) {
    const seen = new Set();
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

  // ---------- Layout: ビデオを左70%に縮める ----------
  function applyLayout(show) {
    const videoContainer = document.querySelector('.video-player__video-container');
    if (!videoContainer) return;
    if (show) {
      videoContainer.style.width = '70%';
      videoContainer.style.maxWidth = '70%';
    } else {
      videoContainer.style.width = '';
      videoContainer.style.maxWidth = '';
    }
  }

  // ---------- Shadow DOM for right panel (position:fixed) ----------
  function createRightPanel() {
    if (document.getElementById('atv-panel-host')) return;

    const host = document.createElement('div');
    host.id = 'atv-panel-host';
    // position:fixed で親レイアウトに依存しない
    host.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'width:30%',
      'height:100vh',
      'z-index:2147483640',
      'pointer-events:auto',
      'box-sizing:border-box',
    ].join(';');

    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        #panel {
          width: 100%;
          height: 100%;
          background: #1a1a1a;
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-sizing: border-box;
        }
        #panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: #111;
          border-bottom: 1px solid #333;
          flex-shrink: 0;
        }
        #panel-header span {
          font-size: 12px;
          color: #888;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        #toggle-btn {
          background: none;
          border: 1px solid #444;
          color: #aaa;
          cursor: pointer;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
        }
        #toggle-btn:hover { background: #333; color: #fff; }
        #panel-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 12px 14px;
          scroll-behavior: smooth;
        }
        #panel-scroll::-webkit-scrollbar { width: 4px; }
        #panel-scroll::-webkit-scrollbar-track { background: #222; }
        #panel-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
        .subtitle-block {
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid #2a2a2a;
          cursor: pointer;
        }
        .subtitle-block:hover { background: rgba(255,255,255,0.03); border-radius: 6px; }
        .subtitle-block.current {
          background: #2a2a2a;
          border-radius: 6px;
          padding: 8px;
          border-left: 2px solid #ffe566;
          border-bottom: none;
          margin-bottom: 12px;
        }
        .subtitle-time {
          font-size: 10px;
          color: #555;
          margin-bottom: 4px;
          font-variant-numeric: tabular-nums;
        }
        .subtitle-block.current .subtitle-time { color: #ffe566; }
        .subtitle-primary {
          color: #aaa;
          font-size: 12px;
          line-height: 1.5;
          margin-bottom: 2px;
        }
        .subtitle-block.current .subtitle-primary {
          color: #fff;
          font-size: 14px;
          font-weight: 500;
        }
        .subtitle-secondary {
          color: #666;
          font-size: 11px;
          line-height: 1.5;
        }
        .subtitle-block.current .subtitle-secondary {
          color: #ccc;
          font-size: 13px;
        }
        .subtitle-future .subtitle-primary { color: #555; }
        .subtitle-future .subtitle-secondary { color: #444; }
        .subtitle-future .subtitle-time { color: #3a3a3a; }
        .atv-word {
          cursor: pointer;
          border-radius: 2px;
          padding: 0 1px;
        }
        .atv-word:hover { background: rgba(255,220,80,0.3); }
      </style>
      <div id="panel">
        <div id="panel-header">
          <span>📋 字幕履歴</span>
          <button id="toggle-btn">✕ 閉じる</button>
        </div>
        <div id="panel-scroll">
          <div id="subtitle-list"></div>
        </div>
      </div>
    `;

    shadowRoot.getElementById('toggle-btn').addEventListener('click', () => {
      togglePanel();
    });
  }

  // ---------- Shadow DOM for popup ----------
  function createPopupHost() {
    if (document.getElementById('atv-popup-host')) return;
    const host = document.createElement('div');
    host.id = 'atv-popup-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(host);
    popupShadowRoot = host.attachShadow({ mode: 'open' });
    popupShadowRoot.innerHTML = `
      <style>
        #popup {
          display: none;
          position: fixed;
          width: 300px;
          background: #1c1c1e;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.8);
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 13px;
          color: #f0f0f0;
          pointer-events: auto;
          z-index: 2147483647;
        }
        #popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: rgba(255,255,255,0.06);
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
          color: #aaa; cursor: pointer; font-size: 12px; transition: background 0.15s;
        }
        .popup-tab.active { background: rgba(255,255,255,0.08); color: #fff; }
        .popup-tab:hover { background: rgba(255,255,255,0.05); }
        .popup-pane {
          padding: 12px 14px; min-height: 60px; max-height: 200px;
          overflow-y: auto; display: none;
        }
        .popup-pane.active { display: block; }
        .dict-reading { color: #aaa; font-size: 11px; margin-bottom: 4px; }
        .dict-meaning { color: #fff; font-size: 13px; }
        .ai-label { color: #aaa; font-size: 11px; margin-bottom: 6px; }
        .ai-result { color: #fff; font-size: 13px; line-height: 1.5; }
        .loading { color: #666; font-size: 12px; }
        .error { color: #ff6b6b; font-size: 12px; }
      </style>
      <div id="popup">
        <div id="popup-header">
          <span id="popup-word"></span>
          <button id="popup-close">✕</button>
        </div>
        <div id="popup-tabs">
          <button class="popup-tab active" data-tab="dict">📖 辞書</button>
          <button class="popup-tab" data-tab="ai">🤖 AI翻訳</button>
        </div>
        <div class="popup-pane active" id="pane-dict"><span class="loading">検索中...</span></div>
        <div class="popup-pane" id="pane-ai"><span class="loading">翻訳中...</span></div>
      </div>
    `;

    const p = popupShadowRoot.getElementById('popup');
    popupShadowRoot.getElementById('popup-close').addEventListener('click', () => {
      p.style.display = 'none';
    });
    popupShadowRoot.querySelectorAll('.popup-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        popupShadowRoot.querySelectorAll('.popup-tab').forEach(b => b.classList.remove('active'));
        popupShadowRoot.querySelectorAll('.popup-pane').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        popupShadowRoot.getElementById('pane-' + btn.dataset.tab).classList.add('active');
      });
    });
    document.addEventListener('click', () => { p.style.display = 'none'; });
  }

  // ---------- Show popup ----------
  function showPopup(word, sentence, anchorRect) {
    if (!popupShadowRoot) return;
    const clean = word.replace(/[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF\u4E00-\u9FFF]/g, '');
    if (!clean) return;

    const popup = popupShadowRoot.getElementById('popup');
    popupShadowRoot.getElementById('popup-word').textContent = clean;
    popupShadowRoot.getElementById('pane-dict').innerHTML = '<span class="loading">検索中...</span>';
    popupShadowRoot.getElementById('pane-ai').innerHTML = '<span class="loading">翻訳中...</span>';
    popupShadowRoot.querySelectorAll('.popup-tab').forEach(b => b.classList.remove('active'));
    popupShadowRoot.querySelectorAll('.popup-pane').forEach(b => b.classList.remove('active'));
    popupShadowRoot.querySelector('[data-tab="dict"]').classList.add('active');
    popupShadowRoot.getElementById('pane-dict').classList.add('active');

    popup.style.display = 'block';
    const pw = 300;
    let left = anchorRect.left;
    let top = anchorRect.top - 8;
    if (left + pw > window.innerWidth) left = window.innerWidth - pw - 8;
    if (top - 120 < 0) top = anchorRect.bottom + 8;
    else top = anchorRect.top - 120;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';

    fetchDictionary(clean);
    fetchTranslation(sentence || clean);
  }

  async function fetchDictionary(word) {
    const el = popupShadowRoot.getElementById('pane-dict');
    try {
      const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`);
      const data = await res.json();
      const entry = data.data?.[0];
      if (entry) {
        const reading = entry.japanese?.[0]?.reading ?? '';
        const meanings = entry.senses?.[0]?.english_definitions?.slice(0, 3).join(', ') ?? '';
        el.innerHTML = `<div class="dict-reading">${reading}</div><div class="dict-meaning">${meanings || '定義なし'}</div>`;
      } else {
        el.innerHTML = '<span class="loading">見つかりませんでした</span>';
      }
    } catch (e) {
      el.innerHTML = `<span class="error">エラー: ${e.message}</span>`;
    }
  }

  async function fetchTranslation(text) {
    const el = popupShadowRoot.getElementById('pane-ai');
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      const data = await res.json();
      const translated = data[0].map(x => x[0]).join('');
      el.innerHTML = `<div class="ai-label">翻訳：</div><div class="ai-result">${translated}</div>`;
    } catch (e) {
      el.innerHTML = `<span class="error">エラー: ${e.message}</span>`;
    }
  }

  // ---------- Render clickable words ----------
  function makeClickableSpans(text, sentence) {
    if (!text) return '';
    return text.split('\n').map(line =>
      line.split(' ').map(word => {
        if (!word.trim()) return ' ';
        const escaped = word.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return `<span class="atv-word" data-word="${escaped}" data-sentence="${encodeURIComponent(sentence)}">${escaped}</span>`;
      }).join(' ')
    ).join('<br>');
  }

  // ---------- Right panel rendering ----------
  function renderPanel() {
    if (!shadowRoot) return;
    const list = shadowRoot.getElementById('subtitle-list');
    if (!list) return;

    const currentTime = video ? video.currentTime : 0;
    const allBlocks = [];

    subtitleHistory.forEach(h => {
      if (h.endTime <= currentTime) {
        allBlocks.push({ ...h, state: 'past' });
      }
    });

    const curPrimaryCue = findCueAt(primaryTrack, currentTime);
    const curSecondaryCue = findCueAt(secondaryTrack, currentTime);
    if (curPrimaryCue) {
      allBlocks.push({
        startTime: curPrimaryCue.startTime,
        endTime: curPrimaryCue.endTime,
        primary: cleanCueText(curPrimaryCue),
        secondary: cleanCueText(curSecondaryCue),
        state: 'current'
      });
    }

    if (primaryTrack && primaryTrack.cues) {
      for (let i = 0; i < primaryTrack.cues.length; i++) {
        const c = primaryTrack.cues[i];
        if (c.startTime > currentTime + 0.1) {
          const sc = findCueAt(secondaryTrack, c.startTime + 0.05);
          allBlocks.push({
            startTime: c.startTime,
            endTime: c.endTime,
            primary: cleanCueText(c),
            secondary: cleanCueText(sc),
            state: 'future'
          });
        }
      }
    }

    list.innerHTML = allBlocks.map((block) => {
      const isCurrent = block.state === 'current';
      const isFuture = block.state === 'future';
      const cls = isCurrent ? 'subtitle-block current' : isFuture ? 'subtitle-block subtitle-future' : 'subtitle-block';
      const marker_id = isCurrent ? 'id="current-block"' : '';
      const pText = isCurrent
        ? makeClickableSpans(block.primary, block.primary)
        : (block.primary || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
      const sText = isCurrent
        ? makeClickableSpans(block.secondary, block.primary)
        : (block.secondary || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
      return `
        <div class="${cls}" ${marker_id} data-time="${block.startTime}">
          <div class="subtitle-time">${isCurrent ? '▶ ' : ''}${formatTime(block.startTime)}</div>
          <div class="subtitle-primary">${pText}</div>
          ${sText ? `<div class="subtitle-secondary">${sText}</div>` : ''}
        </div>
      `;
    }).join('');

    // Word click handlers
    const currentBlock = shadowRoot.getElementById('current-block');
    if (currentBlock) {
      currentBlock.querySelectorAll('.atv-word').forEach(span => {
        span.addEventListener('mouseenter', () => span.style.background = 'rgba(255,220,80,0.3)');
        span.addEventListener('mouseleave', () => span.style.background = '');
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const rect = span.getBoundingClientRect();
          showPopup(span.dataset.word, decodeURIComponent(span.dataset.sentence), rect);
        });
      });
      currentBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Seek on block click
    list.querySelectorAll('.subtitle-block[data-time]').forEach(block => {
      block.addEventListener('click', (e) => {
        if (e.target.classList.contains('atv-word')) return;
        e.stopPropagation();
        e.preventDefault();
        const t = parseFloat(block.dataset.time);
        if (video && !isNaN(t)) {
          video.currentTime = t;
          setTimeout(() => renderPanel(), 100);
        }
      });
    });
  }

  // ---------- Overlay (動画左70%エリアの下部) ----------
  function createOverlay() {
    if (document.getElementById('atv-overlay-host')) return;
    const host = document.createElement('div');
    host.id = 'atv-overlay-host';
    host.style.cssText = [
      'position:fixed',
      'bottom:80px',
      'left:0',
      'width:70%',
      'z-index:2147483639',
      'pointer-events:none',
      'text-align:center',
    ].join(';');
    document.body.appendChild(host);

    const overlayRoot = host.attachShadow({ mode: 'open' });
    overlayRoot.innerHTML = `
      <style>
        #overlay {
          display: inline-block;
          background: rgba(0,0,0,0.7);
          border-radius: 6px;
          padding: 6px 16px;
          max-width: 80%;
          text-align: center;
          pointer-events: auto;
        }
        .sub-line {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          font-size: 18px;
          font-weight: 500;
          color: #fff;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9);
          line-height: 1.4;
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

    const sentence = primaryText;
    p.innerHTML = primaryText.split(' ').map(word => {
      const escaped = word.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      return `<span class="atv-word" data-word="${escaped}" data-sentence="${encodeURIComponent(sentence)}">${escaped}</span>`;
    }).join(' ');
    s.textContent = secondaryText || '';

    p.querySelectorAll('.atv-word').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = span.getBoundingClientRect();
        showPopup(span.dataset.word, decodeURIComponent(span.dataset.sentence), rect);
      });
    });
  }

  // ---------- cuechange ----------
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
        endTime: pCue.endTime,
        primary: pText,
        secondary: sText
      });
      if (subtitleHistory.length > 500) subtitleHistory.shift();
    }

    renderPanel();
  }

  // ---------- Toggle panel ----------
  function togglePanel() {
    panelVisible = !panelVisible;
    applyLayout(panelVisible);
    const host = document.getElementById('atv-panel-host');
    const overlayHost = document.getElementById('atv-overlay-host');
    if (host) host.style.display = panelVisible ? '' : 'none';
    if (overlayHost) overlayHost.style.width = panelVisible ? '70%' : '100%';
  }

  // ---------- Toggle button ----------
  function createToggleButton() {
    if (document.getElementById('atv-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'atv-toggle-btn';
    btn.textContent = '📋';
    btn.title = '字幕パネルを切り替え';
    btn.style.cssText = [
      'position:fixed',
      'bottom:20px',
      'right:20px',
      'z-index:2147483647',
      'background:rgba(0,0,0,0.7)',
      'color:white',
      'border:1px solid rgba(255,255,255,0.2)',
      'border-radius:50%',
      'width:40px',
      'height:40px',
      'font-size:18px',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'backdrop-filter:blur(4px)',
    ].join(';');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(btn);
  }

  // ---------- Attach tracks ----------
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

    console.log('[ATV-Bilingual] v2.1 Started:', settings.primaryLang, '+', settings.secondaryLang);
  }

  // ---------- Messages from popup ----------
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

  // ---------- Boot ----------
  waitForVideo(attachTracks);

})();
