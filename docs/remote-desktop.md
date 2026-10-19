# Remote desktop (experimental)

Remote desktop is off by default and belongs to each computer. In desktop/web **Settings → Remote
desktop**, choose the host and enable the experimental feature. Mobile can change the host's flag in
its computer preferences; the viewer is currently desktop/web, including responsive mobile browsers.

The host needs a current [Cua Driver](computer-use.md), running in its graphical desktop session
with the platform's capture and input permissions. Dovo uses the existing configured executable; it
does not install a driver, grant OS permissions, require a cloud account, or enable agent computer
use. That separate agent setting can stay off. WSL does not automatically control Windows; choose a
runtime in the desktop session you intend to share.

Choose **Connect to desktop** to view the primary display. Sessions start view-only. **Enable
control** explicitly allows input to the real shared desktop. Click the image to focus keyboard
control. Mouse movement, clicks, right-click, double-click, a straight-line drag, wheel scrolling,
text and common modifier shortcuts are supported. Tab leaves the image so keyboard focus cannot get
trapped; use the Tab button to send a remote Tab. The text field also supports composing text before
sending it. Browser/OS-reserved shortcuts may remain local.

The first version sends periodic screenshots (at most one request every 750 ms while idle), capped
at a 1600-pixel long edge and compressed to JPEG. Capture and native actions are serialized. Typing
is queued in order and adjacent text is combined; obsolete pointer moves are coalesced. This is
intended for setup and troubleshooting, not smooth video, gaming or continuous freehand dragging.
Additional displays, audio, clipboard synchronization and file transfer are not included.

The workbench shows a sharing indicator with the host and viewer, plus **Stop sharing**. Any paired
human client can stop sharing; only the owning client can capture or send input for that session.
Turning the feature off also stops sharing. One viewer is admitted per runtime. This does not
isolate the desktop from its local user, other software, or independently running Cua agents. The
indicator requires a connected, running Dovo workbench; closing the host's UI does not by itself
stop a separate running server. Turn the feature off to prevent further sessions.

Leaving the viewer sends Stop. Disconnected or hidden viewers expire on the host after 30 seconds
without a request. Stop revokes new operations immediately and waits for an operation already in
flight and driver cleanup before confirming. Input already delivered cannot be undone. If Stop
cannot be confirmed, the viewer says so; reconnect and stop, disable the flag on the host, or wait
for host expiry. After a session expires, stop the old session and connect again.

Frames are kept only in session memory, and input is excluded from request activity records. Dovo
never automatically retries an input after an error or lost response: inspect a refreshed image
before acting again. Driver-native approvals and platform restrictions still apply.

Pairing codes and device tokens remain required. Agent run credentials cannot access this API. The
feature preserves HTTP over LAN/VPN (including Tailscale and NetBird) and optional HTTPS.

## Verification

`pnpm test:remote-desktop:browser` checks the production viewer with schema-validated demo
responses: flag gating, view-only mode, mouse scaling, drag/wheel, queued typing, modifiers, focus
escape, input failure without replay, unconfirmed Stop, and responsive layouts. These are component
checks with a simulated runtime, not native desktop proof.

Runtime tests cover ownership, duplicate input rejection, stale captures, coordinate bounds,
credential/flag revocation, cancellation during connection, idle expiry, and HTTP access without
persisting typed text. A separate local test exercised Cua Driver 0.36.0 in a private Linux Xvfb
desktop: real screenshot capture, text entry and Ctrl+A were verified against a test field; native
mouse movement/click/drag/scroll and session shutdown completed successfully. Physical macOS,
Windows and Wayland behavior remains unverified.
