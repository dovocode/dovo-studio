use super::scm_settings::string;
use super::*;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub(super) struct Prompt {
    id: String,
    name: String,
    text: String,
}
fn prompt(id: String, name: String, text: String) -> anyhow::Result<Prompt> {
    let name = name.trim().to_owned();
    let text = text.trim().to_owned();
    anyhow::ensure!(
        !name.is_empty() && name.encode_utf16().count() <= 60,
        "Prompt names must contain 1–60 characters"
    );
    anyhow::ensure!(
        !text.is_empty() && text.encode_utf16().count() <= 20_000,
        "Prompt text must contain 1–20000 characters"
    );
    Ok(Prompt { id, name, text })
}

fn choice(value: &str) -> anyhow::Result<Option<bool>> {
    match value {
        "" => Ok(None),
        "yes" => Ok(Some(true)),
        "no" => Ok(Some(false)),
        _ => anyhow::bail!("Choose yes, no or inherit"),
    }
}
impl Workbench {
    fn defaults_scope_key(&self) -> String {
        format!(
            "task-defaults:{}:{}",
            self.defaults_scope,
            if matches!(self.defaults_scope, "project" | "environment-project") {
                self.selected_repository.as_deref().unwrap_or_default()
            } else {
                ""
            }
        )
    }
    fn defaults_scope_input(&self) -> Value {
        let mut input = json!({"scope":self.defaults_scope});
        if matches!(self.defaults_scope, "project" | "environment-project") {
            input["repositoryId"] = json!(self.selected_repository);
        }
        input
    }
    pub(super) fn read_task_defaults(&mut self) {
        let key = self.defaults_scope_key();
        if !self.responses.contains_key(&key) {
            self.request(
                key,
                "/api/agents/settings/read",
                self.defaults_scope_input(),
            );
        }
    }
    pub(super) fn receive_task_defaults(&mut self, key: &str, value: &Value, cx: &App) {
        if let Some(prefix) = key.strip_prefix("defaults-save:") {
            let sent = self.responses.remove(&format!("scm-form-receipt:{key}"));
            if sent.as_ref() == Some(&self.form_fields(prefix, cx)) {
                self.defaults_prompts.remove(prefix);
                self.inputs
                    .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
                self.textareas
                    .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
            }
            self.responses.insert(prefix.to_owned(), value.clone());
            self.notice = Some("Task defaults saved".into());
        }
    }
    pub(super) fn defaults_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = self.defaults_scope_key();
        let mut root=div().id("task-defaults-page").flex().flex_col().flex_1().overflow_y_scroll().p_6().gap_4().child(Self::header("Task defaults","Checkout and agent choices apply to new tasks. Lifecycle policies apply to existing tasks too.")).child(self.source_reload_button(cx));
        root = root.child(
            div().flex().flex_wrap().gap_2().children(
                [
                    ("global", "Global"),
                    ("environment", "Computer"),
                    ("project", "Project"),
                    ("environment-project", "Project on computer"),
                ]
                .into_iter()
                .map(|(scope, label)| {
                    Button::new(scope)
                        .label(label)
                        .selected(self.defaults_scope == scope)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.defaults_scope = scope;
                            this.read_task_defaults();
                            cx.notify();
                        }))
                }),
            ),
        );
        if matches!(self.defaults_scope, "project" | "environment-project") {
            let repositories = self
                .snapshot
                .as_ref()
                .map(|s| s.workspace.repositories.clone())
                .unwrap_or_default();
            root = root.child(div().flex().flex_wrap().gap_2().children(
                repositories.into_iter().map(|repo| {
                    let id = repo.id;
                    Button::new(SharedString::from(format!("defaults-repo:{id}")))
                        .label(repo.name)
                        .selected(self.selected_repository.as_ref() == Some(&id))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.selected_repository = Some(id.clone());
                            this.read_task_defaults();
                            cx.notify();
                        }))
                }),
            ));
        }
        if let Some(response) = self.responses.get(&key).cloned() {
            root = root.child(self.defaults_form(
                &key,
                self.defaults_scope_input(),
                response,
                window,
                cx,
            ));
        } else {
            root = root.child("Choose a scope and project to load its task defaults.");
        }
        root.into_any_element()
    }
    pub(super) fn defaults_form(
        &mut self,
        prefix: &str,
        target: Value,
        response: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(before) = response.get("value").filter(|v| v.is_object()).cloned() else {
            return Self::empty(
                "Invalid settings",
                "The runtime returned no settings document.",
            );
        };
        let defaults = before.get("taskDefaults").cloned().unwrap_or(json!({}));
        let behavior = before.get("taskBehavior").cloned().unwrap_or(json!({}));
        let key = format!("defaults-save:{prefix}");
        let reload_key = prefix.to_owned();
        let reload_input = target.clone();
        let mut form=div().flex().flex_col().gap_3().child(Button::new("defaults-reload").label("Reload task defaults…").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,window,cx| {
            let generation=this.generation;let epoch=this.source_epoch();let key=reload_key.clone();let input=reload_input.clone();let prompt=window.prompt(PromptLevel::Warning,"Reload task defaults?",Some("Discard unsaved task defaults in this scope and load the current settings."),&["Keep edits","Reload"],cx);
            cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{if generation!=this.generation||epoch!=this.source_epoch(){return;}this.defaults_prompts.remove(&key);this.inputs.retain(|field,_|!field.starts_with(&format!("{key}:")));this.textareas.retain(|field,_|!field.starts_with(&format!("{key}:")));this.request(key,"/api/agents/settings/read",input);cx.notify();});}}).detach();
        }))).child(Self::header("Checkout defaults","Blank choices inherit from broader scopes."));
        if let Some(inherited) = response.pointer("/inherited/taskDefaults") {
            form = form.child(format!(
                "Inherited checkout: {} · submodules: {} · provider: {}",
                string(inherited, "execution"),
                string(inherited, "submodules"),
                inherited
                    .pointer("/harness/provider")
                    .and_then(Value::as_str)
                    .unwrap_or("codex")
            ));
        }
        for (field, label, choices) in [
            (
                "execution",
                "Working directory",
                vec!["", "main", "worktree"],
            ),
            (
                "submodules",
                "Submodules",
                vec!["", "none", "direct", "recursive"],
            ),
            (
                "permission",
                "Permissions",
                vec![
                    "",
                    "ask",
                    "read-only",
                    "workspace-write",
                    "auto",
                    "full-access",
                ],
            ),
        ] {
            form = form
                .child(self.field(
                    &format!("{prefix}:{field}"),
                    label,
                    string(&defaults, field),
                    "Inherit",
                    window,
                    cx,
                ))
                .child(self.work_field_choices(
                    &format!("{prefix}:{field}"),
                    &choices.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                    cx,
                ));
        }
        let origin = defaults
            .get("worktreeFromOrigin")
            .and_then(Value::as_bool)
            .map(|v| if v { "yes" } else { "no" })
            .unwrap_or("");
        form = form
            .child(self.field(
                &format!("{prefix}:origin"),
                "Start worktrees from origin",
                origin,
                "Inherit",
                window,
                cx,
            ))
            .child(self.work_field_choices(
                &format!("{prefix}:origin"),
                &["".into(), "yes".into(), "no".into()],
                cx,
            ))
            .child(self.text_field(
                &format!("{prefix}:setup"),
                "Setup command",
                string(&defaults, "setupCommand"),
                "Inherit",
                window,
                cx,
            ));
        let mut harness = json!({"provider":"codex","model":"","instructions":"","permission":"full-access","endpoint":""});
        if let Some(fields) = defaults
            .get("harness")
            .or_else(|| response.pointer("/inherited/taskDefaults/harness"))
            .and_then(Value::as_object)
        {
            for (key, value) in fields {
                harness[key] = value.clone();
            }
        }
        harness["permission"] = json!("full-access");
        let mode_key = format!("{prefix}:harness-mode");
        form = form.child(Self::header("Default agent", "Inherit the agent from broader scopes, or configure its provider and launch options here. Permissions use the choice above."))
            .child(self.field(&mode_key, "Agent configuration", if defaults.get("harness").is_some() { "custom" } else { "inherit" }, "Inherit or custom", window, cx))
            .child(self.work_field_choices(&mode_key, &["inherit".into(), "custom".into()], cx));
        if self.value(&mode_key, cx) == "custom" {
            form = form.child(self.default_harness_fields(
                &format!("{prefix}:harness"),
                &harness,
                window,
                cx,
            ));
        }
        form = form.child(Self::header(
            "Task lifecycle",
            "Blank choices inherit. The runtime applies these policies to existing tasks.",
        ));
        for (field, label) in [
            ("quotaResume", "Resume after quota resets"),
            ("quotaSnooze", "Snooze quota-limited tasks"),
            ("settleMerged", "Settle merged pull requests"),
            ("settleClosed", "Settle closed pull requests"),
            ("settleInactive", "Settle inactive tasks"),
            ("continueAfterRestart", "Continue after runtime restart"),
        ] {
            let value = behavior
                .get(field)
                .and_then(Value::as_bool)
                .map(|v| if v { "yes" } else { "no" })
                .unwrap_or("");
            form = form
                .child(self.field(
                    &format!("{prefix}:behavior:{field}"),
                    label,
                    value,
                    "Inherit",
                    window,
                    cx,
                ))
                .child(self.work_field_choices(
                    &format!("{prefix}:behavior:{field}"),
                    &["".into(), "yes".into(), "no".into()],
                    cx,
                ));
        }
        let days = behavior
            .get("inactiveDays")
            .and_then(Value::as_u64)
            .map(|v| v.to_string())
            .unwrap_or_default();
        form = form.child(self.field(
            &format!("{prefix}:behavior:inactiveDays"),
            "Inactive days (1–365)",
            &days,
            "Inherit",
            window,
            cx,
        ));
        let prefix = prefix.to_owned();
        let mut input = target;
        if let Some(project_key) = response.get("projectKey") {
            input["projectKey"] = project_key.clone();
        }
        form = form.child(self.prompt_fields(&prefix, &response, window, cx));
        form.child(
            Button::new("defaults-save")
                .primary()
                .label("Save task defaults")
                .disabled(!self.online || self.pending.contains(&key))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let result = (|| -> anyhow::Result<Value> {
                        let mut after = before.clone();
                        let mut defaults = defaults.clone();
                        let mut behavior = behavior.clone();
                        for field in ["execution", "submodules", "permission"] {
                            let value = this.value(&format!("{prefix}:{field}"), cx);
                            if value.is_empty() {
                                defaults.as_object_mut().map(|v| v.remove(field));
                            } else {
                                defaults[field] = json!(value);
                            }
                        }
                        match choice(&this.value(&format!("{prefix}:origin"), cx))? {
                            Some(value) => defaults["worktreeFromOrigin"] = json!(value),
                            None => {
                                defaults
                                    .as_object_mut()
                                    .map(|v| v.remove("worktreeFromOrigin"));
                            }
                        }
                        let setup = this.text_value(&format!("{prefix}:setup"), cx);
                        if setup.is_empty() {
                            defaults.as_object_mut().map(|v| v.remove("setupCommand"));
                        } else {
                            defaults["setupCommand"] = json!(setup);
                        }
                        match this.value(&format!("{prefix}:harness-mode"), cx).as_str() {
                            "inherit" => {
                                defaults.as_object_mut().map(|v| v.remove("harness"));
                            }
                            "custom" => {
                                defaults["harness"] =
                                    this.harness_value(&format!("{prefix}:harness"), &harness, cx)?;
                            }
                            _ => anyhow::bail!("Choose inherit or custom for the default agent"),
                        }
                        for field in [
                            "quotaResume",
                            "quotaSnooze",
                            "settleMerged",
                            "settleClosed",
                            "settleInactive",
                            "continueAfterRestart",
                        ] {
                            match choice(&this.value(&format!("{prefix}:behavior:{field}"), cx))? {
                                Some(value) => behavior[field] = json!(value),
                                None => {
                                    behavior.as_object_mut().map(|v| v.remove(field));
                                }
                            }
                        }
                        let days = this.value(&format!("{prefix}:behavior:inactiveDays"), cx);
                        if days.is_empty() {
                            behavior.as_object_mut().map(|v| v.remove("inactiveDays"));
                        } else {
                            let days = days.parse::<u64>()?;
                            anyhow::ensure!(
                                (1..=365).contains(&days),
                                "Inactive days must be between 1 and 365"
                            );
                            behavior["inactiveDays"] = json!(days);
                        }
                        after["taskDefaults"] = defaults;
                        after["taskBehavior"] = behavior;
                        if let Some(rows) = this.defaults_prompts.get(&prefix) {
                            anyhow::ensure!(
                                rows.len() <= 40,
                                "Use at most 40 saved prompts in this scope"
                            );
                            let mut prompts = Vec::new();
                            for row in rows {
                                prompts.push(prompt(
                                    row.id.clone(),
                                    this.value(&format!("{prefix}:prompt:{}:name", row.id), cx),
                                    this.text_value(
                                        &format!("{prefix}:prompt:{}:text", row.id),
                                        cx,
                                    ),
                                )?);
                            }
                            if !prompts.is_empty() || before.get("prompts").is_some() {
                                after["prompts"] = serde_json::to_value(prompts)?;
                            }
                        }
                        let mut input = input.clone();
                        input["before"] = before.clone();
                        input["after"] = after;
                        Ok(input)
                    })();
                    match result {
                        Ok(input) => this.config_request(
                            key.clone(),
                            &prefix,
                            "/api/agents/settings/save",
                            input,
                            cx,
                        ),
                        Err(error) => this.error = Some(error.to_string()),
                    }
                    cx.notify();
                })),
        )
        .into_any_element()
    }
    fn prompt_fields(
        &mut self,
        prefix: &str,
        response: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if !self.defaults_prompts.contains_key(prefix) {
            let rows: Vec<Prompt> = match serde_json::from_value(
                response
                    .pointer("/value/prompts")
                    .cloned()
                    .unwrap_or(json!([])),
            ) {
                Ok(rows) => rows,
                Err(error) => return Self::empty("Invalid saved prompts", &error.to_string()),
            };
            self.defaults_prompts.insert(prefix.to_owned(), rows);
        }
        let rows = self
            .defaults_prompts
            .get(prefix)
            .cloned()
            .unwrap_or_default();
        let mut root = div().flex().flex_col().gap_3().child(Self::header("Saved prompts", "Use # and a prompt name in the composer. Changes are saved with the task defaults in this scope."));
        if let Some(inherited) = response
            .pointer("/inherited/prompts")
            .and_then(Value::as_array)
        {
            let names = inherited
                .iter()
                .filter_map(|row| row["name"].as_str())
                .collect::<Vec<_>>()
                .join(", ");
            if !names.is_empty() {
                root = root.child(format!("Inherited prompts: {names}"));
            }
        }
        for row in rows.iter() {
            let row_prefix = format!("{prefix}:prompt:{}", row.id);
            let remove_prefix = prefix.to_owned();
            let id = row.id.clone();
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
                        &format!("{row_prefix}:name"),
                        "Prompt name",
                        &row.name,
                        "Name",
                        window,
                        cx,
                    ))
                    .child(self.text_field(
                        &format!("{row_prefix}:text"),
                        "Prompt text",
                        &row.text,
                        "Reusable request",
                        window,
                        cx,
                    ))
                    .child(
                        Button::new(SharedString::from(format!("{row_prefix}:remove")))
                            .ghost()
                            .label("Remove prompt from this scope")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(rows) = this.defaults_prompts.get_mut(&remove_prefix) {
                                    rows.retain(|row| row.id != id);
                                }
                                this.inputs
                                    .retain(|key, _| !key.starts_with(&format!("{row_prefix}:")));
                                this.textareas
                                    .retain(|key, _| !key.starts_with(&format!("{row_prefix}:")));
                                cx.notify();
                            })),
                    ),
            );
        }
        let prefix = prefix.to_owned();
        root.child(
            Button::new("defaults-add-prompt")
                .label("Add saved prompt")
                .disabled(rows.len() >= 40)
                .on_click(cx.listener(move |this, _, window, cx| {
                    if this
                        .defaults_prompts
                        .get(&prefix)
                        .is_some_and(|rows| rows.len() >= 40)
                    {
                        return;
                    }
                    let id = uuid::Uuid::new_v4().to_string();
                    this.input(
                        &format!("{prefix}:prompt:{id}:name"),
                        "",
                        "Name",
                        window,
                        cx,
                    );
                    this.textarea(
                        &format!("{prefix}:prompt:{id}:text"),
                        "",
                        "Reusable request",
                        window,
                        cx,
                    );
                    this.defaults_prompts
                        .entry(prefix.clone())
                        .or_default()
                        .push(Prompt {
                            id,
                            name: String::new(),
                            text: String::new(),
                        });
                    cx.notify();
                })),
        )
        .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn prompt_limits_follow_the_runtime_utf16_contract() {
        let accepted = prompt(
            "id".into(),
            format!("  {}  ", "🦀".repeat(30)),
            "  Keep Unicode 🦀  ".into(),
        )
        .unwrap();
        assert_eq!(accepted.text, "Keep Unicode 🦀");
        assert!(prompt("id".into(), "🦀".repeat(31), "Request".into()).is_err());
        assert!(prompt("id".into(), "Name".into(), "🦀".repeat(10001)).is_err());
        assert!(prompt("id".into(), "  ".into(), "Request".into()).is_err());
    }
}
