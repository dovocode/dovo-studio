import { useState } from 'react'
import {
  decode,
  sshAddressSchema,
  runtimePreferencesSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'

export function ComputerSshSettings({ source }: { source: RuntimeOverview }) {
  const { readRuntime, refreshRuntime } = useWorkspace()
  const [draft, setDraft] = useState<string>()
  const address = draft ?? source.snapshot?.sshAddress ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = source.snapshot?.sshAddress !== undefined
  return (
    <form
      className="space-y-2"
      aria-label="Computer SSH address"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setError('')
        void (async () => {
          try {
            const sshAddress = decode(sshAddressSchema, address.trim())
            await readRuntime(
              source.profile,
              '/api/runtime/preferences/save',
              { sshAddress },
              runtimePreferencesSchema,
            )
            await refreshRuntime(source.profile)
            setDraft(undefined)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setBusy(false)
          }
        })()
      }}
    >
      <label className="block text-sm font-medium" htmlFor="computer-ssh-address">
        SSH address
      </label>
      <p className="text-xs text-muted-foreground">
        Shared with paired devices for copying checkouts. SSH keys and host trust stay on the
        computer sending the files.
      </p>
      <Input
        id="computer-ssh-address"
        placeholder="ssh://dominic@computer:22"
        value={address}
        disabled={busy || !source.connected || !supported}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        disabled={
          busy || !source.connected || !supported || address === source.snapshot?.sshAddress
        }
      >
        {busy ? 'Saving…' : 'Save SSH address'}
      </Button>
      {!supported && (
        <p className="text-xs text-muted-foreground">
          Update this computer to share its SSH address.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
