/** Where a new worktree starts. By default that is the project's current local branch. With
 * "Start from origin" it is origin's copy of that branch, or origin's default branch when the
 * current branch has no counterpart there. */
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
