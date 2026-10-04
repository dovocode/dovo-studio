# Computer use with Cua Driver

Open the selected computer’s **CLI commands & shell** settings on desktop, web or mobile. Set **Cua
Driver executable** to its full path, or leave it empty to detect `cua-driver` on the runtime’s PATH
and its standard installation folder (`~/.local/bin` on macOS/Linux,
`%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` on Windows). Paths containing spaces do not need shell
quoting.

Use **Detect / check Cua Driver** to inspect the executable version and daemon status. On macOS,
Dovo also reads Accessibility and Screen Recording permission status without requesting grants. An
executable responding does not prove that desktop control works. The setup link opens Cua’s
[installation and permission guide](https://cua.ai/docs/cua-driver/quickstart).

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
