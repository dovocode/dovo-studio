/** Automatic base for a task: with "Start from origin", prefer origin's matching or default
 * branch; otherwise use the current local branch. Unset flags retain older tasks' local behavior. */
export function defaultWorktreeBase(
  branches: ReadonlyArray<{ ref: string }>,
  current: string,
  fromOrigin = false,
  originDefault?: string,
) {
  const has = (ref: string | undefined) => !!ref && branches.some((branch) => branch.ref === ref)
  const candidates = fromOrigin
    ? [
        `refs/remotes/origin/${current}`,
        originDefault,
        'refs/remotes/origin/main',
        'refs/remotes/origin/master',
        `refs/heads/${current}`,
      ]
    : [`refs/heads/${current}`]
  return candidates.find(has) ?? branches[0]?.ref
}
