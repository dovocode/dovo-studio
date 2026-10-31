import { useState } from 'react'
import { View } from 'react-native'
import {
  acpHarnessChoiceId,
  acpInstallationHarness,
  defaultTaskHarness,
  providerSchema,
  supportsUtilities,
  titleSettingsForHarness,
  type Agent,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { ModelSettings } from '../../agents/model-settings'
import { harnessNames } from '../../tasks/creation/harness-choices'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'
import { MobileReviewGuide } from './review-guide'
import type { useFileReview } from './use-file-review'

export function MobileOrganizeReview({
  review,
  disabled = false,
  onOrganized,
  onOpenFile,
}: {
  review: ReturnType<typeof useFileReview>
  disabled?: boolean
  onOrganized: () => void
  onOpenFile: (path: string) => void
}) {
  const { snapshot, connected } = useRuntime()
  const { styles } = useTheme()
  const [open, setOpen] = useState(false)
  const [agent, setAgent] = useState<Agent | null>(null)
  const agents = snapshot?.workspace.agents ?? []
  const installations = snapshot?.acpInstallations ?? []
  const blocked =
    disabled || !review.ready || !connected || review.organizing || !review.progress?.files.length
  return (
    <View style={{ gap: 6 }}>
      <Action
        secondary
        label={
          review.organizing
            ? 'Organizing review…'
            : review.featureGroups
              ? 'Organize review · Features active'
              : 'Organize review'
        }
        disabled={disabled || !connected}
        onPress={() => setOpen(true)}
      />
      {!open && !!review.organizeError && <Text style={styles.error}>{review.organizeError}</Text>}
      {review.progress?.guide && (
        <MobileReviewGuide
          guide={review.progress.guide}
          busy={review.busy}
          disabled={disabled || !review.ready}
          onMove={review.moveGuide}
          onOpenFile={onOpenFile}
        />
      )}
      {!!review.error && <Text style={styles.error}>{review.error}</Text>}
      {open && (
        <Sheet title="Organize review" onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            Group changes by feature and explain linked impact. The model reads the diff in a
            separate ephemeral session. Verify its suggestions as you review.
          </Text>
          <Choice
            label="Review organizer harness"
            value={
              !agent
                ? 'titles'
                : agent.id.startsWith('saved:')
                  ? agent.id
                  : agent.acpInstallationId
                    ? acpHarnessChoiceId(agent.acpInstallationId)
                    : agent.provider
            }
            disabled={disabled || review.organizing}
            items={[
              { id: 'titles', name: 'Title harness & model (default)' },
              ...providerSchema.literals
                .filter((provider) => supportsUtilities(provider) && provider !== 'acp')
                .map((provider) => ({ id: provider, name: harnessNames[provider] })),
              ...installations.map((item) => ({
                id: acpHarnessChoiceId(item.id),
                name: `${item.name} · ACP`,
              })),
              ...agents
                .filter((agent) => supportsUtilities(agent.provider))
                .map((agent) => ({ id: `saved:${agent.id}`, name: agent.name })),
            ]}
            onChange={(value) => {
              if (value === 'titles') {
                setAgent(null)
                return
              }
              const saved = agents.find((item) => `saved:${item.id}` === value)
              if (saved) {
                setAgent({ ...saved, id: `saved:${saved.id}`, permission: 'read-only' })
                return
              }
              const installation = installations.find(
                (item) => acpHarnessChoiceId(item.id) === value,
              )
              if (installation) {
                setAgent({
                  ...acpInstallationHarness(installation, 'read-only'),
                  id: 'review-organizer',
                  name: installation.name,
                })
                return
              }
              const provider = providerSchema.literals.find((item) => item === value)
              if (provider)
                setAgent({
                  ...defaultTaskHarness(provider),
                  id: 'review-organizer',
                  name: harnessNames[provider],
                })
            }}
          />
          {agent ? (
            <ModelSettings
              key={agent.id + ':' + agent.provider}
              agent={agent}
              onChange={setAgent}
              disabled={disabled || review.organizing}
              serviceTier={false}
            />
          ) : (
            <Text style={styles.muted}>
              Uses the title harness and model configured on the connected computer.
            </Text>
          )}
          <Action
            label={
              review.organizing
                ? 'Organizing…'
                : review.featureGroups
                  ? 'Regroup by feature'
                  : 'Organize by feature'
            }
            disabled={blocked}
            onPress={() => {
              void review
                .organize(agent ? titleSettingsForHarness(agent) : undefined)
                .then((success) => {
                  if (success) {
                    onOrganized()
                    setOpen(false)
                  }
                })
            }}
          />
          {!!review.progress?.revision && (
            <Action
              label="Generate guided review"
              disabled={blocked}
              onPress={() => {
                void review
                  .organize(agent ? titleSettingsForHarness(agent) : undefined, true)
                  .then((success) => {
                    if (success) {
                      onOrganized()
                      setOpen(false)
                    }
                  })
              }}
            />
          )}
          {review.featureGroups && (
            <Action
              secondary
              label="Reset to folders"
              disabled={disabled || review.organizing}
              onPress={() => {
                review.clearGroups()
                setOpen(false)
              }}
            />
          )}
          {!!review.organizeError && <Text style={styles.error}>{review.organizeError}</Text>}
        </Sheet>
      )}
    </View>
  )
}
