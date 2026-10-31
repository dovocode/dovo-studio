import { browserProfileIdSchema } from './browser-profiles.js'
import { mutableArray, mutableStruct, uuidSchema } from '../../shared/schema.js'
import { minValue, maxValue } from '../../shared/schema.js'
import { Schema, Effect } from 'effect'
import { previewDeviceSchema } from './previews.js'
export const remoteBrowserViewportSchema = mutableStruct({
  width: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      240,
    ),
    1920,
  ),
  height: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      240,
    ),
    1920,
  ),
})
export const remoteBrowserOpenSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  tabId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  profileId: Schema.optional(browserProfileIdSchema),
  url: Schema.optional(maxValue(Schema.String, 4096)),
})
export const remoteBrowserTicketSchema = mutableStruct({
  ticket: Schema.String,
  host: Schema.String,
  tabId: Schema.optional(Schema.String),
  profileId: Schema.optional(browserProfileIdSchema),
  device: Schema.optional(previewDeviceSchema),
})
const point = {
  x: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 1920),
  y: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 1920),
}
export const remoteBrowserInputSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('navigate'),
    url: maxValue(minValue(Schema.String, 1), 4096),
  }),
  mutableStruct({
    type: Schema.Literals(['back', 'forward', 'reload', 'status']),
  }),
  mutableStruct({
    type: Schema.Literal('visibility'),
    visible: Schema.Boolean,
  }),
  mutableStruct({
    type: Schema.Literal('resize'),
    ...remoteBrowserViewportSchema.fields,
  }),
  mutableStruct({
    type: Schema.Literal('pointer'),
    phase: Schema.Literals(['move', 'down', 'up']),
    pointerType: Schema.optional(Schema.Literals(['mouse', 'touch'])),
    button: Schema.Literals(['left', 'middle', 'right']).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => 'left')),
    ),
    clickCount: Schema.optional(Schema.Literals([1, 2, 3])),
    modifiers: Schema.optional(
      Schema.Array(Schema.Literals(['Control', 'Meta', 'Alt', 'Shift'])).pipe(
        Schema.check(Schema.isMaxLength(4)),
      ),
    ),
    ...point,
  }),
  mutableStruct({
    type: Schema.Literal('scroll'),
    ...point,
    deltaX: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), -4000), 4000),
    deltaY: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), -4000), 4000),
  }),
  mutableStruct({
    type: Schema.Literal('text'),
    text: maxValue(minValue(Schema.String, 1), 16000),
  }),
  mutableStruct({
    type: Schema.Literal('key'),
    key: maxValue(minValue(Schema.String, 1), 40).pipe(
      Schema.check(
        Schema.isPattern(
          /^(?:(?:Control|Meta|Alt|Shift)\+)*(?:\P{C}|Enter|Tab|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Space)$/u,
        ),
      ),
    ),
  }),
  mutableStruct({
    type: Schema.Literal('dialog'),
    accept: Schema.Boolean,
    text: Schema.optional(maxValue(Schema.String, 16000)),
  }),
])
export type RemoteBrowserInput = Schema.Schema.Type<typeof remoteBrowserInputSchema>
export const BROWSER_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const BROWSER_UPLOAD_CHUNK_BYTES = 64 * 1024
export const BROWSER_UPLOAD_MAX_FILES = 5
const uploadIdentity = { requestId: uuidSchema, chooserId: uuidSchema }
const uploadSize = maxValue(
  minValue(Schema.Number.pipe(Schema.check(Schema.isInt())), 0),
  BROWSER_UPLOAD_MAX_BYTES,
)
/** Separate from ordinary page input so file bytes never enter the navigation queue. */
export const remoteBrowserUploadSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('fileUploadStart'),
    ...uploadIdentity,
    name: maxValue(minValue(Schema.String, 1), 255),
    mimeType: maxValue(Schema.String, 255),
    size: uploadSize,
  }),
  mutableStruct({
    type: Schema.Literal('fileUploadChunk'),
    ...uploadIdentity,
    fileId: uuidSchema,
    offset: uploadSize,
    data: maxValue(minValue(Schema.String, 4), Math.ceil(BROWSER_UPLOAD_CHUNK_BYTES / 3) * 4),
  }),
  mutableStruct({
    type: Schema.Literals(['fileUploadCommit', 'fileUploadCancel']),
    ...uploadIdentity,
  }),
])
export type RemoteBrowserUpload = typeof remoteBrowserUploadSchema.Type
export const BROWSER_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024
const downloadSize = maxValue(
  minValue(Schema.Number.pipe(Schema.check(Schema.isInt())), 0),
  BROWSER_DOWNLOAD_MAX_BYTES,
)
export const remoteBrowserDownloadSchema = mutableStruct({
  type: Schema.Literal('download'),
  id: uuidSchema,
  name: maxValue(minValue(Schema.String, 1), 255),
  size: downloadSize,
  status: Schema.Literals(['downloading', 'ready']),
})
export type RemoteBrowserDownload = typeof remoteBrowserDownloadSchema.Type
export const remoteBrowserDownloadCommandSchema = Schema.Union([
  mutableStruct({ type: Schema.Literal('downloadRequest'), id: uuidSchema, requestId: uuidSchema }),
  mutableStruct({ type: Schema.Literal('downloadCancel'), id: uuidSchema }),
])
export const remoteBrowserFileChooserSchema = mutableStruct({
  type: Schema.Literal('fileChooser'),
  id: uuidSchema,
  multiple: Schema.Boolean,
  accept: maxValue(Schema.String, 1024),
})
export type RemoteBrowserFileChooser = typeof remoteBrowserFileChooserSchema.Type
export const remoteBrowserFrameAckSchema = mutableStruct({
  type: Schema.Literal('frameAck'),
  // Time spent waiting for/using the decoder, excluded from the transport RTT.
  // Optional so older binary-v1 viewers retain the conservative two-frame window.
  decodeMs: Schema.optional(
    maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 10000),
  ),
  dropped: Schema.optional(Schema.Boolean),
  sequence: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      1,
    ),
    0xffffffff,
  ),
})
export const remoteBrowserDialogSchema = mutableStruct({
  type: Schema.Literal('dialog'),
  kind: Schema.Literals(['alert', 'confirm', 'prompt', 'beforeunload']),
  message: Schema.String,
  defaultValue: Schema.String,
})
export const remoteBrowserInteractionSchema = mutableStruct({
  type: Schema.Literal('interaction'),
  cursor: Schema.Literals([
    'auto',
    'default',
    'pointer',
    'text',
    'vertical-text',
    'crosshair',
    'move',
    'grab',
    'grabbing',
    'not-allowed',
    'wait',
    'progress',
    'help',
    'cell',
    'copy',
    'alias',
    'no-drop',
    'all-scroll',
    'col-resize',
    'row-resize',
    'n-resize',
    'e-resize',
    's-resize',
    'w-resize',
    'ne-resize',
    'nw-resize',
    'se-resize',
    'sw-resize',
    'ew-resize',
    'ns-resize',
    'nesw-resize',
    'nwse-resize',
    'zoom-in',
    'zoom-out',
    'none',
  ]),
  href: maxValue(Schema.String, 4096),
  editable: Schema.Boolean,
})
export const remoteBrowserMessageSchema = Schema.Union([
  remoteBrowserDownloadSchema,
  mutableStruct({ type: Schema.Literal('downloadRemoved'), id: uuidSchema }),
  mutableStruct({
    type: Schema.Literal('downloadReady'),
    id: uuidSchema,
    requestId: uuidSchema,
    name: maxValue(minValue(Schema.String, 1), 255),
    size: downloadSize,
    url: maxValue(Schema.String, 1024),
  }),
  mutableStruct({
    type: Schema.Literal('downloadError'),
    id: uuidSchema,
    requestId: uuidSchema,
    message: maxValue(Schema.String, 2000),
  }),
  remoteBrowserFileChooserSchema,
  mutableStruct({ type: Schema.Literal('fileChooserClosed'), id: uuidSchema }),
  mutableStruct({
    type: Schema.Literal('fileUploadAck'),
    requestId: uuidSchema,
    error: Schema.optional(maxValue(Schema.String, 2000)),
  }),
  remoteBrowserInteractionSchema,
  mutableStruct({
    type: Schema.Literal('streamStats'),
    transportMs: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 60000),
  }),
  mutableStruct({
    type: Schema.Literal('frame'),
    data: Schema.String,
    width: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    height: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  }),
  mutableStruct({
    type: Schema.Literal('state'),
    createdTabs: Schema.optional(
      mutableArray(mutableStruct({ id: Schema.String, url: Schema.String })),
    ),
    url: Schema.String,
    title: Schema.String,
    favicon: Schema.optional(Schema.NullOr(maxValue(Schema.String, 100000))),
    back: Schema.Boolean,
    forward: Schema.Boolean,
    loading: Schema.Boolean,
    editable: Schema.Boolean,
    touch: Schema.optional(Schema.Boolean),
    primaryModifier: Schema.optional(Schema.Literals(['Control', 'Meta'])),
  }),
  mutableStruct({
    type: Schema.Literal('error'),
    message: Schema.String,
  }),
  mutableStruct({
    type: Schema.Literal('closed'),
    byPage: Schema.optional(Schema.Boolean),
    message: Schema.String,
  }),
  remoteBrowserDialogSchema,
])
export type RemoteBrowserMessage = Schema.Schema.Type<typeof remoteBrowserMessageSchema>
