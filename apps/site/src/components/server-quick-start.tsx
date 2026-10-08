'use client'

import { useState } from 'react'
import { serverCommands } from './server-commands'
import { serverGuide } from './site-links'

export function ServerQuickStart() {
  const [channel, setChannel] = useState<'stable' | 'nightly'>('stable')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const command = serverCommands[channel]
  const pairingCommand =
    channel === 'stable' ? '~/.local/bin/dovo-server pair' : '~/.local/bin/dovo-server-nightly pair'
  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }
  return (
    <section className="server-setup" id="server">
      <p className="eyebrow">YOUR SERVER. ONE COMMAND.</p>
      <h2>Install. Pair. Start building.</h2>
      <p>
        Run this on your Linux host as your normal user. It installs the latest release, starts a
        background service and prints a pairing code.
      </p>
      <div className="command-panel">
        <div className="command-toolbar">
          <div role="group" aria-label="Server release channel">
            {(['stable', 'nightly'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value === 'stable' ? 'Stable' : 'Nightly'} server`}
                aria-pressed={channel === value}
                onClick={() => {
                  setChannel(value)
                  setCopyStatus('idle')
                }}
              >
                {value === 'stable' ? 'Stable' : 'Nightly'}
              </button>
            ))}
          </div>
          <button type="button" className="copy-command" onClick={() => void copy()}>
            {copyStatus === 'copied' ? 'Copied' : 'Copy command'}
          </button>
        </div>
        <pre aria-label={`${channel === 'stable' ? 'Stable' : 'Nightly'} server install command`}>
          <code>{command}</code>
        </pre>
        {copyStatus === 'failed' && (
          <p role="status" className="copy-error">
            Clipboard unavailable. Select and copy the command above.
          </p>
        )}
      </div>
      <p className="setup-requirements">
        Linux x64 or ARM64 with glibc, Bash, curl, jq, tar, sha256sum and a running systemd user
        manager. Choose one release channel per host. Nightly is a prerelease.
      </p>
      <ol className="pairing-steps">
        <li>
          <strong>Keep the address and pairing code.</strong>
          <span>
            The command prints them after setup. Use the host’s reachable LAN or VPN address.
          </span>
        </li>
        <li>
          <strong>Pair from desktop.</strong>
          <span>
            Open Settings → Devices & runtime → Connect computer. Enter the server address and
            pairing code.
          </span>
        </li>
        <li>
          <strong>Pair from mobile.</strong>
          <span>
            In the iPhone app, scan the pairing QR code or enter the runtime address and pairing
            code. iPhone is work in progress and currently requires a local build; Android is coming
            soon.
          </span>
        </li>
      </ol>
      <p className="setup-note">
        Codes expire after two minutes and work once. For each additional device, generate a fresh
        code on the host: <code>{pairingCommand}</code>.
      </p>
      <p className="setup-note">
        HTTP works on LAN, Tailscale and NetBird; HTTPS is optional. Each device needs pairing and
        gets its own device token. No Dovo account required.
      </p>
      <a className="text-link" href={serverGuide}>
        Full server guide, other platforms & updates ↗
      </a>
    </section>
  )
}
