import { mutableStruct, mutableArray } from './schema.js'
import { maxValue, refine, minValue } from './schema.js'
import { Schema } from 'effect'
export const directoryRequestSchema = mutableStruct({
  path: Schema.optionalWith(
    refine(maxValue(Schema.String, 4096), (value) => !value.includes('\0'), 'Invalid path'),
    {
      default: () => '',
    },
  ),
  hidden: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  query: Schema.optionalWith(maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 200), {
    default: () => '',
  }),
  offset: Schema.optionalWith(
    maxValue(
      minValue(
        Schema.Number.pipe(Schema.finite()).pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ),
        0,
      ),
      1_000_000,
    ),
    {
      default: () => 0,
    },
  ),
})
export const directoryPageSchema = mutableStruct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.optional(Schema.String),
  breadcrumbs: Schema.optional(
    mutableArray(
      mutableStruct({
        name: Schema.String,
        path: Schema.String,
      }),
    ),
  ),
  total: Schema.optional(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.nonNegative()),
  ),
  entries: mutableArray(
    mutableStruct({
      name: Schema.String,
      path: Schema.String,
    }),
  ),
  nextOffset: Schema.NullOr(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.nonNegative()),
  ),
})
export type DirectoryPage = Schema.Schema.Type<typeof directoryPageSchema>
export const githubRepositoryListRequestSchema = mutableStruct({
  page: Schema.optionalWith(
    maxValue(
      minValue(
        Schema.Number.pipe(Schema.finite()).pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ),
        1,
      ),
      10000,
    ),
    {
      default: () => 1,
    },
  ),
})
export const githubRepositoryChoiceSchema = mutableStruct({
  name: Schema.String,
  fullName: Schema.String,
  description: Schema.String,
  private: Schema.Boolean,
})
export const githubRepositoryPageSchema = mutableStruct({
  repositories: mutableArray(githubRepositoryChoiceSchema),
  nextPage: Schema.NullOr(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
  ),
})
export type GithubRepositoryChoice = Schema.Schema.Type<typeof githubRepositoryChoiceSchema>
export type GithubRepositoryPage = Schema.Schema.Type<typeof githubRepositoryPageSchema>
