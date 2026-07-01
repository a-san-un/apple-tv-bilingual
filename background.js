// =============================================================
// background.js - Service Worker
// =============================================================
// Content scripts run in the page context and are subject to
// the page's CORS policy. Fetches from tv.apple.com to external
// APIs (jisho.org, translate.googleapis.com) are blocked.
//
// Solution: route all external API calls through this service
// worker, which is NOT subject to CORS restrictions.
// =============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ---------- Dictionary lookup (Jisho) ----------
  if (msg.type === 'FETCH_DICT') {
    fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(msg.word)}`)
      .then(r => r.json())
      .then(data => {
        const entry = data.data?.[0];
        if (entry) {
          sendResponse({
            ok: true,
            reading:  entry.japanese?.[0]?.reading ?? '',
            meanings: entry.senses?.[0]?.english_definitions?.slice(0, 3).join(', ') ?? ''
          });
        } else {
          sendResponse({ ok: false, error: 'not_found' });
        }
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep message channel open for async response
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

});
