# Privacy

Abominations X Account Locator has no developer-operated server, analytics, advertising, or data brokerage. The developer does not sell user data or transfer it to third parties.

## What the extension accesses

- Public X usernames visible in ordinary posts, quoted posts, and follower/following lists.
- The signed-in X username shown in X's own navigation, used locally to exclude that account from location lookups and badges and scope block-button state to the current account.
- X's public **Account based in** result for those usernames.
- The user's existing X session only as needed to make requests to X.
- When you click a badge's red ×, the selected account's username is sent to X to block it through your signed-in session. This changes your X account's block list. The extension does not automatically block accounts.
- X's published About Account JavaScript bundle as text, so the extension can find X's current query identifier. The downloaded text is not executed by the extension.

## What stays on the device

The selected badge color, paused/enabled preference, bounded username-to-location cache, and aggregate timing or rate-limit status are stored locally through Chrome's extension storage. Users can clear the cache from the extension popup or remove all stored extension data by uninstalling the extension.

Block-button progress and confirmed results are held only in the current tab's memory. X stores your actual block list. You can unblock an account from its X profile.

## What is not collected by the developer

The extension does not send usernames, browsing history, credentials, settings, analytics, or location results to Abomination81 or to any developer-operated service.

`@Abomination81` is assigned the local custom label `XANADU`. This override does not make an X location request and does not alter X's own account disclosure.

## Third-party service

Requests needed for the feature are sent to X and X's asset domain through the user's existing X session. Use of X remains subject to X's own terms and privacy policy.

The extension performs these requests in Chrome's isolated extension world. It does not replace X's global `fetch` or `XMLHttpRequest` functions, capture authorization headers from X page requests, or expose a page-visible command bridge.

This project is independent and is not affiliated with X Corp.
