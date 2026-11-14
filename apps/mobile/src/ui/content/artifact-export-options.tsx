import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { View } from 'react-native'
import {
  artifactPdfDefaults,
  artifactPdfOptionsSchema,
  artifactPdfPaperChoices,
  artifactPngWidthSchema,
  ARTIFACT_PNG_DEFAULT_WIDTH,
  decodeResult,
  type ArtifactPdfOptions,
} from '@dovo/protocol'
import { Choice } from '../controls/choice'
import { Field } from '../controls/field'
import { Action } from '../controls/action'
import { Switch } from '../controls/switch'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactExportOptions({
  busy,
  disabled,
  onPdf,
  onPng,
}: {
  busy: boolean
  disabled: boolean
  onPdf: (options: ArtifactPdfOptions) => void
  onPng: (width: number) => void
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const [format, setFormat] = useState('pdf')
  const [paperSize, setPaperSize] = useState<string>(artifactPdfDefaults.paperSize)
  const [orientation, setOrientation] = useState('portrait')
  const [margin, setMargin] = useState(String(artifactPdfDefaults.marginMm))
  const [scale, setScale] = useState(String(artifactPdfDefaults.scale))
  const [background, setBackground] = useState<boolean>(artifactPdfDefaults.background)
  const [width, setWidth] = useState(String(ARTIFACT_PNG_DEFAULT_WIDTH))
  const options = decodeResult(artifactPdfOptionsSchema, {
    paperSize,
    landscape: orientation === 'landscape',
    marginMm: margin.trim() ? Number(margin.replace(',', '.')) : NaN,
    scale: scale.trim() ? Number(scale.replace(',', '.')) : NaN,
    background,
  }).data
  const pngWidth = decodeResult(artifactPngWidthSchema, width.trim() ? Number(width) : NaN).data
  const valid = format === 'pdf' ? !!options : pngWidth !== undefined
  return (
    <View
      style={{ gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}
    >
      <Choice
        row
        label={uiText('Format')}
        value={format}
        items={[
          { id: 'pdf', name: uiText('PDF document') },
          { id: 'png', name: uiText('PNG image') },
        ]}
        onChange={setFormat}
        disabled={busy}
      />
      {format === 'pdf' ? (
        <>
          <Choice
            row
            label={uiText('Paper size')}
            value={paperSize}
            items={artifactPdfPaperChoices.map((choice) => ({
              id: choice.value,
              name: choice.label,
            }))}
            onChange={setPaperSize}
            disabled={busy}
          />
          <Choice
            row
            label={uiText('Orientation')}
            value={orientation}
            items={[
              { id: 'portrait', name: uiText('Portrait') },
              { id: 'landscape', name: uiText('Landscape') },
            ]}
            onChange={setOrientation}
            disabled={busy}
          />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field
                label={uiText('Margins (mm)')}
                keyboardType="decimal-pad"
                value={margin}
                onChangeText={setMargin}
                editable={!busy}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={uiText('Scale (%)')}
                keyboardType="decimal-pad"
                value={scale}
                onChangeText={setScale}
                editable={!busy}
              />
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text style={[styles.text, { flex: 1 }]}>
              <InterfaceText>{'Include backgrounds'}</InterfaceText>
            </Text>
            <Switch
              accessibilityLabel={uiText('Include backgrounds')}
              value={background}
              onValueChange={setBackground}
              disabled={busy}
            />
          </View>
        </>
      ) : (
        <Field
          label={uiText('Width (px)')}
          keyboardType="number-pad"
          value={width}
          onChangeText={setWidth}
          editable={!busy}
        />
      )}
      <Text style={styles.muted}>
        {format === 'pdf'
          ? paperSize === 'auto'
            ? uiText(
                'Automatic keeps any page size and orientation defined by the artifact. A4 is the fallback.',
              )
            : uiText('Print layout with your selected page size and orientation.')
          : uiText('Full page at this width. Height adjusts to the content.')}
      </Text>
      {!valid && (
        <Text accessibilityRole="alert" style={styles.error}>
          {format === 'pdf'
            ? uiText('Enter margins from 0–50 mm and a scale from 10–200%.')
            : uiText('Enter a whole width from 320–4096 px.')}
        </Text>
      )}
      <Action
        label={uiText('Export {value0}', { value0: format.toUpperCase() })}
        disabled={disabled || busy || !valid}
        onPress={() => {
          if (format === 'pdf' && options) onPdf(options)
          if (format === 'png' && pngWidth !== undefined) onPng(pngWidth)
        }}
      />
    </View>
  )
}
