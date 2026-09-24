/** Prefer the remote default branches without changing the project's checkout. */
export function defaultWorktreeBase(branches: ReadonlyArray<{ ref: string }>, current: string) {
  return (
    ['refs/remotes/origin/main', 'refs/remotes/origin/master', `refs/heads/${current}`].find(
      (ref) => branches.some((branch) => branch.ref === ref),
    ) ?? branches[0]?.ref
  )
}
