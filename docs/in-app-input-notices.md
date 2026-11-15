# Input notices in Dovo

Desktop and mobile show a notice when another thread needs human input. Mobile notices are on by
default. Change this in Settings > Notifications > Inside Dovo. System push permission is not needed
for these notices.

A notice opens the thread on its owning computer. On mobile, opening a notice from a thread also
shows "Return to [thread]". Tap it to return to that thread and computer. The return route keeps
native-agent and parent-thread details. Composer drafts use the existing per-computer, per-thread
storage. Navigation does not send or clear a draft. Opening a notice from a list or settings does
not create a return target.

Mobile notices show the thread title and computer name. They do not show question text, commands or
secret input. The app queues new requests, clears answered requests and skips the thread you are
viewing. Dismiss a notice or let it close after eight seconds. Pending requests remain in their
threads. The queue holds at most 50 notices.

Questions routed to the parent agent do not notify the human. Human requests from child agents link
to the owning conversation. Initial snapshots and reconnects do not replay old notices. Requests
that arrive while Dovo is in the background use the existing push settings. While Dovo is active, a
handled in-app notice suppresses the duplicate system banner and sound. Native push stays available
when the in-app notice cannot handle it.

The feature uses existing runtime snapshots. It adds no polling or history reads. Notices from other
computers depend on the existing overview update interval and connection.

## Verification

Run from the repository root:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm exec vp test --maxWorkers=2 packages/studio-shell/src/task-notifications.test.ts apps/mobile/src/notifications/in-app-notices.test.ts apps/mobile/src/runtime/preferences/app-preferences.test.ts packages/studio-core/src/interface-language.test.ts
pnpm test:task-notifications:browser
pnpm test:mobile-notifications:browser
pnpm --filter @dovo/protocol --filter @dovo/studio-shell --filter @dovo/mobile typecheck
```

The mobile browser check uses the real notice component, request model, push bridge and composer
draft hook. It adapts native controls and Expo navigation to browser controls. It verifies the
return route and draft recovery across different computers. It also checks focus, request cleanup,
queue expiry, settings, reconnects and push deduplication. The push-provider check verifies native
banner and sound decisions at the handler boundary. These checks do not establish native stacking,
VoiceOver behaviour or physical push delivery. Verify those on iPhone before claiming device support
is tested.
