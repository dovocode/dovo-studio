# Mobile beta disclosures

Status: evidence-backed preparation for the current source, not a claim that store declarations have
been submitted or that the privacy URL is deployed. Public contact approved by Dominic:
`info@dovocode.com`. Developer consoles identify Dovocode / Dovocode Labs; confirm the exact legal
controller name before presenting one as a registered entity.

## Testing access

The desired audience is anyone possessing the test link. Use an external TestFlight group with a
public link after Apple's required beta review. Internal groups do not provide anonymous enrollment.
On Google Play, use open testing if the developer account and application are eligible. A closed
track requires eligibility through an email list or Google Group even when its opt-in URL is shared.
Do not promise unrestricted link enrollment from a closed track. Neither choice is a production
release. Country/device availability and store account restrictions still apply.

## Privacy notice

Source: `apps/site/src/app/privacy/page.tsx`; intended URL `https://dovo.studio/privacy/`.
Deletion-request instructions: `https://dovo.studio/privacy/#deletion`. Confirm both work publicly
before entering them into either store. Do not claim sign-out deletes an account.

| Data / feature                         | Evidence and purpose                                                    | Disclosure implications                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Optional identity                      | Connect `oidc.ts`, `store.ts`; identity provider profile/authentication | Account ID, display name; identity-service profile may include email. App functionality, linked to the signed-in user.                                                                                                         |
| Linked computers                       | Connect `account-api.ts`, `store.ts`                                    | Computer IDs, names and LAN/VPN addresses stored for discovery; user-linked metadata.                                                                                                                                          |
| Push registration                      | Connect `push-store.ts`; mobile notifications provider                  | Native device token, platform, runtime ID, environment and session-scoped grants; app functionality, linked to account.                                                                                                        |
| Notification content                   | Runtime `notifications/push.ts`; Connect `push-relay.ts`                | Task title, message/question preview, status and thread identifiers go through Dovo and APNs/FCM. Content forwarded rather than retained as Connect notification history. Do not claim content never leaves the user's server. |
| Messages/code/files/photos/screenshots | Mobile composer and runtime attachment/task storage                     | User content sent to paired runtimes and configured agents/integrations. Hosted Dovo runtime use, user-controlled runtimes and third-party processing must be distinguished when answering each store's collection definition. |
| Dictation                              | Mobile composer `dictation.ts`                                          | Microphone and speech recognition are optional; on-device when available, device speech service can process online otherwise. `recordingOptions.persist=false`. Transcribed text becomes message content if submitted.         |
| Camera / photo / document access       | `app.json`, attachment picker, pairing scanner                          | User-initiated photo attachment and QR pairing; no evidence of background camera collection.                                                                                                                                   |
| Local state                            | Account provider, connection/preferences storage                        | SecureStore account token; local preferences/connection state. Do not equate all local storage with encrypted storage.                                                                                                         |
| Diagnostics / network                  | Hosting and store infrastructure                                        | IP/network information processed to serve connections. Operational log fields/retention need deployment verification. No mobile advertising, tracking, Analytics or Crashlytics integration found in the reviewed source.      |

No evidence supports an advertising or cross-app tracking purpose. Firebase Messaging is not
Firebase Analytics. Do not select “no data collected” merely because most workspace data is on a
user-controlled computer. Account IDs, push identifiers and notification content still require
assessment under the store's exact definitions. Providers acting only as service processors can
qualify for a Play sharing exception; do not confuse that with absence of collection.

**Transport caveat:** HTTP LAN/VPN runtime addresses are intentionally supported. Do not attest that
every app data transfer is encrypted in transit without the store-specific definition and actual
routing supporting that answer. Hosted account/identity endpoints use HTTPS. If Play's question
cannot accommodate the optional HTTP path, resolve that factually rather than silently changing the
product's HTTP support or checking an inaccurate answer.

## Content, audience and reviewer access

The app is a developer tool, with user-supplied code, attachments, web/browser previews and AI
responses. It is not a curated content catalog or social feed. Do not infer a numeric age rating
from the absence of bundled mature content: answer the actual rating questionnaire for the
unrestricted user/AI/web capabilities and let the store calculate it. No ads or in-app purchase SDK
was found in the reviewed mobile package; verify account-level monetization choices separately. Do
not declare it child-directed, a Families app, or a Kids Category app without owner intent.

Pairing requires a reachable runtime and approval/code even without an account. Reviewers need
usable instructions and a deliberately provisioned isolated demo runtime if they must exercise
features; never give them production servers, real project data or developer credentials. Optional
account self-signup was disabled in the inspected identity deployment. A public beta link therefore
does not imply public account creation or a bundled hosted runtime. Testers can pair their own
runtime without an account; managed push requires a provisioned account until signup is addressed.

## iOS encryption declaration

`apps/mobile/app.json` sets `ios.config.usesNonExemptEncryption` to `false`. Expo writes the boolean
`ITSAppUsesNonExemptEncryption=false` into the generated app's `Info.plist`, including nightly
archives. The reviewed mobile client uses OS-provided networking and Keychain storage, random IDs,
and hashing for authentication/cache integrity; it does not implement non-exempt encryption.
Server-side cryptography is outside the shipped mobile app. Reassess this declaration if the mobile
client adds its own encryption implementation.

Already uploaded builds without this property still need the App Store Connect encryption answer:
**None of the algorithms mentioned above** for this reviewed client. Updating source configuration
does not change an existing uploaded binary.

## Account deletion

The account panels offer confirmed deletion. `DELETE /v1/account` derives the target from the bearer
session, requires `{ "confirm": "DELETE" }`, and ignores caller-supplied user IDs. The backend uses
private Casdoor API credentials to look up the verified subject in one configured organization and
remove that identity; built-in/admin/global-admin identities are refused.

A deletion marker blocks account access, grants and old in-flight logins before contacting Casdoor.
Failures preserve a deletion-only retry path. Success transactionally removes every Connect session,
all push subscriptions through foreign-key cascading, directory links and profile for that user. A
one-way hash of the deleted subject remains to prevent stale identity callbacks from recreating the
deleted account. No profile/name is retained in that marker. Backups currently expire after 14 days;
third-party and user-owned runtime data are independent.

Backend settings: `DOVO_ACCOUNT_ORGANIZATION`, `DOVO_ACCOUNT_DELETE_CLIENT_ID`,
`DOVO_ACCOUNT_DELETE_CLIENT_SECRET`. Keep the secret outside repositories and clients. A missing
configuration returns 503 without locking or deleting the account. Configure narrow identity
permissions and verify on a disposable identity before deployment. A browser-side credential or an
unrestricted built-in admin credential is not acceptable.
