'use client'

import { Button } from '@dovo/web-ui'
import { useState } from 'react'
import { repository } from './site-links'

export function HomebrewInstall({ channel }: { channel?: 'stable' | 'nightly' }) {
  const [selection, setSelection] = useState<'stable' | 'nightly'>('stable')
  const [copied, setCopied] = useState('')
  const [failed, setFailed] = useState('')
  const selected = channel ?? selection
  const suffix = selected === 'nightly' ? '-nightly' : ''
  const server = `dovo-server${suffix}`
  const tap = `brew tap dovocode/studio ${repository}`
  const commands = [
    {
      name: 'Desktop app',
      detail: 'macOS 13 or later · Apple silicon',
      command: `${tap}\nbrew install --cask dovocode/studio/dovo-studio${suffix}`,
    },
    {
      name: 'Server only',
      detail: 'macOS ARM64 or Linux x64/ARM64 (glibc) · Git and agent CLIs installed separately',
      command: `${tap}\nbrew install dovocode/studio/${server}\n${server} service install --host 0.0.0.0\n${server} pair`,
    },
  ]

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(command)
      setFailed('')
    } catch {
      setCopied('')
      setFailed(command)
    }
  }

  return (
    <section className="server-setup" id="homebrew" aria-labelledby="homebrew-title">
      <p className="eyebrow">INSTALL WITH HOMEBREW</p>
      <h2 id="homebrew-title">A familiar way to install.</h2>
      <p>
        With <a href="https://brew.sh/">Homebrew</a> installed, choose the desktop app or a
        standalone server. These commands install the {selected === 'stable' ? 'Stable' : 'Nightly'}{' '}
        channel. Nightly is a prerelease; run one local runtime at a time.
      </p>
      {!channel && (
        <div className="release-channels" role="group" aria-label="Homebrew release channel">
          {(['stable', 'nightly'] as const).map((value) => (
            <Button
              key={value}
              size="touch"
              variant={selection === value ? 'secondary' : 'outline'}
              aria-pressed={selection === value}
              onClick={() => {
                setSelection(value)
                setCopied('')
                setFailed('')
              }}
            >
              {value === 'stable' ? 'Stable' : 'Nightly'}
            </Button>
          ))}
        </div>
      )}
      {commands.map(({ name, detail, command }) => (
        <div className="command-panel" key={name}>
          <div className="command-toolbar">
            <strong>{name}</strong>
            <Button
              size="touch"
              variant="ghost"
              className="copy-command"
              aria-label={`Copy ${name.toLowerCase()} Homebrew commands`}
              onClick={() => void copy(command)}
            >
              {copied === command ? 'Copied' : 'Copy commands'}
            </Button>
          </div>
          <pre aria-label={`${name} Homebrew commands`}>
            <code>{command}</code>
          </pre>
          {failed === command && (
            <p role="status" className="copy-error">
              Clipboard unavailable. Select and copy the commands above.
            </p>
          )}
          <p className="command-detail">{detail}</p>
        </div>
      ))}
      <p className="setup-note">
        The server commands register a user service and start it, then print a pairing code. Use the
        host’s LAN or VPN address to pair; HTTP is supported. This needs launchd on macOS or a
        running systemd user manager on Linux. Homebrew alone does not start the server. Dovo
        manages the service; do not use <code>brew services</code>.
      </p>
      <a className="text-link" href={`${repository}/blob/main/docs/server-setup.md#homebrew`}>
        Homebrew updates, service management & pairing ↗
      </a>
    </section>
  )
}
