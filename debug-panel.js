// =============================================================
// Apple TV+ Bilingual Subtitles - debug-panel.js
// version: 2.6.2
// 役割: 右字幕パネル下部の Debug UI 入口を提供する。
// Phase C: mount/update/clear/unmount の API スケルトンのみを固定する。
// =============================================================
(function () {
  "use strict";

  window.ATVB = window.ATVB || {};

  let activeEntry = null;

  async function readLogText(entry) {
    if (!entry || typeof entry.deps.getLogText !== "function") return "";
    const filter =
      typeof entry.deps.getFilter === "function" ? entry.deps.getFilter() : {};
    return (await entry.deps.getLogText(filter)) || "";
  }

  async function update() {
    if (!activeEntry?.root) return;

    const textarea = activeEntry.root.getElementById("debug-log");
    if (!textarea) return;

    const text = await readLogText(activeEntry);
    textarea.value = text;
    textarea.scrollTop = textarea.scrollHeight;
  }

  async function clear() {
    if (!activeEntry) return;
    if (typeof activeEntry.deps.clearLogs === "function") {
      await activeEntry.deps.clearLogs();
    }
    await update();
  }

  function unmount() {
    if (!activeEntry?.root) {
      activeEntry = null;
      return;
    }

    const { root, handlers } = activeEntry;
    root
      .getElementById("debugSectionToggle")
      ?.removeEventListener("click", handlers.onToggle);
    root
      .getElementById("debugCopyBtn")
      ?.removeEventListener("click", handlers.onCopy);
    root
      .getElementById("debugDownloadBtn")
      ?.removeEventListener("click", handlers.onDownload);
    root
      .getElementById("debugClearBtn")
      ?.removeEventListener("click", handlers.onClear);

    const section = root.getElementById("debug-section");
    if (section) delete section.dataset.bound;
    activeEntry = null;
  }

  function mount(root, deps = {}) {
    if (!root) return null;
    if (activeEntry?.root && activeEntry.root !== root) {
      unmount();
    }

    const section = root.getElementById("debug-section");
    if (!section) return null;

    if (activeEntry?.root === root && section.dataset.bound === "1") {
      update();
      return activeEntry;
    }

    const toggleBtn = root.getElementById("debugSectionToggle");
    const body = root.getElementById("debugSectionBody");

    const handlers = {
      onToggle: () => {
        if (!toggleBtn || !body) return;
        const isHidden = body.hidden;
        body.hidden = !isHidden;
        toggleBtn.textContent = isHidden ? "▼" : "▶";
        toggleBtn.setAttribute("aria-expanded", String(isHidden));
      },
      onCopy: async () => {
        const text = await readLogText(activeEntry);
        try {
          if (typeof deps.copyText === "function") {
            await deps.copyText(text);
          } else {
            await navigator.clipboard.writeText(text);
          }
          if (typeof deps.logInfo === "function") {
            deps.logInfo("Debug panel copied logs", {
              lineCount: text ? text.split("\n").length : 0,
            });
          }
        } catch (error) {
          if (typeof deps.logError === "function") {
            deps.logError("Debug panel copy failed", { error: String(error) });
          }
        }
      },
      onDownload: async () => {
        const text = await readLogText(activeEntry);
        if (typeof deps.downloadLogs !== "function") return;

        deps.downloadLogs(text, (result = {}) => {
          if (result.ok) {
            if (typeof deps.logInfo === "function") {
              deps.logInfo("Debug panel downloaded logs", {
                lineCount: text ? text.split("\n").length : 0,
                downloadId: result.downloadId ?? null,
              });
            }
            return;
          }

          if (typeof deps.logError === "function") {
            deps.logError("Debug panel download failed", {
              error: result.error ?? "unknown",
            });
          }
        });
      },
      onClear: async () => {
        try {
          await clear();
        } catch (error) {
          if (typeof deps.logError === "function") {
            deps.logError("Debug panel clear failed", { error: String(error) });
          }
        }
      },
    };

    activeEntry = {
      root,
      deps,
      handlers,
    };

    if (toggleBtn && body) {
      body.hidden = true;
      toggleBtn.textContent = "▶";
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.addEventListener("click", handlers.onToggle);
    }

    root
      .getElementById("debugCopyBtn")
      ?.addEventListener("click", handlers.onCopy);
    root
      .getElementById("debugDownloadBtn")
      ?.addEventListener("click", handlers.onDownload);
    root
      .getElementById("debugClearBtn")
      ?.addEventListener("click", handlers.onClear);

    section.dataset.bound = "1";
    update();
    return activeEntry;
  }

  window.ATVB.debugPanel = {
    mount,
    update,
    clear,
    unmount,
  };
})();
