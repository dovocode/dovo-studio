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
              label="Review skill diff"
              secondary
              onPress={() => setSelected(selected === p.id ? '' : p.id)}
            />
            {selected === p.id && (
              <>
                <Text>From a completed turn. Applies only to this Bot’s future turns.</Text>
                <Text selectable>{p.patch}</Text>
                <Text>
                  Description: {p.before?.description ?? '(new skill)'} → {p.skill.description}
                </Text>
                <Action
                  label="Apply skill"
                  disabled={!connected || busy}
                  onPress={() => decide(p.id, true)}
                />
                <Action
                  label="Reject proposal"
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
