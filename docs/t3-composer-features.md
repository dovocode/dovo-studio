# Composer and utility features

These features adapt six T3 Code changes from the comparison at
[`2922e8fb5952`](https://github.com/pingdotgg/t3code/tree/2922e8fb5952). They support desktop/web
and mobile. Update the client and runtime together. HTTP LAN/VPN connections, optional HTTPS,
pairing codes and device tokens retain their existing behavior.

## Model mentions

Type `@` and at least two search characters. Choose a model from the results beside files and
resources. Search uses the runtime's cached model catalogs. Hidden models and default aliases do not
appear. A failed catalog can leave partial results with a notice.

The inserted inline reference identifies the harness and exact model ID. It gives the agent context
without changing the thread's selected model. References survive copying and Markdown source edits.
This adapts [T3 #31207](https://github.com/pingdotgg/t3code/pull/31207).

## Send during uploads

After file preparation, Send can create a pending message while admitted uploads finish. The runtime
receives the message only after all those uploads succeed. This also supports an attachment-only
message. Image editing and file preparation still finish before Send becomes available.

If an upload fails, the draft stays available. Select Retry or Remove for the failed file, then send
again. Retry keeps the original attachment ID. An identical upload retry after a lost response
returns the current draft guard. It cannot reuse a file that has already left the draft. Desktop
retry bytes remain in memory; mobile keeps prepared bytes in its private cache until retry, discard
or unmount. This does not add a durable desktop upload queue across app restarts. This adapts
[T3 #33092](https://github.com/pingdotgg/t3code/pull/33092).

## Dictation on a paired computer

This option is off by default. Each device opts in to each runtime separately in Speech settings.

1. Update the runtime package. For a source checkout, run `pnpm install --frozen-lockfile` and
   `pnpm prepare:dictation` on the runtime computer. The source build needs CMake and a C/C++
   compiler.
2. Install FFmpeg on the runtime computer for phone recordings. Confirm `ffmpeg -version` works in
   the runtime process environment. Set `DOVO_FFMPEG` to an absolute executable path if needed.
3. Open Speech settings for that computer. Select **Download model on computer**. The model is about
   751 MB. It works offline after download.
4. Enable **Use this computer for dictation** on the device that will record. Allow microphone
   access.
5. Record in the composer. Select Finish to send the recording to that thread's runtime.

Use `DOVO_DICTATION_BINARY` to select an existing speech engine executable. Server archives include
the engine under `libexec/dictation`. Desktop bundles retain their existing local engine.

The mobile app needs a new native build with `expo-audio`; a JavaScript update alone cannot add the
native module. For local development, run `pnpm --filter @dovo/mobile exec expo run:android` or
`pnpm --filter @dovo/mobile exec expo run:ios` on the corresponding build host. Older installed
builds show an update message. Existing native speech recognition remains the default when runtime
dictation is not selected.

Audio stays on the recording device until Finish. The selected runtime decodes and transcribes it
without staging audio files. The phone removes its temporary recording after use. Recordings have a
five-minute limit. Cancelling, backgrounding the phone, changing the thread/computer or turning off
the option cancels the recording and discards late results. The runtime permits one speech operation
at a time. A selected runtime that is offline or lacks the model reports an error. It does not
switch to another computer, local recognition or a cloud speech service. Browser microphone access
still follows the browser's secure-origin rules; runtime connections themselves can use HTTP.

Optional transcript cleanup uses the existing utility text model. If that model uses an external
API, cleanup sends transcript text to that API. The speech option sends no audio to that API. This
adapts [T3 #30625](https://github.com/pingdotgg/t3code/pull/30625).

## Direct utility text APIs

In Titles & dictation settings, select **Generate text with**, then **OpenAI-compatible API** or
**Anthropic API**. Set the API base URL and exact model ID. The base URL must include the provider's
API prefix, such as `https://api.openai.com/v1` or `https://api.anthropic.com/v1`.

Select a host environment or vault reference for the API key. For example, select the environment
reference `OPENAI_API_KEY` after setting that variable in the runtime process. A local API can use
HTTP with no key. Save the settings. The API model can work without a selected coding model.

Text-only utilities, including titles, commit/PR text and dictation cleanup, can use the direct API.
The request contains text and has no tools or coding session. Work that needs checkout access uses
the configured harness below the API fields. Managed provider restrictions disable direct API
targets. API errors do not silently fall back to a harness. Keys resolve on the runtime; only their
references enter saved settings. Redirects are rejected, and provider error bodies are not shown.
This adapts [T3 #33147](https://github.com/pingdotgg/t3code/pull/33147).

## Vault references for secret answers

For a secret question, select **Use a secret reference**. Choose a host environment variable,
1Password, Bitwarden or Infisical reference. Configure and unlock that provider on the runtime
computer. The existing secret resolver uses the runtime's credentials and provider CLIs.

The form sends the reference, not the secret value. The runtime resolves it when it accepts the
answer. Failed lookups leave the question pending for retry. Cancellation discards late results.
Activity records redact the answer and do not contain the vault locator. Ordinary questions cannot
use secret references. Typed secret answers remain available.

The resolved value is delivered through the existing provider question-answer path. It can therefore
enter the coding provider's session. This feature does not create an opaque credential file or a
secret channel hidden from that provider. It does keep the value out of the device form, normal
workspace state and Dovo activity records. This adapts
[T3 #31670](https://github.com/pingdotgg/t3code/pull/31670).

## Next-prompt suggestions

Enable **Suggest next prompt** in the computer's runtime preferences. It is off by default. A
completed Claude or Codex human turn can produce one suggestion when the composer is empty. Queued,
running, delegated, automated and archived threads do not request suggestions. Settled threads can
request them. This makes an extra model request and can consume tokens.

Click or tap a suggestion to put it in the draft. On desktop/web, Tab accepts it and Escape
dismisses it. It never sends the message. Existing draft text, files and active composer operations
hide the suggestion. Requests coalesce by thread and completed turn; typing does not trigger
repeated calls. The request uses the completed turn's model through an ephemeral Claude/Codex
session with no tools. This adapts [T3 #28047](https://github.com/pingdotgg/t3code/pull/28047).

## Verification

Run the focused checks from the repository root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test packages/protocol/src/conversation/presentation/model-mentions.test.ts packages/runtime/src/http/endpoints/model-mentions.test.ts packages/runtime/src/agents/tasks/text-generator.test.ts packages/runtime/src/agents/execution/question-secret-references.test.ts packages/runtime/src/agents/tasks/title-generation.test.ts packages/runtime/src/speech/runtime-dictation.test.ts packages/runtime/src/storage/attachments.test.ts
pnpm test:t3-features:browser
pnpm test:rich-composer:browser
pnpm test:title-settings:browser
pnpm test:composer-send:browser
```

The runtime audio test decodes a real WAV when FFmpeg is available. The cross-client Chromium checks
exercise actual hooks/forms and simulate native filesystem, recorder and lifecycle boundaries. They
do not establish physical microphone, installed iOS/Android or OS permission behavior. Live
model/vault APIs, a full speech model transcription and final native/server archive packaging still
need verification on their target systems. No live provider or vault credentials are needed by the
automated fixtures.

Local validation passed all 31 workspace typechecks, all 29 build tasks, 143 focused regression
tests and 60 packaging tests (two skips). Managed Chromium passed the feature, composer, title
settings, model mention, question attachment, local dictation and attachment/image checks. The full
unit run passed 7,435 tests with 13 skips. Its demo-bundle failure passed after the full build. Five
existing runtime-browser tests remain blocked because this Linux host cannot start Chromium with its
required sandbox. The feature browser fixtures use Playwright's normal test launch settings.
Production browser sandbox behavior was not changed to make those tests pass.
