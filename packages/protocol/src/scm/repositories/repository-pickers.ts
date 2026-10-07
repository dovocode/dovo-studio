import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { maxValue, refine, minValue } from '../../shared/schema.js'
import { Schema, Effect } from 'effect'
export const directoryRequestSchema = mutableStruct({
  path: refine(
    maxValue(Schema.String, 4096),
    (value) => !value.includes('\0'),
    'Invalid path',
  ).pipe(Schema.withDecodingDefaultType(Effect.sync(() => ''))),
  hidden: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  query: maxValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 200).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => '')),
  ),
  offset: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      0,
    ),
    1_000_000,
  ).pipe(Schema.withDecodingDefaultType(Effect.sync(() => 0))),
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
    Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  entries: mutableArray(
    mutableStruct({
      name: Schema.String,
      path: Schema.String,
    }),
  ),
  nextOffset: Schema.NullOr(
    Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
})
export type DirectoryPage = Schema.Schema.Type<typeof directoryPageSchema>
export const githubRepositoryListRequestSchema = mutableStruct({
  page: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      1,
    ),
    10000,
  ).pipe(Schema.withDecodingDefaultType(Effect.sync(() => 1))),
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
    Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThan(0))),
  ),
})
export type GithubRepositoryChoice = Schema.Schema.Type<typeof githubRepositoryChoiceSchema>
export type GithubRepositoryPage = Schema.Schema.Type<typeof githubRepositoryPageSchema>
