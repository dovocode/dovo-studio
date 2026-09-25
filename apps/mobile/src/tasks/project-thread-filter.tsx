import { projectMachineGroups } from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { useApplicationState } from '../runtime/application-state'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { RepositoryCheckouts } from '../scm/repository-checkouts'
import { SearchField } from '../ui/field'
import { Icon } from '../ui/icon'
import { IconButton } from '../ui/icon-button'
import { Sheet } from '../ui/sheet'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'

export function ProjectThreadFilter({
  value,
  onChange,
  compact = false,
}: {
  value: string
  onChange: (key: string) => void
  /** Render as a filter chip beside the task status filters. */
  compact?: boolean
}) {
  const { overviews } = useRuntime()
  const [open, setOpen] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  const [settings, setSettings] = useApplicationState<string | null>(null)
  const groups = projectMachineGroups(
    overviews.flatMap((entry) =>
      (entry.snapshot?.workspace.repositories ?? []).map((repository) => ({
        repository,
        runtimeId: entry.profile.id,
        entry,
      })),
    ),
  )
  const selected = groups.find((group) => group.key === value)
  const managed = groups.find((group) => group.key === settings)
  const choose = (key: string) => {
    onChange(key)
    setOpen(false)
    setQuery('')
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Filter threads by project"
        onPress={() => {
          setOpen(true)
          setQuery('')
        }}
        style={({ pressed }) => ({
          minHeight: compact ? 36 : 44,
          flexDirection: 'row',
          gap: compact ? 6 : 8,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
          ...(compact && {
            maxWidth: 200,
            paddingHorizontal: 12,
            borderRadius: 18,
            backgroundColor: selected ? colors.elevated : 'transparent',
          }),
        })}
      >
        <Icon
          name="folder"
          size={compact ? 14 : 17}
          color={selected ? colors.text : colors.muted}
        />
        <Text
          numberOfLines={1}
          style={
            compact
              ? [
                  styles.muted,
                  {
                    flexShrink: 1,
                    fontWeight: '600',
                    color: selected ? colors.text : colors.muted,
                  },
                ]
              : [styles.text, { flex: 1 }]
          }
        >
          {selected?.name ?? 'All projects'}
        </Text>
        <Icon name="down" size={compact ? 10 : 13} color={colors.muted} />
      </Pressable>
      {open && (
        <Sheet title="Projects" onClose={() => setOpen(false)}>
          <SearchField label="Search projects" value={query} onChangeText={setQuery} />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !value }}
            onPress={() => choose('')}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <Icon name="folder" size={20} color={colors.muted} />
            <Text style={[styles.text, { flex: 1 }]}>All projects</Text>
            {!value && <Icon name="check" size={16} color={colors.muted} />}
          </Pressable>
          {groups
            .filter((group) =>
              `${group.name} ${group.identity ?? ''} ${group.entries.map(({ entry }) => entry.profile.name).join(' ')}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map((group) => (
              <View
                key={group.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderRadius: 10,
                  backgroundColor: value === group.key ? colors.elevated : 'transparent',
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: value === group.key }}
                  onPress={() => choose(group.key)}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    flex: 1,
                    minWidth: 0,
                    paddingHorizontal: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Icon name="folder" size={18} color={colors.muted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.text}>
                      {group.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.muted}>
                      {group.identity ?? 'Local repository'}
                    </Text>
                  </View>
                </Pressable>
                <Icon name="device" size={15} color={colors.muted} />
                <IconButton
                  label={`Settings for ${group.name}`}
                  icon="settings"
                  variant="plain"
                  onPress={() => {
                    setOpen(false)
                    setSettings(group.key)
                  }}
                />
              </View>
            ))}
          {!groups.some((group) =>
            `${group.name} ${group.identity ?? ''} ${group.entries.map(({ entry }) => entry.profile.name).join(' ')}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          ) && <Text style={styles.muted}>No matching projects.</Text>}
        </Sheet>
      )}
      {managed && (
        <Sheet title={`${managed.name} settings`} onClose={() => setSettings(null)}>
          {managed.entries.map(({ repository, entry }) => (
            <RuntimeScope key={`${entry.profile.id}:${repository.id}`} runtimeId={entry.profile.id}>
              <View style={{ gap: 8 }}>
                <Text style={styles.text}>
                  {entry.profile.name}
                  {entry.connected ? '' : ' · Offline'}
                </Text>
                <Text style={styles.muted}>{repository.path}</Text>
                {entry.connected ? (
                  <RepositoryCheckouts repository={repository} />
                ) : (
                  <Text style={styles.muted}>
                    Reconnect this machine to edit its project settings.
                  </Text>
                )}
              </View>
            </RuntimeScope>
          ))}
        </Sheet>
      )}
    </>
  )
}
