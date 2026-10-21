import type { AccountClient, Artifact } from '@dovo/protocol'
import { useArtifactFeed, useWorkspace } from '@dovo/studio-core'
import { Button, Input, Textarea } from '@dovo/studio-ui'

export function ArtifactFeedSetup({
  artifact,
  publicationId,
  origin,
  client,
}: {
  artifact: Artifact
  publicationId: string
  origin: string
  client: AccountClient
}) {
  const { request, connected, activeRuntimeId } = useWorkspace()
  const feed = useArtifactFeed({
    artifact,
    publicationId,
    origin,
    client,
    runtimeId: activeRuntimeId,
    request,
    connected,
  })
  return (
    <section className="space-y-3 border-t pt-3" aria-label="Live MCP data feed">
      <h3 className="font-medium">Live MCP data</h3>
      <p>
        Approve one fixed read query for this published version. Your computer supplies the data;
        viewers cannot call tools or change the query.
      </p>
      <p className="text-muted-foreground">
        Only tools declared read-only are offered. These declarations are not a security guarantee:
        use a trusted server and credentials with read-only access.
      </p>
      <Button variant="outline" disabled={feed.busy || !connected} onClick={() => void feed.load()}>
        Load read-only MCP tools
      </Button>
      {feed.tools && !feed.tools.length && (
        <p>
          No eligible tools. Configure a read-only MCP server in this thread’s project or agent
          resources.
        </p>
      )}
      {!!feed.tools?.length && (
        <>
          <label className="block">
            MCP query
            <select
              aria-label="MCP query"
              className="mt-1 w-full rounded border p-2"
              value={feed.selection}
              disabled={feed.busy}
              onChange={(event) => feed.setSelection(event.target.value)}
            >
              {feed.tools.map((tool, index) => (
                <option key={`${tool.server}:${tool.tool}`} value={index}>
                  {tool.server} / {tool.tool}
                </option>
              ))}
            </select>
          </label>
          {feed.target && (
            <details>
              <summary>Tool description and argument schema</summary>
              <p>{feed.target.description}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(feed.target.inputSchema, null, 2)}
              </pre>
            </details>
          )}
          <label className="block">
            Query arguments (JSON)
            <Textarea
              aria-label="Query arguments (JSON)"
              value={feed.argumentsText}
              disabled={feed.busy}
              onChange={(event) => feed.setArguments(event.target.value)}
            />
          </label>
          <label className="block">
            JSON field to share
            <Input
              aria-label="JSON field to share"
              placeholder="/summary (empty shares the whole value)"
              value={feed.pointer}
              disabled={feed.busy}
              onChange={(event) => feed.setPointer(event.target.value)}
            />
          </label>
          <label className="block">
            Refresh interval
            <select
              aria-label="Refresh interval"
              value={feed.seconds}
              disabled={feed.busy}
              onChange={(event) => feed.setSeconds(Number(event.target.value))}
            >
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
            </select>
          </label>
          <Button
            variant="outline"
            disabled={feed.busy || !connected}
            onClick={() => void feed.read()}
          >
            Read preview
          </Button>
        </>
      )}
      {feed.plan && (
        <>
          <p>
            Review the exact selected data. Enabling uploads this value and future results to{' '}
            {origin}, visible to every invited account and anyone holding a shareable link. Enabling
            replaces the existing feed.
          </p>
          <pre
            aria-label="Selected feed data"
            className="max-h-52 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs"
          >
            {JSON.stringify(feed.plan.data, null, 2)}
          </pre>
          <Button disabled={feed.busy || !connected} onClick={() => void feed.enable()}>
            Approve and enable live feed
          </Button>
        </>
      )}
      {feed.status.enabled && (
        <div role="status">
          <p>
            Live feed enabled. This runtime must stay online. Cached data remains available until
            the hosted feed is cleared.
          </p>
          <Button
            variant="outline"
            disabled={feed.busy || !connected}
            onClick={() => void feed.stop()}
          >
            Stop and clear live feed
          </Button>
        </div>
      )}
      {!!(feed.error || feed.status.error) && (
        <p role="alert" className="text-destructive">
          {feed.error || feed.status.error}
        </p>
      )}
    </section>
  )
}
