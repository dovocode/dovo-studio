import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@dovo/studio-ui'

export function LinuxSetupGuide({ onConnect }: { onConnect: () => void }) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<'stable' | 'nightly'>('stable')
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const launcher = channel === 'nightly' ? 'dovo-server-nightly' : 'dovo-server'
  const commands = [
    {
      title: '1. Install the server',
      command: `bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/dovocode/dovo-studio/main/scripts/install-linux-server.sh | bash -s -- --channel ${channel} --host 0.0.0.0'`,
      detail:
        'Run in a terminal on the Linux host as your normal user, without sudo. The installer verifies the download and registers a systemd user service. Run the same command again to upgrade.',
    },
    {
      title: '2. Check the service and generate a pairing code',
      command: `~/.local/bin/${launcher} service status\n~/.local/bin/${launcher} pair`,
      detail:
        'Use the LAN or VPN address and eight-digit code printed on the host to connect this desktop. On mobile, scan the printed QR code. Codes expire after two minutes.',
    },
    {
      title: 'Optional: keep running after logout and reboot',
      command: 'sudo loginctl enable-linger "$USER"',
      detail:
        'Run on the Linux host if you want the service to stay available without a login session. This step needs administrator permission.',
    },
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        setCopied('')
        setError('')
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Set up Linux server
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Set up a Linux server</DialogTitle>
        <DialogDescription>
          Add another environment to your workspace. Requires Linux x64 or ARM64 with glibc, Bash,
          curl, jq, tar, sha256sum and a running systemd user manager.
        </DialogDescription>
        <label className="text-xs font-medium">
          Release channel
          <select
            className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={channel}
            onChange={(event) => {
              const next = event.target.value
              if (next !== 'stable' && next !== 'nightly') return
              setChannel(next)
              setCopied('')
              setError('')
            }}
          >
            <option value="stable">Stable</option>
            <option value="nightly">Nightly</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Stable is recommended. Nightly includes the newest changes and may be less stable.
        </p>
        {commands.map((step) => (
          <div key={step.title} className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-medium">{step.title}</h3>
            <p className="text-xs leading-5 text-muted-foreground">{step.detail}</p>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              <code>{step.command}</code>
            </pre>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError('')
                void navigator.clipboard
                  .writeText(step.command)
                  .then(() => setCopied(step.title))
                  .catch(() => setError('Could not copy. Select the command and copy it manually.'))
              }}
            >
              {copied === step.title ? 'Copied' : 'Copy command'}
            </Button>
          </div>
        ))}
        <p className="text-xs leading-5 text-muted-foreground">
          Connect over the same LAN or Tailscale/NetBird VPN using HTTP on port 51464. Allow that
          port through the host firewall for your network. Install and authenticate your agent
          providers on the Linux host under the same user. Data stays in ~/.dovo.
        </p>
        {!!error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={() => {
            setOpen(false)
            onConnect()
          }}
        >
          Server ready — connect computer
        </Button>
      </DialogContent>
    </Dialog>
  )
}
