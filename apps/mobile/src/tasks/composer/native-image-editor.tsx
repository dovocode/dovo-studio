import { useEffect, useReducer, useRef, useState } from 'react'
import {
  ActivityIndicator,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  View,
  type GestureResponderEvent,
} from 'react-native'
import {
  Pencil,
  Highlighter,
  ArrowUpRight,
  Square,
  Crop,
  Undo2,
  Redo2,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react-native'
import Svg, { Image as SvgImage, Path, Rect } from 'react-native-svg'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import {
  cropBounds,
  editHistory,
  imagePoint,
  markPath,
  type ImageEdit,
  type ImageTool,
  type Mark,
  type Point,
} from './image-editor-state'
import type { AttachmentAsset } from './attachment-picker'

const tools: { tool: ImageTool; label: string; icon: LucideIcon }[] = [
  { tool: 'pen', label: 'Draw', icon: Pencil },
  { tool: 'highlight', label: 'Highlight', icon: Highlighter },
  { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { tool: 'rectangle', label: 'Box', icon: Square },
  { tool: 'crop', label: 'Crop', icon: Crop },
]
const swatches = [
  { color: '#ef4444', name: 'Red' },
  { color: '#facc15', name: 'Yellow' },
  { color: '#22c55e', name: 'Green' },
  { color: '#3b82f6', name: 'Blue' },
  { color: '#ffffff', name: 'White' },
  { color: '#111111', name: 'Black' },
]

export type EditableImage = { asset: AttachmentAsset; width: number; height: number }

export function NativeImageEditor({
  image,
  onFinish,
}: {
  image: EditableImage
  onFinish: (asset: AttachmentAsset | null) => void
}) {
  const { colors, styles } = useTheme()
  const [history, dispatch] = useReducer(editHistory, {
    steps: [{ crop: { x: 0, y: 0, width: image.width, height: image.height }, marks: [] }],
    index: 0,
  })
  const current = history.steps[history.index]!
  const [tool, setTool] = useState<ImageTool>('pen')
  const [color, setColor] = useState('#ef4444')
  const [size, setSize] = useState(3)
  const [layout, setLayout] = useState({ width: 0, height: 0 })
  const [draft, setDraft] = useState<Mark | null>(null)
  const [selection, setSelection] = useState<{ start: Point; end: Point } | null>(null)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const exportResult = useRef<((data: string | Error) => void) | null>(null)
  const gesture = useRef<{ tool: ImageTool; points: Point[]; color: string; width: number } | null>(
    null,
  )
  const mounted = useRef(true)
  const saveLock = useRef(false)
  const cancelExport = useRef<(() => void) | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelExport.current?.()
    }
  }, [])
  const scale = Math.min(layout.width / current.crop.width, layout.height / current.crop.height)
  const display = { width: current.crop.width * scale, height: current.crop.height * scale }
  const point = (event: GestureResponderEvent) =>
    imagePoint(
      { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
      display,
      current.crop,
    )
  const begin = (event: GestureResponderEvent) => {
    const start = point(event)
    gesture.current = {
      tool,
      points: [start],
      color,
      width: (size / scale) * (tool === 'highlight' ? 4 : 1),
    }
    if (tool === 'crop') setSelection({ start, end: start })
    else setDraft({ tool, points: [start], color, width: gesture.current.width })
  }
  const move = (event: GestureResponderEvent) => {
    const active = gesture.current
    if (!active) return
    const next = point(event)
    if (active.tool === 'crop') setSelection({ start: active.points[0]!, end: next })
    else {
      if (active.tool === 'pen' || active.tool === 'highlight') active.points.push(next)
      else active.points = [active.points[0]!, next]
      setDraft({ ...active, tool: active.tool, points: [...active.points] })
    }
  }
  const end = (event: GestureResponderEvent) => {
    const active = gesture.current
    if (!active) return
    const last = point(event)
    if (active.tool === 'crop') {
      const crop = cropBounds(active.points[0]!, last)
      // Ignore accidental taps and tiny crops; the threshold is in screen points.
      if (crop.width * scale >= 12 && crop.height * scale >= 12)
        dispatch({ type: 'commit', edit: { ...current, crop } })
    } else {
      const points =
        active.tool === 'pen' || active.tool === 'highlight'
          ? [...active.points, last]
          : [active.points[0]!, last]
      dispatch({
        type: 'commit',
        edit: { ...current, marks: [...current.marks, { ...active, tool: active.tool, points }] },
      })
    }
    gesture.current = null
    setDraft(null)
    setSelection(null)
  }
  const save = async () => {
    if (saveLock.current || !ready) return
    if (history.index === 0) {
      onFinish(image.asset)
      return
    }
    saveLock.current = true
    setSaving(true)
    setError('')
    let file: File | undefined
    let output: File | undefined
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cancelExport.current = null
          reject(new Error('Could not export this image. Please try again.'))
        }, 15000)
        cancelExport.current = () => {
          clearTimeout(timeout)
          reject(new Error('Image editing cancelled.'))
        }
        exportResult.current = (value) => {
          clearTimeout(timeout)
          cancelExport.current = null
          exportResult.current = null
          if (value instanceof Error) reject(value)
          else if (value) resolve(value.replace(/\s/g, ''))
          else reject(new Error('Could not export this image. Please try again.'))
        }
      })
      if (!mounted.current) return
      file = new File(Paths.cache, `edited-${randomUUID()}.png`)
      await file.write(data, { encoding: 'base64' })
      if (!mounted.current) {
        if (file.exists) file.delete()
        return
      }
      // iOS SVG snapshots include the screen scale; normalize to image pixels.
      const context = ImageManipulator.manipulate(file.uri).resize({
        width: current.crop.width,
        height: current.crop.height,
      })
      try {
        const rendered = await context.renderAsync()
        try {
          output = new File((await rendered.saveAsync({ format: SaveFormat.PNG })).uri)
        } finally {
          rendered.release()
        }
      } finally {
        context.release()
        if (file.exists) file.delete()
      }
      if (!mounted.current) {
        if (output.exists) output.delete()
        return
      }
      onFinish({
        uri: output.uri,
        name: `${image.asset.name.replace(/\.[^.]+$/, '').slice(0, 220)}-edited.png`,
        mimeType: 'image/png',
      })
      output = undefined
    } catch (cause) {
      if (file?.exists) file.delete()
      if (output?.exists) output.delete()
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      exportResult.current = null
      saveLock.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    selected = false,
    Glyph?: LucideIcon,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        alignItems: 'center',
        paddingHorizontal: 12,
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: selected ? colors.selection : 'transparent',
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      {Glyph ? (
        <Glyph size={20} color={selected ? colors.accent : colors.text} accessible={false} />
      ) : (
        <Text
          style={{ color: selected ? colors.accent : colors.text, fontSize: 15, fontWeight: '600' }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
  const selectionBox = selection ? cropBounds(selection.start, selection.end) : null
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 8,
        }}
      >
        {button('Cancel', () => onFinish(null), saving)}
        <Text style={styles.title}>Edit image</Text>
        {button('Done', () => void save(), saving || !ready || !!draft || !!selection)}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 8 }}
      >
        {tools.map((item) =>
          button(item.label, () => setTool(item.tool), saving, tool === item.tool, item.icon),
        )}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 }}>
        <View style={{ flexDirection: 'row' }}>
          {button(
            'Undo',
            () => dispatch({ type: 'undo' }),
            saving || history.index === 0,
            false,
            Undo2,
          )}
          {button(
            'Redo',
            () => dispatch({ type: 'redo' }),
            saving || history.index === history.steps.length - 1,
            false,
            Redo2,
          )}
        </View>
        {button(
          'Reset',
          () => dispatch({ type: 'reset' }),
          saving || history.steps.length === 1,
          false,
          RotateCcw,
        )}
      </View>
      {tool !== 'crop' && (
        <View style={{ paddingHorizontal: 8, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {swatches.map((swatch) => (
              <Pressable
                key={swatch.name}
                accessibilityRole="button"
                accessibilityLabel={swatch.name}
                accessibilityState={{ selected: color === swatch.color, disabled: saving }}
                disabled={saving}
                onPress={() => setColor(swatch.color)}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: swatch.color,
                    borderWidth: color === swatch.color ? 3 : 1,
                    borderColor: color === swatch.color ? colors.accent : colors.border,
                  }}
                />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
            {[
              { label: 'Thin', size: 3 },
              { label: 'Medium', size: 6 },
              { label: 'Thick', size: 10 },
            ].map((item) =>
              button(item.label, () => setSize(item.size), saving, size === item.size),
            )}
          </View>
        </View>
      )}
      <Text
        style={[styles.muted, { textAlign: 'center', paddingHorizontal: 12, paddingVertical: 6 }]}
      >
        {tool === 'crop'
          ? 'Drag across the area to keep. Undo to restore.'
          : `${tools.find((item) => item.tool === tool)?.label} · Draw on the image. Tap Done to attach.`}
      </Text>
      <View style={{ flex: 1, padding: 12 }}>
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
        >
          {layout.width > 24 && layout.height > 24 && (
            <View
              accessibilityLabel="Image drawing area"
              style={{ width: display.width, height: display.height }}
              onStartShouldSetResponder={() => ready && !saving}
              onMoveShouldSetResponder={() => ready && !saving}
              onResponderGrant={begin}
              onResponderMove={move}
              onResponderRelease={end}
              onResponderTerminationRequest={() => false}
              onResponderTerminate={() => {
                gesture.current = null
                setDraft(null)
                setSelection(null)
              }}
            >
              <Svg
                pointerEvents="none"
                width={display.width}
                height={display.height}
                viewBox={`${current.crop.x} ${current.crop.y} ${current.crop.width} ${current.crop.height}`}
              >
                <ImageDrawing
                  image={image}
                  marks={[...current.marks, ...(draft ? [draft] : [])]}
                  onLoad={() => setReady(true)}
                />
              </Svg>
              {selectionBox && (
                <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
                  <Svg
                    width={display.width}
                    height={display.height}
                    viewBox={`${current.crop.x} ${current.crop.y} ${current.crop.width} ${current.crop.height}`}
                  >
                    <Path
                      d={`M ${current.crop.x} ${current.crop.y} h ${current.crop.width} v ${current.crop.height} h ${-current.crop.width} Z M ${selectionBox.x} ${selectionBox.y} v ${selectionBox.height} h ${selectionBox.width} v ${-selectionBox.height} Z`}
                      fill="#000000"
                      fillOpacity={0.55}
                      fillRule="evenodd"
                    />
                    <Rect {...selectionBox} fill="none" stroke="#ffffff" strokeWidth={2 / scale} />
                  </Svg>
                </View>
              )}
            </View>
          )}
          {!ready && (
            <ActivityIndicator
              accessibilityLabel="Loading image"
              style={{ position: 'absolute' }}
            />
          )}
        </View>
      </View>
      {saving && (
        <ExportImage
          image={image}
          edit={current}
          onResult={(value) => exportResult.current?.(value)}
        />
      )}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { paddingHorizontal: 16 }]}>
          {error}
        </Text>
      ) : null}
      <View style={{ alignItems: 'center', paddingBottom: 8 }}>
        {saving ? (
          <ActivityIndicator accessibilityLabel="Saving image" />
        ) : (
          button('Use original', () => onFinish(image.asset))
        )}
      </View>
    </View>
  )
}

function ImageDrawing({
  image,
  marks,
  onLoad,
}: {
  image: EditableImage
  marks: Mark[]
  onLoad: () => void
}) {
  return (
    <>
      <SvgImage href={image.asset.uri} width={image.width} height={image.height} onLoad={onLoad} />
      {marks.map((mark, index) => (
        <Path
          key={index}
          d={markPath(mark)}
          fill="none"
          stroke={mark.color}
          strokeWidth={mark.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={mark.tool === 'highlight' ? 0.35 : 1}
        />
      ))}
    </>
  )
}

/** Export a separate full-resolution surface, independent of the preview's screen size.
 * Keep native snapshot allocation near the source dimensions on high-density screens. */
function ExportImage({
  image,
  edit,
  onResult,
}: {
  image: EditableImage
  edit: ImageEdit
  onResult: (data: string | Error) => void
}) {
  const svg = useRef<Svg>(null)
  const [loaded, setLoaded] = useState(false)
  const [laidOut, setLaidOut] = useState(false)
  const density = PixelRatio.get()
  const width = Math.ceil(edit.crop.width / density)
  const height = Math.ceil(edit.crop.height / density)
  const result = useRef(onResult)
  result.current = onResult
  useEffect(() => {
    if (!loaded || !laidOut) return
    const frame = requestAnimationFrame(() => {
      try {
        svg.current?.toDataURL((data) => result.current(data), {
          width: Platform.OS === 'ios' ? width : edit.crop.width,
          height: Platform.OS === 'ios' ? height : edit.crop.height,
        })
      } catch (cause) {
        result.current(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [loaded, laidOut, width, height, edit.crop.width, edit.crop.height])
  return (
    <Svg
      ref={svg}
      pointerEvents="none"
      accessible={false}
      style={{ position: 'absolute', left: -10000, top: 0 }}
      width={width}
      height={height}
      preserveAspectRatio="none"
      viewBox={`${edit.crop.x} ${edit.crop.y} ${edit.crop.width} ${edit.crop.height}`}
      onLayout={() => setLaidOut(true)}
    >
      <ImageDrawing image={image} marks={edit.marks} onLoad={() => setLoaded(true)} />
    </Svg>
  )
}
