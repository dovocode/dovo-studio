import type { AccountClient, Artifact, OpenShare } from '@dovo/protocol'
import { useArtifactFeed, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@dovo/studio-ui'

export function ArtifactFeedSetup({
  artifact,
  publicationId,
  origin,
  client,
  encryptedShare,
  onShareChange,
}: {
  artifact: Artifact
  publicationId: string
  origin: string
  client: AccountClient
  encryptedShare?: OpenShare
  onShareChange?: (share: OpenShare) => void
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
    encryptedShare,
    onShareChange,
  })
  return (
    <section
      className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
      aria-label="Live MCP data feed"
    >
      <h2 className="font-medium">Live MCP data</h2>
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
          <div className="space-y-2">
            <p className="text-xs font-medium">MCP query</p>
            <Select value={feed.selection} disabled={feed.busy} onValueChange={feed.setSelection}>
              <SelectTrigger aria-label="MCP query">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {feed.tools.map((tool, index) => (
                  <SelectItem key={`${tool.server}:${tool.tool}`} value={String(index)}>
                    {tool.server} / {tool.tool}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {feed.target && (
            <details>
              <summary className="cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Tool description and argument schema
              </summary>
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
          <div className="space-y-2">
            <p className="text-xs font-medium">Refresh interval</p>
            <Select
              value={String(feed.seconds)}
              disabled={feed.busy}
              onValueChange={(value) => feed.setSeconds(Number(value))}
            >
              <SelectTrigger aria-label="Refresh interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">1 minute</SelectItem>
                <SelectItem value="300">5 minutes</SelectItem>
                <SelectItem value="900">15 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
