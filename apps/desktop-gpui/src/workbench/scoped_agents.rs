use super::scm_settings::string;
use super::*;
use crate::model::Agent;

pub(crate) fn effective_agents(response: &Value) -> anyhow::Result<Vec<Agent>> {
    let mut result = Vec::<Agent>::new();
    for list in [
        response.pointer("/inherited/agents"),
        response.pointer("/value/agents"),
    ]
    .into_iter()
    .flatten()
    {
        for value in list
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Invalid agent configurations"))?
        {
            let agent: Agent = serde_json::from_value(value.clone())?;
            if let Some(index) = result.iter().position(|existing| existing.id == agent.id) {
                result[index] = agent;
            } else {
                result.push(agent);
            }
        }
    }
    Ok(result)
}
fn prefix(scope: &str, id: &str) -> String {
    format!("scoped-agent-form:{scope}:{id}")
}
impl Workbench {
    fn agent_scope_key(&self) -> String {
        format!(
            "{}:{}",
            self.agent_scope,
            if matches!(self.agent_scope, "project" | "environment-project") {
                self.selected_repository.as_deref().unwrap_or_default()
            } else {
                ""
            }
        )
    }
    fn agent_scope_input(&self) -> Value {
        let mut input = json!({"scope":self.agent_scope,"includeAgents":true});
        if matches!(self.agent_scope, "project" | "environment-project") {
            input["repositoryId"] = json!(self.selected_repository);
        }
        input
    }
    pub(super) fn read_scoped_agents(&mut self) {
        let key = format!("scoped-agents:{}", self.agent_scope_key());
        if !self.responses.contains_key(&key) {
            self.request(key, "/api/agents/settings/read", self.agent_scope_input());
        }
    }
    pub(super) fn read_task_agents(&mut self) {
        if let Some(repo) = self.selected_repository.clone() {
            self.request(
                format!("task-agents:{repo}"),
                "/api/agents/settings/read",
                json!({"scope":"environment-project","repositoryId":repo,"includeAgents":true}),
            );
        }
    }
    pub(super) fn task_agent_options(&self) -> anyhow::Result<Vec<Agent>> {
        let Some(repo) = &self.selected_repository else {
            return Ok(vec![]);
        };
        self.responses
            .get(&format!("task-agents:{repo}"))
            .map(effective_agents)
            .unwrap_or(Ok(vec![]))
    }
    pub(super) fn receive_scoped_agents(&mut self, key: &str, value: &Value, cx: &App) {
        if let Some(scope) = key.strip_prefix("scoped-agent-save:") {
            self.responses
                .insert(format!("scoped-agents:{scope}"), value.clone());
            if let Some((saved_scope, sent_agent, fields)) = self.agent_submissions.remove(key) {
                let id = sent_agent
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let field_prefix = prefix(&saved_scope, id);
                let saved_agent = value
                    .pointer("/value/agents")
                    .and_then(Value::as_array)
                    .and_then(|agents| {
                        agents
                            .iter()
                            .find(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
                    });
                if let Some(agent) = saved_agent {
                    self.scm_editor_baselines
                        .insert(field_prefix.clone(), agent.clone());
                } else {
                    self.scm_editor_baselines.remove(&field_prefix);
                }

                if fields == self.form_fields(&field_prefix, cx) {
                    self.inputs
                        .retain(|key, _| !key.starts_with(&format!("{field_prefix}:")));
                    self.textareas
                        .retain(|key, _| !key.starts_with(&format!("{field_prefix}:")));
                    if self
                        .scoped_agent_editor
                        .as_ref()
                        .is_some_and(|(scope, agent)| {
                            scope == &saved_scope
                                && agent.get("id").and_then(Value::as_str) == Some(id)
                        })
                    {
                        self.scoped_agent_editor = None;
                    }
                } else if let Some(agent) = value
                    .pointer("/value/agents")
                    .and_then(Value::as_array)
                    .and_then(|agents| {
                        agents
                            .iter()
                            .find(|agent| agent.get("id").and_then(Value::as_str) == Some(id))
                    })
                {
                    self.scm_editor_baselines
                        .insert(field_prefix.clone(), agent.clone());
                    if self
                        .scoped_agent_editor
                        .as_ref()
                        .is_some_and(|(scope, agent)| {
                            scope == &saved_scope
                                && agent.get("id").and_then(Value::as_str) == Some(id)
                        })
                    {
                        self.scoped_agent_editor = Some((saved_scope, agent.clone()));
                    }
                }
            }
            self.notice = Some("Agent configurations saved in this scope".into());
            self.read_task_agents();
        }
    }
    fn open_scoped_agent(&mut self, scope: String, agent: Value) {
        let field_prefix = prefix(
            &scope,
            agent.get("id").and_then(Value::as_str).unwrap_or_default(),
        );
        let baseline = self
            .scm_editor_baselines
            .entry(field_prefix)
            .or_insert(agent)
            .clone();
        self.scoped_agent_editor = Some((scope, baseline));
    }
    pub(super) fn agents_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scope = self.agent_scope_key();
        let key = format!("scoped-agents:{scope}");
        let mut root=div().id("agents-page").flex().flex_col().flex_1().overflow_y_scroll().p_6().gap_4()
            .child(Self::header("Agents","Configurations inherit by ID; a more specific scope overrides the same configuration."))
            .child(self.source_reload_button(cx));
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
                        .selected(self.agent_scope == scope)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.agent_scope = scope;
                            this.read_scoped_agents();
                            cx.notify();
                        }))
                }),
            ),
        );
        if matches!(self.agent_scope, "project" | "environment-project") {
            let repos = self
                .snapshot
                .as_ref()
                .map(|s| s.workspace.repositories.clone())
                .unwrap_or_default();
            root = root.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .children(repos.into_iter().map(|repo| {
                        let id = repo.id;
                        Button::new(SharedString::from(format!("agent-repo:{id}")))
                            .label(repo.name)
                            .selected(self.selected_repository.as_ref() == Some(&id))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_repository = Some(id.clone());
                                this.read_scoped_agents();
                                cx.notify();
                            }))
                    })),
            );
        }
        let reload_key = key.clone();
        let reload_scope = scope.clone();
        let reload_input = self.agent_scope_input();
        root=root.child(Button::new("agent-reload").label("Reload configurations…").disabled(!self.online||self.pending.contains(&format!("scoped-agent-save:{scope}"))).on_click(cx.listener(move|this,_,window,cx| {
            let generation=this.generation;let source_epoch=this.source_epoch();let key=reload_key.clone();let scope=reload_scope.clone();let input=reload_input.clone();
            let prompt=window.prompt(PromptLevel::Warning,"Reload configurations?",Some("Discard unsaved agent edits in this scope and load the current configurations."),&["Keep edits","Reload"],cx);
            cx.spawn(async move|this,cx| {if prompt.await==Ok(1) {let _=this.update(cx,|this,cx| {
                if this.generation!=generation||this.source_epoch()!=source_epoch{return;}
                let prefix=format!("scoped-agent-form:{scope}:");
                this.inputs.retain(|key,_|!key.starts_with(&prefix));this.textareas.retain(|key,_|!key.starts_with(&prefix));this.scm_editor_baselines.retain(|key,_|!key.starts_with(&prefix));
                if this.scoped_agent_editor.as_ref().is_some_and(|(editor_scope,_)|editor_scope==&scope){this.scoped_agent_editor=None;}
                this.request(key,"/api/agents/settings/read",input);cx.notify();
            });}}).detach();
        })));
        let Some(response) = self.responses.get(&key).cloned() else {
            return root
                .child("Load this scope to edit its agent configurations.")
                .into_any_element();
        };
        let agents = match effective_agents(&response) {
            Ok(agents) => agents,
            Err(error) => return root.child(error.to_string()).into_any_element(),
        };
        let local = response
            .pointer("/value/agents")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let new_scope = scope.clone();
        root=root.child(Button::new("agent-new").primary().label("New configuration").on_click(cx.listener(move|this,_,_,cx| {
            this.open_scoped_agent(new_scope.clone(),json!({"id":uuid::Uuid::new_v4().to_string(),"name":"","provider":"codex","model":"","instructions":"","permission":"ask","endpoint":""}));cx.notify();
        })));
        for agent in agents {
            let is_local = local
                .iter()
                .any(|value| value.get("id").and_then(Value::as_str) == Some(&agent.id));
            let value = match serde_json::to_value(&agent) {
                Ok(value) => value,
                Err(error) => return root.child(error.to_string()).into_any_element(),
            };
            let edit_scope = scope.clone();
            let id = agent.id.clone();
            root = root.child(
                Button::new(SharedString::from(format!("agent-select:{id}")))
                    .label(format!(
                        "{} · {} · {}",
                        agent.name,
                        agent.provider.name(),
                        if is_local { "This scope" } else { "Inherited" }
                    ))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.open_scoped_agent(edit_scope.clone(), value.clone());
                        cx.notify();
                    })),
            );
        }
        if let Some((editor_scope, agent)) = self.scoped_agent_editor.clone()
            && editor_scope == scope
        {
            root = root.child(self.scoped_agent_form(&scope, &response, agent, window, cx));
        }
        root.into_any_element()
    }
    fn scoped_agent_form(
        &mut self,
        scope: &str,
        response: &Value,
        before: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = string(&before, "id").to_owned();
        let form_prefix = prefix(scope, &id);
        let key = format!("scoped-agent-save:{scope}");
        let mut form = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_md();
        form = form
            .child(self.field(
                &format!("{form_prefix}:name"),
                "Name",
                string(&before, "name"),
                "Configuration name",
                window,
                cx,
            ))
            .child(self.harness_fields(&form_prefix, &before, window, cx));
        if effective_agents(response).is_ok_and(|agents| agents.iter().any(|agent| agent.id == id))
        {
            let resource_id = id.clone();
            form = form.child(
                Button::new("agent-resources")
                    .label("Skills, MCP servers and hooks for this configuration")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.resource_agent = Some(resource_id.clone());
                        this.resource_scope = this.agent_scope;
                        this.navigate(Page::Resources, cx);
                        cx.notify();
                    })),
            );
        }
        let probe_key = format!("scoped-agent-probe:{scope}:{id}");
        let local = response
            .pointer("/value/agents")
            .and_then(Value::as_array)
            .is_some_and(|agents| agents.iter().any(|agent| agent["id"] == before["id"]));
        if effective_agents(response).is_ok_and(|agents| agents.iter().any(|agent| agent.id == id))
        {
            let probe_input = json!({"id":id,"settingsScope":self.agent_scope,"repositoryId":if matches!(self.agent_scope,"project"|"environment-project"){self.selected_repository.clone()}else{None}});
            let key = probe_key.clone();
            form = form.child(
                Button::new("agent-probe")
                    .label("Check installation and login")
                    .disabled(!self.online || self.pending.contains(&probe_key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut input = probe_input.clone();
                        if input["repositoryId"].is_null() {
                            input.as_object_mut().map(|v| v.remove("repositoryId"));
                        }
                        this.request(key.clone(), "/api/agents/probe", input);
                        cx.notify();
                    })),
            );
            if let Some(probe) = self.responses.get(&probe_key) {
                form = form.child(format!(
                    "{} · {}",
                    if probe.get("available").and_then(Value::as_bool) == Some(true) {
                        "Ready"
                    } else {
                        "Unavailable"
                    },
                    string(probe, "detail")
                ));
            }
        }
        let mut input = self.agent_scope_input();
        input["before"] = response["value"].clone();
        input["projectKey"] = response.get("projectKey").cloned().unwrap_or(Value::Null);
        if input["projectKey"].is_null() {
            input.as_object_mut().map(|v| v.remove("projectKey"));
        }
        let save_input = input.clone();
        let save_scope = scope.to_owned();
        let save_before = before.clone();
        let save_prefix = form_prefix.clone();
        let save_key = key.clone();
        form = form.child(
            Button::new("agent-save")
                .primary()
                .label(if local {
                    "Save configuration"
                } else {
                    "Save configuration in this scope"
                })
                .disabled(!self.online || self.pending.contains(&key))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let result = (|| -> anyhow::Result<Value> {
                        let mut agent = this.harness_value(&save_prefix, &save_before, cx)?;
                        agent["name"] = json!(this.value(&format!("{save_prefix}:name"), cx));
                        let checked: Agent = serde_json::from_value(agent.clone())?;
                        anyhow::ensure!(
                            !checked.name.trim().is_empty(),
                            "Enter a configuration name"
                        );
                        Ok(agent)
                    })();
                    match result {
                        Ok(agent) => {
                            let mut input = save_input.clone();
                            let mut agents = input
                                .pointer("/before/agents")
                                .and_then(Value::as_array)
                                .cloned()
                                .unwrap_or_default();
                            if let Some(index) =
                                agents.iter().position(|saved| saved["id"] == agent["id"])
                            {
                                agents[index] = agent.clone();
                            } else {
                                agents.push(agent.clone());
                            }
                            input["after"] = input["before"].clone();
                            input["after"]["agents"] = json!(agents);
                            this.agent_submissions.insert(
                                save_key.clone(),
                                (
                                    save_scope.clone(),
                                    agent,
                                    this.form_fields(&save_prefix, cx),
                                ),
                            );
                            this.request(save_key.clone(), "/api/agents/settings/save", input);
                        }
                        Err(error) => this.error = Some(error.to_string()),
                    }
                    cx.notify();
                })),
        );
        if local {
            let remove_id = id.clone();
            let remove_key = key.clone();
            let remove_scope = scope.to_owned();
            let remove_before = before.clone();
            let remove_prefix = form_prefix.clone();
            let mut remove_input = input;
            let mut agents = remove_input
                .pointer("/before/agents")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            agents.retain(|agent| agent["id"] != remove_id);
            remove_input["after"] = remove_input["before"].clone();
            remove_input["after"]["agents"] = json!(agents);
            form=form.child(Button::new("agent-remove").label("Remove override/configuration…").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,window,cx| {
                let generation=this.generation;let source_epoch=this.source_epoch();let key=remove_key.clone();let input=remove_input.clone();let scope=remove_scope.clone();let before=remove_before.clone();let fields=this.form_fields(&remove_prefix,cx);let prompt=window.prompt(PromptLevel::Warning,"Remove this configuration from this scope?",Some("Existing task sessions are preserved. An inherited configuration with the same ID becomes available again."),&["Keep configuration","Remove"],cx);
                cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{if this.generation==generation&&this.source_epoch()==source_epoch{this.agent_submissions.insert(key.clone(),(scope,before,fields));this.request(key,"/api/agents/settings/save",input);cx.notify();}});}}).detach();
            })));
        }
        form.child(
            Button::new("agent-form-close")
                .label("Close (keep draft)")
                .on_click(cx.listener(|this, _, _, cx| {
                    this.scoped_agent_editor = None;
                    cx.notify();
                })),
        )
        .into_any_element()
    }
}
#[cfg(test)]
mod tests {
    use super::effective_agents;
    use serde_json::json;
    #[test]
    fn more_specific_agents_replace_by_id_without_losing_inherited_choices() {
        let agent = |id, name| json!({"id":id,"name":name,"provider":"codex","model":"","permission":"ask","instructions":"","endpoint":""});
        let response = json!({"inherited":{"agents":[agent("one","Inherited"),agent("two","Other")]},"value":{"agents":[agent("one","Local"),agent("three","New")]}});
        let agents = effective_agents(&response).unwrap();
        assert_eq!(
            agents
                .iter()
                .map(|agent| (agent.id.as_str(), agent.name.as_str()))
                .collect::<Vec<_>>(),
            vec![("one", "Local"), ("two", "Other"), ("three", "New")]
        );
        assert!(effective_agents(&json!({"value":{"agents":[{"id":"broken"}]}})).is_err());
    }
}
