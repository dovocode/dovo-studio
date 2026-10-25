import { useState } from 'react'
import { Alert, View } from 'react-native'
import { useSharingPeople, type SharingPeople } from '@dovo/studio-core'
import type { PeopleAction } from '@dovo/protocol'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { Action } from '../controls/action'
import { Field } from '../controls/field'
import { Choice } from '../controls/choice'
import { Text } from './text'
import { useTheme } from '../theme'

export function SharingPeoplePanel() {
  const account = useMobileAccount(),
    people = useSharingPeople(account.client)
  return <SharingPeopleManager people={people} userId={account.directory?.user.id ?? ''} />
}
export function SharingPeopleManager({
  people,
  userId,
}: {
  people: SharingPeople
  userId: string
}) {
  const { styles } = useTheme()
  const [friend, setFriend] = useState(''),
    [name, setName] = useState(''),
    [invite, setInvite] = useState<Record<string, string>>({})
  const confirm = (title: string, message: string, action: PeopleAction) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: () => void people.run(action) },
    ])
  const friends = people.directory?.friends.filter((person) => person.status === 'accepted') ?? []
  return (
    <View style={{ gap: 16 }} accessibilityLabel="Friends and organisations">
      <Text style={styles.muted}>
        Add friends once, then choose them when sharing. Organisations let you share with everyone
        in a group. These permissions never grant access to your computers.
      </Text>
      <Text selectable style={styles.muted}>
        Your sharing ID: {userId}
      </Text>
      {!!people.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {people.error}
        </Text>
      )}
      <Text accessibilityRole="header" style={styles.title}>
        Friends
      </Text>
      <Field
        label="Friend sharing ID"
        placeholder="Friend’s sharing ID"
        value={friend}
        onChangeText={setFriend}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={500}
      />
      <Action
        label="Add friend"
        disabled={people.busy || !friend.trim()}
        onPress={() => {
          void people.run({ action: 'requestFriend', userId: friend.trim() }).then((ok) => {
            if (ok) setFriend('')
          })
        }}
      />
      {people.directory?.friends.length === 0 && (
        <Text style={styles.muted}>No friends yet. They’ll receive your request in Studio.</Text>
      )}
      {people.directory?.friends.map((person) => (
        <View key={person.id} style={{ ...styles.card, gap: 8 }}>
          <Text style={styles.title}>{person.name}</Text>
          <Text selectable style={styles.muted}>
            {person.id} ·{' '}
            {person.status === 'accepted'
              ? 'Friend'
              : person.status === 'incoming'
                ? 'Wants to add you'
                : 'Request sent'}
          </Text>
          {person.status === 'incoming' && (
            <Action
              label="Accept friend"
              disabled={people.busy}
              onPress={() => void people.run({ action: 'acceptFriend', userId: person.id })}
            />
          )}
          <Action
            secondary
            label={
              person.status === 'accepted'
                ? 'Remove friend'
                : person.status === 'incoming'
                  ? 'Decline'
                  : 'Cancel request'
            }
            disabled={people.busy}
            onPress={() =>
              confirm(
                'Remove friend or request?',
                person.status === 'accepted'
                  ? 'Existing shared invitations keep working until you remove their access.'
                  : 'This removes the friend request.',
                { action: 'removeFriend', userId: person.id },
              )
            }
          />
        </View>
      ))}
      <Text accessibilityRole="header" style={styles.title}>
        Organisations
      </Text>
      <Field
        label="Organisation name"
        placeholder="Organisation name"
        value={name}
        onChangeText={setName}
        maxLength={100}
      />
      <Action
        label="Create organisation"
        disabled={people.busy || !name.trim()}
        onPress={() => {
          void people.run({ action: 'createOrganization', name: name.trim() }).then((ok) => {
            if (ok) setName('')
          })
        }}
      />
      {people.directory?.organizations.length === 0 && (
        <Text style={styles.muted}>Create an organisation and invite people to join.</Text>
      )}
      {people.directory?.organizations.map((org) => (
        <View
          key={org.id}
          style={{ ...styles.card, gap: 12 }}
          accessibilityLabel={`Organisation ${org.name}`}
        >
          <Text style={styles.title}>
            {org.name} ·{' '}
            {org.status === 'invited' ? 'Invitation' : org.ownerId === userId ? 'Owner' : 'Member'}
          </Text>
          {org.status === 'invited' ? (
            <>
              <Action
                label="Join organisation"
                disabled={people.busy}
                onPress={() =>
                  void people.run({ action: 'acceptOrganization', organizationId: org.id })
                }
              />
              <Action
                secondary
                label="Decline invitation"
                disabled={people.busy}
                onPress={() =>
                  void people.run({ action: 'removeMember', organizationId: org.id, userId })
                }
              />
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                Members can open organisation sharing links. New members gain access; leaving or
                removal stops access. Downloaded copies cannot be recalled.
              </Text>
              {org.members.map((member) => (
                <View key={member.id} style={{ gap: 4 }}>
                  <Text style={styles.text}>
                    {member.name} ·{' '}
                    {member.id === org.ownerId
                      ? 'Owner'
                      : member.status === 'invited'
                        ? 'Invited'
                        : 'Member'}
                  </Text>
                  {org.ownerId === userId && member.id !== userId && (
                    <Action
                      secondary
                      label={`Remove ${member.name}`}
                      disabled={people.busy}
                      onPress={() =>
                        confirm(
                          'Remove member?',
                          `${member.name} will lose access through ${org.name} sharing links.`,
                          { action: 'removeMember', organizationId: org.id, userId: member.id },
                        )
                      }
                    />
                  )}
                </View>
              ))}
              {org.ownerId === userId && (
                <>
                  {!!friends.length && (
                    <Choice
                      label={`Choose friend for ${org.name}`}
                      value={invite[org.id] ?? ''}
                      items={[
                        { id: '', name: 'Choose a friend…' },
                        ...friends.map((person) => ({ id: person.id, name: person.name })),
                      ]}
                      onChange={(value) =>
                        setInvite((previous) => ({ ...previous, [org.id]: value }))
                      }
                      disabled={people.busy}
                    />
                  )}
                  <Field
                    label={`Invite to ${org.name}`}
                    placeholder="Sharing ID"
                    value={invite[org.id] ?? ''}
                    onChangeText={(value) =>
                      setInvite((previous) => ({ ...previous, [org.id]: value }))
                    }
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={500}
                  />
                  <Action
                    label="Invite member"
                    disabled={people.busy || !invite[org.id]?.trim()}
                    onPress={() => {
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
                  />
                </>
              )}
              <Action
                secondary
                label={org.ownerId === userId ? 'Delete organisation' : 'Leave organisation'}
                disabled={people.busy}
                onPress={() =>
                  confirm(
                    org.ownerId === userId ? 'Delete organisation?' : 'Leave organisation?',
                    org.ownerId === userId
                      ? 'All organisation sharing links will stop working. Threads, artifacts and personal invitations remain.'
                      : 'You will lose access through this organisation’s sharing links.',
                    org.ownerId === userId
                      ? { action: 'deleteOrganization', organizationId: org.id }
                      : { action: 'removeMember', organizationId: org.id, userId },
                  )
                }
              />
            </>
          )}
        </View>
      ))}
      <Action
        secondary
        label={people.busy ? 'Updating…' : 'Refresh friends and organisations'}
        disabled={people.busy}
        onPress={() => void people.run()}
      />
    </View>
  )
}
