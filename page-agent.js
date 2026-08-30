(function initPageAgent() {
  "use strict";

  const shared = globalThis.XAccountLocationShared;
  if (!shared || globalThis.__abominationsLocatorPageAgent) return;
  globalThis.__abominationsLocatorPageAgent = true;

  const FALLBACK_BEARER_TOKEN =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const FALLBACK_QUERY_ID = "XRqGa7EeokUU5kppkh13EA";
  const ABOUT_BUNDLE_URL =
    "https://abs.twimg.com/responsive-web/client-web/shared~bundle.UserAbout~loader.AboutAccount.3b6723aa.js";

  let bearerToken = null;
  let aboutQueryId = null;
  let bundleLookup = null;
  let forwardedFor = null;

  function readHeader(headers, name) {
    if (!headers) return null;
    try {
      return new Headers(headers).get(name);
    } catch {
      return null;
    }
  }

  function captureRequest(urlValue, headers) {
    const url = String(urlValue || "");
    aboutQueryId = shared.parseAboutQueryId(url) || aboutQueryId;
    const authorization = readHeader(headers, "authorization");
    if (authorization?.startsWith("Bearer ")) bearerToken = authorization.slice(7);
    forwardedFor = readHeader(headers, "x-xp-forwarded-for") || forwardedFor;
  }

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function wrappedFetch(input, init) {
    const url = typeof input === "string" || input instanceof URL ? input : input?.url;
    captureRequest(url, init?.headers || input?.headers);
    return nativeFetch(input, init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrState = new WeakMap();

  XMLHttpRequest.prototype.open = function wrappedOpen(method, url, ...rest) {
    xhrState.set(this, { url: String(url || ""), headers: Object.create(null) });
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function wrappedSetHeader(name, value) {
    const state = xhrState.get(this);
    if (state) state.headers[name] = value;
    return nativeSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function wrappedSend(...args) {
    const state = xhrState.get(this);
    if (state) captureRequest(state.url, state.headers);
    return nativeSend.apply(this, args);
  };

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function discoverQueryId() {
    if (aboutQueryId) return aboutQueryId;
    if (bundleLookup) return bundleLookup;
    bundleLookup = (async () => {
      const resources = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /AboutAccount.*\.js(?:\?|$)/.test(url));
      for (const url of [...new Set([...resources, ABOUT_BUNDLE_URL])]) {
        try {
          const response = await nativeFetch(url, { credentials: "omit" });
          if (!response.ok) continue;
          const id = shared.parseAboutQueryId(await response.text());
          if (id) return (aboutQueryId = id);
        } catch {
          // The current query ID remains the fallback.
        }
      }
      return FALLBACK_QUERY_ID;
    })().finally(() => (bundleLookup = null));
    return bundleLookup;
  }

  function rateInfo(response) {
    const remainingValue = response.headers.get("x-rate-limit-remaining");
    const resetValue = response.headers.get("x-rate-limit-reset");
    return {
      rateRemaining: remainingValue === null ? null : Number(remainingValue),
      rateResetAt: resetValue === null ? null : Number(resetValue) * 1000
    };
  }

  function postResult(requestId, result) {
    globalThis.postMessage(
      { source: shared.BRIDGE_SOURCE, type: "lookup-result", requestId, ...result },
      location.origin
    );
  }

  async function lookup(username, requestId) {
    const csrf = csrfToken();
    if (!csrf) return postResult(requestId, { ok: false, error: "not-signed-in" });

    const queryId = aboutQueryId || FALLBACK_QUERY_ID;
    const variables = encodeURIComponent(JSON.stringify({ screenName: username }));
    const url = `${location.origin}/i/api/graphql/${queryId}/AboutAccountQuery?variables=${variables}`;
    const headers = {
      accept: "*/*",
      authorization: `Bearer ${bearerToken || FALLBACK_BEARER_TOKEN}`,
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": document.documentElement.lang || "en"
    };
    if (forwardedFor) headers["x-xp-forwarded-for"] = forwardedFor;

    try {
      const response = await nativeFetch(url, { method: "GET", credentials: "include", headers });
      const rate = rateInfo(response);
      if (response.status === 429) {
        return postResult(requestId, { ok: false, error: "rate-limited", ...rate });
      }
      if (response.status === 401 || response.status === 403) {
        return postResult(requestId, { ok: false, error: "not-authorized", ...rate });
      }
      if (!response.ok) {
        return postResult(requestId, { ok: false, error: `http-${response.status}`, ...rate });
      }
      postResult(requestId, {
        ok: true,
        ...shared.parseAboutPayload(await response.json()),
        ...rate
      });
    } catch {
      postResult(requestId, { ok: false, error: "network-error" });
    }
  }

  globalThis.addEventListener("message", (event) => {
    if (
      event.source !== globalThis ||
      event.origin !== location.origin ||
      event.data?.source !== shared.BRIDGE_SOURCE ||
      event.data?.type !== "lookup"
    ) return;
    const username = shared.normalizeUsername(event.data.username);
    const requestId = String(event.data.requestId || "").slice(0, 100);
    if (username && requestId) void lookup(username, requestId);
  });

  void discoverQueryId();
})();
