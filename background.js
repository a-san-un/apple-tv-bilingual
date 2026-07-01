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
  //   - "sort" is a REQUIRED parameter (400 error without it)
  //   - "trans:lang=jpn" filters to only sentences that have a Japanese translation
  //   - Response: data[].translations is a FLAT array of translation objects
  //     [{id, text, lang, ...}] — NOT double-nested.
  if (msg.type === 'FETCH_TATOEBA') {
    const url = [
      'https://api.tatoeba.org/unstable/sentences',
      `?q=${encodeURIComponent(msg.word)}`,
      '&lang=eng',
      '&sort=relevance',   // REQUIRED — API returns 400 without this
      '&trans:lang=jpn',   // only return sentences that have a jpn translation
      '&limit=10',         // fetch extra so we can filter to 5 with translations
    ].join('');

    fetch(url)
      .then(r => r.json())
      .then(data => {
        const rows = data.data ?? [];

        // translations is a flat array: [{id, text, lang, ...}, ...]
        const results = [];
        for (const s of rows) {
          if (!s.text) continue;
          const trans = Array.isArray(s.translations) ? s.translations : [];
          const jpn = trans.find(t => t && t.lang === 'jpn');
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
