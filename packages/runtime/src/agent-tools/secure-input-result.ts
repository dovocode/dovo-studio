import { decode, secureInputResultSchema } from '@dovo/protocol/agent-tools'

/** Model-facing state and next steps. The HTTP contract remains status metadata. */
export function secureInputToolResult(value: unknown) {
  const { id, status, cancelledBy } = decode(secureInputResultSchema, value)
  if (status === 'cancelled' && cancelledBy === 'user')
    return {
      id,
      status,
      cancelledBy,
      deliveryCompleted: false,
      nextAction: 'wait_for_user',
      guidance:
        'The user selected Cancel. Do not request this input again or try another route for this step. Report the cancellation and wait for the user before trying again.',
    }
  if (status === 'pending' || status === 'running') {
    return {
      id,
      status,
      deliveryCompleted: false,
      nextAction: 'wait_for_completion_message',
      guidance:
        'Delivery has not completed. Do not poll status for this result. Finish independent requested work, then return. A completion message will arrive automatically. Do not discover, prepare or start delivery-dependent work until completion.',
    }
  }
  if (status !== 'completed') {
    return {
      id,
      status,
      deliveryCompleted: false,
      nextAction: 'report_incomplete_delivery',
      guidance:
        'Delivery did not complete. Report this state and finish independent requested work. Do not prepare actions that require completed delivery.',
    }
  }
  return { id, status, deliveryCompleted: true }
}
