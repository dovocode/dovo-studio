use super::*;
use crate::model::Repository;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum PresetKind {
    Prompts,
    Templates,
    Actions,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn edits_keep_frozen_template_settings_and_validate_prompt_names() {
        let template:SavedItem=serde_json::from_value(json!({"id":"template","name":"A template","objective":" Goal ","harness":{"provider":"codex","model":"saved","permission":"ask","endpoint":"","instructions":"","launch":{"executable":"agent","arguments":["--fixture"]}},"execution":"worktree","setupCommand":"pnpm install","worktreeFromOrigin":false})).unwrap();
        let saved = validated_items(PresetKind::Templates, vec![template.clone()]).unwrap();
        assert_eq!(saved[0]["objective"], "Goal");
        assert_eq!(saved[0]["harness"], template.fields["harness"]);
        let fields = template_fields(&template);
        assert_eq!(fields["agentId"], "");
        assert_eq!(
            fields["harness"]["launch"]["arguments"],
            json!(["--fixture"])
        );
        let mut changed = template;
        changed.clear_agent();
        assert!(template_fields(&changed).get("harness").is_none());
        assert_eq!(template_fields(&changed)["setupCommand"], "pnpm install");
        let prompt: SavedItem =
            serde_json::from_value(json!({"id":"p","name":"review code","text":"Review 🦀"}))
                .unwrap();
        let normalized = validated_items(PresetKind::Prompts, vec![prompt.clone()]).unwrap();
        assert_eq!(normalized[0]["name"], "review-code");
        let mut duplicate = prompt.clone();
        duplicate.id = "other".into();
        duplicate.name = "REVIEW-CODE".into();
        assert!(validated_items(PresetKind::Prompts, vec![prompt, duplicate]).is_err());
        let invalid: SavedItem =
            serde_json::from_value(json!({"id":"p","name":"wrong/#","text":"Review"})).unwrap();
        assert!(validated_items(PresetKind::Prompts, vec![invalid]).is_err());
    }
}
impl PresetKind {
    fn field(self) -> &'static str {
        match self {
            Self::Prompts => "prompts",
            Self::Templates => "templates",
            Self::Actions => "actions",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Prompts => "Saved prompts",
            Self::Templates => "Task templates",
            Self::Actions => "Terminal actions",
        }
    }
    fn body(self) -> &'static str {
        match self {
            Self::Prompts => "text",
            Self::Templates => "objective",
            Self::Actions => "command",
        }
    }
    fn limit(self) -> usize {
        match self {
            Self::Prompts => 40,
            Self::Templates => 30,
            Self::Actions => 20,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct SavedItem {
    id: String,
    name: String,
    #[serde(flatten)]
    fields: serde_json::Map<String, Value>,
}
impl SavedItem {
    pub(super) fn clear_agent(&mut self) {
        self.fields.remove("agentId");
        self.fields.remove("harness");
    }
    fn body(&self, kind: PresetKind) -> &str {
        self.fields
            .get(kind.body())
            .and_then(Value::as_str)
            .unwrap_or_default()
    }
}
pub(super) struct PresetDraft {
    repository: String,
    kind: PresetKind,
    before: Value,
    rows: Vec<SavedItem>,
    submitted: Option<Value>,
}
fn validated_items(kind: PresetKind, rows: Vec<SavedItem>) -> anyhow::Result<Value> {
    anyhow::ensure!(rows.len() <= kind.limit(), "Too many saved items");
    let mut names = HashSet::new();
    let mut cleaned = Vec::new();
    for mut row in rows {
        row.name = row.name.trim().to_owned();
        if kind == PresetKind::Prompts {
            row.name = row.name.split_whitespace().collect::<Vec<_>>().join("-");
        }
        let body = row.body(kind).trim().to_owned();
        anyhow::ensure!(!row.name.is_empty(), "Give every item a name");
        anyhow::ensure!(
            row.name.encode_utf16().count()
                <= if kind == PresetKind::Templates {
                    80
                } else {
                    60
                },
            "The name is too long"
        );
        anyhow::ensure!(
            names.insert(row.name.to_lowercase()),
            "Each item needs a different name"
        );
        if kind == PresetKind::Prompts {
            anyhow::ensure!(
                row.name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)),
                "Prompt names may use letters, numbers, dots, dashes and underscores"
            );
        }
        anyhow::ensure!(
            kind == PresetKind::Templates || !body.is_empty(),
            "Give every item its text or command"
        );
        anyhow::ensure!(
            body.encode_utf16().count()
                <= if kind == PresetKind::Actions {
                    4000
                } else {
                    20000
                },
            "The text or command is too long"
        );
        row.fields.insert(kind.body().into(), json!(body));
        cleaned.push(row);
    }
    Ok(if cleaned.is_empty() {
        Value::Null
    } else {
        serde_json::to_value(cleaned)?
    })
}
pub(crate) fn template_fields(template: &SavedItem) -> Value {
    let mut result = json!({"draft":template.body(PresetKind::Templates)});
    for field in [
        "harness",
        "agentId",
        "execution",
        "worktreeFromOrigin",
        "setupCommand",
    ] {
        if let Some(value) = template.fields.get(field) {
            result[field] = value.clone();
        }
    }
    if template.fields.contains_key("harness") {
        result["agentId"] = json!("");
    }
    result
}

impl Workbench {
    pub(super) fn project_terminal_actions(
        &self,
        task: &Task,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(repo) = self.snapshot.as_ref().and_then(|snapshot| {
            snapshot
                .workspace
                .repositories
                .iter()
                .find(|repo| repo.id == task.repository_id)
        }) else {
            return div().into_any_element();
        };
        let actions = match repo
            .extra
            .get("actions")
            .cloned()
            .map(serde_json::from_value::<Vec<SavedItem>>)
            .transpose()
        {
            Ok(actions) => actions.unwrap_or_default(),
            Err(error) => return Self::empty("Invalid project actions", &error.to_string()),
        };
        let ready = self.online
            && !task.is_archived()
            && !(task.extra.get("execution").and_then(Value::as_str) == Some("worktree")
                && task.extra.get("checkoutBranch").is_none()
                && task.extra.get("existingWorktreePath").is_none());
        div()
            .flex()
            .flex_wrap()
            .gap_2()
            .children(actions.into_iter().map(|action| {
                let id = task.id.clone();
                let command = action.body(PresetKind::Actions).to_owned();
                Button::new(SharedString::from(format!("project-action:{}", action.id)))
                    .label(action.name)
                    .disabled(!ready || self.pending.contains(&format!("terminal-run:{id}")))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            format!("terminal-run:{id}"),
                            "/api/terminals/run",
                            json!({"taskId":id,"command":command}),
                        );
                        cx.notify();
                    }))
            }))
            .into_any_element()
    }
    pub(super) fn project_presets(&self, repo: &Repository, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .flex_wrap()
            .gap_2()
            .children(
                [
                    PresetKind::Prompts,
                    PresetKind::Templates,
                    PresetKind::Actions,
                ]
                .into_iter()
                .map(|kind| {
                    let repo = repo.clone();
                    Button::new(kind.field())
                        .label(kind.label())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let before =
                                repo.extra.get(kind.field()).cloned().unwrap_or(Value::Null);
                            let rows = if before.is_null() {
                                Ok(Vec::new())
                            } else {
                                serde_json::from_value::<Vec<SavedItem>>(before.clone())
                            };
                            match rows {
                                Ok(rows) => {
                                    this.preset_editor = Some(PresetDraft {
                                        repository: repo.id.clone(),
                                        kind,
                                        before,
                                        rows,
                                        submitted: None,
                                    })
                                }
                                Err(error) => {
                                    this.error = Some(format!("Invalid saved items: {error}"))
                                }
                            }
                            cx.notify();
                        }))
                }),
            )
            .into_any_element()
    }
    pub(super) fn preset_editor(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(draft) = self.preset_editor.as_ref() else {
            return div().into_any_element();
        };
        let repo = draft.repository.clone();
        let kind = draft.kind;
        let rows = draft.rows.clone();
        let prefix = format!("preset:{}:{repo}", kind.field());
        let mut root=div().id("project-presets-editor").flex().flex_col().flex_1().overflow_y_scroll().p_6().gap_4()
            .child(Self::header(kind.label(),"Saved for this project on the connected computer. Saves check the original value for conflicts."));
        let generation = self.generation;
        root = root.child(
            Button::new("preset-back")
                .label("Back to project…")
                .disabled(self.pending.contains(&prefix))
                .on_click(cx.listener(move |_, _, window, cx| {
                    let prompt = window.prompt(
                        PromptLevel::Warning,
                        "Leave saved-item editor?",
                        Some("Discard changes that have not been saved."),
                        &["Keep editing", "Leave"],
                        cx,
                    );
                    cx.spawn(async move |this, cx| {
                        if prompt.await == Ok(1) {
                            let _ = this.update(cx, |this, cx| {
                                if this.generation == generation {
                                    if let Some(draft) = this.preset_editor.as_ref() {
                                        let prefix = format!(
                                            "preset:{}:{}:",
                                            draft.kind.field(),
                                            draft.repository
                                        );
                                        this.inputs.retain(|key, _| !key.starts_with(&prefix));
                                        this.textareas.retain(|key, _| !key.starts_with(&prefix));
                                    }
                                    this.preset_editor = None;
                                    cx.notify();
                                }
                            });
                        }
                    })
                    .detach();
                })),
        );
        for row in &rows {
            let key = format!("{prefix}:{}", row.id);
            let remove_id = row.id.clone();
            root = root.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded_md()
                    .child(self.field(
                        &format!("{key}:name"),
                        "Name",
                        &row.name,
                        "Item name",
                        window,
                        cx,
                    ))
                    .child(self.text_field(
                        &format!("{key}:body"),
                        kind.body(),
                        row.body(kind),
                        "Enter text",
                        window,
                        cx,
                    ))
                    .child(
                        Button::new(SharedString::from(format!("remove-{key}")))
                            .label("Remove")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(draft) = this.preset_editor.as_mut() {
                                    draft.rows.retain(|row| row.id != remove_id);
                                }
                                cx.notify();
                            })),
                    ),
            );
            if kind == PresetKind::Templates
                && let Some(harness) = row.fields.get("harness")
            {
                root = root.child(format!(
                    "Frozen agent: {} · {}",
                    harness
                        .get("provider")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    harness.get("model").and_then(Value::as_str).unwrap_or("")
                ));
            }
        }
        root = root.child(
            Button::new("preset-add")
                .label("Add item")
                .disabled(rows.len() >= kind.limit())
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(draft) = this.preset_editor.as_mut() {
                        draft.rows.push(SavedItem {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: String::new(),
                            fields: serde_json::Map::from_iter([(kind.body().into(), json!(""))]),
                        });
                    }
                    cx.notify();
                })),
        );
        let key = prefix.clone();
        root.child(
            Button::new("preset-save")
                .primary()
                .label("Save")
                .disabled(!self.online || self.pending.contains(&prefix))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let Some(draft) = this.preset_editor.as_ref() else {
                        return;
                    };
                    let before = draft.before.clone();
                    let mut rows = draft.rows.clone();
                    for row in &mut rows {
                        let prefix = format!("{key}:{}", row.id);
                        row.name = this.value(&format!("{prefix}:name"), cx);
                        row.fields.insert(
                            kind.body().into(),
                            json!(this.text_value(&format!("{prefix}:body"), cx)),
                        );
                    }
                    match validated_items(kind, rows) {
                        Ok(after) => {
                            if let Some(draft) = this.preset_editor.as_mut() {
                                draft.submitted = Some(after.clone());
                            }
                            this.patch(
                                key.clone(),
                                WorkspacePatch::update(
                                    "repositories",
                                    repo.clone(),
                                    kind.field(),
                                    before,
                                    after,
                                ),
                            );
                        }
                        Err(error) => this.error = Some(error.to_string()),
                    }
                    cx.notify();
                })),
        )
        .into_any_element()
    }
    pub(super) fn receive_preset_save(&mut self, key: &str) {
        if let Some(draft) = self.preset_editor.as_mut()
            && key == format!("preset:{}:{}", draft.kind.field(), draft.repository)
            && let Some(saved) = draft.submitted.take()
        {
            draft.before = saved;
            self.notice = Some("Project items saved".into());
        }
    }
    pub(super) fn saved_prompt_choices(&self, task: &Task, cx: &mut Context<Self>) -> AnyElement {
        let Some(repo) = self.snapshot.as_ref().and_then(|snapshot| {
            snapshot
                .workspace
                .repositories
                .iter()
                .find(|repo| repo.id == task.repository_id)
        }) else {
            return div().into_any_element();
        };
        let prompts = match repo
            .extra
            .get("prompts")
            .cloned()
            .map(serde_json::from_value::<Vec<SavedItem>>)
            .transpose()
        {
            Ok(rows) => rows.unwrap_or_default(),
            Err(error) => return Self::empty("Invalid saved prompts", &error.to_string()),
        };
        div()
            .flex()
            .flex_wrap()
            .gap_2()
            .children(prompts.into_iter().map(|prompt| {
                let text = prompt.body(PresetKind::Prompts).to_owned();
                let id = task.id.clone();
                Button::new(SharedString::from(format!("insert-prompt:{}", prompt.id)))
                    .ghost()
                    .label(format!("#{}", prompt.name))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if this.selected_task.as_ref() != Some(&id) {
                            return;
                        }
                        let current = this.composer.read(cx).value().to_string();
                        let value = if current.is_empty() {
                            text.clone()
                        } else {
                            format!("{current}\n\n{text}")
                        };
                        this.composer
                            .update(cx, |composer, cx| composer.set_value(value, window, cx));
                        cx.notify();
                    }))
            }))
            .into_any_element()
    }
    pub(super) fn new_task_templates(
        &self,
        repo: &Repository,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let templates = match repo
            .extra
            .get("templates")
            .cloned()
            .map(serde_json::from_value::<Vec<SavedItem>>)
            .transpose()
        {
            Ok(rows) => rows.unwrap_or_default(),
            Err(error) => return Self::empty("Invalid task templates", &error.to_string()),
        };
        let id = repo.id.clone();
        div()
            .flex()
            .flex_wrap()
            .gap_2()
            .children(templates.into_iter().map(|template| {
                let id = id.clone();
                Button::new(SharedString::from(format!("use-template:{}", template.id)))
                    .label(format!("Template: {}", template.name))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let text = template.body(PresetKind::Templates).to_owned();
                        let draft = this
                            .textareas
                            .entry("new-task-objective".into())
                            .or_insert_with(|| cx.new(|cx| TextareaState::new(window, cx)))
                            .clone();
                        draft.update(cx, |draft, cx| draft.set_value(text, window, cx));
                        this.selected_agent = template
                            .fields
                            .get("agentId")
                            .and_then(Value::as_str)
                            .filter(|id| !id.is_empty())
                            .map(str::to_owned);
                        this.execution_worktree = template
                            .fields
                            .get("execution")
                            .and_then(Value::as_str)
                            .map(|execution| execution == "worktree");
                        this.new_task_template = Some((id.clone(), template.clone()));
                        cx.notify();
                    }))
            }))
            .into_any_element()
    }
    pub(super) fn save_task_template(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let field = format!("template-name:{}", task.id);
        let task = task.clone();
        div().flex().flex_col().gap_2().child(Self::header("Save as task template","Captures the first request, frozen agent and checkout choices. Branches and conversation history are excluded."))
            .child(self.field(&field,"Template name",&task.title,"Template name",window,cx))
            .child(Button::new("save-task-template").label("Save template").disabled(!self.online||self.pending.contains(&format!("template-save:{}",task.repository_id))).on_click(cx.listener(move|this,_,_,cx| {
                let Some(repo)=this.snapshot.as_ref().and_then(|snapshot|snapshot.workspace.repositories.iter().find(|repo|repo.id==task.repository_id)) else {return;};
                let before=repo.extra.get("templates").cloned().unwrap_or(Value::Null);
                let rows=if before.is_null() {Ok(Vec::new())} else {serde_json::from_value::<Vec<SavedItem>>(before.clone())};
                let objective=this.messages.iter().find(|message|message.role==Role::User && !message.extra.contains_key("file")).map(|message|message.text.clone()).unwrap_or_else(||this.drafts.get(&task.id).cloned().unwrap_or(task.draft.clone()));
                let mut fields=serde_json::Map::from_iter([("objective".into(),json!(objective))]);
                for key in ["harness","execution","worktreeFromOrigin","setupCommand"] {if let Some(value)=task.extra.get(key) {fields.insert(key.into(),value.clone());}}
                if !fields.contains_key("harness")&&!task.agent_id.is_empty() {fields.insert("agentId".into(),json!(task.agent_id));}
                match rows.map(|mut rows|{rows.push(SavedItem {id:uuid::Uuid::new_v4().to_string(),name:this.value(&field,cx),fields});rows}) {
                    Ok(rows)=>match validated_items(PresetKind::Templates,rows) {Ok(after)=>this.patch(format!("template-save:{}",task.repository_id),WorkspacePatch::update("repositories",task.repository_id.clone(),"templates",before,after)),Err(error)=>this.error=Some(error.to_string())},
                    Err(error)=>this.error=Some(error.to_string()),
                }
                cx.notify();
            }))).into_any_element()
    }
}
