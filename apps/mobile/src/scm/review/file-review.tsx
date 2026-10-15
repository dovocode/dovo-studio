import { useDeferredValue, useMemo, useState } from 'react'
import { Modal, Pressable, Switch, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReviewGroup, FileTreeEntry } from '@dovo/protocol'
import { MobileFileTree, MobileFileTypeIcon } from '../../ui/content/file-tree'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
export type ReviewListFile = FileTreeEntry & { viewed: boolean }
export function MobileFileReview({
  files,
  groups,
  selected,
  onSelect,
  onViewed,
  related,
  onRelatedChange,
  disabled = false,
  busy = false,
  navigationDisabled = false,
  error = '',
  onRetry,
}: {
  files: ReviewListFile[]
  groups: ReviewGroup[]
  selected: string
  onSelect: (path: string) => void
  onViewed: (viewed: boolean) => void
  related: boolean
  onRelatedChange: (value: boolean) => void
  disabled?: boolean
  busy?: boolean
  navigationDisabled?: boolean
  error?: string
  onRetry: () => void
}) {
  const { colors, styles } = useTheme()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [unviewed, setUnviewed] = useState(false)
  const filter = useDeferredValue(query.trim().toLowerCase())
  const filtered = useMemo(
    () =>
      files.filter(
        (file) => (!unviewed || !file.viewed) && file.path.toLowerCase().includes(filter),
      ),
    [files, filter, unviewed],
  )
  const index = files.findIndex((file) => file.path === selected)
  const file = files[index]
  const nextUnviewed = [...files.slice(index + 1), ...files.slice(0, index)].find(
    (file) => !file.viewed,
  )
  const select = (path: string) => {
    if (!navigationDisabled) {
      onSelect(path)
      setOpen(false)
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Browse changed files"
        disabled={navigationDisabled}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 48,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          padding: 10,
          opacity: navigationDisabled ? 0.5 : 1,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {file && <MobileFileTypeIcon path={file.path} />}
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 }}
          >
            {file?.path ?? 'Browse changed files'}
          </Text>
        </View>
        <Text style={styles.muted}>
          {index >= 0 ? `${index + 1} of ${files.length} · ` : ''}
          {files.filter((file) => file.viewed).length} viewed · Find files
        </Text>
      </Pressable>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <Switch
            accessibilityLabel="File viewed"
            value={file?.viewed ?? false}
            disabled={disabled || busy || !file}
            onValueChange={onViewed}
          />
          <Text style={{ color: colors.text, fontSize: 14 }}>{busy ? 'Saving…' : 'Viewed'}</Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            maxWidth: '100%',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <Action
            secondary
            label="Previous file"
            icon="back"
            disabled={navigationDisabled || index <= 0}
            onPress={() => {
              const file = files[index - 1]
              if (file) select(file.path)
            }}
          />
          <Action
            secondary
            label="Next file"
            icon="next"
            disabled={navigationDisabled || index < 0 || index >= files.length - 1}
            onPress={() => {
              const file = files[index + 1]
              if (file) select(file.path)
            }}
          />
          <Action
            secondary
            label="Next unviewed"
            disabled={navigationDisabled || !nextUnviewed}
            onPress={() => {
              if (nextUnviewed) select(nextUnviewed.path)
            }}
          />
        </View>
      </View>
      {!!error && (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Action secondary label="Retry viewed progress" onPress={onRetry} />
        </View>
      )}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom,
            paddingHorizontal: 16,
            gap: 10,
          }}
        >
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}
            >
              Changed files
            </Text>
            <Action secondary label="Close" onPress={() => setOpen(false)} />
          </View>
          <TextInput
            accessibilityLabel="Search changed files"
            placeholder="Search files…"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { minHeight: 44, color: colors.text }]}
          />
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Action
              secondary
              label={
                related
                  ? groups.some((group) => group.basis === 'feature')
                    ? 'Features'
                    : 'Related changes'
                  : 'Folders'
              }
              onPress={() => onRelatedChange(!related)}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.muted}>Unviewed only</Text>
              <Switch
                accessibilityLabel="Unviewed only"
                value={unviewed}
                onValueChange={setUnviewed}
              />
            </View>
          </View>
          {!filtered.length ? (
            <Text style={styles.muted}>
              {unviewed && !filter ? 'All files viewed.' : 'No matching files.'}
            </Text>
          ) : (
            <MobileFileTree
              files={filtered}
              groups={groups}
              related={related}
              search={filter}
              selected={selected}
              onSelect={select}
              disabled={navigationDisabled}
            />
          )}
        </View>
      </Modal>
    </View>
  )
}
