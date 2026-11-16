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
const tableRows = z
  .array(z.object({ id, cells: z.record(cell) }).strict())
  .max(100)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Use unique row IDs')
const child = CommonSchemas.ComponentId.min(1).max(120)
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

// One catalog defines the protocol on the runtime and the browser renderer.
// It intentionally has no functions, URLs, HTML, or executable component properties.
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
  Button: { name: 'Button', schema: z.object({ label: string, action }).strict() },
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
        value: strings,
        multiple: z.boolean().optional(),
        required: z.boolean().optional(),
        searchable: z.boolean().optional(),
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
const inputTypes = new Set(['TextField', 'CheckBox', 'ChoicePicker', 'NumberField', 'DataTable'])
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
      for (const component of surface.componentsModel.componentsMap.values()) {
        const api = a2uiCatalog.components.get(component.type)
        if (!api) throw new Error('Unknown A2UI component')
        api.schema.parse(component.properties)
        if (inputTypes.has(component.type)) binding.parse(component.properties.value)
        if (component.type === 'NumberField') {
          const props = a2uiApis.NumberField.schema.parse(component.properties)
          if (props.min !== undefined && props.max !== undefined && props.min > props.max)
            throw new Error('A2UI number minimum exceeds its maximum')
        }
        if (component.type === 'DataTable') {
          const props = a2uiApis.DataTable.schema.parse(component.properties)
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
        return inputTypes.has(component.type) && bound.success && bound.data['@path'] === path
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
  if (complete) a2uiValidateInputs(processor)
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
      a2uiCatalog.components.get(component.type)?.schema.parse(resolve(component.properties))
      if (component.type === 'Progress') {
        const props = a2uiApis.Progress.schema.parse(resolve(component.properties))
        if (typeof props.value !== 'number' || props.value < 0 || props.value > props.max)
          throw new Error('A2UI progress must be between zero and its maximum')
      }
    }
  }
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
      if (!inputTypes.has(field.type)) continue
      const bound = binding.parse(field.properties.value)
      const current: unknown = surface.dataModel.get<unknown>(bound['@path'])
      if (field.type === 'NumberField') validateNumber(field.properties, current ?? null)
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
      if (!inputTypes.has(field.type)) continue
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
  if (!surface || component?.type !== 'Button') throw new Error('Unknown A2UI action')
  const event = a2uiApis.Button.schema.parse(component.properties).action.event
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
