import { useEffect, useState, type ReactNode } from 'react'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  windowsRuntimeStatusSchema,
  windowsSecurityReportSchema,
  windowsAsrGuidance,
  windowsRuntimeErrorMessage,
  type WindowsRuntimeStatus,
  type WindowsRuntimeBridge,
  type WindowsSecurityReport,
} from '@dovo/protocol'
import {
  Button,
  ChoicePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  FormField,
} from '@dovo/studio-ui'
import { connectionSchema } from '@dovo/studio-core'

const bridgeSchema = Schema.Struct({
  dovo: Schema.Struct({
    windowsRuntime: Schema.Struct({
      read: Schema.Unknown.pipe(
        Schema.refine(
          (value): value is WindowsRuntimeBridge['read'] => typeof value === 'function',
        ),
      ),
      connection: Schema.Unknown.pipe(
        Schema.refine(
          (value): value is WindowsRuntimeBridge['connection'] => typeof value === 'function',
        ),
      ),
      save: Schema.Unknown.pipe(
        Schema.refine(
          (value): value is WindowsRuntimeBridge['save'] => typeof value === 'function',
        ),
      ),
      security: Schema.Unknown.pipe(
        Schema.refine(
          (value): value is WindowsRuntimeBridge['security'] => typeof value === 'function',
        ),
      ),
    }),
  }),
})
const bridge = () => {
  const result = decodeResult(bridgeSchema, window)
  return result.success ? result.data.dovo.windowsRuntime : undefined
}

function WindowsSecurityControl() {
  const [report, setReport] = useState<WindowsSecurityReport>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const check = async () => {
    const api = bridge()
    if (!api) return
    setBusy(true)
    setError('')
    setReport(undefined)
    try {
      setReport(decode(windowsSecurityReportSchema, await api.security()))
    } catch {
      setError(
        'Windows security check could not complete. Try again after reproducing the problem.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2 border-t pt-3" aria-label="Windows security diagnostics">
      <h3 className="text-sm font-medium">Windows security</h3>
      <p className="text-xs text-muted-foreground">
        Check Defender attack surface reduction blocks from the last two hours on this PC. Events
        may belong to other apps, including when Dovo runs in WSL. This reads local logs without
        changing permissions or security settings.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking Windows security…' : 'Check Windows security'}
        </Button>
        {report && (
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(JSON.stringify(report, null, 2))
                .catch(() => setError('Could not copy the report. Check clipboard permissions.'))
            }}
          >
            Copy report
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {report?.status === 'access-denied' && (
        <p role="status" className="text-sm">
          Windows denied access to the Defender event log. A Windows administrator can inspect event
          1121 in Event Viewer under Applications and Services Logs → Microsoft → Windows → Windows
          Defender → Operational.
        </p>
      )}
      {report?.status === 'unavailable' && (
        <p role="status" className="text-sm">
          Defender events could not be read. The log or PowerShell may be unavailable or blocked by
          policy. This does not mean there were no blocks.
        </p>
      )}
      {report?.status === 'ok' && (
        <div className="space-y-3" role="status">
          {report.events.length === 0 ? (
            <p className="text-sm">
              No ASR block events were recorded in the last two hours. This check does not cover
              SmartScreen, Windows Firewall or other security products.
            </p>
          ) : (
            <>
              <p className="text-sm">
                Most recent ASR blocks (up to 20). Compare their times and paths with the failure.
              </p>
              <ul className="space-y-3">
                {report.events.map((event, index) => (
                  <li
                    key={`${event.timeCreated}-${index}`}
                    className="space-y-1 rounded border p-3 text-xs"
                  >
                    <p>{event.timeCreated}</p>
                    <p className="break-all">Rule: {event.ruleId || 'Not recorded'}</p>
                    <p className="break-all">Process: {event.processPath || 'Not recorded'}</p>
                    <p className="break-all">Target: {event.targetPath || 'Not recorded'}</p>
                    <p>{windowsAsrGuidance(event.ruleId)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function WindowsRuntimeControl({
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
  const [phase, setPhase] = useState<'preparing' | 'connecting'>('preparing')
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
        if (!disposed) setError(windowsRuntimeErrorMessage(cause))
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
    setPhase('preparing')
    setError('')
    let saved = false
    try {
      const savedConnection = decodeResult(
        connectionSchema,
        await api.save(mode === 'native' ? { mode } : { mode, distribution }),
      )
      if (!savedConnection.success)
        throw new Error(
          'The desktop returned invalid runtime connection details. Restart Dovo Studio and retry.',
        )
      saved = true
      setPhase('connecting')
      const connection = decodeResult(connectionSchema, await api.connection())
      if (!connection.success)
        throw new Error(
          'The desktop returned invalid runtime connection details. Restart Dovo Studio and retry.',
        )
      await onApplied?.(connection.data)
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError(
        `${saved ? 'The runtime was prepared, but the workspace connection failed. Retry applying this environment. ' : ''}${windowsRuntimeErrorMessage(cause)}`,
      )
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
      <FormField label="Environment">
        <Select
          value={mode}
          disabled={busy}
          onValueChange={(value) => setMode(value === 'wsl' ? 'wsl' : 'native')}
        >
          <SelectTrigger aria-label="Execution environment" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="native">Native Windows (recommended)</SelectItem>
            <SelectItem value="wsl">WSL 2</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      {mode === 'wsl' && (
        <>
          <FormField label="Distribution">
            <ChoicePicker
              aria-label="WSL distribution"
              value={distribution}
              disabled={busy}
              onValueChange={setDistribution}
            >
              <option value="">Choose a distribution</option>
              {status?.distributions
                .filter((entry) => entry.version === 2)
                .map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
            </ChoicePicker>
          </FormField>
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
      {!status && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading execution environments…
        </p>
      )}
      {error && (
        <p role="alert" className="break-words text-sm text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
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
          {busy
            ? phase === 'connecting'
              ? 'Connecting workspace…'
              : 'Preparing and verifying runtime…'
            : status?.configured
              ? 'Apply environment'
              : 'Continue'}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </Button>
      </div>
      <WindowsSecurityControl />
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
        if (status.configured) {
          const connection = decodeResult(connectionSchema, await api.connection())
          if (!connection.success)
            throw new Error(
              'The desktop returned invalid runtime connection details. Restart Dovo Studio and retry.',
            )
        }
        if (!disposed) {
          setReady(status.configured)
          setChecked(true)
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(windowsRuntimeErrorMessage(cause))
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
      <div className="max-h-[calc(100vh-3rem)] min-w-0 w-full max-w-xl overflow-y-auto">
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
