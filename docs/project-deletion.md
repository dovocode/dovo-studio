# Delete a project

Desktop: open the project picker and choose **Delete project**. Mobile: open **Projects** and use
the delete action on the project. General is protected.

Deleting a project removes its local project entry and task histories. Active threads, automation
runs, terminals, pending questions or approvals, and active thread watches must be finished or
stopped first. Delegated child threads in another project must be moved out of the project before
deletion. Threads outside the project remain, with links to the deleted project removed. Automations
that use the project are disabled and redirected to General.

Project folders, Git repositories, task worktrees, and their files stay on disk. Hosted artifact
publications are saved copies and remain available. Local artifact feed writers for deleted task
histories are stopped and removed.
