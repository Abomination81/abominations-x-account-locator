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
test("parses AboutAccount responses and query ids", () => {
  const result = shared.parseAboutPayload({ data: { user_result_by_screen_name: { result: {
    __typename: "User", about_profile: { account_based_in: " India ", location_accurate: false }
  } } } });
  assert.deepEqual({ ...result }, { location: "India", accurate: false });
  assert.equal(shared.parseAboutQueryId('params:{id:"abc",name:"AboutAccountQuery"}'), "abc");
});
