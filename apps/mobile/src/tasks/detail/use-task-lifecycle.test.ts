import { afterEach, expect, it, vi } from 'vite-plus/test'
import { taskSnoozeMenuChoices, defaultTaskSnoozeSchedule } from '@dovo/protocol'

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
  readMobilePreferences: () => ({
    taskSnoozeMinutes: state.minutes,
    taskSnoozeSchedule: defaultTaskSnoozeSchedule,
  }),
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
  vi.useRealTimers()
})

it('keeps every configured duration reachable within Android’s three-button limit', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 1, 10))
  const options = taskSnoozeMenuChoices(state.minutes)
  const apply = vi.fn<(until: string) => void>()
  chooseSnoozeDuration('Snooze selected threads', apply)
  const labels: string[] = []
  for (let page = 0; page < 10; page++) {
    const call = state.alert.mock.calls.at(-1)
    expect(call).toBeDefined()
    const buttons = call![2]
    expect(buttons.length).toBeLessThanOrEqual(3)
    for (const button of buttons.filter(
      (button) => button.text !== 'More options…' && button.style !== 'cancel',
    )) {
      labels.push(button.text)
      button.onPress?.()
    }
    const more = buttons.find((button) => button.text === 'More options…')
    if (!more) break
    more.onPress?.()
  }
  expect(state.alert.mock.calls.at(-1)?.[2].at(-1)?.style).toBe('cancel')
  expect(labels).toEqual(options.map((option) => option.label))
  expect(apply.mock.calls.map(([until]) => until)).toEqual(options.map((option) => option.until()))
})

it('shows all configured durations together on iOS', () => {
  state.platform = 'ios'
  chooseSnoozeDuration('Snooze thread', vi.fn<() => void>())
  const buttons = state.alert.mock.calls[0]![2]
  expect(buttons).toHaveLength(taskSnoozeMenuChoices(state.minutes).length + 1)
  expect(buttons.at(-1)?.style).toBe('cancel')
})

it('resolves a duration at selection time, including after paging', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 1, 10))
  const apply = vi.fn<(until: string) => void>()
  chooseSnoozeDuration('Snooze thread', apply)
  while (!state.alert.mock.calls.at(-1)![2].some((button) => button.text === 'For 15 minutes'))
    state.alert.mock.calls.at(-1)![2].find((button) => button.text === 'More options…')!.onPress!()
  vi.setSystemTime(new Date(2026, 10, 1, 11))
  state.alert.mock.calls.at(-1)![2].find((button) => button.text === 'For 15 minutes')!.onPress!()
  expect(apply).toHaveBeenCalledWith(new Date(2026, 10, 1, 11, 15).toISOString())
})
