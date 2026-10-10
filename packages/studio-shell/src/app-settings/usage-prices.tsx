import { runtimeComputerName } from '@dovo/protocol'
import { useState } from 'react'
import { Schema } from 'effect'
import { Button, ChoicePicker, Input } from '@dovo/studio-ui'
import { useWorkspace, type UsageRow } from '@dovo/studio-core'
import { usagePriceInput, type UsageHistoryResult } from '@dovo/protocol'
const ok = Schema.Struct({ ok: Schema.Boolean })
const fields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const labels = {
  input: 'Input',
  output: 'Output',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
}
export function UsagePrices({
  rows,
  computer,
  histories,
  onSaved,
}: {
  rows: UsageRow[]
  computer: string
  histories: Record<string, UsageHistoryResult>
  onSaved: () => void
}) {
  const [model, setModel] = useState('')
  const selected = rows.find((row) => row.key === model) ?? rows[0]
  if (!selected) return null
  const modelId = selected.key.split('\u0000')[1]
  return (
    <details className="rounded-lg border bg-card p-4 text-xs">
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Custom API-equivalent prices
      </summary>
      <p className="mt-2 text-muted-foreground">
        USD per million tokens, saved on selected computers and applied to recorded usage. These
        estimates do not change your subscription allowance.
      </p>
      <div className="my-3">
        <ChoicePicker
          aria-label="Model to price"
          value={encodeURIComponent(selected.key)}
          onValueChange={(value) =>
            setModel(rows.find((row) => encodeURIComponent(row.key) === value)?.key ?? '')
          }
        >
          {rows.map((row) => (
            <option key={row.key} value={encodeURIComponent(row.key)}>
              {row.label}
            </option>
          ))}
        </ChoicePicker>
      </div>
      <PriceForm
        key={`${modelId}:${computer}`}
        model={modelId}
        computer={computer}
        histories={histories}
        onSaved={onSaved}
      />
    </details>
  )
}
function PriceForm({
  model,
  computer,
  histories,
  onSaved,
}: {
  model: string
  computer: string
  histories: Record<string, UsageHistoryResult>
  onSaved: () => void
}) {
  const { runtimes, readRuntime } = useWorkspace()
  const hosts = runtimes.filter(
    (entry) => (computer === 'all' || entry.profile.id === computer) && entry.connected,
  )
  const saved = hosts.map((entry) => histories[entry.profile.id]?.overrides?.[model])
  const mixed = saved.some((price) => JSON.stringify(price) !== JSON.stringify(saved[0]))
  const initial = mixed ? undefined : saved[0]
  const [values, setValues] = useState({
    input: initial?.input.toString() ?? '',
    output: initial?.output.toString() ?? '',
    cacheRead: initial?.cacheRead.toString() ?? '',
    cacheWrite: initial?.cacheWrite.toString() ?? '',
  })
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const write = async (remove = false) => {
    const price = usagePriceInput(values)
    if (!remove && !price) {
      setMessage('Enter finite, non-negative input and output prices.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const results = await Promise.allSettled(
        hosts.map((entry) =>
          readRuntime(
            entry.profile,
            '/api/usage/prices/write',
            { model, ...(remove ? {} : { price }) },
            ok,
            'POST',
          ),
        ),
      )
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [
              `${runtimeComputerName(hosts[index])}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            ]
          : [],
      )
      setMessage(
        failures.length ? failures.join(' ') : remove ? 'Override removed.' : 'Prices saved.',
      )
      onSaved()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">
        {hosts.length
          ? `${hosts.length} connected ${hosts.length === 1 ? 'computer will' : 'computers will'} receive these prices. Offline computers are skipped.`
          : 'Connect a selected computer to save prices.'}
      </p>
      {mixed && <p className="text-muted-foreground">Mixed prices across selected computers.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map((field) => (
          <label key={field} className="space-y-1">
            <span>{labels[field]}</span>
            <Input
              disabled={busy}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={values[field]}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [field]: event.target.value }))
              }
              placeholder={field.startsWith('cache') ? 'Input rate' : ''}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !hosts.length} onClick={() => void write()}>
          {busy ? 'Saving…' : 'Save prices'}
        </Button>
        <Button variant="outline" disabled={busy || !hosts.length} onClick={() => void write(true)}>
          Use published prices
        </Button>
      </div>
      {!!message && <p role="status">{message}</p>}
    </div>
  )
}
