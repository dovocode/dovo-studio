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
      for (const component of surface.componentsModel.componentsMap.values()) {
        const api = a2uiCatalog.components.get(component.type)
        if (!api) throw new Error('Unknown A2UI component')
        api.schema.parse(component.properties)
        if (['TextField', 'CheckBox', 'ChoicePicker'].includes(component.type))
          binding.parse(component.properties.value)
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
        return (
          ['TextField', 'CheckBox', 'ChoicePicker'].includes(component.type) &&
          bound.success &&
          bound.data['@path'] === path
        )
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
      }
      surface.dataModel.set(path, entry, true)
    }
  }
  if (complete) {
    for (const surface of processor.model.surfacesMap.values()) {
      for (const field of surface.componentsModel.componentsMap.values()) {
        if (!['TextField', 'ChoicePicker'].includes(field.type) || !field.properties.required)
          continue
        const bound = binding.safeParse(field.properties.value)
        const current: unknown = bound.success
          ? surface.dataModel.get<unknown>(bound.data['@path'])
          : field.properties.value
        if (
          (typeof current === 'string' && !current.trim()) ||
          (Array.isArray(current) && !current.length) ||
          current === undefined ||
          current === null
        )
          throw new Error('Complete the required A2UI fields')
      }
    }
  }
  // Bindings can share paths. A valid input must not turn another component's text into an object.
  for (const surface of processor.model.surfacesMap.values()) {
    for (const component of surface.componentsModel.componentsMap.values()) {
      for (const key of component.type === 'Text' ? ['text'] : ['label']) {
        const bound = binding.safeParse(component.properties[key])
        if (bound.success)
          z.string().max(4000).optional().parse(surface.dataModel.get<unknown>(bound.data['@path']))
      }
    }
  }
}

export function a2uiInputValues(processor: MessageProcessor): A2uiValues {
  const values: A2uiValues = {}
  for (const surface of processor.model.surfacesMap.values()) {
    const entries: A2uiValues[string] = {}
    for (const field of surface.componentsModel.componentsMap.values()) {
      if (!['TextField', 'CheckBox', 'ChoicePicker'].includes(field.type)) continue
      const bound = binding.safeParse(field.properties.value)
      if (bound.success)
        entries[bound.data['@path']] = value.parse(
          surface.dataModel.get<unknown>(bound.data['@path']) ??
            (field.type === 'CheckBox' ? false : field.type === 'ChoicePicker' ? [] : ''),
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
