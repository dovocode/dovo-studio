import { newSecret, hashSecret } from '../../auth/devices.js'
import { HttpError } from '../../errors.js'
export class SocketTickets {
  private tickets = new Map<
    string,
    { token: string; resourceId: string; expires: number; taskId?: string; syncTasks?: string[] }
  >()
  issue(token: string, resourceId: string, taskId?: string, syncTasks?: string[]) {
    for (const [key, value] of this.tickets)
      if (value.expires < Date.now()) this.tickets.delete(key)
    const ticket = newSecret()
    this.tickets.set(hashSecret(ticket), {
      token,
      resourceId,
      taskId,
      syncTasks,
      expires: Date.now() + 30000,
    })
    return ticket
  }
  consume(ticket: string) {
    const key = hashSecret(ticket),
      value = this.tickets.get(key)
    this.tickets.delete(key)
    if (!value || value.expires < Date.now()) throw new HttpError(401, 'Socket ticket expired')
    return value
  }
}
