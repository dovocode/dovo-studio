import { useState } from 'react'
import { Schema } from 'effect'
import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  formatSpendUsd,
  runtimeComputerName,
  unattendedSpendLimitInput,
  type RuntimeOverview,
} from '@dovo/protocol'
import { Button, Input } from '@dovo/studio-ui'
import { useWorkspace } from '@dovo/studio-core'

const saved = Schema.Struct({ unattendedSpendLimitUsd: Schema.NullOr(Schema.Number) })

/** Settings → Usage & limits → Limits: the computer-wide limit on unattended spend. */
export function UsageSpendLimit({ computer }: { computer: string }) {
  const { runtimes } = useWorkspace()
  const hosts = runtimes.filter((entry) => computer === 'all' || entry.profile.id === computer)
  if (!hosts.length) return null
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-xs">
      <div>
        <h2 className="text-sm font-medium">
          <InterfaceText>{'Unattended spend limit'}</InterfaceText>
        </h2>
        <p className="mt-1 leading-5 text-muted-foreground">
          <InterfaceText>
            {
              'Holds new work that runs without your message once its estimated cost reaches the limit. This covers Bot follow-ups, Bot routine steps, scheduled messages and child agents. Each thread or Bot counts with its child agents. A routine without a Bot starts a new count on each run. Set its own limits in Monitoring and limits. Your next message or Continue resets the count. Turns without a price also hold work. A running turn always finishes.'
            }
          </InterfaceText>
        </p>
      </div>
      {hosts.map((entry) => (
        <SpendLimitRow key={entry.profile.id} entry={entry} />
      ))}
    </section>
  )
}

function SpendLimitRow({ entry }: { entry: RuntimeOverview }) {
  const uiText = useInterfaceText()
  const { readRuntime, refreshRuntime } = useWorkspace()
  const reported = entry.snapshot?.unattendedSpendLimitUsd ?? null
  // A saved value shows at once; a newer snapshot from any client replaces it.
  const [local, setLocal] = useState<{ value: number | null; reported: number | null }>()
  const current = local && local.reported === reported ? local.value : reported
  // The field follows the reported limit until the user types, so a late snapshot or a change
  // from another device never leaves a blank or stale value to save.
  const [edited, setEdited] = useState<string>()
  const text = edited ?? current?.toString() ?? ''
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const name = runtimeComputerName(entry)
  if (entry.snapshot && !entry.snapshot.unattendedSpendLimitSupported)
    return (
      <p className="text-muted-foreground">
        {uiText('{value0}: update Dovo on this computer to set a spend limit.', { value0: name })}
      </p>
    )
  const save = async (value: number | null) => {
    setBusy(true)
    setMessage('')
    try {
      const result = await readRuntime(
        entry.profile,
        '/api/runtime/preferences/save',
        { unattendedSpendLimitUsd: value },
        saved,
        'POST',
      )
      setEdited(undefined)
      setLocal({ value: result.unattendedSpendLimitUsd, reported })
      setMessage(
        result.unattendedSpendLimitUsd === null
          ? uiText('Limit turned off.')
          : uiText('Limit saved.'),
      )
      void refreshRuntime(entry.profile)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const submit = () => {
    const value = unattendedSpendLimitInput(text)
    if (value === undefined) setMessage(uiText('Enter an amount in USD above 0 and up to 10,000.'))
    else void save(value)
  }
  const disabled = busy || !entry.connected || !entry.snapshot
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">
          {current === null
            ? uiText('Off')
            : uiText('{value0} per thread family', { value0: formatSpendUsd(current) })}
          {entry.connected ? '' : ` · ${uiText('Offline')}`}
        </span>
      </div>
      <form
        noValidate
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          aria-label={uiText('Limit in USD for {value0}', { value0: name })}
          className="w-32"
          disabled={disabled}
          type="number"
          min="0.01"
          max="10000"
          step="any"
          inputMode="decimal"
          placeholder={uiText('Off')}
          value={text}
          onChange={(event) => setEdited(event.target.value)}
        />
        <Button type="submit" disabled={disabled}>
          {busy ? uiText('Saving…') : uiText('Save limit')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || current === null}
          onClick={() => void save(null)}
        >
          {uiText('Turn off')}
        </Button>
      </form>
      {!!message && <p role="status">{message}</p>}
    </div>
  )
}
