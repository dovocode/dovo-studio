# Mobile page catalog

The mobile screen catalog imports production screen components from `apps/mobile/src/screens` and
route-owned components from tasks, SCM and jobs. It does not redraw those pages for Storybook.

## Browser and native content stories

`apps/mobile/src/catalog/screens.tsx` is the typed list of screens used by both catalogs. The
website renders that content through React Native Web. The native catalog mounts it in a real Expo
Router stack, so production `ScreenHeader` uses actual UIKit navigation controls.

- Collections: tasks, archived tasks, projects, PRs, issues, automations, artifact library,
  computers.
- Detail and creation: conversation/task detail, full composer, new thread, launcher, PR detail,
  issue detail, pipeline detail, pipeline runs, automation detail, Jira issue detail.
- Settings indexes: top level, app preferences, agents/tools, tasks/projects, computers, history.
- Settings pages: appearance, general, conversation, speech, battery/background, task preferences,
  notifications, task defaults, agents, MCP/skills/hooks, device hosts, usage, source control, task
  behavior, PR preferences, runtime tools, artifacts, memory, worktrees, activity retention, and
  app/updates.

Main collections have empty and selected populated/offline/error/loading examples. These are
specific states supported by the actual screen; this is not an assertion that every permutation of
every page is catalogued. Synthetic payloads are decoded using the actual protocol schemas. Unknown
reads and all runtime mutations reject explicitly. Populated PR, issue and pipeline reads use local
endpoint fixtures, including the normal source identity checks; they never call a forge.

The full composer mounts the actual `ConversationProvider`, `Composer` and `MessageQueue`, with a
synthetic offline task, saved local draft, text attachment and queued message. Offline send/upload
behavior is represented, not a working provider session. Dictation and file pickers are native
capabilities and are not simulated as successful uploads or recognition.

## Complete native navigation

`apps/mobile/.rnstorybook/stories/screens-shell.stories.tsx` additionally mounts the actual
`Workbench` and all existing mobile `.tsx` routes/layouts through a separate Expo Router context.
Its route files re-export the corresponding production routes. The root differs deliberately: it
supplies catalog state rather than mounting production runtime/account/background providers.
Tasks/PR tabs, menus, nested settings navigation and detail stacks are therefore actual native
navigation. These stories belong in the iOS/Android catalog, not a web imitation of native tabs.

Run the native catalog on the dedicated Mac Studio simulator:

```sh
pnpm --filter @dovo/mobile storybook:ios --device "Dovo UI Review"
```

Use the separate Dovo UI Catalog app identity for device review; the command by itself uses the
normal Expo identity. Do not install it over a personal production app without adapting identity.

## Isolation and limits

- No production `App`, `RuntimeProvider`, `MobileAccountProvider`, push registration or live
  activity provider is mounted. The account context has no session/directory and sign-in is
  disabled. Pairing/runtime commands use the rejecting catalog runtime.
- Browser release checks return a synthetic stable release through a screen-specific adapter; they
  do not query GitHub. Production release discovery is unchanged.
- Browser preferences/storage are catalog adapters. Native preferences/drafts belong to the
  separately installed catalog app, never a production account or a paired computer.
- Runtime example addresses use `catalog.invalid`. They are illustrative HTTP LAN/VPN values, not a
  change to the production connectivity policy.
- Native Markdown, SwiftUI menus/sheets, system permissions and gesture behavior require the native
  catalog. React Native Web content previews cannot establish native parity.
- The development entry blocks direct fetch/WebSocket traffic except the local Metro connection.
  Native links, pickers, permissions and dictation remain real operating-system capabilities;
  catalog rendering is not verification of uploads, speech recognition or those external flows.
- Jira uses a synthetic Cloud source and issue; company-specific authentication flows are not
  mounted.
- Browser/native render and interaction results must be recorded separately. Adding a typed story
  does not by itself verify its native screen or every page action.

## Native verification, 21 October 2026

A fresh iOS simulator catalog bundle ran on Mac Studio (iOS 27, 402-point display). Verified actual
native rendering of Settings, Tasks empty/offline with full task rows, full composer (attachment,
local draft, queue, provider and microphone controls), and PR overview. The actual Workbench was
exercised through startup New thread → Back → Tasks, native overflow menu → Settings → This app →
Appearance → Back. Reference captures of Workbench Tasks, Settings and full composer are published
under **Dovo / Mobile / Native simulator**.

Catalog fixes discovered during this run: navigation theme now matches production; the synthetic
runtime uses the production pure value provider so selector-based task rows receive the same runtime
atom as broad context readers; standalone stacks supply runtime context above native header
renderers. Sending, speech recognition, physical-device behavior and every possible screen action
were not established by this simulator review.

## Encrypted sharing verification, 25 October 2026

A separate iOS simulator app (`com.dovo.studio.sharingreview`) ran a freshly exported catalog bundle
with the current native dependency versions. The production sharing sheet was reviewed in light and
dark appearance. Verified pause/resume, native link-expiry selection, anonymous link creation,
composer insertion, suggestion dismissal, recovery-key reveal and the deletion confirmation
(cancelled). The inline suggestion card was reviewed in both appearances; insertion preserved an
existing synthetic draft and dismissal removed the card without opening sharing settings. The
catalog uses encrypted, synthetic in-memory publications and makes no production requests.

Android, physical devices, complete Dynamic Type coverage, recovery-key hiding and confirmed native
deletion were not established. Browser tests cover the full encrypted manager lifecycle and inline
inbox isolation, draft preservation, dismissal failures and polling cleanup separately.
