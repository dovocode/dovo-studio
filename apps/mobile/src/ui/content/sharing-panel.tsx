import { Schema } from 'effect'
import { useState, type ReactNode } from 'react'
import { AccessibilityInfo, Alert, Pressable, ScrollView, View } from 'react-native'
import { useEncryptedSharing, useSharingPeople, type SharingRuntime } from '@dovo/studio-core'
import {
  artifactAccessSchema,
  decode,
  mutableStruct,
  type SharedContent,
  type ArtifactSourcePublication,
  type OpenShare,
} from '@dovo/protocol'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { Action } from '../controls/action'
import { Field } from '../controls/field'
import { Choice } from '../controls/choice'
import { Icon } from '../controls/icon'
import { Text } from './text'
import { SharingPeopleManager } from './sharing-people'
import { useTheme } from '../theme'
import { copyText } from './clipboard'

export function SharingPanel({
  sourceId,
  kind,
  content,
  runtime,
  legacy = [],
  renderFeed,
}: {
  sourceId: string
  kind: 'artifact' | 'thread'
  content?: SharedContent
  runtime?: SharingRuntime
  renderFeed?: (share: OpenShare, origin: string, update: (share: OpenShare) => void) => ReactNode
  legacy?: ArtifactSourcePublication[]
}) {
  const account = useMobileAccount(),
    { styles, colors } = useTheme()
  const sharing = useEncryptedSharing({ client: account.client, sourceId, kind, content, runtime })
  const contacts = useSharingPeople(account.client)
  const [managePeople, setManagePeople] = useState(false)
  const organizationName = (id: string) =>
    contacts.directory?.organizations.find((org) => org.id === id)?.name ?? id
  const personName = (id: string) =>
    contacts.directory?.friends.find((person) => person.id === id)?.name ?? id
  const [recipient, setRecipient] = useState(''),
    [restore, setRestore] = useState(''),
    [seconds, setSeconds] = useState('604800')
  const [notice, setNotice] = useState(''),
    [copyError, setCopyError] = useState(''),
    [showRecovery, setShowRecovery] = useState(false)
  const links =
    sharing.share?.record.grants.filter((grant) => !grant.userId && !grant.organizationId) ?? []
  const people =
    sharing.share?.record.grants.filter((grant) => !!grant.userId || !!grant.organizationId) ?? []
  const activeLink = links.find((grant) => (grant.expiresAt ?? 0) > Date.now())
  const needsRecovery = sharing.loaded && !sharing.hasKey && sharing.hasShares
  const unavailable =
    sharing.busy ||
    !sharing.loaded ||
    needsRecovery ||
    (!sharing.share && kind === 'thread' && !runtime)
  const heading = { color: colors.text, fontSize: 16, fontWeight: '600' } as const
  const divider = {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
    gap: 12,
  } as const
  const copy = async (text: string, message = 'Link copied') => {
    setNotice('')
    setCopyError('')
    try {
      if ((await copyText(text)) === 'copied') {
        setNotice(message)
        AccessibilityInfo.announceForAccessibility(message)
      } else setCopyError('Open Advanced to select and copy the link or key manually.')
    } catch {
      setCopyError('Could not copy. Open Advanced to select and copy the link or key manually.')
    }
  }
  const confirmRemove = (id: string) =>
    Alert.alert(
      id === 'links' ? 'Restrict link access?' : 'Remove this access?',
      `${id === 'links' ? 'All anyone-with-link URLs will stop working. People you invited keep access.' : 'This person or link will lose access. Other readers keep access.'} Saved copies cannot be recalled.${kind === 'artifact' ? ' A live data feed must be approved again after access changes.' : ''}`,
      [
        { text: 'Keep access', style: 'cancel' },
        {
          text: 'Remove access',
          style: 'destructive',
          onPress: () => void (id === 'links' ? sharing.setLinkAccess(false) : sharing.revoke(id)),
        },
      ],
    )
  return (
    <View
      style={{ gap: 16 }}
      accessibilityLabel="Sharing settings"
      accessibilityState={{ busy: sharing.busy }}
    >
      {!account.directory ? (
        <>
          <Text style={styles.muted}>
            Sign in to manage sharing. People you share a link with can read without an account.
          </Text>
          <Action
            label={account.busy ? 'Signing in…' : 'Sign in to publish'}
            disabled={account.busy}
            onPress={() => void account.client.signIn()}
            wide
          />
          {account.login && (
            <>
              <Text style={styles.text}>Compare sign-in code: {account.login.code}</Text>
              <Action secondary label="Cancel sign-in" onPress={account.client.cancel} />
            </>
          )}
        </>
      ) : (
        <>
          {!sharing.loaded && !sharing.error && (
            <Text style={styles.text}>Loading sharing settings…</Text>
          )}
          {needsRecovery && (
            <View style={{ ...styles.card, gap: 12 }}>
              <Text accessibilityRole="header" style={heading}>
                Syncing sharing access
              </Text>
              <Text style={styles.muted}>
                Keep Studio open on another device signed in to this account where sharing already
                works. Access restores automatically while both devices are online.
              </Text>
              {!!sharing.syncError && <Text style={styles.muted}>{sharing.syncError}</Text>}
              <Action
                secondary
                label="Restore from a backup"
                onPress={() => setShowRecovery(!showRecovery)}
              />
              {showRecovery && (
                <>
                  <Field
                    label="Recovery key"
                    secureTextEntry
                    autoCorrect={false}
                    autoCapitalize="none"
                    value={restore}
                    onChangeText={setRestore}
                    editable={!sharing.busy}
                  />
                  <Action
                    label="Restore sharing key"
                    disabled={sharing.busy || !restore.trim()}
                    onPress={() => {
                      void sharing.restore(restore).then((ok) => {
                        if (ok) setRestore('')
                      })
                    }}
                  />
                </>
              )}
            </View>
          )}
          <View style={{ gap: 12 }} accessibilityLabel="People with access">
            {!!contacts.directory &&
              (contacts.directory.friends.some((person) => person.status === 'accepted') ||
                contacts.directory.organizations.some((org) => org.status === 'member')) && (
                <Choice
                  label="Add friends or organisations"
                  hideLabel
                  value=""
                  items={[
                    { id: '', name: 'Add friends or organisations…' },
                    ...contacts.directory.friends
                      .filter(
                        (person) =>
                          person.status === 'accepted' &&
                          !people.some((grant) => grant.userId === person.id),
                      )
                      .map((person) => ({ id: 'friend:' + person.id, name: person.name })),
                    ...contacts.directory.organizations
                      .filter(
                        (org) =>
                          org.status === 'member' &&
                          !people.some((grant) => grant.organizationId === org.id),
                      )
                      .map((org) => ({
                        id: 'organization:' + org.id,
                        name: org.name + ' (organisation)',
                      })),
                  ]}
                  disabled={unavailable || contacts.busy}
                  onChange={(value) => {
                    if (!value) return
                    const [type, ...parts] = value.split(':')
                    const id = parts.join(':')
                    void (type === 'organization'
                      ? sharing.inviteOrganization(id)
                      : sharing.invite(id))
                  }}
                />
              )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Add people by sharing ID"
                  hideLabel
                  placeholder="Add people by sharing ID"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={recipient}
                  maxLength={500}
                  onChangeText={setRecipient}
                  editable={!unavailable}
                />
              </View>
              <Action
                variant="outline"
                label="Add"
                disabled={unavailable || !recipient.trim()}
                onPress={() => {
                  void sharing.invite(recipient.trim()).then((ok) => {
                    if (ok) {
                      setRecipient('')
                      setNotice('Person added. Copy their invitation link to send it to them.')
                    }
                  })
                }}
              />
            </View>
            <Text style={styles.muted}>
              Use their sharing ID from Studio. You send the invitation link yourself.
            </Text>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}
            >
              <Icon name="agents" size={22} color={colors.muted} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.text}>{account.directory.user.name} (you)</Text>
                <Text style={styles.muted}>Owner</Text>
              </View>
            </View>
            {people.map((grant) => (
              <View
                key={grant.id}
                style={divider}
                accessibilityLabel={`Access for ${grant.userId ?? grant.organizationId}`}
              >
                {grant.organizationId && (
                  <Text style={styles.muted}>Organisation · access follows membership</Text>
                )}
                <Text selectable style={styles.text}>
                  {grant.organizationId
                    ? organizationName(grant.organizationId)
                    : personName(grant.userId ?? '')}
                </Text>
                <Text style={styles.muted}>
                  {kind === 'thread' ? 'Reader · Can suggest' : 'Reader'}
                </Text>
                <View style={[styles.row, { gap: 16 }]}>
                  <Action
                    variant="outline"
                    label="Copy invitation link"
                    disabled={sharing.busy}
                    onPress={() => void copy(sharing.link(grant.id))}
                  />
                  <Action
                    secondary
                    label="Remove access"
                    disabled={sharing.busy}
                    onPress={() => confirmRemove(grant.id)}
                  />
                </View>
              </View>
            ))}
          </View>
          <View style={divider} accessibilityLabel="General access">
            <Text accessibilityRole="header" style={heading}>
              General access
            </Text>
            <Choice
              label="General access"
              hideLabel
              value={activeLink ? 'anyone' : 'restricted'}
              disabled={unavailable}
              onChange={(value) => {
                setNotice('')
                if (value === 'restricted') confirmRemove('links')
                else void sharing.setLinkAccess(true, Number(seconds))
              }}
              items={[
                { id: 'restricted', name: 'Restricted' },
                { id: 'anyone', name: 'Anyone with the link' },
              ]}
            />
            <Text style={styles.muted}>
              {activeLink
                ? `Anyone with the link can read${kind === 'thread' ? ' and suggest a prompt' : ''}. No sign-in required.`
                : 'Only people and organisations you add can open their invitation links.'}
            </Text>
            {activeLink && (
              <Text style={styles.muted}>
                Link expires {new Date(activeLink.expiresAt ?? 0).toLocaleDateString()}
              </Text>
            )}
            <Text style={styles.muted}>
              {kind === 'thread'
                ? 'New replies update automatically; tools, files and drafts stay private.'
                : 'Shares this saved version and its files. Later edits stay private.'}
            </Text>
            {!!sharing.share &&
              kind === 'thread' &&
              (sharing.share.record.paused || !runtime || sharing.sync?.enabled === false) && (
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  {sharing.share.record.paused
                    ? 'Updates paused. Readers see the last published messages.'
                    : 'Waiting for the source computer. Readers see the last published messages.'}
                </Text>
              )}
            {!sharing.share && kind === 'thread' && !runtime && (
              <Text style={styles.muted}>
                Reconnect to the source computer to share this thread.
              </Text>
            )}
          </View>
          <View style={divider}>
            <Action
              label="Copy link"
              disabled={unavailable || !activeLink}
              onPress={() => {
                if (activeLink) void copy(sharing.link(activeLink.id))
              }}
              wide
            />
            {!activeLink && (
              <Text style={styles.muted}>
                To copy a link for anyone, change General access. Personal invitation links are
                above.
              </Text>
            )}
            <Text style={[styles.muted, { fontSize: 12, textAlign: 'center' }]}>
              End-to-end encrypted
            </Text>
          </View>
          {!!legacy.length && (
            <Text style={styles.muted}>
              An older unencrypted copy is still hosted. Manage it in Advanced.
            </Text>
          )}
          <Action
            secondary
            label={managePeople ? 'Hide friends and organisations' : 'Friends and organisations'}
            onPress={() => setManagePeople((value) => !value)}
          />
          {managePeople && (
            <SharingPeopleManager people={contacts} userId={account.directory.user.id} />
          )}
          <SharingDisclosure
            title="Advanced"
            onOpenChange={(open) => {
              if (!open) {
                sharing.hideRecovery()
                setShowRecovery(false)
              }
            }}
          >
            <SharingDisclosure title="Review shared content">
              <Action
                variant="outline"
                label="Load content preview"
                disabled={unavailable || (kind === 'thread' && !runtime)}
                onPress={() => void sharing.review()}
              />
              {sharing.preview && (
                <ScrollView
                  style={{ maxHeight: 240 }}
                  nestedScrollEnabled
                  accessibilityLabel="Content to share"
                >
                  <Text selectable style={styles.text}>
                    {sharing.preview.kind === 'thread'
                      ? sharing.preview.messages
                          .map(
                            (message) =>
                              `${message.role === 'user' ? 'User' : 'Agent'}\n${message.text}`,
                          )
                          .join('\n\n')
                      : `${sharing.preview.artifact.title}\n\n${sharing.preview.artifact.content}${sharing.preview.artifact.files?.map((file) => `\n\n${file.path}\n${file.content}`).join('') ?? ''}`}
                  </Text>
                </ScrollView>
              )}
            </SharingDisclosure>
            <Text style={styles.muted}>
              New link lifetime applies when you enable link access or create another link. Existing
              links keep their expiry.
            </Text>
            <Choice
              label="New link lifetime"
              value={seconds}
              onChange={setSeconds}
              disabled={sharing.busy}
              items={[
                { id: '3600', name: '1 hour' },
                { id: '86400', name: '1 day' },
                { id: '604800', name: '7 days' },
                { id: '2592000', name: '30 days' },
              ]}
            />
            {!!activeLink && (
              <Action
                variant="outline"
                label="Create another link"
                disabled={unavailable}
                onPress={() => void sharing.createLink(Number(seconds))}
              />
            )}
            {sharing.share?.record.grants.map((grant) => (
              <View key={grant.id} style={{ ...styles.card, gap: 10 }}>
                <Text style={styles.muted}>
                  {grant.organizationId
                    ? `Organisation · ${organizationName(grant.organizationId)}`
                    : grant.userId
                      ? `Invitation · ${grant.userId}`
                      : `${(grant.expiresAt ?? 0) > Date.now() ? 'Expires' : 'Expired'} · ${new Date(grant.expiresAt ?? 0).toLocaleString()}`}
                </Text>
                <Field
                  label={
                    grant.userId || grant.organizationId ? 'Private invitation link' : 'Share link'
                  }
                  value={sharing.link(grant.id)}
                  editable={false}
                />
                <Action
                  variant="outline"
                  label="Copy this link"
                  disabled={
                    sharing.busy ||
                    (!grant.userId && !grant.organizationId && (grant.expiresAt ?? 0) <= Date.now())
                  }
                  onPress={() => void copy(sharing.link(grant.id))}
                />
                <Action
                  secondary
                  label="Remove this link"
                  disabled={sharing.busy}
                  onPress={() => confirmRemove(grant.id)}
                />
              </View>
            ))}
            {sharing.share && kind === 'thread' && (
              <View style={{ gap: 10 }}>
                <Text style={heading}>Automatic updates</Text>
                <Text style={styles.muted}>
                  Pausing keeps the current hosted copy available. Suggestions appear inline in your
                  thread.
                </Text>
                <Action
                  variant="outline"
                  label={
                    sharing.share.record.paused
                      ? 'Resume automatic updates'
                      : 'Pause automatic updates'
                  }
                  disabled={sharing.busy || (!runtime && sharing.share.record.paused)}
                  onPress={() =>
                    void (sharing.share?.record.paused ? sharing.resume() : sharing.pause())
                  }
                />
                {!sharing.share.record.paused && sharing.sync?.enabled === false && !!runtime && (
                  <Action
                    variant="outline"
                    label="Reconnect automatic updates"
                    disabled={sharing.busy}
                    onPress={() => void sharing.resume()}
                  />
                )}
                {!runtime && (
                  <Text style={styles.muted}>
                    Reconnect to the source computer to start or resume updates.
                  </Text>
                )}
                {!!sharing.sync?.error && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {sharing.sync.error}
                  </Text>
                )}
              </View>
            )}
            {!!sharing.share && renderFeed?.(sharing.share, sharing.origin, sharing.setShare)}
            {sharing.hasKey && (
              <SharingDisclosure
                title="Recovery and another device"
                open={showRecovery || !!sharing.recovery}
                onOpenChange={(open) => {
                  setShowRecovery(open)
                  if (!open) sharing.hideRecovery()
                }}
              >
                <Text style={styles.muted}>
                  Your key syncs automatically while another signed-in Studio device is online. An
                  optional backup in your password manager can restore access if every device is
                  lost. It unlocks all your shared content.
                </Text>
                {sharing.recovery ? (
                  <>
                    <Text selectable accessibilityLabel="Sharing recovery key" style={styles.text}>
                      {sharing.recovery}
                    </Text>
                    <Action
                      variant="outline"
                      label="Copy recovery key"
                      onPress={() => void copy(sharing.recovery, 'Recovery key copied')}
                      disabled={sharing.busy}
                    />
                    <Action secondary label="Hide key" onPress={sharing.hideRecovery} />
                  </>
                ) : (
                  <Action
                    variant="outline"
                    label="Show recovery key"
                    disabled={sharing.busy}
                    onPress={() => void sharing.showRecovery()}
                  />
                )}
              </SharingDisclosure>
            )}
            <SharingDisclosure title="Account and destination">
              <Text style={styles.muted}>Publishing as {account.directory.user.name}</Text>
              <Text selectable style={styles.muted}>
                Your sharing ID: {account.directory.user.id}
              </Text>
              <Text selectable style={styles.muted}>
                Hosted at {sharing.origin || 'Loading…'}
              </Text>
            </SharingDisclosure>
            {sharing.share && (
              <View style={divider}>
                <Text style={styles.muted}>
                  Delete the hosted copy to stop all sharing. Your local {kind} stays available.
                  Saved reader copies cannot be recalled.
                </Text>
                <Action
                  secondary
                  label="Delete hosted copy"
                  disabled={sharing.busy}
                  onPress={() =>
                    Alert.alert(
                      'Delete hosted copy?',
                      'All links and invitations will stop working. Your local content stays available.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete hosted copy',
                          style: 'destructive',
                          onPress: () => void sharing.remove(),
                        },
                      ],
                    )
                  }
                />
              </View>
            )}
            {legacy.map((publication) => (
              <LegacySharing
                key={publication.id}
                origin={account.publicationOrigin}
                publication={publication}
              />
            ))}
            <Action
              secondary
              label="Refresh sharing"
              disabled={sharing.busy}
              onPress={() => void sharing.refresh()}
            />
          </SharingDisclosure>
        </>
      )}
      {!!(sharing.error || account.error || copyError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {sharing.error || account.error || copyError}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {notice}
        </Text>
      )}
    </View>
  )
}

function SharingDisclosure({
  title,
  children,
  open,
  onOpenChange,
}: {
  title: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { colors, styles } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const visible = open ?? expanded
  return (
    <View style={{ gap: visible ? 12 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: visible }}
        onPress={() => {
          setExpanded(!visible)
          onOpenChange?.(!visible)
        }}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>{title}</Text>
        <Icon name={visible ? 'down' : 'next'} size={16} color={colors.muted} />
      </Pressable>
      {visible && children}
    </View>
  )
}

function LegacySharing({
  origin,
  publication,
}: {
  origin: string
  publication: ArtifactSourcePublication
}) {
  const { client } = useMobileAccount(),
    { styles } = useTheme()
  const [access, setAccess] = useState<typeof artifactAccessSchema.Type | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [deleted, setDeleted] = useState(false),
    [recipient, setRecipient] = useState(''),
    [created, setCreated] = useState('')
  const path = '/v1/publications/' + publication.id
  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sharing failed')
    } finally {
      setBusy(false)
    }
  }
  const refresh = async () =>
    setAccess(
      decode(artifactAccessSchema, await client.artifactAccessRequest(origin, path + '/access')),
    )
  if (deleted) return null
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Existing hosted v{publication.revision} · Not end-to-end encrypted
      </Text>
      <Text style={styles.muted}>
        An encrypted copy uses new links. Delete this previous copy to remove its content and live
        feed from hosting. Backups follow server retention.
      </Text>
      <Action
        secondary
        label="Manage existing access"
        disabled={busy}
        onPress={() => void act(refresh)}
      />
      {access && (
        <>
          <Field
            label="Existing copy recipient sharing ID"
            value={recipient}
            onChangeText={setRecipient}
          />
          <Action
            secondary
            label="Invite account to existing copy"
            disabled={busy || !recipient.trim()}
            onPress={() =>
              void act(async () => {
                await client.artifactAccessRequest(origin, path + '/invites', 'POST', {
                  userId: recipient.trim(),
                })
                setRecipient('')
                await refresh()
              })
            }
          />
          <Action
            secondary
            label="Create 7-day link to existing copy"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const result = decode(
                  mutableStruct({ url: Schema.String }),
                  await client.artifactAccessRequest(origin, path + '/links', 'POST', {
                    seconds: 604800,
                  }),
                )
                setCreated(result.url)
                await refresh()
              })
            }
          />
          {!!created && (
            <>
              <Text selectable style={styles.text}>
                {created}
              </Text>
              <Action
                secondary
                label="Copy existing artifact link"
                onPress={() =>
                  void copyText(created).catch((cause) =>
                    setError(cause instanceof Error ? cause.message : 'Could not copy link'),
                  )
                }
              />
            </>
          )}
        </>
      )}
      {access?.invites.map((invite) => (
        <View key={invite.userId}>
          <Text selectable style={styles.text}>
            {invite.userId}
          </Text>
          <Action
            secondary
            label="Remove access"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await client.artifactAccessRequest(origin, path + '/invites', 'DELETE', invite)
                await refresh()
              })
            }
          />
        </View>
      ))}
      {access?.links.map((link) => (
        <View key={link.id}>
          <Text style={styles.text}>Expires {new Date(link.expiresAt).toLocaleString()}</Text>
          <Action
            secondary
            label="Revoke link"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await client.artifactAccessRequest(origin, path + '/links/' + link.id, 'DELETE')
                await refresh()
              })
            }
          />
        </View>
      ))}
      {access?.feed && (
        <Action
          secondary
          label="Stop existing live feed"
          disabled={busy}
          onPress={() =>
            void act(async () => {
              if (access.feed)
                await client.stopArtifactFeed(publication.id, origin, access.feed.generation)
              await refresh()
            })
          }
        />
      )}
      <Action
        secondary
        label="Delete unencrypted hosted copy"
        disabled={busy}
        onPress={() =>
          Alert.alert(
            'Delete unencrypted copy?',
            'Existing invitations, links and live data will be removed.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  void act(async () => {
                    await client.artifactAccessRequest(origin, path, 'DELETE')
                    setDeleted(true)
                    await client.refreshPublications()
                  }),
              },
            ],
          )
        }
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
