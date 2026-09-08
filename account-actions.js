(function initAccountActions(root) {
  "use strict";

  const shared = root.XAccountLocationShared;
  const ALLOWED_ORIGINS = new Set(["https://x.com", "https://twitter.com"]);
  // Public operation and feature names from X's web client; no account credentials.
  const USER_QUERY_ID = "Gb-d6r0vxPOADdG62OEBpQ";
  const USER_FEATURES = Object.fromEntries([
    "hidden_profile_subscriptions_enabled", "profile_label_improvements_pcf_label_in_post_enabled",
    "responsive_web_profile_redirect_enabled", "rweb_tipjar_consumption_enabled",
    "verified_phone_label_enabled", "subscriptions_verification_info_is_identity_verified_enabled",
    "subscriptions_verification_info_verified_since_enabled", "highlights_tweets_tab_ui_enabled",
    "responsive_web_twitter_article_notes_tab_enabled", "subscriptions_feature_can_gift_premium",
    "creator_subscriptions_tweet_preview_api_enabled", "responsive_web_graphql_timeline_navigation_enabled"
  ].map((name) => [name, false]));

  function hasErrors(payload) {
    return Boolean(payload?.error || (payload?.errors && (!Array.isArray(payload.errors) || payload.errors.length)));
  }

  function confirmsBlock(payload, target) {
    if (hasErrors(payload)) return false;
    const user = payload?.data?.user?.result || payload?.user || payload;
    if (hasErrors(user)) return false;
    const names = [user?.screen_name, user?.legacy?.screen_name, user?.core?.screen_name]
      .filter((name) => name !== undefined);
    const flags = [user?.blocking, user?.legacy?.blocking, user?.relationship_perspectives?.blocking]
      .filter((flag) => flag !== undefined);
    return names.length > 0 && names.every((name) => shared.sameUsername(name, target)) &&
      flags.length > 0 && flags.every((flag) => flag === true);
  }

  async function readPayload(response) {
    try {
      return await response.json();
    } catch {
      // An empty or unreadable success body is inconclusive, not proof the write failed.
      return null;
    }
  }

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
      let accepted = false;
      const headers = {
        authorization: `Bearer ${session.bearer}`,
        "x-csrf-token": session.csrf,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session"
      };
      try {
        const response = await request(`${origin}/i/api/1.1/blocks/create.json`, {
          method: "POST",
          credentials: "include",
          redirect: "error",
          headers: {
            ...headers,
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
          },
          body: new URLSearchParams({ screen_name: target, include_blocking: "true", include_entities: "false", skip_status: "true" }).toString(),
          signal: AbortSignal.timeout(10_000)
        });
        if (response.status === 429) {
          const rate = shared.normalizeRateInfo(null, response.headers.get("x-rate-limit-reset"), response.headers.get("retry-after"), now());
          retryAt = Math.max(now() + 60_000, rate.resetAt || 0, rate.retryAfterAt || 0);
          return { ok: false, error: "rate-limited", retryAt };
        }
        if (response.status === 401 || response.status === 403) return { ok: false, error: "not-authorized" };
        if (!response.ok) return { ok: false, error: "request-failed" };
        accepted = true;
        const payload = await readPayload(response);
        if (hasErrors(payload)) return { ok: false, error: "request-failed" };
        confirmed = confirmsBlock(payload, target);
        if (!confirmed) {
          // Verify once with a read, never replay the block POST. X can omit the
          // relationship flag from a successful mutation's response.
          const current = getSession();
          if (!shared.sameUsername(current?.username, viewer) || current?.csrf !== session.csrf) {
            return { ok: false, error: "unconfirmed" };
          }
          const params = new URLSearchParams({
            variables: JSON.stringify({ screen_name: target }),
            features: JSON.stringify(USER_FEATURES),
            fieldToggles: JSON.stringify({ withPayments: false, withAuxiliaryUserLabels: false })
          });
          const verification = await request(`${origin}/i/api/graphql/${USER_QUERY_ID}/UserByScreenName?${params}`, {
            method: "GET", credentials: "include", redirect: "error", cache: "no-store",
            headers, signal: AbortSignal.timeout(10_000)
          });
          // A verification limit/error says nothing about whether the POST worked.
          if (!verification.ok) return { ok: false, error: "unconfirmed" };
          confirmed = confirmsBlock(await readPayload(verification), target);
        }
        if (!confirmed) return { ok: false, error: "unconfirmed" };
        return { ok: true, username: target };
      } catch (error) {
        if (accepted) return { ok: false, error: "unconfirmed" };
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
