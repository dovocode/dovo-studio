# Post-approval CI corrections

Council61's 350-frame gallery and source digest remain the approved baseline. This supplement
records the small production corrections made while fixing final CI; it does not claim that the
baseline screenshots are pixel-identical to the final source.

- Primary buttons reserve a transparent border while enabled, preventing a 2px action-row shift when
  saving disables the button.
- Project initials use the original protocol palette directly. Mixing those colors with the light
  card surface reduced text contrast; all ten original colors meet at least 4.5:1 with white.
- The conversation scroll viewport is explicitly keyboard-focusable even when it has no links.
  Upward navigation releases the follow controller; direct Page Up/End verification checks leaving
  and returning to the latest message. Control shortcuts keep their native handling.
- Browser expectations now follow the current thread terminology, clean desktop save state and
  unconfigured Jira fixture. Configured-source Jira filter coverage remains separate.

The 20 lossless WebP captures cover six representative surfaces in both themes plus compact Agent
states. `manifest.json` records twelve core captures with no errors or alerts; `interactions.json`
records eight unobstructed keyboard traversals. Supplemental frames include compact views. Every
WebP was checked pixel-for-pixel against its PNG capture.

Local checks passed: web UI/web/desktop builds; affected package types; scoped lint/format; layout
stability; thread scrolling; shared-control appearance including contrast modes; catalog
interactions; configured Jira views/workspace; workspace submit and suggestions; mobile sheets,
search, visual controls, pipeline lists and PR lists. Final CI remains a separate shipping gate.

All five original council members confirmed their 9/10 and ship verdicts after reviewing the CI
delta, including the keyboard fix; no required regressions were identified. These are focused
confirmations, not a second full-app review. See [reviews.json](reviews.json). Muse’s supplemental
confirmation remains pending; its original 9/10 consultation is recorded in the baseline.

The complete four-shard design matrix passed: 1,140 story/theme/viewport cases and 168 hosted
inner-frame accessibility cases. That build includes the viewport focus, contrast and border fixes;
the later keyboard-release handler was verified separately by the full thread-scroll suite against
current source. The complete catalog interaction run passed after correcting the preview button and
attachment names to match the existing synthetic fixture.
