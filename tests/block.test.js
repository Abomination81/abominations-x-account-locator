const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

function client(overrides = {}) {
  const context = { URL, URLSearchParams, AbortSignal };
  vm.createContext(context);
  vm.runInContext(read("shared.js"), context);
  vm.runInContext(read("account-actions.js"), context);
  const calls = [];
  const controller = context.XAccountLocationActions.createBlockController({
    origin: "https://x.com",
    getSession: () => ({ username: "viewer", csrf: "test-csrf", bearer: "test-bearer" }),
    fetch: async (...args) => { calls.push(args); return response({ screen_name: "someone", blocking: true }); },
    ...overrides
  });
  return { controller, calls };
}

test("blocks exactly the requested handle and verifies X's response", async () => {
  const { controller, calls } = client();
  assert.equal((await controller.block("@SomeOne")).ok, true);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, "https://x.com/i/api/1.1/blocks/create.json");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "include");
  assert.equal(options.redirect, "error");
  assert.equal(new URLSearchParams(options.body).get("screen_name"), "someone");
  assert.equal(new URLSearchParams(options.body).get("include_blocking"), "true");
  assert.equal(controller.stateFor("viewer", "someone"), "blocked");
  await controller.block("someone");
  assert.equal(calls.length, 1);
});

test("rejects missing sessions, self-blocks, bad handles, and non-X destinations", async () => {
  for (const [overrides, username, error] of [
    [{}, "VIEWER", "own-account"],
    [{}, "a&screen_name=other", "invalid-target"],
    [{ origin: "https://x.com.evil.example" }, "someone", "invalid-target"],
    [{ getSession: () => ({ csrf: "test" }) }, "someone", "not-signed-in"],
    [{ getSession: () => ({ username: "viewer" }) }, "someone", "not-signed-in"]
  ]) {
    const { controller, calls } = client(overrides);
    assert.equal((await controller.block(username)).error, error);
    assert.equal(calls.length, 0);
  }
});

test("deduplicates in-flight actions and scopes blocked state to the signed-in account", async () => {
  let resolve;
  let viewer = "viewer";
  let requests = 0;
  const { controller } = client({
    getSession: () => ({ username: viewer, csrf: "test", bearer: "test" }),
    fetch: () => { requests++; return new Promise((done) => { resolve = done; }); }
  });
  const first = controller.block("someone");
  assert.equal(controller.stateFor("viewer", "someone"), "pending");
  assert.equal((await controller.block("someone")).error, "busy");
  assert.equal((await controller.block("another")).error, "busy");
  resolve(response({ screen_name: "someone", blocking: true }));
  await first;
  viewer = "other_viewer";
  const second = controller.block("someone");
  resolve(response({ screen_name: "someone", blocking: true }));
  await second;
  assert.equal(requests, 2);
});

test("does not report success for failed, mismatched, or unconfirmed blocks", async () => {
  for (const [status, body, expected] of [
    [401, {}, "not-authorized"], [403, {}, "not-authorized"],
    [500, {}, "request-failed"], [200, { screen_name: "different", blocking: true }, "unconfirmed"],
    [200, { screen_name: "someone", blocking: false }, "unconfirmed"]
  ]) {
    const { controller } = client({ fetch: async () => response(body, status) });
    assert.equal((await controller.block("someone")).error, expected);
    assert.equal(controller.stateFor("viewer", "someone"), "idle");
  }
});

test("honors blocking rate limits without automatically retrying writes", async () => {
  let now = 1_000_000;
  let requests = 0;
  const { controller } = client({
    now: () => now,
    fetch: async () => { requests++; return response({}, 429, { "retry-after": "90" }); }
  });
  assert.equal((await controller.block("someone")).retryAt, now + 90_000);
  assert.equal((await controller.block("another")).error, "rate-limited");
  assert.equal(requests, 1);
  now += 90_001;
  await controller.block("another");
  assert.equal(requests, 2);
});

const profileResult = (username = "someone", blocking = true) => ({ data: { user: { result: {
  core: { screen_name: username }, relationship_perspectives: { blocking }
} } } });

test("accepts legacy and current user response shapes without an extra lookup", async () => {
  for (const body of [
    profileResult(),
    { user: { legacy: { screen_name: "SomeOne", blocking: true } } }
  ]) {
    const calls = [];
    const { controller } = client({ fetch: async (_url, options) => { calls.push(options.method); return response(body); } });
    assert.equal((await controller.block("someone")).ok, true);
    assert.deepEqual(calls, ["POST"]);
  }
});

test("verifies missing confirmation with one uncached read, never a second block", async () => {
  for (const body of [{ screen_name: "someone" }, {}, null]) {
    const calls = [];
    const { controller } = client({ fetch: async (url, options) => {
      calls.push({ url, options });
      return response(options.method === "POST" ? body : profileResult());
    } });
    assert.equal((await controller.block("someone")).ok, true);
    assert.equal(controller.stateFor("viewer", "someone"), "blocked");
    assert.deepEqual(calls.map((call) => call.options.method), ["POST", "GET"]);
    const { url, options } = calls[1];
    assert.equal(new URL(url).origin, "https://x.com");
    assert.match(new URL(url).pathname, /\/UserByScreenName$/);
    assert.deepEqual(JSON.parse(new URL(url).searchParams.get("variables")), { screen_name: "someone" });
    assert.equal(options.credentials, "include");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.body, undefined);
    await controller.block("someone");
    assert.equal(calls.length, 2);
  }
});

test("does not confuse blocked_by, another account, malformed flags, or errors with a confirmed block", async () => {
  for (const body of [
    profileResult("different"), profileResult("someone", false), profileResult("someone", "true"),
    { screen_name: "someone", blocked_by: true },
    { core: { screen_name: "someone" }, legacy: { screen_name: "different", blocking: true } },
    { screen_name: "someone", blocking: true, relationship_perspectives: { blocking: false } },
    { ...profileResult(), errors: [{ message: "Not available" }] }, {}, null
  ]) {
    const calls = [];
    const { controller } = client({ fetch: async (_url, options) => {
      calls.push(options.method);
      return response(options.method === "POST" ? { screen_name: "someone" } : body);
    } });
    assert.equal((await controller.block("someone")).error, "unconfirmed");
    assert.equal(controller.stateFor("viewer", "someone"), "idle");
    assert.deepEqual(calls, ["POST", "GET"]);
  }
});

test("verification failures remain inconclusive and do not retry or claim the block failed", async () => {
  for (const verify of [
    () => response({}, 403), () => response({}, 429), () => response({}, 500),
    () => new Response("not JSON"),
    () => { throw new TypeError("network"); },
    () => { const error = new Error(); error.name = "TimeoutError"; throw error; }
  ]) {
    const calls = [];
    const { controller } = client({ fetch: async (_url, options) => {
      calls.push(options.method);
      return options.method === "POST" ? response({ screen_name: "someone" }) : verify();
    } });
    assert.equal((await controller.block("someone")).error, "unconfirmed");
    assert.equal(controller.stateFor("viewer", "someone"), "idle");
    assert.deepEqual(calls, ["POST", "GET"]);
  }
});

test("empty successful POST bodies can be verified, but explicit API errors cannot become success", async () => {
  for (const postResponse of [new Response(null, { status: 204 }), new Response("not JSON")]) {
    const { controller } = client({ fetch: async (_url, options) => options.method === "POST" ? postResponse : response(profileResult()) });
    assert.equal((await controller.block("someone")).ok, true);
  }
  let calls = 0;
  const { controller } = client({ fetch: async () => {
    calls++;
    return response({ screen_name: "someone", blocking: true, errors: [{ message: "Not allowed" }] });
  } });
  assert.equal((await controller.block("someone")).error, "request-failed");
  assert.equal(calls, 1);
});

test("does not verify a mutation using a switched account's session", async () => {
  let username = "viewer";
  let calls = 0;
  const { controller } = client({
    getSession: () => ({ username, csrf: "test", bearer: "test" }),
    fetch: async () => { calls++; username = "other_viewer"; return response({ screen_name: "someone" }); }
  });
  assert.equal((await controller.block("someone")).error, "unconfirmed");
  assert.equal(calls, 1);
});

test("surfaces network and timeout failures and releases the pending action", async () => {
  for (const name of ["TimeoutError", "TypeError"]) {
    const { controller } = client({ fetch: async () => { const error = new Error(); error.name = name; throw error; } });
    assert.equal((await controller.block("someone")).error, name === "TimeoutError" ? "timeout" : "network-error");
    assert.equal(controller.stateFor("viewer", "someone"), "idle");
  }
});

async function fixture(t, { pathname = "/home", html, send, verify, paused = false }) {
  const dom = new JSDOM(`<html><body><a data-testid="AppTabBar_Profile_Link" href="/viewer">Profile</a>${html}</body></html>`, {
    url: `https://x.com${pathname}`, runScripts: "outside-only", pretendToBeVisual: true
  });
  const { window } = dom;
  const observers = [];
  const Observer = window.MutationObserver;
  window.MutationObserver = class extends Observer {
    constructor(callback) { super(callback); observers.push(this); }
  };
  t.after(() => { observers.forEach((observer) => observer.disconnect()); window.close(); });
  const posts = [];
  const handlers = new WeakMap();
  const addListener = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function (type, callback, ...rest) {
    if (type === "click") handlers.set(this, callback);
    return addListener.call(this, type, callback, ...rest);
  };
  window.AbortSignal = AbortSignal;
  window.document.cookie = "ct0=test-csrf";
  window.performance.getEntriesByType = () => [];
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { queueMicrotask(() => this.callback([{ target, isIntersecting: true }])); }
  };
  const cache = Object.fromEntries(["someone", "quoted", "follower", "viewer", "replacement"].map((name) => [name, { location: "Canada", fetchedAt: Date.now() }]));
  window.chrome = {
    runtime: { getManifest: () => JSON.parse(read("manifest.json")) },
    storage: {
      local: { get: (_keys, done) => done({ locationCache: cache, pauseUntil: paused ? Date.now() + 100000 : 0, pauseReason: paused ? "server-429" : null }), set: (_value, done) => done?.() },
      onChanged: { addListener() {} }
    }
  };
  window.fetch = async (url, options) => {
    if (options?.method === "POST") {
      posts.push({ url, options });
      return send ? send(url, options) : response({ screen_name: new URLSearchParams(options.body).get("screen_name"), blocking: true });
    }
    if (String(url).includes("/UserByScreenName?")) return verify ? verify(url, options) : response({}, 404);
    return response({}, 404);
  };
  for (const name of ["shared.js", "account-actions.js", "content.js"]) window.eval(read(name));
  await new Promise(setImmediate);
  const trustedClick = (button) => handlers.get(button).call(button, {
    currentTarget: button, isTrusted: true, preventDefault() {}, stopPropagation() {}
  });
  return { window, document: window.document, posts, trustedClick };
}

const tweet = (username, id, content = "") => `<article data-testid="tweet" id="${id}"><a href="/${username}/status/123">${username}</a>${content}</article>`;
const assertNoBlockNotice = (document) => assert.equal(document.querySelector('.xal-block-notice, [role="status"]'), null);
function finishBlockAnimation(window, button) {
  const event = new window.Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: "xal-block-complete" });
  button.dispatchEvent(event);
}

test("DOM: country link and block are separate; forged clicks cannot block", async (t) => {
  const { window, document, posts, trustedClick } = await fixture(t, { html: tweet("someone", "post") });
  const badge = document.querySelector(".xal-badge");
  assert.equal(badge.querySelector(".xal-location-link").getAttribute("href"), "/someone/about");
  const button = badge.querySelector("button");
  assert.equal(button.getAttribute("aria-label"), "Block @someone");
  button.click();
  assert.equal(posts.length, 0);
  button.dataset.username = "victim";
  await trustedClick(button);
  assert.equal(new URLSearchParams(posts[0].options.body).get("screen_name"), "someone");
  assert.equal(button.getAttribute("aria-label"), "Blocked @someone");
  assert.equal(button.textContent, "×");
  assert.equal(button.dataset.state, "blocked");
  assert.equal(button.hidden, false);
  assertNoBlockNotice(document);
  finishBlockAnimation(window, button);
  assert.equal(button.hidden, true);
  assert.equal(badge.querySelector(".xal-location-link").getAttribute("href"), "/someone/about");
  assert.equal(badge.querySelector(".xal-location-link").textContent, "CANADA");
});

test("DOM: pending blocks keep the cross visible and expose their busy state without a popup", async (t) => {
  let resolve;
  const { document, trustedClick } = await fixture(t, {
    html: tweet("someone", "post"), send: () => new Promise((done) => { resolve = done; })
  });
  const button = document.querySelector("button");
  const request = trustedClick(button);
  assert.equal(button.textContent, "×");
  assert.equal(button.dataset.state, "pending");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.disabled, true);
  assert.equal(button.hidden, false);
  assertNoBlockNotice(document);
  resolve(response({ screen_name: "someone", blocking: true }));
  await request;
  assert.equal(button.getAttribute("aria-busy"), "false");
});

test("DOM: quoted button blocks the quote author without blocking its parent", async (t) => {
  const quote = '<div data-testid="quoteTweet"><a href="/quoted/status/456">Quoted</a></div>';
  const { document, posts, trustedClick } = await fixture(t, { html: tweet("someone", "post", quote) });
  const button = document.querySelector('[data-testid="quoteTweet"] button');
  await trustedClick(button);
  assert.equal(new URLSearchParams(posts[0].options.body).get("screen_name"), "quoted");
  assert.equal(document.querySelector("#post > .xal-badge button").disabled, false);
});

test("DOM: follower button follows the full identity line, works during location pauses, and skips self", async (t) => {
  const row = (name) => `<div data-testid="UserCell"><a href="/${name}"><span>${name} 🍀 <b>✓</b><i>🔒</i></span></a><a href="/${name}">@${name}</a></div>`;
  const { document, posts, trustedClick } = await fixture(t, { pathname: "/viewer/followers", html: row("follower") + row("viewer"), paused: true });
  const badge = document.querySelector(".xal-user-cell-badge");
  assert.equal(badge.previousElementSibling.textContent, "🔒");
  assert.equal(document.querySelectorAll(".xal-block-button").length, 1);
  await trustedClick(badge.querySelector("button"));
  assert.equal(new URLSearchParams(posts[0].options.body).get("screen_name"), "follower");
});

test("DOM: rejects stale and detached targets and updates every copy of a blocked account", async (t) => {
  const { document, posts, trustedClick } = await fixture(t, { html: tweet("someone", "one") + tweet("someone", "two") });
  const button = document.querySelector("#one button");
  document.querySelector("#one > a").href = "/replacement/status/789";
  await trustedClick(button);
  assert.equal(posts.length, 0);
  assertNoBlockNotice(document);
  const current = document.querySelector("#one button");
  assert.equal(current.getAttribute("aria-label"), "Block @replacement");
  document.querySelector("#one").remove();
  await trustedClick(current);
  assert.equal(posts.length, 0);
  assertNoBlockNotice(document);
  await trustedClick(document.querySelector("#two button"));
  assert.equal(posts.length, 1);
  assert.equal(document.querySelector("#two button").disabled, true);
});

test("DOM: failed blocks leave the cross available without a popup", async (t) => {
  const { window, document, trustedClick } = await fixture(t, { html: tweet("someone", "post"), send: async () => response({}, 403) });
  const button = document.querySelector("button");
  await trustedClick(button);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "×");
  assert.equal(button.dataset.state, "idle");
  assert.equal(button.hidden, false);
  assertNoBlockNotice(document);
  finishBlockAnimation(window, button);
  assert.equal(button.hidden, false);
});

test("DOM: blocking synchronizes existing copies and keeps later copies hidden", async (t) => {
  const { window, document, trustedClick } = await fixture(t, { html: tweet("someone", "one") + tweet("someone", "two") });
  await trustedClick(document.querySelector("#one button"));
  const second = document.querySelector("#two button");
  assert.equal(second.getAttribute("aria-label"), "Blocked @someone");
  assert.equal(second.disabled, true);
  assert.equal(second.dataset.state, "blocked");
  finishBlockAnimation(window, second);
  assert.equal(second.hidden, true);
  document.body.insertAdjacentHTML("beforeend", tweet("someone", "three"));
  await new Promise(setImmediate);
  assert.equal(document.querySelector("#three button").hidden, true);
  assert.equal(document.querySelector("#three .xal-location-link").getAttribute("href"), "/someone/about");
  assert.equal(second.hidden, true);
  assertNoBlockNotice(document);
});

test("DOM: missing mutation flag shows success once the read confirms blocking", async (t) => {
  const { document, posts, trustedClick } = await fixture(t, {
    html: tweet("someone", "one") + tweet("someone", "two"),
    send: async () => response({ screen_name: "someone" }),
    verify: async () => response(profileResult())
  });
  await trustedClick(document.querySelector("#one button"));
  assert.equal(posts.length, 1);
  assertNoBlockNotice(document);
  assert.equal(document.querySelector("#two button").textContent, "×");
  assert.equal(document.querySelector("#two button").dataset.state, "blocked");
  assert.equal(document.querySelector("#two button").disabled, true);
});

test("DOM: an inconclusive check leaves the cross available without a popup", async (t) => {
  const { document, posts, trustedClick } = await fixture(t, {
    html: tweet("someone", "post"), send: async () => response({ screen_name: "someone" })
  });
  await trustedClick(document.querySelector("button"));
  assert.equal(posts.length, 1);
  assertNoBlockNotice(document);
  assert.equal(document.querySelector("button").textContent, "×");
  assert.equal(document.querySelector("button").dataset.state, "idle");
  assert.equal(document.querySelector("button").disabled, false);
  assert.equal(document.querySelector("button").hidden, false);
});
