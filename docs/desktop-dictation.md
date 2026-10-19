# Desktop dictation

The desktop composer can transcribe speech locally using Parakeet Redux and the MIT-licensed
`transcribe.cpp` engine. No STT account, API key, subscription, Photon, or cloud transcription
service is needed. English, Dutch and 23 other languages are supported; mixed-language coding
accuracy still needs evaluation on real speech.

Click the microphone in the message composer. On first use, explicitly download the 159 MB model,
then click the microphone again and allow microphone access. Click Stop to transcribe, or press
Escape to cancel. Recording is limited to five minutes. Transcription inserts into the original
selection without sending the message. If you edit the draft while transcription is running, the
transcript is kept separately for review and explicit insertion. Switching threads cancels the
session and prevents a late result from changing another draft.

Audio is captured on the desktop even when the conversation uses a remote runtime. It is not
uploaded. PCM is held in memory during recording; transcription writes a temporary WAV and
transcript in the desktop data directory, then deletes them on success, failure or cancellation. An
abrupt OS/process termination can leave those temporary files behind. The final inserted text
becomes a normal saved draft and is sent to the selected agent only when you send it. Dictation does
not run model cleanup or send text to a separate utility model.

The engine is bundled with desktop installers; model weights are downloaded from a pinned Hugging
Face revision and checked for their exact length and SHA-256. Internet access is required for that
initial download. Subsequent transcription is offline. A short-lived native process loads the model
per utterance and releases it afterward; there is no resident transcription server. Model file size
is not the same as active RAM usage. CPU work is capped at four threads.

## Development and packaging

Run `pnpm prepare:dictation` before using dictation in a development desktop build. It requires
CMake, a C/C++ compiler, and `tar` on the build host. Windows uses the Visual Studio C++ toolchain.
The source archive is pinned and SHA-256 checked. Only the Parakeet model family is compiled, with a
conservative x86 CPU baseline and Metal enabled by upstream on Apple Silicon. No Python or CUDA
installation is required. Build products and the test model live under ignored `work/dictation`.

`package:desktop` builds and includes the native helper for the packaging host. macOS packaging
includes the microphone usage string, audio-input entitlement and explicit helper signing. The
Electron bridge accepts requests only from the trusted main application document; media permissions
reject cameras and subframes. The helper and model paths cannot be supplied by the renderer.
Cancellation is scoped to the owning window and operation, including pop-out windows.

## Licensing

Model: [Parakeet Redux](https://huggingface.co/moondream/parakeet-redux), by Moondream, derived from
[NVIDIA Parakeet v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3). The
[GGUF conversion](https://huggingface.co/Nairod785/parakeet-redux-gguf) retains ternary encoder
weights and quantizes dense weights to Q8_0. These weights are CC BY 4.0; the engine and its bundled
ggml, miniz and tinyBLAS notices are included beside the packaged executable under
`Resources/dictation` (macOS) or `resources/dictation` (Windows/Linux). Dovo does not further modify
the weights. The packaged `NOTICE.md` and `LICENSE.model.txt` give attribution and full terms.

## Verification

- `pnpm test:dictation:browser`: production composer dictation controls with a real Chromium
  microphone/worklet capture and a simulated desktop bridge. Covers opt-in download, recovery,
  insertion, concurrent edits, cancellation and thread changes. Requires
  `pnpm exec playwright install chromium` first.
- `pnpm test:dictation:native`: builds the real helper, downloads and checks the real Redux model,
  and transcribes the upstream JFK WAV sample. Checks the expected phrase. The model is cached for
  subsequent runs.
- Unit tests cover PCM encoding, download failures, integrity checks, IPC ownership and microphone
  permission scope.

The native model test verifies English speech on its host, not Dutch coding accuracy or every
supported desktop platform. Browser checks do not establish macOS permission prompts, signed helper
execution or Windows installer behavior.
