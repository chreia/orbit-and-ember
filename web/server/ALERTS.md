# Orbit and Ember signal relay

The globe shows a small signal network for a selected 0.5° FIRMS cell. NASA FIRMS is the observation source. A recipient node appears only after a contact subscribes to a nearby area and confirms the email link. Names and organizations are shown only if that contact opted in to public display. An email confirmation verifies mailbox control; it does **not** verify agency affiliation or authority to dispatch.

## Run

The relay API is installed in the Orbit and Ember Vite server and preview server. For deployment, run `npm run build` followed by `npm run serve:relay` on a Node host (set `PORT` and `HOST` as needed). The production entry point serves the built app and its relay API from one origin. It polls the shared global FIRMS feed every 10 minutes even when no browser is open. A static-only host does not run the relay; the UI then offers NASA's own FIRMS alerts instead.

Set these server-side environment variables before starting the app:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend email API key. Never expose it as a `VITE_` variable. |
| `FOCOS_ALERT_FROM` | Sender address on a verified sending domain. |
| `FOCOS_PUBLIC_URL` | Public HTTPS origin used in confirmation and unsubscribe links. Required outside localhost. |
| `FOCOS_ALERT_STORE` | Persistent JSON file path; defaults to `~/.focos/alert-relay.json`. Back up and protect this file. |
| `FOCOS_PARTNERS_FILE` | Optional private JSON file of reviewed partner identities for public names and logos. |

Without the email variables, sign-up stays closed and no notification is claimed. On a configured server, the process needs outbound access to the NASA FIRMS feed and Resend API. Restarting the process retains confirmed contacts and delivery records via the store file. Use one relay process per store file; this is a pilot service, not a multi-instance queue.

Partner branding is never inferred from a sign-up form. After independently reviewing an organization's affiliation and permission to use its logo, an administrator may add an exact email match to the private partner file: `[{"email":"person@example.org","role":"scientist","organization":"Example Lab","logoUrl":"https://example.org/logo.png"}]`. Restart the server after editing. The contact must also opt in to public display. Without both steps, the map shows only an anonymous confirmed contact.

## Review rule and delivery

Each candidate is a fresh 0.5° cell with at least six nominal/high-confidence VIIRS detections in the latest six hours, at least as many as the preceding 18 hours, and a latest observation no older than six hours. It is a **within-day surge**, not a seasonal anomaly, confirmed wildfire, or fire perimeter. Future work should compare this rule with a historical, sensor-aware baseline and incident reports before operational use.

A confirmed watch matches by great-circle distance from the cell center to the subscriber's center (5–150 km radius). A contact receives at most one email per six hours, only after a new observation. The email includes counts, coordinates, observation time, NASA source, and a one-click unsubscribe path that requires a confirming button. The relay records `attempted`, `accepted` by the provider, or `failed`; `accepted` does **not** prove inbox delivery or acknowledgement. It never sends to an agency or scientist who has not opted in. No dispatch integration exists.

Tests: `npm test` includes the candidate rule, confirmation, area matching, deduplication, unsubscribe, and disabled-delivery behavior.
