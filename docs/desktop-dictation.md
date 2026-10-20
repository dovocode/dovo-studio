# Desktop dictation

Desktop dictation uses Nemotron 3.5 ASR Streaming 0.6B (Q8) with the MIT-licensed `transcribe.cpp`
engine. It runs locally on the CPU, including on Windows and Linux without a GPU. No STT account,
API key, subscription or cloud transcription service is needed.

Open **Settings → General → Speech**, then click **Download & enable dictation**. This explicitly
downloads the 751 MB model and enables the composer's microphone. The page shows download progress,
cancellation, errors and retry. Downloads continue when navigating away from Settings. Use **Enable
dictation** to hide or show the microphone afterward without deleting the model. Choose
**Automatic** or one of the 32 supported language-locales, including Dutch and English. A chosen
language guides recognition; accuracy on mixed-language coding speech still needs evaluation.
Existing Parakeet Redux weights are not reused or automatically replaced: the new download is
opt-in.

Click the microphone and allow microphone access. A native streaming process loads the model once
for the recording. The preview updates while speaking, using the model's maximum-quality streaming
setting (1.12-second chunks); actual delay depends on CPU speed. Click Stop to finalize and insert,
or press Escape to cancel. Recording is limited to five minutes. Disabling dictation, changing
threads or closing the window cancels active recording and prevents late updates from changing a
different draft. Transcription never sends the message. If you edit the draft while recording or
finalizing, the transcript is kept separately for review and explicit insertion.

Audio is captured and processed on the desktop, even when connected to a remote runtime. It is not
uploaded or written to temporary files. The renderer supplies 16 kHz mono PCM to the native helper
through a private pipe; transcript updates return over a framed UTF-8 pipe. Model memory is released
when the recording ends. There is no resident transcription server or separate model cleanup pass.
The final inserted text becomes a normal saved draft and is sent only when you send the message.

The engine is bundled with desktop installers; model weights are downloaded from a pinned Hugging
Face revision and checked for exact length and SHA-256. Internet access is required for that initial
download. Subsequent transcription is offline. Model file size is not active RAM usage. CPU work is
capped at four threads.

## Development and packaging

Run `pnpm prepare:dictation` before using dictation in a development desktop build. It requires
CMake, a C/C++ compiler and `tar` on the build host. Windows uses the Visual Studio C++ toolchain.
The source archive is pinned and SHA-256 checked. Only the Parakeet model family (which includes
Nemotron) is compiled, with a conservative x86 CPU baseline. Dovo's small `dovo-dictation` pipe
helper uses the public streaming C API. Neither Python nor CUDA is needed. Build products and the
test model live under ignored `work/dictation`. The build cache checks both upstream revision and
helper source hash.

`package:desktop` builds and includes the native helper for the packaging host. macOS packaging
includes the microphone usage string, audio-input entitlement and explicit helper signing. The
Electron bridge accepts requests only from the trusted main application document; media permissions
reject cameras and subframes. The helper and model paths cannot be supplied by the renderer. Audio
feeding, finalization and cancellation are scoped to the owning window and operation, including
pop-out windows. The host validates language selection, PCM bounds and transcript sizes.

## Licensing

Model:
[NVIDIA Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b),
licensed under [OpenMDW-1.1](https://openmdw.ai/license/1-1/). The
[GGUF conversion](https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf)
quantizes the model to Q8_0. Dovo does not further modify the weights. The packaged `NOTICE.md` and
`LICENSE.model.txt` provide attribution and full terms. Engine and bundled ggml, miniz and tinyBLAS
notices accompany the native executable under `Resources/dictation` (macOS) or `resources/dictation`
(Windows/Linux).

## Verification

- `pnpm test:dictation:browser`: production Speech settings and composer controls with a real
  Chromium microphone/worklet capture and a simulated desktop bridge. Covers opt-in enablement,
  model download/progress/cancel/retry, language selection, live preview, insertion, concurrent
  edits, failures, cancellation and thread changes. Requires `pnpm exec playwright install chromium`
  first.
- `pnpm test:dictation:native`: builds the real helper, downloads and checks the real Nemotron
  model, feeds the upstream JFK WAV in chunks, checks preview before finalization and the expected
  final phrase, and verifies silent input. The model is cached for subsequent runs.
- Unit tests cover PCM limits, download failures, integrity checks, saved preferences, IPC ownership
  and microphone permission scope.

The native model test verifies English speech on its host, not Dutch coding accuracy or every
supported desktop platform. Browser checks do not establish macOS permission prompts, signed helper
execution or Windows installer behavior.
