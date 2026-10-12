import { useEffect, useMemo, useState } from 'react'
import { Pressable, SectionList, View } from 'react-native'
import {
  buildFileTree,
  fileIconKind,
  type FileTreeEntry,
  type FileTreeNode,
  type ReviewGroup,
} from '@dovo/protocol'
import { Icon, type IconName } from '../controls/icon'
import { Text } from './text'
import { useTheme } from '../theme'

const fileIcons: Record<ReturnType<typeof fileIconKind>, IconName> = {
  code: 'code',
  image: 'fileImage',
  data: 'fileJson',
  config: 'settings',
  terminal: 'terminal',
  text: 'fileText',
  file: 'file',
}
export function MobileFileTypeIcon({ path }: { path: string }) {
  const { colors } = useTheme()
  const kind = fileIconKind(path)
  const color =
    kind === 'code'
      ? colors.syntaxKeyword
      : kind === 'image'
        ? colors.accent
        : kind === 'data'
          ? colors.warning
          : kind === 'terminal'
            ? colors.success
            : colors.muted
  return <Icon name={fileIcons[kind]} size={16} color={color} />
}
type Row = { node: FileTreeNode; depth: number; open: boolean; flat?: boolean }
export function MobileFileTree({
  files,
  selected = '',
  onSelect,
  groups = [],
  related = false,
  search = '',
  disabled = false,
  scrollable = true,
  defaultExpandedDepth = 1,
}: {
  files: readonly FileTreeEntry[]
  selected?: string
  onSelect: (path: string) => void
  groups?: ReviewGroup[]
  related?: boolean
  search?: string
  disabled?: boolean
  scrollable?: boolean
  defaultExpandedDepth?: number
}) {
  const { colors, styles } = useTheme()
  const [expanded, setExpanded] = useState(new Map<string, boolean>())
  const [searchClosed, setSearchClosed] = useState({ query: '', paths: new Set<string>() })
  useEffect(() => {
    const parts = selected.split('/')
    setExpanded((previous) => {
      const next = new Map(previous)
      for (let index = 1; index < parts.length; index++)
        next.set(parts.slice(0, index).join('/'), true)
      return next
    })
  }, [selected])
  const sections = useMemo(() => {
    const remaining = new Map(files.map((file) => [file.path, file]))
    const sections: { title: string; summary?: string; impact?: string; data: Row[] }[] = []
    if (related)
      for (const group of groups) {
        if (group.basis === 'folder') continue
        const members = group.paths.flatMap((path) => {
          const file = remaining.get(path)
          if (!file) return []
          remaining.delete(path)
          return [
            {
              node: { ...file, kind: 'file' as const, name: path.split('/').at(-1) ?? path },
              depth: 0,
              open: false,
              flat: true,
            },
          ]
        })
        if (members.length)
          sections.push({
            title: `${group.basis === 'feature' ? 'Feature' : 'Related'} · ${group.label}`,
            summary: group.summary,
            impact: group.impact,
            data: members,
          })
      }
    const rows: Row[] = []
    const flatten = (nodes: FileTreeNode[], depth = 0) => {
      for (const node of nodes) {
        const open =
          node.kind === 'directory' &&
          (search
            ? searchClosed.query !== search || !searchClosed.paths.has(node.path)
            : (expanded.get(node.path) ??
              (depth < defaultExpandedDepth || selected.startsWith(`${node.path}/`))))
        rows.push({ node, depth, open })
        if (node.kind === 'directory' && open) flatten(node.children, depth + 1)
      }
    }
    flatten(buildFileTree([...remaining.values()]))
    if (rows.length) sections.push({ title: sections.length ? 'Other files' : '', data: rows })
    return sections
  }, [files, groups, related, search, expanded, searchClosed, selected, defaultExpandedDepth])
  const row = ({ node, depth, open, flat }: Row) => {
    const folder = node.kind === 'directory'
    const active = !folder && node.path === selected
    return (
      <Pressable
        key={node.path}
        accessibilityRole="button"
        accessibilityLabel={`${node.path}${!folder && node.viewed !== undefined ? (node.viewed ? ', viewed' : ', unviewed') : ''}`}
        accessibilityState={folder ? { expanded: open } : { selected: active, disabled }}
        disabled={!folder && disabled}
        onPress={() => {
          if (!folder) onSelect(node.path)
          else if (search)
            setSearchClosed((previous) => {
              const paths = new Set(previous.query === search ? previous.paths : [])
              if (open) paths.add(node.path)
              else paths.delete(node.path)
              return { query: search, paths }
            })
          else setExpanded((previous) => new Map(previous).set(node.path, !open))
        }}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 7,
          paddingRight: 10,
          paddingLeft: 8 + Math.min(depth, 4) * 12,
          borderRadius: 8,
          backgroundColor: active ? colors.selection : 'transparent',
          opacity: !folder && disabled ? 0.5 : 1,
          borderLeftWidth: 2,
          borderLeftColor: active ? colors.accent : 'transparent',
        }}
      >
        {folder ? (
          <Icon name={open ? 'down' : 'next'} size={12} color={colors.muted} />
        ) : (
          <View style={{ width: 12 }} />
        )}
        {folder ? (
          <Icon name="folder" size={16} color={colors.warning} />
        ) : (
          <MobileFileTypeIcon path={node.path} />
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              color: folder ? colors.muted : colors.text,
              fontSize: 13,
              fontWeight: active || folder ? '600' : '400',
            }}
          >
            {node.name}
          </Text>
          {flat && node.path.includes('/') && (
            <Text numberOfLines={1} style={[styles.muted, { fontSize: 11 }]}>
              {node.path.slice(0, node.path.lastIndexOf('/'))}
            </Text>
          )}
        </View>
        {!folder && (
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            {!!node.additions && (
              <Text style={{ color: colors.success, fontSize: 11, fontVariant: ['tabular-nums'] }}>
                +{node.additions.toLocaleString()}
              </Text>
            )}
            {!!node.deletions && (
              <Text style={{ color: colors.error, fontSize: 11, fontVariant: ['tabular-nums'] }}>
                −{node.deletions.toLocaleString()}
              </Text>
            )}
            {!!node.label && (
              <Text numberOfLines={1} style={[styles.muted, { fontSize: 11, maxWidth: 72 }]}>
                {node.label}
              </Text>
            )}
            {!!node.viewed && <Icon name="check" size={13} color={colors.success} />}
          </View>
        )}
      </Pressable>
    )
  }
  const header = (section: (typeof sections)[number]) =>
    section.title ? (
      <View style={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 6, gap: 5 }}>
        <Text
          accessibilityRole="header"
          style={[styles.muted, { fontWeight: '600', fontSize: 12 }]}
        >
          {section.title}
        </Text>
        {!!section.summary && (
          <Text style={{ color: colors.text, fontSize: 13 }}>{section.summary}</Text>
        )}
        {!!section.impact && <Text style={styles.muted}>Linked impact: {section.impact}</Text>}
      </View>
    ) : null
  if (!scrollable)
    return (
      <View>
        {sections.map((section, index) => (
          <View key={section.title || index}>
            {header(section)}
            {section.data.map(row)}
          </View>
        ))}
      </View>
    )
  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.node.path}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => header(section)}
      renderItem={({ item }) => row(item)}
      ListEmptyComponent={<Text style={styles.muted}>No matching files.</Text>}
    />
  )
}
