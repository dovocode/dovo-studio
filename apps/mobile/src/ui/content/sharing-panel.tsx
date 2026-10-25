import { Schema } from 'effect'
import { useState, type ReactNode } from 'react'
import { Alert, View } from 'react-native'
import { useEncryptedSharing, type SharingRuntime } from '@dovo/studio-core'
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
import { Text } from './text'
import { useTheme } from '../theme'
import { copyText } from './clipboard'

export function SharingPanel({
  sourceId,
  kind,
  content,
  runtime,
  onUseSuggestion,
  legacy = [],
  renderFeed,
}: {
  sourceId: string
  kind: 'artifact' | 'thread'
  content?: SharedContent
  runtime?: SharingRuntime
  onUseSuggestion?: (text: string) => void
  renderFeed?: (share: OpenShare, origin: string, update: (share: OpenShare) => void) => ReactNode
  legacy?: ArtifactSourcePublication[]
}) {
  const account = useMobileAccount(),
    { styles, colors } = useTheme()
  const sharing = useEncryptedSharing({ client: account.client, sourceId, kind, content, runtime })
  const [recipient, setRecipient] = useState(''),
    [restore, setRestore] = useState(''),
    [notice, setNotice] = useState('')
  const [showRecovery, setShowRecovery] = useState(false),
    [showDelete, setShowDelete] = useState(false),
    [seconds, setSeconds] = useState('604800')
  const section = { ...styles.card, gap: 12, padding: 16 } as const
  const heading = { color: colors.text, fontSize: 16, fontWeight: '600' } as const
  const copy = async (text: string) => {
    try {
      const result = await copyText(text)
      setNotice(result === 'copied' ? 'Copied' : 'Select and copy the link manually')
    } catch {
      setNotice('Could not copy. Select and copy the link manually.')
    }
  }
  return (
    <View style={{ gap: 16 }} accessibilityLabel="Sharing settings">
      <View style={styles.card}>
        <Text style={heading}>End-to-end encrypted</Text>
        <Text style={styles.muted}>
          Only you and your readers can decrypt shared content. Review messages and files for
          secrets before sharing.
        </Text>
      </View>
      {!!sharing.origin && <Text style={styles.muted}>Hosted at {sharing.origin}</Text>}
      {!account.directory ? (
        <>
          <Action
            label={account.busy ? 'Signing in…' : 'Sign in to publish'}
            disabled={account.busy}
            onPress={() => void account.client.signIn()}
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
          <Text style={styles.muted}>Publishing as {account.directory.user.name}</Text>
          <Text selectable style={styles.muted}>
            Sharing ID: {account.directory.user.id}
          </Text>
          {!sharing.loaded && !sharing.error && (
            <Text style={styles.text}>Loading sharing settings…</Text>
          )}
          {!sharing.hasKey && sharing.loaded && (
            <View style={section}>
              <Text accessibilityRole="header" style={heading}>
                Set up encrypted sharing
              </Text>
              <Text style={styles.muted}>
                Keep your recovery key in a password manager. Use it to restore access on another
                device. Signing in alone cannot decrypt content.
              </Text>
              {!sharing.hasShares && (
                <Action
                  label="Create sharing recovery key"
                  disabled={sharing.busy}
                  onPress={() => void sharing.createKey()}
                />
              )}
              {sharing.hasShares && (
                <Text style={styles.text}>
                  Restore the recovery key for your existing publications.
                </Text>
              )}
              <Field
                label="Recovery key"
                secureTextEntry
                autoCorrect={false}
                value={restore}
                onChangeText={setRestore}
              />
              <Action
                secondary
                label="Restore sharing key"
                disabled={sharing.busy || !restore.trim()}
                onPress={() => {
                  void sharing.restore(restore).then((ok) => {
                    if (ok) setRestore('')
                  })
                }}
              />
            </View>
          )}
          {sharing.hasKey && !sharing.share && (
            <View style={section}>
              <Text accessibilityRole="header" style={heading}>
                Publish private {kind}
              </Text>
              {kind === 'thread' && (
                <Text style={styles.muted}>
                  New user and agent messages will be shared automatically. Tool logs, attachment
                  contents and unsent drafts are excluded.
                </Text>
              )}
              <Action
                secondary
                label="Review content to share"
                disabled={sharing.busy}
                onPress={() => void sharing.review()}
              />
              {sharing.preview && (
                <>
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
                  <Action
                    label={
                      kind === 'thread'
                        ? 'Publish and enable automatic updates'
                        : 'Publish encrypted private copy'
                    }
                    disabled={sharing.busy}
                    onPress={() => void sharing.publish()}
                  />
                </>
              )}
            </View>
          )}
          {sharing.share && (
            <>
              <View style={section}>
                <Text accessibilityRole="header" style={heading}>
                  Shared · End-to-end encrypted
                </Text>
                <Text style={styles.muted}>
                  Last published {new Date(sharing.share.record.updatedAt).toLocaleString()}
                </Text>
                {kind === 'thread' && (
                  <>
                    <Text style={styles.text}>
                      {sharing.share.record.paused
                        ? 'Automatic updates paused'
                        : 'Automatic updates enabled'}
                    </Text>
                    <Action
                      secondary
                      label={
                        sharing.share.record.paused
                          ? 'Resume automatic updates'
                          : 'Pause automatic updates'
                      }
                      disabled={sharing.busy}
                      onPress={() =>
                        void (sharing.share?.record.paused ? sharing.resume() : sharing.pause())
                      }
                    />
                    {!!sharing.sync?.error && (
                      <Text style={styles.error}>{sharing.sync.error}</Text>
                    )}
                  </>
                )}
              </View>
              <View style={section}>
                <Text accessibilityRole="header" style={heading}>
                  Private invitations
                </Text>
                <Text style={styles.muted}>
                  Invite an exact sharing ID, then send that person their invitation link. They need
                  both the link and the invited account.
                </Text>
                <Field
                  label="Recipient sharing ID"
                  value={recipient}
                  onChangeText={setRecipient}
                  maxLength={500}
                />
                <Action
                  variant="outline"
                  label="Invite account"
                  disabled={sharing.busy || !recipient.trim()}
                  onPress={() => {
                    void sharing.invite(recipient.trim()).then((ok) => {
                      if (ok) setRecipient('')
                    })
                  }}
                />
              </View>
              <View style={section}>
                <Text accessibilityRole="header" style={heading}>
                  Anyone with the link
                </Text>
                <Text style={styles.muted}>
                  No sign-in needed. Anyone holding the complete link can read
                  {kind === 'thread' ? ' and suggest a prompt' : ''}.
                </Text>
                <Choice
                  label="Link lifetime"
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
                <Action
                  variant="outline"
                  label="Create anyone-with-link access"
                  disabled={sharing.busy}
                  onPress={() => void sharing.createLink(Number(seconds))}
                />
              </View>
              {sharing.share.record.grants.map((grant) => (
                <View key={grant.id} style={section}>
                  <Text style={styles.text}>
                    {grant.userId
                      ? `Invited account · ${grant.userId}`
                      : `Anyone with link · Expires ${new Date(grant.expiresAt ?? 0).toLocaleString()}`}
                  </Text>
                  <Field
                    label={grant.userId ? 'Private invitation link' : 'Share link'}
                    value={sharing.link(grant.id)}
                    editable={false}
                  />
                  <Action
                    variant="outline"
                    label="Copy link"
                    onPress={() => void copy(sharing.link(grant.id))}
                  />
                  <Action
                    secondary
                    label="Revoke access"
                    disabled={sharing.busy}
                    onPress={() => void sharing.revoke(grant.id)}
                  />
                </View>
              ))}
              {kind === 'thread' && (
                <View style={section}>
                  <Text accessibilityRole="header" style={heading}>
                    Suggested next prompts · {sharing.suggestions.length}
                  </Text>
                  <Text style={styles.muted}>
                    Suggestions stay private to you. Review and edit one in the composer before
                    sending.
                  </Text>
                  {!sharing.suggestions.length && (
                    <Text style={styles.text}>No suggestions yet.</Text>
                  )}
                  {sharing.suggestions.map((item) => (
                    <View
                      key={item.id}
                      style={{
                        gap: 8,
                        padding: 12,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 12,
                      }}
                    >
                      <Text style={styles.muted}>
                        {item.value?.name || 'Reader'}
                        {item.value && item.value.revision !== sharing.share?.record.packet.revision
                          ? ' · Earlier published version'
                          : ''}
                      </Text>
                      <Text selectable style={styles.text}>
                        {item.value?.text ?? item.error}
                      </Text>
                      {item.value && onUseSuggestion && (
                        <Action
                          label="Use in composer"
                          onPress={() => {
                            if (item.value) onUseSuggestion(item.value.text)
                          }}
                        />
                      )}
                      <Action
                        secondary
                        label="Dismiss"
                        disabled={sharing.busy}
                        onPress={() => void sharing.dismiss(item.id)}
                      />
                    </View>
                  ))}
                </View>
              )}
              {renderFeed?.(sharing.share, sharing.origin, sharing.setShare)}
              <View style={section}>
                <Action
                  secondary
                  label={showDelete ? 'Hide deletion options' : 'Delete hosted copy…'}
                  onPress={() => setShowDelete(!showDelete)}
                />
                {showDelete && (
                  <>
                    <Text style={styles.muted}>
                      Removes the hosted publication and all reader access. Your local content stays
                      available.
                    </Text>
                    <Action
                      secondary
                      label="Delete hosted copy"
                      disabled={sharing.busy}
                      onPress={() =>
                        Alert.alert(
                          'Delete hosted copy?',
                          'This removes invitations, links and suggestions. Your local content stays available. Downloaded copies cannot be recalled.',
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
                  </>
                )}
              </View>
            </>
          )}
          {sharing.hasKey && (
            <View style={section}>
              <Action
                secondary
                label={showRecovery ? 'Hide recovery options' : 'Recovery and another device'}
                onPress={() => {
                  setShowRecovery(!showRecovery)
                  sharing.hideRecovery()
                }}
              />
              {(showRecovery || !!sharing.recovery) && (
                <>
                  <Text style={styles.muted}>
                    Your recovery key grants access to all your encrypted publications. Keep it
                    private and save a backup.
                  </Text>
                  {sharing.recovery ? (
                    <>
                      <Text selectable style={styles.text}>
                        {sharing.recovery}
                      </Text>
                      <Action
                        secondary
                        label="Copy recovery key"
                        onPress={() => void copy(sharing.recovery)}
                      />
                      <Action secondary label="Hide key" onPress={sharing.hideRecovery} />
                    </>
                  ) : (
                    <Action
                      secondary
                      label="Show recovery key"
                      disabled={sharing.busy}
                      onPress={() => void sharing.showRecovery()}
                    />
                  )}
                </>
              )}
            </View>
          )}
          {legacy.map((publication) => (
            <LegacySharing
              key={publication.id}
              origin={account.publicationOrigin}
              publication={publication}
            />
          ))}
        </>
      )}
      {!!(sharing.error || account.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {sharing.error || account.error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {notice}
        </Text>
      )}
      <Action
        secondary
        label={sharing.busy ? 'Working…' : 'Refresh sharing'}
        disabled={sharing.busy}
        onPress={() => void sharing.refresh()}
      />
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
