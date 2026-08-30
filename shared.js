(function initShared(root) {
  "use strict";

  const BRIDGE_SOURCE = "abominations-x-account-locator";
  const DEFAULT_ACCENT_COLOR = "#39ff14";
  const ABBREVIATIONS = Object.freeze({
    "united states": "USA",
    "north america": "N. America",
    "united kingdom": "UK"
  });
  const LOCATION_OVERRIDES = Object.freeze({
    abomination81: "Xanadu"
  });
  const RESERVED_PROFILE_PATHS = new Set([
    "compose",
    "explore",
    "home",
    "i",
    "login",
    "logout",
    "messages",
    "notifications",
    "privacy",
    "search",
    "settings",
    "tos"
  ]);

  function normalizeUsername(value) {
    const username = String(value || "").replace(/^@/, "").trim();
    return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username.toLowerCase() : null;
  }

  function usernameFromHandleText(value) {
    const match = String(value || "").trim().match(/^@([A-Za-z0-9_]{1,15})$/);
    return match ? normalizeUsername(match[1]) : null;
  }

  function usernameFromUserCellParts(handleTexts, profileHrefs) {
    for (const value of Array.isArray(handleTexts) ? handleTexts : []) {
      const username = usernameFromHandleText(value);
      if (username) return username;
    }
    for (const value of Array.isArray(profileHrefs) ? profileHrefs : []) {
      const username = usernameFromProfileHref(value);
      if (username) return username;
    }
    return null;
  }

  function usernameFromStatusHref(value) {
    if (!value) return null;
    try {
      const match = new URL(value, "https://x.com").pathname.match(
        /^\/([A-Za-z0-9_]{1,15})\/status\/\d+/
      );
      return match ? normalizeUsername(match[1]) : null;
    } catch {
      return null;
    }
  }

  function usernameFromProfileHref(value) {
    if (!value) return null;
    try {
      const match = new URL(value, "https://x.com").pathname.match(
        /^\/([A-Za-z0-9_]{1,15})\/?$/
      );
      const username = match ? normalizeUsername(match[1]) : null;
      return username && !RESERVED_PROFILE_PATHS.has(username) ? username : null;
    } catch {
      return null;
    }
  }

  function sameUsername(left, right) {
    const normalizedLeft = normalizeUsername(left);
    const normalizedRight = normalizeUsername(right);
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }

  function locationOverride(value) {
    const username = normalizeUsername(value);
    return username ? LOCATION_OVERRIDES[username] || null : null;
  }

  function normalizeLocation(value) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized && normalized.length <= 100 ? normalized : null;
  }

  function displayLocation(value) {
    const normalized = normalizeLocation(value);
    if (!normalized) return null;
    return ABBREVIATIONS[normalized.toLowerCase()] || normalized.toUpperCase();
  }

  function normalizeAccentColor(value) {
    const color = String(value || "").trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_ACCENT_COLOR;
  }

  function parseAboutPayload(payload) {
    const result = payload?.data?.user_result_by_screen_name?.result;
    if (!result || result.__typename === "UserUnavailable") {
      return { location: null, accurate: null };
    }
    return {
      location: normalizeLocation(result?.about_profile?.account_based_in),
      accurate:
        typeof result?.about_profile?.location_accurate === "boolean"
          ? result.about_profile.location_accurate
          : null
    };
  }

  function parseAboutQueryId(source) {
    if (typeof source !== "string") return null;
    for (const pattern of [
      /params\s*:\s*\{[\s\S]*?id\s*:\s*["']([^"']+)["'][\s\S]*?name\s*:\s*["']AboutAccountQuery["']/,
      /\/graphql\/([^/]+)\/AboutAccountQuery/
    ]) {
      const match = source.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  root.XAccountLocationShared = Object.freeze({
    BRIDGE_SOURCE,
    DEFAULT_ACCENT_COLOR,
    displayLocation,
    locationOverride,
    normalizeAccentColor,
    normalizeLocation,
    normalizeUsername,
    parseAboutPayload,
    parseAboutQueryId,
    sameUsername,
    usernameFromHandleText,
    usernameFromProfileHref,
    usernameFromStatusHref,
    usernameFromUserCellParts
  });
})(globalThis);
