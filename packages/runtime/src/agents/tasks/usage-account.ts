import { createHash } from 'node:crypto'
import { decodeResult, mutableStruct, usageAccountSchema } from '@dovo/protocol'
import { Schema } from 'effect'

/** Only provider-reported account metadata is retained; credentials never enter usage records. */
export function reportedUsageAccount(provider: string, name: string, payload: unknown) {
  if (provider === 'codex' && name === 'account/read') {
    const result = decodeResult(
      mutableStruct({
        account: Schema.NullOr(
          mutableStruct({
            type: Schema.String,
            email: Schema.optional(Schema.NullOr(Schema.String)),
            planType: Schema.optional(Schema.String),
          }),
        ),
        workspaceRouting: Schema.optional(
          Schema.NullOr(mutableStruct({ chatgptAccountId: Schema.String })),
        ),
      }),
      payload,
    )
    if (!result.success || result.data.account?.type !== 'chatgpt') return undefined
    const account = result.data.account
    const workspace = result.data.workspaceRouting?.chatgptAccountId
    // Team accounts can have several workspaces for one email. Don't merge them without a workspace ID.
    const personal = ['free', 'plus', 'pro', 'prolite', 'go'].includes(account.planType ?? '')
    if (!workspace && (!personal || !account.email)) return undefined
    return identity(
      provider,
      workspace ?? account.email!,
      account.email ?? 'ChatGPT account',
      account.planType,
    )
  }
  if (provider === 'claude' && name === 'account/info') {
    const result = decodeResult(
      mutableStruct({
        email: Schema.optional(Schema.String),
        organization: Schema.optional(Schema.String),
        subscriptionType: Schema.optional(Schema.String),
        apiProvider: Schema.optional(Schema.String),
      }),
      payload,
    )
    if (
      !result.success ||
      !result.data.email ||
      (result.data.apiProvider && result.data.apiProvider !== 'firstParty')
    )
      return undefined
    const account = result.data
    return identity(
      provider,
      `${account.email}\u0000${account.organization ?? ''}`,
      account.email!,
      account.subscriptionType,
    )
  }
  return undefined
}
function identity(
  provider: string,
  id: string,
  label: string,
  subscription?: string,
): Schema.Schema.Type<typeof usageAccountSchema> {
  return {
    id: createHash('sha256')
      .update(`${provider}\u0000${id.trim().toLowerCase()}\u0000${subscription ?? ''}`)
      .digest('hex'),
    label,
    subscription,
  }
}
