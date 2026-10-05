import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { RuntimeRoute } from '../../../shell/runtime-route'
import { backToCollection } from '../../../shell/source-route'
import { Action } from '../../../ui/controls/action'
import { ScreenHeader } from '../../../ui/layout/screen-header'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { PullDetail } from '../detail/pull-detail'
import { pullRouteNumber } from './pull-route-number'

export function PullRouteScreen() {
  const { styles } = useTheme()

  const params = useLocalSearchParams<{
    runtimeId: string
    repositoryId: string
    number: string
  }>()
  const number = pullRouteNumber(params.number)
  const back = () => backToCollection('/pulls')
  return (
    <RuntimeRoute
      runtimeId={params.runtimeId}
      repositoryId={params.repositoryId}
      title={number ? `PR #${number}` : 'Pull request'}
      backTo="/pulls"
    >
      {number ? (
        <PullDetail
          key={JSON.stringify([params.runtimeId, params.repositoryId, number])}
          repositoryId={params.repositoryId}
          number={number}
          onBack={back}
        />
      ) : (
        <View style={styles.screen}>
          <ScreenHeader
            title="Pull request"
            leading={<Action label="Back to PRs" secondary onPress={back} />}
          />
          <View style={styles.content}>
            <Text style={styles.title}>Pull request unavailable</Text>
            <Text style={styles.muted}>
              This link does not contain a valid pull request number.
            </Text>
          </View>
        </View>
      )}
    </RuntimeRoute>
  )
}
