import { useId, useState, type ReactNode } from 'react'
import { Schema } from 'effect'
import { useEncryptedSharing, useSharingPeople, type SharingRuntime } from '@dovo/studio-core'
import { LockKeyhole, Link2, Users } from 'lucide-react'
import {
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
import { SharingPeopleManager } from '@dovo/studio-ui/sharing-people'
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
  legacy = [],
  renderFeed,
}: {
  client: AccountClient
  sourceId: string
  kind: 'artifact' | 'thread'
  content?: SharedContent
  runtime?: SharingRuntime
  renderFeed?: (share: OpenShare, origin: string, update: (share: OpenShare) => void) => ReactNode
  legacy?: ArtifactSourcePublication[]
}) {
  const sharing = useEncryptedSharing({ client, sourceId, kind, content, runtime })
  const contacts = useSharingPeople(client)
  const organizationName = (id: string) =>
    contacts.directory?.organizations.find((org) => org.id === id)?.name ?? id
  const personName = (id: string) =>
    contacts.directory?.friends.find((person) => person.id === id)?.name ?? id
  const [recipient, setRecipient] = useState(''),
    [restore, setRestore] = useState(''),
    [seconds, setSeconds] = useState('604800')
  const [notice, setNotice] = useState(''),
    [copyError, setCopyError] = useState(''),
    [removing, setRemoving] = useState<string>(),
    [confirmDelete, setConfirmDelete] = useState(false)
  const id = useId(),
    account = client.snapshot()
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
  const copy = async (text: string) => {
    setNotice('')
    setCopyError('')
    try {
      await copyTextToClipboard(text)
      setNotice('Link copied')
    } catch {
      setCopyError('Could not copy. Open Advanced to select and copy the link.')
    }
  }
  const disclosure =
    'cursor-pointer rounded-md font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  return (
    <div
      className="min-w-0 space-y-5 text-sm"
      aria-label="Sharing settings"
      aria-busy={sharing.busy}
    >
      {!account.directory ? (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            Sign in to manage sharing. People you share a link with can read without an account.
          </p>
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
        </div>
      ) : (
        <>
          {!sharing.loaded && !sharing.error && <p role="status">Loading sharing settings…</p>}
          {needsRecovery && (
            <section
              className="space-y-3 rounded-xl border p-3"
              aria-label="Restore sharing access"
            >
              <h2 className="font-medium">Restore sharing on this device</h2>
              <p className="text-muted-foreground">
                Enter your recovery key to manage your existing shared content.
              </p>
              <label className="block space-y-1">
                Recovery key
                <Input
                  type="password"
                  autoComplete="off"
                  value={restore}
                  onChange={(event) => setRestore(event.target.value)}
                />
              </label>
              <Button
                disabled={sharing.busy || !restore.trim()}
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
          <section className="space-y-3" aria-label="People with access">
            {!!contacts.directory &&
              (contacts.directory.friends.some((person) => person.status === 'accepted') ||
                contacts.directory.organizations.some((org) => org.status === 'member')) && (
                <Select
                  value=""
                  disabled={unavailable || contacts.busy}
                  onValueChange={(value) => {
                    const [type, ...parts] = value.split(':')
                    const id = parts.join(':')
                    void (type === 'organization'
                      ? sharing.inviteOrganization(id)
                      : sharing.invite(id))
                  }}
                >
                  <SelectTrigger aria-label="Add friends or organisations">
                    <SelectValue placeholder="Add friends or organisations" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.directory.friends
                      .filter(
                        (person) =>
                          person.status === 'accepted' &&
                          !people.some((grant) => grant.userId === person.id),
                      )
                      .map((person) => (
                        <SelectItem key={person.id} value={'friend:' + person.id}>
                          {person.name}
                        </SelectItem>
                      ))}
                    {contacts.directory.organizations
                      .filter(
                        (org) =>
                          org.status === 'member' &&
                          !people.some((grant) => grant.organizationId === org.id),
                      )
                      .map((org) => (
                        <SelectItem key={org.id} value={'organization:' + org.id}>
                          {org.name} (organisation)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}

            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (recipient.trim() && !unavailable)
                  void sharing.invite(recipient.trim()).then((ok) => {
                    if (ok) {
                      setRecipient('')
                      setNotice('Person added. Copy their invitation link to send it to them.')
                    }
                  })
              }}
            >
              <Input
                aria-label="Add people by sharing ID"
                placeholder="Add people by sharing ID"
                value={recipient}
                maxLength={500}
                onChange={(event) => setRecipient(event.target.value)}
                disabled={unavailable}
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={unavailable || !recipient.trim()}>
                Add
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Use their sharing ID from Studio. You send the invitation link yourself.
            </p>
            <div className="flex items-center gap-3 py-1">
              <Users aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{account.directory.user.name} (you)</p>
                <p className="text-xs text-muted-foreground">Owner</p>
              </div>
            </div>
            {people.map((grant) => (
              <div
                key={grant.id}
                className="space-y-2 border-t pt-3"
                aria-label={`Access for ${grant.userId ?? grant.organizationId}`}
              >
                {grant.organizationId && (
                  <p className="text-xs text-muted-foreground">
                    Organisation · access follows membership
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 break-all font-medium">
                    {grant.organizationId
                      ? organizationName(grant.organizationId)
                      : personName(grant.userId ?? '')}
                  </p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {kind === 'thread' ? 'Reader · Can suggest' : 'Reader'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sharing.busy}
                    onClick={() => void copy(sharing.link(grant.id))}
                  >
                    Copy invitation link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={sharing.busy}
                    onClick={() => setRemoving(grant.id)}
                  >
                    Remove access
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <section className="space-y-3 border-t pt-4" aria-label="General access">
            <h2 className="font-medium">General access</h2>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                {activeLink ? (
                  <Link2 aria-hidden="true" className="size-5" />
                ) : (
                  <LockKeyhole aria-hidden="true" className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Select
                  value={activeLink ? 'anyone' : 'restricted'}
                  disabled={unavailable}
                  onValueChange={(value) => {
                    setNotice('')
                    if (value === 'restricted') setRemoving('links')
                    else void sharing.setLinkAccess(true, Number(seconds))
                  }}
                >
                  <SelectTrigger aria-label="General access">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restricted">Restricted</SelectItem>
                    <SelectItem value="anyone">Anyone with the link</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {activeLink
                    ? `Anyone with the link can read${kind === 'thread' ? ' and suggest a prompt' : ''}. No sign-in required.`
                    : 'Only people and organisations you add can open their invitation links.'}
                </p>
                {activeLink && (
                  <p className="text-xs text-muted-foreground">
                    Link expires {new Date(activeLink.expiresAt ?? 0).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {kind === 'thread'
                ? 'New replies update automatically; tools, files and drafts stay private.'
                : 'Shares this saved version and its files. Later edits stay private.'}
            </p>
            {!!sharing.share &&
              kind === 'thread' &&
              (sharing.share.record.paused || !runtime || sharing.sync?.enabled === false) && (
                <p role="status" className="rounded-lg bg-muted p-2 text-xs">
                  {sharing.share.record.paused
                    ? 'Updates paused. Readers see the last published messages.'
                    : 'Waiting for the source computer. Readers see the last published messages.'}
                </p>
              )}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Button
              disabled={unavailable || !activeLink}
              onClick={() => {
                if (activeLink) void copy(sharing.link(activeLink.id))
              }}
            >
              <Link2 aria-hidden="true" className="size-4" />
              Copy link
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              End-to-end encrypted
            </p>
          </div>
          {!activeLink && (
            <p className="text-xs text-muted-foreground">
              Choose Anyone with the link to copy a general link.
            </p>
          )}
          {!!legacy.length && (
            <p className="text-xs text-muted-foreground">
              An older unencrypted copy is still hosted. Manage it in Advanced.
            </p>
          )}
          {!sharing.share && kind === 'thread' && !runtime && (
            <p className="text-xs text-muted-foreground">
              Reconnect to the source computer to share this thread.
            </p>
          )}
          <details className="border-t pt-3">
            <summary className={disclosure}>Friends and organisations</summary>
            <div className="pt-4">
              <SharingPeopleManager people={contacts} userId={account.directory.user.id} />
            </div>
          </details>
          <details
            className="border-t pt-3"
            onToggle={(event) => {
              if (!event.currentTarget.open) sharing.hideRecovery()
            }}
          >
            <summary className={disclosure}>Advanced</summary>
            <div className="space-y-4 pt-4">
              <details>
                <summary className={disclosure}>Review shared content</summary>
                <div className="space-y-3 pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unavailable || (kind === 'thread' && !runtime)}
                    onClick={() => void sharing.review()}
                  >
                    Load content preview
                  </Button>
                  {sharing.preview && (
                    <pre
                      aria-label="Content to share"
                      className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs"
                    >
                      {sharing.preview.kind === 'thread'
                        ? sharing.preview.messages
                            .map(
                              (message) =>
                                `${message.role === 'user' ? 'User' : 'Agent'}\n${message.text}`,
                            )
                            .join('\n\n')
                        : `${sharing.preview.artifact.title}\n\n${sharing.preview.artifact.content}${sharing.preview.artifact.files?.map((file) => `\n\n${file.path}\n${file.content}`).join('') ?? ''}`}
                    </pre>
                  )}
                </div>
              </details>
              <div className="space-y-2">
                <p id={id} className="font-medium">
                  New link lifetime
                </p>
                <p className="text-xs text-muted-foreground">
                  Used when you enable link access or create another link. Existing links keep their
                  expiry.
                </p>
                <Select value={seconds} onValueChange={setSeconds} disabled={sharing.busy}>
                  <SelectTrigger aria-labelledby={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3600">1 hour</SelectItem>
                    <SelectItem value="86400">1 day</SelectItem>
                    <SelectItem value="604800">7 days</SelectItem>
                    <SelectItem value="2592000">30 days</SelectItem>
                  </SelectContent>
                </Select>
                {!!activeLink && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unavailable}
                    onClick={() => void sharing.createLink(Number(seconds))}
                  >
                    Create another link
                  </Button>
                )}
              </div>
              {sharing.share?.record.grants.map((grant) => (
                <div key={grant.id} className="space-y-2 rounded-xl border p-3">
                  <p className="break-all text-xs">
                    {grant.organizationId
                      ? `Organisation · ${organizationName(grant.organizationId)}`
                      : grant.userId
                        ? `Invitation · ${grant.userId}`
                        : `${(grant.expiresAt ?? 0) > Date.now() ? 'Expires' : 'Expired'} · ${new Date(grant.expiresAt ?? 0).toLocaleString()}`}
                  </p>
                  <Input
                    readOnly
                    aria-label={
                      grant.userId || grant.organizationId
                        ? 'Private invitation link'
                        : 'Share link'
                    }
                    value={sharing.link(grant.id)}
                    className="font-mono text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        sharing.busy ||
                        (!grant.userId &&
                          !grant.organizationId &&
                          (grant.expiresAt ?? 0) <= Date.now())
                      }
                      onClick={() => void copy(sharing.link(grant.id))}
                    >
                      Copy this link
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={sharing.busy}
                      onClick={() => setRemoving(grant.id)}
                    >
                      Remove this link
                    </Button>
                  </div>
                </div>
              ))}
              {sharing.share && kind === 'thread' && (
                <div className="space-y-2">
                  <p className="font-medium">Automatic updates</p>
                  <p className="text-xs text-muted-foreground">
                    Pausing keeps the current hosted copy available. Suggestions appear inline in
                    your thread.
                  </p>
                  <Button
                    variant="outline"
                    disabled={sharing.busy || (!runtime && sharing.share.record.paused)}
                    onClick={() =>
                      void (sharing.share?.record.paused ? sharing.resume() : sharing.pause())
                    }
                  >
                    {sharing.share.record.paused
                      ? 'Resume automatic updates'
                      : 'Pause automatic updates'}
                  </Button>
                  {!sharing.share.record.paused && sharing.sync?.enabled === false && runtime && (
                    <Button
                      variant="outline"
                      disabled={sharing.busy}
                      onClick={() => void sharing.resume()}
                    >
                      Reconnect automatic updates
                    </Button>
                  )}
                  {!runtime && (
                    <p className="text-xs text-muted-foreground">
                      Reconnect to the source computer to start or resume updates.
                    </p>
                  )}
                  {!!sharing.sync?.error && (
                    <p role="alert" className="text-destructive">
                      {sharing.sync.error}
                    </p>
                  )}
                </div>
              )}
              {sharing.share && renderFeed?.(sharing.share, sharing.origin, sharing.setShare)}
              {sharing.hasKey && (
                <details
                  open={sharing.recovery ? true : undefined}
                  onToggle={(event) => {
                    if (!event.currentTarget.open) sharing.hideRecovery()
                  }}
                >
                  <summary className={disclosure}>Recovery and another device</summary>
                  <div className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      Your key is saved securely on this device. Back it up to a password manager to
                      restore sharing on another device. It unlocks all your shared content.
                    </p>
                    {sharing.recovery ? (
                      <>
                        <Textarea
                          readOnly
                          aria-label="Sharing recovery key"
                          value={sharing.recovery}
                        />
                        <Button
                          variant="outline"
                          onClick={() =>
                            void copyTextToClipboard(sharing.recovery).then(
                              () => setNotice('Recovery key copied'),
                              () =>
                                setCopyError('Could not copy. Select and copy the key manually.'),
                            )
                          }
                        >
                          Copy recovery key
                        </Button>
                        <Button variant="ghost" onClick={sharing.hideRecovery}>
                          Hide key
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={sharing.busy}
                        onClick={() => void sharing.showRecovery()}
                      >
                        Show recovery key
                      </Button>
                    )}
                  </div>
                </details>
              )}
              <details>
                <summary className={disclosure}>Account and destination</summary>
                <div className="space-y-2 pt-3 text-xs text-muted-foreground">
                  <p>Publishing as {account.directory.user.name}</p>
                  <p className="break-all">
                    Your sharing ID: <span className="select-all">{account.directory.user.id}</span>
                  </p>
                  <p className="break-all">Hosted at {sharing.origin || 'Loading…'}</p>
                </div>
              </details>
              {sharing.share && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    Delete the hosted copy to stop all sharing. Your local {kind} stays available.
                    Saved reader copies cannot be recalled.
                  </p>
                  {confirmDelete ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        disabled={sharing.busy}
                        onClick={() => {
                          void sharing.remove().then((ok) => {
                            if (ok) setConfirmDelete(false)
                          })
                        }}
                      >
                        Confirm delete hosted copy
                      </Button>
                      <Button
                        variant="outline"
                        disabled={sharing.busy}
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={sharing.busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete hosted copy…
                    </Button>
                  )}
                </div>
              )}
              {legacy.map((publication) => (
                <LegacySharing
                  key={publication.id}
                  client={client}
                  origin={account.publicationOrigin}
                  publication={publication}
                />
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={sharing.busy}
                onClick={() => void sharing.refresh()}
              >
                Refresh sharing
              </Button>
            </div>
          </details>
          <Dialog
            open={!!removing}
            onOpenChange={(open) => {
              if (!open) setRemoving(undefined)
            }}
          >
            <DialogContent>
              <DialogTitle>
                {removing === 'links' ? 'Restrict link access?' : 'Remove this access?'}
              </DialogTitle>
              <DialogDescription>
                {removing === 'links'
                  ? 'All anyone-with-link URLs will stop working. People you invited keep access.'
                  : 'This person or link will lose access. Other readers keep access.'}{' '}
                Saved copies cannot be recalled.
                {kind === 'artifact'
                  ? ' A live data feed must be approved again after access changes.'
                  : ''}
              </DialogDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={sharing.busy}
                  onClick={() => setRemoving(undefined)}
                >
                  Keep access
                </Button>
                <Button
                  variant="destructive"
                  disabled={sharing.busy}
                  onClick={() => {
                    if (removing)
                      void (
                        removing === 'links'
                          ? sharing.setLinkAccess(false)
                          : sharing.revoke(removing)
                      ).then((ok) => {
                        if (ok) setRemoving(undefined)
                      })
                  }}
                >
                  Confirm remove access
                </Button>
              </div>
              {sharing.error && (
                <p role="alert" className="text-destructive">
                  {sharing.error}
                </p>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
      {!removing && !!(sharing.error || account.error || copyError) && (
        <p role="alert" className="text-destructive">
          {sharing.error || account.error || copyError}
        </p>
      )}
      {!!notice && (
        <p role="status" className="text-muted-foreground">
          {notice}
        </p>
      )}
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
