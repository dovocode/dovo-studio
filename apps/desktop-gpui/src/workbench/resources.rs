use super::*;

impl Workbench {
    pub(super) fn resource_value(&self, settings: &Value) -> Value {
        resource_value(settings, self.resource_agent.as_deref())
    }

    pub(super) fn resources_key(&self) -> String {
        format!(
            "resources:{}:{}:target:{}",
            self.resource_scope,
            if matches!(self.resource_scope, "project" | "environment-project") {
                self.selected_repository.as_deref().unwrap_or_default()
            } else {
                ""
            },
            self.resource_agent
                .as_ref()
                .map(|id| format!("agent:{id}"))
                .unwrap_or_else(|| "all".into())
        )
    }
    fn resource_new_key(&self, field: &str) -> String {
        format!("{}:{field}", self.resources_key())
    }
    pub(super) fn receive_resources(&mut self, key: &str, value: &Value, cx: &App) {
        if let Some(prefix) = key.strip_prefix("resources-save:") {
            let fields = self.responses.remove(&format!("scm-form-receipt:{key}"));
            if let Some(created) = self
                .responses
                .remove(&format!("resource-created:{key}"))
                .and_then(|value| value.as_array().cloned())
            {
                for group in created.iter().filter_map(Value::as_str) {
                    let group_prefix = format!("{prefix}:{group}");
                    let unchanged = fields.as_ref().is_some_and(|sent| {
                        sent.as_object().is_some_and(|sent| {
                            sent.iter()
                                .filter(|(field, _)| field.starts_with(&group_prefix))
                                .all(|(field, value)| {
                                    if field.ends_with("content") {
                                        value.as_str() == Some(self.text_value(field, cx).as_str())
                                    } else {
                                        value.as_str() == Some(self.value(field, cx).as_str())
                                    }
                                })
                        })
                    });
                    if unchanged {
                        self.inputs.retain(|key, _| !key.starts_with(&group_prefix));
                        self.textareas
                            .retain(|key, _| !key.starts_with(&group_prefix));
                    }
                }
            }
            if let Some((document, _)) = prefix.split_once(":target:") {
                let targets = format!("{document}:target:");
                self.responses.retain(|key, _| !key.starts_with(&targets));
            }
            self.responses.insert(prefix.to_owned(), value.clone());
            self.notice = Some("Resources saved".into());
        }
    }
    pub(super) fn read_resources(&mut self) {
        let mut input = json!({"scope":self.resource_scope,"includeAgents":true});
        if matches!(self.resource_scope, "project" | "environment-project")
            && let Some(id) = &self.selected_repository
        {
            input["repositoryId"] = json!(id);
        }
        let key = self.resources_key();
        if !self.responses.contains_key(&key) {
            self.request(key, "/api/agents/settings/read", input);
        }
    }
    pub(super) fn save_resources(&mut self, before: Value, mut resources: Value, cx: &App) {
        if resources.get("mcpServers").is_none() {
            resources["mcpServers"] = json!([]);
        }
        if resources.get("skills").is_none() {
            resources["skills"] = json!([]);
        }
        let key = format!("resources-save:{}", self.resources_key());
        if self.pending.contains(&key) {
            return;
        }
        let mut created = Vec::new();
        for (kind, group) in [
            ("mcpServers", "new-mcp-"),
            ("skills", "new-skill-"),
            ("hooks", "new-hook-"),
        ] {
            let name = self.value(&self.resource_new_key(&format!("{group}name")), cx);
            if !name.is_empty()
                && resources
                    .get(kind)
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items
                            .iter()
                            .any(|item| item.get("name").and_then(Value::as_str) == Some(&name))
                    })
                && !self
                    .resource_value(&before)
                    .get(kind)
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items
                            .iter()
                            .any(|item| item.get("name").and_then(Value::as_str) == Some(&name))
                    })
            {
                created.push(group);
            }
        }
        self.responses
            .insert(format!("resource-created:{key}"), json!(created));
        let after = match resource_after(
            &before,
            self.resource_agent.as_deref(),
            &resources,
            self.responses.get(&self.resources_key()),
        ) {
            Ok(after) => after,
            Err(error) => {
                self.error = Some(error.to_string());
                return;
            }
        };
        let project_key = self
            .responses
            .get(&self.resources_key())
            .and_then(|value| value.get("projectKey"))
            .cloned();
        let mut input =
            json!({"scope":self.resource_scope,"before":before,"after":after,"includeAgents":true});
        if matches!(self.resource_scope, "project" | "environment-project")
            && let Some(id) = &self.selected_repository
        {
            input["repositoryId"] = json!(id);
        }
        if let Some(key) = project_key {
            input["projectKey"] = key;
        }
        self.config_request(
            format!("resources-save:{}", self.resources_key()),
            &self.resources_key(),
            "/api/agents/settings/save",
            input,
            cx,
        );
    }
    pub(super) fn resources_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = self.resources_key();
        let mut root = div()
            .id("resources-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(
                "Skills & MCP",
                "Configure agent resources in their existing global, computer and project scopes.",
            ))
            .child(
                div().flex().gap_2().children(
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
                            .selected(self.resource_scope == scope)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.resource_scope = scope;
                                this.read_resources();
                                cx.notify();
                            }))
                    }),
                ),
            );
        if matches!(self.resource_scope, "project" | "environment-project") {
            let repos = self
                .snapshot
                .as_ref()
                .map(|snapshot| snapshot.workspace.repositories.clone())
                .unwrap_or_default();
            root = root.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .children(repos.into_iter().map(|repo| {
                        let id = repo.id;
                        Button::new(SharedString::from(format!("resource-repo-{id}")))
                            .label(repo.name)
                            .selected(self.selected_repository.as_ref() == Some(&id))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_repository = Some(id.clone());
                                this.read_resources();
                                cx.notify();
                            }))
                    })),
            );
        }
        root = root.child(
            Button::new("reload-resources")
                .ghost()
                .label("Reload resources")
                .on_click(cx.listener(|this, _, window, cx| {
                    let generation=this.generation;let epoch=this.source_epoch();let key=this.resources_key();let scope=this.resource_scope;let repository=this.selected_repository.clone();
                    let prompt=window.prompt(PromptLevel::Warning,"Reload resources?",Some("Discard unsaved resources in this scope and load its current settings."),&["Keep edits","Reload"],cx);
                    cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{if this.generation!=generation||this.source_epoch()!=epoch{return;}this.inputs.retain(|field,_|!field.starts_with(&format!("{key}:")));this.textareas.retain(|field,_|!field.starts_with(&format!("{key}:")));let mut input=json!({"scope":scope,"includeAgents":true});if matches!(scope,"project"|"environment-project"){input["repositoryId"]=json!(repository);}this.request(key,"/api/agents/settings/read",input);cx.notify();});}}).detach();
                    cx.notify();
                })),
        );
        let Some(response) = self.responses.get(&key).cloned() else {
            return root
                .child(Self::empty(
                    "Choose a scope",
                    "Load the resources for this scope to edit them.",
                ))
                .into_any_element();
        };
        let mut targets = div().flex().flex_wrap().gap_2().child(
            Button::new("resources-all-agents")
                .label("All agents")
                .selected(self.resource_agent.is_none())
                .on_click(cx.listener(|this, _, _, cx| {
                    this.resource_agent = None;
                    this.read_resources();
                    cx.notify();
                })),
        );
        match super::scoped_agents::effective_agents(&response) {
            Ok(agents) => {
                for agent in agents {
                    let id = agent.id;
                    targets = targets.child(
                        Button::new(SharedString::from(format!("resources-for-agent-{id}")))
                            .label(agent.name)
                            .selected(self.resource_agent.as_ref() == Some(&id))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.resource_agent = Some(id.clone());
                                this.read_resources();
                                cx.notify();
                            })),
                    );
                }
            }
            Err(error) => return root.child(error.to_string()).into_any_element(),
        }
        root = root.child(targets);
        if let Some(id) = &self.resource_agent {
            if !super::scoped_agents::effective_agents(&response)
                .is_ok_and(|agents| agents.iter().any(|agent| &agent.id == id))
            {
                return root.child("This configuration is not available in this scope. Choose All agents or another configuration.").into_any_element();
            }
            root = root.child("Resources saved here apply to the selected agent configuration.");
        }
        let Some(before) = response
            .get("value")
            .filter(|value| value.is_object())
            .cloned()
        else {
            return Self::empty(
                "Invalid resource settings",
                "The runtime did not return a settings document.",
            );
        };
        root = root
            .child(self.source_reload_button(cx))
            .child(self.resource_catalog_panel(&before, window, cx));
        let resources = self.resource_value(&before);
        let inherited = resource_value(
            response.get("inherited").unwrap_or(&Value::Null),
            self.resource_agent.as_deref(),
        );
        if inherited.is_object() {
            for (kind, label) in [
                ("mcpServers", "MCP servers"),
                ("skills", "Skills"),
                ("hooks", "Hooks"),
            ] {
                let names = inherited
                    .get(kind)
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.get("name").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_default();
                if !names.is_empty() {
                    root = root.child(format!("Inherited {label}: {names}"));
                }
            }
        }
        let servers = match resources.get("mcpServers") {
            Some(Value::Array(servers)) => servers.clone(),
            None => vec![],
            _ => return Self::empty("Invalid MCP settings", "The server list is invalid."),
        };
        root=root.child(Self::header("MCP servers","HTTP URLs remain HTTP. Commands run on the selected runtime computer. Use one argument per line."));
        for (index, server) in servers.iter().enumerate() {
            let Some(name) = server.get("name").and_then(Value::as_str) else {
                return Self::empty("Invalid MCP server", "A server has no name.");
            };
            let prefix = format!("{key}:mcp:{name}");
            let enabled = server
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let transport = server
                .get("transport")
                .and_then(Value::as_str)
                .unwrap_or("stdio");
            let mut card = div()
                .p_4()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_3()
                .child(name.to_owned());
            if transport == "http" {
                card = card.child(
                    self.field(
                        &format!("{prefix}:url"),
                        "HTTP endpoint",
                        server
                            .get("url")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "http://computer:port/mcp",
                        window,
                        cx,
                    ),
                );
                card = card.child(
                    self.field(
                        &format!("{prefix}:bearer"),
                        "Bearer token environment variable",
                        server
                            .get("bearerTokenEnv")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "Optional runtime environment variable",
                        window,
                        cx,
                    ),
                );
            } else {
                card = card.child(
                    self.field(
                        &format!("{prefix}:command"),
                        "Executable",
                        server
                            .get("command")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "npx",
                        window,
                        cx,
                    ),
                );
                let args = server
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|args| {
                        args.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                card = card.child(self.text_field(
                    &format!("{prefix}:args"),
                    "Arguments",
                    &args,
                    "One argument per line",
                    window,
                    cx,
                ));
            }
            for (field, label) in [
                ("env", "Environment mappings (variable=runtime variable)"),
                ("headerEnv", "Header mappings (header=runtime variable)"),
            ] {
                let contents = mapping_text(server.get(field));
                card = card.child(self.text_field(
                    &format!("{prefix}:{field}"),
                    label,
                    &contents,
                    "One mapping per line; values name runtime environment variables",
                    window,
                    cx,
                ));
            }
            let mut buttons = div().flex().gap_2();
            buttons = buttons.child(
                Button::new(SharedString::from(format!("save-{prefix}")))
                    .label("Save server")
                    .on_click(cx.listener({
                        let before = before.clone();
                        let resources = resources.clone();
                        let prefix = prefix.clone();
                        let transport = transport.to_owned();
                        move |this, _, _, cx| {
                            let mut resources = resources.clone();
                            let server = &mut resources["mcpServers"][index];
                            if transport == "http" {
                                server["url"] = json!(this.value(&format!("{prefix}:url"), cx));
                                server["bearerTokenEnv"] =
                                    json!(this.value(&format!("{prefix}:bearer"), cx));
                            } else {
                                server["command"] =
                                    json!(this.value(&format!("{prefix}:command"), cx));
                                server["args"] = json!(
                                    this.text_value(&format!("{prefix}:args"), cx)
                                        .lines()
                                        .map(str::to_owned)
                                        .collect::<Vec<_>>()
                                );
                            }
                            for field in ["env", "headerEnv"] {
                                match parse_mapping(
                                    &this.text_value(&format!("{prefix}:{field}"), cx),
                                    field == "headerEnv",
                                ) {
                                    Ok(mapping) => server[field] = mapping,
                                    Err(error) => {
                                        this.error = Some(error.to_string());
                                        cx.notify();
                                        return;
                                    }
                                }
                            }
                            this.save_resources(before.clone(), resources, cx);
                            cx.notify();
                        }
                    })),
            );
            buttons = buttons.child(
                Button::new(SharedString::from(format!("enable-{prefix}")))
                    .label(if enabled { "Disable" } else { "Enable" })
                    .on_click(cx.listener({
                        let before = before.clone();
                        let resources = resources.clone();
                        move |this, _, _, cx| {
                            let mut resources = resources.clone();
                            resources["mcpServers"][index]["enabled"] = json!(!enabled);
                            this.save_resources(before.clone(), resources, cx);
                            cx.notify();
                        }
                    })),
            );
            buttons = buttons.child(
                Button::new(SharedString::from(format!("test-{prefix}")))
                    .ghost()
                    .label("Test connection")
                    .on_click(cx.listener({
                        let server = server.clone();
                        let prefix = prefix.clone();
                        move |this, _, _, cx| {
                            this.request(
                                format!("mcp-test:{prefix}"),
                                "/api/agents/mcp/test",
                                server.clone(),
                            );
                            cx.notify();
                        }
                    })),
            );
            buttons = buttons.child(
                Button::new(SharedString::from(format!("delete-{prefix}")))
                    .ghost()
                    .label("Remove")
                    .on_click(cx.listener({
                        let before = before.clone();
                        let resources = resources.clone();
                        move |this, _, _, cx| {
                            let mut resources = resources.clone();
                            if let Some(servers) = resources["mcpServers"].as_array_mut() {
                                servers.remove(index);
                            }
                            this.save_resources(before.clone(), resources, cx);
                            cx.notify();
                        }
                    })),
            );
            card = card.child(buttons);
            if let Some(result) = self.responses.get(&format!("mcp-test:{prefix}"))
                && let Some(tools) = result.get("tools").and_then(Value::as_array)
            {
                card = card.child(format!(
                    "Available tools: {}",
                    tools
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            root = root.child(card);
        }
        root = root
            .child(self.field(&self.resource_new_key("new-mcp-name"), "New server name", "", "letters, digits, dashes and underscores", window, cx))
            .child(self.field(&self.resource_new_key("new-mcp-command"), "Executable (stdio server)", "", "npx", window, cx))
            .child(self.field(&self.resource_new_key("new-mcp-url"), "HTTP endpoint (use instead of executable)", "", "http://computer:port/mcp", window, cx))
            .child(Button::new("add-mcp-server").label("Add server").on_click(cx.listener({
                let before = before.clone();
                let resources = resources.clone();
                move |this, _, _, cx| {
                    let name = this.value(&this.resource_new_key("new-mcp-name"), cx);
                    let command = this.value(&this.resource_new_key("new-mcp-command"), cx);
                    let url = this.value(&this.resource_new_key("new-mcp-url"), cx);
                    if name.trim().is_empty() || (command.trim().is_empty() && url.trim().is_empty()) {
                        this.error = Some("Choose a server name and executable or endpoint".into());
                        cx.notify();
                        return;
                    }
                    let server = json!({"name":name,"enabled":true,"transport":if url.trim().is_empty(){"stdio"}else{"http"},"command":command,"url":url,"args":[],"env":{},"headerEnv":{},"bearerTokenEnv":""});
                    let mut resources = resources.clone();
                    if resources.get("mcpServers").is_none() {
                        resources["mcpServers"] = json!([]);
                    }
                    if let Some(servers) = resources["mcpServers"].as_array_mut() {
                        servers.push(server);
                    }
                    this.save_resources(before.clone(), resources, cx);
                    cx.notify();
                }
            })));
        root = root.child(Self::header(
            "Skills",
            "Store reusable agent instructions. Supporting files stay on their runtime computer.",
        ));
        let skills = match resources.get("skills") {
            Some(Value::Array(skills)) => skills.clone(),
            None => vec![],
            _ => return Self::empty("Invalid skills", "The skill list is invalid."),
        };
        for (index, skill) in skills.iter().enumerate() {
            let Some(name) = skill.get("name").and_then(Value::as_str) else {
                return Self::empty("Invalid skill", "A skill has no name.");
            };
            let prefix = format!("{key}:skill:{name}");
            if let Some(path) = skill.get("sourcePath").and_then(Value::as_str) {
                root = root.child(format!("Supporting files for {name}: {path}"));
            }
            let enabled = skill
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let card = div()
                .p_4()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_3()
                .child(name.to_owned())
                .child(
                    self.field(
                        &format!("{prefix}:description"),
                        "Description",
                        skill
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "When should the agent use it?",
                        window,
                        cx,
                    ),
                )
                .child(
                    self.text_field(
                        &format!("{prefix}:content"),
                        "Instructions",
                        skill
                            .get("content")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "Skill instructions",
                        window,
                        cx,
                    ),
                )
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(
                            Button::new(SharedString::from(format!("save-{prefix}")))
                                .label("Save skill")
                                .on_click(cx.listener({
                                    let before = before.clone();
                                    let resources = resources.clone();
                                    let prefix = prefix.clone();
                                    move |this, _, _, cx| {
                                        let mut resources = resources.clone();
                                        resources["skills"][index]["description"] =
                                            json!(this.value(&format!("{prefix}:description"), cx));
                                        resources["skills"][index]["content"] = json!(
                                            this.text_value(&format!("{prefix}:content"), cx)
                                        );
                                        this.save_resources(before.clone(), resources, cx);
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(
                            Button::new(SharedString::from(format!("toggle-{prefix}")))
                                .label(if enabled { "Disable" } else { "Enable" })
                                .on_click(cx.listener({
                                    let before = before.clone();
                                    let resources = resources.clone();
                                    move |this, _, _, cx| {
                                        let mut resources = resources.clone();
                                        resources["skills"][index]["enabled"] = json!(!enabled);
                                        this.save_resources(before.clone(), resources, cx);
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(
                            Button::new(SharedString::from(format!("delete-{prefix}")))
                                .ghost()
                                .label("Remove")
                                .on_click(cx.listener({
                                    let before = before.clone();
                                    let resources = resources.clone();
                                    move |this, _, _, cx| {
                                        let mut resources = resources.clone();
                                        if let Some(skills) = resources["skills"].as_array_mut() {
                                            skills.remove(index);
                                        }
                                        this.save_resources(before.clone(), resources, cx);
                                        cx.notify();
                                    }
                                })),
                        ),
                );
            root = root.child(card);
        }
        root = root.child(Self::header(
            "Hooks",
            "Run commands on the runtime computer before or after each agent turn.",
        ));
        let hooks = resources
            .get("hooks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (index, hook) in hooks.iter().enumerate() {
            let Some(name) = hook.get("name").and_then(Value::as_str) else {
                return Self::empty("Invalid hook", "A hook has no name.");
            };
            let prefix = format!("{key}:hook:{name}");
            let enabled = hook
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut card = div()
                .p_4()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_3()
                .child(name.to_owned())
                .child(
                    self.field(
                        &format!("{prefix}:command"),
                        "Command",
                        hook.get("command")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "Shell command",
                        window,
                        cx,
                    ),
                )
                .child(
                    self.field(
                        &format!("{prefix}:timeout"),
                        "Timeout in seconds (1–600)",
                        &hook
                            .get("timeoutSeconds")
                            .and_then(Value::as_u64)
                            .unwrap_or(60)
                            .to_string(),
                        "60",
                        window,
                        cx,
                    ),
                );
            let event = hook
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or("before-turn");
            card = card.child(format!("Event: {event}"));
            let before_save = before.clone();
            let resources_save = resources.clone();
            let save_prefix = prefix.clone();
            let mut actions = div().flex().gap_2().child(
                Button::new(SharedString::from(format!("save-{prefix}")))
                    .label("Save hook")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let timeout = this
                            .value(&format!("{save_prefix}:timeout"), cx)
                            .parse::<u64>();
                        let command = this.value(&format!("{save_prefix}:command"), cx);
                        match timeout {
                            Ok(timeout)
                                if (1..=600).contains(&timeout) && !command.trim().is_empty() =>
                            {
                                let mut resources = resources_save.clone();
                                resources["hooks"][index]["command"] = json!(command);
                                resources["hooks"][index]["timeoutSeconds"] = json!(timeout);
                                this.save_resources(before_save.clone(), resources, cx);
                            }
                            _ => {
                                this.error = Some(
                                    "Enter a command and a timeout from 1 to 600 seconds".into(),
                                )
                            }
                        }
                        cx.notify();
                    })),
            );
            let before_toggle = before.clone();
            let resources_toggle = resources.clone();
            actions = actions.child(
                Button::new(SharedString::from(format!("toggle-{prefix}")))
                    .label(if enabled { "Disable" } else { "Enable" })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut resources = resources_toggle.clone();
                        resources["hooks"][index]["enabled"] = json!(!enabled);
                        this.save_resources(before_toggle.clone(), resources, cx);
                        cx.notify();
                    })),
            );
            let before_event = before.clone();
            let resources_event = resources.clone();
            let next = if event == "before-turn" {
                "after-turn"
            } else {
                "before-turn"
            };
            actions = actions.child(
                Button::new(SharedString::from(format!("event-{prefix}")))
                    .label(format!("Use {next}"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut resources = resources_event.clone();
                        resources["hooks"][index]["event"] = json!(next);
                        this.save_resources(before_event.clone(), resources, cx);
                        cx.notify();
                    })),
            );
            let before_remove = before.clone();
            let resources_remove = resources.clone();
            actions = actions.child(
                Button::new(SharedString::from(format!("remove-{prefix}")))
                    .ghost()
                    .label("Remove")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut resources = resources_remove.clone();
                        if let Some(hooks) = resources["hooks"].as_array_mut() {
                            hooks.remove(index);
                        }
                        this.save_resources(before_remove.clone(), resources, cx);
                        cx.notify();
                    })),
            );
            root = root.child(card.child(actions));
        }
        root = root
            .child(self.field(
                &self.resource_new_key("new-hook-name"),
                "New hook name",
                "",
                "hook-name",
                window,
                cx,
            ))
            .child(self.field(
                &self.resource_new_key("new-hook-command"),
                "Command",
                "",
                "Shell command",
                window,
                cx,
            ));
        for (event, label) in [
            ("before-turn", "Add before-turn hook"),
            ("after-turn", "Add after-turn hook"),
        ] {
            let before = before.clone();
            let resources = resources.clone();
            root = root.child(Button::new(event).label(label).on_click(cx.listener(move |this, _, _, cx| {
                let name = this.value(&this.resource_new_key("new-hook-name"), cx); let command = this.value(&this.resource_new_key("new-hook-command"), cx);
                if name.trim().is_empty() || command.trim().is_empty() {
                    this.error = Some("Enter a hook name and command".into()); cx.notify(); return;
                }
                let mut resources = resources.clone();
                if resources.get("hooks").is_none() { resources["hooks"] = json!([]); }
                if let Some(hooks) = resources["hooks"].as_array_mut() { hooks.push(json!({"name":name,"command":command,"event":event,"enabled":true,"timeoutSeconds":60})); }
                this.save_resources(before.clone(), resources, cx); cx.notify();
            })));
        }
        root=root.child(self.field(&self.resource_new_key("new-skill-name"),"New skill name","","skill-name",window,cx))
            .child(self.field(&self.resource_new_key("new-skill-description"),"Description","","When should the agent use it?",window,cx))
            .child(self.text_field(&self.resource_new_key("new-skill-content"),"Instructions","","Skill instructions",window,cx))
            .child(Button::new("add-skill").label("Add skill").on_click(cx.listener(move|this,_,_,cx|{let mut resources=resources.clone();if resources.get("skills").is_none(){resources["skills"]=json!([]);}let skill=json!({"name":this.value(&this.resource_new_key("new-skill-name"),cx),"description":this.value(&this.resource_new_key("new-skill-description"),cx),"content":this.text_value(&this.resource_new_key("new-skill-content"),cx),"enabled":true});if let Some(skills)=resources["skills"].as_array_mut(){skills.push(skill);}this.save_resources(before.clone(), resources, cx);cx.notify();})));
        root.into_any_element()
    }
}

fn mapping_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| value.as_str().map(|value| format!("{key}={value}")))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
fn parse_mapping(text: &str, headers: bool) -> anyhow::Result<Value> {
    fn environment_name(name: &str) -> bool {
        let mut bytes = name.bytes();
        bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    }
    let mut map = serde_json::Map::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("Use variable=runtime variable for each mapping"))?;
        let key = key.trim();
        let value = value.trim();
        let valid_key = if headers {
            !key.is_empty()
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        } else {
            environment_name(key)
        };
        anyhow::ensure!(
            valid_key && environment_name(value),
            "Invalid environment or header mapping: {key}"
        );
        anyhow::ensure!(!map.contains_key(key), "Duplicate mapping: {key}");
        map.insert(key.to_owned(), json!(value));
    }
    Ok(Value::Object(map))
}

#[cfg(test)]
mod tests {
    use super::{mapping_text, parse_mapping};
    use core::prelude::v1::test;
    use serde_json::json;
    #[test]
    fn resource_mappings_validate_names_and_reject_duplicates() {
        let value = parse_mapping("TOKEN=RUNTIME_TOKEN\n HOME = REMOTE_HOME", false).unwrap();
        assert_eq!(value, json!({"TOKEN":"RUNTIME_TOKEN","HOME":"REMOTE_HOME"}));
        assert_eq!(
            parse_mapping(&mapping_text(Some(&value)), false).unwrap(),
            value
        );
        assert!(parse_mapping("TOKEN=A\nTOKEN=B", false).is_err());
        assert!(parse_mapping("TOKEN=raw secret", false).is_err());
        assert!(parse_mapping("X-Api-Key=KEY", true).is_ok());
        assert!(parse_mapping("X-Api-Key=KEY", false).is_err());
    }
}

fn resource_value(settings: &Value, agent_id: Option<&str>) -> Value {
    let target = agent_id.and_then(|id| {
        settings
            .get("agents")
            .and_then(Value::as_array)
            .and_then(|agents| {
                agents
                    .iter()
                    .find(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
            })
    });
    (if agent_id.is_some() {
        target.and_then(|agent| agent.get("resources"))
    } else {
        settings.get("resources")
    })
    .cloned()
    .unwrap_or(json!({"mcpServers":[],"skills":[]}))
}
fn resource_after(
    before: &Value,
    agent_id: Option<&str>,
    resources: &Value,
    response: Option<&Value>,
) -> anyhow::Result<Value> {
    let mut after = before.clone();
    if let Some(id) = agent_id {
        if after.get("agents").is_none() {
            after["agents"] = json!([]);
        }
        let agents = after["agents"]
            .as_array_mut()
            .ok_or_else(|| anyhow::anyhow!("Invalid agent configuration list"))?;
        let index = if let Some(index) = agents
            .iter()
            .position(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
        {
            index
        } else {
            let inherited = response
                .and_then(|response| response.pointer("/inherited/agents"))
                .and_then(Value::as_array)
                .and_then(|agents| {
                    agents
                        .iter()
                        .find(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
                })
                .cloned()
                .ok_or_else(|| {
                    anyhow::anyhow!("Reload this scope to choose an available agent configuration")
                })?;
            agents.push(inherited);
            agents.len() - 1
        };
        agents[index]["resources"] = resources.clone();
    } else {
        after["resources"] = resources.clone();
    }
    Ok(after)
}

#[cfg(test)]
mod named_resource_tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn named_resource_changes_preserve_general_resources_and_launch_settings() {
        let before = json!({"resources":{"skills":[{"name":"shared"}]},"agents":[{"id":"a","name":"A","env":{"TOKEN":"preserved"},"resources":{"skills":[{"name":"old"}]}},{"id":"b","name":"B"}],"taskDefaults":{"execution":"main"}});
        let resources = json!({"skills":[{"name":"new"}],"mcpServers":[]});
        let after = resource_after(&before, Some("a"), &resources, None).unwrap();
        assert_eq!(after["resources"], before["resources"]);
        assert_eq!(after["agents"][0]["env"], before["agents"][0]["env"]);
        assert_eq!(after["agents"][1], before["agents"][1]);
        assert_eq!(after["taskDefaults"], before["taskDefaults"]);
        assert_eq!(resource_value(&after, Some("a")), resources);
        assert_eq!(
            resource_after(&before, None, &resources, None).unwrap()["agents"],
            before["agents"]
        );
    }
    #[test]
    fn inherited_named_resources_create_only_the_selected_scope_override() {
        let before = json!({"agents":[],"resources":{"skills":[]}});
        let response = json!({"inherited":{"agents":[{"id":"a","provider":"codex","model":"frozen","env":{"KEEP":"yes"},"resources":{"skills":[{"name":"inherited"}]}}]}});
        let resources = json!({"skills":[{"name":"local"}]});
        let after = resource_after(&before, Some("a"), &resources, Some(&response)).unwrap();
        assert_eq!(after["agents"][0]["model"], "frozen");
        assert_eq!(after["agents"][0]["env"]["KEEP"], "yes");
        assert_eq!(after["agents"][0]["resources"], resources);
        assert!(resource_after(&before, Some("removed"), &resources, Some(&response)).is_err());
    }
}
