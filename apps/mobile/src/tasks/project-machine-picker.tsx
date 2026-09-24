import { useApplicationState } from '../runtime/application-state'
import { projectMachineGroups } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { View, ScrollView, Pressable } from 'react-native'
import { Text } from '../ui/text'
import { Action } from '../ui/action'
import { SearchField } from '../ui/field'
import { Icon } from '../ui/icon'
import { colors, styles } from '../ui/theme'
import { NewTask } from './new-task'

export function ProjectMachinePicker({
  onCreated,
  onCancel,
}: {
  onCreated: (runtimeId: string, taskId: string) => void
  onCancel: () => void
}) {
  const { overviews } = useRuntime()
  const [selection, setSelection] = useApplicationState<{
    runtimeId: string
    repositoryId: string
  } | null>(null)
  const [expanded, setExpanded] = useApplicationState<string | null>(null)
  const [query, setQuery] = useApplicationState('')
  const groups = projectMachineGroups(
    overviews.flatMap((entry) =>
      (entry.snapshot?.workspace.repositories ?? []).map((repository) => ({
        repository,
        runtimeId: entry.profile.id,
        entry,
      })),
    ),
  )
  if (selection)
    return (
      <RuntimeScope runtimeId={selection.runtimeId}>
        <NewTask
          repositoryId={selection.repositoryId}
          onCancel={() => setSelection(null)}
          onCreated={(id) => onCreated(selection.runtimeId, id)}
        />
      </RuntimeScope>
    )
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Choose project & machine</Text>
      <SearchField label="Search projects and machines" value={query} onChangeText={setQuery} />
      {groups
        .filter((group) =>
          group.entries.some(({ repository, entry }) =>
            `${group.identity ?? ''} ${repository.name} ${repository.path} ${entry.profile.name}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          ),
        )
        .map((group) => {
          const machines = [...new Set(group.entries.map(({ runtimeId }) => runtimeId))]
            .map((id) => group.entries.filter(({ runtimeId }) => runtimeId === id))
            .sort(
              (a, b) =>
                Number(b[0].entry.connected) - Number(a[0].entry.connected) ||
                a[0].entry.profile.name.localeCompare(b[0].entry.profile.name),
            )
          const online = machines.filter((items) => items[0].entry.connected).length
          const open = expanded === group.key || !!query.trim()
          return (
            <View key={group.key} style={[styles.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={group.name}
                onPress={() => setExpanded(open ? null : group.key)}
                style={({ pressed }) => ({
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: pressed ? colors.elevated : 'transparent',
                })}
              >
                <Icon name="folder" size={19} color={colors.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[styles.text, { fontWeight: '600' }]}>
                    {group.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.muted}>
                    {group.identity ?? 'Local repository'}
                  </Text>
                  <Text style={styles.muted}>
                    {online} of {machines.length} {machines.length === 1 ? 'machine' : 'machines'}{' '}
                    online
                  </Text>
                </View>
                <Icon name={open ? 'down' : 'next'} size={14} color={colors.muted} />
              </Pressable>
              {open &&
                machines.map((items) => (
                  <View
                    key={items[0].runtimeId}
                    style={{ borderTopWidth: 0.5, borderTopColor: colors.border }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 8,
                        alignItems: 'center',
                        paddingHorizontal: 14,
                        paddingTop: 12,
                      }}
                    >
                      <Icon name="device" size={15} color={colors.muted} />
                      <Text style={[styles.muted, { flex: 1 }]}>{items[0].entry.profile.name}</Text>
                      <Text style={styles.muted}>
                        {items[0].entry.connected ? 'Online' : 'Offline'}
                      </Text>
                    </View>
                    {items.map(({ repository, entry }) => {
                      const disabled = !entry.connected || !!repository.gitIdentityError
                      return (
                        <Pressable
                          key={repository.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${repository.branch} on ${entry.profile.name}, ${repository.path}`}
                          accessibilityState={{ disabled }}
                          disabled={disabled}
                          onPress={() =>
                            setSelection({
                              runtimeId: entry.profile.id,
                              repositoryId: repository.id,
                            })
                          }
                          style={({ pressed }) => ({
                            minHeight: 54,
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            marginLeft: 23,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            opacity: disabled ? 0.5 : 1,
                            backgroundColor: pressed ? colors.elevated : 'transparent',
                          })}
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={styles.text}>
                              {repository.branch}
                            </Text>
                            <Text numberOfLines={1} style={styles.muted}>
                              {repository.gitIdentityError ?? repository.path}
                            </Text>
                          </View>
                          <Icon name="next" size={13} color={colors.muted} />
                        </Pressable>
                      )
                    })}
                  </View>
                ))}
            </View>
          )
        })}
      {!!groups.length &&
        !groups.some((group) =>
          group.entries.some(({ repository, entry }) =>
            `${group.identity ?? ''} ${repository.name} ${repository.path} ${entry.profile.name}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          ),
        ) && <Text style={styles.muted}>No matching projects or machines.</Text>}
      {!groups.length && (
        <Text style={styles.muted}>Add a project on a connected machine to start a task.</Text>
      )}
      <Action secondary label="Cancel" onPress={onCancel} />
    </ScrollView>
  )
}
