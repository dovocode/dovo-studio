import { useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, previewResultSchema, type PreviewDevice } from '@dovo/studio-core'
import { deviceHostForwardResultSchema, deviceHostForwardsResultSchema } from '@dovo/protocol'
import {
  Button,
  ChoicePicker,
  FormField,
  Input,
  Popover,
  SettingRow,
  Toggle,
} from '@dovo/studio-ui'

type Forward = (typeof deviceHostForwardsResultSchema.Type)['forwards'][number]
export function DeviceDeployment({
  taskId,
  device,
  inline = false,
}: {
  taskId: string
  device: PreviewDevice
  inline?: boolean
}) {
  const { request, connected } = useWorkspace()
  const [artifactPath, setArtifactPath] = useApplicationState('')
  const [bundleId, setBundleId] = useApplicationState('')
  const [localPort, setLocalPort] = useApplicationState('8081')
  const [remotePort, setRemotePort] = useApplicationState('8081')
  const [forwardId, setForwardId] = useApplicationState('')
  const [forwardExpiry, setForwardExpiry] = useApplicationState('')
  const [forwards, setForwards] = useApplicationState<Forward[]>([])
  const [forwardLoading, setForwardLoading] = useApplicationState(!!device.hostId)
  const [forwardLoadError, setForwardLoadError] = useApplicationState('')
  const [forwardRevision, setForwardRevision] = useApplicationState(0)
  const [exposeToNetwork, setExposeToNetwork] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [message, setMessage] = useApplicationState('')
  const lock = useRef(false)
  const generation = useRef(0)
  const chooseForward = (value?: Forward) => {
    setForwardId(value?.id ?? '')
    setForwardExpiry(value?.expiresAt ?? '')
    if (value) {
      setLocalPort(String(value.localPort))
      setRemotePort(String(value.remotePort))
      setExposeToNetwork(value.exposeToNetwork)
    }
  }
  useEffect(() => {
    const current = ++generation.current
    lock.current = false
    setBusy(false)
    setForwards([])
    setForwardId('')
    setForwardExpiry('')
    setForwardLoadError('')
    setMessage('')
    setError('')
    if (!device.hostId || !connected) {
      setForwardLoading(false)
      return
    }
    setForwardLoading(true)
    const hostId = device.hostId
    void request('/api/device-hosts/forwards', { taskId }, deviceHostForwardsResultSchema)
      .then(
        ({ forwards }) => {
          if (current !== generation.current) return
          const active = forwards.filter(
            (entry) => entry.hostId === hostId && new Date(entry.expiresAt).getTime() > Date.now(),
          )
          setForwards(active)
          chooseForward(active.at(-1))
        },
        (reason: unknown) => {
          if (current === generation.current)
            setForwardLoadError(reason instanceof Error ? reason.message : String(reason))
        },
      )
      .finally(() => {
        if (current === generation.current) setForwardLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [request, connected, taskId, device.hostId, forwardRevision])
  useEffect(() => {
    if (!forwardId || !forwardExpiry) return
    const timer = setTimeout(
      () => {
        setForwards((entries) => entries.filter((entry) => entry.id !== forwardId))
        setForwardId('')
        setForwardRevision((value) => value + 1)
        setMessage('Forwarding expired. Start it again when needed.')
      },
      Math.max(0, new Date(forwardExpiry).getTime() - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [forwardId, forwardExpiry, setForwardId, setMessage])
  const launch = () =>
    request(
      '/api/previews/action',
      { taskId, id: device.id, action: 'launch', bundleId: bundleId.trim() },
      previewResultSchema,
    )
  const act = async (operation: (isCurrent: () => boolean) => Promise<void>) => {
    if (lock.current || !connected) return
    const current = generation.current
    const isCurrent = () => current === generation.current
    lock.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation(isCurrent)
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (isCurrent()) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  const content = (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void act(async (isCurrent) => {
            await request(
              '/api/device-hosts/install',
              { taskId, id: device.id, artifactPath: artifactPath.trim() },
              previewResultSchema,
            )
            if (bundleId.trim()) await launch()
            if (!isCurrent()) return
            setMessage(
              `${bundleId.trim() ? 'Installed and launched' : 'Installed'} on ${device.name}.`,
            )
          })
        }}
      >
        <h3 className="text-sm font-semibold">Install a built app</h3>
        <p className="text-xs text-muted-foreground">
          {device.platform === 'android'
            ? 'Choose an APK'
            : device.kind === 'physical'
              ? 'Choose a signed .app for this iPhone'
              : 'Choose a simulator .app'}{' '}
          in this thread’s checkout on the coding computer. Build it first using your project’s
          build command.
        </p>
        <FormField label="App path">
          <Input
            required
            disabled={busy}
            value={artifactPath}
            onChange={(event) => setArtifactPath(event.target.value)}
            placeholder={
              device.platform === 'android'
                ? 'android/app/build/outputs/apk/debug/app-debug.apk'
                : 'build/MyApp.app'
            }
          />
        </FormField>
        <FormField label="App identifier (optional)">
          <Input
            disabled={busy}
            value={bundleId}
            onChange={(event) => setBundleId(event.target.value)}
            placeholder="com.example.app"
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]*"
          />
        </FormField>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !connected || device.state !== 'booted' || !artifactPath.trim()}
        >
          {busy ? 'Working…' : bundleId.trim() ? 'Install and launch' : 'Install app'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            busy ||
            !connected ||
            device.state !== 'booted' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(bundleId.trim())
          }
          onClick={() =>
            void act(async (isCurrent) => {
              await launch()
              if (!isCurrent()) return
              setMessage(`Launched on ${device.name}.`)
            })
          }
        >
          Launch installed app
        </Button>
      </form>
      {device.hostId && (
        <form
          className="space-y-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            void act(async (isCurrent) => {
              const hostId = device.hostId
              if (!hostId) throw new Error('Select a remote device host first')
              const result = await request(
                '/api/device-hosts/forward',
                {
                  taskId,
                  hostId,
                  localPort: Number(localPort),
                  remotePort: Number(remotePort),
                  durationSeconds: 3600,
                  exposeToNetwork,
                },
                deviceHostForwardResultSchema,
              )
              if (!isCurrent()) return
              const active = {
                ...result,
                hostId,
                localPort: Number(localPort),
                remotePort: Number(remotePort),
                exposeToNetwork,
              }
              setForwards((entries) => [...entries, active])
              chooseForward(active)
              setMessage(
                `Forwarding ready at ${result.url} for up to one hour.${exposeToNetwork ? ' Use the device host’s LAN/VPN address if its SSH alias is not reachable from your phone.' : ''}`,
              )
            })
          }}
        >
          <h3 className="text-sm font-semibold">Connect the development server</h3>
          <p className="text-xs text-muted-foreground">
            Forward Metro or another local server over SSH. Simulators can use the destination’s
            localhost; Android emulators use 10.0.2.2. A physical phone needs a reachable LAN/VPN
            address.
          </p>
          {device.kind === 'physical' && (
            <SettingRow
              label="Allow phones on the destination network"
              description="Expose this forwarded port on the destination’s LAN/VPN. Its SSH server must use GatewayPorts clientspecified."
            >
              <Toggle
                label="Allow phones on the destination network"
                checked={exposeToNetwork}
                disabled={busy || !connected || forwardLoading || !!forwardLoadError || !!forwardId}
                onChange={setExposeToNetwork}
              />
            </SettingRow>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Coding computer port">
              <Input
                type="number"
                required
                min={1}
                max={65535}
                disabled={busy || !connected || forwardLoading || !!forwardLoadError || !!forwardId}
                value={localPort}
                onChange={(event) => setLocalPort(event.target.value)}
              />
            </FormField>
            <FormField label="Device host port">
              <Input
                type="number"
                required
                min={1}
                max={65535}
                disabled={busy || !connected || forwardLoading || !!forwardLoadError || !!forwardId}
                value={remotePort}
                onChange={(event) => setRemotePort(event.target.value)}
              />
            </FormField>
          </div>
          {forwards.length > 1 && (
            <FormField label="Active forwards">
              <ChoicePicker
                aria-label="Active forwards"
                value={forwardId}
                disabled={busy}
                onValueChange={(id) => chooseForward(forwards.find((entry) => entry.id === id))}
              >
                {forwards.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.localPort} → {entry.remotePort}
                  </option>
                ))}
              </ChoicePicker>
            </FormField>
          )}
          {forwardId && (
            <p className="text-xs text-muted-foreground">
              Active at {forwards.find((entry) => entry.id === forwardId)?.url} until{' '}
              {new Date(forwardExpiry).toLocaleTimeString()}.
            </p>
          )}
          {forwardLoadError && (
            <div className="space-y-2">
              <p role="alert" className="text-xs text-destructive">
                Could not restore forwards: {forwardLoadError}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setForwardRevision((value) => value + 1)}
              >
                Retry forwarding status
              </Button>
            </div>
          )}
          {forwardId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void act(async (isCurrent) => {
                  await request(
                    '/api/device-hosts/forward/stop',
                    { taskId, id: forwardId },
                    previewResultSchema,
                  )
                  if (!isCurrent()) return
                  const remaining = forwards.filter((entry) => entry.id !== forwardId)
                  setForwards(remaining)
                  chooseForward(remaining.at(-1))
                  setMessage('Forwarding stopped.')
                })
              }}
            >
              Stop forwarding
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={busy || !connected || forwardLoading || !!forwardLoadError}
            >
              {forwardLoading ? 'Checking forwards…' : 'Start forwarding'}
            </Button>
          )}
        </form>
      )}
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
  if (inline) return content
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant="outline">
          Run app
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[70] max-h-[75vh] w-80 max-w-[calc(100vw-24px)] overflow-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
