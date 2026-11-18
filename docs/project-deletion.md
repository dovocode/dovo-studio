# Delete a project

Desktop and web: open the project picker and choose **Delete project**. Mobile: open **Projects**
and use the delete action on the project. General is protected.

The confirmation names the computer. Deletion applies only to that computer and cannot be undone.

- **Will be removed:** The local project entry and its thread histories. Local artifact feeds for
  those threads stop and are removed.
- **Will change:** Dovo disables affected automations, redirects project targets to General, and
  removes references to the checkout from other threads and automations.
- **Will stay:** Project folders, Git repositories, worktrees, and their files stay on disk. Other
  projects and their threads stay in Dovo. Hosted artifact copies remain under their existing access
  settings.

Connect to the project's computer before deleting. Stop or finish active threads, automation runs,
terminals, pending questions or approvals, and active thread watches first. Resolve delegated thread
relationships that cross project boundaries. The confirmation shows known blockers and links to an
affected thread or the exact automation run. On mobile, the delete button stays hidden while known
work blocks deletion or the computer is offline. Offline, mobile labels cached blockers as last
known. Reconnect to see current data.

The computer checks again when you confirm. The preview only uses work in the current snapshot. For
example, the snapshot can omit pending checkpoint restores, older runs, and work that a finished run
still owns. If work starts after the preview, the computer can reject the request. If the connection
drops during the request, reconnect and check the project list before trying again. Dovo does not
queue the request for later.
