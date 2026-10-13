Native Rust/GPUI client for the existing Dovo runtime. Full Electron feature parity is still in
progress.

- macOS Intel and Apple Silicon: extract the archive and move **Dovo Studio GPUI.app** to
  Applications. Developer ID signed and notarized with the existing Apple identity.
- Windows x64 and ARM64: extract the ZIP and run **dovo-desktop-gpui.exe**. The app, Node and native
  runtime modules are signed with the existing Azure publisher. Windows 10/11's WebView2 runtime is
  required for embedded content.
- Fedora: download the RPM for your architecture and install with
  `sudo dnf install ./Dovo-GPUI*.rpm`. Dnf installs GTK, WebKitGTK, font and Vulkan dependencies.
  These RPMs are unsigned; verify their GitHub build attestation before using `--nogpgcheck` if
  local policy requires it.
- Ubuntu 24.04 or newer / compatible Debian systems: install the DEB with
  `sudo apt install ./Dovo-GPUI*.deb` to resolve dependencies.
- Linux archives include Node and the production runtime. Run `./check-linux.sh` to diagnose missing
  libraries, and `./install-linux.sh` to register a launcher. They require glibc 2.39 or newer,
  X11/XWayland and a working graphics driver.

SHA256SUMS covers the final packaged files. All artifacts have GitHub build provenance, verifiable
with `gh attestation verify <downloaded-file> --repo dovocode/dovo-studio`. There is no existing
Linux package-signing key; provenance does not make an RPM GPG-signed.

Installing or removing the application leaves existing runtime data and pairing credentials in
place. Automatic GPUI updates and Windows installers are not included yet. Native platform
installation and hardware validation remain necessary before a stable release is published.
