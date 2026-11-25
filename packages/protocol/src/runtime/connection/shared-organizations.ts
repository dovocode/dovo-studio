import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../../shared/schema.js'
import { resourceSettingsSchema } from '../../shared/resources.js'
import { organizationIdSchema, organizationNameSchema, type Repository } from '../../workspace.js'

const revision = {
  updatedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  changeId: maxValue(minValue(Schema.String, 1), 100),
}
const nameSchema = mutableStruct({
  id: organizationIdSchema,
  name: organizationNameSchema,
  ...revision,
})
const resourcesSchema = mutableStruct({
  id: organizationIdSchema,
  resources: Schema.NullOr(resourceSettingsSchema),
  ...revision,
})
const projectSchema = mutableStruct({
  id: maxValue(Schema.String.check(Schema.isPattern(/^[^/\s]+\/[^\r\n]+$/)), 590),
  organizationId: Schema.NullOr(organizationIdSchema),
  ...revision,
})

export const sharedOrganizationsSchema = mutableStruct({
  names: maxValue(mutableArray(nameSchema), 300),
  resources: maxValue(mutableArray(resourcesSchema), 300),
  projects: maxValue(mutableArray(projectSchema), 300),
})
export type SharedOrganizations = typeof sharedOrganizationsSchema.Type
export const emptySharedOrganizations = (): SharedOrganizations => ({
  names: [],
  resources: [],
  projects: [],
})

type Row = { id: string; updatedAt: number; changeId: string }
function mergeRows<T extends Row>(rows: readonly T[]) {
  const result = new Map<string, T>()
  for (const row of rows) {
    const current = result.get(row.id)
    if (
      !current ||
      row.updatedAt > current.updatedAt ||
      (row.updatedAt === current.updatedAt && row.changeId > current.changeId)
    )
      result.set(row.id, row)
  }
  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export function mergeSharedOrganizations(left: SharedOrganizations, right: SharedOrganizations) {
  return {
    names: mergeRows([...left.names, ...right.names]),
    resources: mergeRows([...left.resources, ...right.resources]),
    projects: mergeRows([...left.projects, ...right.projects]),
  }
}

export function organizationGitIdentity(repository?: Repository) {
  return repository && !repository.kind && !repository.gitIdentityError
    ? repository.gitIdentity
    : undefined
}
