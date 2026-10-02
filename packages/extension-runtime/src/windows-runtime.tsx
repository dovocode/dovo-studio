import { useEffect, useState, type ReactNode } from 'react'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  windowsRuntimeStatusSchema,
  type WindowsRuntimeStatus,
  type WindowsRuntimeBridge,
} from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { connectionSchema } from '@dovo/studio-core'

const bridgeSchema = Schema.Struct({
  dovo: Schema.Struct({
    windowsRuntime: Schema.Struct({
      read: Schema.Unknown.pipe(
        Schema.filter(
          (value): value is WindowsRuntimeBridge['read'] => typeof value === 'function',
        ),
      ),
      connection: Schema.Unknown.pipe(
        Schema.filter(
          (value): value is WindowsRuntimeBridge['connection'] => typeof value === 'function',
        ),
      ),
      save: Schema.Unknown.pipe(
        Schema.filter(
          (value): value is WindowsRuntimeBridge['save'] => typeof value === 'function',
        ),
      ),
    }),
  }),
})
const bridge = () => {
  const result = decodeResult(bridgeSchema, window)
  return result.success ? result.data.dovo.windowsRuntime : undefined
}

export function WindowsRuntimeControl({
  onApplied,
  initialError = '',
}: {
  onApplied?: (connection: { address: string; token: string }) => Promise<void> | void
  initialError?: string
}) {
  const [status, setStatus] = useState<WindowsRuntimeStatus>()
  const [mode, setMode] = useState<'native' | 'wsl'>('native')
  const [distribution, setDistribution] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const api = bridge()
    if (!api) return
    let disposed = false
    void api
      .read()
      .then((raw) => {
        if (disposed) return
        const next = decode(windowsRuntimeStatusSchema, raw)
        setStatus(next)
        if (refresh === 0) {
          setMode(next.choice.mode)
          setDistribution(
            next.choice.mode === 'wsl'
              ? next.choice.distribution
              : (next.distributions.find((entry) => entry.version === 2)?.name ?? ''),
          )
        } else {
          setDistribution(
            (previous) =>
              previous || next.distributions.find((entry) => entry.version === 2)?.name || '',
          )
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      disposed = true
    }
  }, [refresh])
  if (!bridge()) return null
  const changed =
    !status?.configured ||
    status.choice.mode !== mode ||
    (status.choice.mode === 'wsl' && status.choice.distribution !== distribution)
  const apply = async () => {
    const api = bridge()
    if (!api) return
    setBusy(true)
    setError('')
    try {
      const connection = decode(
        connectionSchema,
        await api.save(mode === 'native' ? { mode } : { mode, distribution }),
      )
      await onApplied?.(connection)
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="space-y-3 rounded-md border p-4" aria-label="Windows execution environment">
      <h2 className="text-sm font-medium">Run locally with Native Windows or WSL</h2>
      <p className="text-sm text-muted-foreground">
        Choose where your projects, agents, Git and terminals run. Each environment keeps its own
        threads, settings and saved logins. Finish active runs before switching.
      </p>
      <label className="block text-sm">
        Environment
        <select
          aria-label="Execution environment"
          className="ml-3 rounded border bg-background p-2"
          value={mode}
          disabled={busy}
          onChange={(event) => setMode(event.target.value === 'wsl' ? 'wsl' : 'native')}
        >
          <option value="native">Native Windows (recommended)</option>
          <option value="wsl">WSL 2</option>
        </select>
      </label>
      {mode === 'wsl' && (
        <>
          <label className="block text-sm">
            Distribution
            <select
              aria-label="WSL distribution"
              className="ml-3 rounded border bg-background p-2"
              value={distribution}
              disabled={busy}
              onChange={(event) => setDistribution(event.target.value)}
            >
              <option value="">Choose a distribution</option>
              {status?.distributions
                .filter((entry) => entry.version === 2)
                .map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Dovo installs the matching Linux runtime in this distribution. Install and sign in to
            your agent CLIs there. Keep Linux projects under /home for best performance. LAN/VPN
            access may also require WSL and Windows Firewall configuration.
          </p>
          {status?.error && <p className="text-xs text-muted-foreground">{status.error}</p>}
          {!status?.distributions.some((entry) => entry.version === 2) && (
            <p className="text-xs text-muted-foreground">
              Install a distribution with <code>wsl --install</code>, then refresh. WSL 1
              distributions must be converted to version 2.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={
            busy ||
            !status ||
            (mode === 'wsl' &&
              !status.distributions.some(
                (entry) => entry.name === distribution && entry.version === 2,
              )) ||
            (!changed && !error)
          }
          onClick={() => {
            void apply()
          }}
        >
          {busy ? 'Preparing runtime…' : status?.configured ? 'Apply environment' : 'Continue'}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </Button>
      </div>
    </article>
  )
}

export function WindowsRuntimeSettings() {
  return <WindowsRuntimeControl onApplied={() => window.location.reload()} />
}
export function WindowsRuntimeGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!bridge())
  const [checked, setChecked] = useState(!bridge())
  const [error, setError] = useState('')
  useEffect(() => {
    const api = bridge()
    if (!api) return
    let disposed = false
    void api
      .read()
      .then(async (raw) => {
        const status = decode(windowsRuntimeStatusSchema, raw)
        if (status.configured) await api.connection()
        if (!disposed) {
          setReady(status.configured)
          setChecked(true)
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setChecked(true)
        }
      })
    return () => {
      disposed = true
    }
  }, [])
  if (ready) return children
  return (
    <main className="flex h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <h1 className="mb-4 text-xl font-semibold">Set up Dovo Studio</h1>
        {checked ? (
          <WindowsRuntimeControl initialError={error} onApplied={() => setReady(true)} />
        ) : (
          <p>Checking local environments…</p>
        )}
      </div>
    </main>
  )
}
