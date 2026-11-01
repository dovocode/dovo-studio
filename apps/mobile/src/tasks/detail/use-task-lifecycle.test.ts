import { afterEach, expect, it, vi } from 'vite-plus/test'
import { taskSnoozeChoices } from '@dovo/protocol'

const state = vi.hoisted(() => ({
  platform: 'android',
  minutes: [15, 60, 90, 240, 1440, 2880, 4320, 10080, 20160, 30240, 40320, 525600],
  alert:
    vi.fn<
      (
        title: string,
        message: string,
        buttons: { text: string; onPress?: () => void; style?: string }[],
      ) => void
    >(),
}))
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.platform
    },
  },
  Alert: { alert: state.alert },
}))
vi.mock('../../runtime/preferences/app-preferences', () => ({
  readMobilePreferences: () => ({ taskSnoozeMinutes: state.minutes }),
}))
vi.mock('../../runtime/state/native-effect', () => ({ mobileWorkflow: vi.fn<() => void>() }))
vi.mock('../../runtime/connection/provider', () => ({
  useRuntimeSelector: vi.fn<() => void>(),
  sameRuntimeFields: vi.fn<() => void>(),
}))
vi.mock('../../ui/controls/use-action', () => ({ useAction: vi.fn<() => void>() }))
import { chooseSnoozeDuration } from './use-task-lifecycle'

afterEach(() => {
  state.alert.mockClear()
  state.platform = 'android'
})

it('keeps every configured duration reachable within Android’s three-button limit', () => {
  const apply = vi.fn<(hours: number) => void>()
  chooseSnoozeDuration('Snooze selected threads', apply)
  const labels: string[] = []
  for (let page = 0; page < 6; page++) {
    const call = state.alert.mock.calls.at(-1)
    expect(call).toBeDefined()
    const buttons = call![2]
    expect(buttons.length).toBeLessThanOrEqual(3)
    for (const button of buttons.filter((button) => button.text.startsWith('For '))) {
      labels.push(button.text)
      button.onPress?.()
    }
    const more = buttons.find((button) => button.text === 'More durations…')
    if (!more) break
    more.onPress?.()
  }
  expect(state.alert.mock.calls.at(-1)?.[2].at(-1)?.style).toBe('cancel')
  expect(labels).toEqual(taskSnoozeChoices(state.minutes).map((option) => option.label))
  expect(apply.mock.calls.map(([hours]) => hours)).toEqual(
    state.minutes.map((minutes) => minutes / 60),
  )
})

it('shows all configured durations together on iOS', () => {
  state.platform = 'ios'
  chooseSnoozeDuration('Snooze thread', vi.fn<() => void>())
  const buttons = state.alert.mock.calls[0]![2]
  expect(buttons).toHaveLength(state.minutes.length + 1)
  expect(buttons.at(-1)?.style).toBe('cancel')
})
