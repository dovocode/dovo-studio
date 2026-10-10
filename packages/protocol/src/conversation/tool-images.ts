import { Schema } from 'effect'
import { decodeResult, mutableArray, mutableStruct } from '../shared/schema.js'
const mime = Schema.Literals(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const index = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
)
export const toolImageReferenceSchema = mutableStruct({ eventId: Schema.String, index, mime })
export const taskImageReadSchema = mutableStruct({ uri: Schema.String })
export type ToolImageReference = Schema.Schema.Type<typeof toolImageReferenceSchema>
type ToolImage = { uri: string; mime: Schema.Schema.Type<typeof mime> }
const referencesSchema = mutableStruct({ toolImages: mutableArray(toolImageReferenceSchema) })
/** Only raster image content blocks and screenshot data URLs are displayed, never arbitrary URLs. */
export function toolImages(payload: unknown): ToolImage[] {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }
  const images: ToolImage[] = [],
    seen = new Set<string>()
  let visited = 0
  const add = (uri: string) => {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(uri)
    if (!match || uri.length > 24 * 1024 * 1024 || seen.has(uri) || images.length >= 8) return
    const decoded = decodeResult(mime, match[1]).data
    if (!decoded) return
    seen.add(uri)
    images.push({ uri, mime: decoded })
  }
  const visit = (value: unknown, depth: number) => {
    if (depth > 16 || ++visited > 2000 || images.length >= 8) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (!value || typeof value !== 'object') return
    const data = decodeResult(Schema.Record(Schema.String, Schema.Unknown), value).data
    if (!data) return
    if (data.type === 'image') {
      if (typeof data.data === 'string' && typeof data.mimeType === 'string')
        add(`data:${data.mimeType};base64,${data.data}`)
      const source = data.source
      if (source && typeof source === 'object') {
        const block = decodeResult(Schema.Record(Schema.String, Schema.Unknown), source).data
        if (
          block?.type === 'base64' &&
          typeof block.data === 'string' &&
          typeof block.media_type === 'string'
        )
          add(`data:${block.media_type};base64,${block.data}`)
      }
    }
    if (typeof data.image === 'string') add(data.image)
    if (data.type === 'image_url') {
      const url =
        typeof data.image_url === 'string'
          ? data.image_url
          : decodeResult(mutableStruct({ url: Schema.String }), data.image_url).data?.url
      if (url) add(url)
    }
    for (const [key, item] of Object.entries(data)) {
      if (
        ['input', 'arguments', 'rawInput', 'env', 'headers', 'toolImages', 'source'].includes(key)
      )
        continue
      if (typeof item === 'string' && ['result', 'output', 'content', 'text'].includes(key)) {
        try {
          visit(JSON.parse(item), depth + 1)
        } catch {
          /* Ordinary tool text is not image data. */
        }
      } else visit(item, depth + 1)
    }
  }
  visit(payload, 0)
  return images
}
export function toolImageReferences(payload: string): ToolImageReference[] {
  try {
    return decodeResult(referencesSchema, JSON.parse(payload)).data?.toolImages ?? []
  } catch {
    return []
  }
}
export const taskImageRequestSchema = mutableStruct({
  taskId: Schema.String,
  eventId: Schema.optional(Schema.String),
  index: Schema.optional(index),
  path: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(4000)))),
})
