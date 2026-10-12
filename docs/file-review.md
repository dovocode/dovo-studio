# Reviewing changed files

Task diffs and PR changes on desktop and mobile share viewed progress through the connected
computer. Mark a file viewed from the diff toolbar. Its check clears when that file's diff changes;
unchanged files keep their checks. Image and binary task files also reset when their saved content
or mode changes. PR files without a text patch reset conservatively when the PR revision changes.

Use **Related changes** to review dependencies before their callers, including linked tests,
re-exports and deleted imports. A shared dependency graph reads ASTs of both file versions for
JavaScript/TypeScript, Python, Go, Rust, Java, Kotlin, Swift, C# and PHP. Each language resolves its
own imports, package declarations and type references to changed files. Swift and Go also connect
types within the same module or package. Cycles use deterministic order. Ambiguous module roots,
unresolved aliases or external crates, unsupported syntax and unavailable source use a labeled
folder fallback. **Folders** switches back to path order. This is bounded static analysis, not a
compiler or build-system dependency graph.

PHP links namespace imports (including grouped imports and aliases), class, interface, trait and
enum references, and literal file includes anchored to `__DIR__` or `dirname(__FILE__)`. Class names
resolve case-insensitively against declarations in changed files, without guessing Composer paths.
Multiple namespace blocks, ambiguous declarations, function/constant imports and dynamic or
working-directory-dependent includes retain the folder fallback.

Go imports use the nearest `go.mod` module path. Standard-library and external imports cannot match
local files by basename. PR and historical module metadata comes from the same immutable Git
revisions as the code. Nested modules and build-system aliases without a known mapping retain the
folder fallback. Reading optional review metadata never creates a task checkout or runs its setup.

File browsers use nested, collapsible folders with compact single-folder paths, file-type icons,
change counts and viewed progress. Search reveals matching paths. Desktop arrow keys navigate rows
and expand or collapse folders; mobile uses a virtualized list. Dependency and feature groups keep
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

PR dependency analysis uses complete sources from local Git objects when the matching commits are
available. Reads and AST caches are bounded; analysis does not fetch commits or modify the checkout.
Complete added/deleted file patches can also provide source. Incomplete patch fragments retain the
folder fallback. Missing local sources are retried after 20 seconds while the viewer is active, so
fetching the matching commits restores dependency grouping without a runtime restart. Stable
complete sources reuse cached analysis. The server loads WebAssembly grammars lazily and frees each
parse tree; only the requested grammars ship with the runtime, and mobile clients do no parsing.

On desktop/web, expand **Organize review**; on mobile, tap **Organize review** in task diffs
(including linked checkouts and history) or PR changes. It defaults to the configured title harness
and model; optionally choose another, then **Organize by feature**. The selected model reads bounded
diff excerpts and the existing dependency groups in a separate ephemeral session with tools
disabled. Feature groups include a change summary and linked-impact notes; these are model
suggestions to verify against the diffs, not a complete impact analysis. Missing or truncated
evidence is labeled in the model input. Every changed file must appear exactly once in the result.

Feature groups apply to the current viewer session and clear when its diff changes. Analysis that
finishes after changes arrive is rejected. **Use dependency groups** restores static grouping;
**Folders** remains available. Viewed progress keeps its existing persisted behavior. Organizer
selection does not change the coding task's harness/model or the utility-model settings. Harnesses
that cannot disable tools are excluded.
