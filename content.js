(function initContentScript() {
  "use strict";

  const shared = globalThis.XAccountLocationShared;
  if (!shared || globalThis.__abominationsLocatorContent) return;
  globalThis.__abominationsLocatorContent = true;

  const POSITIVE_TTL = 30 * 24 * 60 * 60 * 1000;
  const NEGATIVE_TTL = 12 * 60 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 2000;
  const MAX_CONCURRENT = 3;
  const BASE_SPACING = 350;
  const LOW_BUDGET_SPACING = 900;
  const PREFETCH_MARGIN = 300;
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const QUOTE_SELECTOR = '[data-testid="quoteTweet"]';
  const USER_CELL_SELECTOR = '[data-testid="UserCell"]';
  const DEFAULT_SETTINGS = { enabled: true, badgeColor: shared.DEFAULT_ACCENT_COLOR };

  let settings = { ...DEFAULT_SETTINGS };
  let cache = Object.create(null);
  let pauseUntil = 0;
  let activeRequests = 0;
  let currentSpacing = BASE_SPACING;
  let lastRequestAt = 0;
  let sequence = 0;
  let cacheSaveTimer = null;
  let statsSaveTimer = null;
  let refreshFrame = null;
  let ownUsername = null;
  let performanceStats = {
    completed: 0,
    averageMs: 0,
    lastMs: 0,
    cacheHits: 0,
    status: "active",
    retryAt: null
  };
  const queue = [];
  const queuedUsers = new Set();
  const pending = new Map();
  const surfacesByUsername = new Map();
  const dirtySurfaces = new Set();

  const storageGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  const storageSet = (values) => new Promise((resolve) => chrome.storage.local.set(values, resolve));

  function publishRuntimeState() {
    if (!document.documentElement) return;
    document.documentElement.dataset.xalLookupStatus = performanceStats.status;
    document.documentElement.dataset.xalQueueDepth = String(queue.length);
    document.documentElement.dataset.xalActiveRequests = String(activeRequests);
    document.documentElement.dataset.xalPauseUntil = pauseUntil ? String(pauseUntil) : "";
  }

  function scheduleCacheSave() {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(() => {
      cache = Object.fromEntries(
        Object.entries(cache)
          .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
          .slice(0, MAX_CACHE_ENTRIES)
      );
      void storageSet({ locationCache: cache });
    }, 350);
  }

  function scheduleStatsSave() {
    publishRuntimeState();
    clearTimeout(statsSaveTimer);
    statsSaveTimer = setTimeout(() => void storageSet({ performanceStats }), 500);
  }

  function setStatus(status, retryAt = null) {
    performanceStats = { ...performanceStats, status, retryAt };
    scheduleStatsSave();
  }

  function recordDuration(durationMs) {
    const completed = performanceStats.completed + 1;
    performanceStats = {
      ...performanceStats,
      completed,
      lastMs: Math.round(durationMs),
      averageMs: Math.round(
        (performanceStats.averageMs * performanceStats.completed + durationMs) / completed
      )
    };
    scheduleStatsSave();
  }

  function isRelevant(surface) {
    if (!surface?.isConnected) return false;
    const rect = surface.getBoundingClientRect();
    return rect.bottom >= -PREFETCH_MARGIN && rect.top <= innerHeight + PREFETCH_MARGIN;
  }

  function usernameForArticle(article) {
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      if (link.closest(QUOTE_SELECTOR)) continue;
      const username = shared.usernameFromStatusHref(link.getAttribute("href"));
      if (username) return username;
    }
    return null;
  }

  function usernameForQuote(quote) {
    for (const link of quote.querySelectorAll('a[href*="/status/"]')) {
      const username = shared.usernameFromStatusHref(link.getAttribute("href"));
      if (username) return username;
    }
    const tweetText = quote.querySelector('[data-testid="tweetText"]');
    for (const node of quote.querySelectorAll("a[href], span")) {
      if (tweetText && tweetText.contains(node)) break;
      const fromHandle = shared.usernameFromHandleText(node.textContent);
      if (fromHandle) return fromHandle;
      if (node.matches("a[href]")) {
        const fromProfile = shared.usernameFromProfileHref(node.getAttribute("href"));
        if (fromProfile) return fromProfile;
      }
    }
    return null;
  }

  function usernameForUserCell(userCell) {
    const links = [...userCell.querySelectorAll("a[href]")];
    return shared.usernameFromUserCellParts(
      links.map((link) => link.textContent),
      links.map((link) => link.getAttribute("href"))
    );
  }

  function isFollowerListPath() {
    return /^\/[A-Za-z0-9_]{1,15}\/(?:verified_followers|followers|following)\/?$/.test(
      location.pathname
    );
  }

  function detectOwnUsername() {
    for (const selector of [
      'a[data-testid="AppTabBar_Profile_Link"][href]',
      '[data-testid="SideNav_AccountSwitcher_Button"] a[href]',
      '[data-testid="SideNav_AccountSwitcher_Button"] [href]'
    ]) {
      for (const node of document.querySelectorAll(selector)) {
        const username = shared.usernameFromProfileHref(node.getAttribute("href"));
        if (username) return username;
      }
    }

    const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountSwitcher) {
      for (const node of accountSwitcher.querySelectorAll("span")) {
        const username = shared.usernameFromHandleText(node.textContent);
        if (username) return username;
      }
    }
    return null;
  }

  function forgetQueuedUsername(username) {
    queuedUsers.delete(username);
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index] === username) queue.splice(index, 1);
    }
  }

  function updateOwnUsername(username) {
    const nextUsername = shared.normalizeUsername(username);
    if (!nextUsername || shared.sameUsername(nextUsername, ownUsername)) return false;
    ownUsername = nextUsername;
    forgetQueuedUsername(ownUsername);

    document
      .querySelectorAll(
        `${TWEET_SELECTOR}, ${TWEET_SELECTOR} ${QUOTE_SELECTOR}, ${USER_CELL_SELECTOR}`
      )
      .forEach((surface) => {
        delete surface.dataset.xalSelf;
        if (isRelevant(surface)) prepareSurface(surface);
      });
    return true;
  }

  function skipOwnSurface(surface, username) {
    const previousUsername = surface.dataset.xalUsername;
    if (previousUsername) unregisterSurface(previousUsername, surface);
    unregisterSurface(username, surface);
    forgetQueuedUsername(username);
    removeSurfaceBadge(surface);
    surface.dataset.xalPrepared = "true";
    surface.dataset.xalUsername = username;
    surface.dataset.xalSelf = "true";
    delete surface.dataset.xalLocation;
  }

  function registerSurface(username, surface) {
    if (!surfacesByUsername.has(username)) surfacesByUsername.set(username, new Set());
    surfacesByUsername.get(username).add(surface);
  }

  function unregisterSurface(username, surface) {
    const surfaces = surfacesByUsername.get(username);
    if (!surfaces) return;
    surfaces.delete(surface);
    if (!surfaces.size) surfacesByUsername.delete(username);
  }

  function hasRelevantSurface(username) {
    const surfaces = surfacesByUsername.get(username);
    if (!surfaces) return false;
    let relevant = false;
    for (const surface of surfaces) {
      if (!surface.isConnected) surfaces.delete(surface);
      else if (isRelevant(surface)) relevant = true;
    }
    if (!surfaces.size) surfacesByUsername.delete(username);
    return relevant;
  }

  function validCache(username) {
    const item = cache[username];
    if (!item) return null;
    const ttl = item.location ? POSITIVE_TTL : NEGATIVE_TTL;
    if (Date.now() - item.fetchedAt <= ttl) return item;
    delete cache[username];
    return null;
  }

  function badgeForSurface(surface) {
    return surface.matches(USER_CELL_SELECTOR)
      ? surface.querySelector(".xal-user-cell-badge")
      : surface.querySelector(":scope > .xal-badge");
  }

  function removeSurfaceBadge(surface) {
    const badge = badgeForSurface(surface);
    const host = badge?.parentElement;
    badge?.remove();
    host?.classList.remove("xal-user-cell-identity-line");
  }

  function badgeHostForSurface(surface) {
    if (!surface.matches(USER_CELL_SELECTOR)) return surface;
    const links = [...surface.querySelectorAll("a[href]")];
    const username = usernameForUserCell(surface);
    const displayNameIndex = shared.userCellDisplayNameIndex(
      links.map((link) => link.textContent),
      links.map((link) => link.getAttribute("href")),
      username
    );
    const displayNameLink = links[displayNameIndex];
    const host = displayNameLink?.firstElementChild || displayNameLink || surface;
    if (host !== surface) host.classList.add("xal-user-cell-identity-line");
    return host;
  }

  function activateUserCellBadge(event) {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    const href = event.currentTarget.dataset.xalHref;
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    location.assign(href);
  }

  function showBadge(surface, username, item) {
    if (!item.location || !surface.isConnected || !settings.enabled) return;
    const isUserCell = surface.matches(USER_CELL_SELECTOR);
    let badge = badgeForSurface(surface);
    if (!badge) {
      badge = document.createElement(isUserCell ? "span" : "a");
      badge.className = "xal-badge";
      badge.classList.toggle("xal-user-cell-badge", isUserCell);
      if (isUserCell) {
        badge.setAttribute("role", "link");
        badge.tabIndex = 0;
        badge.addEventListener("click", activateUserCellBadge);
        badge.addEventListener("keydown", activateUserCellBadge);
      } else {
        badge.target = "_self";
        badge.rel = "nofollow";
        badge.addEventListener("click", (event) => event.stopPropagation());
      }
      badgeHostForSurface(surface).appendChild(badge);
    }
    const uncertain = item.accurate === false;
    const note = uncertain ? " X marks this location as potentially inaccurate." : "";
    const aboutHref = `/${encodeURIComponent(username)}/about`;
    if (isUserCell) badge.dataset.xalHref = aboutHref;
    else badge.href = aboutHref;
    badge.textContent = shared.displayLocation(item.location);
    badge.style.setProperty("--xal-accent", shared.normalizeAccentColor(settings.badgeColor));
    badge.title = item.override
      ? `@${username}'s extension location is ${item.location}. Custom label by Abomination81.`
      : `X says @${username}'s account is based in ${item.location}.${note} Not proof of nationality or identity. Built by Abomination81.`;
    badge.setAttribute("aria-label", badge.title);
    badge.toggleAttribute("data-location-uncertain", uncertain);
    surface.dataset.xalLocation = item.location;
  }

  function applyToSurfaces(username, item) {
    const surfaces = surfacesByUsername.get(username);
    if (!surfaces) return;
    for (const surface of surfaces) {
      if (surface.isConnected) showBadge(surface, username, item);
      else surfaces.delete(surface);
    }
  }

  function prepareSurface(surface) {
    if (!settings.enabled || !surface.isConnected) return;
    const isQuote = surface.matches(QUOTE_SELECTOR);
    const isUserCell = surface.matches(USER_CELL_SELECTOR);
    if (isUserCell && !isFollowerListPath()) return;
    const username = isUserCell
      ? usernameForUserCell(surface)
      : isQuote
        ? usernameForQuote(surface)
        : usernameForArticle(surface);
    if (!username) return;

    if (!ownUsername) updateOwnUsername(detectOwnUsername());
    if (shared.sameUsername(username, ownUsername)) {
      skipOwnSurface(surface, username);
      return;
    }
    delete surface.dataset.xalSelf;

    const previousUsername = surface.dataset.xalUsername;
    if (previousUsername && previousUsername !== username) {
      unregisterSurface(previousUsername, surface);
      removeSurfaceBadge(surface);
      delete surface.dataset.xalLocation;
    }

    surface.dataset.xalPrepared = "true";
    surface.dataset.xalUsername = username;
    surface.classList.toggle("xal-quote-surface", isQuote);
    surface.classList.toggle("xal-user-cell-surface", isUserCell);
    registerSurface(username, surface);

    const overrideLocation = shared.locationOverride(username);
    if (overrideLocation) {
      showBadge(surface, username, {
        location: overrideLocation,
        accurate: null,
        override: true
      });
      return;
    }

    const cached = validCache(username);
    if (cached) {
      if (surface.dataset.xalCacheCounted !== username) {
        surface.dataset.xalCacheCounted = username;
        performanceStats.cacheHits += 1;
        scheduleStatsSave();
      }
      showBadge(surface, username, cached);
    } else if (!queuedUsers.has(username) && !pendingHasUsername(username)) {
      enqueue(username);
    }
  }

  function pendingHasUsername(username) {
    return [...pending.values()].some((request) => request.username === username);
  }

  function enqueue(username, front = false) {
    if (shared.sameUsername(username, ownUsername)) return;
    if (queuedUsers.has(username) || pendingHasUsername(username)) return;
    queuedUsers.add(username);
    front ? queue.unshift(username) : queue.push(username);
    publishRuntimeState();
    pumpQueue();
  }

  function nextRelevantUsername() {
    while (queue.length) {
      const username = queue.shift();
      queuedUsers.delete(username);
      if (shared.sameUsername(username, ownUsername)) continue;
      if (hasRelevantSurface(username)) return username;
    }
    return null;
  }

  function pumpQueue() {
    publishRuntimeState();
    if (!settings.enabled || activeRequests >= MAX_CONCURRENT || !queue.length) return;
    if (Date.now() < pauseUntil) {
      setStatus("paused", pauseUntil);
      setTimeout(pumpQueue, Math.min(pauseUntil - Date.now(), 60_000));
      return;
    }
    if (performanceStats.status === "paused") setStatus("active");
    const wait = Math.max(0, currentSpacing - (Date.now() - lastRequestAt));
    if (wait) return void setTimeout(pumpQueue, wait);

    const username = nextRelevantUsername();
    if (!username) return;
    const requestId = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    const timeout = setTimeout(() => {
      const request = finishRequest(requestId);
      if (request) setStatus("timeout");
      pumpQueue();
    }, 15_000);
    pending.set(requestId, { username, timeout, startedAt: performance.now() });
    activeRequests += 1;
    lastRequestAt = Date.now();
    globalThis.postMessage(
      { source: shared.BRIDGE_SOURCE, type: "lookup", requestId, username },
      location.origin
    );
    setTimeout(pumpQueue, currentSpacing);
  }

  function finishRequest(requestId) {
    const request = pending.get(requestId);
    if (!request) return null;
    clearTimeout(request.timeout);
    pending.delete(requestId);
    activeRequests = Math.max(0, activeRequests - 1);
    recordDuration(performance.now() - request.startedAt);
    return request;
  }

  globalThis.addEventListener("message", (event) => {
    if (
      event.source !== globalThis ||
      event.origin !== location.origin ||
      event.data?.source !== shared.BRIDGE_SOURCE ||
      event.data?.type !== "lookup-result"
    ) return;

    const request = finishRequest(String(event.data.requestId || ""));
    if (!request) return;
    if (shared.sameUsername(request.username, ownUsername)) return void pumpQueue();
    const remaining = Number.isFinite(event.data.rateRemaining) ? event.data.rateRemaining : null;
    currentSpacing = remaining !== null && remaining <= 10 ? LOW_BUDGET_SPACING : BASE_SPACING;

    if (event.data.error === "rate-limited") {
      pauseUntil = event.data.rateResetAt || Date.now() + 15 * 60 * 1000;
      if (hasRelevantSurface(request.username)) enqueue(request.username, true);
      void storageSet({ pauseUntil });
      setStatus("paused", pauseUntil);
      return void pumpQueue();
    }
    if (event.data.error === "not-signed-in" || event.data.error === "not-authorized") {
      setStatus("authorization-needed");
      return void pumpQueue();
    }
    if (!event.data.ok) {
      setStatus(event.data.error || "request-failed");
      return void pumpQueue();
    }

    setStatus("active");
    const item = {
      location: shared.normalizeLocation(event.data.location),
      accurate: typeof event.data.accurate === "boolean" ? event.data.accurate : null,
      fetchedAt: Date.now()
    };
    cache[request.username] = item;
    scheduleCacheSave();
    applyToSurfaces(request.username, item);
    pumpQueue();
  });

  function observeSurface(surface) {
    visibilityObserver.observe(surface);
  }

  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) prepareSurface(entry.target);
      }
    },
    { rootMargin: `${PREFETCH_MARGIN}px 0px` }
  );

  function scan(root = document) {
    if (root instanceof Element && root.matches(TWEET_SELECTOR)) observeSurface(root);
    if (
      root instanceof Element &&
      root.matches(QUOTE_SELECTOR) &&
      root.closest(TWEET_SELECTOR)
    ) observeSurface(root);
    root.querySelectorAll?.(TWEET_SELECTOR).forEach(observeSurface);
    root.querySelectorAll?.(`${TWEET_SELECTOR} ${QUOTE_SELECTOR}`).forEach(observeSurface);
    if (isFollowerListPath()) {
      if (root instanceof Element && root.matches(USER_CELL_SELECTOR)) observeSurface(root);
      root.querySelectorAll?.(USER_CELL_SELECTOR).forEach(observeSurface);
    }
  }

  function markDirtyFromNode(node) {
    const element = node instanceof Element ? node : node.parentElement;
    if (!element) return;
    const quote = element.matches(QUOTE_SELECTOR) ? element : element.closest(QUOTE_SELECTOR);
    const tweet = element.matches(TWEET_SELECTOR) ? element : element.closest(TWEET_SELECTOR);
    const userCell = element.matches(USER_CELL_SELECTOR)
      ? element
      : element.closest(USER_CELL_SELECTOR);
    if (quote && quote.closest(TWEET_SELECTOR)) dirtySurfaces.add(quote);
    if (tweet) dirtySurfaces.add(tweet);
    if (userCell && isFollowerListPath()) dirtySurfaces.add(userCell);

    if (refreshFrame !== null) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = null;
      for (const surface of dirtySurfaces) {
        if (isRelevant(surface)) prepareSurface(surface);
      }
      dirtySurfaces.clear();
    });
  }

  const mutationObserver = new MutationObserver((records) => {
    updateOwnUsername(detectOwnUsername());
    for (const record of records) {
      const recordElement = record.target instanceof Element ? record.target : record.target.parentElement;
      if (recordElement?.closest(".xal-badge")) continue;
      markDirtyFromNode(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
        markDirtyFromNode(node);
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      settings.badgeColor = shared.normalizeAccentColor(settings.badgeColor);
      if (!settings.enabled) {
        document.querySelectorAll(".xal-badge").forEach((badge) => badge.remove());
      } else {
        document.querySelectorAll(".xal-badge").forEach((badge) => {
          badge.style.setProperty("--xal-accent", settings.badgeColor);
        });
        document
          .querySelectorAll(
            `${TWEET_SELECTOR}, ${TWEET_SELECTOR} ${QUOTE_SELECTOR}, ${USER_CELL_SELECTOR}`
          )
          .forEach((surface) => isRelevant(surface) && prepareSurface(surface));
      }
    }
    if (changes.locationCache?.newValue) cache = changes.locationCache.newValue;
  });

  async function start() {
    const stored = await storageGet(["settings", "locationCache", "pauseUntil", "performanceStats"]);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    settings.badgeColor = shared.normalizeAccentColor(settings.badgeColor);
    cache = stored.locationCache || Object.create(null);
    pauseUntil = Number(stored.pauseUntil || 0);
    performanceStats = { ...performanceStats, ...(stored.performanceStats || {}) };
    publishRuntimeState();
    ownUsername = detectOwnUsername();
    scan();
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "data-testid"]
    });
  }

  void start();
})();
