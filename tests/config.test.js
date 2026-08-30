const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("ships balanced adaptive lookup settings", () => {
  const content = read("content.js");
  assert.match(content, /const MAX_CONCURRENT = 3;/);
  assert.match(content, /const BASE_SPACING = 350;/);
  assert.match(content, /const PREFETCH_MARGIN = 300;/);
  assert.match(content, /function nextRelevantUsername\(\)/);
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
});
test("manifest and icons are valid", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, "0.5.0");
  for (const icon of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(path.join(root, icon)), `${icon} should exist`);
  }
});
