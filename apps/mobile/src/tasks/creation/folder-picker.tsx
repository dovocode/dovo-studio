import type { Repository } from '@dovo/protocol'
import { Pressable, View } from 'react-native'
import { useApplicationState } from '../../runtime/state/application-state'
import { Sheet } from '../../ui/layout/sheet'
import { SearchField } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { colors, styles } from '../../ui/theme'
import { AddProject } from '../../screens/repositories'

export function FolderPicker({
  repositories,
  value,
  disabled = false,
  onChange,
  onAdded,
}: {
  repositories: readonly Repository[]
  value: string
  disabled?: boolean
  onChange: (id: string, repository?: Repository) => void
  onAdded?: (repository: Repository) => void
}) {
  const [open, setOpen] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  const [adding, setAdding] = useApplicationState<'local' | 'github' | null>(null)
  const selected = repositories.find((repository) => repository.id === value)
  const label = (repository: Repository) =>
    repository.kind === 'scratch' ? 'Chat' : repository.name
  const matches = repositories.filter((repository) =>
    `${label(repository)} ${repository.path}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Folder"
        accessibilityValue={{ text: selected ? label(selected) : 'Choose folder' }}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setQuery('')
          setOpen(true)
        }}
        style={[
          styles.row,
          {
            padding: 12,
            minHeight: 44,
            borderRadius: 12,
            backgroundColor: colors.surface,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        <Icon name="folder" size={18} />
        <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
          {selected ? label(selected) : 'Choose folder'}
        </Text>
        <Icon name="down" size={14} />
      </Pressable>
      {open && !adding && (
        <Sheet title="Choose folder" onClose={() => setOpen(false)}>
          <SearchField
            label="Search folders"
            placeholder="Search"
            value={query}
            onChangeText={setQuery}
          />
          {matches.map((repository) => (
            <Pressable
              key={repository.id}
              accessibilityRole="button"
              accessibilityLabel={label(repository)}
              accessibilityState={{
                selected: repository.id === value,
                disabled: !!repository.gitIdentityError,
              }}
              disabled={!!repository.gitIdentityError}
              onPress={() => {
                onChange(repository.id, repository)
                setOpen(false)
              }}
              style={[
                styles.row,
                {
                  padding: 12,
                  minHeight: 48,
                  borderRadius: 10,
                  backgroundColor: repository.id === value ? colors.elevated : undefined,
                  opacity: repository.gitIdentityError ? 0.45 : 1,
                },
              ]}
            >
              <Icon name={repository.kind === 'scratch' ? 'chat' : 'folder'} size={18} />
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{label(repository)}</Text>
                {!!repository.gitIdentityError && (
                  <Text style={styles.error}>{repository.gitIdentityError}</Text>
                )}
              </View>
              {repository.id === value && <Icon name="check" size={17} />}
            </Pressable>
          ))}
          {!matches.length && <Text style={styles.muted}>No matching folders.</Text>}
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 8 }}>
            <Action secondary label="Add GitHub repository" onPress={() => setAdding('github')} />
            <Action secondary label="Clone repository" onPress={() => setAdding('github')} />
            <Action secondary label="Open folder" onPress={() => setAdding('local')} />
          </View>
        </Sheet>
      )}
      {adding && (
        <AddProject
          initialSource={adding}
          onAdded={(repository) => {
            onAdded?.(repository)
            onChange(repository.id, repository)
          }}
          onClose={() => {
            setAdding(null)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}
