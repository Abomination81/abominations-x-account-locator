const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("ships fast server-controlled lookup settings", () => {
  const content = read("content.js");
  assert.match(content, /dataset\.xalVersion = chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(content, /dataset\.xalSecurityModel = "isolated-v1"/);
  assert.match(content, /const MAX_CONCURRENT = 3;/);
  assert.match(content, /const REQUEST_SPACING = 350;/);
  assert.match(content, /const PREFETCH_MARGIN = 300;/);
  assert.match(content, /function nextRelevantUsername\(\)/);
  assert.match(content, /function lookupPriority\(username\)/);
  assert.match(content, /dataset\.xalRateMode = "fast-server-controlled"/);
  assert.match(content, /stored\.pauseReason === "server-429"/);
  assert.match(content, /pauseReason = "server-429"/);
  assert.match(content, /storageSet\(\{ pauseUntil: 0, pauseReason: null \}\)/);
  assert.doesNotMatch(content, /lookupSpacingForRate|RATE_LIMIT_RESERVE/);
  assert.match(content, /signal: AbortSignal\.timeout\(LOOKUP_TIMEOUT_MS\)/);
});
test("keeps authenticated lookups inside the isolated extension world", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.content_scripts.length, 1);
  assert.equal(manifest.content_scripts[0].world, "ISOLATED");
  assert.deepEqual(manifest.content_scripts[0].js, ["shared.js", "content.js"]);
  assert.equal(fs.existsSync(path.join(root, "page-agent.js")), false);
  const content = read("content.js");
  assert.match(content, /async function lookupAccount\(username, allowQueryRefresh = true\)/);
  assert.match(content, /const queryId = aboutQueryId \|\| FALLBACK_QUERY_ID/);
  assert.match(content, /void discoverQueryId\(\)/);
  for (const name of ["csrfToken", "discoverQueryId", "rateInfo", "lookupAccount"]) {
    assert.equal((content.match(new RegExp(`function ${name}\\b`, "g")) || []).length, 1, name);
  }
  assert.doesNotMatch(content, /postMessage|lookup-result|addEventListener\("message"/);
  assert.doesNotMatch(content, /globalThis\.fetch\s*=|XMLHttpRequest\.prototype/);
});
test("repairs recycled posts and removed badges", () => {
  const content = read("content.js");
  assert.match(content, /function markDirtyFromNode\(node\)/);
  assert.match(content, /characterData: true/);
  assert.match(content, /attributes: true/);
});
test("supports quoted posts, custom colors, and status display", () => {
  assert.match(read("content.js"), /const QUOTE_SELECTOR/);
  assert.match(read("styles.css"), /\.xal-quote-surface > \.xal-badge/);
  assert.match(read("popup.html"), /id="badge-color"/);
  assert.match(read("popup.html"), /id="lookup-status"/);
  assert.match(read("popup.html"), /id="country-color-form"/);
  assert.match(read("popup.html"), /South Asia, Southeast Asia, and Africa default to red/);
  assert.match(read("popup.html"), /Follower-list warning:/);
  assert.match(read("popup.js"), /function updateLocationColors\(mutator\)/);
  assert.match(read("content.js"), /shared\.accentColorForLocation\(/);
});
test("supports follower and following user rows without affecting suggestions", () => {
  const content = read("content.js");
  assert.match(content, /const USER_CELL_SELECTOR = '\[data-testid="UserCell"\]';/);
  assert.match(content, /function usernameForUserCell\(userCell\)/);
  assert.match(content, /function isFollowerListPath\(\)/);
  assert.match(read("styles.css"), /\[data-testid="UserCell"\] \.xal-user-cell-badge/);
  assert.match(content, /function badgeHostForSurface\(surface\)/);
  assert.match(content, /shared\.userCellDisplayNameIndex\(/);
  assert.match(content, /displayNameLink\?\.firstElementChild/);
  assert.match(content, /document\.createElement\(isUserCell \? "span" : "a"\)/);
  assert.match(read("styles.css"), /\.xal-user-cell-identity-line/);
  assert.match(read("styles.css"), /align-self: center/);
});
test("skips location lookups and badges for the signed-in account", () => {
  const content = read("content.js");
  assert.match(content, /function detectOwnUsername\(\)/);
  assert.match(content, /function skipOwnSurface\(surface, username\)/);
  assert.match(content, /shared\.sameUsername\(username, ownUsername\)/);
  assert.match(content, /if \(shared\.sameUsername\(username, ownUsername\)\) return void pumpQueue\(\)/);
});
test("renders the Abomination81 override without a location lookup", () => {
  const content = read("content.js");
  assert.match(content, /const overrideLocation = shared\.locationOverride\(username\)/);
  assert.match(content, /override: true/);
  assert.ok(content.indexOf("const overrideLocation") < content.indexOf("const cached = validCache"));
});
test("manifest and icons are valid", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, "0.9.1");
  for (const icon of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(path.join(root, icon)), `${icon} should exist`);
  }
});
