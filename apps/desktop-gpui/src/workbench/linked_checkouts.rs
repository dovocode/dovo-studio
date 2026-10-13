use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum Access {
    ReadOnly,
    Edit,
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Link {
    id: String,
    repository_id: String,
    execution: task_defaults::Execution,
    access: Access,
    #[serde(skip_serializing_if = "Option::is_none")]
    existing_worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
}
#[derive(Clone)]
pub(super) struct CheckoutDraft {
    before: Value,
    links: Vec<Link>,
    submitted: Option<Value>,
}
impl Workbench {
    pub(super) fn linked_checkout_fields(
        &mut self,
        prefix: &str,
        before: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if !self.checkout_drafts.contains_key(prefix) {
            match serde_json::from_value(before.clone()) {
                Ok(links) => {
                    self.checkout_drafts.insert(
                        prefix.into(),
                        CheckoutDraft {
                            before,
                            links,
                            submitted: None,
                        },
                    );
                }
                Err(error) => return Self::empty("Invalid linked projects", &error.to_string()),
            }
        }
        let links = self.checkout_drafts[prefix].links.clone();
        let repositories = self
            .snapshot
            .as_ref()
            .map(|s| s.workspace.repositories.clone())
            .unwrap_or_default();
        let mut root = div().flex().flex_col().gap_3().child(Self::header("Linked projects", "Give this task access to other projects on the same computer. Changing links starts a new agent session; files remain in their checkouts."));
        for link in &links {
            let link_prefix = format!("{prefix}:{}", link.id);
            let repo = repositories.iter().find(|r| r.id == link.repository_id);
            let mut row = div()
                .flex()
                .flex_col()
                .gap_2()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .child(
                    repo.map(|r| r.name.clone())
                        .unwrap_or_else(|| "Unavailable project".into()),
                );
            for (label, execution) in [
                ("Project checkout", task_defaults::Execution::Main),
                ("Dedicated worktree", task_defaults::Execution::Worktree),
            ] {
                let key = prefix.to_owned();
                let id = link.id.clone();
                row = row.child(
                    Button::new(SharedString::from(format!("{link_prefix}:{label}")))
                        .label(label)
                        .selected(link.execution == execution)
                        .disabled(
                            execution == task_defaults::Execution::Worktree
                                && repo.is_some_and(|r| r.kind.is_some()),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(d) = this.checkout_drafts.get_mut(&key)
                                && let Some(l) = d.links.iter_mut().find(|l| l.id == id)
                            {
                                l.execution = execution;
                            }
                            cx.notify();
                        })),
                );
            }
            for (label, access) in [
                ("Read only", Access::ReadOnly),
                ("Allow edits", Access::Edit),
            ] {
                let key = prefix.to_owned();
                let id = link.id.clone();
                row = row.child(
                    Button::new(SharedString::from(format!("{link_prefix}:{label}")))
                        .label(label)
                        .selected(link.access == access)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(d) = this.checkout_drafts.get_mut(&key)
                                && let Some(l) = d.links.iter_mut().find(|l| l.id == id)
                            {
                                l.access = access.clone();
                            }
                            cx.notify();
                        })),
                );
            }
            if link.execution == task_defaults::Execution::Worktree {
                for (field, label, value) in [
                    (
                        "existingWorktreePath",
                        "Existing worktree (optional)",
                        &link.existing_worktree_path,
                    ),
                    ("baseBranch", "Base branch (optional)", &link.base_branch),
                    ("branch", "New branch prefix (optional)", &link.branch),
                ] {
                    row = row.child(self.field(
                        &format!("{link_prefix}:{field}"),
                        label,
                        value.as_deref().unwrap_or_default(),
                        "Automatic",
                        window,
                        cx,
                    ));
                }
            }
            let key = prefix.to_owned();
            let id = link.id.clone();
            root = root.child(
                row.child(
                    Button::new(SharedString::from(format!("{link_prefix}:remove")))
                        .ghost()
                        .label("Remove link")
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(d) = this.checkout_drafts.get_mut(&key) {
                                d.links.retain(|l| l.id != id);
                            }
                            cx.notify();
                        })),
                ),
            );
        }
        let mut additions = div().flex().flex_wrap().gap_2();
        for repo in repositories
            .into_iter()
            .filter(|repo| repo.kind.as_deref() != Some("scratch"))
        {
            let key = prefix.to_owned();
            additions = additions.child(
                Button::new(SharedString::from(format!("{prefix}:add:{}", repo.id)))
                    .label(format!("Add {}", repo.name))
                    .disabled(links.len() >= 12)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(d) = this.checkout_drafts.get_mut(&key)
                            && d.links.len() < 12
                        {
                            d.links.push(Link {
                                id: uuid::Uuid::new_v4().to_string(),
                                repository_id: repo.id.clone(),
                                execution: task_defaults::Execution::Main,
                                access: Access::ReadOnly,
                                existing_worktree_path: None,
                                base_branch: None,
                                branch: None,
                            });
                        }
                        cx.notify();
                    })),
            );
        }
        root.child(additions).into_any_element()
    }
    pub(super) fn linked_checkout_value(&self, prefix: &str, cx: &App) -> anyhow::Result<Value> {
        let Some(draft) = self.checkout_drafts.get(prefix) else {
            return Ok(json!([]));
        };
        let mut links = draft.links.clone();
        for link in &mut links {
            for (field, target) in [
                ("existingWorktreePath", &mut link.existing_worktree_path),
                ("baseBranch", &mut link.base_branch),
                ("branch", &mut link.branch),
            ] {
                let key = format!("{prefix}:{}:{field}", link.id);
                if link.execution == task_defaults::Execution::Main {
                    *target = None;
                } else if self.inputs.contains_key(&key) {
                    let text = self.value(&key, cx);
                    *target = (!text.trim().is_empty()).then(|| text.trim().to_owned());
                }
            }
            anyhow::ensure!(
                link.existing_worktree_path.is_none()
                    || (link.branch.is_none() && link.base_branch.is_none()),
                "An existing worktree already has a branch; clear base and new branch fields"
            );
        }
        Ok(serde_json::to_value(links)?)
    }
    pub(super) fn task_linked_checkouts(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if task.extra.contains_key("delegation") {
            return div()
                .child("Linked projects are inherited from the parent task.")
                .into_any_element();
        }
        let prefix = format!("task-links:{}", task.id);
        let before = task
            .extra
            .get("linkedCheckouts")
            .cloned()
            .unwrap_or(json!([]));
        let root = self.linked_checkout_fields(&prefix, before, window, cx);
        let key = format!("links-save:{}", task.id);
        let request_key = key.clone();
        let id = task.id.clone();
        let reload_prefix = prefix.clone();
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(root)
            .child(
                Button::new(SharedString::from(key))
                    .label("Save linked projects")
                    .disabled(
                        !self.online
                            || task.status == TaskStatus::Running
                            || task.is_archived()
                            || self.pending.contains(&request_key),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        match this.linked_checkout_value(&prefix, cx) {
                            Ok(links) => {
                                if let Some(d) = this.checkout_drafts.get_mut(&prefix) {
                                    d.submitted = Some(links.clone());
                                    let before = d.before.clone();
                                    this.request(
                                        request_key.clone(),
                                        "/api/tasks/checkouts/save",
                                        json!({"id":id,"before":before,"links":links}),
                                    );
                                }
                            }
                            Err(error) => this.error = Some(error.to_string()),
                        };
                        cx.notify();
                    })),
            )
            .child(
                Button::new("reload-task-links")
                    .ghost()
                    .label("Reload linked projects…")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let generation = this.generation;
                        let prefix = reload_prefix.clone();
                        let prompt = window.prompt(
                            PromptLevel::Warning,
                            "Reload linked projects?",
                            Some("Discard unsaved link changes and load the task’s current links."),
                            &["Keep edits", "Reload"],
                            cx,
                        );
                        cx.spawn(async move |this, cx| {
                            if prompt.await == Ok(1) {
                                let _ = this.update(cx, |this, cx| {
                                    if this.generation != generation {
                                        return;
                                    }
                                    this.checkout_drafts.remove(&prefix);
                                    this.inputs
                                        .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
                                    cx.notify();
                                });
                            }
                        })
                        .detach();
                    })),
            )
            .into_any_element()
    }
    pub(super) fn receive_linked_checkouts(&mut self, key: &str) {
        if let Some(id) = key.strip_prefix("links-save:")
            && let Some(draft) = self.checkout_drafts.get_mut(&format!("task-links:{id}"))
            && let Some(saved) = draft.submitted.take()
        {
            draft.before = saved;
            self.notice = Some("Linked projects saved".into());
        }
    }
}
