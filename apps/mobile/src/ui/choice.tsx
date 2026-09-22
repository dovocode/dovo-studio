import { Icon } from './icon'
import { useState } from 'react'
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Text } from './text'
import { styles, colors } from './theme'
import { Sheet, useInsideSheet } from './sheet'
import { SearchField } from './field'
import { ChoiceMenu } from './choice-menu'
export type ChoiceProps = {
  label: string
  value: string
  items: Array<{ id: string; name: string }>
  onChange: (value: string) => void
  hideLabel?: boolean
  disabled?: boolean
  compact?: boolean
  row?: boolean
}
export function Choice({
  label,
  value,
  items,
  onChange,
  disabled = false,
  hideLabel = false,
  compact = false,
  row = false,
}: ChoiceProps) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('')
  const { fontScale } = useWindowDimensions()
  const insideSheet = useInsideSheet()
  const horizontal = row && fontScale < 1.5
  const compactControl = compact || row
  const searchField = items.length > 6 && (
    <SearchField
      label={`Search ${label.toLowerCase()}`}
      value={search}
      onChangeText={setSearch}
      placeholder="Search…"
      clearButtonMode="while-editing"
    />
  )
  const optionRows = (
    <>
      {items
        .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
        .map((item) => (
          <Pressable
            key={item.id}
            testID={`Choose ${item.name}`}
            accessibilityRole="button"
            accessibilityState={{ selected: item.id === value, disabled }}
            disabled={disabled}
            style={({ pressed }) => [
              styles.row,
              {
                minHeight: 48,
                padding: 12,
                opacity: disabled ? 0.45 : 1,
                backgroundColor: pressed
                  ? '#ffffff20'
                  : item.id === value
                    ? '#ffffff12'
                    : undefined,
                borderRadius: 8,
              },
            ]}
            onPress={() => {
              onChange(item.id)
              setOpen(false)
            }}
          >
            <Text style={[styles.text, { flex: 1 }]}>{item.name}</Text>
            {item.id === value && <Icon name="check" size={17} />}
          </Pressable>
        ))}
      {!items.some((item) => item.name.toLowerCase().includes(search.toLowerCase())) && (
        <Text style={styles.muted}>No matching options.</Text>
      )}
    </>
  )
  return (
    <View style={{ gap: row ? 0 : 4 }}>
      <View
        style={
          row
            ? {
                flexDirection: horizontal ? 'row' : 'column',
                alignItems: horizontal ? 'center' : 'stretch',
                backgroundColor: colors.surface,
                borderRadius: 12,
                paddingLeft: 14,
                paddingRight: 8,
                paddingTop: horizontal ? 0 : 10,
              }
            : { gap: 4 }
        }
      >
        {!hideLabel && (
          <Text
            style={
              row
                ? [
                    styles.text,
                    {
                      flexShrink: 1,
                      flexBasis: horizontal ? '38%' : undefined,
                      paddingRight: 8,
                      fontSize: 16,
                    },
                  ]
                : styles.muted
            }
          >
            {label}
          </Text>
        )}
        <View style={row ? { flex: horizontal ? 1 : undefined, minWidth: 0 } : undefined}>
          {Platform.OS === 'ios' && items.length > 0 && items.length <= 12 ? (
            <ChoiceMenu {...{ label, value, items, onChange, disabled }} compact={compactControl} />
          ) : (
            <View
              style={{
                borderRadius: 12,
                backgroundColor: compactControl ? undefined : colors.surface,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <Pressable
                testID={label}
                accessibilityLabel={label}
                accessibilityRole="button"
                accessibilityValue={{
                  text: items.find((item) => item.id === value)?.name ?? value,
                }}
                accessibilityState={{ disabled, expanded: open }}
                disabled={disabled}
                onPress={() => {
                  setSearch('')
                  setOpen((value) => !value)
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingHorizontal: compactControl ? 4 : 12,
                    paddingVertical: compactControl ? 8 : 12,
                    minHeight: 44,
                    borderRadius: 12,
                    backgroundColor: pressed ? '#ffffff14' : 'transparent',
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.text,
                    {
                      flex: 1,
                      fontSize: compactControl ? 15 : 17,
                      color: compactControl ? colors.accent : colors.text,
                    },
                  ]}
                >
                  {items.find((item) => item.id === value)?.name ?? (value || 'Choose…')}
                </Text>
                <Icon name="down" size={13} color={colors.muted} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
      {open &&
        (insideSheet ? (
          <View style={{ gap: 8, paddingTop: 8 }}>
            {searchField}
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 320 }}
            >
              {optionRows}
            </ScrollView>
          </View>
        ) : (
          <Sheet title={label} onClose={() => setOpen(false)}>
            {searchField}
            {optionRows}
          </Sheet>
        ))}
    </View>
  )
}
