(function initShared(root) {
  "use strict";

  const DEFAULT_ACCENT_COLOR = "#39ff14";
  const DEFAULT_ALERT_COLOR = "#ff0000";
  const DEFAULT_LOCATION_COLORS = Object.freeze({
    africa: DEFAULT_ALERT_COLOR,
    india: DEFAULT_ALERT_COLOR,
    "south asia": DEFAULT_ALERT_COLOR,
    "southeast asia": DEFAULT_ALERT_COLOR
  });
  const ABBREVIATIONS = Object.freeze({
    "united states": "USA",
    "north america": "N. America",
    "united kingdom": "UK"
  });
  const LOCATION_COLOR_ALIASES = Object.freeze({
    "n. america": "north america",
    "s.e. asia": "southeast asia",
    "se asia": "southeast asia",
    "s. asia": "south asia",
    "southern asia": "south asia",
    "south east asia": "southeast asia",
    "u.k.": "united kingdom",
    "u.s.": "united states",
    "u.s.a.": "united states",
    uk: "united kingdom",
    usa: "united states",
    "united states of america": "united states"
  });
  const AFRICA_LOCATIONS = new Set([
    "africa",
    "algeria",
    "angola",
    "benin",
    "botswana",
    "burkina faso",
    "burundi",
    "cabo verde",
    "cameroon",
    "cape verde",
    "central african republic",
    "central africa",
    "chad",
    "comoros",
    "congo",
    "congo-brazzaville",
    "congo-kinshasa",
    "cote d'ivoire",
    "cote d’ivoire",
    "côte d'ivoire",
    "côte d’ivoire",
    "democratic republic of the congo",
    "djibouti",
    "east africa",
    "egypt",
    "equatorial guinea",
    "eritrea",
    "eswatini",
    "ethiopia",
    "gabon",
    "gambia",
    "ghana",
    "guinea",
    "guinea-bissau",
    "ivory coast",
    "kenya",
    "lesotho",
    "liberia",
    "libya",
    "madagascar",
    "malawi",
    "mali",
    "mauritania",
    "mauritius",
    "morocco",
    "mozambique",
    "namibia",
    "niger",
    "nigeria",
    "north africa",
    "republic of the congo",
    "rwanda",
    "sao tome and principe",
    "são tomé and príncipe",
    "senegal",
    "seychelles",
    "sierra leone",
    "somalia",
    "south africa",
    "south sudan",
    "southern africa",
    "sub-saharan africa",
    "sudan",
    "swaziland",
    "tanzania",
    "the gambia",
    "togo",
    "tunisia",
    "uganda",
    "west africa",
    "western sahara",
    "zambia",
    "zimbabwe"
  ]);
  const SOUTHEAST_ASIA_LOCATIONS = new Set([
    "brunei",
    "cambodia",
    "east timor",
    "indonesia",
    "laos",
    "malaysia",
    "myanmar",
    "philippines",
    "singapore",
    "southeastern asia",
    "southeast asia",
    "thailand",
    "timor-leste",
    "viet nam",
    "vietnam"
  ]);
  const SOUTH_ASIA_LOCATIONS = new Set([
    "afghanistan",
    "bangladesh",
    "bhutan",
    "india",
    "maldives",
    "nepal",
    "pakistan",
    "south asia",
    "sri lanka"
  ]);
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

  function userCellDisplayNameIndex(linkTexts, linkHrefs, username) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) return -1;

    const texts = Array.isArray(linkTexts) ? linkTexts : [];
    const hrefs = Array.isArray(linkHrefs) ? linkHrefs : [];
    let firstIdentityLink = -1;

    for (let index = 0; index < Math.max(texts.length, hrefs.length); index += 1) {
      if (usernameFromProfileHref(hrefs[index]) !== normalizedUsername) continue;
      const text = String(texts[index] || "").trim();
      if (!text) continue;
      if (firstIdentityLink < 0) firstIdentityLink = index;
      if (!sameUsername(usernameFromHandleText(text), normalizedUsername)) return index;
    }

    return firstIdentityLink;
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

  function locationColorKey(value) {
    const location = normalizeLocation(value);
    if (!location) return null;
    const key = location.toLowerCase();
    return LOCATION_COLOR_ALIASES[key] || key;
  }

  function normalizeLocationColors(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.create(null);
    const colors = Object.create(null);
    for (const [location, colorValue] of Object.entries(value)) {
      const key = locationColorKey(location);
      const color = String(colorValue || "").trim().toLowerCase();
      if (key && /^#[0-9a-f]{6}$/.test(color)) colors[key] = color;
    }
    return colors;
  }

  function locationColorGroupKey(value) {
    const key = locationColorKey(value);
    if (!key) return null;
    if (AFRICA_LOCATIONS.has(key)) return "africa";
    if (SOUTH_ASIA_LOCATIONS.has(key)) return "south asia";
    if (SOUTHEAST_ASIA_LOCATIONS.has(key)) return "southeast asia";
    return null;
  }

  function accentColorForLocation(location, locationColors, fallbackColor) {
    const key = locationColorKey(location);
    const groupKey = locationColorGroupKey(location);
    const colors = normalizeLocationColors(locationColors);
    return (
      (key && colors[key]) ||
      (groupKey && colors[groupKey]) ||
      (key && DEFAULT_LOCATION_COLORS[key]) ||
      (groupKey && DEFAULT_LOCATION_COLORS[groupKey]) ||
      normalizeAccentColor(fallbackColor)
    );
  }

  function normalizeRateInfo(remainingValue, resetValue, retryAfterValue, now = Date.now()) {
    const toNumber = (value) =>
      typeof value === "number" || (typeof value === "string" && value.trim())
        ? Number(value)
        : Number.NaN;
    const remainingNumber = toNumber(remainingValue);
    const remaining =
      Number.isInteger(remainingNumber) && remainingNumber >= 0 && remainingNumber <= 10_000
        ? remainingNumber
        : null;

    const resetNumber = toNumber(resetValue) * 1000;
    const resetAt =
      Number.isFinite(resetNumber) && resetNumber >= now - 60_000 && resetNumber <= now + 86_400_000
        ? resetNumber
        : null;

    const retryAfterNumber = toNumber(retryAfterValue);
    const retryAfterAt =
      Number.isFinite(retryAfterNumber) && retryAfterNumber >= 0 && retryAfterNumber <= 86_400
        ? now + retryAfterNumber * 1000
        : null;

    return { remaining, resetAt, retryAfterAt };
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
    DEFAULT_ACCENT_COLOR,
    DEFAULT_ALERT_COLOR,
    DEFAULT_LOCATION_COLORS,
    accentColorForLocation,
    displayLocation,
    locationColorKey,
    locationColorGroupKey,
    locationOverride,
    normalizeAccentColor,
    normalizeLocationColors,
    normalizeLocation,
    normalizeUsername,
    normalizeRateInfo,
    parseAboutPayload,
    parseAboutQueryId,
    sameUsername,
    userCellDisplayNameIndex,
    usernameFromHandleText,
    usernameFromProfileHref,
    usernameFromStatusHref,
    usernameFromUserCellParts
  });
})(globalThis);
