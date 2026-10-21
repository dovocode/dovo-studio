import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { decode, pullDetailSchema, type PullDetail } from '@dovo/protocol'
import { Action } from '../ui/controls/action'
import { PullRequestIcon } from '../ui/content/pull-request-icon'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { RuntimeContext } from '../runtime/connection/context'
import { disconnectedRuntime } from './disconnected-runtime'
import { PullStatus } from '../scm/pulls/detail/pull-status'

export type PullExampleScenario = 'failing-review' | 'draft-pending' | 'merged-approved'

const repositoryUrl = 'https://github.com/example/mobile'
const checkedAt = '2026-10-21T10:00:00.000Z'
const headSha = 'abcdef0123456789abcdef0123456789abcdef01'
const baseSha = '0123456789abcdef0123456789abcdef01234567'

function pullDetail(scenario: PullExampleScenario): PullDetail {
  const draft = scenario === 'draft-pending'
  const merged = scenario === 'merged-approved'
  const state = merged ? 'merged' : 'open'
  const number = draft ? 52 : merged ? 53 : 51
  const url = `${repositoryUrl}/pull/${number}`
  const checks =
    scenario === 'failing-review'
      ? [
          {
            name: 'iOS / reconnect after the signaling service restarts',
            status: 'FAILURE',
            url: `${url}/checks/ios-reconnect`,
            summary: 'The retry timer did not resume after signaling became available.',
            details: 'Expected connected state after retry; the connection stayed in progress.',
            annotations: [
              {
                path: 'apps/mobile/src/webrtc/reconnect.ts',
                startLine: 118,
                endLine: 120,
                level: 'failure',
                title: 'Reconnect deadline exceeded',
                message: 'Restore the retry schedule after the signaling channel reopens.',
              },
            ],
          },
          {
            name: 'Android / TURN relay recovery on a constrained network',
            status: 'IN_PROGRESS',
            url: `${url}/checks/android-turn`,
          },
          {
            name: 'web / protocol and type checks',
            status: 'SUCCESS',
            url: `${url}/checks/web`,
          },
        ]
      : [
          {
            name: draft ? 'Native test matrix' : 'Native test matrix',
            status: draft ? 'EXPECTED' : 'SUCCESS',
            url: `${url}/checks/native`,
          },
        ]
  const comments =
    scenario === 'failing-review'
      ? [
          {
            id: 'review-requested',
            author: 'Alex Reviewer',
            body: 'Please handle the reconnect path after a signaling restart.',
            date: checkedAt,
            url: `${url}#review-1`,
            kind: 'review',
            state: 'CHANGES_REQUESTED',
          },
          {
            id: 'review-approved',
            author: 'Sam Reviewer',
            body: 'The transport test changes look good.',
            date: checkedAt,
            url: `${url}#review-2`,
            kind: 'review',
            state: 'APPROVED',
          },
        ]
      : merged
        ? [
            {
              id: 'review-approved',
              author: 'Sam Reviewer',
              body: 'Approved after the device matrix passed.',
              date: checkedAt,
              url: `${url}#review-3`,
              kind: 'review',
              state: 'APPROVED',
            },
          ]
        : []

  return decode(pullDetailSchema, {
    pull: {
      number,
      title:
        scenario === 'failing-review'
          ? 'Recover mobile WebRTC sessions after signaling restarts and preserve TURN state'
          : draft
            ? 'Draft: add native reconnect coverage'
            : 'Ship stable mobile reconnect behavior',
      url,
      state,
      draft,
      author: 'Dominic',
      updatedAt: checkedAt,
      head: `feature/mobile-pull-${number}`,
      base: 'main',
      labels: ['mobile', 'webrtc'],
      checksState: scenario === 'failing-review' ? 'FAILURE' : draft ? 'EXPECTED' : 'SUCCESS',
      reviewDecision:
        scenario === 'failing-review' ? 'CHANGES_REQUESTED' : merged ? 'APPROVED' : null,
      body: 'Synthetic pull request detail for the shared mobile catalog.',
      provider: 'github',
      repositoryUrl,
      headSha,
      baseSha,
      additions: 142,
      deletions: 38,
      changedFiles: 5,
      mergeable: merged ? true : draft ? null : false,
      reviewers: draft ? ['alex-reviewer'] : ['alex-reviewer', 'sam-reviewer'],
      assignees: ['Dominic'],
    },
    comments,
    checks,
    files: [],
    warnings: [],
  })
}

const scenarios: { id: PullExampleScenario; label: string }[] = [
  { id: 'failing-review', label: 'Open · failed checks' },
  { id: 'draft-pending', label: 'Draft · checks pending' },
  { id: 'merged-approved', label: 'Merged · approved' },
]

export function PullExample({
  initialScenario = 'failing-review',
}: {
  initialScenario?: PullExampleScenario
}) {
  const [scenario, setScenario] = useState(initialScenario)
  const [opened, setOpened] = useState('Choose a check or review to preview its local action.')
  const { colors, styles } = useTheme()
  const detail = pullDetail(scenario)

  return (
    <RuntimeContext.Provider value={disconnectedRuntime}>
      <View style={[styles.screen, { padding: 16, gap: 16 }]}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PullRequestIcon state={detail.pull.state} draft={detail.pull.draft} size={20} />
            <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]}>
              Pull request #{detail.pull.number}
            </Text>
          </View>
          <Text style={styles.text}>{detail.pull.title}</Text>
          <Text style={styles.muted}>
            {detail.pull.state === 'merged' ? 'Merged' : detail.pull.draft ? 'Draft' : 'Open'} ·{' '}
            {detail.pull.head} → {detail.pull.base} · {detail.pull.author}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {scenarios.map((item) => (
            <Action
              key={item.id}
              secondary={scenario !== item.id}
              label={item.label}
              onPress={() => {
                setScenario(item.id)
                setOpened('Choose a check or review to preview its local action.')
              }}
            />
          ))}
        </View>

        <View style={[styles.card, { gap: 16 }]}>
          <PullStatus
            detail={detail}
            onOpen={(url) => {
              const check = detail.checks.find((item) => item.url === url)
              const review = detail.comments.find((item) => item.url === url)
              setOpened(
                check
                  ? `Selected check locally: ${check.name}`
                  : review
                    ? `Selected review locally: ${review.author}`
                    : 'Selected a local pull request resource.',
              )
            }}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setOpened('Opened the synthetic pull request link locally.')}
          style={({ pressed }) => [
            styles.row,
            {
              minHeight: 48,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingHorizontal: 12,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Open PR preview</Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {opened} No navigation or forge request is performed.
        </Text>
      </View>
    </RuntimeContext.Provider>
  )
}
