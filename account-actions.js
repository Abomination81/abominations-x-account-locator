(function initAccountActions(root) {
  "use strict";

  const shared = root.XAccountLocationShared;
  const ALLOWED_ORIGINS = new Set(["https://x.com", "https://twitter.com"]);

  function createBlockController({ origin, fetch: request, getSession, onChange = () => {}, now = Date.now }) {
    const states = new Map();
    let active = false;
    let retryAt = 0;
    const keyFor = (viewer, username) => `${viewer}:${username}`;
    const stateFor = (viewer, username) => states.get(keyFor(viewer, username)) || "idle";

    async function block(username) {
      const target = shared.normalizeUsername(username);
      const session = getSession();
      const viewer = shared.normalizeUsername(session?.username);
      if (!ALLOWED_ORIGINS.has(origin) || !target) return { ok: false, error: "invalid-target" };
      if (!viewer || !session.csrf) return { ok: false, error: "not-signed-in" };
      if (shared.sameUsername(target, viewer)) return { ok: false, error: "own-account" };
      if (stateFor(viewer, target) === "blocked") return { ok: true, username: target };
      if (active) return { ok: false, error: "busy" };
      if (retryAt > now()) return { ok: false, error: "rate-limited", retryAt };

      const key = keyFor(viewer, target);
      active = true;
      states.set(key, "pending");
      onChange();
      let confirmed = false;
      try {
        const response = await request(`${origin}/i/api/1.1/blocks/create.json`, {
          method: "POST",
          credentials: "include",
          redirect: "error",
          headers: {
            authorization: `Bearer ${session.bearer}`,
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "x-csrf-token": session.csrf,
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session"
          },
          body: new URLSearchParams({ screen_name: target, include_entities: "false", skip_status: "true" }).toString(),
          signal: AbortSignal.timeout(10_000)
        });
        if (response.status === 429) {
          const rate = shared.normalizeRateInfo(null, response.headers.get("x-rate-limit-reset"), response.headers.get("retry-after"), now());
          retryAt = Math.max(now() + 60_000, rate.resetAt || 0, rate.retryAfterAt || 0);
          return { ok: false, error: "rate-limited", retryAt };
        }
        if (response.status === 401 || response.status === 403) return { ok: false, error: "not-authorized" };
        if (!response.ok) return { ok: false, error: "request-failed" };
        const user = await response.json();
        if (user?.blocking !== true || !shared.sameUsername(user.screen_name, target)) {
          return { ok: false, error: "unconfirmed" };
        }
        confirmed = true;
        return { ok: true, username: target };
      } catch (error) {
        return { ok: false, error: error?.name === "TimeoutError" ? "timeout" : "network-error" };
      } finally {
        active = false;
        if (confirmed) states.set(key, "blocked");
        else states.delete(key);
        onChange();
      }
    }

    return Object.freeze({ block, stateFor });
  }

  root.XAccountLocationActions = Object.freeze({ createBlockController });
})(globalThis);
