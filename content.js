
// =====================================================
// Apple TV+ Bilingual Subtitles - content.js
// =====================================================

(function () {
  'use strict';

  // ---------- State ----------
  let primaryTrack = null;
  let secondaryTrack = null;
  let overlayEl = null;
  let popupEl = null;
  let settings = { primaryLang: 'en', secondaryLang: 'ja' };

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

  // ---------- Build unique language list ----------
  // Each language has 3 tracks; only index[0] (first one with cues) is active.
  // Rule confirmed by investigation: track[n] has cues, [n+1],[n+2] are empty.
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

  // Find the FIRST track for a language that has cues (or just the first one)
  function findBestTrack(textTracks, lang) {
    const candidates = [];
    for (let i = 0; i < textTracks.length; i++) {
      const t = textTracks[i];
      if ((t.kind === 'subtitles' || t.kind === 'captions') && t.language === lang) {
        candidates.push(t);
      }
    }
    if (candidates.length === 0) return null;
    // Prefer the one that already has cues loaded
    return candidates.find(t => t.cues && t.cues.length > 0) || candidates[0];
  }

  // ---------- Overlay DOM ----------
  function createOverlay() {
    if (document.getElementById('atv-overlay')) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'atv-overlay';
    overlayEl.innerHTML = `
      <div id="atv-primary"></div>
      <div id="atv-secondary"></div>
    `;
    document.body.appendChild(overlayEl);

    popupEl = document.createElement('div');
    popupEl.id = 'atv-popup';
    popupEl.style.display = 'none';
    document.body.appendChild(popupEl);

    // Close popup on outside click
    document.addEventListener('click', (e) => {
      if (!popupEl.contains(e.target) && e.target.tagName !== 'SPAN') {
        popupEl.style.display = 'none';
      }
    });
  }

  // ---------- Render subtitle cue text as clickable words ----------
  function renderClickableText(text, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!text) { el.innerHTML = ''; return; }

    // Split by whitespace but preserve newlines as <br>
    const lines = text.split('\n');
    el.innerHTML = lines.map(line => {
      return line.split(' ').map(word => {
        if (!word.trim()) return '';
        return `<span class="atv-word" data-word="${word.replace(/"/g, '&quot;')}">${word}</span>`;
      }).join(' ');
    }).join('<br>');

    // Attach click handlers
    el.querySelectorAll('.atv-word').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        showPopup(span.dataset.word, span);
      });
    });
  }

  // ---------- cuechange handler ----------
  function onCueChange() {
    const p1 = primaryTrack?.activeCues?.[0]?.text ?? '';
    const p2 = secondaryTrack?.activeCues?.[0]?.text ?? '';
    renderClickableText(p1, 'atv-primary');
    renderClickableText(p2, 'atv-secondary');
  }

  // ---------- Dictionary popup ----------
  function showPopup(word, anchorEl) {
    if (!popupEl) return;
    // Clean word (remove punctuation)
    const clean = word.replace(/[^a-zA-Z\u3040-\u9FFF\uFF00-\uFFEF]/g, '');
    if (!clean) return;

    popupEl.style.display = 'block';
    popupEl.innerHTML = `
      <div id="atv-popup-header">
        <span id="atv-popup-word">${clean}</span>
        <button id="atv-popup-close">✕</button>
      </div>
      <div id="atv-popup-body">
        <div class="atv-popup-section">
          <div class="atv-popup-label">📖 辞書</div>
          <div id="atv-dict-result" class="atv-popup-content">検索中...</div>
        </div>
        <div class="atv-popup-section">
          <div class="atv-popup-label">🤖 AI翻訳</div>
          <div id="atv-ai-result" class="atv-popup-content">準備中...</div>
        </div>
      </div>
    `;

    // Position popup above the word
    const rect = anchorEl.getBoundingClientRect();
    popupEl.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
    popupEl.style.top = (rect.top - popupEl.offsetHeight - 12) + 'px';

    document.getElementById('atv-popup-close').addEventListener('click', () => {
      popupEl.style.display = 'none';
    });

    // Fetch dictionary (Jisho API for Japanese words)
    fetchDictionary(clean);
    // AI translation placeholder (API key required)
    fetchAITranslation(clean);
  }

  async function fetchDictionary(word) {
    const el = document.getElementById('atv-dict-result');
    if (!el) return;
    try {
      // Jisho API - works for Japanese/English
      const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const entry = data.data[0];
        const reading = entry.japanese?.[0]?.reading ?? '';
        const meanings = entry.senses?.[0]?.english_definitions?.slice(0, 3).join(', ') ?? '';
        el.innerHTML = `
          <div class="atv-dict-reading">${reading}</div>
          <div class="atv-dict-meaning">${meanings}</div>
        `;
      } else {
        el.textContent = '見つかりませんでした';
      }
    } catch (e) {
      el.textContent = 'エラー: ' + e.message;
    }
  }

  function fetchAITranslation(word) {
    const el = document.getElementById('atv-ai-result');
    if (!el) return;
    // Phase 1: placeholder - will be replaced with actual API call
    // To enable: add OpenAI / Gemini API key in extension settings
    el.innerHTML = `
      <div class="atv-ai-placeholder">
        API キーを設定してください<br>
        <small>popup設定 → AI Translation → APIキー入力</small>
      </div>
    `;
  }

  // ---------- Attach tracks ----------
  function attachTracks(video) {
    chrome.storage.local.get(['primaryLang', 'secondaryLang'], (result) => {
      settings.primaryLang   = result.primaryLang   || 'en';
      settings.secondaryLang = result.secondaryLang || 'ja';
      startBilingual(video);
    });
  }

  function startBilingual(video) {
    const tracks = video.textTracks;

    // Detach old listeners
    if (primaryTrack)   primaryTrack.removeEventListener('cuechange', onCueChange);
    if (secondaryTrack) secondaryTrack.removeEventListener('cuechange', onCueChange);

    // Disable all tracks first (hide native rendering)
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = 'hidden';
    }

    primaryTrack   = findBestTrack(tracks, settings.primaryLang);
    secondaryTrack = findBestTrack(tracks, settings.secondaryLang);

    if (primaryTrack) {
      primaryTrack.mode = 'hidden'; // hidden = cues accessible, no native display
      primaryTrack.addEventListener('cuechange', onCueChange);
    }
    if (secondaryTrack) {
      secondaryTrack.mode = 'hidden';
      secondaryTrack.addEventListener('cuechange', onCueChange);
    }

    createOverlay();
    console.log('[ATV-Bilingual] Started:', settings.primaryLang, '+', settings.secondaryLang);
  }

  // ---------- Listen for settings changes from popup ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      const video = document.querySelector('video');
      if (video) {
        settings.primaryLang   = msg.primaryLang;
        settings.secondaryLang = msg.secondaryLang;
        startBilingual(video);
      }
    }
    if (msg.type === 'GET_LANGUAGES') {
      const video = document.querySelector('video');
      const langs = video ? getUniqueTracks(video.textTracks) : [];
      return Promise.resolve(langs.map(l => ({ lang: l.lang, label: l.label })));
    }
  });

  // ---------- Boot ----------
  waitForVideo(attachTracks);

})();
