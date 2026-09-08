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

test("surfaces network and timeout failures and releases the pending action", async () => {
  for (const name of ["TimeoutError", "TypeError"]) {
    const { controller } = client({ fetch: async () => { const error = new Error(); error.name = name; throw error; } });
    assert.equal((await controller.block("someone")).error, name === "TimeoutError" ? "timeout" : "network-error");
    assert.equal(controller.stateFor("viewer", "someone"), "idle");
  }
});

async function fixture(t, { pathname = "/home", html, send, paused = false }) {
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

test("DOM: country link and block are separate; forged clicks cannot block", async (t) => {
  const { document, posts, trustedClick } = await fixture(t, { html: tweet("someone", "post") });
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
  assert.equal(document.querySelector('[role="status"]').textContent, "Blocked @someone.");
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
  const current = document.querySelector("#one button");
  assert.equal(current.getAttribute("aria-label"), "Block @replacement");
  document.querySelector("#one").remove();
  await trustedClick(current);
  assert.equal(posts.length, 0);
  await trustedClick(document.querySelector("#two button"));
  assert.equal(posts.length, 1);
  assert.equal(document.querySelector("#two button").disabled, true);
});

test("DOM: failed blocks show an error and leave the button available", async (t) => {
  const { document, trustedClick } = await fixture(t, { html: tweet("someone", "post"), send: async () => response({}, 403) });
  const button = document.querySelector("button");
  await trustedClick(button);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "×");
  assert.match(document.querySelector('[role="status"]').textContent, /did not allow the block/);
});

test("DOM: blocking synchronizes other copies of the same account", async (t) => {
  const { document, trustedClick } = await fixture(t, { html: tweet("someone", "one") + tweet("someone", "two") });
  await trustedClick(document.querySelector("#one button"));
  assert.equal(document.querySelector("#two button").getAttribute("aria-label"), "Blocked @someone");
  assert.equal(document.querySelector("#two button").disabled, true);
});
