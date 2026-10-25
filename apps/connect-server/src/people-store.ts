import { randomUUID } from 'node:crypto'
import { peopleDirectorySchema, decode, type PeopleAction } from '@dovo/protocol'
import type { AccountStore } from './store.js'
import { RequestError } from './http.js'

/** Sharing relationships never confer computer, pairing or relay permissions. */
export class PeopleStore {
  constructor(private accounts: AccountStore) {
    accounts.db.exec(`
      CREATE TABLE IF NOT EXISTS sharing_friends(sender TEXT NOT NULL,recipient TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(sender,recipient));
      CREATE TABLE IF NOT EXISTS sharing_organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sharing_members(organization TEXT NOT NULL,user TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(organization,user));
    `)
  }
  directory(user: string) {
    const db = this.accounts.db
    const friends = db
      .prepare(`SELECT u.id,u.name,f.sender,f.accepted FROM sharing_friends f
      JOIN users u ON u.id=CASE WHEN f.sender=? THEN f.recipient ELSE f.sender END
      WHERE (f.sender=? OR f.recipient=?) ORDER BY u.name,u.id`)
      .all(user, user, user)
      .filter((row) => !this.accounts.deleting(String(row.id)))
      .map((row) => ({
        id: row.id,
        name: row.name,
        status: row.accepted ? 'accepted' : row.sender === user ? 'outgoing' : 'incoming',
      }))
    const organizations = db
      .prepare(
        `SELECT o.*,m.accepted FROM sharing_organizations o JOIN sharing_members m ON m.organization=o.id WHERE m.user=? ORDER BY o.name,o.id`,
      )
      .all(user)
      .filter((row) => !this.accounts.deleting(String(row.owner)))
      .map((row) => ({
        id: row.id,
        name: row.name,
        ownerId: row.owner,
        status: row.accepted ? 'member' : 'invited',
        // An invitation reveals its owner, not the organisation's private member directory.
        members: db
          .prepare(
            `SELECT u.id,u.name,m.accepted FROM sharing_members m JOIN users u ON u.id=m.user WHERE m.organization=? AND (?=1 OR m.user=?) ORDER BY u.name,u.id`,
          )
          .all(String(row.id), Number(row.accepted), String(row.owner))
          .filter((member) => !this.accounts.deleting(String(member.id)))
          .map((member) => ({
            id: member.id,
            name: member.name,
            status: member.accepted ? 'member' : 'invited',
          })),
      }))
    return decode(peopleDirectorySchema, { friends, organizations })
  }
  memberships(user: string) {
    return this.accounts.db
      .prepare(
        `SELECT o.id FROM sharing_organizations o JOIN sharing_members m ON m.organization=o.id WHERE m.user=? AND m.accepted=1`,
      )
      .all(user)
      .filter((row) => {
        const organization = this.accounts.db
          .prepare('SELECT owner FROM sharing_organizations WHERE id=?')
          .get(String(row.id))
        return organization && !this.accounts.deleting(String(organization.owner))
      })
      .map((row) => String(row.id))
  }
  mutate(user: string, input: PeopleAction) {
    const db = this.accounts.db
    db.exec('BEGIN IMMEDIATE')
    try {
      if ('userId' in input && input.action !== 'removeMember') this.person(input.userId)
      switch (input.action) {
        case 'requestFriend': {
          if (user === input.userId)
            throw new RequestError(400, 'You cannot add yourself as a friend')
          const existing = db
            .prepare(
              'SELECT 1 FROM sharing_friends WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)',
            )
            .get(user, input.userId, input.userId, user)
          if (existing) throw new RequestError(409, 'A friendship or request already exists')
          for (const id of [user, input.userId]) {
            const count = db
              .prepare('SELECT count(*) AS n FROM sharing_friends WHERE sender=? OR recipient=?')
              .get(id, id)
            if (Number(count?.n) >= 100) throw new RequestError(409, 'Friend limit reached')
          }
          db.prepare('INSERT INTO sharing_friends(sender,recipient) VALUES(?,?)').run(
            user,
            input.userId,
          )
          break
        }
        case 'acceptFriend':
          if (
            !db
              .prepare('UPDATE sharing_friends SET accepted=1 WHERE sender=? AND recipient=?')
              .run(input.userId, user).changes
          )
            throw new RequestError(404, 'Friend request unavailable')
          break
        case 'removeFriend':
          db.prepare(
            'DELETE FROM sharing_friends WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)',
          ).run(user, input.userId, input.userId, user)
          break
        case 'createOrganization': {
          const name = input.name.trim()
          if (!name) throw new RequestError(400, 'Enter an organisation name')
          if (
            Number(
              db.prepare('SELECT count(*) AS n FROM sharing_members WHERE user=?').get(user)?.n,
            ) >= 20
          )
            throw new RequestError(409, 'Organisation limit reached')
          const id = randomUUID()
          db.prepare('INSERT INTO sharing_organizations VALUES(?,?,?)').run(id, name, user)
          db.prepare('INSERT INTO sharing_members VALUES(?,?,1)').run(id, user)
          break
        }
        case 'inviteMember': {
          this.owner(user, input.organizationId)
          this.person(input.userId)
          if (
            db
              .prepare('SELECT 1 FROM sharing_members WHERE organization=? AND user=?')
              .get(input.organizationId, input.userId)
          )
            throw new RequestError(409, 'This person is already a member or invited')
          if (
            Number(
              db
                .prepare('SELECT count(*) AS n FROM sharing_members WHERE organization=?')
                .get(input.organizationId)?.n,
            ) >= 100 ||
            Number(
              db.prepare('SELECT count(*) AS n FROM sharing_members WHERE user=?').get(input.userId)
                ?.n,
            ) >= 20
          )
            throw new RequestError(409, 'Organisation membership limit reached')
          db.prepare('INSERT INTO sharing_members(organization,user) VALUES(?,?)').run(
            input.organizationId,
            input.userId,
          )
          break
        }
        case 'acceptOrganization':
          if (
            !db
              .prepare('UPDATE sharing_members SET accepted=1 WHERE organization=? AND user=?')
              .run(input.organizationId, user).changes
          )
            throw new RequestError(404, 'Organisation invitation unavailable')
          break
        case 'removeMember': {
          const org = db
            .prepare('SELECT owner FROM sharing_organizations WHERE id=?')
            .get(input.organizationId)
          if (!org || (org.owner !== user && input.userId !== user))
            throw new RequestError(403, 'Only the owner can remove other members')
          if (org.owner === input.userId)
            throw new RequestError(400, 'The owner must delete the organisation instead of leaving')
          db.prepare('DELETE FROM sharing_members WHERE organization=? AND user=?').run(
            input.organizationId,
            input.userId,
          )
          break
        }
        case 'deleteOrganization':
          this.owner(user, input.organizationId)
          db.prepare('DELETE FROM sharing_members WHERE organization=?').run(input.organizationId)
          db.prepare('DELETE FROM sharing_organizations WHERE id=?').run(input.organizationId)
          break
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return this.directory(user)
  }
  private person(id: string) {
    if (!this.accounts.artifactOwnerActive(id))
      throw new RequestError(404, 'No account with that sharing ID')
  }
  private owner(user: string, id: string) {
    if (
      this.accounts.db.prepare('SELECT owner FROM sharing_organizations WHERE id=?').get(id)
        ?.owner !== user
    )
      throw new RequestError(403, 'Only the organisation owner can manage members')
  }
  deleteAccount(user: string) {
    const db = this.accounts.db
    db.prepare('DELETE FROM sharing_friends WHERE sender=? OR recipient=?').run(user, user)
    db.prepare(
      'DELETE FROM sharing_members WHERE user=? OR organization IN (SELECT id FROM sharing_organizations WHERE owner=?)',
    ).run(user, user)
    db.prepare('DELETE FROM sharing_organizations WHERE owner=?').run(user)
  }
}
