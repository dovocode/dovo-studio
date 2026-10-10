import { Schema } from 'effect'
import { mutableStruct, mutableArray, minValue, maxValue } from '../../shared/schema.js'
const text = (maximum = 200) => maxValue(minValue(Schema.String, 1), maximum)
const port = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
)
const fields = {
  id: text(80).pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/))),
  name: text(),
  sshHost: text(255).pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9.:%_-]*$/))),
  sshUser: text(100).pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/))),
  sshPort: port,
  identityFile: Schema.optional(
    text(4096).pipe(
      Schema.check(
        Schema.makeFilter((value) =>
          value
            .split('')
            .every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
        ),
      ),
    ),
  ),
  runtimeAddress: text(4096).pipe(
    Schema.check(
      Schema.makeFilter((value) => {
        try {
          const url = new URL(value)
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === '/'
          )
        } catch {
          return false
        }
      }),
    ),
  ),
  agentAccess: Schema.Boolean,
}
export const deviceHostSchema = mutableStruct({
  ...fields,
  token: Schema.optional(maxValue(Schema.String, 4096)),
})
export type DeviceHost = Schema.Schema.Type<typeof deviceHostSchema>
export const publicDeviceHostSchema = mutableStruct({ ...fields, hasToken: Schema.Boolean })
export type PublicDeviceHost = Schema.Schema.Type<typeof publicDeviceHostSchema>
export const deviceHostSettingsSchema = mutableStruct({
  enabled: Schema.optional(Schema.Boolean),
  revision: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  ),
  hosts: maxValue(mutableArray(deviceHostSchema), 20),
  defaultHostId: Schema.optional(fields.id),
})
export const deviceHostSettingsResultSchema = mutableStruct({
  enabled: Schema.optional(Schema.Boolean),
  revision: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  ),
  hosts: mutableArray(publicDeviceHostSchema),
  defaultHostId: Schema.optional(fields.id),
})
export type DeviceHostSettings = Schema.Schema.Type<typeof deviceHostSettingsSchema>
export const deviceHostTestResultSchema = mutableStruct({
  ok: Schema.Boolean,
  checks: mutableArray(
    mutableStruct({ name: Schema.String, ok: Schema.Boolean, message: Schema.String }),
  ),
})
export type DeviceHostTestResult = Schema.Schema.Type<typeof deviceHostTestResultSchema>
export const deviceHostInstallSchema = mutableStruct({
  taskId: text(),
  id: text(500),
  hostId: Schema.optional(fields.id),
  artifactPath: text(4096),
})
export const deviceHostForwardSchema = mutableStruct({
  taskId: text(),
  hostId: fields.id,
  localPort: port,
  remotePort: port,
  exposeToNetwork: Schema.optional(Schema.Boolean),
  durationSeconds: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 3600 })),
    ),
  ),
})

export const deviceHostForwardResultSchema = mutableStruct({
  ok: Schema.Literal(true),
  id: Schema.String,
  url: Schema.String,
  expiresAt: Schema.String,
})

export const deviceHostForwardsResultSchema = mutableStruct({
  forwards: mutableArray(
    mutableStruct({
      ...deviceHostForwardResultSchema.fields,
      hostId: fields.id,
      localPort: port,
      remotePort: port,
      exposeToNetwork: Schema.Boolean,
    }),
  ),
})
