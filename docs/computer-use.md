# Computer use with Cua Driver

Open **Computer use** in desktop/web settings and select the runtime host. On mobile, open the
computer’s page and choose **Computer use**. Set **Cua Driver executable** to its full path, or
leave it empty to detect `cua-driver` on the runtime’s PATH and its standard installation folder
(`~/.local/bin` on macOS/Linux, `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` on Windows). Paths
containing spaces do not need shell quoting.

Use **Detect / check Cua Driver** to inspect the executable version and daemon status. On macOS,
Dovo also reads Accessibility and Screen Recording permission status without requesting grants. An
executable responding does not prove that desktop control works. The setup page shows the official
installer commands for the runtime’s OS, prerequisites and a link to Cua’s
[installation and permission guide](https://cua.ai/docs/cua-driver/quickstart). Run installation
commands in a terminal on that host, then refresh the check. Dovo does not install on the phone or
browser device used to manage a remote runtime.

Use **Start CuaDriver** to launch the permission-owning app on macOS or kick Windows autostart. On
Linux, run `cua-driver serve` in the desktop session and leave its terminal open. **Request macOS
permissions** runs `permissions grant`; turn on CuaDriver in Accessibility and Screen & System Audio
Recording and accept the relaunch. OS grants cannot be approved inside Dovo. **Stop daemon** affects
all active computer-use sessions.

**Run diagnostics** runs Cua’s doctor; **Test desktop access** lists apps without changing them.
Review the output: an empty list is not evidence of working desktop access. Checks do not capture
screenshots or send desktop input. Setup actions are serialized on the runtime and never
automatically retried. Refresh after an error or timeout before deciding whether to retry.

### Agent skills

**Install agent skills** fetches Cua’s official versioned skill pack and links detected agents on
the runtime host; **Update agent skills** refreshes it. This may affect agents used outside Dovo
too. New opted-in writable turns receive the installed `SKILL.md` path in their instructions,
including harnesses with isolated configurations. If the pack is absent or discovery fails,
instructions report that and direct the agent to MCP’s bundled skill resources. Skills do not grant
OS permissions. No global MCP registration is necessary for Dovo.

### Optional Computer History

The setup page reads the driver’s current history state; Dovo does not store a second history
preference or automatically enable it. Supported builds expose Cua’s encrypted, metadata-only
Computer History preview. **Enable Computer History** can restart the daemon to admit the preview,
affecting active sessions. **Pause** and **Resume** control recording. **Disable** stops it but
retains existing records. **View recent history** retrieves up to 20 events from the runtime host.
**Delete recorded history** requires confirmation and deletes recorded chunks and their encryption
key. Unsupported driver versions retain their diagnostic output.

See [Cua Computer History](https://cua.ai/docs/cua-driver/reference/cli/history) for preview
availability and storage details.

Enable **agent computer use on this computer**, then save. The switch defaults to off. New writable
turns receive the machine-owned `dovo_cua` stdio MCP server across Dovo’s providers. Read-only turns
do not receive it; tool-free title and dictation utilities remain separate. Existing turns keep
their current access until they end. The path and switch belong to the selected runtime, not a
project or saved agent. Do not use `dovo_cua` as a custom MCP server name while the integration is
enabled.

Cua uses the installed driver’s permission configuration and each harness’s native approvals.
Desktop actions are outside a coding agent’s filesystem sandbox. The desktop and application state
are shared with the user and other agents; this integration does not provide isolated desktops or
coordinate simultaneous GUI workflows. Use Dovo’s task-scoped browser CDP and simulator tools for
those surfaces.

The driver must run in the desktop session being controlled. macOS requires grants for CuaDriver;
Windows requires an interactive desktop; Linux support depends on the display server and compositor.
A WSL runtime detects Linux tools and does not automatically connect to the Windows desktop.
Headless runtimes need a separately configured graphical session. Screenshot handling and GUI
reliability still depend on the selected harness and model.

This integration uses the local executable and daemon; it does not require a Cua Cloud account or
change Dovo’s HTTP LAN/VPN support, pairing codes or device tokens.
