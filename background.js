// =============================================================
// background.js - Service Worker (v2.5)
// =============================================================
// Content scripts run in the page context and are subject to
// the page's CORS policy. Fetches from tv.apple.com to external
// APIs (jisho.org, translate.googleapis.com, api.tatoeba.org)
// are blocked.
//
// Solution: route all external API calls through this service
// worker, which is NOT subject to CORS restrictions.
//
// SW Keepalive: Manifest V3 service workers auto-stop after
// ~30 seconds of inactivity. The activate handler + onInstalled
// listener help keep the SW registered and responsive.
// =============================================================

// Keep the service worker alive and claim clients immediately on activation
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ATV-Bilingual] background.js installed/updated');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ---------- Dictionary lookup (Jisho) ----------
  if (msg.type === 'FETCH_DICT') {
    fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(msg.word)}`)
      .then(r => r.json())
      .then(data => {
        const entry = data.data?.[0];
        if (!entry) { sendResponse({ ok: false, error: 'not_found' }); return; }

        const reading = entry.japanese?.[0]?.reading ?? '';

        const senses = (entry.senses ?? []).slice(0, 5);
        const meanings = senses.map(s => ({
          definitions:   s.english_definitions ?? [],
          partsOfSpeech: s.parts_of_speech     ?? []
        }));

        const jlptRaw = entry.jlpt?.[0] ?? '';
        const jlpt    = jlptRaw ? jlptRaw.replace('jlpt-', '').toUpperCase() : '';
        const isCommon = entry.is_common ?? false;

        sendResponse({ ok: true, reading, meanings, jlpt, isCommon });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // ---------- Translation (Google Translate) ----------
  if (msg.type === 'FETCH_TRANSLATE') {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(msg.text)}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const translated = data[0].map(x => x[0]).join('');
        sendResponse({ ok: true, translated });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // ---------- Example sentences (Tatoeba) ----------
  // API notes:
  //   - Endpoint: https://api.tatoeba.org/unstable/sentences
  //   - q=<word>&lang=eng  ... search English sentences
  //   - trans:lang=jpn     ... request Japanese translations to be included
  //   - Response: data[].text (English), data[].translations (flat array of
  //     translation objects: [{id, text, lang, ...}])
  //   - We pick the first item whose lang === 'jpn' as the Japanese translation.
  if (msg.type === 'FETCH_TATOEBA') {
    const url = `https://api.tatoeba.org/unstable/sentences?q=${encodeURIComponent(msg.word)}&lang=eng&trans:lang=jpn&limit=10`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const rows = data.data ?? [];

        // translations is a flat array: [{id, text, lang, ...}, ...]
        // Filter sentences that actually have a Japanese translation.
        const results = [];
        for (const s of rows) {
          if (!s.text) continue;
          const trans = Array.isArray(s.translations) ? s.translations : [];
          // Each element can itself be an array (grouped) or a plain object
          const flat = trans.flat ? trans.flat(1) : [].concat(...trans);
          const jpn = flat.find(t => t && t.lang === 'jpn');
          if (jpn) {
            results.push({ text: s.text, translation: jpn.text ?? '' });
          }
          if (results.length >= 5) break;
        }

        sendResponse({ ok: true, results });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

});
