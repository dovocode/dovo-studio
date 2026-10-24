import type { JSONSchema } from 'zod/v4/core'

// Muse's model API rejects deep tool schemas, including after resolving $refs.
// Keep two levels spare for its function-tool envelope. This is only the model's
// description: McpServer still validates calls against the complete schema.
const maxDepth = 8
type ToolSchema = JSONSchema.JSONSchema
type SchemaValue = JSONSchema._JSONSchema

function depth(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  return 1 + Math.max(0, ...Object.values(value).map(depth))
}

function describe(schema: ToolSchema): ToolSchema {
  const variants = schema.anyOf ?? schema.oneOf
  const types =
    schema.type ??
    (variants?.every((variant) => typeof variant.type === 'string')
      ? [
          ...new Set(
            variants.map((variant) => variant.type).filter((type) => typeof type === 'string'),
          ),
        ]
      : undefined)
  return {
    ...(types ? { type: types } : {}),
    ...(types === 'object' ? { additionalProperties: true } : {}),
    description: [
      schema.description,
      'Pass a JSON value matching this schema (not a JSON-encoded string). Studio validates the complete value:',
      JSON.stringify(schema),
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** Bound the advertised schema without changing arguments or server validation. */
export function museToolSchema(schema: ToolSchema): ToolSchema {
  const child = (value: SchemaValue, level: number): SchemaValue =>
    typeof value === 'boolean' ? value : project(value, level)
  const project = (value: ToolSchema, level: number): ToolSchema => {
    const result = { ...value }
    for (const key of ['properties', 'patternProperties', 'dependentSchemas'] as const) {
      const children = result[key]
      if (children)
        result[key] = Object.fromEntries(
          Object.entries(children).map(([name, value]) => [name, child(value, level + 2)]),
        )
    }
    if (result.$defs)
      result.$defs = Object.fromEntries(
        Object.entries(result.$defs).map(([name, value]) => [name, project(value, level + 2)]),
      )
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
      if (result[key]) result[key] = result[key].map((value) => project(value, level + 2))
    if (result.prefixItems)
      result.prefixItems = result.prefixItems.map((value) => child(value, level + 2))
    if (result.items !== undefined)
      result.items = Array.isArray(result.items)
        ? result.items.map((value) => child(value, level + 2))
        : child(result.items, level + 1)
    for (const key of [
      'additionalProperties',
      'propertyNames',
      'contains',
      'not',
      'if',
      'then',
      'else',
    ] as const) {
      const value = result[key]
      if (value !== undefined) result[key] = child(value, level + 1)
    }
    return level + depth(result) - 1 > maxDepth ? describe(value) : result
  }
  return project(schema, 1)
}
