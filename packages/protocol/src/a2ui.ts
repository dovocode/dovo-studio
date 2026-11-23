import { z } from 'zod3'
import { Catalog, MessageProcessor, type ComponentApi, type ActionListener } from '@a2ui/web_core'
import { CommonSchemas } from '@a2ui/web_core/v1_0'

export const A2UI_CATALOG_ID = 'https://dovo.dev/a2ui/catalog/v1'
export const A2UI_MAX_BYTES = 256 * 1024
const id = z.string().min(1).max(120)
const pointer = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\//)
  .refine(
    (path) =>
      !path.split('/').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)),
    'Use a safe absolute JSON Pointer',
  )
const binding = z.object({ '@path': pointer }).strict().describe('REF:#/$defs/DataBinding')
const string = z.union([z.string().max(4000), binding]).describe('REF:#/$defs/DynamicString')
const boolean = z.union([z.boolean(), binding]).describe('REF:#/$defs/DynamicBoolean')
const strings = z
  .union([z.array(z.string().max(200)).max(100), binding])
  .describe('REF:#/$defs/DynamicStringList')
const number = z
  .union([z.number().finite(), z.null(), binding])
  .describe('REF:#/$defs/DynamicNumber')
const tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger'])
const cell = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()])
const child = CommonSchemas.ComponentId.min(1).max(120)
const tableRows = z
  .array(z.object({ id, cells: z.record(cell), detail: child.optional() }).strict())
  .max(100)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Use unique row IDs')
const lineNumber = z.number().int().min(0).max(1_000_000_000)
const diffHunk = z
  .object({
    oldStart: lineNumber,
    newStart: lineNumber,
    lines: z
      .array(
        z
          .object({
            kind: z.enum(['context', 'add', 'delete']),
            text: z
              .string()
              .max(4000)
              .regex(/^[^\r\n]*$/),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine(
    ({ oldStart, newStart, lines }) =>
      (oldStart !== 0 || lines.every(({ kind }) => kind === 'add')) &&
      (newStart !== 0 || lines.every(({ kind }) => kind === 'delete')),
    'Use a zero starting line only on an empty side of the diff',
  )
const children = CommonSchemas.ChildList.refine(
  (value) => Array.isArray(value) && value.length <= 100,
  'Use a static child list with at most 100 children',
)
const value = z.union([
  z.string().max(4000),
  z.boolean(),
  z.number().finite(),
  z.null(),
  z.array(z.string().max(200)).max(100),
])
const action = z
  .object({
    event: z
      .object({
        name: id,
        context: z.record(z.union([value, binding])).optional(),
      })
      .strict(),
  })
  .strict()
  .describe('REF:#/$defs/Action')

const iconName = z.enum([
  'accountCircle',
  'add',
  'arrowBack',
  'arrowForward',
  'attachFile',
  'calendarToday',
  'call',
  'camera',
  'check',
  'close',
  'delete',
  'download',
  'edit',
  'event',
  'error',
  'fastForward',
  'favorite',
  'favoriteOff',
  'folder',
  'help',
  'home',
  'info',
  'locationOn',
  'lock',
  'lockOpen',
  'mail',
  'menu',
  'moreVert',
  'moreHoriz',
  'notificationsOff',
  'notifications',
  'pause',
  'payment',
  'person',
  'phone',
  'photo',
  'play',
  'print',
  'refresh',
  'rewind',
  'search',
  'send',
  'settings',
  'share',
  'shoppingCart',
  'skipNext',
  'skipPrevious',
  'star',
  'starHalf',
  'starOff',
  'stop',
  'upload',
  'visibility',
  'visibilityOff',
  'volumeDown',
  'volumeMute',
  'volumeOff',
  'volumeUp',
  'warning',
])

const mediaUrl = (kind: 'image' | 'audio' | 'video') =>
  z
    .union([
      z
        .string()
        .max(A2UI_MAX_BYTES)
        .refine((input) => {
          if (input.startsWith('data:')) {
            const comma = input.indexOf(',')
            const formats = {
              image: /^image\/(?:png|jpeg|gif|webp|avif);base64$/i,
              audio: /^audio\/(?:mpeg|mp4|ogg|wav|webm);base64$/i,
              video: /^video\/(?:mp4|ogg|webm);base64$/i,
            }
            return (
              comma > 0 &&
              formats[kind].test(input.slice(5, comma)) &&
              /^[a-z\d+/]+={0,2}$/i.test(input.slice(comma + 1))
            )
          }
          if (!/^https?:\/\//i.test(input) || /[\s\\]/.test(input)) return false
          try {
            const url = new URL(input)
            return !url.username && !url.password
          } catch {
            return false
          }
        }, `Use an HTTP, HTTPS or supported ${kind} data URL`),
      binding,
    ])
    .describe('REF:#/$defs/DynamicString')

export function a2uiDateTimeType({
  enableDate,
  enableTime,
}: {
  enableDate?: boolean
  enableTime?: boolean
}) {
  if (enableTime) return enableDate ? 'datetime-local' : 'time'
  return 'date'
}

// One catalog defines the protocol on the runtime and the browser renderer.
// Media URLs are only accepted on declared media components.
export const a2uiApis = {
  Text: {
    name: 'Text',
    schema: z
      .object({ text: string, variant: z.enum(['body', 'heading', 'caption']).optional() })
      .strict(),
  },
  Column: { name: 'Column', schema: z.object({ children }).strict() },
  Row: { name: 'Row', schema: z.object({ children }).strict() },
  List: { name: 'List', schema: z.object({ children }).strict() },
  Card: { name: 'Card', schema: z.object({ child }).strict() },
  Divider: { name: 'Divider', schema: z.object({}).strict() },
  TextField: {
    name: 'TextField',
    schema: z
      .object({
        label: string,
        value: string,
        multiline: z.boolean().optional(),
        required: z.boolean().optional(),
      })
      .strict(),
  },
  CheckBox: { name: 'CheckBox', schema: z.object({ label: string, value: boolean }).strict() },
  ChoicePicker: {
    name: 'ChoicePicker',
    schema: z
      .object({
        label: string,
        value: strings,
        multiple: z.boolean().optional(),
        required: z.boolean().optional(),
        options: z
          .array(
            z
              .object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) })
              .strict(),
          )
          .min(1)
          .max(100)
          .refine(
            (options) => new Set(options.map((option) => option.value)).size === options.length,
            'Choice values must be unique',
          ),
      })
      .strict(),
  },
  Button: {
    name: 'Button',
    schema: z.object({ label: string, action: action.optional() }).strict(),
  },
  Image: {
    name: 'Image',
    schema: z
      .object({
        url: mediaUrl('image'),
        description: string.optional(),
        fit: z.enum(['contain', 'cover', 'fill', 'none', 'scaleDown']).optional(),
        variant: z
          .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
          .optional(),
      })
      .strict(),
  },
  Icon: {
    name: 'Icon',
    schema: z.object({ name: z.union([iconName, binding]) }).strict(),
  },
  Video: {
    name: 'Video',
    schema: z
      .object({
        url: mediaUrl('video'),
        posterUrl: mediaUrl('image').optional(),
        description: string.optional(),
      })
      .strict(),
  },
  AudioPlayer: {
    name: 'AudioPlayer',
    schema: z.object({ url: mediaUrl('audio'), description: string.optional() }).strict(),
  },
  Modal: {
    name: 'Modal',
    schema: z
      .object({
        trigger: CommonSchemas.Child,
        content: CommonSchemas.Child,
        title: string.optional(),
      })
      .strict(),
  },
  Slider: {
    name: 'Slider',
    schema: z
      .object({
        label: string.optional(),
        value: number,
        min: z.number().finite().optional(),
        max: z.number().finite(),
        steps: z.number().int().min(1).max(10000).optional(),
      })
      .strict(),
  },
  DateTimeInput: {
    name: 'DateTimeInput',
    schema: z
      .object({
        label: string.optional(),
        value: string,
        enableDate: z.boolean().optional(),
        enableTime: z.boolean().optional(),
        min: string.optional(),
        max: string.optional(),
        required: z.boolean().optional(),
      })
      .strict(),
  },
  Badge: { name: 'Badge', schema: z.object({ text: string, tone: tone.optional() }).strict() },
  Callout: {
    name: 'Callout',
    schema: z.object({ title: string, text: string, tone: tone.optional() }).strict(),
  },
  Metric: {
    name: 'Metric',
    schema: z
      .object({ label: string, value: string, detail: string.optional(), tone: tone.optional() })
      .strict(),
  },
  Progress: {
    name: 'Progress',
    schema: z
      .object({ label: string, value: number, max: z.number().finite().positive() })
      .strict(),
  },
  CodeBlock: {
    name: 'CodeBlock',
    schema: z.object({ code: string, language: z.string().max(40).optional() }).strict(),
  },
  Tabs: {
    name: 'Tabs',
    schema: z
      .object({
        label: string,
        tabs: z
          .array(z.object({ title: z.string().min(1).max(120), child }).strict())
          .min(1)
          .max(8)
          .refine(
            (tabs) => new Set(tabs.map((tab) => tab.child)).size === tabs.length,
            'A2UI tabs must use unique child IDs',
          ),
      })
      .strict(),
  },
  Disclosure: {
    name: 'Disclosure',
    schema: z.object({ title: string, child, open: z.boolean().optional() }).strict(),
  },
  NumberField: {
    name: 'NumberField',
    schema: z
      .object({
        label: string,
        value: number,
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        step: z.number().finite().positive().optional(),
        required: z.boolean().optional(),
      })
      .strict(),
  },
  DataTable: {
    name: 'DataTable',
    schema: z
      .object({
        label: string,
        columns: z
          .array(z.object({ key: id, label: z.string().min(1).max(120) }).strict())
          .min(1)
          .max(12)
          .refine(
            (columns) => new Set(columns.map((column) => column.key)).size === columns.length,
            'Use unique column keys',
          ),
        rows: tableRows,
        value: strings.optional(),
        multiple: z.boolean().optional(),
        required: z.boolean().optional(),
        searchable: z.boolean().optional(),
      })
      .strict(),
  },
  Diff: {
    name: 'Diff',
    schema: z
      .object({
        label: string,
        hunks: z
          .array(diffHunk)
          .min(1)
          .max(8)
          .refine(
            (hunks) => hunks.reduce((count, hunk) => count + hunk.lines.length, 0) <= 200,
            'Use at most 200 diff lines',
          ),
      })
      .strict(),
  },
  Timeline: {
    name: 'Timeline',
    schema: z
      .object({
        label: string,
        items: z
          .array(
            z
              .object({
                id,
                title: string,
                time: z.string().datetime({ offset: true }).optional(),
                detail: string.optional(),
                status: string.optional(),
                tone: tone.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(40)
          .refine(
            (items) => new Set(items.map((item) => item.id)).size === items.length,
            'Use unique timeline item IDs',
          ),
      })
      .strict(),
  },
  BarChart: {
    name: 'BarChart',
    schema: z
      .object({
        label: string,
        items: z
          .array(
            z
              .object({
                label: z.string().min(1).max(120),
                value: z.number().finite().nonnegative(),
              })
              .strict(),
          )
          .min(1)
          .max(40),
        suffix: z.string().max(40).optional(),
      })
      .strict(),
  },
}
const inputTypes = new Set([
  'TextField',
  'CheckBox',
  'ChoicePicker',
  'NumberField',
  'Slider',
  'DateTimeInput',
])

function isInput(component: { type: string; properties: Record<string, unknown> }) {
  return (
    inputTypes.has(component.type) ||
    (component.type === 'DataTable' && component.properties.value !== undefined)
  )
}

function modalTriggers(
  components: Iterable<{ type: string; properties: Record<string, unknown> }>,
) {
  return new Set(
    [...components].flatMap((node) => (node.type === 'Modal' ? [node.properties.trigger] : [])),
  )
}
export const a2uiCatalog = new Catalog(A2UI_CATALOG_ID, '1.0', Object.values(a2uiApis))
const message = z.record(z.unknown())
export const a2uiValuesSchema = z.record(z.record(value))
export type A2uiValues = z.infer<typeof a2uiValuesSchema>
export const a2uiStateSchema = z.object({
  revision: z.number().int().positive(),
  draftVersion: z.number().int().nonnegative(),
  messages: z.array(message).max(128),
  values: a2uiValuesSchema,
  submitted: z.boolean(),
  delivery: z.enum(['pending', 'sent', 'uncertain']).optional(),
  readOnly: z.boolean().optional(),
})
export type A2uiState = z.infer<typeof a2uiStateSchema>
export const a2uiCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('catalog') }).strict(),
  z.object({ action: z.literal('read'), key: id }).strict(),
  z
    .object({
      action: z.literal('publish'),
      key: id,
      title: id,
      expectedRevision: z.number().int().nonnegative(),
      messages: z.array(message).min(1).max(32),
    })
    .strict(),
])
export type A2uiCommand = z.infer<typeof a2uiCommandSchema>
export const a2uiDraftSchema = z
  .object({
    revision: z.number().int().positive(),
    draftVersion: z.number().int().nonnegative(),
    values: a2uiValuesSchema,
  })
  .strict()
export const a2uiSubmitSchema = a2uiDraftSchema
  .extend({ surfaceId: id, sourceComponentId: id })
  .strict()

export function a2uiBounded(value: unknown) {
  const encoded = JSON.stringify(value)
  if (!encoded || new TextEncoder().encode(encoded).length > A2UI_MAX_BYTES)
    throw new Error('A2UI content exceeds the 256 KiB limit')
}

export function a2uiProcessor(messages: unknown[]): MessageProcessor
export function a2uiProcessor<T extends ComponentApi>(
  messages: unknown[],
  catalog: Catalog<T>,
  onAction?: ActionListener,
): MessageProcessor<T>
export function a2uiProcessor(
  messages: unknown[],
  catalog: Catalog<ComponentApi> = a2uiCatalog,
  onAction?: ActionListener,
) {
  a2uiBounded(messages)
  for (const entry of messages) {
    const envelope = message.parse(entry)
    const keys = Object.keys(envelope)
    if (
      envelope.version !== '1.0' ||
      keys.length !== 2 ||
      !keys.some((key) =>
        ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'].includes(key),
      )
    )
      throw new Error(
        'Use A2UI v1.0 createSurface, updateComponents, updateDataModel or deleteSurface messages',
      )
  }
  const processor = new MessageProcessor([catalog], onAction, {
    version: 'v1.0',
    validationConfig: {
      targetVersion: 'v1.0',
      maxDepth: 20,
      allowedMessages: ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'],
    },
  })
  try {
    // The upstream data model mutates the supplied initial object. Keep caller data intact.
    const errors = processor.processMessagesWithErrors(structuredClone(messages))
    if (errors.length)
      throw new Error(`Invalid A2UI messages: ${JSON.stringify(errors).slice(0, 2000)}`)
    if (processor.model.surfacesMap.size > 4)
      throw new Error('A2UI supports at most four surfaces per card')
    let count = 0
    for (const surface of processor.model.surfacesMap.values()) {
      if (surface.defaultCatalog?.id !== A2UI_CATALOG_ID)
        throw new Error('Use the Dovo A2UI catalog')
      count += surface.componentsModel.componentsMap.size
      const triggers = modalTriggers(surface.componentsModel.componentsMap.values())
      for (const component of surface.componentsModel.componentsMap.values()) {
        const api = a2uiCatalog.components.get(component.type)
        if (!api) throw new Error('Unknown A2UI component')
        api.schema.parse(component.properties)
        if (isInput(component)) binding.parse(component.properties.value)
        if (component.type === 'Modal') {
          const props = a2uiApis.Modal.schema.parse(component.properties)
          if (
            surface.componentsModel.get(props.trigger)?.type !== 'Button' ||
            props.trigger === props.content
          )
            throw new Error('An A2UI Modal requires a Button trigger and separate content')
        }
        if (
          component.type === 'Button' &&
          !triggers.has(component.id) &&
          !component.properties.action
        )
          throw new Error('An A2UI Button requires an action outside a Modal trigger')
        if (component.type === 'NumberField') {
          const props = a2uiApis.NumberField.schema.parse(component.properties)
          if (props.min !== undefined && props.max !== undefined && props.min > props.max)
            throw new Error('A2UI number minimum exceeds its maximum')
        }
        if (component.type === 'DataTable') {
          const props = a2uiApis.DataTable.schema.parse(component.properties)
          if (
            props.value === undefined &&
            (props.required !== undefined || props.multiple !== undefined)
          )
            throw new Error('A2UI table selection options require a value binding')
          if (
            props.rows.some((row) =>
              Object.keys(row.cells).some(
                (key) => !props.columns.some((column) => column.key === key),
              ),
            )
          )
            throw new Error('A2UI table cells must use declared columns')
        }
      }
    }
    if (count > 200) throw new Error('A2UI supports at most 200 components per card')
    a2uiApplyValues(processor, a2uiInputValues(processor))
    return processor
  } catch (error) {
    processor.dispose()
    throw error
  }
}

/** Store a bounded snapshot, rather than an ever-growing protocol message log. */
export function a2uiMessages(processor: MessageProcessor): Record<string, unknown>[] {
  return structuredClone(
    [...processor.model.surfacesMap.values()].map((surface) => ({
      version: '1.0',
      createSurface: {
        surfaceId: surface.id,
        catalogId: A2UI_CATALOG_ID,
        components: [...surface.componentsModel.componentsMap.values()].map(
          (component) => component.componentTree,
        ),
        dataModel: surface.dataModel.get<unknown>('/'),
      },
    })),
  )
}

/** Client values can change only data bindings declared by input components. */
export function a2uiApplyValues(processor: MessageProcessor, input: unknown, complete = false) {
  a2uiBounded(input)
  const values = a2uiValuesSchema.parse(input)
  for (const [surfaceId, entries] of Object.entries(values)) {
    const surface = processor.model.surfacesMap.get(surfaceId)
    if (!surface) throw new Error('Unknown A2UI surface')
    for (const [path, entry] of Object.entries(entries)) {
      pointer.parse(path)
      const fields = [...surface.componentsModel.componentsMap.values()].filter((component) => {
        const bound = binding.safeParse(component.properties.value)
        return isInput(component) && bound.success && bound.data['@path'] === path
      })
      if (!fields.length) throw new Error('Unknown A2UI input binding')
      for (const field of fields) {
        if (field.type === 'TextField') z.string().max(4000).parse(entry)
        if (field.type === 'CheckBox') z.boolean().parse(entry)
        if (field.type === 'ChoicePicker') {
          const props = a2uiApis.ChoicePicker.schema.parse(field.properties)
          const selected = z
            .array(z.string())
            .max(props.multiple ? 100 : 1)
            .parse(entry)
          if (
            new Set(selected).size !== selected.length ||
            selected.some((item) => !props.options.some((option) => option.value === item))
          )
            throw new Error('Choose a valid A2UI option')
        }
        if (field.type === 'NumberField') validateNumber(field.properties, entry)
        if (field.type === 'DataTable') {
          const props = a2uiApis.DataTable.schema.parse(field.properties)
          const selected = z
            .array(z.string())
            .max(props.multiple === false ? 1 : 100)
            .parse(entry)
          if (
            new Set(selected).size !== selected.length ||
            selected.some((id) => !props.rows.some((row) => row.id === id))
          )
            throw new Error('Choose a valid A2UI table row')
        }
      }
      surface.dataModel.set(path, entry, true)
    }
  }
  a2uiValidateInputs(processor, complete)
  // Validate resolved properties too. Input bindings can share paths with display components.
  for (const surface of processor.model.surfacesMap.values()) {
    for (const component of surface.componentsModel.componentsMap.values()) {
      const resolve = (input: unknown): unknown => {
        const bound = binding.safeParse(input)
        if (bound.success) return surface.dataModel.get<unknown>(bound.data['@path'])
        if (Array.isArray(input)) return input.map(resolve)
        if (input && typeof input === 'object')
          return Object.fromEntries(
            Object.entries(input).map(([key, item]) => [key, resolve(item)]),
          )
        return input
      }
      const resolved = resolve(component.properties)
      a2uiCatalog.components.get(component.type)?.schema.parse(resolved)
      if (component.type === 'Progress') {
        const props = a2uiApis.Progress.schema.parse(resolved)
        if (typeof props.value !== 'number' || props.value < 0 || props.value > props.max)
          throw new Error('A2UI progress must be between zero and its maximum')
      }
      if (component.type === 'Slider') {
        const { min = 0, max, steps, value } = a2uiApis.Slider.schema.parse(resolved)
        const range = max - min
        if (
          !Number.isFinite(range) ||
          range <= 0 ||
          typeof value !== 'number' ||
          value < min ||
          value > max
        )
          throw new Error('A2UI Slider value must be within an increasing finite range')
        if (steps !== undefined) {
          const position = ((value - min) / range) * steps
          if (range / steps === 0 || Math.abs(position - Math.round(position)) > 1e-9)
            throw new Error('A2UI Slider value must match one of its steps')
        }
      }
    }
  }
}

function validateDateTime(props: {
  enableDate?: boolean
  enableTime?: boolean
  value: unknown
  min: unknown
  max: unknown
}) {
  const type = a2uiDateTimeType(props)
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/
  function normalize(value: unknown) {
    if (typeof value !== 'string') throw new Error('Use an A2UI date or time string')
    const [datePart, timePart, extra] =
      type === 'time' ? [undefined, value, undefined] : value.split('T')
    if (
      extra !== undefined ||
      (type !== 'time' && !z.string().date().safeParse(datePart).success) ||
      (type === 'date' ? timePart !== undefined : !time.test(timePart ?? ''))
    )
      throw new Error(`Use an ISO local ${type} value for A2UI DateTimeInput`)
    if (!timePart) return datePart ?? ''
    const [clock, fraction = ''] = timePart.split('.')
    const normalized = `${clock.length === 5 ? `${clock}:00` : clock}.${fraction.padEnd(3, '0')}`
    return datePart ? `${datePart}T${normalized}` : normalized
  }
  const min = props.min === undefined ? undefined : normalize(props.min)
  const max = props.max === undefined ? undefined : normalize(props.max)
  const value = props.value === '' ? undefined : normalize(props.value)
  if ((min && max && min > max) || (value && ((min && value < min) || (max && value > max))))
    throw new Error('A2UI DateTimeInput value is outside its allowed range')
}

function validateNumber(properties: Record<string, unknown>, input: unknown) {
  const props = a2uiApis.NumberField.schema.parse(properties)
  if (input === null) return
  const current = z.number().finite().parse(input)
  if (
    (props.min !== undefined && current < props.min) ||
    (props.max !== undefined && current > props.max)
  )
    throw new Error(
      `A2UI number is outside its allowed range (${props.min ?? 'unbounded'} to ${props.max ?? 'unbounded'})`,
    )
  if (props.step !== undefined) {
    const steps = (current - (props.min ?? 0)) / props.step
    if (
      !Number.isFinite(steps) ||
      Math.abs(steps - Math.round(steps)) > Number.EPSILON * Math.max(1, Math.abs(steps)) * 8
    )
      throw new Error('A2UI number does not match its step')
  }
}

/** Validate before requesting approval. This reads the current model without writing draft values. */
export function a2uiValidateInputs(processor: MessageProcessor, complete = true) {
  for (const surface of processor.model.surfacesMap.values()) {
    for (const field of surface.componentsModel.componentsMap.values()) {
      if (!isInput(field)) continue
      const bound = binding.parse(field.properties.value)
      const current: unknown = surface.dataModel.get<unknown>(bound['@path'])
      if (field.type === 'NumberField') validateNumber(field.properties, current ?? null)
      if (field.type === 'DateTimeInput') {
        const props = a2uiApis.DateTimeInput.schema.parse(field.properties)
        const resolve = (bound: typeof props.min) =>
          typeof bound === 'object' ? surface.dataModel.get<unknown>(bound['@path']) : bound
        validateDateTime({
          ...props,
          value: current,
          min: resolve(props.min),
          max: resolve(props.max),
        })
      }
      if (
        complete &&
        field.properties.required &&
        (current === undefined ||
          current === null ||
          (typeof current === 'string' && !current.trim()) ||
          (Array.isArray(current) && !current.length))
      ) {
        const label = binding.safeParse(field.properties.label)
        const name = label.success
          ? surface.dataModel.get<unknown>(label.data['@path'])
          : field.properties.label
        throw new Error(
          `Complete the required A2UI fields: ${typeof name === 'string' ? name : field.type}`,
        )
      }
    }
  }
}

export function a2uiInputValues(processor: MessageProcessor): A2uiValues {
  const values: A2uiValues = {}
  for (const surface of processor.model.surfacesMap.values()) {
    const entries: A2uiValues[string] = {}
    for (const field of surface.componentsModel.componentsMap.values()) {
      if (!isInput(field)) continue
      const bound = binding.safeParse(field.properties.value)
      if (bound.success)
        entries[bound.data['@path']] = value.parse(
          surface.dataModel.get<unknown>(bound.data['@path']) ??
            (field.type === 'CheckBox'
              ? false
              : ['ChoicePicker', 'DataTable'].includes(field.type)
                ? []
                : field.type === 'NumberField'
                  ? null
                  : field.type === 'Slider'
                    ? (field.properties.min ?? 0)
                    : ''),
        )
    }
    values[surface.id] = entries
  }
  return values
}

export function a2uiEvent(processor: MessageProcessor, surfaceId: string, componentId: string) {
  const surface = processor.model.surfacesMap.get(surfaceId)
  const component = surface?.componentsModel.get(componentId)
  if (
    !surface ||
    component?.type !== 'Button' ||
    modalTriggers(surface.componentsModel.componentsMap.values()).has(componentId)
  )
    throw new Error('Unknown A2UI action')
  const event = a2uiApis.Button.schema.parse(component.properties).action?.event
  if (!event) throw new Error('Unknown A2UI action')
  return {
    name: event.name,
    surfaceId,
    sourceComponentId: componentId,
    context: Object.fromEntries(
      Object.entries(event.context ?? {}).map(([key, entry]) => {
        const bound = binding.safeParse(entry)
        return [key, bound.success ? surface.dataModel.get<unknown>(bound.data['@path']) : entry]
      }),
    ),
  }
}
