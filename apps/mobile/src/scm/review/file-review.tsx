import { useDeferredValue, useMemo, useState } from 'react'
import { Modal, Pressable, Switch, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReviewGroup, FileTreeEntry } from '@dovo/protocol'
import { MobileFileTree, MobileFileTypeIcon } from '../../ui/content/file-tree'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { Icon } from '../../ui/controls/icon'
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
  wrapLines,
  onWrapLinesChange,
  onOptions,
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
  wrapLines?: boolean
  onWrapLinesChange?: (value: boolean) => void
  onOptions?: () => void
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
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Browse changed files"
        accessibilityValue={{ text: `${file?.path ?? ''}. ${index + 1} of ${files.length}` }}
        disabled={navigationDisabled}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: navigationDisabled ? 0.5 : 1,
        }}
      >
        {file && <MobileFileTypeIcon path={file.path} />}
        <Text
          numberOfLines={1}
          ellipsizeMode="head"
          style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1, minWidth: 0 }}
        >
          {file?.path ?? 'Browse changed files'}
        </Text>
        {file?.additions !== undefined && (
          <Text numberOfLines={1} style={{ color: colors.success, fontSize: 12, flexShrink: 1 }}>
            +{file.additions}
          </Text>
        )}
        {file?.deletions !== undefined && (
          <Text numberOfLines={1} style={{ color: colors.error, fontSize: 12, flexShrink: 1 }}>
            −{file.deletions}
          </Text>
        )}
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>
          {index >= 0 ? `${index + 1}/${files.length}` : files.length}
        </Text>
        <Icon name="down" size={12} color={colors.muted} />
      </Pressable>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="File viewed"
          accessibilityState={{
            checked: file?.viewed ?? false,
            disabled: disabled || busy || !file,
          }}
          disabled={disabled || busy || !file}
          onPress={() => onViewed(!file?.viewed)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            opacity: disabled || busy || !file ? 0.45 : pressed ? 0.6 : 1,
          })}
        >
          <Icon
            name={file?.viewed ? 'checkCircle' : 'circle'}
            size={18}
            color={file?.viewed ? colors.accent : colors.muted}
          />
          <Text style={{ color: file?.viewed ? colors.accent : colors.muted, fontSize: 12 }}>
            {busy ? 'Saving…' : 'Viewed'}
          </Text>
        </Pressable>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            maxWidth: '100%',
            gap: 0,
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
            icon="moveDown"
            disabled={navigationDisabled || !nextUnviewed}
            onPress={() => {
              if (nextUnviewed) select(nextUnviewed.path)
            }}
          />
          {wrapLines !== undefined && onWrapLinesChange && (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Wrap diff lines"
              accessibilityState={{ checked: wrapLines }}
              onPress={() => onWrapLinesChange(!wrapLines)}
              style={({ pressed }) => ({
                minWidth: 44,
                minHeight: 44,
                paddingHorizontal: 6,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: wrapLines ? colors.accent : colors.muted,
                }}
              >
                Wrap
              </Text>
            </Pressable>
          )}
          {onOptions && <Action secondary label="File actions" icon="more" onPress={onOptions} />}
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
          <Text style={styles.muted}>
            {files.filter((file) => file.viewed).length} of {files.length} viewed
          </Text>
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
            {groups.some((group) => group.basis === 'feature') && (
              <Action
                secondary
                label={related ? 'Features' : 'Folders'}
                onPress={() => onRelatedChange(!related)}
              />
            )}
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
