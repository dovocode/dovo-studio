import { useState } from 'react'
import type { JiraIssueFilters } from '@dovo/protocol'
import { Button, ChoicePicker } from '@dovo/studio-ui'
import type { WorkSource } from './work-sources'
import { useJiraBrowse } from './use-jira-browse'

export function JiraBrowseControls({
  source,
  filters,
  onFilters,
  enabled,
}: {
  source?: WorkSource
  filters: JiraIssueFilters
  onFilters: (value: JiraIssueFilters) => void
  enabled: boolean
}) {
  const [closed, setClosed] = useState(false)
  const { boards, sprints } = useJiraBrowse(source, filters.board, closed, enabled)
  return (
    <section aria-label="Boards and sprints" className="space-y-2">
      <h4 className="text-xs font-medium">Board & sprint</h4>
      {!source && (
        <p className="text-xs text-muted-foreground">
          Choose one source to browse its saved boards.
        </p>
      )}
      <ChoicePicker
        aria-label="Saved Jira board"
        value={filters.board ?? ''}
        disabled={!source}
        onValueChange={(board) => {
          setClosed(false)
          onFilters({ ...filters, board: board || undefined, sprint: undefined })
        }}
      >
        <option value="">All project issues</option>
        {filters.board && !boards.value?.boards.some((board) => board.id === filters.board) && (
          <option value={filters.board}>Board {filters.board}</option>
        )}
        {boards.value?.boards.map((board) => (
          <option key={board.id} value={board.id}>
            {board.name} · {board.type}
          </option>
        ))}
      </ChoicePicker>
      <ChoicePicker
        aria-label="Jira sprint"
        value={filters.sprint ?? ''}
        onValueChange={(sprint) => onFilters({ ...filters, sprint: sprint || undefined })}
      >
        <option value="">All sprints</option>
        {!filters.board && (
          <>
            <option value="active">Active sprints</option>
            <option value="future">Future sprints</option>
            <option value="none">No sprint</option>
          </>
        )}
        {filters.sprint &&
          !['active', 'future', 'none'].includes(filters.sprint) &&
          !sprints.value?.sprints.some((sprint) => sprint.id === filters.sprint) && (
            <option value={filters.sprint}>Sprint {filters.sprint}</option>
          )}
        {sprints.value?.sprints.map((sprint) => (
          <option key={sprint.id} value={sprint.id}>
            {sprint.name} · {sprint.state}
          </option>
        ))}
      </ChoicePicker>
      {!!filters.board && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setClosed((value) => !value)}
        >
          {closed ? 'Show active & future sprints' : 'Show closed sprints'}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!source?.connected || boards.busy || sprints.busy}
        onClick={() => {
          boards.retry()
          if (filters.board) sprints.retry()
        }}
      >
        Refresh board choices
      </Button>
      {(boards.busy || sprints.busy) && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading boards & sprints…
        </p>
      )}
      {[boards, sprints].map((resource, index) =>
        resource.error ? (
          <div key={index} role="alert" className="text-xs text-destructive">
            {resource.error}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!source?.connected || resource.busy}
              onClick={resource.retry}
            >
              Retry {index ? 'sprints' : 'boards'}
            </Button>
          </div>
        ) : null,
      )}
      {(boards.value?.stale || sprints.value?.stale) && (
        <p className="text-xs text-muted-foreground">Saved board and sprint choices.</p>
      )}
      {(boards.value?.truncated || sprints.value?.truncated) && (
        <p className="text-xs text-muted-foreground">
          Some choices are omitted. Open Jira for the full list.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Boards select available sprints. Choose a sprint to narrow issues to that board. Results
        always stay within this source’s project.
      </p>
    </section>
  )
}
