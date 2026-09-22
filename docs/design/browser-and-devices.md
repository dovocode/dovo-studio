# Task browser and device previews

Tasks have a Browser surface on desktop, web and mobile, alongside Chat, Changes and Terminal.
**Host browser** runs Chromium on the task's computer and streams it into a canvas on the viewing
device. The same task shares its browser session across clients. Device operations also run on the
task's computer.

## Host browser

1. Start the project's development server using the task terminal.
2. Open **Browser → Host browser**, enter `localhost:3000` (or another HTTP/HTTPS address), and
   press **Go**. Loopback stays on the host: the phone only needs access to the Dovo runtime.
3. Tap/click the page, swipe or wheel to scroll, and use **Keyboard** to type into a focused field.
   Hardware typing, paste, shortcuts, Back/Forward, Reload and website dialogs are supported.
4. Choose Fit view, Phone, Tablet or Desktop; use Rotate for fixed viewport sizes.
5. **Reconnect** resumes the page after a connection interruption. Closing the session clears its
   in-memory cookies and history. Without any viewers, streaming stops and the session expires after
   five minutes. Runtime shutdown closes all browser processes.

On iOS, preview screens use an explicit Back button and disable app swipe-back, so edge swipes stay
inside the browser or simulator. Live devices also have a Back to simulators button. Browser touch
gestures are forwarded as native Chromium touch events (including page swipe handlers and scrolling
inertia); older hosts retain wheel scrolling until updated. Temporary Chromium document replacement
keeps the last navigation controls until fresh history is available. Real navigation failures still
appear as errors.

Returning to the mobile app reconnects with a fresh ticket while retaining the canvas, viewport and
unfinished address input. Only a terminated WebKit process rebuilds the viewer. Input is disabled
immediately when backgrounded, and pending connections cannot reopen a closed preview. Gestures
track one pointer at a time: an extra finger does not interrupt or redirect an active drag. The
final release position is forwarded before lifting the remote finger, including when no final move
event arrives. Losing pointer capture releases the remote finger and unlocks the next gesture.

Install Chrome on the host or install the matching bundled Chromium from this checkout:

```sh
pnpm --filter @dovo/runtime exec playwright install chromium
```

On Linux, Playwright's `install --with-deps chromium` also installs browser system dependencies.
`DOVO_BROWSER_EXECUTABLE` can select a compatible Chromium executable. No desktop display is
required. Update/restart the host runtime along with the app to expose the browser endpoint.

The implementation uses
[Playwright screencast frames](https://playwright.dev/docs/api/class-screencast#screencast-start)
and an authenticated WebSocket. One-use, 30-second tickets keep bearer credentials out of the
viewer. Revoked devices lose their stream, input is validated and bounded, slow connections retain
only the latest frame, and up to eight task browser sessions can be open on a runtime. Browser
contexts are isolated from personal browser profiles; they do not receive Dovo tokens or filesystem
permissions. An HTTPS web app still requires an HTTPS/WSS runtime endpoint. No development-server
ports need to be exposed to the phone.

The canvas represents the remote page visually: it does not expose that page's DOM to the client's
screen reader. Use Direct preview when local page accessibility is needed. This slice doesn't
transfer uploaded/downloaded files, system clipboard contents, audio or video streams. Typed text
and explicitly pasted text are forwarded. HTTP popups open in the same preview tab; authentication
flows requiring a separate popup window may need Direct preview or an external browser.

## Direct previews and simulators

### Physical iPhones and Xcode Device Hub

The **Devices** list includes real iPhones/iPads reported by Xcode and Android phones reported by
ADB, separately from simulators. Physical iOS **View screen** uses Apple Device Hub in Xcode 27: the
runtime opens the selected phone's compact window, captures only that window with ScreenCaptureKit,
and forwards input to Device Hub. It does not capture the desktop. Device Hub's native controls
remain part of the mirrored window. One task at a time controls a physical phone.

Connect and unlock the phone, trust the Mac, and enable Developer Mode. **Set up on Mac** opens
Device Hub and the two relevant macOS permission panes. The automatically compiled
`Dovo Device Hub Bridge` helper may need Accessibility and Screen Recording permission on the host
Mac. The helper is cached under `~/.dovo/helpers`; no Appium server or phone automation runner is
required. Xcode Device Hub must remain available on the host. Apple can pause mirroring while the
phone's microphone/camera is active or its connection is unavailable.

Physical Android devices support discovery and screenshots in this slice; their live-control button
is disabled. Existing Android emulator and iOS simulator live controls remain available.

On mobile, **Expand preview** hides the task header, mode picker and browser toolbars while
retaining a visible **Show controls** button. The canvas stays mounted, so expanding does not
reconnect or reset the page. Safe-area insets protect the controls around the notch and home
indicator.

Device ownership stays scoped to a host and task. Native processes are supervised, setup guidance is
available beside each device, and hidden streams stop automatically.

**Direct preview** (Responsive on desktop) retains the local Electron/WebView/iframe renderer. Here
`localhost`, `127.0.0.1`, `::1` and `0.0.0.0` map to the host's network address. The development
server must listen on a reachable interface such as `0.0.0.0`, and the viewing device must reach it
through Wi-Fi, Tailscale or NetBird. Web sites can block framing, and HTTPS pages can block HTTP
embeds. Host browser avoids these embedding and development-port limitations.

Direct preview's last URL is retained per host/task for the application session. Electron previews
have no Node integration or Dovo preload and deny native permission requests. Responsive presets
change viewport dimensions, not the browser engine or hardware.

Choose **Simulators** to list devices on the host. Start or stop one, open a URL, or capture a
screenshot. **Live preview** opens a booted device in the same interactive canvas as Host browser,
including touch drags, text entry and a Home button. Android also provides Back. Frames come from
native simulator streams, rather than repeated screenshot commands. Closing the preview leaves the
device running. Streaming pauses immediately when its last viewer disconnects; the native connection
is retained for 30 seconds to allow a quick reconnect. Up to four live devices can be attached per
runtime.

Live iOS previews require the native idb companion on the host:

```sh
brew tap facebook/fb
brew install facebook/fb/idb-companion
```

Set `DOVO_IDB_COMPANION` if the executable is outside PATH. Dovo starts its own companion with a
private Unix socket and stops only that helper when the preview closes. Android uses the emulator's
local authenticated gRPC connection. Start the emulator through Dovo, or launch it with
`-grpc-use-token`. An externally started emulator exposing only JWT authentication must be restarted
with this option before streaming. Tokens stay on the runtime and are never sent to the viewer.

These previews support a single touch pointer, keyboard input and explicit paste. They do not stream
audio or implement multitouch gestures. Simulator screen pixels do not expose native accessibility
semantics to the viewing device. Physical devices are not included.

## Device requirements

- iOS: the runtime must run on macOS with Xcode selected and a Simulator runtime installed.
- Android: install Platform Tools and Emulator, create an AVD, and configure `ANDROID_HOME` or
  `ANDROID_SDK_ROOT` if the SDK is outside the default location. Tools on PATH are also supported.
- No physical device actions, app installation, erase or reset commands are exposed.
- Only device IDs returned by current discovery are accepted. Authenticated requests must identify a
  task on that runtime. Actions serialize per device, and starting emulators cannot be started
  repeatedly while their launch process is still active.
- Android emulator URLs using host loopback are translated to `10.0.2.2`.
- Missing tooling is shown as setup guidance. Unavailable devices are excluded.

## Planned improvements

Suggested sequence after this slice:

1. Send preview screenshots and annotated feedback into the existing attachment/draft flow.
2. Project dev-server configurations with start/stop, readiness and logs, scoped to task checkouts.
3. Explicit agent browser tools, with visible actions and site permissions.
4. Persistent browser sessions with clear storage controls and task ownership.

## Original direct-preview verification

Relevant tests cover URL validation, IPv6 and remote-host mapping, viewport bounds, simulator
parsing and authenticated runtime/task scope. `scripts/verify-preview.cjs` exercises the desktop
browser against a local fixture. `scripts/verify-mobile-preview.mjs <simulator-uuid>` pairs a test
runtime, opens an embedded page and checks host device discovery. Use an isolated simulator.

Verification logs and screenshots for this pass are in `work/design/device-preview`.

Results for this pass:

- Full workspace suite: 702 tests passed. The 13 focused preview tests also pass after final
  changes.
- Formatting, lint and type checks pass; desktop and iOS Release simulator builds pass.
- Native mobile walkthrough passes: pairing, embedded page, host simulator list and screenshots.
- Real isolated iOS simulator: discover, boot, open URL, screenshot and shutdown verified. The QA
  simulator was deleted afterward; existing simulators were left alone.
- Desktop interactive smoke verification remains blocked by Electron native startup crashes/timeouts
  in this environment. IPC isolation, URL rejection, viewport bounds and view lifecycle have unit
  coverage, but this does not substitute for a successful desktop walkthrough.
- Android commands are implemented, but actual emulator execution was not verified because this
  machine has no usable Android emulator SDK installation.

Those historical checks predate Host browser and live simulator streaming; see the current checks
below.

## Host browser verification

- Protocol and HTTP tests cover URL/input bounds, authentication, task scope, one-use ticket
  isolation/expiry, device revocation and input authorization after queueing.
- `node scripts/verify-remote-browser.mjs` runs a real host-only HTTP fixture and the sandboxed
  canvas viewer. It checks rendered frames, pointer input, hardware and mobile text entry,
  Back/Forward, scrolling, viewport resizing, reconnect, session close and credential rejection.
- Build the runtime dependencies first: `pnpm --filter @dovo/runtime... -r build`.
- Screenshots and results are written to `work/design/remote-browser`.

## Streaming performance and simulator verification

The viewer receives binary JPEG frames with at most two frames awaiting a paint acknowledgement.
Both ends replace obsolete pending frames instead of building a backlog. Image decoding happens
asynchronously, painting follows animation frames, and the canvas backing store is reused. Older
viewers retain the JSON frame fallback. Scroll, pointer movement and resize input are coalesced
while preserving action order. Browser state sampling does not block its input queue.

`node scripts/benchmark-remote-browser.mjs` measures the host input queue against a local fixture.
The 60-event scrolling burst previously left 984–1167 ms of queued work; after these changes it left
16–19 ms. These are loopback host measurements, not phone network latency or a frame-rate guarantee.
Results are in `work/design/remote-browser/performance`.

- `node scripts/verify-remote-browser.mjs --slow-decoder` exercises the viewer with an artificial 80
  ms image decode delay, along with typing, scrolling, reconnect and viewport changes.
- `node scripts/verify-simulator-stream.mjs ios:UUID android:AVD_NAME` verifies real native frames,
  dragging, Home and closing previews. Supply only explicitly booted QA devices.
- `node scripts/verify-mobile-preview.mjs UUID --remote --live-simulator=android:AVD_NAME` checks
  the native mobile wrapper against a separate Android emulator, avoiding recursive screen capture.
- Unit tests cover fragmented native frames, packet bounds, paint acknowledgements, scoped one-use
  tickets and releasing input when a paired device is revoked.

Native protocol attribution is recorded in
[simulator protocol licenses](../licenses/simulator-protocols.md).

### Validation on 22 September 2026

- Workspace checks pass without warnings; 730 tests pass. The nine focused transport, native-frame
  and authorization tests also pass after the final input changes.
- Desktop and signed iOS Release builds pass. The phone build was installed in place; automatic
  launch was blocked by the phone lock screen.
- Real iOS and Android simulators receive streamed frames, drags, Home and typed text. Android's
  software-input path works without an emulated hardware keyboard and preserves quoted punctuation.
- Native mobile walkthrough passes pairing, host browser frames, keyboard input, reconnect, live
  Android preview and Home. The Computers screen now adjusts for the keyboard and supports
  interactive dismissal, keeping its pairing action reachable.
- The saved runtime was updated on port 51464; authenticated device discovery reports both platforms
  without setup diagnostics.

## Physical iPhone control

Physical iPhones and iPads use a persistent, direct CoreDevice connection, following the simulator
transport boundary. Dovo does not capture or click a Device Hub window, move the Mac pointer, or
require Accessibility/Screen Recording permission for this path.

On the host Mac, connect and unlock the phone, trust the Mac, and enable Developer Mode. Xcode 27
supplies device discovery, app management, screenshots, and settings through `devicectl`. The live
adapter uses the pinned MIT-licensed `idevice` protocol library over the existing usbmux pairing and
a userspace CoreDevice tunnel; no root tunnel daemon or Appium is required.

The host needs Rust/Cargo for the first helper build and FFmpeg for HEVC decoding. The runtime ships
the helper source and Cargo lockfile, caches its binary by source hash under
`~/.dovo/helpers/ios-device`, and uses the same authenticated, task-scoped preview tickets as
simulators. `DOVO_IOS_DEVICE_HELPER` and `DOVO_FFMPEG` can select prebuilt host executables. The
versioned runtime updater includes these native sources and their license notice.

The preview supports taps, held touches, continuous drags, scrolling, Home, hardware volume, mute,
lock, and keyboard input. Modifier keys are sent before character keys and released in reverse
order. Unicode text uses the **phone's** pasteboard and native paste shortcut; it does not read or
replace the Mac clipboard. Native commands are acknowledged, time out explicitly, and release held
touches and keyboard state when the session ends. Video comes directly from the phone as HEVC and is
decoded into the existing bounded JPEG canvas transport.

Device controls on desktop and mobile list developer-installed apps, launch/relaunch apps, open web
URLs, select orientation, and change light/dark appearance. iOS may reject individual settings for a
particular hardware/OS combination; those errors are shown rather than reported as success. Physical
Android live control is not implemented and is not offered as available.

Protocol dependency and copied negotiation helper attribution:
`packages/runtime/native/ios-device/LICENSE-idevice`. Upstream revision:
`d32c8189c51c2789496b0768039419c3705498c3` of `jkcoxson/idevice`.
