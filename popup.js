(function initPopup() {
  "use strict";
  const shared = globalThis.XAccountLocationShared;
  const enabled = document.querySelector("#enabled");
  const badgeColor = document.querySelector("#badge-color");
  const resetColor = document.querySelector("#reset-color");
  const countryColorForm = document.querySelector("#country-color-form");
  const countryName = document.querySelector("#country-name");
  const countryColor = document.querySelector("#country-color");
  const countryOptions = document.querySelector("#country-options");
  const countryColorList = document.querySelector("#country-color-list");
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
    renderCountryOptions(stored.locationCache);
    renderCountryColors(stored.settings?.locationColors);
    cacheCount.textContent = Object.keys(stored.locationCache || {}).length.toLocaleString();
    averageLookup.textContent = stored.performanceStats?.completed
      ? `${Math.round(stored.performanceStats.averageMs)} ms`
      : "Not measured";
    lookupStatus.textContent = statusLabel(stored.performanceStats);
  }

  function renderCountryOptions(locationCache) {
    const locations = new Map();
    for (const item of Object.values(locationCache || {})) {
      const key = shared.locationColorKey(item?.location);
      if (key && !locations.has(key)) locations.set(key, item.location);
    }
    countryOptions.replaceChildren(
      ...[...locations.values()].sort().map((location) => {
        const option = document.createElement("option");
        option.value = location;
        return option;
      })
    );
  }

  function renderCountryColors(value) {
    const colors = shared.normalizeLocationColors(value);
    const entries = Object.entries(colors).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = "No country-specific colors yet.";
      countryColorList.replaceChildren(empty);
      return;
    }

    countryColorList.replaceChildren(
      ...entries.map(([location, color]) => {
        const row = document.createElement("div");
        row.className = "country-color-rule";

        const label = document.createElement("span");
        label.textContent = shared.displayLocation(location);
        label.title = location;

        const picker = document.createElement("input");
        picker.type = "color";
        picker.value = color;
        picker.dataset.location = location;
        picker.setAttribute("aria-label", `Color for ${location}`);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-rule";
        remove.dataset.location = location;
        remove.setAttribute("aria-label", `Remove color for ${location}`);
        remove.textContent = "Remove";

        row.append(label, picker, remove);
        return row;
      })
    );
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

  function updateLocationColors(mutator) {
    chrome.storage.local.get("settings", (stored) => {
      const colors = { ...shared.normalizeLocationColors(stored.settings?.locationColors) };
      mutator(colors);
      chrome.storage.local.set({
        settings: { ...(stored.settings || {}), locationColors: colors }
      });
    });
  }
  enabled.addEventListener("change", () => updateSettings({ enabled: enabled.checked }));
  badgeColor.addEventListener("input", () => updateSettings({ badgeColor: badgeColor.value }));
  resetColor.addEventListener("click", () => {
    badgeColor.value = shared.DEFAULT_ACCENT_COLOR;
    updateSettings({ badgeColor: shared.DEFAULT_ACCENT_COLOR });
  });
  countryColorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const location = shared.locationColorKey(countryName.value);
    if (!location) {
      countryName.setCustomValidity("Enter a country or region.");
      countryName.reportValidity();
      return;
    }
    countryName.setCustomValidity("");
    updateLocationColors((colors) => {
      colors[location] = shared.normalizeAccentColor(countryColor.value);
    });
    countryName.value = "";
    countryName.focus();
  });
  countryName.addEventListener("input", () => countryName.setCustomValidity(""));
  countryColorList.addEventListener("input", (event) => {
    if (!event.target.matches('input[type="color"][data-location]')) return;
    const { location } = event.target.dataset;
    updateLocationColors((colors) => {
      colors[location] = shared.normalizeAccentColor(event.target.value);
    });
  });
  countryColorList.addEventListener("click", (event) => {
    const button = event.target.closest("button.remove-rule[data-location]");
    if (!button) return;
    updateLocationColors((colors) => delete colors[button.dataset.location]);
  });
  clearCache.addEventListener("click", () => {
    chrome.storage.local.set({ locationCache: {}, pauseUntil: 0 }, () => {
      clearCache.textContent = "Cache cleared";
      setTimeout(() => (clearCache.textContent = "Clear local cache"), 1200);
    });
  });
})();
