import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  changeTypeDistribution,
  pullFileKind,
  type ChangeTypeFile,
  type FileKind,
} from '@dovo/protocol'
import {
  Box,
  CodeXml,
  FileText,
  FlaskConical,
  Settings,
  type LucideIcon,
} from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Icon } from '../controls/icon'
import { useTheme } from '../theme'
import { changeCategories, ChangeTypeFilters } from './change-types'
import { Text } from './text'

const icons: Record<FileKind, LucideIcon> = {
  normal: CodeXml,
  tests: FlaskConical,
  mocks: Box,
  docs: FileText,
  generated: Settings,
}

/** A shared, controlled summary; callers retain ownership of their file navigation. */
export function ChangeSummary({
  files,
  total = files.length,
  expanded,
  onExpandedChange,
  value,
  onChange,
  children,
  testID,
  accessibilityLabel,
}: {
  files: readonly ChangeTypeFile[]
  total?: number | null
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  value?: FileKind
  onChange: (kind: FileKind | undefined) => void
  children?: ReactNode
  testID?: string
  accessibilityLabel?: string
}) {
  const uiText = useInterfaceText()

  const { colors, mode, styles } = useTheme()
  const distribution = changeTypeDistribution(files, 'lines')
  const categories = changeCategories.filter(({ kind }) => distribution.counts.has(kind))
  const stats = (items: readonly ChangeTypeFile[]) => {
    const additions = items.flatMap((file) => (file.additions == null ? [] : [file.additions]))
    const deletions = items.flatMap((file) => (file.deletions == null ? [] : [file.deletions]))
    return {
      additions: additions.length ? additions.reduce((sum, value) => sum + value, 0) : null,
      deletions: deletions.length ? deletions.reduce((sum, value) => sum + value, 0) : null,
    }
  }
  const totals = stats(files)
  const statsHint = (amounts: ReturnType<typeof stats>, partial: boolean) => {
    const parts = [
      amounts.additions === null ? 'Additions unknown' : `${amounts.additions} additions`,
      amounts.deletions === null ? 'Deletions unknown' : `${amounts.deletions} deletions`,
    ]
    if (partial) parts.push('Available line counts only')
    return parts.join(', ')
  }
  const partialStats = files.some((file) => file.additions == null || file.deletions == null)
  const count = total ?? files.length
  const bar = (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={uiText('{value0} distribution: {value1}', {
        value0:
          distribution.unit === 'lines'
            ? `${partialStats || (total != null && total > files.length) ? 'Available changed' : 'Changed'} line`
            : 'File type',
        value1: categories
          .map(
            ({ kind, label }) =>
              `${label} ${distribution.weights.get(kind) ?? 0} ${distribution.unit}`,
          )
          .join(', '),
      })}
      style={{ flexDirection: 'row', height: 6, gap: 1, overflow: 'hidden', borderRadius: 3 }}
    >
      {categories
        .filter(({ kind }) => (distribution.weights.get(kind) ?? 0) > 0)
        .map((category) => (
          <View
            key={category.kind}
            style={{
              flex: distribution.weights.get(category.kind),
              backgroundColor: category[mode],
            }}
          />
        ))}
    </View>
  )
  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: 10,
        gap: 8,
      }}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={
          accessibilityLabel ??
          uiText('{value0} {value1} changed', {
            value0: count,
            value1: count === 1 ? 'file' : 'files',
          })
        }
        accessibilityHint={statsHint(
          totals,
          partialStats || (total != null && total > files.length),
        )}
        accessibilityState={{ expanded }}
        onPress={() => onExpandedChange(!expanded)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name="fileText" size={20} color={colors.text} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
            <InterfaceText
              values={{ value0: count, value1: count === 1 ? uiText('file') : uiText('files') }}
            >
              {'{value0} {value1} changed'}
            </InterfaceText>
          </Text>
          {(totals.additions !== null || totals.deletions !== null) && (
            <Text style={{ fontSize: 12 }}>
              {totals.additions !== null && (
                <Text style={{ color: colors.success }}>+{totals.additions}</Text>
              )}
              {totals.additions !== null && totals.deletions !== null ? '  ' : null}
              {totals.deletions !== null && (
                <Text style={{ color: colors.error }}>−{totals.deletions}</Text>
              )}
              {partialStats || (total != null && total > files.length) ? (
                <Text style={{ color: colors.muted }}>
                  <InterfaceText>{' · available stats'}</InterfaceText>
                </Text>
              ) : null}
            </Text>
          )}
        </View>
        <Icon name={expanded ? 'down' : 'next'} size={16} color={colors.muted} />
      </Pressable>
      {!!files.length && bar}
      {!!categories.length && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {categories.map((category) => {
            const CategoryIcon = icons[category.kind]
            const categoryFiles = files.filter(
              (file) => (file.changeKind ?? pullFileKind(file)) === category.kind,
            )
            const categoryStats = stats(categoryFiles)
            const categoryPartial =
              categoryFiles.some((file) => file.additions == null || file.deletions == null) ||
              (total != null && total > files.length)
            const content = (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <CategoryIcon size={16} color={category[mode]} />
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    {expanded ? `${category.label} ` : ''}
                    {distribution.counts.get(category.kind)}
                  </Text>
                </View>
                {expanded &&
                  (categoryStats.additions !== null || categoryStats.deletions !== null) && (
                    <Text style={{ fontSize: 11 }}>
                      {categoryStats.additions !== null && (
                        <Text style={{ color: colors.success }}>+{categoryStats.additions}</Text>
                      )}
                      {categoryStats.additions !== null && categoryStats.deletions !== null
                        ? '  '
                        : null}
                      {categoryStats.deletions !== null && (
                        <Text style={{ color: colors.error }}>−{categoryStats.deletions}</Text>
                      )}
                      {categoryPartial && (
                        <Text style={{ color: colors.muted }}>
                          <InterfaceText>{' · available'}</InterfaceText>
                        </Text>
                      )}
                    </Text>
                  )}
              </>
            )
            const tileStyle = {
              minWidth: expanded ? 90 : undefined,
              flexGrow: expanded ? 1 : 0,
              borderRadius: 10,
              paddingHorizontal: 9,
              paddingVertical: 7,
              backgroundColor: colors.surface,
              gap: 4,
            } as const
            return expanded ? (
              <Pressable
                key={category.kind}
                accessibilityRole="button"
                accessibilityLabel={uiText('Filter {value0}: {value1} files', {
                  value0: category.label,
                  value1: distribution.counts.get(category.kind),
                })}
                accessibilityHint={statsHint(categoryStats, categoryPartial)}
                accessibilityState={{ selected: value === category.kind }}
                onPress={() => onChange(value === category.kind ? undefined : category.kind)}
                style={{
                  ...tileStyle,
                  minHeight: 44,
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {value === category.kind && (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: colors.accent,
                      opacity: 0.04,
                    }}
                  />
                )}
                {content}
              </Pressable>
            ) : (
              <View
                key={category.kind}
                accessible
                accessibilityLabel={uiText('{value0}, {value1} files', {
                  value0: category.label,
                  value1: distribution.counts.get(category.kind),
                })}
                accessibilityHint={statsHint(categoryStats, categoryPartial)}
                style={tileStyle}
              >
                {content}
              </View>
            )
          })}
        </View>
      )}
      {total != null && total > files.length && (
        <Text style={[styles.muted, { fontSize: 11 }]}>
          <InterfaceText values={{ value0: files.length, value1: total }}>
            {'{value0} of {value1} files loaded'}
          </InterfaceText>
        </Text>
      )}
      {expanded && (
        <View style={{ gap: 4 }}>
          {!!files.length && (
            <ChangeTypeFilters
              files={files}
              value={value}
              onChange={onChange}
              showDistribution={false}
              subtleSelection
            />
          )}
          {children}
        </View>
      )}
    </View>
  )
}
