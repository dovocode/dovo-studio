import {
  Data,
  Effect,
  Result,
  Schema,
  SchemaIssue,
  SchemaGetter,
  SchemaTransformation,
  Struct,
} from 'effect'

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly cause: Schema.SchemaError
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]
}> {
  get message() {
    // Keep the expectation, drop the submitted value: a failed decode of a stored workspace
    // or saved registry would otherwise print credentials into logs and error banners.
    return this.issues
      .map(
        (issue) =>
          `${issue.path.join('.') || 'value'}: ${issue.message.replace(/, (?:actual|got) [\s\S]*$/, '')}`,
      )
      .join('\n')
  }
}
export function decode<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  input: unknown,
): S['Type'] {
  const result = decodeResult(schema, input)
  if (!result.success) throw result.error
  return result.data
}
export function decodeResult<S extends Schema.Codec<unknown, unknown>>(schema: S, input: unknown) {
  const result = Schema.decodeUnknownResult(schema, { errors: 'all' })(input)
  return Result.isSuccess(result)
    ? { success: true as const, data: result.success }
    : {
        success: false as const,
        error: new ValidationError({
          cause: result.failure,
          issues: SchemaIssue.makeFormatterStandardSchemaV1()(result.failure.issue).issues.map(
            (issue) => ({
              path: (issue.path ?? []).map((part) => (typeof part === 'object' ? part.key : part)),
              message: issue.message,
            }),
          ),
        }),
      }
}
export function validationMessages(error: ValidationError) {
  return error.issues.map((issue) => issue.message)
}
type Sized = string | number | readonly unknown[]
const size = (value: Sized) => (typeof value === 'number' ? value : value.length)
export function minValue<S extends Schema.Top & { readonly Type: Sized }>(
  schema: S,
  limit: number,
  message?: string,
) {
  return schema.pipe(
    Schema.check(
      Schema.makeFilter((value) => size(value) >= limit, {
        message: message ?? `Expected at least ${limit}`,
      }),
    ),
  )
}
export function maxValue<S extends Schema.Top & { readonly Type: Sized }>(
  schema: S,
  limit: number,
  message?: string,
) {
  return schema.pipe(
    Schema.check(
      Schema.makeFilter((value) => size(value) <= limit, {
        message: message ?? `Expected at most ${limit}`,
      }),
    ),
  )
}
export function lengthValue<S extends Schema.Top & { readonly Type: Sized }>(
  schema: S,
  length: number,
) {
  return schema.pipe(
    Schema.check(
      Schema.makeFilter((value) => size(value) === length, {
        message: `Expected length ${length}`,
      }),
    ),
  )
}
export function refine<S extends Schema.Top>(
  schema: S,
  predicate: (value: S['Type']) => boolean,
  issue?: string | { message: string; path?: readonly PropertyKey[] },
) {
  return schema.pipe(
    Schema.check(
      Schema.makeFilter(
        (value) =>
          predicate(value) ||
          (typeof issue === 'object' ? { issue: issue.message, path: issue.path ?? [] } : issue) ||
          false,
      ),
    ),
  )
}
export function superRefine<S extends Schema.Top>(
  schema: S,
  check: (
    value: S['Type'],
    context: {
      addIssue: (issue: { code: string; message: string; path?: readonly PropertyKey[] }) => void
    },
  ) => void,
) {
  return schema.pipe(
    Schema.check(
      Schema.makeFilter((value) => {
        const issues: { issue: string; path: readonly PropertyKey[] }[] = []
        check(value, {
          addIssue: ({ message, path }) => issues.push({ issue: message, path: path ?? [] }),
        })
        return issues
      }),
    ),
  )
}
export function urlSchema(options?: { protocol?: RegExp }) {
  return Schema.String.pipe(
    Schema.check(
      Schema.makeFilter(
        (value) => {
          try {
            const url = new URL(value)
            return !options?.protocol || options.protocol.test(url.protocol.slice(0, -1))
          } catch {
            return false
          }
        },
        { message: 'Invalid URL' },
      ),
    ),
  )
}
export function isoDateTime<S extends Schema.Top & { readonly Type: string }>(schema: S) {
  return schema.pipe(
    Schema.check(
      Schema.makeFilter(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
        { message: 'Invalid ISO datetime' },
      ),
    ),
  )
}

// Wire objects remain mutable; v4 represents field mutability on each key.
export function mutableStruct<F extends Schema.Struct.Fields>(fields: F) {
  return Schema.Struct(Struct.map(fields, Schema.mutableKey))
}
/** Reject extra fields at this object boundary, including when nested in another schema. */
export function strictStruct<F extends Schema.Struct.Fields>(fields: F) {
  const schema = mutableStruct(fields)
  return Schema.Unknown.pipe(
    Schema.decodeTo(Schema.toType(schema), {
      decode: SchemaGetter.transformEffect((input) =>
        Schema.decodeUnknownEffect(schema, {
          errors: 'all',
          onExcessProperty: 'error',
        })(input).pipe(Effect.mapError((error) => error.issue)),
      ),
      encode: SchemaGetter.transformEffect((value) =>
        Schema.encodeEffect(schema)(value).pipe(Effect.mapError((error) => error.issue)),
      ),
    }),
  )
}
export function mutableArray<S extends Schema.Top>(value: S) {
  return Object.assign(Schema.mutable(Schema.Array(value)), { value })
}
export function withDefault<S extends Schema.Top>(schema: S, value: () => NoInfer<S['Type']>) {
  return schema.pipe(Schema.withDecodingDefaultType(Effect.sync(value)))
}
export const CoercedNumber = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Number.check(Schema.isFinite()),
    SchemaTransformation.transform<number, unknown>({
      decode: Number,
      encode: (value) => value,
    }),
  ),
)

/** RFC UUIDs, including the nil and max identifiers accepted by existing wire contracts. */
export const uuidSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i,
    ),
  ),
)

/** Public diagnostics use schema-owned names and fixed messages, never values or record keys. */
export function safeValidationIssues(error: ValidationError) {
  const result: { path: string; code: 'required' | 'invalid'; message: string }[] = []
  const visit = (issue: SchemaIssue.Issue, path: string[], fields: readonly PropertyKey[] = []) => {
    switch (issue._tag) {
      case 'AnyOf':
      case 'Composite': {
        const keys =
          issue.ast._tag === 'Objects'
            ? issue.ast.propertySignatures.map((field) => field.name)
            : []
        for (const child of Array.isArray(issue.issues) ? issue.issues : [issue.issues])
          visit(child, path, keys)
        break
      }
      case 'Pointer': {
        const parts = Array.isArray(issue.path) ? issue.path : [issue.path]
        visit(issue.issue, [
          ...path,
          ...parts.map((part) =>
            typeof part === 'number'
              ? `[${part}]`
              : fields.includes(part)
                ? String(part)
                : '[entry]',
          ),
        ])
        break
      }
      case 'Filter':
      case 'Encoding':
        visit(issue.issue, path, fields)
        break
      default: {
        const code = issue._tag === 'MissingKey' ? 'required' : 'invalid'
        const expected = issue._tag === 'InvalidType' ? issue.ast._tag : ''
        const message =
          code === 'required'
            ? 'This field is required.'
            : expected === 'String'
              ? 'Enter text.'
              : expected === 'Number'
                ? 'Enter a number.'
                : expected === 'Boolean'
                  ? 'Choose yes or no.'
                  : 'Check this field’s format or allowed value.'
        result.push({ path: path.join('.') || 'value', code, message })
      }
    }
  }
  visit(error.cause.issue, [])
  return result
    .filter(
      (item, i, all) =>
        all.findIndex((other) => other.path === item.path && other.message === item.message) === i,
    )
    .slice(0, 12)
}
export function safeValidationMessage(error: ValidationError) {
  return `Invalid request data. ${safeValidationIssues(error)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(' ')}`
}
