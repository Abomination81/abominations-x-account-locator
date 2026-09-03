const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const context = { URL };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "shared.js"), "utf8"), context);
const shared = context.XAccountLocationShared;

test("normalizes X usernames and quote handles", () => {
  assert.equal(shared.normalizeUsername("@HeyNavToor"), "heynavtoor");
  assert.equal(shared.usernameFromHandleText("@culturainquieta"), "culturainquieta");
  assert.equal(shared.usernameFromHandleText("hello @name"), null);
});
test("extracts follower usernames from X user-cell identity links", () => {
  assert.equal(
    shared.usernameFromUserCellParts(["", "ChefofBets", "@BaseonethL2"], [
      "/BaseonethL2",
      "/BaseonethL2",
      "/BaseonethL2"
    ]),
    "baseonethl2"
  );
  assert.equal(shared.usernameFromUserCellParts(["Display name"], ["/FallbackUser"]), "fallbackuser");
  assert.equal(shared.usernameFromUserCellParts([], ["/home"]), null);
});
test("selects the display-name link instead of the handle row", () => {
  const texts = ["", "Clover 🍀", "@investclover", "USA"];
  const hrefs = ["/investclover", "/investclover", "/investclover", "/investclover/about"];
  assert.equal(shared.userCellDisplayNameIndex(texts, hrefs, "investclover"), 1);
  assert.equal(
    shared.userCellDisplayNameIndex(["", "ChefofBets", "@BaseonethL2"], [
      "/BaseonethL2",
      "/BaseonethL2",
      "/BaseonethL2"
    ], "baseonethl2"),
    1
  );
  assert.equal(shared.userCellDisplayNameIndex(["", "@same"], ["/same", "/same"], "same"), 1);
  assert.equal(shared.userCellDisplayNameIndex(["Display name"], ["/someone"], null), -1);
});
test("extracts status authors", () => {
  assert.equal(shared.usernameFromStatusHref("/HeyNavToor/status/123456"), "heynavtoor");
});
test("extracts the signed-in username only from profile links", () => {
  assert.equal(shared.usernameFromProfileHref("/Abomination81"), "abomination81");
  assert.equal(shared.usernameFromProfileHref("https://x.com/Abomination81/"), "abomination81");
  assert.equal(shared.usernameFromProfileHref("/home"), null);
  assert.equal(shared.usernameFromProfileHref("/someone/status/123"), null);
});
test("matches the signed-in account case-insensitively", () => {
  assert.equal(shared.sameUsername("@Abomination81", "abomination81"), true);
  assert.equal(shared.sameUsername("Abomination81", "someone_else"), false);
  assert.equal(shared.sameUsername(null, "abomination81"), false);
});
test("uses the Xanadu location override only for Abomination81", () => {
  assert.equal(shared.locationOverride("Abomination81"), "Xanadu");
  assert.equal(shared.locationOverride("@ABOMINATION81"), "Xanadu");
  assert.equal(shared.locationOverride("someone_else"), null);
});
test("applies location abbreviations", () => {
  assert.equal(shared.displayLocation("United States"), "USA");
  assert.equal(shared.displayLocation("North America"), "N. America");
  assert.equal(shared.displayLocation("United Kingdom"), "UK");
  assert.equal(shared.displayLocation("India"), "INDIA");
});
test("validates badge colors", () => {
  assert.equal(shared.normalizeAccentColor("#A1B2C3"), "#a1b2c3");
  assert.equal(shared.normalizeAccentColor("red"), "#39ff14");
});
test("matches country color rules with common abbreviations and a default fallback", () => {
  assert.equal(shared.locationColorKey("USA"), "united states");
  assert.equal(shared.locationColorKey("U.K."), "united kingdom");
  assert.equal(shared.locationColorKey(" India "), "india");
  assert.deepEqual(
    { ...shared.normalizeLocationColors({ USA: "#112233", India: "#FF8800", Bad: "orange" }) },
    { "united states": "#112233", india: "#ff8800" }
  );
  assert.equal(
    shared.accentColorForLocation("United States", { USA: "#112233" }, "#39ff14"),
    "#112233"
  );
  assert.equal(shared.accentColorForLocation("Canada", {}, "#abcdef"), "#abcdef");
});
test("defaults South Asia, Southeast Asia, and African locations to red", () => {
  for (const location of [
    "India",
    "South Asia",
    "Pakistan",
    "Bangladesh",
    "Southeast Asia",
    "SE Asia",
    "Indonesia",
    "Vietnam",
    "Africa",
    "Nigeria",
    "Kenya",
    "South Africa"
  ]) {
    assert.equal(shared.accentColorForLocation(location, {}, "#39ff14"), "#ff0000", location);
  }
  assert.equal(shared.accentColorForLocation("Japan", {}, "#39ff14"), "#39ff14");
});
test("country and region rules override built-in red defaults", () => {
  assert.equal(
    shared.accentColorForLocation("Nigeria", { Africa: "#112233" }, "#39ff14"),
    "#112233"
  );
  assert.equal(
    shared.accentColorForLocation("Nigeria", { Africa: "#112233", Nigeria: "#abcdef" }, "#39ff14"),
    "#abcdef"
  );
  assert.equal(
    shared.accentColorForLocation("Indonesia", { "SE Asia": "#445566" }, "#39ff14"),
    "#445566"
  );
  assert.equal(
    shared.accentColorForLocation("Pakistan", { "South Asia": "#778899" }, "#39ff14"),
    "#778899"
  );
});
test("clamps rate-limit headers before they control lookup scheduling", () => {
  const now = 1_000_000;
  assert.deepEqual(
    { ...shared.normalizeRateInfo("12", String((now + 60_000) / 1000), "30", now) },
    { remaining: 12, resetAt: now + 60_000, retryAfterAt: now + 30_000 }
  );
  assert.deepEqual(
    { ...shared.normalizeRateInfo(null, null, null, now) },
    { remaining: null, resetAt: null, retryAfterAt: null }
  );
  assert.deepEqual(
    { ...shared.normalizeRateInfo("-1", "999999999999", "999999", now) },
    { remaining: null, resetAt: null, retryAfterAt: null }
  );
});
test("parses AboutAccount responses and query ids", () => {
  const result = shared.parseAboutPayload({ data: { user_result_by_screen_name: { result: {
    __typename: "User", about_profile: { account_based_in: " India ", location_accurate: false }
  } } } });
  assert.deepEqual({ ...result }, { location: "India", accurate: false });
  assert.equal(shared.parseAboutQueryId('params:{id:"abc",name:"AboutAccountQuery"}'), "abc");
});
