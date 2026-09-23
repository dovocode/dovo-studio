import { Data, Either, ParseResult, Schema } from 'effect'

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly cause: ParseResult.ParseError
  readonly issues: readonly ParseResult.ArrayFormatterIssue[]
}> {
  get message() {
    return this.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('\n')
  }
}
export function decode<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  input: unknown,
): Schema.Schema.Type<S> {
  const result = decodeResult(schema, input)
  if (!result.success) throw result.error
  return result.data
}
export function decodeResult<S extends Schema.Schema.AnyNoContext>(schema: S, input: unknown) {
  const result: Either.Either<
    Schema.Schema.Type<S>,
    ParseResult.ParseError
  > = Schema.decodeUnknownEither(schema, { errors: 'all' })(input)
  return Either.isRight(result)
    ? { success: true as const, data: result.right }
    : {
        success: false as const,
        error: new ValidationError({
          cause: result.left,
          issues: ParseResult.ArrayFormatter.formatErrorSync(result.left),
        }),
      }
}
export function validationMessages(error: ValidationError) {
  return error.issues.map((issue) => issue.message)
}
type Sized = string | number | readonly unknown[]
const size = (value: Sized) => (typeof value === 'number' ? value : value.length)
export function minValue<A extends Sized, I>(
  schema: Schema.Schema<A, I>,
  limit: number,
  message?: string,
) {
  return schema.pipe(
    Schema.filter((value) => size(value) >= limit, {
      message: () => message ?? `Expected at least ${limit}`,
    }),
  )
}
export function maxValue<A extends Sized, I>(
  schema: Schema.Schema<A, I>,
  limit: number,
  message?: string,
) {
  return schema.pipe(
    Schema.filter((value) => size(value) <= limit, {
      message: () => message ?? `Expected at most ${limit}`,
    }),
  )
}
export function lengthValue<A extends Sized, I>(schema: Schema.Schema<A, I>, length: number) {
  return schema.pipe(
    Schema.filter((value) => size(value) === length, {
      message: () => `Expected length ${length}`,
    }),
  )
}
export function refine<A, I>(
  schema: Schema.Schema<A, I>,
  predicate: (value: A) => boolean,
  issue?: string | { message: string; path?: readonly PropertyKey[] },
) {
  return schema.pipe(
    Schema.filter(
      (value) =>
        predicate(value) ||
        (typeof issue === 'object' ? { message: issue.message, path: issue.path ?? [] } : issue) ||
        false,
    ),
  )
}
export function superRefine<A, I>(
  schema: Schema.Schema<A, I>,
  check: (
    value: A,
    context: {
      addIssue: (issue: { code: string; message: string; path?: readonly PropertyKey[] }) => void
    },
  ) => void,
) {
  return schema.pipe(
    Schema.filter((value) => {
      const issues: { message: string; path: readonly PropertyKey[] }[] = []
      check(value, { addIssue: ({ message, path }) => issues.push({ message, path: path ?? [] }) })
      return issues
    }),
  )
}
export function urlSchema(options?: { protocol?: RegExp }) {
  return Schema.String.pipe(
    Schema.filter(
      (value) => {
        try {
          const url = new URL(value)
          return !options?.protocol || options.protocol.test(url.protocol.slice(0, -1))
        } catch {
          return false
        }
      },
      { message: () => 'Invalid URL' },
    ),
  )
}
export function isoDateTime<A extends string, I>(schema: Schema.Schema<A, I>) {
  return schema.pipe(
    Schema.filter(
      (value) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
      { message: () => 'Invalid ISO datetime' },
    ),
  )
}

// Wire objects remain mutable to preserve the existing public model types during migration.
export type MutableStruct<F extends Schema.Struct.Fields> = Schema.mutable<Schema.Struct<F>> &
  Pick<Schema.Struct<F>, 'fields' | 'pick' | 'omit'>
export function mutableStruct<F extends Schema.Struct.Fields>(fields: F): MutableStruct<F> {
  const struct = Schema.Struct(fields)
  return Object.assign(Schema.mutable(struct), {
    fields: struct.fields,
    pick: struct.pick.bind(struct),
    omit: struct.omit.bind(struct),
  })
}
export function mutableArray<S extends Schema.Schema.Any>(value: S) {
  return Object.assign(Schema.mutable(Schema.Array(value)), { value })
}
export function withDefault<A, I>(schema: Schema.Schema<A, I>, value: () => NoInfer<A>) {
  return Schema.transform(Schema.UndefinedOr(schema), Schema.typeSchema(schema), {
    strict: true,
    decode: (input) => (input === undefined ? value() : input),
    encode: (input) => input,
  })
}
export const CoercedNumber = Schema.transform(Schema.Unknown, Schema.Number.pipe(Schema.finite()), {
  strict: true,
  decode: Number,
  encode: (value) => value,
})

/** RFC UUIDs, including the nil and max identifiers accepted by existing wire contracts. */
export const uuidSchema = Schema.String.pipe(
  Schema.pattern(
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i,
  ),
)

/** Public diagnostics use schema-owned names and fixed messages, never values or record keys. */
export function safeValidationIssues(error: ValidationError) {
  const result: { path: string; code: 'required' | 'invalid'; message: string }[] = []
  const visit = (
    issue: ParseResult.ParseIssue,
    path: string[],
    fields: readonly PropertyKey[] = [],
  ) => {
    switch (issue._tag) {
      case 'Composite': {
        const keys =
          issue.ast._tag === 'TypeLiteral'
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
      case 'Refinement':
      case 'Transformation':
        visit(issue.issue, path, fields)
        break
      default: {
        const code = issue._tag === 'Missing' ? 'required' : 'invalid'
        const expected = issue._tag === 'Type' ? issue.ast._tag : ''
        const message =
          code === 'required'
            ? 'This field is required.'
            : expected === 'StringKeyword'
              ? 'Enter text.'
              : expected === 'NumberKeyword'
                ? 'Enter a number.'
                : expected === 'BooleanKeyword'
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
