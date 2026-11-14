import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { ScrollView, View, TextInput } from 'react-native'
import { spreadsheetPreviewSchema, type SpreadsheetPreview } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'
import { Choice } from '../../ui/controls/choice'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'

export function ProjectSpreadsheet({
  taskId,
  checkoutId,
  path,
  revision,
}: {
  taskId: string
  checkoutId?: string
  path: string
  revision: number
}) {
  const uiText = useInterfaceText()

  const { call, connection } = useRuntime()
  const { colors, styles } = useTheme()
  const [sheet, setSheet] = useState('')
  const [retry, setRetry] = useState(0)
  const [page, setPage] = useState(0)
  const [column, setColumn] = useState(0)
  const [row, setRow] = useState(0)
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [heights, setHeights] = useState<Record<number, number>>({})
  const identity = JSON.stringify([
    connection?.address,
    connection?.token,
    taskId,
    checkoutId,
    path,
    sheet,
    revision,
    retry,
  ])
  const [result, setResult] = useState<{
    identity: string
    value?: SpreadsheetPreview
    error?: string
  }>()
  const current = result?.identity === identity ? result : undefined
  useEffect(() => {
    let active = true
    void call(
      '/api/tasks/files/spreadsheet',
      { id: taskId, checkoutId, path, sheet: sheet || undefined },
      spreadsheetPreviewSchema,
    ).then(
      (value) => {
        if (active) setResult({ identity, value })
      },
      (error: unknown) => {
        if (active)
          setResult({ identity, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      active = false
    }
  }, [call, identity, taskId, checkoutId, path, sheet])
  const preview = current?.value
  const cellStyle = { borderWidth: 0.5, borderColor: colors.border, padding: 6 }
  return (
    <View
      accessibilityLabel={uiText('Spreadsheet preview')}
      style={{ flex: 1, minHeight: 280, gap: 10 }}
    >
      <Text style={styles.muted}>
        <InterfaceText>{'Read-only spreadsheet'}</InterfaceText>
      </Text>
      {!current && (
        <Text>
          <InterfaceText>{'Loading spreadsheet…'}</InterfaceText>
        </Text>
      )}
      {current?.error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {current.error}
          </Text>
          <Action label={uiText('Retry')} onPress={() => setRetry((value) => value + 1)} />
        </>
      )}
      {preview && (
        <>
          <Choice
            label={uiText('Worksheet')}
            value={preview.sheet}
            items={preview.sheets.map((name) => ({ id: name, name }))}
            onChange={(value) => {
              setSheet(value)
              setPage(0)
              setColumn(0)
              setRow(0)
              setWidths({})
              setHeights({})
            }}
          />
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <View style={{ gap: 4 }}>
              <Text>
                <InterfaceText>{'Column'}</InterfaceText>
              </Text>
              <TextInput
                accessibilityLabel={uiText('Column to resize')}
                keyboardType="number-pad"
                value={String(column + 1)}
                onChangeText={(value) =>
                  setColumn(
                    Math.max(
                      0,
                      Math.min(
                        (preview.rows[0]?.length ?? 1) - 1,
                        Number(value.replace(/\D/g, '')) - 1 || 0,
                      ),
                    ),
                  )
                }
                style={[styles.input, { width: 80 }]}
              />
            </View>
            <View style={{ gap: 4 }}>
              <Text>
                <InterfaceText>{'Width'}</InterfaceText>
              </Text>
              <TextInput
                accessibilityLabel={uiText('Column width')}
                keyboardType="number-pad"
                value={String(widths[column] ?? 140)}
                onChangeText={(value) =>
                  setWidths((current) => ({
                    ...current,
                    [column]: Math.max(64, Math.min(600, Number(value.replace(/\D/g, ''))) || 64),
                  }))
                }
                style={[styles.input, { width: 80 }]}
              />
            </View>
            <View style={{ gap: 4 }}>
              <Text>
                <InterfaceText>{'Row'}</InterfaceText>
              </Text>
              <TextInput
                accessibilityLabel={uiText('Row to resize')}
                keyboardType="number-pad"
                value={String(row + 1)}
                onChangeText={(value) =>
                  setRow(
                    Math.max(
                      0,
                      Math.min(preview.rows.length - 1, Number(value.replace(/\D/g, '')) - 1 || 0),
                    ),
                  )
                }
                style={[styles.input, { width: 80 }]}
              />
            </View>
            <View style={{ gap: 4 }}>
              <Text>
                <InterfaceText>{'Height'}</InterfaceText>
              </Text>
              <TextInput
                accessibilityLabel={uiText('Row height')}
                keyboardType="number-pad"
                value={String(heights[row] ?? 40)}
                onChangeText={(value) =>
                  setHeights((current) => ({
                    ...current,
                    [row]: Math.max(28, Math.min(600, Number(value.replace(/\D/g, ''))) || 28),
                  }))
                }
                style={[styles.input, { width: 80 }]}
              />
            </View>
          </View>
          <Action
            secondary
            label={uiText('Reset sizes')}
            onPress={() => {
              setWidths({})
              setHeights({})
            }}
          />
          {preview.truncated && (
            <Text style={styles.muted}>
              <InterfaceText>
                {'Preview limited to 200 rows, 50 columns, and bounded cell text.'}
              </InterfaceText>
            </Text>
          )}
          <ScrollView horizontal style={{ flexGrow: 0 }}>
            <View>
              <View style={{ flexDirection: 'row' }}>
                <Text style={[cellStyle, { width: 44, backgroundColor: colors.surface }]}>#</Text>
                {preview.rows[0]?.map((_, index) => (
                  <Text
                    key={index}
                    style={[
                      cellStyle,
                      { width: widths[index] ?? 140, backgroundColor: colors.surface },
                    ]}
                  >
                    {index + 1}
                  </Text>
                ))}
              </View>
              {preview.rows.slice(page * 25, (page + 1) * 25).map((cells, index) => {
                const number = page * 25 + index
                return (
                  <View
                    key={number}
                    style={{ flexDirection: 'row', height: heights[number] ?? 40 }}
                  >
                    <Text style={[cellStyle, { width: 44, backgroundColor: colors.surface }]}>
                      {number + 1}
                    </Text>
                    {cells.map((cell, i) => (
                      <Text
                        key={i}
                        selectable
                        style={[
                          cellStyle,
                          {
                            width: widths[i] ?? 140,
                            height: heights[number] ?? 40,
                            overflow: 'hidden',
                          },
                        ]}
                      >
                        {cell}
                      </Text>
                    ))}
                  </View>
                )
              })}
            </View>
          </ScrollView>
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0: Math.min(page * 25 + 1, preview.rows.length),
                value1: Math.min((page + 1) * 25, preview.rows.length),
                value2: preview.rows.length,
              }}
            >
              {'Rows {value0}–{value1} of {value2}'}
            </InterfaceText>
          </Text>
          <View style={styles.row}>
            <Action
              secondary
              label={uiText('Previous rows')}
              disabled={!page}
              onPress={() => setPage((value) => value - 1)}
            />
            <Action
              secondary
              label={uiText('Next rows')}
              disabled={(page + 1) * 25 >= preview.rows.length}
              onPress={() => setPage((value) => value + 1)}
            />
          </View>
        </>
      )}
    </View>
  )
}
