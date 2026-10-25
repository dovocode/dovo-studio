import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'
import {
  DovoWebKitBrowser,
  type ExtensionGrant,
  type ExtensionPermissionPrompt,
  type InstalledExtension,
  type StagedExtension,
} from './native-browser'

import {
  permissionChoices,
  restrictGrant,
  permissionPromptChoices,
  restrictPromptGrant,
} from './extension-grants'

function Grants({
  choices,
  grant,
  onChange,
}: {
  choices: ExtensionGrant
  grant: ExtensionGrant
  onChange: (grant: ExtensionGrant) => void
}) {
  return (
    <>
      {(['permissions', 'matchPatterns'] as const).map((kind) =>
        choices[kind].map((value) => {
          const checked = grant[kind].includes(value)
          return (
            <Pressable
              key={kind + value}
              accessibilityRole="checkbox"
              accessibilityLabel={value}
              accessibilityState={{ checked }}
              onPress={() =>
                onChange({
                  ...grant,
                  [kind]: checked
                    ? grant[kind].filter((item) => item !== value)
                    : [...grant[kind], value],
                })
              }
            >
              <Text>
                {checked ? '☑' : '☐'} {value}
              </Text>
            </Pressable>
          )
        }),
      )}
    </>
  )
}
type Review =
  | { kind: 'install'; extension: StagedExtension; profileId: string }
  | { kind: 'grant'; extension: InstalledExtension; profileId: string }
type Confirmation = { extension: InstalledExtension; kind: 'enable' | 'remove' }
/** WebKit-only. All grants require review; native code presents the action popup. */
export function NativeExtensions({
  profileId,
  tabId,
  visible,
  onError,
}: {
  profileId: string
  tabId: string | null
  visible: boolean
  onError: (message: string) => void
}) {
  const module = DovoWebKitBrowser
  const { styles } = useTheme()
  const [open, setOpen] = useState(false)
  const [extensions, setExtensions] = useState<InstalledExtension[]>([])
  const [review, setReview] = useState<Review | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [prompt, setPrompt] = useState<ExtensionPermissionPrompt | null>(null)
  const [grant, setGrant] = useState<ExtensionGrant>({ permissions: [], matchPatterns: [] })
  const [promptGrant, setPromptGrant] = useState<ExtensionGrant>({
    permissions: [],
    matchPatterns: [],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reportError = (message: string) => {
    setError(message)
    onError(message)
  }
  const locked = useRef(false)
  const activeProfile = useRef(profileId)
  activeProfile.current = profileId
  const staged = useRef<string | null>(null)
  const pendingPrompt = useRef<ExtensionPermissionPrompt | null>(null)
  const refresh = async () => {
    const owner = profileId
    await module?.ensureProfile(owner)
    const items = await module?.listExtensions(owner)
    if (items && activeProfile.current === owner) setExtensions(items)
  }
  const act = async (work: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      reportError(String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!module) return
    setExtensions([])
    void refresh().catch((cause) => reportError(`Could not read extensions: ${String(cause)}`))
    const changed = module.addListener('onExtensionsChanged', (event) => {
      if (event.profileId === profileId) void refresh().catch((cause) => reportError(String(cause)))
    })
    return () => changed.remove()
  }, [module, profileId])
  useEffect(() => {
    if (!module) return
    const listener = module.addListener('onExtensionPermissionPrompt', (event) => {
      // Never replace an unanswered review with another request, or grant it implicitly.
      if (pendingPrompt.current) {
        void module
          .resolveExtensionPermissionPrompt(event.requestId, { permissions: [], matchPatterns: [] })
          .catch((cause) => reportError(String(cause)))
        return
      }
      pendingPrompt.current = event
      setPromptGrant({ permissions: [], matchPatterns: [] })
      setPrompt(event)
    })
    return () => {
      listener.remove()
      const request = pendingPrompt.current
      if (request)
        void module
          .resolveExtensionPermissionPrompt(request.requestId, {
            permissions: [],
            matchPatterns: [],
          })
          .catch((cause) => console.error('Could not deny extension request', cause))
      if (staged.current)
        void module
          .discardStagedExtension(staged.current)
          .catch((cause) => console.error('Could not discard extension staging', cause))
    }
  }, [module])
  const dismissReview = () =>
    void act(async () => {
      if (review?.kind === 'install') {
        await module?.discardStagedExtension(review.extension.stagingId)
        staged.current = null
      }
      setReview(null)
    })
  const resolvePrompt = (approved: ExtensionGrant) =>
    void act(async () => {
      const request = pendingPrompt.current
      if (!request) return
      // Consume before native resolution; an expired request must not be silently retried.
      pendingPrompt.current = null
      setPrompt(null)
      await module?.resolveExtensionPermissionPrompt(
        request.requestId,
        restrictPromptGrant(approved, request),
      )
    })
  const feedback = error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  ) : null
  const title = prompt
    ? 'Extension requests more access'
    : review
      ? `Review ${review.extension.name}`
      : confirmation
        ? `${confirmation.kind === 'remove' ? 'Remove' : confirmation.extension.enabled ? 'Disable' : 'Enable'} ${confirmation.extension.name}?`
        : `WebKit WebExtensions · ${profileId}`
  const closeManager = () => {
    const request = pendingPrompt.current
    const stagingId = staged.current
    pendingPrompt.current = null
    staged.current = null
    setPrompt(null)
    setReview(null)
    setConfirmation(null)
    setOpen(false)
    void act(async () => {
      if (request)
        await module?.resolveExtensionPermissionPrompt(request.requestId, {
          permissions: [],
          matchPatterns: [],
        })
      if (stagingId) await module?.discardStagedExtension(stagingId)
    })
  }
  if (!module) return null
  return (
    <>
      {visible && <Action secondary label="WebKit WebExtensions" onPress={() => setOpen(true)} />}
      {(open || review || confirmation || prompt) && (
        <Sheet title={title} busy={busy} onClose={closeManager}>
          {feedback}
          {!!notice && <Text style={styles.muted}>{notice}</Text>}
          {open && !review && !confirmation && !prompt && (
            <>
              <Text style={styles.muted}>
                WebKit WebExtensions from an unpacked folder. Chrome extension compatibility is not
                guaranteed. Review permissions and website access before installing.
              </Text>
              <Action
                label="Choose extension folder"
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    const extension = await module.pickExtensionFolder()
                    if (!extension) return
                    staged.current = extension.stagingId
                    setGrant({ permissions: [], matchPatterns: [] })
                    setReview({ kind: 'install', extension, profileId })
                  })
                }
              />
              {extensions.map((extension) => (
                <View key={extension.extensionId} style={{ gap: 8, paddingVertical: 12 }}>
                  <Text style={styles.title}>
                    {extension.name} {extension.version}
                  </Text>
                  <Text>
                    {extension.enabled
                      ? extension.loaded
                        ? 'Enabled'
                        : 'Enabled, not loaded'
                      : 'Disabled'}
                  </Text>
                  {!!extension.errors.length && (
                    <Text style={styles.error}>{extension.errors.join('\n')}</Text>
                  )}
                  {!!extension.unsupportedApis.length && (
                    <Text>Unavailable APIs: {extension.unsupportedApis.join(', ')}</Text>
                  )}
                  <Action
                    label={`Review permissions for ${extension.name}`}
                    disabled={busy}
                    onPress={() => {
                      setGrant({
                        permissions: extension.grantedPermissions,
                        matchPatterns: extension.grantedMatchPatterns,
                      })
                      setReview({ kind: 'grant', extension, profileId })
                    }}
                  />
                  <Action
                    label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}
                    disabled={busy}
                    onPress={() => setConfirmation({ kind: 'enable', extension })}
                  />
                  {extension.hasAction && (
                    <Action
                      label={`Open ${extension.name} action`}
                      disabled={busy || !extension.enabled || !extension.loaded}
                      onPress={() =>
                        void act(async () => {
                          await module.performExtensionAction(
                            profileId,
                            extension.extensionId,
                            tabId,
                          )
                        })
                      }
                    />
                  )}
                  <Action
                    label={`Remove ${extension.name}`}
                    disabled={busy}
                    onPress={() => setConfirmation({ kind: 'remove', extension })}
                  />
                </View>
              ))}
              <Action
                label="Close extension popup"
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    await module.closeExtensionPopup()
                  })
                }
              />
            </>
          )}
          {review && !prompt && (
            <>
              <Text>{review.extension.description}</Text>
              <Text>
                Profile: {review.profileId}. Only checked permissions and websites will be granted.
              </Text>
              <Grants
                choices={permissionChoices(review.extension)}
                grant={grant}
                onChange={setGrant}
              />
              {!!review.extension.unsupportedPermissions.length && (
                <Text>
                  Unsupported permissions (never granted):{' '}
                  {review.extension.unsupportedPermissions.join(', ')}
                </Text>
              )}
              {review.kind === 'install' &&
                review.extension.warnings.map((warning, index) => (
                  <Text key={index} style={styles.error}>
                    {warning}
                  </Text>
                ))}
              <Action
                label={
                  review.kind === 'install'
                    ? 'Install with selected grants'
                    : 'Save selected grants'
                }
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    const approved = restrictGrant(grant, review.extension)
                    if (review.kind === 'install') {
                      await module.installExtension({
                        stagingId: review.extension.stagingId,
                        profileId: review.profileId,
                        grant: approved,
                      })
                      staged.current = null
                    } else
                      await module.setExtensionGrant(
                        review.profileId,
                        review.extension.extensionId,
                        approved,
                      )
                    if (review.kind === 'grant')
                      setNotice(
                        'Permission changes apply on the next page load. Reload the page to apply them.',
                      )
                    setReview(null)
                    await refresh()
                  })
                }
              />
              <Action label="Cancel review" disabled={busy} onPress={dismissReview} />
            </>
          )}
          {confirmation && !review && !prompt && (
            <>
              <Text>
                {confirmation.kind === 'remove'
                  ? 'Remove this extension from its profile?'
                  : 'Change whether this extension runs with its reviewed permissions?'}{' '}
                Profile: {confirmation.extension.profileId}
              </Text>
              <Action
                label="Confirm extension change"
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    const extension = confirmation.extension
                    if (confirmation.kind === 'remove')
                      await module.removeExtension(extension.profileId, extension.extensionId)
                    else
                      await module.setExtensionEnabled(
                        extension.profileId,
                        extension.extensionId,
                        !extension.enabled,
                      )
                    setConfirmation(null)
                    await refresh()
                  })
                }
              />
              <Action
                label="Cancel extension change"
                disabled={busy}
                onPress={() => setConfirmation(null)}
              />
            </>
          )}
          {prompt && (
            <>
              <Text>
                Extension {prompt.extensionId} · profile {prompt.profileId}. Unanswered requests
                expire after 60 seconds.
              </Text>
              <Text>{prompt.urls.join('\n')}</Text>
              <Grants
                choices={permissionPromptChoices(prompt)}
                grant={promptGrant}
                onChange={setPromptGrant}
              />
              <Action
                label="Allow checked access"
                disabled={busy}
                onPress={() => resolvePrompt(promptGrant)}
              />
              <Action
                label="Deny access"
                disabled={busy}
                onPress={() => resolvePrompt({ permissions: [], matchPatterns: [] })}
              />
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
