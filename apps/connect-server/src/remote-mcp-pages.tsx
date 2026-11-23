import { Button } from '@dovo/web-ui'
import { renderHtml } from '@dovo/web-ui/server'
import type { RemoteMcpStore } from './remote-mcp-store.js'

export function remoteMcpSignIn() {
  return renderHtml(
    <>
      <h2>Sign in to manage MCP connections</h2>
      <p>Use the Dovo account that owns the computers you want to connect.</p>
      <form method="post" action="/auth/authorize">
        <Button size="touch" type="submit">
          Continue to Dovo sign-in
        </Button>
      </form>
    </>,
  )
}

export function remoteMcpConsent(computer: string, app: string, callback: string) {
  return renderHtml(
    <>
      <h2>
        Connect {app} to {computer}
      </h2>
      <p>
        The app uses a callback at {callback}. Only continue if you started this link in that app.
      </p>
      <p>
        Connect handles the data you share with this app. This grant covers Studio threads and
        automations on this computer, including their project context.
      </p>
      <form method="post" action="/mcp/approve">
        <Button type="submit" size="touch" name="access" value="read">
          Allow read access
        </Button>
      </form>
      <form method="post" action="/mcp/approve">
        <Button type="submit" size="touch" name="access" value="run">
          Allow reading and running agents
        </Button>
      </form>
      <p className="consent-note">
        Run access lets the app launch agents, send follow-ups, stop or resume threads and start
        configured automations. Studio applies the destination’s saved permissions and approval
        settings.
      </p>
    </>,
  )
}

export function remoteMcpManage(
  computers: { name: string; url: string }[],
  grants: ReturnType<RemoteMcpStore['list']>,
) {
  return renderHtml(
    <>
      <h2>Remote MCP connections</h2>
      <p>Copy the address for a computer into your AI app’s custom MCP server settings.</p>
      {computers.length === 0 && (
        <p>Enable remote MCP on an online Connect computer to get its address.</p>
      )}
      {computers.map((computer) => (
        <p key={computer.url}>
          <strong>{computer.name}</strong>
          <br />
          <a href={computer.url}>{computer.url}</a>
        </p>
      ))}
      {grants.map((grant) => (
        <form key={grant.id} method="post" action="/mcp/manage/revoke">
          <p>
            {grant.app} · {grant.computer} · {grant.access === 'run' ? 'Read and run' : 'Read'}
          </p>
          <input type="hidden" name="grant" value={grant.id} />
          <Button type="submit" size="touch" variant="outline">
            Revoke {grant.app}
          </Button>
        </form>
      ))}
    </>,
  )
}
