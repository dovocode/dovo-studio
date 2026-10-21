# Hosted page catalog coverage

`Dovo / Screens / Hosted` renders production templates, not parallel designs. Theme and viewport
controls apply to the isolated page. Auth forms and navigation are sandbox-disabled. Artifact and
website scripts run their real browser code against an in-frame synthetic transport; a restrictive
CSP blocks real network requests and form submissions. Synthetic actions cannot issue account grants
or change publications.

## Route inventory

| Product / route                           | Stories and states                                                                                                | Source                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Auth `/`, `/sign-in`                      | GitHub sign-in and app-continuation explanation                                                                   | `apps/auth-server/src/pages.ts` `signInPage`                                       |
| Auth `/account`                           | Profile, current/other sessions, empty sessions, saved notice                                                     | `accountPage`                                                                      |
| Auth `/error`                             | Interrupted/cancelled sign-in and safe continuation                                                               | shared `authStatusViews.interrupted`, used by server                               |
| Auth `/resume` / invalid `/sign-in` query | Both expired-sign-in response variants                                                                            | shared `authStatusViews.expired/signInExpired`                                     |
| Auth blocked form requests                | Account and sign-in blocked request variants                                                                      | shared `authStatusViews.blocked/signInBlocked`                                     |
| Auth account/session validation           | Ended session, inactive revocation target, invalid profile name, oversized request                                | shared status templates used directly by server                                    |
| Auth unknown routes / unavailable service | Signed-in and public not-found variants, service retry                                                            | shared `authStatusViews.notFound/publicNotFound/unavailable`                       |
| Connect `/auth/start`                     | Device-consent code, organization choices, artifact-only scope                                                    | `connectConsent`, used by `browser-auth.ts`                                        |
| Connect `/auth/callback`                  | Device and artifact success                                                                                       | `connectSuccess`, used by `browser-auth.ts`                                        |
| Artifacts `/`                             | Anonymous sign-in, pending sign-in/code comparison, empty library, populated library                              | actual `pages.ts` and `viewer.ts`                                                  |
| Artifacts `/s/:id`                        | Owner viewer, anonymous share viewer, current/stale/no live feed, loading, missing/revoked access, server failure | actual viewer with synthetic protocol responses                                    |
| Artifacts `/manage/:id`                   | Invitations, expiring links, publisher-approved live-feed stop control, remove hosted copy                        | actual viewer; mutation requests intentionally return synthetic forbidden response |
| Website `/`                               | Full landing page including header/footer, product tour, feature/agent sections                                   | actual Next page and layout                                                        |
| Website `/docs/`                          | Full getting-started page, navigation, quick-start controls                                                       | actual Next page and layout                                                        |
| Website `/download/`                      | Stable, nightly ready, nightly loading, nightly unavailable                                                       | actual Next page and release component                                             |
| Website `/privacy/`                       | Full privacy page                                                                                                 | actual Next page and layout                                                        |
| Website unknown route                     | Full not-found page                                                                                               | actual Next not-found component and layout                                         |

Auth `/` intentionally routes users to sign-in or account; it has no separate page. OAuth protocol
redirects, health, discovery, token exchange and machine APIs are not visual routes. Connect errors
are JSON request responses rather than independently rendered pages. Website `robots.txt` and
sitemap are not UI pages.

## Boundaries and remaining verification

- Website uses only two narrow framework adapters: semantic `<a>` for Next Link, and original public
  `<img>` assets for Next Image. Next routing, prefetch and image optimization are not simulated.
  Original production React components, effects and local controls still run.
- Website release data is synthetic. No GitHub request is sent. Public images are copied into
  `/website/` by catalog preparation; no user workspace assets are used.
- Artifacts uses the real imperative viewer bundle, including protocol decoders, loading/errors,
  sign-in comparison and management sections. It does not duplicate those sections as static HTML.
  Its location object is replaced at bundle time solely inside the catalog bundle. The production
  bundle is unchanged.
- Hosted sign-in is a presentation/fixture review, not evidence that GitHub OAuth, permissions,
  cancellation or real session revocation works. Those retain their separate service/browser tests.
- No hosted feature invents native equivalents; the hosted pages are responsive web pages. Real
  mobile settings/page coverage belongs to the native catalog.
- Theme review exposes the current production website theme behavior; the catalog does not add a
  production theme switch.

The design-system dev, build and typecheck commands run `prepare:catalog` first. This regenerates
hosted bundles, website assets and the mobile terminal/Mermaid viewers even when dependency install
scripts are disabled. Generated bundles never contain credentials.

## Findings exposed by full pages

Inner-frame accessibility checks found low-contrast step labels on the website, hardcoded dark
surfaces under its light tokens, and the Artifacts error color failing on light backgrounds. These
now use the existing semantic surface, secondary, muted and status-error tokens in the production
styles. The catalog's Next boundary supplies the real route metadata title; it does not depend on
Next's server metadata injection.

The original `Dovo / Hosted services` story URLs remain as aliases to these production fixtures.
Their older handcrafted Artifacts/Connect content is removed.
