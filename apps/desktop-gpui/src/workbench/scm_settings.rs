use super::*;

const FORGES: [&str; 5] = ["github", "bitbucket", "forgejo", "gitea", "azure-devops"];

fn editor_prefix(kind: &str, value: &Value) -> String {
    format!(
        "{kind}:{}",
        value.get("id").and_then(Value::as_str).unwrap_or("new")
    )
}
pub(super) fn string<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or_default()
}
fn environment(text: &str) -> anyhow::Result<Value> {
    let mut result = serde_json::Map::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("Use NAME=value on each line"))?;
        let key = key.trim();
        let mut bytes = key.bytes();
        anyhow::ensure!(
            bytes
                .next()
                .is_some_and(|v| v.is_ascii_alphabetic() || v == b'_')
                && bytes.all(|v| v.is_ascii_alphanumeric() || v == b'_'),
            "Invalid variable name: {key}"
        );
        anyhow::ensure!(!result.contains_key(key), "Duplicate variable: {key}");
        result.insert(key.to_owned(), json!(value));
    }
    Ok(Value::Object(result))
}

impl Workbench {
    fn open_scm_editor(&mut self, kind: &str, value: Value) {
        let prefix = editor_prefix(kind, &value);
        let baseline = self
            .scm_editor_baselines
            .entry(prefix)
            .or_insert(value)
            .clone();
        if kind == "forge" {
            self.forge_editor = Some(baseline);
        } else {
            self.jira_editor = Some(baseline);
        }
    }
    fn reload_scm_editor(
        &self,
        kind: &'static str,
        editor: &Value,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = editor.get("id").and_then(Value::as_str).map(str::to_owned);
        let prefix = editor_prefix(kind, editor);
        Button::new(SharedString::from(format!("{kind}-reload")))
            .label("Reload editor…")
            .on_click(cx.listener(move |this, _, window, cx| {
                let prompt = window.prompt(
                    PromptLevel::Warning,
                    "Reload source editor?",
                    Some("Discard the unsaved draft and load current source settings."),
                    &["Keep draft", "Reload"],
                    cx,
                );
                let generation = this.generation;
                let prefix = prefix.clone();
                let id = id.clone();
                cx.spawn(async move |this, cx| {
                    if prompt.await == Ok(1) {
                        let _ = this.update(cx, |this, cx| {
                            if generation != this.generation {
                                return;
                            }
                            let current = if let Some(id) = &id {
                                let entries = if kind == "forge" {
                                    this.responses
                                        .get("forge-connections")
                                        .and_then(|v| v.get("connections"))
                                } else {
                                    this.snapshot
                                        .as_ref()
                                        .and_then(|s| s.workspace.extra.get("jiraSources"))
                                };
                                entries
                                    .and_then(Value::as_array)
                                    .and_then(|entries| {
                                        entries.iter().find(|v| string(v, "id") == id)
                                    })
                                    .cloned()
                            } else {
                                Some(json!({}))
                            };
                            if let Some(value) = current {
                                this.inputs
                                    .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
                                this.textareas
                                    .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
                                this.scm_editor_baselines.remove(&prefix);
                                this.open_scm_editor(kind, value);
                            } else {
                                this.error =
                                    Some("This source was removed. Close its editor.".into());
                            }
                            cx.notify();
                        });
                    }
                })
                .detach();
            }))
            .into_any_element()
    }
    pub(super) fn secret_field(
        &mut self,
        key: &str,
        label: &str,
        hint: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let fresh = !self.inputs.contains_key(key);
        let input = self.input(key, "", hint, window, cx);
        if fresh {
            input.update(cx, |input, cx| input.set_masked(true, window, cx));
        }
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(label.to_owned())
            .child(Input::new(&input).mask_toggle())
            .into_any_element()
    }
    pub(super) fn form_fields(&self, prefix: &str, cx: &App) -> Value {
        let mut fields = serde_json::Map::new();
        let prefix = format!("{prefix}:");
        for (key, input) in &self.inputs {
            if key.starts_with(&prefix) {
                fields.insert(key.clone(), json!(input.read(cx).value().to_string()));
            }
        }
        for (key, input) in &self.textareas {
            if key.starts_with(&prefix) {
                fields.insert(key.clone(), json!(input.read(cx).value().to_string()));
            }
        }
        Value::Object(fields)
    }
    fn move_form_fields(&mut self, old: &str, new: &str) {
        let old = format!("{old}:");
        let new = format!("{new}:");
        let inputs: Vec<_> = self
            .inputs
            .keys()
            .filter(|key| key.starts_with(&old))
            .cloned()
            .collect();
        for key in inputs {
            if let Some(input) = self.inputs.remove(&key) {
                self.inputs
                    .insert(format!("{new}{}", &key[old.len()..]), input);
            }
        }
        let textareas: Vec<_> = self
            .textareas
            .keys()
            .filter(|key| key.starts_with(&old))
            .cloned()
            .collect();
        for key in textareas {
            if let Some(input) = self.textareas.remove(&key) {
                self.textareas
                    .insert(format!("{new}{}", &key[old.len()..]), input);
            }
        }
    }
    pub(super) fn config_request(
        &mut self,
        key: String,
        prefix: &str,
        path: &str,
        input: Value,
        cx: &App,
    ) {
        if self.pending.contains(&key) {
            return;
        }
        self.responses.insert(
            format!("scm-form-receipt:{key}"),
            self.form_fields(prefix, cx),
        );
        self.request(key, path, input);
    }
    fn finish_account_save(
        &mut self,
        kind: &str,
        prefix: &str,
        key: &str,
        value: &Value,
        cx: &App,
    ) {
        let saved_prefix = editor_prefix(kind, value);
        self.scm_editor_baselines.remove(prefix);
        self.scm_editor_baselines
            .insert(saved_prefix.clone(), value.clone());
        let sent = self.responses.remove(&format!("scm-form-receipt:{key}"));
        let unchanged = sent.as_ref() == Some(&self.form_fields(prefix, cx));
        let editor = if kind == "forge" {
            &self.forge_editor
        } else {
            &self.jira_editor
        };
        let active = editor
            .as_ref()
            .is_some_and(|editor| editor_prefix(kind, editor) == prefix);
        if unchanged {
            self.inputs
                .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
            self.textareas
                .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
        } else {
            let token_key = format!("{prefix}:token");
            if sent
                .as_ref()
                .and_then(|sent| sent.get(&token_key))
                .and_then(Value::as_str)
                == Some(self.value(&token_key, cx).as_str())
            {
                self.inputs.remove(&token_key);
            }
            self.move_form_fields(prefix, &saved_prefix);
        }
        if active {
            let next = if unchanged { None } else { Some(value.clone()) };
            if kind == "forge" {
                self.forge_editor = next;
            } else {
                self.jira_editor = next;
            }
        }
    }
    pub(super) fn receive_scm_settings(&mut self, key: &str, value: &Value, cx: &App) {
        if let Some(prefix) = key.strip_prefix("forge-save:") {
            self.finish_account_save("forge", prefix, key, value, cx);
            self.notice = Some("Source account saved".into());
            self.request("forge-connections", "/api/scm/connections/read", json!({}));
        }
        if key.starts_with("forge-remove:") {
            self.notice = Some("Source account removed".into());
            self.request("forge-connections", "/api/scm/connections/read", json!({}));
        }
        if let Some(prefix) = key.strip_prefix("jira-save:") {
            self.finish_account_save("jira", prefix, key, value, cx);
            self.notice = Some("Jira source saved".into());
        }
        if key.starts_with("project-branch:")
            && let Some(repo) = key.strip_prefix("project-branch:")
        {
            self.responses
                .insert(format!("project-branches:{repo}"), value.clone());
        }
        if let Some(repo) = key.strip_prefix("project-defaults-save:") {
            self.notice = Some("Project defaults saved".into());
            // A refresh must not silently change the compare-and-swap baseline beneath a draft.
            let before = self.responses.remove(&format!("scm-form-receipt:{key}"));
            if before.as_ref() == Some(&self.form_fields(&format!("project-defaults:{repo}"), cx)) {
                self.inputs
                    .retain(|key, _| !key.starts_with(&format!("project-defaults:{repo}:")));
                self.textareas
                    .retain(|key, _| !key.starts_with(&format!("project-defaults:{repo}:")));
            }
            self.responses
                .insert(format!("project-defaults:{repo}"), value.clone());
        }
    }
    pub(super) fn scm_settings_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let connections = self
            .responses
            .get("forge-connections")
            .and_then(|v| v.get("connections"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut root=div().id("scm-settings").flex().flex_col().flex_1().overflow_y_scroll().p_6().gap_4()
            .child(Self::header("Source accounts","Authentication runs on the connected computer. Tokens stay in its runtime database."))
            .child(div().flex().gap_2()
                .child(Button::new("forge-refresh").label("Refresh accounts").disabled(!self.online).on_click(cx.listener(|this,_,_,cx|{this.request("forge-connections","/api/scm/connections/read",json!({}));cx.notify();})))
                .child(Button::new("forge-new").primary().label("Add account").disabled(!self.online).on_click(cx.listener(|this,_,_,cx|{this.open_scm_editor("forge",json!({}));cx.notify();}))));
        for connection in connections {
            let edit = connection.clone();
            let remove = connection.clone();
            let id = string(&connection, "id").to_owned();
            let request = format!("forge-remove:{id}");
            root = root.child(
                div()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded_md()
                    .flex()
                    .gap_3()
                    .child(format!(
                        "{} · {} · {}",
                        string(&connection, "name"),
                        string(&connection, "provider"),
                        string(&connection, "baseUrl")
                    ))
                    .child(
                        Button::new(SharedString::from(format!("forge-edit:{id}")))
                            .label("Edit")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_scm_editor("forge", edit.clone());
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new(SharedString::from(request.clone()))
                            .label("Remove…")
                            .disabled(!self.online || self.pending.contains(&request))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let prompt = window.prompt(
                                    PromptLevel::Warning,
                                    "Remove source account?",
                                    Some("Projects must be disconnected from this account first."),
                                    &["Keep account", "Remove"],
                                    cx,
                                );
                                let generation = this.generation;
                                let key = request.clone();
                                let input =
                                    json!({"id":remove["id"],"revision":remove["revision"]});
                                cx.spawn(async move |this, cx| {
                                    if prompt.await == Ok(1) {
                                        let _ = this.update(cx, |this, cx| {
                                            if this.generation == generation {
                                                this.request(
                                                    key,
                                                    "/api/scm/connections/remove",
                                                    input,
                                                );
                                                cx.notify();
                                            }
                                        });
                                    }
                                })
                                .detach();
                            })),
                    ),
            );
        }
        if let Some(editor) = self.forge_editor.clone() {
            root = root.child(self.forge_form(&editor, window, cx));
        }
        root = root
            .child(Self::header(
                "Jira sources",
                "Uses Atlassian CLI (acli) authentication on the connected computer.",
            ))
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("jira-discover")
                            .label("Discover signed-in projects")
                            .disabled(!self.online || self.pending.contains("jira-projects"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.request(
                                    "jira-projects",
                                    "/api/scm/jira/projects/read",
                                    json!({}),
                                );
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("jira-new")
                            .label("Add Jira source")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.open_scm_editor("jira", json!({}));
                                cx.notify();
                            })),
                    ),
            );
        if let Some(discovery) = self.responses.get("jira-projects").cloned() {
            let site = string(&discovery, "site").to_owned();
            for project in discovery
                .get("projects")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let site = site.clone();
                let key = string(project, "key").to_owned();
                let name = string(project, "name").to_owned();
                root = root.child(
                    Button::new(SharedString::from(format!("jira-discovered:{key}")))
                        .label(format!("{key} · {name}"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.open_scm_editor(
                                "jira",
                                json!({"site":site,"project":key,"name":name}),
                            );
                            cx.notify();
                        })),
                );
            }
            if discovery.get("truncated").and_then(Value::as_bool) == Some(true) {
                root = root.child("More Jira projects exist; enter a project key manually.");
            }
        }
        let sources = self
            .snapshot
            .as_ref()
            .and_then(|s| s.workspace.extra.get("jiraSources"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for source in sources {
            let edit = source.clone();
            let id = string(&source, "id").to_owned();
            let key = format!("jira-remove:{id}");
            root = root.child(
                div()
                    .flex()
                    .gap_3()
                    .p_3()
                    .child(format!(
                        "{} · {} · {}",
                        string(&source, "name"),
                        string(&source, "site"),
                        string(&source, "project")
                    ))
                    .child(
                        Button::new(SharedString::from(format!("jira-edit:{id}")))
                            .label("Edit")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_scm_editor("jira", edit.clone());
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new(SharedString::from(key.clone()))
                            .label("Remove…")
                            .disabled(!self.online || self.pending.contains(&key))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let prompt = window.prompt(
                                    PromptLevel::Warning,
                                    "Remove Jira source?",
                                    Some("Its project links will also be removed."),
                                    &["Keep source", "Remove"],
                                    cx,
                                );
                                let generation = this.generation;
                                let key = key.clone();
                                let input = json!({"sourceId":source["id"],"before":source});
                                cx.spawn(async move |this, cx| {
                                    if prompt.await == Ok(1) {
                                        let _ = this.update(cx, |this, cx| {
                                            if this.generation == generation {
                                                this.request(
                                                    key,
                                                    "/api/scm/jira/sources/remove",
                                                    input,
                                                );
                                                cx.notify();
                                            }
                                        });
                                    }
                                })
                                .detach();
                            })),
                    ),
            );
        }
        if let Some(editor) = self.jira_editor.clone() {
            root = root.child(self.jira_form(&editor, window, cx));
        }
        root.into_any_element()
    }
    fn forge_form(
        &mut self,
        editor: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let prefix = editor_prefix("forge", editor);
        let key = format!("forge-save:{prefix}");
        let editing = editor.get("id").is_some();
        let mut form = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_md()
            .child(Self::header(
                if editing {
                    "Edit account"
                } else {
                    "Add account"
                },
                "Save checks the captured account revision.",
            ));
        for (field, label, hint, default) in [
            ("name", "Name", "Account name", ""),
            ("provider", "Provider", "Provider", "github"),
            (
                "baseUrl",
                "Server URL",
                "https://git.example.com",
                "https://github.com",
            ),
            ("credential", "Authentication", "Authentication mode", "gh"),
            (
                "username",
                "Account username/email",
                "Optional username",
                "",
            ),
        ] {
            let value = if string(editor, field).is_empty() {
                default
            } else {
                string(editor, field)
            };
            form = form.child(self.field(
                &format!("{prefix}:{field}"),
                label,
                value,
                hint,
                window,
                cx,
            ));
            let choices = match field {
                "provider" => FORGES.to_vec(),
                "credential" => vec!["gh", "gh-wrapper", "token", "environment", "cli"],
                _ => vec![],
            };
            if !choices.is_empty() {
                form = form.child(self.work_field_choices(
                    &format!("{prefix}:{field}"),
                    &choices.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                    cx,
                ));
            }
        }
        let credential = self.value(&format!("{prefix}:credential"), cx);
        let provider = self.value(&format!("{prefix}:provider"), cx);
        if credential == "token" {
            form = form.child(self.secret_field(
                &format!("{prefix}:token"),
                "API token",
                if editing {
                    "Leave blank to retain the token for the same account"
                } else {
                    "API token"
                },
                window,
                cx,
            ));
        }
        if credential == "environment" {
            form = form.child(self.field(
                &format!("{prefix}:tokenEnv"),
                "Runtime token variable",
                string(editor, "tokenEnv"),
                "TOKEN_VARIABLE",
                window,
                cx,
            ));
        }
        if credential == "gh-wrapper" {
            let vars = editor
                .get("cliEnv")
                .and_then(Value::as_object)
                .map(|env| {
                    env.iter()
                        .filter_map(|(k, v)| v.as_str().map(|v| format!("{k}={v}")))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();
            form = form.child(self.text_field(
                &format!("{prefix}:cliEnv"),
                "Wrapper account selectors",
                &vars,
                "ACCOUNT=work",
                window,
                cx,
            ));
        }
        if credential == "gh" || credential == "cli" {
            form = form.child(self.field(
                &format!("{prefix}:cliProfile"),
                "CLI user/profile",
                string(editor, "cliProfile"),
                "Default signed-in account",
                window,
                cx,
            ));
            if ["gitea", "forgejo"].contains(&provider.as_str()) {
                form = form
                    .child(self.field(
                        &format!("{prefix}:cliTool"),
                        "CLI tool",
                        if string(editor, "cliTool").is_empty() {
                            "tea"
                        } else {
                            string(editor, "cliTool")
                        },
                        "fj or tea",
                        window,
                        cx,
                    ))
                    .child(self.work_field_choices(
                        &format!("{prefix}:cliTool"),
                        &["fj".into(), "tea".into()],
                        cx,
                    ));
            }
            let discover_prefix = prefix.clone();
            let profiles_key = format!("forge-profiles:{prefix}");
            let result_key = profiles_key.clone();
            form=form.child(Button::new("forge-discover-profiles").label("Discover CLI profiles").disabled(!self.online||self.pending.contains(&profiles_key)).on_click(cx.listener(move|this,_,_,cx|{
                let mut input=json!({"provider":this.value(&format!("{discover_prefix}:provider"),cx),"baseUrl":this.value(&format!("{discover_prefix}:baseUrl"),cx)});
                let tool=this.value(&format!("{discover_prefix}:cliTool"),cx);if !tool.is_empty(){input["cliTool"]=json!(tool);}
                this.request(profiles_key.clone(),"/api/scm/cli-profiles/read",input);cx.notify();
            })));
            if let Some(profiles) = self.responses.get(&result_key).cloned() {
                form = form.children(
                    profiles
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                );
                for profile in profiles
                    .get("profiles")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let id = string(profile, "id").to_owned();
                    let name = string(profile, "name").to_owned();
                    let field = format!("{prefix}:cliProfile");
                    form = form.child(
                        Button::new(SharedString::from(format!("profile:{id}")))
                            .label(name)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                if let Some(input) = this.inputs.get(&field) {
                                    input.update(cx, |input, cx| {
                                        input.set_value(id.clone(), window, cx)
                                    });
                                }
                                cx.notify();
                            })),
                    );
                }
            }
        }
        form = form.child(self.reload_scm_editor("forge", editor, cx));
        let editor = editor.clone();
        form = form
            .child(
                Button::new("forge-save")
                    .primary()
                    .label("Save account")
                    .disabled(!self.online || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let result = (|| -> anyhow::Result<Value> {
                            let mut input = json!({});
                            for field in ["name", "provider", "baseUrl", "credential", "username"] {
                                let value = this.value(&format!("{prefix}:{field}"), cx);
                                if !value.trim().is_empty() {
                                    input[field] = json!(value.trim());
                                }
                            }
                            if editing {
                                input["id"] = editor["id"].clone();
                                input["revision"] = editor["revision"].clone();
                            }
                            let credential = input
                                .get("credential")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_owned();
                            match credential.as_str() {
                                "token" => {
                                    let token = this.value(&format!("{prefix}:token"), cx);
                                    if !token.trim().is_empty() {
                                        input["token"] = json!(token.trim());
                                    }
                                }
                                "environment" => {
                                    input["tokenEnv"] =
                                        json!(this.value(&format!("{prefix}:tokenEnv"), cx).trim())
                                }
                                "gh-wrapper" => {
                                    input["cliEnv"] = environment(
                                        &this.text_value(&format!("{prefix}:cliEnv"), cx),
                                    )?
                                }
                                "gh" | "cli" => {
                                    for field in ["cliProfile", "cliTool"] {
                                        if field == "cliTool"
                                            && !matches!(
                                                input.get("provider").and_then(Value::as_str),
                                                Some("gitea" | "forgejo")
                                            )
                                        {
                                            continue;
                                        }
                                        let value = this.value(&format!("{prefix}:{field}"), cx);
                                        if !value.trim().is_empty() {
                                            input[field] = json!(value.trim());
                                        }
                                    }
                                }
                                _ => anyhow::bail!("Choose an authentication mode"),
                            }
                            anyhow::ensure!(input.get("name").is_some(), "Enter an account name");
                            Ok(input)
                        })();
                        match result {
                            Ok(input) => this.config_request(
                                key.clone(),
                                &prefix,
                                "/api/scm/connections/save",
                                input,
                                cx,
                            ),
                            Err(error) => this.error = Some(error.to_string()),
                        }
                        cx.notify();
                    })),
            )
            .child(
                Button::new("forge-close")
                    .label("Close (keep draft)")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.forge_editor = None;
                        cx.notify();
                    })),
            );
        form.into_any_element()
    }
    fn jira_form(
        &mut self,
        editor: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let prefix = editor_prefix("jira", editor);
        let key = format!("jira-save:{prefix}");
        let editing = editor.get("id").is_some();
        let mut form = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_md();
        form = form.child(self.field(
            &format!("{prefix}:name"),
            "Name",
            string(editor, "name"),
            "Optional display name",
            window,
            cx,
        ));
        if editing {
            form = form.child(format!(
                "{} · {}",
                string(editor, "site"),
                string(editor, "project")
            ));
        } else {
            form = form
                .child(self.field(
                    &format!("{prefix}:site"),
                    "Jira Cloud site",
                    string(editor, "site"),
                    "https://team.atlassian.net",
                    window,
                    cx,
                ))
                .child(self.field(
                    &format!("{prefix}:project"),
                    "Project key",
                    string(editor, "project"),
                    "TEAM",
                    window,
                    cx,
                ));
        }
        form = form.child(self.reload_scm_editor("jira", editor, cx));
        let editor = editor.clone();
        form=form.child(Button::new("jira-save").primary().label("Save Jira source").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
            let mut source=if editing{editor.clone()}else{json!({"site":this.value(&format!("{prefix}:site"),cx).trim(),"project":this.value(&format!("{prefix}:project"),cx).trim().to_uppercase()})};
            let name=this.value(&format!("{prefix}:name"),cx);if name.trim().is_empty(){if let Some(fields)=source.as_object_mut(){fields.remove("name");}}else{source["name"]=json!(name.trim());}
            let mut input=json!({"source":source});if editing{input["before"]=editor.clone();}
            this.config_request(key.clone(),&prefix,"/api/scm/jira/sources/save",input,cx);cx.notify();
        }))).child(Button::new("jira-close").label("Close (keep draft)").on_click(cx.listener(|this,_,_,cx|{this.jira_editor=None;cx.notify();})));
        form.into_any_element()
    }
    pub(super) fn project_settings(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.preset_editor.is_some() {
            return self.preset_editor(window, cx);
        }
        let Some(repository) = self
            .snapshot
            .as_ref()
            .and_then(|s| {
                s.workspace
                    .repositories
                    .iter()
                    .find(|r| self.project_editor.as_ref() == Some(&r.id))
            })
            .cloned()
        else {
            return Self::empty("Project unavailable", "Return to the project list.");
        };
        let id = repository.id.clone();
        let defaults_key = format!("project-defaults:{id}");
        let mut root = div()
            .id("project-settings")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(&repository.name, &repository.path))
            .child(
                Button::new("project-back")
                    .label("Back to projects")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.project_editor = None;
                        cx.notify();
                    })),
            );
        if repository.kind.is_none() {
            root = root.child(Self::header(
                "Source account",
                "Select an account and owner/repository (project/repository on Azure DevOps).",
            ));
            let binding = repository.extra.get("forge").cloned().unwrap_or(json!({}));
            let prefix = format!("project-forge:{id}");
            root = root.child(self.field(
                &format!("{prefix}:account"),
                "Account ID",
                string(&binding, "connectionId"),
                "Choose an account below",
                window,
                cx,
            ));
            for account in self
                .responses
                .get("forge-connections")
                .and_then(|v| v.get("connections"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                let account_id = string(&account, "id").to_owned();
                let name = string(&account, "name").to_owned();
                let field = format!("{prefix}:account");
                root = root.child(
                    Button::new(SharedString::from(format!("project-account:{account_id}")))
                        .label(name)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if let Some(input) = this.inputs.get(&field) {
                                input.update(cx, |input, cx| {
                                    input.set_value(account_id.clone(), window, cx)
                                });
                            }
                            cx.notify();
                        })),
                );
            }
            root = root.child(self.field(
                &format!("{prefix}:repository"),
                "Repository",
                string(&binding, "repository"),
                "owner/repository",
                window,
                cx,
            ));
            let bind_id = id.clone();
            let bind_key = format!("project-forge-bind:{id}");
            root=root.child(Button::new("project-bind-forge").label("Connect account").disabled(!self.online||self.pending.contains(&bind_key)).on_click(cx.listener(move|this,_,_,cx|{this.request(bind_key.clone(),"/api/scm/repositories/forge/bind",json!({"repositoryId":bind_id,"forge":{"connectionId":this.value(&format!("{prefix}:account"),cx),"repository":this.value(&format!("{prefix}:repository"),cx)}}));cx.notify();})));
            if binding.get("connectionId").is_some() {
                let id = id.clone();
                root = root.child(
                    Button::new("project-unbind-forge")
                        .label("Disconnect source account")
                        .disabled(!self.online)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request(
                                format!("project-forge-bind:{id}"),
                                "/api/scm/repositories/forge/bind",
                                json!({"repositoryId":id,"forge":null}),
                            );
                            cx.notify();
                        })),
                );
            }
            root = root.child(self.project_branches(&id, window, cx));
        }
        root = root.child(self.project_presets(&repository, cx));
        let Some(response) = self.responses.get(&defaults_key).cloned() else {
            return root.child("Loading project defaults…").into_any_element();
        };
        root.child(self.source_reload_button(cx))
            .child(self.defaults_form(
                &defaults_key,
                json!({"scope":"environment-project","repositoryId":id}),
                response,
                window,
                cx,
            ))
            .into_any_element()
    }
    fn project_branches(
        &mut self,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = format!("project-branches:{id}");
        let repository = id.to_owned();
        let read_key = key.clone();
        let mut root = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(Self::header(
                "Project checkout",
                "Branch changes apply to the runtime's main project checkout.",
            ))
            .child(
                Button::new("project-load-branches")
                    .label("Refresh branches")
                    .disabled(!self.online || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            read_key.clone(),
                            "/api/scm/branches",
                            json!({"repositoryId":repository}),
                        );
                        cx.notify();
                    })),
            );
        let Some(branches) = self.responses.get(&key).cloned() else {
            return root.into_any_element();
        };
        root = root.child(format!("Current: {}", string(&branches, "current")));
        for branch in branches
            .get("branches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let name = string(branch, "name").to_owned();
            let reference = string(branch, "ref").to_owned();
            let id = id.to_owned();
            let revision = string(&branches, "revision").to_owned();
            root=root.child(Button::new(SharedString::from(format!("project-branch:{reference}"))).label(name).disabled(!self.online||branch.get("checkedOut").and_then(Value::as_bool)==Some(true)||self.pending.contains(&format!("project-branch:{id}")))
                .on_click(cx.listener(move|this,_,_,cx|{this.request(format!("project-branch:{id}"),"/api/scm/branch",json!({"repositoryId":id,"action":"switch","name":reference,"revision":revision}));cx.notify();})));
        }
        let prefix = format!("project-new-branch:{id}");
        root = root.child(self.field(&prefix, "New branch", "", "feature/name", window, cx));
        let id = id.to_owned();
        let revision = string(&branches, "revision").to_owned();
        root=root.child(Button::new("project-create-branch").label("Create and switch branch").disabled(!self.online||self.pending.contains(&format!("project-branch:{id}"))).on_click(cx.listener(move|this,_,_,cx|{this.request(format!("project-branch:{id}"),"/api/scm/branch",json!({"repositoryId":id,"action":"create","name":this.value(&prefix,cx),"revision":revision}));cx.notify();})));
        root.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::environment;
    use serde_json::json;
    #[test]
    fn account_selectors_preserve_values_and_reject_duplicate_or_invalid_names() {
        assert_eq!(
            environment("ACCOUNT=work\nPROFILE=a=b\n").unwrap(),
            json!({"ACCOUNT":"work","PROFILE":"a=b"})
        );
        assert!(environment("1ACCOUNT=work").is_err());
        assert!(environment("ACCOUNT=one\nACCOUNT=two").is_err());
        assert!(environment("ACCOUNT").is_err());
    }
}
