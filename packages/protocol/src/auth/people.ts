import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, uuidSchema } from '../shared/schema.js'

export const sharingPersonSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 500),
  name: maxValue(minValue(Schema.String, 1), 200),
})
export const peopleDirectorySchema = mutableStruct({
  friends: mutableArray(
    mutableStruct({
      ...sharingPersonSchema.fields,
      status: Schema.Literals(['incoming', 'outgoing', 'accepted']),
    }),
  ),
  organizations: mutableArray(
    mutableStruct({
      id: uuidSchema,
      name: maxValue(minValue(Schema.String, 1), 100),
      ownerId: sharingPersonSchema.fields.id,
      status: Schema.Literals(['invited', 'member']),
      members: mutableArray(
        mutableStruct({
          ...sharingPersonSchema.fields,
          status: Schema.Literals(['invited', 'member']),
        }),
      ),
    }),
  ),
})
export type PeopleDirectory = typeof peopleDirectorySchema.Type
export const peopleActionSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('requestFriend'), userId: sharingPersonSchema.fields.id }),
  mutableStruct({ action: Schema.Literal('acceptFriend'), userId: sharingPersonSchema.fields.id }),
  mutableStruct({ action: Schema.Literal('removeFriend'), userId: sharingPersonSchema.fields.id }),
  mutableStruct({
    action: Schema.Literal('createOrganization'),
    name: maxValue(minValue(Schema.String, 1), 100),
  }),
  mutableStruct({
    action: Schema.Literal('inviteMember'),
    organizationId: uuidSchema,
    userId: sharingPersonSchema.fields.id,
  }),
  mutableStruct({ action: Schema.Literal('acceptOrganization'), organizationId: uuidSchema }),
  mutableStruct({
    action: Schema.Literal('removeMember'),
    organizationId: uuidSchema,
    userId: sharingPersonSchema.fields.id,
  }),
  mutableStruct({ action: Schema.Literal('deleteOrganization'), organizationId: uuidSchema }),
])
export type PeopleAction = typeof peopleActionSchema.Type
