import { useEffect } from 'react'
import { Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { branchesSchema, defaultWorktreeBase } from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { useRuntime } from '../../runtime/connection/provider'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function WorktreeBasePicker({
  repositoryId,
  value,
  fromOrigin = false,
  onChange,
}: {
  repositoryId: string
  value?: string
  fromOrigin?: boolean
  onChange: (value: string) => void
}) {
  const { styles } = useTheme()

  const { callEffect } = useRuntime()
  const [data, setData] = useApplicationState<Schema.Schema.Type<typeof branchesSchema> | null>(
    null,
  )
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    let active = true
    setData(null)
    setError('')
    void runClientEffect(callEffect('/api/scm/branches', { repositoryId }, branchesSchema)).then(
      (result) => {
        if (active) setData(result)
      },
      (error: unknown) => {
        if (active) setError(String(error))
      },
    )
    return () => {
      active = false
    }
  }, [repositoryId, callEffect])
  return (
    <>
      <Choice
        label="Create worktree from branch"
        disabled={!data}
        value={
          data?.branches.find((branch) => branch.ref === value || branch.name === value)?.ref ??
          value ??
          (data &&
            defaultWorktreeBase(data.branches, data.current, fromOrigin, data.originDefault)) ??
          ''
        }
        items={data?.branches.map((branch) => ({ id: branch.ref, name: branch.name })) ?? []}
        onChange={onChange}
      />
      {!data && !error && <Text style={styles.muted}>Loading branches…</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </>
  )
}
