import { isValidElement, useEffect, useState, type ReactNode } from 'react'
import { forgeIssueDetailSchema, type ForgeIssue } from '@dovo/protocol'
import { sameWorkspaceFields, useWorkspaceSelector, type useWorkspace } from '@dovo/studio-core'
import { resolveLinkTargets } from '@dovo/studio-core/links'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dovo/studio-ui/tooltip'

const selectSources = (workspace: ReturnType<typeof useWorkspace>) => ({
  readRuntime: workspace.readRuntime,
  activeRuntimeId: workspace.activeRuntimeId,
  runtimes: workspace.runtimes,
})

export function TaskIssueLinkPreview({
  href,
  repositoryId,
  children,
}: {
  href: string
  repositoryId: string
  children: ReactNode
}) {
  const { activeRuntimeId, runtimes, readRuntime } = useWorkspaceSelector(
    selectSources,
    sameWorkspaceFields,
  )
  const targets = resolveLinkTargets(href, runtimes, {
    runtimeId: activeRuntimeId ?? undefined,
    repositoryId,
  })
  const target = targets.length === 1 ? targets[0] : undefined
  const issue = target?.kind === 'issue' || target?.kind === 'jira' ? target : undefined
  const runtime = issue && runtimes.find((entry) => entry.profile.id === issue.runtimeId)
  const profile = runtime?.connected ? runtime.profile : undefined
  const project = issue?.repositoryId
  const jira = issue?.jiraSourceId
  const id = issue?.itemId
  const key = JSON.stringify([profile?.id, profile?.connection, project, jira, id, href])
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<{ key: string; issue?: ForgeIssue }>()
  const current = preview?.key === key ? preview : undefined

  useEffect(() => {
    if (!open || !profile || !id || current) return
    let active = true
    void readRuntime(
      profile,
      '/api/scm/work/issues/detail',
      { ...(jira ? { jiraSourceId: jira } : { repositoryId: project }), id, section: 'overview' },
      forgeIssueDetailSchema,
    ).then(
      ({ issue }) => {
        if (active) setPreview({ key, issue: issue.id === id ? issue : undefined })
      },
      () => {
        if (active) setPreview({ key })
      },
    )
    return () => {
      active = false
    }
  }, [open, profile, id, key, current, project, jira, readRuntime])

  if (!profile || !id || !isValidElement(children)) return children
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!next && current && !current.issue) setPreview(undefined)
        setOpen(next)
      }}
      delayDuration={350}
      disableHoverableContent
    >
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-80 rounded-lg whitespace-normal">
        {current?.issue ? (
          <>
            <strong className="block break-words">{current.issue.title}</strong>
            <span className="text-muted-foreground">
              {current.issue.state} · {id}
            </span>
          </>
        ) : current ? (
          <span className="break-all">{href}</span>
        ) : (
          'Loading issue…'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
