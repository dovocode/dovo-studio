import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { forgePullTarget } from '@dovo/protocol'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { RuntimeRoute } from '../../../shell/runtime-route'
import { backToCollection } from '../../../shell/source-route'
import { Action } from '../../../ui/controls/action'
import { ScreenHeader } from '../../../ui/layout/screen-header'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { PullDetail } from '../detail/pull-detail'
import { claimPullReviewRequest, pullRouteDestination, pullRouteNumber } from './pull-route-number'

export function PullRouteScreen() {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const params = useLocalSearchParams<{
    runtimeId: string
    repositoryId: string
    number: string
    tab?: string
    fragment?: string
    connectionId?: string
    navigationUrl?: string
    reviewRequest?: string
  }>()
  const number = pullRouteNumber(params.number)
  const destination = pullRouteDestination(params.tab)
  const reviewRequest =
    params.tab === 'agent-review' && params.reviewRequest ? params.reviewRequest : undefined
  const [reviewRun, setReviewRun] = useState<{ id: string; claim: () => boolean }>()
  useEffect(() => {
    if (
      !number ||
      !reviewRequest ||
      !claimPullReviewRequest(reviewRequest, params.runtimeId, params.repositoryId, number)
    )
      return
    let pending = true
    setReviewRun({
      id: reviewRequest,
      claim: () => {
        if (!pending) return false
        pending = false
        return true
      },
    })
  }, [reviewRequest, params.runtimeId, params.repositoryId, number])
  const back = () => backToCollection('/pulls')
  return (
    <RuntimeRoute
      runtimeId={params.runtimeId}
      repositoryId={forgePullTarget(params.repositoryId) ? undefined : params.repositoryId}
      title={number ? uiText('PR #{value0}', { value0: number }) : uiText('Pull request')}
      backTo="/pulls"
    >
      {number ? (
        <PullDetail
          key={JSON.stringify([
            params.runtimeId,
            params.repositoryId,
            number,
            params.connectionId,
            destination.initialAgentReview,
            reviewRequest,
          ])}
          repositoryId={params.repositoryId}
          number={number}
          connectionId={params.connectionId}
          {...destination}
          rowReviewRun={reviewRun?.id === reviewRequest ? reviewRun?.claim : undefined}
          initialFragment={params.fragment ?? ''}
          initialNavigationUrl={params.navigationUrl}
          onBack={back}
        />
      ) : (
        <View style={styles.screen}>
          <ScreenHeader
            title={uiText('Pull request')}
            leading={<Action label={uiText('Back to PRs')} secondary onPress={back} />}
          />
          <View style={styles.content}>
            <Text style={styles.title}>
              <InterfaceText>{'Pull request unavailable'}</InterfaceText>
            </Text>
            <Text style={styles.muted}>
              <InterfaceText>
                {'This link does not contain a valid pull request number.'}
              </InterfaceText>
            </Text>
          </View>
        </View>
      )}
    </RuntimeRoute>
  )
}
