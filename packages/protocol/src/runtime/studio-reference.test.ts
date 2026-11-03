import { describe, expect, test } from 'vite-plus/test'
import { parseStudioReference, studioReference, studioReferenceId } from './studio-reference'

describe('studio references', () => {
  test('round-trips thread and browser references', () => {
    expect(studioReference('local', 'thread', 'abc-123')).toBe('studio:local:thread:abc-123')
    expect(parseStudioReference('studio:local:thread:abc-123')).toEqual({
      runtimeId: 'local',
      kind: 'thread',
      id: 'abc-123',
    })
    expect(parseStudioReference('studio:rt-9:browser:workspace:tab-1')).toEqual({
      runtimeId: 'rt-9',
      kind: 'browser',
      id: 'workspace:tab-1',
    })
  })

  test('accepts the three-part form without a kind', () => {
    expect(parseStudioReference('studio:local:agent-browser:task-1')).toEqual({
      runtimeId: 'local',
      id: 'agent-browser:task-1',
    })
    expect(studioReferenceId('studio:local:agent-browser:task-1', 'browser')).toBe(
      'agent-browser:task-1',
    )
  })

  test('defaults an empty runtime to local and rejects unsafe segments', () => {
    expect(studioReference('', 'thread', 't1')).toBe('studio:local:thread:t1')
    expect(() => studioReference('bad runtime', 'thread', 't1')).toThrow(
      'Invalid Studio runtime ID',
    )
    expect(parseStudioReference('studio:bad runtime:thread:t1')).toBeUndefined()
    expect(parseStudioReference('studio:local:')).toBeUndefined()
    expect(parseStudioReference('plain-id')).toBeUndefined()
  })

  test('studioReferenceId only strips matching kinds', () => {
    expect(studioReferenceId('studio:local:thread:t1', 'thread')).toBe('t1')
    expect(studioReferenceId('studio:local:thread:t1', 'browser')).toBe('studio:local:thread:t1')
    expect(studioReferenceId('workspace:tab-1')).toBe('workspace:tab-1')
  })
})
