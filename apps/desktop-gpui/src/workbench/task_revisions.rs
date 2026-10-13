use super::*;
use crate::model::{ChangedFile, CheckpointChanges, Turn, TurnCheckpoint};
use base64::Engine;
use serde::Deserialize;

#[derive(Clone)]
pub(super) enum TaskOperation {
    NewSession,
    Compact,
    Handoff,
    WorktreeThread(&'static str),
    Retry(String),
    RestoreTurn(String, &'static str),
    RestoreFile {
        turn: String,
        checkout: Option<String>,
        path: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn linked_only_checkpoint_and_legacy_omitted_paths_remain_reviewable() {
        let checkpoint: TurnCheckpoint = serde_json::from_value(json!({
            "before":"", "files":[], "omitted":[],
            "linked":[{"checkoutId":"link","repositoryId":"backend","directory":"/backend",
                "before":"before","after":"after","files":[{"path":"image.png","before":"","after":"","viewed":false,"preview":{"kind":"image"}}],
                "omitted":["image.png","large.txt"]}]
        })).unwrap();
        let files = checkpoint_files(&checkpoint.linked[0].changes);
        assert_eq!(
            files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["image.png", "large.txt"]
        );
        assert_eq!(files[1].extra["preview"]["kind"], "deferred");
        assert!(checkpoint_restorable(&checkpoint, "undo"));
        assert!(!checkpoint_restorable(&checkpoint, "redo"));
        let mut undone = checkpoint;
        undone.linked[0].changes.undone = Some(crate::model::CheckpointUndo {
            at: "now".into(),
            backup: "saved-later-edits".into(),
        });
        assert!(!checkpoint_restorable(&undone, "undo"));
        assert!(checkpoint_restorable(&undone, "redo"));
    }

    #[test]
    fn checkout_is_frozen_by_consumed_input_even_without_messages() {
        let mut task: Task=serde_json::from_value(json!({"id":"task","title":"Example","repositoryId":"repo","agentId":"agent","status":"draft","createdAt":"now","messages":[],"files":[],"draft":"","example":false})).unwrap();
        assert!(can_change_checkout(&task));
        assert!(!TaskOperation::Handoff.available(&task));
        task.extra
            .insert("consumedMessageIds".into(), json!(["older-page-message"]));
        assert!(!can_change_checkout(&task));
        task.extra.insert("sessionId".into(), json!("session"));
        assert!(TaskOperation::NewSession.available(&task));
        let baseline = operation_state(&task);
        task.extra
            .insert("sessionId".into(), json!("replacement-session"));
        assert_ne!(operation_state(&task), baseline);
        task.status = TaskStatus::Running;
        assert!(!TaskOperation::NewSession.available(&task));
        assert!(!TaskOperation::Compact.available(&task));
    }
}
impl TaskOperation {
    fn label(&self, task: &Task) -> String {
        match self {
            Self::NewSession => "New agent session…",
            Self::Compact => "Compact context",
            Self::Handoff if in_worktree(task) => "Move to project folder…",
            Self::Handoff => "Move to own worktree…",
            Self::WorktreeThread("reuse") => "New thread in this worktree",
            Self::WorktreeThread(_) => "Fork worktree",
            Self::Retry(_) => "Retry latest turn…",
            Self::RestoreTurn(_, "undo") => "Undo turn changes…",
            Self::RestoreTurn(_, _) => "Redo turn changes…",
            Self::RestoreFile { .. } => "Revert this file…",
        }
        .into()
    }
    pub(super) fn available(&self, task: &Task) -> bool {
        if task.is_archived() || task.status == TaskStatus::Running {
            return false;
        }
        match self {
            Self::NewSession => task
                .extra
                .get("sessionId")
                .and_then(Value::as_str)
                .is_some(),
            Self::Compact => {
                task.extra
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .is_some()
                    && task.queue.is_empty()
            }
            Self::Handoff => {
                !can_change_checkout(task)
                    && !["pullRequest", "workItem", "existingWorktreePath"]
                        .iter()
                        .any(|key| task.extra.get(*key).is_some_and(|v| !v.is_null()))
            }
            Self::WorktreeThread(_) => {
                in_worktree(task)
                    && ["checkoutBranch", "existingWorktreePath"]
                        .iter()
                        .any(|key| task.extra.get(*key).and_then(Value::as_str).is_some())
            }
            Self::Retry(id) => task
                .turns
                .last()
                .is_some_and(|turn| turn.id == *id && turn.status != "running"),
            Self::RestoreTurn(id, direction) => {
                task.turns
                    .iter()
                    .find(|turn| turn.id == *id)
                    .is_some_and(|turn| {
                        turn.status != "running"
                            && turn.checkpoint.as_ref().is_some_and(|checkpoint| {
                                checkpoint_restorable(checkpoint, direction)
                            })
                    })
            }
            Self::RestoreFile {
                turn,
                checkout,
                path,
            } => task
                .turns
                .iter()
                .find(|item| item.id == *turn)
                .filter(|turn| turn.status != "running")
                .and_then(|turn| turn.checkpoint.as_ref())
                .and_then(|checkpoint| match checkout {
                    Some(id) => checkpoint
                        .linked
                        .iter()
                        .find(|entry| entry.checkout_id == *id)
                        .map(|entry| &entry.changes),
                    None => Some(&checkpoint.changes),
                })
                .is_some_and(|changes| {
                    !changes.before.is_empty()
                        && changes.undone.is_none()
                        && (changes.files.iter().any(|file| file.path == *path)
                            || changes.omitted.contains(path))
                }),
        }
    }
    fn request(&self, task: &Task) -> (&'static str, Value) {
        let mut input = json!({"id":task.id});
        let path = match self {
            Self::NewSession => "/api/tasks/new-session",
            Self::Compact => "/api/tasks/compact",
            Self::Handoff => {
                input["target"] = json!(if in_worktree(task) {
                    "main"
                } else {
                    "worktree"
                });
                "/api/tasks/handoff"
            }
            Self::WorktreeThread(mode) => {
                input["mode"] = json!(mode);
                "/api/tasks/worktree-thread"
            }
            Self::Retry(id) => {
                input["turnId"] = json!(id);
                "/api/tasks/retry"
            }
            Self::RestoreTurn(id, direction) => {
                input["turnId"] = json!(id);
                input["direction"] = json!(direction);
                "/api/tasks/turn/restore"
            }
            Self::RestoreFile {
                turn,
                checkout,
                path,
            } => {
                input["turnId"] = json!(turn);
                input["path"] = json!(path);
                if let Some(id) = checkout {
                    input["checkoutId"] = json!(id);
                }
                "/api/tasks/file/restore"
            }
        };
        (path, input)
    }
    fn warning(&self, task: &Task) -> Option<&'static str> {
        match self {
            Self::NewSession => Some(
                "The next message starts a fresh agent session with this conversation. The conversation and your composer draft are kept.",
            ),
            Self::Handoff if in_worktree(task) => Some(
                "The project folder switches to this task’s branch and the worktree is removed. Uncommitted changes come along. The project folder must be clean and this task’s terminals closed. The agent continues in a new session.",
            ),
            Self::Handoff => Some(
                "All uncommitted changes in the project folder move into a new worktree and branch for this task. Close this task’s terminals first. The agent continues in a new session.",
            ),
            Self::Retry(_) => Some(
                "The latest turn’s checkpoint is restored and its response replaced by a new run. Current files are backed up by the runtime.",
            ),
            Self::RestoreTurn(_, "undo") => Some(
                "Restore all projects changed by this turn to their starting snapshots. Current files, including later edits, are backed up for redo. The conversation remains.",
            ),
            Self::RestoreTurn(_, _) => Some(
                "Restore the files saved immediately before undo, including any later edits that were present then. Current files are backed up by the runtime.",
            ),
            Self::RestoreFile { .. } => Some(
                "Restore this file to its contents before the selected turn. The runtime saves the current files first and adds a note to the conversation.",
            ),
            _ => None,
        }
    }
}
fn operation_state(task: &Task) -> Value {
    json!({"status":task.status,"session":task.extra.get("sessionId"),"execution":task.extra.get("execution"),"branch":task.extra.get("checkoutBranch"),"queue":task.queue.iter().map(|message| &message.id).collect::<Vec<_>>(),"turns":task.turns.iter().map(|turn| json!({"id":turn.id,"status":turn.status,"undone":turn.checkpoint.as_ref().map(|checkpoint| json!({"primary":checkpoint.changes.undone,"linked":checkpoint.linked.iter().map(|entry| (&entry.checkout_id,&entry.changes.undone)).collect::<Vec<_>>()}))})).collect::<Vec<_>>()})
}
fn in_worktree(task: &Task) -> bool {
    task.extra.get("execution").and_then(Value::as_str) == Some("worktree")
}
fn can_change_checkout(task: &Task) -> bool {
    task.status == TaskStatus::Draft
        && task.messages.is_empty()
        && task.queue.is_empty()
        && task.turns.is_empty()
        && !task
            .extra
            .get("checkoutLocked")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        && !["sessionId", "checkoutBranch", "pullRequest"]
            .iter()
            .any(|key| task.extra.get(*key).is_some_and(|v| !v.is_null()))
        && task
            .extra
            .get("consumedMessageIds")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
}
pub(super) fn checkpoint_restorable(checkpoint: &TurnCheckpoint, direction: &str) -> bool {
    if direction == "undo" && checkpoint.changes.error.is_some() {
        return false;
    }
    std::iter::once(&checkpoint.changes)
        .chain(checkpoint.linked.iter().map(|item| &item.changes))
        .any(|changes| {
            if direction == "redo" {
                changes.undone.is_some()
            } else {
                changes.after.is_some()
                    && changes.error.is_none()
                    && changes.undone.is_none()
                    && !changes.before.is_empty()
                    && (!changes.files.is_empty() || !changes.omitted.is_empty())
            }
        })
}
fn checkpoint_files(changes: &CheckpointChanges) -> Vec<ChangedFile> {
    let mut files = changes.files.clone();
    for path in &changes.omitted {
        if !files.iter().any(|file| file.path == *path) {
            files.push(ChangedFile {
                path: path.clone(),
                before: String::new(),
                after: String::new(),
                viewed: false,
                disk_contents: None,
                extra: serde_json::from_value(json!({"preview":{"kind":"deferred"}}))
                    .expect("literal map"),
            });
        }
    }
    files
}

#[derive(Deserialize)]
struct FilePreview {
    before: Option<PreviewSide>,
    after: Option<PreviewSide>,
}
#[derive(Deserialize)]
struct PreviewSide {
    kind: PreviewKind,
    size: u64,
    text: Option<String>,
    image: Option<String>,
    truncated: bool,
    notice: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum PreviewKind {
    Text,
    Image,
    Binary,
    Submodule,
}

impl Workbench {
    pub(super) fn task_with_history(&self, task: &Task) -> Task {
        let mut result = task.clone();
        let mut turns = self
            .history_turns
            .get(&task.id)
            .cloned()
            .unwrap_or_default();
        for turn in &task.turns {
            if let Some(old) = turns.iter_mut().find(|old| old.id == turn.id) {
                *old = turn.clone();
            } else {
                turns.push(turn.clone());
            }
        }
        turns.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        result.turns = turns;
        result
    }
    pub(super) fn earlier_history_button(&self, task: &Task, cx: &mut Context<Self>) -> AnyElement {
        let Some(cursor) = self
            .history_cursor
            .get(&task.id)
            .cloned()
            .unwrap_or_else(|| task.history_before.clone())
        else {
            return div().into_any_element();
        };
        let id = task.id.clone();
        Button::new("earlier-turn-history")
            .label("Load earlier turns and messages")
            .disabled(!self.online || self.pending.contains(&format!("history:{id}")))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.request(
                    format!("history:{id}"),
                    "/api/tasks/history",
                    json!({"id":id,"before":cursor}),
                );
                cx.notify();
            }))
            .into_any_element()
    }
    pub(super) fn task_operation_button(
        &self,
        task: &Task,
        operation: TaskOperation,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let label = operation.label(task);
        let input = operation.request(task).1;
        let task = task.clone();
        Button::new(SharedString::from(format!("{label}:{input}")))
            .label(label)
            .disabled(
                !self.online
                    || !operation.available(&task)
                    || self
                        .pending
                        .contains(&format!("task-operation:{}", task.id))
                    || self
                        .pending
                        .contains(&format!("worktree-thread:{}", task.id)),
            )
            .on_click(cx.listener(move |this, _, window, cx| {
                this.run_task_operation(&task, operation.clone(), window, cx)
            }))
            .into_any_element()
    }
    pub(super) fn run_task_operation(
        &mut self,
        task: &Task,
        operation: TaskOperation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.online
            || !operation.available(task)
            || self
                .pending
                .contains(&format!("task-operation:{}", task.id))
            || self
                .pending
                .contains(&format!("worktree-thread:{}", task.id))
        {
            return;
        }
        let label = operation.label(task);
        let task_id = task.id.clone();
        let (path, input) = operation.request(task);
        let key = if matches!(operation, TaskOperation::WorktreeThread(_)) {
            format!("worktree-thread:{task_id}")
        } else {
            format!("task-operation:{task_id}")
        };
        let generation = self.generation;
        let baseline = operation_state(task);
        if let Some(warning) = operation.warning(task) {
            let prompt = window.prompt(
                PromptLevel::Warning,
                &label,
                Some(warning),
                &["Cancel", "Continue"],
                cx,
            );
            cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{
                if this.generation!=generation{return;}
                let current=this.snapshot.as_ref().and_then(|snapshot|snapshot.workspace.tasks.iter().find(|task|task.id==task_id)).map(|task|this.task_with_history(task));
                if !this.online||!current.as_ref().is_some_and(|task|operation.available(task)&&operation.request(task).1==input&&operation_state(task)==baseline){this.error=Some("The task changed while confirming. Review its current state and try again.".into());}
                else{this.request(key,path,input);}cx.notify();
            });}}).detach();
        } else {
            self.request(key, path, input);
        }
        cx.notify();
    }
    pub(super) fn task_session_controls(&self, task: &Task, cx: &mut Context<Self>) -> AnyElement {
        let git = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| {
                snapshot
                    .workspace
                    .repositories
                    .iter()
                    .find(|repo| repo.id == task.repository_id)
            })
            .is_some_and(|repo| repo.kind.is_none());
        let mut controls = div()
            .flex()
            .flex_wrap()
            .gap_2()
            .child(self.task_operation_button(task, TaskOperation::NewSession, cx))
            .child(self.task_operation_button(task, TaskOperation::Compact, cx));
        if git {
            controls = controls.child(self.task_operation_button(task, TaskOperation::Handoff, cx));
            if in_worktree(task) {
                for mode in ["reuse", "fork"] {
                    controls = controls.child(self.task_operation_button(
                        task,
                        TaskOperation::WorktreeThread(mode),
                        cx,
                    ));
                }
            }
        }
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(Self::header(
                "Agent session and checkout",
                "Start fresh, summarize context or move the task while keeping its conversation.",
            ))
            .child(controls)
            .into_any_element()
    }
    pub(super) fn turn_checkpoint(
        &mut self,
        task: &Task,
        turn: &Turn,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(checkpoint) = &turn.checkpoint else {
            return div().into_any_element();
        };
        let key = format!("checkpoint-open:{}:{}", task.id, turn.id);
        let open = self.responses.get(&key) == Some(&json!(true));
        let count = checkpoint_files(&checkpoint.changes).len()
            + checkpoint
                .linked
                .iter()
                .map(|item| checkpoint_files(&item.changes).len())
                .sum::<usize>();
        let label = if open {
            "Hide saved changes"
        } else {
            "Show saved changes"
        };
        let mut root = div()
            .flex()
            .flex_col()
            .gap_2()
            .child(format!("Saved checkpoint · {count} files"))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        Button::new(SharedString::from(key.clone()))
                            .label(label)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.responses.insert(key.clone(), json!(!open));
                                cx.notify();
                            })),
                    )
                    .child(self.task_operation_button(
                        task,
                        TaskOperation::RestoreTurn(turn.id.clone(), "undo"),
                        cx,
                    ))
                    .child(self.task_operation_button(
                        task,
                        TaskOperation::RestoreTurn(turn.id.clone(), "redo"),
                        cx,
                    )),
            );
        if open {
            root = root.child(self.checkpoint_project(
                task,
                turn,
                &checkpoint.changes,
                (None, "Primary project"),
                window,
                cx,
            ));
            for linked in &checkpoint.linked {
                let label = linked
                    .repository_name
                    .as_deref()
                    .unwrap_or(&linked.repository_id);
                root = root.child(self.checkpoint_project(
                    task,
                    turn,
                    &linked.changes,
                    (Some(&linked.checkout_id), label),
                    window,
                    cx,
                ));
            }
        }
        root.into_any_element()
    }
    fn checkpoint_project(
        &mut self,
        task: &Task,
        turn: &Turn,
        changes: &CheckpointChanges,
        project: (Option<&str>, &str),
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let (checkout, label) = project;
        let mut root = div().flex().flex_col().gap_2().child(label.to_owned());
        if let Some(error) = &changes.error {
            root = root.child(format!("Checkpoint incomplete: {error}"));
        }
        if let Some(undo) = &changes.undone {
            root = root.child(format!("Undone at {}", undo.at));
        }
        let files = checkpoint_files(changes);
        if files.is_empty() {
            return root.child("No saved file changes").into_any_element();
        }
        let scope = format!(
            "checkpoint-file:{}:{}:{}",
            task.id,
            turn.id,
            checkout.unwrap_or("primary")
        );
        let selected = self
            .responses
            .get(&scope)
            .and_then(Value::as_str)
            .unwrap_or(&files[0].path)
            .to_owned();
        let mut choices = div().flex().flex_wrap().gap_2();
        for file in &files {
            let path = file.path.clone();
            let scope = scope.clone();
            choices = choices.child(
                Button::new(SharedString::from(format!("{scope}:{path}")))
                    .ghost()
                    .label(path.clone())
                    .selected(path == selected)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.responses.insert(scope.clone(), json!(path));
                        cx.notify();
                    })),
            );
        }
        root = root.child(choices);
        let file = files
            .iter()
            .find(|file| file.path == selected)
            .unwrap_or(&files[0]);
        root = root.child(self.task_operation_button(
            task,
            TaskOperation::RestoreFile {
                turn: turn.id.clone(),
                checkout: checkout.map(str::to_owned),
                path: file.path.clone(),
            },
            cx,
        ));
        let key = format!("{scope}:preview:{}", file.path);
        if file.extra.get("preview").is_none_or(Value::is_null) {
            root =
                root.child(self.changed_file_diff(&key, &file.path, &file.before, &file.after, cx));
            if file.before == file.after {
                root=root.child("No text changes; the file may have been added, removed or had its mode changed.");
            }
        } else {
            let mut input = json!({"id":task.id,"turnId":turn.id,"path":file.path});
            if let Some(checkout) = checkout {
                input["checkoutId"] = json!(checkout);
            }
            let button_key = key.clone();
            root = root.child(
                Button::new(SharedString::from(format!("load-{key}")))
                    .label("Load saved preview")
                    .disabled(!self.online || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(button_key.clone(), "/api/tasks/file/preview", input.clone());
                        cx.notify();
                    })),
            );
            if let Some(value) = self.responses.get(&key).cloned() {
                match serde_json::from_value::<FilePreview>(value) {
                    Ok(preview) => {
                        for (label, side) in [("Before", preview.before), ("After", preview.after)]
                        {
                            root = root.child(self.checkpoint_preview_side(
                                &format!("{key}:{label}"),
                                &file.path,
                                label,
                                side,
                                window,
                                cx,
                            ));
                        }
                    }
                    Err(error) => root = root.child(format!("Invalid saved preview: {error}")),
                }
            }
        }
        root.into_any_element()
    }
    fn checkpoint_preview_side(
        &mut self,
        key: &str,
        path: &str,
        label: &str,
        side: Option<PreviewSide>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(side) = side else {
            return div()
                .child(format!("{label}: file absent"))
                .into_any_element();
        };
        let mut root = div().flex().flex_col().gap_2().child(format!(
            "{label} · {} bytes{}",
            side.size,
            if side.truncated {
                " · truncated preview"
            } else {
                ""
            }
        ));
        if let Some(notice) = side.notice {
            root = root.child(notice);
        }
        root = match side.kind {
            PreviewKind::Text => {
                let text = side.text.unwrap_or_default();
                let editor = self.code_editor(key, path, &text, window, cx);
                root.child(
                    Editor::new(&editor)
                        .readonly(true)
                        .h(px(320.))
                        .flex_shrink_0(),
                )
            }
            PreviewKind::Image => match side
                .image
                .as_deref()
                .and_then(|data| data.strip_prefix("data:image/png;base64,"))
                .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok())
            {
                Some(bytes) => root.child(
                    img(std::sync::Arc::new(Image::from_bytes(
                        ImageFormat::Png,
                        bytes,
                    )))
                    .max_w(px(600.))
                    .max_h(px(320.))
                    .object_fit(ObjectFit::Contain),
                ),
                None => root.child("The runtime returned an invalid image preview"),
            },
            PreviewKind::Binary => root.child("Binary content; no text preview"),
            PreviewKind::Submodule => {
                root.child(side.text.unwrap_or_else(|| "Submodule reference".into()))
            }
        };
        root.into_any_element()
    }
    pub(super) fn receive_task_revision(&mut self, key: &str) {
        if let Some(id) = key.strip_prefix("task-operation:") {
            self.responses.remove(&format!("changes:{id}"));
            self.notice = Some("Task action completed".into());
        }
    }
}
