import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { useSharingPeople, type SharingPeople } from '@dovo/studio-core'
import type { PeopleAction } from '@dovo/protocol'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { usePreviewActive } from '../../tasks/preview/use-preview-active'
import { Action } from '../controls/action'
import { Field } from '../controls/field'
import { Choice } from '../controls/choice'
import { Text } from './text'
import { useTheme } from '../theme'

export function SharingPeoplePanel() {
  const active = usePreviewActive()
  const account = useMobileAccount(),
    people = useSharingPeople(account.client, active)
  return <SharingPeopleManager people={people} userId={account.directory?.user.id ?? ''} />
}
export function SharingPeopleManager({
  people,
  userId,
}: {
  people: SharingPeople
  userId: string
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const [friend, setFriend] = useState(''),
    [name, setName] = useState(''),
    [invite, setInvite] = useState<Record<string, string>>({})
  const confirm = (title: string, message: string, action: PeopleAction) =>
    Alert.alert(title, message, [
      { text: uiText('Cancel'), style: 'cancel' },
      { text: uiText('Confirm'), style: 'destructive', onPress: () => void people.run(action) },
    ])
  const friends = people.directory?.friends.filter((person) => person.status === 'accepted') ?? []
  return (
    <View style={{ gap: 16 }} accessibilityLabel={uiText('Friends and organisations')}>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Add friends once, then choose them when sharing. Organisations let you share with everyone in a group. These permissions never grant access to your computers.'
          }
        </InterfaceText>
      </Text>
      <Text selectable style={styles.muted}>
        <InterfaceText values={{ value0: userId }}>{'Your sharing ID: {value0}'}</InterfaceText>
      </Text>
      {!!people.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {people.error}
        </Text>
      )}
      <Text accessibilityRole="header" style={styles.title}>
        <InterfaceText>{'Friends'}</InterfaceText>
      </Text>
      <Field
        label={uiText('Friend sharing ID')}
        placeholder={uiText('Friend’s sharing ID')}
        value={friend}
        onChangeText={setFriend}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={500}
      />
      <Action
        label={uiText('Add friend')}
        disabled={people.busy || !friend.trim()}
        onPress={() => {
          void people.run({ action: 'requestFriend', userId: friend.trim() }).then((ok) => {
            if (ok) setFriend('')
          })
        }}
      />
      {people.directory?.friends.length === 0 && (
        <Text style={styles.muted}>
          <InterfaceText>{'No friends yet. They’ll receive your request in Studio.'}</InterfaceText>
        </Text>
      )}
      {people.directory?.friends.map((person) => (
        <View key={person.id} style={{ ...styles.card, gap: 8 }}>
          <Text style={styles.title}>{person.name}</Text>
          <Text selectable style={styles.muted}>
            {person.id} ·{' '}
            {person.status === 'accepted'
              ? uiText('Friend')
              : person.status === 'incoming'
                ? uiText('Wants to add you')
                : uiText('Request sent')}
          </Text>
          {person.status === 'incoming' && (
            <Action
              label={uiText('Accept friend')}
              disabled={people.busy}
              onPress={() => void people.run({ action: 'acceptFriend', userId: person.id })}
            />
          )}
          <Action
            destructive={person.status === 'accepted' ? true : false}
            secondary
            label={
              person.status === 'accepted'
                ? uiText('Remove friend')
                : person.status === 'incoming'
                  ? uiText('Decline')
                  : uiText('Cancel request')
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
        <InterfaceText>{'Organisations'}</InterfaceText>
      </Text>
      <Field
        label={uiText('Organisation name')}
        placeholder={uiText('Organisation name')}
        value={name}
        onChangeText={setName}
        maxLength={100}
      />
      <Action
        label={uiText('Create organisation')}
        disabled={people.busy || !name.trim()}
        onPress={() => {
          void people.run({ action: 'createOrganization', name: name.trim() }).then((ok) => {
            if (ok) setName('')
          })
        }}
      />
      {people.directory?.organizations.length === 0 && (
        <Text style={styles.muted}>
          <InterfaceText>{'Create an organisation and invite people to join.'}</InterfaceText>
        </Text>
      )}
      {people.directory?.organizations.map((org) => (
        <View
          key={org.id}
          style={{ ...styles.card, gap: 12 }}
          accessibilityLabel={uiText('Organisation {value0}', { value0: org.name })}
        >
          <Text style={styles.title}>
            {org.name} ·{' '}
            {org.status === 'invited'
              ? uiText('Invitation')
              : org.ownerId === userId
                ? uiText('Owner')
                : uiText('Member')}
          </Text>
          {org.status === 'invited' ? (
            <>
              <Action
                label={uiText('Join organisation')}
                disabled={people.busy}
                onPress={() =>
                  void people.run({ action: 'acceptOrganization', organizationId: org.id })
                }
              />
              <Action
                secondary
                label={uiText('Decline invitation')}
                disabled={people.busy}
                onPress={() =>
                  void people.run({ action: 'removeMember', organizationId: org.id, userId })
                }
              />
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Members can open organisation sharing links. New members gain access; leaving or removal stops access. Downloaded copies cannot be recalled.'
                  }
                </InterfaceText>
              </Text>
              {org.members.map((member) => (
                <View key={member.id} style={{ gap: 4 }}>
                  <Text style={styles.text}>
                    {member.name} ·{' '}
                    {member.id === org.ownerId
                      ? uiText('Owner')
                      : member.status === 'invited'
                        ? uiText('Invited')
                        : uiText('Member')}
                  </Text>
                  {org.ownerId === userId && member.id !== userId && (
                    <Action
                      destructive
                      secondary
                      label={uiText('Remove {value0}', { value0: member.name })}
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
                      label={uiText('Choose friend for {value0}', { value0: org.name })}
                      value={invite[org.id] ?? ''}
                      items={[
                        { id: '', name: uiText('Choose a friend…') },
                        ...friends.map((person) => ({ id: person.id, name: person.name })),
                      ]}
                      onChange={(value) =>
                        setInvite((previous) => ({ ...previous, [org.id]: value }))
                      }
                      disabled={people.busy}
                    />
                  )}
                  <Field
                    label={uiText('Invite to {value0}', { value0: org.name })}
                    placeholder={uiText('Sharing ID')}
                    value={invite[org.id] ?? ''}
                    onChangeText={(value) =>
                      setInvite((previous) => ({ ...previous, [org.id]: value }))
                    }
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={500}
                  />
                  <Action
                    label={uiText('Invite member')}
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
                destructive={org.ownerId === userId ? true : false}
                secondary
                label={
                  org.ownerId === userId
                    ? uiText('Delete organisation')
                    : uiText('Leave organisation')
                }
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
        label={people.busy ? uiText('Updating…') : uiText('Refresh friends and organisations')}
        disabled={people.busy}
        onPress={() => void people.run()}
      />
    </View>
  )
}
