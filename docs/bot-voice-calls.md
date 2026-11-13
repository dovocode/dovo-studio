# Bot voice calls

Open an active Bot and select **Call**, then **Start call**. On mobile, Call appears in the thread
header. Allow the device’s microphone and speech permissions when asked.

The call uses the Bot’s existing conversation, saved harness, model, tools, and access limits.
Speech goes through the normal message queue. It does not replace your unfinished composer text. The
full written reply stays in the conversation. Calls do not grant permission to approve tools. A
question or approval pauses listening. Select **Review in chat** to answer it there.

## Audio and controls

- Desktop uses the local dictation engine, or the runtime selected in **Settings → Speech**. Install
  its speech model before calling. The web viewer uses runtime transcription when a local desktop
  bridge is unavailable. Runtime addresses can still use HTTP over LAN or VPN.
- Spoken replies use this device’s system voices. Install or enable a system voice if playback
  fails. This path does not require a separate paid speech account.
- Native mobile calls use the device’s speech recognition service and system voice. Device speech
  settings determine language support, on-device availability, and whether recognition uses the
  platform’s online service. On iPhone, silent mode can affect spoken audio.
- Speak, then pause for about one second to send. Desktop capture splits speech at 30 seconds. The
  microphone stays off during playback to avoid recording the Bot’s own voice.
- **Interrupt** stops playback and listens again. It does not stop agent work. This release does not
  detect spoken interruptions during playback.
- **Mute** releases the microphone. Replies can still play. **Unmute** listens again.
- **End call** stops capture and playback. Requests already sent and background work can finish.
  Closing the call screen, changing its computer/thread, or putting the app in the background ends
  audio. Calls do not restart after an app restart. Only one call owns the microphone per client.

Code and links stay in chat. Long replies use a bounded spoken excerpt and point back to the chat.
The call screen shows the latest request and reply; the conversation keeps all sent messages. A lost
send response offers **Retry same message** with the same request identity. It does not create
another agent turn for a request that the runtime already accepted. Disconnects require an explicit
resume after connection recovery. Call controls do not resume paused Bot queues.

Web microphone capture needs a browser origin that permits microphone access, such as HTTPS or
localhost. This requirement applies to the viewer, not the paired runtime’s address. Use the desktop
or native app when the viewer cannot access a microphone.

## Verification

```sh
pnpm exec vp test packages/client-runtime/src/effects/bot-call.test.ts packages/protocol/src/tasks/bot-call.test.ts packages/extension-tasks/src/bots/bot-call-audio.test.ts apps/mobile/src/bots/bot-call-audio.test.ts packages/runtime/src/http/endpoints/bot-call.test.ts apps/mobile/src/tasks/composer/dictation.test.ts
pnpm exec playwright install chromium
node scripts/check-bot-call-browser.mjs
node scripts/check-bot-call-audio-browser.mjs
pnpm typecheck
pnpm build
pnpm check
```

Unit tests use scripted microphone and speech drivers. The runtime test uses HTTP, SQLite, the real
message queue, and a scripted agent. Browser checks mount both real call components with fixture
native controls and audio. A separate Chromium check uses real microphone capture and AudioWorklet
processing with a generated speech/silence recording and a scripted transcription bridge. These
checks do not establish microphone quality, native audio routing, spoken language quality, or live
model performance on physical devices.

This call mode uses transcription and system speech. It does not use a Codex/OpenAI realtime voice
relay, telephone numbers, incoming calls, or background microphone capture.
