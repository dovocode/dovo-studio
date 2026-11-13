# Mobile thread loading and question recovery

Mobile keeps recently opened conversations in memory while live summaries arrive. A quick return to
a thread no longer depends on the 15-second offline cache writer. The retained history uses the
existing cache rules: at most 20 detailed threads, with an 8 MiB budget for restored history. The
active runtime detail is separate from that byte budget.

Fresh summaries still supply the title, status, draft and settings. Removed threads and changed
history revisions invalidate retained history. Changed addresses, credentials, runtime identities
and runtime process identities also prevent reuse. The cache keeps conditional-read validators and
stable references for unchanged rows. A thread with no valid saved history still needs a network
read. This change does not remove that loading state.

Editing an ordinary question answer creates a recovery ID. The old UUID call assumed that a browser
`crypto` global existed. Hermes has no such global. A native reproduction failed with
`ReferenceError: Property 'crypto' doesn't exist` in `v4 -> mark -> update -> onDraftsChange`.

Shared recovery IDs now use UUID v4 with random bytes from TweetNaCl's configured platform source.
Mobile already configures that source with Expo Crypto. This uses native secure randomness and does
not add a global browser-crypto shim or a weak-random fallback. A failed random source still fails.
The same fix covers new-thread draft IDs.

## Local checks

Run from the checkout root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test packages/protocol/src/random-uuid.test.ts packages/protocol/src/conversation/workflow/question-recovery.test.ts packages/protocol/src/tasks/next-thread-draft.test.ts packages/protocol/src/runtime/cache/thread-cache.test.ts packages/protocol/src/runtime/cache/overview-state.test.ts apps/mobile/src/runtime/connection/overview-state.test.ts apps/mobile/src/runtime/connection/offline-startup.test.ts
node scripts/check-agent-interactions-browser.mjs
node scripts/check-mobile-registry-recovery-browser.mjs
node scripts/check-mobile-draft-transition-browser.mjs
node scripts/check-mobile-task-list-rendering-browser.mjs
node scripts/check-composer-recovery-browser.mjs
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/mobile exec tsc -p tsconfig.json --noEmit
pnpm check
```

The question browser fixture uses the real mobile state and answer-recovery code. It supplies a
platform random source, then removes the browser `crypto` global. Native presentation and storage
remain adapters in that fixture.

The provider regression sends detailed history followed by a summary before the offline writer runs.
The old code lost the history; the new code retains it and the current draft. The row reference
check sends 30 summaries and verifies that unchanged rows keep one reference. These checks do not
measure iPhone navigation or frame times.

## Native question check

`apps/mobile/scripts/question-recovery-native.tsx` is a standalone test entry. It uses the real
question form, native controls, Effect state, Expo Crypto and AsyncStorage. It has no runtime
connection. Use test answers only. Run it in a separate test app or simulator. Do not replace a
user's installed app with this entry.

After the normal native dependency setup, build on a Device Hub Mac. Set `ENTRY_FILE` to the
absolute path of that file for the Xcode build. For example, from the checkout root:

```sh
ENTRY_FILE="$PWD/apps/mobile/scripts/question-recovery-native.tsx" xcodebuild \
  -workspace apps/mobile/ios/DovoStudio.xcworkspace -scheme DovoStudio \
  -configuration Release -sdk iphonesimulator -destination 'id=<Device Hub simulator UUID>' \
  -derivedDataPath work/question-recovery-native ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
```

Call Device Hub `devices` first. Install through `device_install`, then verify launch separately.
Use a current native build: an older app binary can lack AsyncStorage 3's native module even when
its JavaScript bundle loads.

Select an option, edit a custom answer, then restart without submitting. Check that the answer
returns. Also check a failed send, retry, successful send, decline and the separate composer draft.
Before the UUID fix, the first edit aborts the native app. Browser checks alone do not establish
this native result.

Verified on 2026-11-12 in the iOS 27.0 simulator on Mac Studio van Dominic. A separate
`com.dovo.questionqa` app reproduced the original crash. With the fix and current native modules,
option changes and text edits worked. Native storage restored the test answer after app restart. A
failed test send kept the answer. Retry, successful submission and decline completed. The separate
composer draft stayed intact. Submission used the fixture's test handler, not a runtime.

The separate app does not have Studio's shared notification entitlement. It shows a notification
draft warning; this check does not verify notification answer recovery. Device Hub screenshots and
launch worked. When its input controls reported an expired preview, the remaining taps used the same
Mac's existing `idb` against the same simulator. No user app data was changed.

All 1,574 protocol tests, the focused mobile tests, the browser checks above, the protocol build,
mobile types and repository checks passed. The repository check reported 31 existing warnings and
zero errors. These checks do not verify physical iPhone answer flows or navigation times. Build and
install the normal app entry separately to use the fixes on a physical iPhone.
