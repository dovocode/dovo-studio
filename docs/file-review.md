# Reviewing changed files

Task diffs and PR changes on desktop and mobile share viewed progress through the connected
computer. Mark a file viewed from the diff toolbar. Its check clears when that file's diff changes;
unchanged files keep their checks. Image and binary task files also reset when their saved content
or mode changes. PR files without a text patch reset conservatively when the PR revision changes.

Files default to folder order. AST dependency analysis is no longer used.

File browsers use nested, collapsible folders with compact single-folder paths, file-type icons,
change counts and viewed progress. Search reveals matching paths. Desktop arrow keys navigate rows
and expand or collapse folders; mobile uses a virtualized list. Model-proposed feature groups keep
their review order.

On mobile, tap the file path to open a searchable file browser. Both clients offer an **Unviewed
only** filter and previous, next and next-unviewed navigation. File and checkout navigation pause
while a task diff has an active edit. Mobile edits retain their text and disk baseline when
switching task panes. Cancel remains available if a refresh removes the file or replaces its text
with a preview. Desktop inline PR drafts retain their original revision and range across pushes;
stale drafts cannot post against the new revision.

Desktop/web PR diffs mount as files enter the viewport; file navigation loads the destination
directly. Loaded diffs stay mounted to preserve inline drafts. Mobile renders only the selected
file. Both viewers honor `.gitattributes` from the exact PR head commit: `binary` and `-diff`
disable text diffs, while `linguist-generated` and `linguist-vendored` files default to collapsed
changes with a **Show changes** action. Nested patterns, macros and overrides use Git's attribute
rules; dirty checkout files and global attributes do not affect the PR. A missing PR commit is
fetched once without switching the checkout. Attribute read failures show a warning and retain the
available patches. Custom diff drivers and textconv are not executed.

Progress survives reopening a viewer and restarting the host. Task working-tree flags use workspace
synchronization with persisted monotonic file versions, so toggling a flag twice or removing and
readding a file cannot revive a stale write. PR, branch, linked-checkout and historical flags
refresh while the viewer is active, at most every 20 seconds, and immediately when it returns to the
foreground. Failed saves show an error and a retry control. A stale client cannot mark a newer file
revision as viewed.

On desktop/web, expand **Organize review**; on mobile, tap **Organize review** in task diffs
(including linked checkouts and history) or PR changes. It defaults to the configured title harness
and model; optionally choose another, then **Organize by feature**. The selected model reads bounded
diff excerpts in a separate ephemeral session with tools disabled. Feature groups include a change
summary and linked-impact notes; these are model suggestions to verify against the diffs, not a
complete impact analysis. Missing or truncated evidence is labeled in the model input. Every changed
file must appear exactly once in the result.

Feature groups apply to the current viewer session and clear when its diff changes. Analysis that
finishes after changes arrive is rejected. **Reset to folders** clears model grouping; **Folders**
also lets you browse by path while retaining the generated groups. Viewed progress keeps its
existing persisted behavior. Organizer selection does not change the coding task's harness/model or
the utility-model settings. Harnesses that cannot disable tools are excluded.
