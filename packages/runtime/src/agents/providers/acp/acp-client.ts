import type {
  ClientRequestHandlersByMethod,
  ClientRequestMethod,
  ClientRequestParamsByMethod,
  SessionNotification,
} from '@agentclientprotocol/sdk/unstable'

type Request<Method extends ClientRequestMethod> = (
  params: ClientRequestParamsByMethod[Method],
) => ReturnType<ClientRequestHandlersByMethod[Method]>

/** Mutable callbacks let warm ACP sessions hand interactions to the current turn. */
export type AcpClient = {
  requestPermission: Request<'session/request_permission'>
  sessionUpdate: (params: SessionNotification) => void | Promise<void>
  readTextFile?: Request<'fs/read_text_file'>
  writeTextFile?: Request<'fs/write_text_file'>
  createTerminal?: Request<'terminal/create'>
  terminalOutput?: Request<'terminal/output'>
  waitForTerminalExit?: Request<'terminal/wait_for_exit'>
  killTerminal?: Request<'terminal/kill'>
  releaseTerminal?: Request<'terminal/release'>
  createElicitation?: Request<'elicitation/create'>
}
