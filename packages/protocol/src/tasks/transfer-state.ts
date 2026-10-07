import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue, uuidSchema } from '../shared/schema.js'

export const taskTransferStateSchema = mutableStruct({
  id: uuidSchema,
  direction: Schema.Literal('out', 'in'),
  state: Schema.Literal('preparing', 'prepared', 'aborting', 'sealed', 'active'),
  peerAddress: maxValue(minValue(Schema.String, 1), 4096),
  peerTaskId: maxValue(minValue(Schema.String, 1), 200),
  mode: Schema.Literal('native', 'replay'),
})
export function taskTransferBlocked(task: { transfer?: typeof taskTransferStateSchema.Type }) {
  return !!task.transfer && task.transfer.state !== 'active'
}
