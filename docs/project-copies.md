# Copy a project to another computer

On desktop, open the project's settings. On mobile, open the project in Projects. Choose **Add to
another computer**, select a paired destination, and choose **Dovo P2P** or **SSH tunnel**. Both
computers need an updated Dovo runtime. From the composer’s machine picker, a selected project also
has **Add to another machine**. For a thread with a worktree, choose **Copy worktree to another
machine** from the thread menu; that checkout is preselected and destination thread creation is
enabled. Studio also offers **Copy project checkout to another machine** for threads using the
project folder, including threads on another paired computer. The source sends files directly to the
destination; the phone or desktop UI does not relay them.

In Studio’s **Devices & runtime**, manage a computer and save its **SSH address** as
`ssh://user@host:port`. The address is stored on that computer, shared with paired clients, and
pre-fills Studio’s copy dialog when you select it as the destination. Clear the field and save to
remove it. Passwords and SSH key paths are not shared.

SSH uses the source computer's OpenSSH client, configured keys or an optional key path, and an
already trusted host key. Enter the destination's SSH host/user and the local HTTP port of its Dovo
runtime (usually 5235). HTTP stays inside the encrypted SSH tunnel. The tunnel connects to that
runtime on the destination's loopback interface; normal Dovo device authentication remains required.

The copy gets a new, unique folder under `~/.dovo/projects` on the destination. It includes the
project checkout's files, local Git branches/tags and commits, staged changes, uncommitted edits and
untracked files. A Git remote and a GitHub push are not required. Ignored and private configuration
files are optional and unchecked by default. Generated untracked folders are excluded. Symbolic
links are skipped with a visible count; projects with submodules must copy those separately. Git
repositories need an initial commit. Hooks, Git credentials and chats are not copied.

Select **Source checkout** to copy a registered worktree instead of the project checkout. Only
worktrees belonging to the selected project are accepted; the copy preserves that worktree’s branch,
index, local edits and untracked files. Other worktrees are not copied. Changing the source clears
private-file selections so they can be reviewed for the chosen checkout.

Enable **Create a thread on destination** for a fresh thread in the copied checkout. Leave the first
message empty for a draft, or enter a prompt to start the agent using the destination’s settings.
Existing chat history stays on the source. A failed agent start leaves the copied project and thread
available on the destination, with the startup error shown at the source. Retrying a completed copy
does not create another thread or rerun the agent. Both runtimes must support worktree transfers.

The source project and its chats stay intact. Use the destination's project picker to open the
copied workspace and its thread. Existing destination projects are never overwritten. Progress and
Cancel remain available in the source project settings, even after closing and reopening them. A
failed copy can retry its saved configuration; after a restart it is marked interrupted and can be
retried. Completed copies are recorded so a lost response or retry does not create another project.

Updated destinations accept batches of up to 128 chunks and 256 KiB of file data per request,
reducing round trips for checkouts with many small files. Older destinations retain the individual
chunk transfer path. Both paths verify file hashes before registering the copied project.
