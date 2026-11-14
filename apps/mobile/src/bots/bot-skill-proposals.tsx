import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { View } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import { botResultSchema, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { useAction } from '../ui/controls/use-action'
export function BotSkillProposals({
  task,
  onSaved,
}: {
  task: Task
  onSaved?: (result: typeof botResultSchema.Type) => void
}) {
  const uiText = useInterfaceText()

  const { callEffect, connected } = useRuntime()
  const [selected, setSelected] = useState('')
  const [ack, setAck] = useState<{ before: string; result: typeof botResultSchema.Type }>()
  const { act, busy, error } = useAction()
  const bot = ack && ack.before === task.bot?.revision ? ack.result.bot : task.bot
  const decide = (proposalId: string, accept: boolean) =>
    act(async () => {
      if (!bot) return
      const result = await runClientEffect(
        callEffect(
          '/api/bots/skill-proposal/decide',
          { id: task.id, proposalId, expectedRevision: bot.revision, accept },
          botResultSchema,
        ),
      )
      setAck({ before: task.bot?.revision ?? '', result })
      onSaved?.(result)
      setSelected('')
    })
  return (
    <View style={{ gap: 8 }}>
      {bot?.skillProposals
        ?.filter((p) => p.status === 'pending')
        .map((p) => (
          <View key={p.id} style={{ gap: 8 }}>
            <Text>
              {p.skill.name} · {p.skill.description}
            </Text>
            <Action
              label={uiText('Review skill diff')}
              secondary
              onPress={() => setSelected(selected === p.id ? '' : p.id)}
            />
            {selected === p.id && (
              <>
                <Text>
                  <InterfaceText>
                    {'From a completed turn. Applies only to this Bot’s future turns.'}
                  </InterfaceText>
                </Text>
                <Text selectable>{p.patch}</Text>
                <Text>
                  <InterfaceText
                    values={{
                      value0: p.before?.description ?? uiText('(new skill)'),
                      value1: p.skill.description,
                    }}
                  >
                    {'Description: {value0} → {value1}'}
                  </InterfaceText>
                </Text>
                <Action
                  label={uiText('Apply skill')}
                  disabled={!connected || busy}
                  onPress={() => decide(p.id, true)}
                />
                <Action
                  label={uiText('Reject proposal')}
                  secondary
                  disabled={!connected || busy}
                  onPress={() => decide(p.id, false)}
                />
              </>
            )}
          </View>
        ))}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  )
}
