// popup.js v2.5

const FALLBACK_LANGS = [
  { lang: "en", label: "English" },
  { lang: "ja", label: "日本語" },
  { lang: "zh", label: "中文" },
  { lang: "ko", label: "한국어" },
  { lang: "fr", label: "Français" },
  { lang: "de", label: "Deutsch" },
  { lang: "es", label: "Español" },
];

const GENERAL_KEYS = [
  'primaryLang',
  'secondaryLang',
  'showSidebar',
  'pinSidebar',
  'playWordAudio',
  'enableAiTooltip',
  'preferredAiProvider',
];

const primarySel = document.getElementById("primary-lang");
const secondarySel = document.getElementById("secondary-lang");
const applyBtn = document.getElementById("apply-btn");
const statusEl = document.getElementById("status");
const openOptionsBtn = document.getElementById("open-options-btn");

function populateSelects(langs) {
  [primarySel, secondarySel].forEach((sel, idx) => {
    const saved =
      idx === 0
        ? localStorage.getItem("primaryLang") || "en"
        : localStorage.getItem("secondaryLang") || "ja";
    sel.innerHTML = "";
    langs.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.lang;
      opt.textContent = l.label ? `${l.label} (${l.lang})` : l.lang;
      if (l.lang === saved) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

// Load saved settings from storage.sync
chrome.storage.sync.get(GENERAL_KEYS, (result) => {
  const savedPrimary = result.primaryLang || "en";
  const savedSecondary = result.secondaryLang || "ja";

  // Try to get language list from content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      populateSelects(FALLBACK_LANGS);
      return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { type: "GET_LANGUAGES" }, (resp) => {
      const langs = resp && resp.length > 0 ? resp : FALLBACK_LANGS;
      populateSelects(langs);
      // Restore saved values
      primarySel.value = savedPrimary;
      secondarySel.value = savedSecondary;
    });
  });
});

// Apply button
applyBtn.addEventListener("click", () => {
  const primaryLang = primarySel.value;
  const secondaryLang = secondarySel.value;

  const settingsToSave = {
    primaryLang,
    secondaryLang,
  };

  chrome.storage.sync.set(settingsToSave, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "SETTINGS_CHANGED",
        settings: settingsToSave,
      });
    });
    statusEl.textContent = "✓ 保存しました";
    setTimeout(() => window.close(), 800);
  });
});

if (openOptionsBtn) {
  openOptionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}
