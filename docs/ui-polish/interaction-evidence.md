# Interaction evidence for the UI polish overhaul

These checks run production React components in Playwright-managed Chromium, with schema-backed
synthetic workspaces and mocked runtime/provider boundaries. They establish browser interaction and
layout behavior; they do not establish live provider, native Electron, or physical-device operation.

## Verified behaviors

| Surface             | Executed verification                                                                                                                                                                                                                                                   | Result                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Agents              | Scoped Agent suite: inherited override/reset, correct computer/project writes, rename/save/discard, rejected saves retaining drafts, access controls, wide/compact/mobile layouts                                                                                       | Passed                                             |
| Keyboard focus      | Actual catalog Agent form, clean and dirty, dark and light, 1440×960 and 1100×960: Tab from Name through Model, Reasoning, Access and Instructions                                                                                                                      | Passed; every focused control remains unobstructed |
| Settings scope      | Persistent target across pages, canonical Git identity, exact host writes, missing-project protection, inheritance resets                                                                                                                                               | Passed desktop/mobile                              |
| Scoped saves        | Four scopes, stale read cancellation, offline drafts, conflict reloads, local resource overrides                                                                                                                                                                        | Passed desktop/mobile                              |
| Service URLs        | Explicit save/reset, invalid addresses, failure feedback and drafts                                                                                                                                                                                                     | Passed                                             |
| Git                 | Stage/unstage, partial staging, truthful push states, bounded dense lists, inner cue at overflow/end, per-file Previous/Next and Back retaining commit draft/selections and focus                                                                                       | Passed                                             |
| Git outer scrolling | Separate continuation strip, actual-overflow/end/review gating, independent inner cue, footer/gutter geometry                                                                                                                                                           | Passed                                             |
| PRs                 | Initial merge focus on readiness; failures remain visible with details collapsed; action-specific accessible consent including future commits/pushes and failures; status changes revoke consent; no submit before consent; fixed actions at 1440×960,1100×960,1440×720 | Passed                                             |
| Composer            | Icon-only Stop/Queue/Steer, accessible names and native title labels; enabled controls accept hover and focus; preserved keyboard shortcuts, drafts, queues and narrow layouts                                                                                          | Passed                                             |
| Sidebar             | Visible resize grip; pointer and keyboard resize, persistence, reset, constrained widths; icon rails keep their width                                                                                                                                                   | Passed                                             |
| Project deletion    | Active-work blockers, disabled destructive action, Cancel focus, recovery link and stale-runtime safety                                                                                                                                                                 | Passed                                             |
| Unified workspace   | Navigation, pinned browser grid, retained drafts, lifecycle, remote ownership, HTTP, routing and terminal launcher                                                                                                                                                      | Passed                                             |
| Terminal            | Scroll containment, fixed controls, keyboard/paste isolation, split focus/layout, standalone session scope and close behavior                                                                                                                                           | Passed                                             |
| Startup             | Draft/textarea focus and selection survive persistence, routing and delayed hydration; side chats remain unsent and late creations respect navigation                                                                                                                   | Passed                                             |

## Regression fixed during verification

Normal browser focus scrolling could leave Cloud integrations behind the dirty Agent footer. The
shared Settings frame now adjusts focus against its actual sticky target, profile and action bounds.
It excludes portal content and pages without sticky context. The catalog keyboard check reproduced
the defect before the fix and passes after it in all eight theme/width/draft combinations.

## Deliberate boundaries

Git comparisons stay read-only. Explicit Review/Previous/Next and Back to staging support inspection
without changing index contents; staging remains a separate deliberate action, and Back restores the
invoking control and draft. Council advice differed on adding mutations to this viewer. This pass
preserves the existing safeguard rather than introducing index writes from a comparison.

Composer controls retain native hover titles and screen-reader names. No permanent action labels
were added, as requested. Browser checks confirm names/title attributes and actual hover/focus
acceptance, not an OS-native tooltip screenshot or a screen-reader session.

## Council60 follow-up verification

Auto-merge and Bitbucket checkbox names now include the same later-commit/push scope as their
visible consent, while retaining accessible failure acknowledgements. The PR browser suite checks
these names and the existing revision/status invalidation and disabled-submit guards.

Settings now shares scope/storage cue styling and places automatic-save timing with the selected
computer. Explicit service-URL saves remain explicit; clean forms show no-unsaved-changes status,
and Reset still creates a draft for review. The service-URL, runtime, scoped Agent, settings-target,
scoped-settings and General suites pass. Catalog Agent keyboard traversals are refreshed with the
current scope toolbar geometry.
