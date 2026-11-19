import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRef, useState, type Ref } from 'react'
import {
  LockKeyhole,
  Globe2,
  Mic,
  Camera,
  Bell,
  Clipboard,
  Volume2,
  Monitor,
  UserRound,
  Database,
  PictureInPicture2,
  MapPin,
  FolderOpen,
  Type,
  Usb,
  Bluetooth,
  Music,
  MousePointer2,
  Keyboard,
  PanelsTopLeft,
} from 'lucide-react'
import { useStudioHost } from '@dovo/studio-core'
import { Button, IconButton, Popover } from '@dovo/studio-ui'
import {
  browserCertificateEntries,
  type BrowserCommand,
  type BrowserPageCertificate,
  type BrowserSitePermissions,
} from '@dovo/protocol'

const controls = [
  { permission: 'notifications', label: 'Notifications', Icon: Bell },
  { permission: 'microphone', label: 'Microphone', Icon: Mic },
  { permission: 'camera', label: 'Camera', Icon: Camera },
  { permission: 'clipboard-read', label: 'Read clipboard', Icon: Clipboard },
  { permission: 'clipboard-sanitized-write', label: 'Write clipboard', Icon: Clipboard },
  { permission: 'speaker-selection', label: 'Speaker selection', Icon: Volume2 },
  { permission: 'screen-wake-lock', label: 'Keep screen awake', Icon: Monitor },
  { permission: 'idle-detection', label: 'Device presence', Icon: UserRound },
  { permission: 'persistent-storage', label: 'Persistent storage', Icon: Database },
  { permission: 'automatic-pip', label: 'Automatic PiP', Icon: PictureInPicture2 },
  { permission: 'geolocation', label: 'Precise location', Icon: MapPin },
  { permission: 'geolocation-approximate', label: 'Approximate location', Icon: MapPin },
  { permission: 'fileSystem', label: 'Files and folders you choose', Icon: FolderOpen },
  { permission: 'local-fonts', label: 'Installed fonts', Icon: Type },
  { permission: 'usb', label: 'USB devices', Icon: Usb },
  { permission: 'hid', label: 'HID devices', Icon: Usb },
  { permission: 'serial', label: 'Serial ports', Icon: Usb },
  { permission: 'bluetooth', label: 'Bluetooth devices', Icon: Bluetooth },
  { permission: 'midi', label: 'MIDI devices (including SysEx)', Icon: Music },
  { permission: 'pointerLock', label: 'Capture mouse pointer', Icon: MousePointer2 },
  { permission: 'keyboardLock', label: 'Capture keyboard shortcuts', Icon: Keyboard },
  { permission: 'window-management', label: 'Displays and window placement', Icon: PanelsTopLeft },
] as const

/** Every command is resolved against the native page's current origin and profile. */
export function BrowserSiteControls({
  tabKey,
  url,
  documentRevision,
  profileName,
  triggerRef,
}: {
  tabKey: string
  url: string
  documentRevision: number
  profileName: string
  triggerRef?: Ref<HTMLButtonElement>
}) {
  const uiText = useInterfaceText()

  const { browser } = useStudioHost()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<BrowserSitePermissions>()
  const [snapshot, setSnapshot] = useState<{
    revision: number
    certificate: BrowserPageCertificate
  }>()
  const certificate = snapshot?.revision === documentRevision ? snapshot.certificate : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const pending = useRef(false)
  let page: URL | undefined
  try {
    const parsed = new URL(url)
    if (/^https?:$/.test(parsed.protocol)) page = parsed
  } catch {
    /* New tabs have no origin. */
  }
  const call = async (command: BrowserCommand) => {
    if (!browser || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await browser(command)
      if (command.action === 'site-certificate') {
        if (!result?.certificate || result.certificate.origin !== command.origin)
          throw new Error('Certificate details are unavailable for this page.')
        setSnapshot({ revision: documentRevision, certificate: result.certificate })
      } else if (result?.sitePermissions) setState(result.sitePermissions)
      else
        throw new Error('Website controls are unavailable. Update the desktop app and try again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setOpen(true)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        setConfirmClear(false)
        setSnapshot(undefined)
        if (value && browser) void call({ action: 'site-permissions', key: tabKey })
      }}
    >
      <Popover.Trigger asChild>
        <IconButton
          ref={triggerRef}
          type="button"
          label="Website permissions and site data"
          disabled={!page}
          className="size-8 shrink-0 rounded-full"
        >
          {page?.protocol === 'https:' ? <LockKeyhole size={15} /> : <Globe2 size={15} />}
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          aria-label="Website permissions"
          className="studio-menu-surface studio-browser-site-controls z-50 max-h-[calc(100vh-6rem)] overflow-y-auto w-80 max-w-[calc(100vw-1rem)] space-y-4 rounded-2xl border bg-[var(--studio-floating-fill)] p-4 text-popover-foreground"
        >
          <div>
            <h2 className="truncate text-sm font-medium">{page?.host}</h2>
            <p className="text-xs text-muted-foreground">{profileName}</p>
          </div>
          {page?.protocol === 'https:' ? (
            browser ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (certificate) setSnapshot(undefined)
                    else void call({ action: 'site-certificate', key: tabKey, origin: page.origin })
                  }}
                  aria-expanded={!!certificate}
                >
                  <LockKeyhole size={14} />
                  {certificate ? 'Hide certificate' : 'View certificate'}
                </Button>
                {certificate && <CertificateChain certificate={certificate} />}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Your web browser manages this connection.{' '}
                <a href={page.href} target="_blank" rel="noopener noreferrer" className="underline">
                  Open the website in a tab
                </a>{' '}
                to view its certificate.
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              HTTP connection. This page has no TLS certificate.
            </p>
          )}
          {browser && (
            <>
              <div className="space-y-3" aria-busy={busy}>
                {controls
                  .filter(
                    ({ permission }) =>
                      permission === 'notifications' ||
                      permission === 'automatic-pip' ||
                      (state?.origin === page?.origin && state?.requested?.includes(permission)),
                  )
                  .map(({ permission, label, Icon }) => (
                    <div key={permission} className="flex items-center gap-2">
                      <Icon size={15} className="shrink-0 text-muted-foreground" />
                      <label htmlFor={`${tabKey}-${permission}`} className="flex-1 text-sm">
                        {label}
                      </label>
                      <select
                        id={`${tabKey}-${permission}`}
                        aria-label={`${label} permission`}
                        className="min-w-0 rounded border bg-background px-1.5 py-1 text-xs"
                        disabled={busy || !state || !page}
                        value={state?.permissions[permission] ?? 'ask'}
                        onChange={(event) => {
                          const value = event.target.value
                          if (value === 'ask' || value === 'allow' || value === 'block')
                            void call({
                              action: 'set-site-permission',
                              origin: page!.origin,
                              key: tabKey,
                              permission,
                              setting: value,
                            })
                        }}
                      >
                        {permission !== 'automatic-pip' && (
                          <option value="ask">Ask every time</option>
                        )}
                        <option value="allow">Allow</option>
                        <option value="block">Block</option>
                      </select>
                      {(permission === 'camera' ||
                        permission === 'microphone' ||
                        permission === 'notifications') && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy || !state || !page}
                          aria-label={`Request ${label.toLowerCase()} permission`}
                          onClick={() => {
                            setOpen(false)
                            void call({
                              action: 'request-site-permission',
                              origin: page!.origin,
                              key: tabKey,
                              permission,
                            })
                          }}
                        >
                          Ask
                        </Button>
                      )}
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Reload to stop existing access. Automatic PiP requires a call window from the site.
              </p>
              <div className="border-t pt-3">
                {confirmClear ? (
                  <div className="space-y-2">
                    <p className="text-xs">Clear cookies and site data? This may sign you out.</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void call({
                            action: 'clear-site-data',
                            key: tabKey,
                            origin: page!.origin,
                          })
                          setConfirmClear(false)
                        }}
                      >
                        Clear site data
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmClear(false)}
                      >
                        {uiText('Cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmClear(true)}
                  >
                    Cookies and site data…
                  </Button>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CertificateChain({ certificate }: { certificate: BrowserPageCertificate }) {
  return (
    <section aria-label="Certificate chain" className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        {[certificate.protocol, certificate.cipher].filter(Boolean).join(' · ')}
      </p>
      {'leaf' in certificate && (
        <p>Chromium did not provide the certificate chain for this page.</p>
      )}
      {browserCertificateEntries(certificate).map((item, index) => (
        <details
          key={item.fingerprint256 ?? index}
          open={index === 0}
          className="rounded-md border p-2"
        >
          <summary className="cursor-pointer font-medium">
            {index === 0 ? 'Site certificate' : `Issuer certificate ${index}`}
          </summary>
          <dl className="mt-2 space-y-1.5">
            {[
              ['Subject', item.subject],
              ['Issuer', item.issuer],
              ['Valid from', item.validFrom],
              ['Valid until', item.validTo],
              ['Subject alternative names', item.subjectAltName],
              ['Serial number', item.serialNumber],
              ['SHA-256 fingerprint', item.fingerprint256],
            ].map(
              ([label, value]) =>
                value && (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="select-text whitespace-pre-line break-all">{value}</dd>
                  </div>
                ),
            )}
          </dl>
        </details>
      ))}
    </section>
  )
}
