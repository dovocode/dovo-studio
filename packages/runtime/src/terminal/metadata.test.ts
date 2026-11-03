import { expect, it } from 'vite-plus/test'
import type { TerminalActivity } from '@dovo/protocol'
import { TerminalMetadata } from './metadata.js'

function observer() {
  const events: Array<{
    type: 'title' | 'activity'
    title?: string
    activity?: TerminalActivity
  }> = []
  const parser = new TerminalMetadata((event) => events.push(event))
  return { parser, events }
}
const report = (body: string) => `\x1b]7501;${body}\x1b\\`
const base64 = (text: string) => Buffer.from(text).toString('base64')

it('reads OSC 0/2 and root activity at every possible chunk boundary', () => {
  const stream =
    `plain\x1b]0;Build 🙂\x07\x1b]2;Test\x1b\\` +
    report(
      `state=blocked:app=my-agent:kind=permission:progress=40:title=${base64('Build')}:msg=${base64('Apply changes?')}`,
    )
  for (let split = 0; split <= stream.length; split++) {
    const { parser, events } = observer()
    parser.write(stream.slice(0, split))
    parser.write(stream.slice(split))
    expect(events).toEqual([
      { type: 'title', title: 'Build 🙂' },
      { type: 'title', title: 'Test' },
      {
        type: 'activity',
        activity: {
          state: 'blocked',
          app: 'my-agent',
          kind: 'permission',
          progress: 40,
          title: 'Build',
          message: 'Apply changes?',
        },
      },
    ])
  }
})

it('replaces reports, skips malformed pairs, uses the last key and ignores unsupported kinds/progress', () => {
  const { parser, events } = observer()
  parser.write(report('state=working:app=build:progress=20'))
  parser.write(report('oops:unknown=yes:state=working:state=blocked:kind=future:progress=101'))
  parser.write(report(' state = idle : progress=40:kind=permission '))
  expect(events.map((event) => event.activity)).toEqual([
    { state: 'working', app: 'build', progress: 20 },
    { state: 'blocked' },
    { state: 'idle' },
  ])
})

it.each([
  'state=future',
  'app=build',
  '?',
  'state=blocked:id=worker',
  'state=clear:id=worker',
  'state=working:id=',
  'state=working:id=bad//id',
  'state=working:abcdefghijklmnopq=x',
  `state=working:app=${'a'.repeat(33)}:app=valid`,
  'state=working:title=a',
  'state=working:msg=YWJj=',
  `state=working:msg=${base64('line\nbreak')}`,
  `state=working:title=${base64('\x1b]2;spoof')}`,
  `state=working:title=${base64('\u202espoof')}`,
  `state=working:msg=${Buffer.from([0xff]).toString('base64')}`,
  `state=working:title=${base64('🙂'.repeat(49))}`,
  `state=working:msg=${base64('a'.repeat(2049))}`,
])('does not apply invalid or unsupported reports: %s', (body) => {
  const { parser, events } = observer()
  parser.write(report(body))
  expect(events).toEqual([])
})

it('clears transient reports at prompts and exit, retains done/error, and honors clear and RIS', () => {
  for (const state of ['working', 'blocked', 'idle', 'done', 'error']) {
    const { parser, events } = observer()
    parser.write(report(`state=${state}`))
    parser.write('\x1b]133;A;aid=prompt\x07')
    parser.endProcess()
    expect(events.at(-1)?.activity).toEqual(
      ['done', 'error'].includes(state) ? { state } : undefined,
    )
    parser.write(report('state=clear'))
    expect(events.at(-1)).toEqual({ type: 'activity', activity: undefined })
    parser.write(report('state=done') + '\x1bc')
    expect(events.at(-1)).toEqual({ type: 'activity', activity: undefined })
  }
})

it('bounds incomplete/oversized sequences, ignores nested control strings and recovers at terminators', () => {
  const { parser, events } = observer()
  parser.write('\x1b]2;' + 'x'.repeat(100_000))
  parser.write('\x1b]2;hidden\x07')
  parser.write('\x1bP' + report('state=working') + '\x1b\\')
  parser.write('\x1b]2;cancelled\x18')
  expect(events).toEqual([])
  parser.write('\x1b]2;Recovered\x07')
  parser.write(report('state=done'))
  expect(events).toEqual([
    { type: 'title', title: 'Recovered' },
    { type: 'activity', activity: { state: 'done' } },
  ])
})

it('rejects unsafe/oversized titles, accepts bounded Unicode and allows an explicit empty title', () => {
  const { parser, events } = observer()
  for (const title of ['\n', '\u202eSpoof', '\ud800', ' '.repeat(5), 'x'.repeat(257)])
    parser.write(`\x1b]2;${title}\x07`)
  parser.write('\x1b]2;项目 🙂\x07\x1b]0;\x07')
  expect(events).toEqual([
    { type: 'title', title: '项目 🙂' },
    { type: 'title', title: undefined },
  ])
})
