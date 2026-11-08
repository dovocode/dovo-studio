import { useApplicationState } from '../../runtime/state/application-state'
import { Icon, type IconName } from './icon'
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Text } from '../content/text'
import { useTheme } from '../theme'
import { Sheet, useInsideSheet } from '../layout/sheet'
import { SearchField } from './field'
import { ChoiceMenu } from './choice-menu'
export type ChoiceProps = {
  label: string
  value: string
  selectedLabel?: string
  items: Array<{
    id: string
    name: string
    icon?: IconName
    disabled?: boolean
  }>
  onChange: (value: string) => void
  hideLabel?: boolean
  disabled?: boolean
  compact?: boolean
  /** A flat, smaller value that can still wrap in settings. */
  quiet?: boolean
  /** Align a settings value against the trailing edge of a horizontal row. */
  alignValue?: 'leading' | 'trailing'
  row?: boolean
}
export function Choice({
  label,
  value,
  selectedLabel,
  items,
  onChange,
  disabled = false,
  hideLabel = false,
  compact = false,
  quiet = false,
  alignValue = 'leading',
  row = false,
}: ChoiceProps) {
  const { colors, styles } = useTheme()

  const [open, setOpen] = useApplicationState(false),
    [search, setSearch] = useApplicationState('')
  const { width, height, fontScale } = useWindowDimensions()
  const insideSheet = useInsideSheet()
  const selected = items.find((item) => item.id === value)
  const horizontal = row && fontScale < 1.5 && width / fontScale >= 360
  const compactControl = compact || horizontal
  const searchField = items.length > 6 && (
    <SearchField
      label={`Search ${label.toLowerCase()}`}
      value={search}
      onChangeText={setSearch}
      placeholder="Search…"
      clearButtonMode="while-editing"
    />
  )
  const filtered = items.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const optionRows = (
    <>
      {filtered.map((item) => (
        <Pressable
          key={item.id}
          testID={`Choose ${item.name}`}
          accessibilityRole="button"
          accessibilityState={{
            selected: item.id === value,
            disabled: disabled || item.disabled,
          }}
          disabled={disabled || item.disabled}
          style={({ pressed }) => [
            styles.row,
            {
              minHeight: 48,
              flexWrap: 'nowrap',
              padding: 12,
              opacity: disabled || item.disabled ? 0.45 : 1,
              backgroundColor: pressed || item.id === value ? colors.selection : undefined,
              borderRadius: 8,
            },
          ]}
          onPress={() => {
            onChange(item.id)
            setOpen(false)
          }}
        >
          {item.icon && <Icon name={item.icon} size={18} />}
          <Text
            style={[
              styles.text,
              {
                flex: 1,
                minWidth: 0,
              },
            ]}
          >
            {item.name}
          </Text>
          {item.id === value && <Icon name="check" size={17} />}
        </Pressable>
      ))}
      {!filtered.length && <Text style={styles.muted}>No matching options.</Text>}
    </>
  )
  return (
    <View
      style={{
        gap: row ? 0 : 4,
      }}
    >
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
            : {
                gap: 4,
              }
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
        <View
          style={
            row
              ? {
                  flex: horizontal ? 1 : undefined,
                  minWidth: 0,
                }
              : undefined
          }
        >
          {Platform.OS === 'ios' && items.length > 0 && items.length <= 12 ? (
            <ChoiceMenu
              {...{
                label,
                value,
                selectedLabel,
                items,
                onChange,
                disabled,
              }}
              compact={compactControl}
              quiet={quiet}
              alignValue={alignValue}
            />
          ) : (
            <View
              style={{
                borderRadius: 12,
                backgroundColor: compactControl || quiet ? undefined : colors.surface,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <Pressable
                testID={label}
                accessibilityLabel={label}
                accessibilityRole="button"
                accessibilityValue={{
                  text: items.find((item) => item.id === value)?.name ?? selectedLabel ?? value,
                }}
                accessibilityState={{
                  disabled,
                  expanded: open && !disabled,
                }}
                disabled={disabled}
                onPress={() => {
                  setSearch('')
                  setOpen((value) => !value)
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingHorizontal: compactControl || quiet ? 4 : 12,
                    paddingVertical: compactControl || quiet ? 8 : 12,
                    minHeight: 44,
                    flexWrap: 'nowrap',
                    borderRadius: 12,
                    backgroundColor: pressed ? colors.selection : 'transparent',
                  },
                ]}
              >
                {selected?.icon && (
                  <Icon
                    name={selected.icon}
                    size={18}
                    color={compactControl || quiet ? colors.accent : colors.text}
                  />
                )}
                <Text
                  numberOfLines={compactControl && !quiet ? 1 : undefined}
                  style={[
                    styles.text,
                    {
                      flex: 1,
                      minWidth: 0,
                      fontSize: compactControl || quiet ? 15 : 17,
                      color: compactControl || quiet ? colors.accent : colors.text,
                      textAlign: alignValue === 'trailing' ? 'right' : 'left',
                    },
                  ]}
                >
                  {items.find((item) => item.id === value)?.name ??
                    selectedLabel ??
                    (value || 'Choose…')}
                </Text>
                <Icon name="down" size={13} color={colors.muted} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
      {open &&
        !disabled &&
        (insideSheet ? (
          <View
            style={{
              gap: 8,
              paddingTop: 8,
            }}
          >
            {searchField}
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{
                flexGrow: 0,
                flexShrink: 0,
                maxHeight: 320,
                height: items.length > 6 ? Math.min(320, height * 0.4) : undefined,
              }}
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
