# Thread info

Thread info opens with a compact summary on desktop and mobile. It shows the project, computer,
branch, agent and model, linked pull requests, changed files and reported context usage. Empty
pull-request and file sections stay hidden in the summary.

The default order puts the project and checkout before agent settings. The summary names the
checkout type, labels an offline computer, and links directly to changed files for review.

The desktop panel is 352 pixels wide and opens by default. It uses the left sidebar background and
has no outer border. A saved closed state still applies. Agent lineage also appears in the desktop
summary when related threads or agents exist. Use the Thread info toggle in the thread header or
press Escape to close the panel.

Select **More details** to show sharing, access and workspace settings, the checkout path, Git
actions, scripts, editor actions, servers, linked projects, watches and related threads. Select the
model row to open its settings. Select **Hide details** to return to the summary.

Saved section visibility and order still apply. Opening the summary does not change these
preferences. Collapsing details keeps mounted editors and their drafts. Context warnings and
pull-request status remain visible in the summary.

On mobile, Customize uses the sheet header. Rows keep a minimum touch height of 44 points. The
native sheet presentation is unchanged.

Thread rows show counts for pending approvals, questions and other input when the computer supplies
request records. The count includes spawned and delegated threads under the same root. Open a
subthread to review its requests. Older watch summaries can show **Needs input** when they only
report a waiting status. A remote request with an ambiguous type appears as other input. Unread
activity keeps its own indicator.

On mobile, a link to a resolved approval checks the recorded decision for that request. If the check
fails, use **Retry**. If the computer is offline, reconnect to check the decision.

## Verification

Run these commands from the repository root in Bash:

```bash
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/desktop build
pnpm exec playwright install chromium
thread_info_styles=(apps/desktop/dist/assets/*.css)
DOVO_BROWSER_STYLE_PATH="${thread_info_styles[0]}" node scripts/check-task-project-panel-browser.mjs
node scripts/check-native-project-panels-browser.mjs
pnpm exec vp test packages/protocol/src/conversation/presentation/thread-info.test.ts packages/studio-core/src/interface-language.test.ts
pnpm --filter @dovo/studio-ui --filter @dovo/extension-tasks --filter @dovo/mobile typecheck
```

The browser checks cover the summary, expanded actions, saved visibility and order, navigation,
scrolling and mobile editor draft retention. The desktop fixture limits its sample summary to 340
pixels. The mobile fixture limits its sample content to 320 pixels. Live content can require more
space.

The mobile browser check adapts React Native controls to the DOM. It does not verify SwiftUI sheet
rendering or physical iPhone behavior.

On mobile, tap a finished assistant response to show its actions. Choose **Quote selection**, select
text in the response sheet, and choose **Add quote to draft**. The quote includes the exact
selection and a reference to the original response.
