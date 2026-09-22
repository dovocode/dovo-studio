import { MoreHorizontal, Smartphone, Tablet } from 'lucide-react'
import type { PreviewDevice } from '@dovo/studio-core'
import { DropdownMenu, IconButton } from '@dovo/studio-ui'

type Action = 'boot' | 'shutdown' | 'open' | 'screenshot' | 'devicehub'
export function DeviceList({
  devices,
  host,
  busy,
  connected,
  onOpen,
  onAction,
}: {
  devices: PreviewDevice[]
  host: string
  busy: boolean
  connected: boolean
  onOpen: (device: PreviewDevice) => void
  onAction: (device: PreviewDevice, action: Action) => void
}) {
  const groups = [
    { name: 'Physical devices', items: devices.filter((d) => d.kind === 'physical') },
    {
      name: 'iOS Simulators',
      items: devices.filter((d) => d.kind !== 'physical' && d.platform === 'ios'),
    },
    {
      name: 'Android Emulators',
      items: devices.filter((d) => d.kind !== 'physical' && d.platform === 'android'),
    },
  ]
  return (
    <div className="space-y-3">
      {groups
        .filter((group) => group.items.length)
        .map((group) => (
          <section key={group.name} aria-label={group.name}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Smartphone size={14} />
              {group.name}
            </h3>
            <div className="overflow-hidden rounded-lg border border-border/60 divide-y divide-border/50">
              {group.items.map((device) => {
                const physical = device.kind === 'physical'
                const running = physical || device.state === 'booted'
                const disabled =
                  busy ||
                  !connected ||
                  device.state === 'starting' ||
                  (running && device.liveSupported === false)
                const Icon = /ipad|tablet/i.test(device.name) ? Tablet : Smartphone
                const actions: Array<{ action: Action; label: string; disabled?: boolean }> = [
                  { action: 'screenshot', label: 'Take screenshot', disabled: !running },
                  ...(physical && device.platform === 'ios'
                    ? [{ action: 'devicehub' as const, label: 'Open in Device Hub' }]
                    : []),
                  ...(!physical
                    ? [
                        { action: 'open' as const, label: 'Open URL', disabled: !running },
                        {
                          action: running ? ('shutdown' as const) : ('boot' as const),
                          label: running ? 'Shut down' : 'Start',
                        },
                      ]
                    : []),
                ]
                return (
                  <div key={device.id} className="group flex items-center pr-1 hover:bg-muted/30">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left outline-none focus-visible:bg-muted disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => (running ? onOpen(device) : onAction(device, 'boot'))}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                        <Icon size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{device.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {host} ·{' '}
                          {physical
                            ? (device.connection ?? 'Connected')
                            : device.runtime
                                .replace('com.apple.CoreSimulator.SimRuntime.', '')
                                .replace(/^iOS-/, 'iOS ')
                                .replace(/-/g, '.')}{' '}
                          ·{' '}
                          {physical
                            ? 'Connected'
                            : device.state === 'booted'
                              ? 'Running'
                              : device.state === 'starting'
                                ? 'Starting…'
                                : 'Stopped'}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {device.state === 'starting'
                          ? 'Starting…'
                          : device.liveSupported === false && running
                            ? 'Unavailable'
                            : running
                              ? 'Open'
                              : 'Start'}
                      </span>
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <IconButton
                          label={`Actions for ${device.name}`}
                          className="size-7 shrink-0 text-muted-foreground"
                          disabled={busy || !connected}
                        >
                          <MoreHorizontal size={15} />
                        </IconButton>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="end"
                          sideOffset={4}
                          className="z-[70] min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
                        >
                          {actions.map((item) => (
                            <DropdownMenu.Item
                              key={item.action}
                              disabled={item.disabled}
                              onSelect={() => onAction(device, item.action)}
                              className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40"
                            >
                              {item.label}
                            </DropdownMenu.Item>
                          ))}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
    </div>
  )
}
