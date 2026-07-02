const DEFAULT_GENERAL_SETTINGS = {
  primaryLang: "en",
  secondaryLang: "",
  showSidebar: true,
  pinSidebar: false,
  playWordAudio: true,
  enableAiTooltip: true,
  preferredAiProvider: "auto",
};

const DEFAULT_LOCAL_SETTINGS = {
  googleAiStudioApiKey: "",
  groqApiKey: "",
};

const els = {
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  form: document.getElementById("optionsForm"),
  primaryLang: document.getElementById("primaryLang"),
  secondaryLang: document.getElementById("secondaryLang"),
  showSidebar: document.getElementById("showSidebar"),
  pinSidebar: document.getElementById("pinSidebar"),
  playWordAudio: document.getElementById("playWordAudio"),
  enableAiTooltip: document.getElementById("enableAiTooltip"),
  googleAiStudioApiKey: document.getElementById("googleAiStudioApiKey"),
  groqApiKey: document.getElementById("groqApiKey"),
  toggleGoogleKey: document.getElementById("toggleGoogleKey"),
  toggleGroqKey: document.getElementById("toggleGroqKey"),
};

function getPreferredAiProvider() {
  const checked = document.querySelector(
    'input[name="preferredAiProvider"]:checked',
  );
  return checked ? checked.value : "auto";
}

function setPreferredAiProvider(value) {
  const target =
    document.querySelector(
      `input[name="preferredAiProvider"][value="${value}"]`,
    ) ||
    document.querySelector('input[name="preferredAiProvider"][value="auto"]');
  if (target) target.checked = true;
}

function showSaveStatus(message, isError = false) {
  els.saveStatus.textContent = message;
  els.saveStatus.style.color = isError ? "#ff8b8b" : "#7bd88f";
  clearTimeout(showSaveStatus._timer);
  showSaveStatus._timer = setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2800);
}

function toggleSecretInput(inputEl, buttonEl) {
  const show = inputEl.type === "password";
  inputEl.type = show ? "text" : "password";
  buttonEl.textContent = show ? "非表示" : "表示";
}

async function loadSettings() {
  const [general, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_GENERAL_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS),
  ]);

  els.primaryLang.value = general.primaryLang;
  els.secondaryLang.value = general.secondaryLang;
  els.showSidebar.checked = Boolean(general.showSidebar);
  els.pinSidebar.checked = Boolean(general.pinSidebar);
  els.playWordAudio.checked = Boolean(general.playWordAudio);
  els.enableAiTooltip.checked = Boolean(general.enableAiTooltip);
  setPreferredAiProvider(general.preferredAiProvider);

  els.googleAiStudioApiKey.value = local.googleAiStudioApiKey || "";
  els.groqApiKey.value = local.groqApiKey || "";
}

async function saveSettings() {
  const primaryLang = els.primaryLang.value;
  if (!primaryLang) {
    showSaveStatus("勉強している言語を選択してください", true);
    els.primaryLang.focus();
    return;
  }

  const generalSettings = {
    primaryLang,
    secondaryLang: els.secondaryLang.value,
    showSidebar: els.showSidebar.checked,
    pinSidebar: els.pinSidebar.checked,
    playWordAudio: els.playWordAudio.checked,
    enableAiTooltip: els.enableAiTooltip.checked,
    preferredAiProvider: getPreferredAiProvider(),
  };

  const localSettings = {
    googleAiStudioApiKey: els.googleAiStudioApiKey.value.trim(),
    groqApiKey: els.groqApiKey.value.trim(),
  };

  await Promise.all([
    chrome.storage.sync.set(generalSettings),
    chrome.storage.local.set(localSettings),
  ]);

  showSaveStatus("設定を保存しました");
}

function bindEvents() {
  els.saveBtn.addEventListener("click", saveSettings);
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings();
  });
  els.toggleGoogleKey.addEventListener("click", () => {
    toggleSecretInput(els.googleAiStudioApiKey, els.toggleGoogleKey);
  });
  els.toggleGroqKey.addEventListener("click", () => {
    toggleSecretInput(els.groqApiKey, els.toggleGroqKey);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadSettings();
});
