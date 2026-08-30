(function initPopup() {
  "use strict";
  const shared = globalThis.XAccountLocationShared;
  const enabled = document.querySelector("#enabled");
  const badgeColor = document.querySelector("#badge-color");
  const resetColor = document.querySelector("#reset-color");
  const clearCache = document.querySelector("#clear-cache");
  const cacheCount = document.querySelector("#cache-count");
  const averageLookup = document.querySelector("#average-lookup");
  const lookupStatus = document.querySelector("#lookup-status");

  function statusLabel(stats) {
    if (stats?.status === "paused" && stats.retryAt) {
      const minutes = Math.max(1, Math.ceil((stats.retryAt - Date.now()) / 60_000));
      return `X limit: retry in ${minutes}m`;
    }
    const labels = {
      active: "Active",
      "authorization-needed": "Reload X / sign in",
      timeout: "X timed out",
      "network-error": "Network error",
      "request-failed": "X request failed"
    };
    return labels[stats?.status] || stats?.status || "Active";
  }

  function render(stored) {
    enabled.checked = stored.settings?.enabled !== false;
    badgeColor.value = shared.normalizeAccentColor(stored.settings?.badgeColor);
    cacheCount.textContent = Object.keys(stored.locationCache || {}).length.toLocaleString();
    averageLookup.textContent = stored.performanceStats?.completed
      ? `${Math.round(stored.performanceStats.averageMs)} ms`
      : "Not measured";
    lookupStatus.textContent = statusLabel(stored.performanceStats);
  }

  chrome.storage.local.get(["settings", "locationCache", "performanceStats"], render);
  chrome.storage.onChanged.addListener(() => {
    chrome.storage.local.get(["settings", "locationCache", "performanceStats"], render);
  });

  function updateSettings(patch) {
    chrome.storage.local.get("settings", (stored) => {
      chrome.storage.local.set({ settings: { ...(stored.settings || {}), ...patch } });
    });
  }
  enabled.addEventListener("change", () => updateSettings({ enabled: enabled.checked }));
  badgeColor.addEventListener("input", () => updateSettings({ badgeColor: badgeColor.value }));
  resetColor.addEventListener("click", () => {
    badgeColor.value = shared.DEFAULT_ACCENT_COLOR;
    updateSettings({ badgeColor: shared.DEFAULT_ACCENT_COLOR });
  });
  clearCache.addEventListener("click", () => {
    chrome.storage.local.set({ locationCache: {}, pauseUntil: 0 }, () => {
      clearCache.textContent = "Cache cleared";
      setTimeout(() => (clearCache.textContent = "Clear local cache"), 1200);
    });
  });
})();
