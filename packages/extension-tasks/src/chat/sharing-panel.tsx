import { useId, useState, type ReactNode } from 'react'
import { Schema } from 'effect'
import { useEncryptedSharing, type SharingRuntime } from '@dovo/studio-core'
import { LockKeyhole, Link2, Users, MessageSquare } from 'lucide-react'
import {
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@dovo/studio-ui'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import {
  artifactAccessSchema,
  decode,
  mutableStruct,
  type AccountClient,
  type ArtifactSourcePublication,
  type SharedContent,
  type OpenShare,
} from '@dovo/protocol'

export function SharingPanel({
  client,
  sourceId,
  kind,
  content,
  runtime,
  onUseSuggestion,
  legacy = [],
  renderFeed,
}: {
  client: AccountClient
  sourceId: string
  kind: 'artifact' | 'thread'
  content?: SharedContent
  runtime?: SharingRuntime
  onUseSuggestion?: (text: string) => void
  renderFeed?: (share: OpenShare, origin: string, update: (share: OpenShare) => void) => ReactNode
  legacy?: ArtifactSourcePublication[]
}) {
  const sharing = useEncryptedSharing({ client, sourceId, kind, content, runtime })
  const [recipient, setRecipient] = useState(''),
    [restore, setRestore] = useState(''),
    [seconds, setSeconds] = useState(604800)
  const [copied, setCopied] = useState(''),
    [copyError, setCopyError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false)
  const lifetimeId = useId()
  const account = client.snapshot()
  const copy = async (text: string) => {
    try {
      await copyTextToClipboard(text)
      setCopied('Copied')
      setCopyError('')
    } catch {
      setCopyError('Could not copy. Select and copy the link manually.')
    }
  }
  const section = 'min-w-0 space-y-3 rounded-xl border border-border bg-card p-4'
  const disclosure =
    'cursor-pointer rounded-md font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  return (
    <div
      className="min-w-0 space-y-4 text-sm"
      aria-label="Sharing settings"
      aria-busy={sharing.busy}
    >
      <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">End-to-end encrypted</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Only you and your readers can decrypt shared content. Review messages and files for
            secrets before sharing.
          </p>
        </div>
      </div>
      {!!sharing.origin && (
        <p className="break-all text-xs text-muted-foreground">Hosted at {sharing.origin}</p>
      )}
      {!account.directory ? (
        <>
          <Button disabled={account.busy} onClick={() => void client.signIn()}>
            {account.busy ? 'Signing in…' : 'Sign in to publish'}
          </Button>
          {account.login && (
            <p>
              Compare sign-in code: <code>{account.login.code}</code>{' '}
              <Button variant="ghost" onClick={client.cancel}>
                Cancel sign-in
              </Button>
            </p>
          )}
        </>
      ) : (
        <>
          <details className="text-xs text-muted-foreground">
            <summary className={disclosure}>Publishing as {account.directory.user.name}</summary>
            <p className="mt-2 break-all">
              Your sharing ID: <span className="select-all">{account.directory.user.id}</span>
            </p>
          </details>
          {!sharing.loaded && !sharing.error && <p role="status">Loading sharing settings…</p>}
          <fieldset disabled={sharing.busy || !sharing.loaded} className="space-y-4">
            {!sharing.hasKey && (
              <section className={section}>
                <h2 className="font-medium">Set up encrypted sharing</h2>
                <p>
                  Keep your recovery key in a password manager. Use it to restore access on another
                  device. Signing in alone cannot decrypt your publications.
                </p>
                {!sharing.hasShares && (
                  <Button onClick={() => void sharing.createKey()}>
                    Create sharing recovery key
                  </Button>
                )}
                {sharing.hasShares && (
                  <p>
                    Your account already has encrypted publications. Restore their recovery key.
                  </p>
                )}
                <label className="block">
                  Recovery key
                  <Input
                    autoComplete="off"
                    type="password"
                    value={restore}
                    onChange={(event) => setRestore(event.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={!restore.trim()}
                  onClick={() => {
                    void sharing.restore(restore).then((ok) => {
                      if (ok) setRestore('')
                    })
                  }}
                >
                  Restore sharing key
                </Button>
              </section>
            )}
            {sharing.hasKey && !sharing.share && (
              <section className={section}>
                <h2 className="font-medium">
                  Publish private {kind === 'thread' ? 'thread' : 'artifact'}
                </h2>
                {kind === 'thread' && (
                  <p>
                    New user and agent messages will be shared automatically. Tool logs, attachment
                    contents and unsent drafts are excluded.
                  </p>
                )}
                <Button variant="outline" onClick={() => void sharing.review()}>
                  Review content to share
                </Button>
                {sharing.preview && (
                  <>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted p-3 text-xs">
                      {sharing.preview.kind === 'thread'
                        ? sharing.preview.messages
                            .map(
                              (message) =>
                                `${message.role === 'user' ? 'User' : 'Agent'}\n${message.text}`,
                            )
                            .join('\n\n')
                        : `${sharing.preview.artifact.title}\n\n${sharing.preview.artifact.content}${sharing.preview.artifact.files?.map((file) => `\n\n${file.path}\n${file.content}`).join('') ?? ''}`}
                    </pre>
                    <Button onClick={() => void sharing.publish()}>
                      {kind === 'thread'
                        ? 'Publish and enable automatic updates'
                        : 'Publish encrypted private copy'}
                    </Button>
                  </>
                )}
              </section>
            )}
            {sharing.share && (
              <>
                <section className={section}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-medium">Shared · End-to-end encrypted</h2>
                    <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                      {kind === 'thread'
                        ? sharing.share.record.paused
                          ? 'Paused'
                          : 'Automatic updates'
                        : 'Private copy'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last published {new Date(sharing.share.record.updatedAt).toLocaleString()}
                  </p>
                  {kind === 'thread' && (
                    <>
                      <p>
                        {sharing.share.record.paused
                          ? 'Automatic updates paused'
                          : 'Automatic updates enabled'}
                        {sharing.sync && !sharing.sync.enabled && !sharing.share.record.paused
                          ? ' · Source is not syncing'
                          : ''}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void (sharing.share?.record.paused ? sharing.resume() : sharing.pause())
                        }
                      >
                        {sharing.share.record.paused
                          ? 'Resume automatic updates'
                          : 'Pause automatic updates'}
                      </Button>
                      {sharing.sync?.error && <p role="alert">{sharing.sync.error}</p>}
                    </>
                  )}
                </section>
                <section className={section}>
                  <h2 className="flex items-center gap-2 font-medium">
                    <Users aria-hidden="true" className="size-4 text-muted-foreground" />
                    Private invitations
                  </h2>
                  <p className="text-muted-foreground">
                    Invite an exact sharing ID, then send that person their invitation link. They
                    need both the link and the invited account.
                  </p>
                  <label className="block">
                    Recipient sharing ID
                    <Input
                      value={recipient}
                      maxLength={500}
                      onChange={(event) => setRecipient(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={!recipient.trim()}
                    onClick={() => {
                      void sharing.invite(recipient.trim()).then((ok) => {
                        if (ok) setRecipient('')
                      })
                    }}
                  >
                    Invite account
                  </Button>
                </section>
                <section className={section}>
                  <h2 className="flex items-center gap-2 font-medium">
                    <Link2 aria-hidden="true" className="size-4 text-muted-foreground" />
                    Anyone with the link
                  </h2>
                  <p className="text-muted-foreground">
                    No sign-in needed. Anyone holding the complete link can read
                    {kind === 'thread' ? ' and suggest a prompt' : ''} until it expires or is
                    revoked.
                  </p>
                  <div className="space-y-2">
                    <p id={lifetimeId} className="text-xs font-medium">
                      Link lifetime
                    </p>
                    <Select
                      value={String(seconds)}
                      onValueChange={(value) => setSeconds(Number(value))}
                      disabled={sharing.busy}
                    >
                      <SelectTrigger aria-labelledby={lifetimeId}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3600">1 hour</SelectItem>
                        <SelectItem value="86400">1 day</SelectItem>
                        <SelectItem value="604800">7 days</SelectItem>
                        <SelectItem value="2592000">30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" onClick={() => void sharing.createLink(seconds)}>
                    Create anyone-with-link access
                  </Button>
                </section>
                {!!sharing.share.record.grants.length && (
                  <section className={section} aria-label="People and links">
                    <h2 className="font-medium">People and links</h2>
                    {sharing.share.record.grants.map((grant) => (
                      <div key={grant.id} className="space-y-2 rounded-xl border p-3">
                        <p className="break-all">
                          {grant.userId
                            ? `Invited account · ${grant.userId}`
                            : `Anyone with link · ${new Date(grant.expiresAt ?? 0).toLocaleString()}`}
                        </p>
                        <Input
                          className="min-w-0 font-mono text-xs"
                          readOnly
                          aria-label={grant.userId ? 'Private invitation link' : 'Share link'}
                          value={sharing.link(grant.id)}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void copy(sharing.link(grant.id))}
                          >
                            Copy link
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void sharing.revoke(grant.id)}
                          >
                            Revoke access
                          </Button>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {kind === 'thread' && (
                  <section className={section}>
                    <h2 className="flex items-center gap-2 font-medium">
                      <MessageSquare aria-hidden="true" className="size-4 text-muted-foreground" />
                      Suggested next prompts · {sharing.suggestions.length}
                    </h2>
                    <p className="text-muted-foreground">
                      Suggestions stay private to you. Use one in the composer to review and edit it
                      before sending.
                    </p>
                    {!sharing.suggestions.length && (
                      <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                        No suggestions yet. Readers can suggest a next prompt from the shared
                        thread.
                      </p>
                    )}
                    {sharing.suggestions.map((item) => (
                      <div key={item.id} className="space-y-2 rounded-xl border p-3">
                        <p className="text-xs text-muted-foreground">
                          {item.value?.name || 'Reader'}
                          {item.value &&
                          item.value.revision !== sharing.share?.record.packet.revision
                            ? ' · Suggested on an earlier published version'
                            : ''}
                        </p>
                        <p className="whitespace-pre-wrap break-words">
                          {item.value?.text ?? item.error}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {item.value && onUseSuggestion && (
                            <Button
                              size="sm"
                              onClick={() => {
                                if (item.value) onUseSuggestion(item.value.text)
                              }}
                            >
                              Use in composer
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void sharing.dismiss(item.id)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {renderFeed?.(sharing.share, sharing.origin, sharing.setShare)}
                <details className={section}>
                  <summary className={disclosure}>Delete hosted copy</summary>
                  <p className="text-muted-foreground">
                    Removes the publication, invitations, links and suggestions. Your local {kind}{' '}
                    stays available. Downloaded copies cannot be recalled.
                  </p>
                  {confirmDelete ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="destructive" onClick={() => void sharing.remove()}>
                        Confirm delete hosted copy
                      </Button>
                      <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                      Delete hosted copy…
                    </Button>
                  )}
                </details>
              </>
            )}
            {sharing.hasKey && (
              <details className={section} open={sharing.recovery ? true : undefined}>
                <summary className={disclosure}>Recovery and another device</summary>
                <p className="my-3">
                  Your recovery key grants access to all your encrypted publications. Keep it
                  private and store a backup. Enter it in Studio on your other device to restore
                  access.
                </p>
                {sharing.recovery ? (
                  <>
                    <Textarea readOnly aria-label="Sharing recovery key" value={sharing.recovery} />
                    <Button variant="outline" onClick={() => void copy(sharing.recovery)}>
                      Copy recovery key
                    </Button>
                    <Button variant="ghost" onClick={sharing.hideRecovery}>
                      Hide key
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => void sharing.showRecovery()}>
                    Show recovery key
                  </Button>
                )}
              </details>
            )}
          </fieldset>
          {legacy.map((publication) => (
            <LegacySharing
              key={publication.id}
              client={client}
              origin={account.publicationOrigin}
              publication={publication}
            />
          ))}
        </>
      )}
      {(sharing.error || account.error || copyError) && (
        <p role="alert" className="text-destructive">
          {sharing.error || account.error || copyError}
        </p>
      )}
      {copied && (
        <p role="status" className="text-muted-foreground">
          {copied}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={sharing.busy}
        onClick={() => void sharing.refresh()}
      >
        {sharing.busy ? 'Working…' : 'Refresh sharing'}
      </Button>
    </div>
  )
}

function LegacySharing({
  client,
  origin,
  publication,
}: {
  client: AccountClient
  origin: string
  publication: ArtifactSourcePublication
}) {
  const [access, setAccess] = useState<typeof artifactAccessSchema.Type | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [recipient, setRecipient] = useState(''),
    [created, setCreated] = useState(''),
    [confirm, setConfirm] = useState(false),
    [deleted, setDeleted] = useState(false)
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
    <section className="space-y-3 border-t pt-4" aria-label="Existing unencrypted publication">
      <h2 className="font-medium">
        Existing hosted v{publication.revision} · Not end-to-end encrypted
      </h2>
      <p className="text-muted-foreground">
        Publishing an encrypted copy creates new links. Delete this previous copy to remove its
        content and live feed from hosting. Backups follow server retention.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <Button variant="outline" onClick={() => void act(refresh)}>
          Manage existing access
        </Button>
        {access && (
          <>
            <label className="block">
              Recipient sharing ID
              <Input value={recipient} onChange={(event) => setRecipient(event.target.value)} />
            </label>
            <Button
              variant="outline"
              disabled={!recipient.trim()}
              onClick={() =>
                void act(async () => {
                  await client.artifactAccessRequest(origin, path + '/invites', 'POST', {
                    userId: recipient.trim(),
                  })
                  setRecipient('')
                  await refresh()
                })
              }
            >
              Invite account to existing copy
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void act(async () => {
                  const value = decode(
                    mutableStruct({ url: Schema.String }),
                    await client.artifactAccessRequest(origin, path + '/links', 'POST', {
                      seconds: 604800,
                    }),
                  )
                  setCreated(value.url)
                  await refresh()
                })
              }
            >
              Create link to existing copy
            </Button>
            {created && (
              <Input readOnly aria-label="Existing artifact share link" value={created} />
            )}
            {access.invites.map((invite) => (
              <div className="flex items-center gap-2" key={invite.userId}>
                <span className="break-all">{invite.userId}</span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void act(async () => {
                      await client.artifactAccessRequest(
                        origin,
                        path + '/invites',
                        'DELETE',
                        invite,
                      )
                      await refresh()
                    })
                  }
                >
                  Remove access
                </Button>
              </div>
            ))}
            {access.links.map((link) => (
              <div className="flex items-center gap-2" key={link.id}>
                <span>Expires {new Date(link.expiresAt).toLocaleString()}</span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void act(async () => {
                      await client.artifactAccessRequest(
                        origin,
                        path + '/links/' + link.id,
                        'DELETE',
                      )
                      await refresh()
                    })
                  }
                >
                  Revoke link
                </Button>
              </div>
            ))}
            {access.feed && (
              <Button
                variant="outline"
                onClick={() =>
                  void act(async () => {
                    if (access.feed)
                      await client.stopArtifactFeed(publication.id, origin, access.feed.generation)
                    await refresh()
                  })
                }
              >
                Stop existing live feed
              </Button>
            )}
          </>
        )}
        {confirm ? (
          <Button
            variant="destructive"
            onClick={() =>
              void act(async () => {
                await client.artifactAccessRequest(origin, path, 'DELETE')
                setDeleted(true)
                await client.refreshPublications()
              })
            }
          >
            Confirm delete unencrypted hosted copy
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setConfirm(true)}>
            Delete unencrypted hosted copy…
          </Button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
