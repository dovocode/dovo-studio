import { useId, useState } from 'react'
import {
  decode,
  sshAddressSchema,
  parseSshAddress,
  formatSshAddress,
  runtimePreferencesSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'

export function ComputerSshSettings({ source }: { source: RuntimeOverview }) {
  const { readRuntime, refreshRuntime } = useWorkspace()
  const id = useId()
  const [draft, setDraft] = useState<{ sshHost: string; sshUser: string; sshPort: string }>()
  const saved = source.snapshot?.sshAddress ?? ''
  const parsed = saved ? parseSshAddress(saved) : undefined
  const fields = draft ?? {
    sshHost: parsed?.sshHost ?? '',
    sshUser: parsed?.sshUser ?? '',
    sshPort: String(parsed?.sshPort ?? 22),
  }
  const dirty =
    fields.sshHost !== (parsed?.sshHost ?? '') ||
    fields.sshUser !== (parsed?.sshUser ?? '') ||
    fields.sshPort !== String(parsed?.sshPort ?? 22)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = source.snapshot?.sshAddress !== undefined
  return (
    <form
      className="space-y-2"
      aria-label="Computer SSH address"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || !source.connected || !supported) return
        setBusy(true)
        setError('')
        void (async () => {
          try {
            const sshAddress = decode(sshAddressSchema, formatSshAddress(fields))
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
      <p className="text-sm font-medium">SSH server</p>
      <p className="text-xs text-muted-foreground">
        Shared with paired devices for copying checkouts. SSH keys and host trust stay on the
        computer sending the files. Clear both user and host to remove the address.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_6rem]">
        {(
          [
            ['sshUser', 'SSH user', 'dominic'],
            ['sshHost', 'SSH host', 'computer.local'],
            ['sshPort', 'SSH port', '22'],
          ] as const
        ).map(([field, label, placeholder]) => (
          <label key={field} className="block text-xs" htmlFor={`${id}-${field}`}>
            {label}
            <Input
              id={`${id}-${field}`}
              value={fields[field]}
              placeholder={placeholder}
              inputMode={field === 'sshPort' ? 'numeric' : 'text'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy || !source.connected || !supported}
              onChange={(event) => setDraft({ ...fields, [field]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <Button type="submit" size="sm" disabled={busy || !source.connected || !supported || !dirty}>
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
