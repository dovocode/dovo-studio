import { useId, useState } from 'react'
import { useSharingPeople, type SharingPeople } from '@dovo/studio-core'
import type { AccountClient, PeopleAction } from '@dovo/protocol'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'

export function SharingPeoplePanel({ client }: { client: AccountClient }) {
  const people = useSharingPeople(client)
  return (
    <SharingPeopleManager people={people} userId={client.snapshot().directory?.user.id ?? ''} />
  )
}

export function SharingPeopleManager({
  people,
  userId,
}: {
  people: SharingPeople
  userId: string
}) {
  const friendListId = useId()
  const [friend, setFriend] = useState(''),
    [name, setName] = useState(''),
    [invite, setInvite] = useState<Record<string, string>>({})
  const [confirmation, setConfirmation] = useState<{ text: string; action: PeopleAction }>()
  const run = (action: PeopleAction) => {
    void people.run(action)
  }
  return (
    <div className="space-y-4 text-sm" aria-label="Friends and organisations">
      <p className="text-xs text-muted-foreground">
        Add friends once, then choose them when sharing. Organisations let you share with everyone
        in a group. These permissions never grant access to your computers.
      </p>
      <p className="break-all text-xs text-muted-foreground">
        Your sharing ID: <span className="select-all">{userId}</span>
      </p>
      {people.error && (
        <p role="alert" className="text-destructive">
          {people.error}
        </p>
      )}
      <section className="space-y-3" aria-label="Friends">
        <h3 className="font-medium">Friends</h3>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void people.run({ action: 'requestFriend', userId: friend.trim() }).then((ok) => {
              if (ok) setFriend('')
            })
          }}
        >
          <Input
            aria-label="Friend sharing ID"
            placeholder="Friend’s sharing ID"
            value={friend}
            maxLength={500}
            onChange={(event) => setFriend(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button disabled={people.busy || !friend.trim()}>Add friend</Button>
        </form>
        {people.directory?.friends.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No friends yet. They’ll receive your request in Studio.
          </p>
        )}
        {people.directory?.friends.map((person) => (
          <div key={person.id} className="space-y-2 rounded-lg border p-3">
            <p className="break-words font-medium">{person.name}</p>
            <p className="break-all text-xs text-muted-foreground">
              {person.id} ·{' '}
              {person.status === 'accepted'
                ? 'Friend'
                : person.status === 'incoming'
                  ? 'Wants to add you'
                  : 'Request sent'}
            </p>
            <div className="flex flex-wrap gap-2">
              {person.status === 'incoming' && (
                <Button
                  size="sm"
                  disabled={people.busy}
                  onClick={() => run({ action: 'acceptFriend', userId: person.id })}
                >
                  Accept friend
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={people.busy}
                onClick={() =>
                  setConfirmation({
                    text:
                      person.status === 'accepted'
                        ? `Remove ${person.name} as a friend? Existing shared invitations keep working until you remove their access.`
                        : 'Remove this friend request?',
                    action: { action: 'removeFriend', userId: person.id },
                  })
                }
              >
                {person.status === 'accepted'
                  ? 'Remove friend'
                  : person.status === 'incoming'
                    ? 'Decline'
                    : 'Cancel request'}
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section className="space-y-3 border-t pt-4" aria-label="Organisations">
        <h3 className="font-medium">Organisations</h3>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void people.run({ action: 'createOrganization', name: name.trim() }).then((ok) => {
              if (ok) setName('')
            })
          }}
        >
          <Input
            aria-label="Organisation name"
            placeholder="Organisation name"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button disabled={people.busy || !name.trim()}>Create</Button>
        </form>
        {people.directory?.organizations.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Create an organisation and invite people to join.
          </p>
        )}
        {people.directory?.organizations.map((org) => (
          <div
            key={org.id}
            className="space-y-3 rounded-lg border p-3"
            aria-label={`Organisation ${org.name}`}
          >
            <p className="font-medium">
              {org.name}{' '}
              <span className="text-xs text-muted-foreground">
                ·{' '}
                {org.status === 'invited'
                  ? 'Invitation'
                  : org.ownerId === userId
                    ? 'Owner'
                    : 'Member'}
              </span>
            </p>
            {org.status === 'invited' ? (
              <div className="flex gap-2">
                <Button
                  disabled={people.busy}
                  onClick={() => run({ action: 'acceptOrganization', organizationId: org.id })}
                >
                  Join organisation
                </Button>
                <Button
                  variant="ghost"
                  disabled={people.busy}
                  onClick={() => run({ action: 'removeMember', organizationId: org.id, userId })}
                >
                  Decline
                </Button>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Members can open organisation sharing links. New members gain access; leaving or
                  removal stops access. Downloaded copies cannot be recalled.
                </p>
                {org.members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-2">
                    <p className="min-w-0 break-words">
                      {member.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        ·{' '}
                        {member.id === org.ownerId
                          ? 'Owner'
                          : member.status === 'invited'
                            ? 'Invited'
                            : 'Member'}
                      </span>
                    </p>
                    {org.ownerId === userId && member.id !== userId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={people.busy}
                        onClick={() =>
                          setConfirmation({
                            text: `Remove ${member.name} from ${org.name}? Their organisation sharing links will stop working.`,
                            action: {
                              action: 'removeMember',
                              organizationId: org.id,
                              userId: member.id,
                            },
                          })
                        }
                      >
                        Remove member
                      </Button>
                    )}
                  </div>
                ))}
                {org.ownerId === userId && (
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void people
                        .run({
                          action: 'inviteMember',
                          organizationId: org.id,
                          userId: invite[org.id]?.trim() ?? '',
                        })
                        .then((ok) => {
                          if (ok) setInvite((previous) => ({ ...previous, [org.id]: '' }))
                        })
                    }}
                  >
                    <Input
                      aria-label={`Invite to ${org.name}`}
                      placeholder="Sharing ID"
                      value={invite[org.id] ?? ''}
                      maxLength={500}
                      onChange={(event) =>
                        setInvite((previous) => ({ ...previous, [org.id]: event.target.value }))
                      }
                      list={friendListId}
                      className="min-w-0 flex-1"
                    />
                    <Button disabled={people.busy || !invite[org.id]?.trim()}>Invite</Button>
                  </form>
                )}
                <Button
                  variant="ghost"
                  disabled={people.busy}
                  onClick={() =>
                    setConfirmation({
                      text:
                        org.ownerId === userId
                          ? `Delete ${org.name}? All organisation sharing links will stop working. Threads, artifacts and personal invitations remain.`
                          : `Leave ${org.name}? You will lose access through its sharing links.`,
                      action:
                        org.ownerId === userId
                          ? { action: 'deleteOrganization', organizationId: org.id }
                          : { action: 'removeMember', organizationId: org.id, userId },
                    })
                  }
                >
                  {org.ownerId === userId ? 'Delete organisation' : 'Leave organisation'}
                </Button>
              </>
            )}
          </div>
        ))}
      </section>
      <datalist id={friendListId}>
        {people.directory?.friends
          .filter((friend) => friend.status === 'accepted')
          .map((friend) => (
            <option key={friend.id} value={friend.id}>
              {friend.name}
            </option>
          ))}
      </datalist>
      {confirmation && (
        <div
          className="space-y-2 rounded-lg border p-3"
          role="group"
          aria-label="Confirm people change"
        >
          <p>{confirmation.text}</p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={people.busy}
              onClick={() => {
                void people.run(confirmation.action).then((ok) => {
                  if (ok) setConfirmation(undefined)
                })
              }}
            >
              Confirm
            </Button>
            <Button
              variant="outline"
              disabled={people.busy}
              onClick={() => setConfirmation(undefined)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <Button size="sm" variant="ghost" disabled={people.busy} onClick={() => void people.run()}>
        {people.busy ? 'Updating…' : 'Refresh friends and organisations'}
      </Button>
    </div>
  )
}
