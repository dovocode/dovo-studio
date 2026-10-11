import { useDeferredValue, useMemo, useState } from 'react'
import { Modal, Pressable, SectionList, Switch, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReviewGroup } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
export type ReviewListFile = { path: string; viewed: boolean; label?: string }
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
  const sections = useMemo(() => {
    const remaining = new Map(
      files
        .filter((file) => (!unviewed || !file.viewed) && file.path.toLowerCase().includes(filter))
        .map((file) => [file.path, file]),
    )
    const sections: { title: string; data: ReviewListFile[] }[] = []
    if (related)
      for (const group of groups) {
        const data = group.paths.flatMap((path) => {
          const file = remaining.get(path)
          if (!file) return []
          remaining.delete(path)
          return [file]
        })
        if (data.length)
          sections.push({
            title: `${group.basis === 'ast' ? 'Related' : 'Folder'} · ${group.label}`,
            data,
          })
      }
    const folders = new Map<string, ReviewListFile[]>()
    for (const file of [...remaining.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const folder = file.path.includes('/')
        ? file.path.slice(0, file.path.lastIndexOf('/'))
        : 'Root files'
      const data = folders.get(folder) ?? []
      data.push(file)
      folders.set(folder, data)
    }
    for (const [title, data] of folders) sections.push({ title: `Folder · ${title}`, data })
    return sections
  }, [files, groups, related, filter, unviewed])
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
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
          {file?.path ?? 'Browse changed files'}
        </Text>
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
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
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
              label={related ? 'Related changes' : 'Folders'}
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
          <SectionList
            sections={sections}
            keyExtractor={(file) => file.path}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              <Text style={styles.muted}>
                {unviewed && !filter ? 'All files viewed.' : 'No matching files.'}
              </Text>
            }
            renderSectionHeader={({ section }) => (
              <Text
                accessibilityRole="header"
                style={[styles.muted, { paddingVertical: 12, fontWeight: '600' }]}
              >
                {section.title}
              </Text>
            )}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.path}${item.viewed ? ', viewed' : ', unviewed'}`}
                accessibilityState={{ selected: item.path === selected }}
                onPress={() => select(item.path)}
                style={{
                  minHeight: 56,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: item.path === selected ? colors.surface : colors.background,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Text style={{ color: item.viewed ? colors.success : colors.muted }}>
                  {item.viewed ? '✓' : '○'}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 15 }}>
                    {item.path.split('/').at(-1)}
                  </Text>
                  <Text style={styles.muted}>
                    {item.path.includes('/')
                      ? item.path.slice(0, item.path.lastIndexOf('/'))
                      : 'Root'}
                    {item.label ? ` · ${item.label}` : ''}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  )
}
