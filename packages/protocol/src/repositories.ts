import { mutableStruct } from './schema.js'
import { maxValue, minValue, refine } from './schema.js'
import { Schema, ParseResult } from 'effect'
import { forgeBindingSchema } from './forges.js'

// Only repository roots on github.com are accepted, never credentials, refs or arbitrary remotes.
export const githubRepositorySchema = Schema.transformOrFail(
  maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 500),
  mutableStruct({
    name: Schema.String,
    url: Schema.String,
  }),
  {
    strict: true,
    decode: (value, _options, ast) => {
      const slug = value
        .replace(/^https:\/\/github\.com\//i, '')
        .replace(/\/$/, '')
        .replace(/\.git$/, '')
      const parts = slug.split('/')
      const [owner, name] = parts
      if (
        parts.length !== 2 ||
        !owner ||
        !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(owner) ||
        !name ||
        !/^[a-z\d._-]+$/i.test(name) ||
        name === '.' ||
        name === '..'
      )
        return ParseResult.fail(
          new ParseResult.Type(ast, value, 'Enter owner/repo or https://github.com/owner/repo'),
        )
      return ParseResult.succeed({
        name,
        url: `https://github.com/${owner}/${name}.git`,
      })
    },
    encode: (value) => ParseResult.succeed(value.url),
  },
)
const name = maxValue(
  minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1, 'Enter a repository name'),
  200,
)
// Preserve paths returned by the folder picker, including legal trailing whitespace.
const path = refine(
  maxValue(minValue(Schema.String, 1, 'Enter a path on the runtime host'), 4096),
  (value) => !value.includes('\0'),
  'Invalid path',
)
export const addRepositorySchema = Schema.Union(
  ...[
    mutableStruct({
      source: Schema.Literal('local'),
      name,
      path,
    }),
    mutableStruct({
      source: Schema.Literal('forge'),
      name,
      directory: path,
      forge: forgeBindingSchema,
    }),
    mutableStruct({
      source: Schema.Literal('github'),
      name,
      repository: githubRepositorySchema,
      directory: path,
    }),
  ],
)
export const REPOSITORY_CLONE_TIMEOUT_MS = 300_000
