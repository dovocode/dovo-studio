use super::*;
use gpui_kit::{
    assets::IconName as UiIcon,
    component::{Icon, Sizable},
};

impl Workbench {
    pub(super) fn refresh_fleet(&mut self) {
        if self.pending.contains("fleet") {
            return;
        }
        self.fleet_serial += 1;
        self.pending.insert("fleet".into());
        self.command(Command::ReadFleet {
            generation: self.generation,
            request: self.fleet_serial,
            profiles: self.registry.profiles.clone(),
            sessions: self.servers.session_connections(&self.registry),
        });
    }
    pub(super) fn projects_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.project_editor.is_some() {
            return self.project_settings(window, cx);
        }
        let repositories = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.workspace.repositories.clone())
            .unwrap_or_default();
        let mut root = div()
            .id("projects-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(
                "Projects",
                "Project paths refer to the connected runtime's filesystem.",
            ))
            .child(
                Button::new("add-project")
                    .primary()
                    .label("Add project")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.create_project = !this.create_project;
                        cx.notify();
                    })),
            );
        if self.create_project {
            root = root.child(self.field("project-name", "Name", "", "Project name", window, cx))
                .child(self.field("project-path", "Local path or clone parent directory", "", "/path/on/the/runtime", window, cx))
                .child(self.field("project-github", "GitHub repository (optional)", "", "owner/repository", window, cx))
                .child(Button::new("save-project").primary().label("Add project").disabled(self.pending.contains("create-project")).on_click(cx.listener(|this, _, _, cx| {
                    let name = this.value("project-name", cx); let path = this.value("project-path", cx); let github = this.value("project-github", cx);
                    let input = if github.trim().is_empty() { json!({"source":"local","name":name,"path":path}) } else { json!({"source":"github","name":name,"directory":path,"repository":github}) };
                    this.request("create-project", "/api/scm/repositories/add", input); cx.notify();
                })));
        }
        root.children(repositories.into_iter().map(|repo| {
            let id = repo.id.clone();
            let git = repo.kind.is_none();
            div()
                .p_4()
                .rounded_md()
                .border_1()
                .border_color(cx.theme().border)
                .child(div().font_weight(FontWeight::SEMIBOLD).child(repo.name))
                .child(div().mt_1().text_color(cx.theme().muted_foreground).child(repo.path))
                .child(div().mt_2().child(format!("Branch: {}", repo.branch)))
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .mt_3()
                        .child(
                            Button::new(SharedString::from(format!("new-{id}")))
                                .label("New task")
                                .on_click(cx.listener({
                                    let id = id.clone();
                                    move |this, _, _, cx| {
                                        this.selected_repository = Some(id.clone());
                                        this.page = Page::Tasks;
                                        this.new_task = true;
                                        this.read_task_agents();
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(Button::new(SharedString::from(format!("settings-{id}"))).label("Settings").on_click(cx.listener({let id=id.clone();move|this,_,_,cx|{
                            this.project_editor=Some(id.clone());
                            if !this.responses.contains_key(&format!("project-defaults:{id}")) { this.request(format!("project-defaults:{id}"),"/api/agents/settings/read",json!({"scope":"environment-project","repositoryId":id})); }
                            if git { this.request(format!("project-branches:{id}"),"/api/scm/branches",json!({"repositoryId":id})); }
                            cx.notify();
                        }})))
                        .child(
                            Button::new(SharedString::from(format!("inspect-{id}")))
                                .ghost()
                                .label("Inspect Git").disabled(!git || !self.online)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.selected_repository = Some(id.clone());
                                    this.request(
                                        format!("inspect:{id}"),
                                        "/api/scm/inspect",
                                        json!({"repositoryId":id}),
                                    );
                                    cx.notify();
                                })),
                        ),
                )
        }))
        .into_any_element()
    }

    pub(super) fn automations_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.graph.is_some() {
            return self.automation_editor(window, cx);
        }
        let snapshot = self.snapshot.clone();
        let mut root = div()
            .id("automations-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(
                "Automations",
                "Run workflows and respond to durable review gates.",
            ))
            .child(
                Button::new("new-automation")
                    .primary()
                    .label("New automation")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.create_automation = !this.create_automation;
                        cx.notify();
                    })),
            );
        if self.create_automation {
            root = root
                .child(self.field("automation-name", "Name", "", "Workflow name", window, cx))
                .child(self.text_field(
                    "automation-objective",
                    "Task instructions",
                    "",
                    "What should the agent do?",
                    window,
                    cx,
                ));
            if let Some(snapshot) = &snapshot {
                root = root
                    .child("Project")
                    .children(snapshot.workspace.repositories.iter().map(|repo| {
                        let id = repo.id.clone();
                        Button::new(SharedString::from(format!("automation-repo-{id}")))
                            .label(repo.name.clone())
                            .selected(self.selected_repository.as_ref() == Some(&id))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_repository = Some(id.clone());
                                cx.notify();
                            }))
                    }))
                    .child("Agent")
                    .children(snapshot.workspace.agents.iter().map(|agent| {
                        let id = agent.id.clone();
                        Button::new(SharedString::from(format!("automation-agent-{id}")))
                            .label(agent.name.clone())
                            .selected(self.selected_agent.as_ref() == Some(&id))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_agent = Some(id.clone());
                                cx.notify();
                            }))
                    }));
            }
            root=root.child(Button::new("save-automation").primary().label("Create workflow").on_click(cx.listener(|this,_,_,cx| {
                let name=this.value("automation-name",cx);let objective=this.text_value("automation-objective",cx);
                if name.trim().is_empty() || objective.trim().is_empty() || this.selected_repository.is_none() || this.selected_agent.is_none() {this.error=Some("Choose a name, project, agent and instructions".into());cx.notify();return;}
                let nodes:Vec<_>=[("trigger","Manual start"),("task","Agent task"),("review","Human review")].into_iter().enumerate().map(|(index,(kind,label))| json!({"id":kind,"type":"automation","position":{"x":80,"y":index*160},"data":{"kind":kind,"label":label,"trigger":"manual","schedule":"","timezone":"UTC","objective":if kind=="task" {objective.as_str()} else {""},"agentId":this.selected_agent.as_deref().unwrap_or_default(),"repositoryId":this.selected_repository.as_deref().unwrap_or_default()}})).collect();
                let value=json!({"id":uuid::Uuid::new_v4().to_string(),"name":name,"enabled":false,"nodes":nodes,"edges":[{"id":"start-task","source":"trigger","target":"task"},{"id":"task-review","source":"task","target":"review"}]});
                match WorkspacePatch::create("automations",value) {Ok(patch)=>this.patch("create-automation",patch),Err(error)=>this.error=Some(error.to_string())} cx.notify();
            })));
        }
        if let Some(snapshot) = snapshot {
            for automation in snapshot.workspace.automations.clone() {
                let id = automation.id.clone();
                let edit = automation.clone();
                root = root.child(
                    div()
                        .p_4()
                        .border_1()
                        .border_color(cx.theme().border)
                        .rounded_md()
                        .child(div().text_lg().child(automation.name))
                        .child(
                            div()
                                .flex()
                                .gap_2()
                                .mt_3()
                                .child(
                                    Button::new(SharedString::from(format!("edit-{id}")))
                                        .label("Edit workflow")
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.edit_automation(&edit);
                                            cx.notify();
                                        })),
                                )
                                .child(self.automation_run_button(&id, cx))
                                .child(
                                    Button::new(SharedString::from(format!("enable-{id}")))
                                        .label(if automation.enabled.unwrap_or(false) {
                                            "Disable triggers"
                                        } else {
                                            "Enable triggers"
                                        })
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.patch(
                                                format!("enable:{id}"),
                                                WorkspacePatch::update(
                                                    "automations",
                                                    id.clone(),
                                                    "enabled",
                                                    json!(automation.enabled),
                                                    json!(!automation.enabled.unwrap_or(false)),
                                                ),
                                            );
                                            cx.notify();
                                        })),
                                ),
                        ),
                );
            }
            for flow in &snapshot.workspace.automations {
                root = root.child(self.automation_run_details(flow, &snapshot.runs, window, cx));
            }
        }
        root.into_any_element()
    }

    fn open_fleet_task(
        &mut self,
        address: &str,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if address == self.address {
            if self
                .snapshot
                .as_ref()
                .is_some_and(|s| s.workspace.tasks.iter().any(|task| task.id == id))
            {
                self.select_task(id.to_owned(), window, cx);
            } else {
                self.error =
                    Some("This task is no longer available. Refresh the computer overview.".into());
            }
            return;
        }
        self.switch_server(address, Some(id.to_owned()), cx);
    }

    pub(super) fn computers_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut root = div()
            .id("computers-page")
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(
                "Computers",
                "Your connected workspaces, tasks and trusted devices.",
            ));
        root = root.child(
            div()
                .flex()
                .gap_2()
                .child(
                    Button::new("local-runtime")
                        .small()
                        .h(px(28.))
                        .icon(Icon::new(UiIcon::Laptop).size(px(14.)))
                        .label("Connect local runtime")
                        .disabled(self.pending.contains("local-runtime"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.pending.insert("local-runtime".into());
                            this.command(Command::LocalRuntime);
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("disconnect-runtime")
                        .ghost()
                        .small()
                        .h(px(28.))
                        .label("Disconnect")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.command(Command::Disconnect);
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("read-device-hub-settings")
                        .ghost()
                        .small()
                        .h(px(28.))
                        .icon(Icon::new(UiIcon::Smartphone).size(px(14.)))
                        .label("Device Hub")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.request_method(
                                "device-host-settings",
                                Method::GET,
                                "/api/device-hosts",
                                json!({}),
                            );
                            cx.notify();
                        })),
                ),
        );
        if let Some(settings) = self.responses.get("device-host-settings").cloned() {
            root = root.child(self.device_host_settings(settings, window, cx));
        }
        root = root.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_size(px(15.))
                                .child("Connected computers"),
                        )
                        .child(
                            div()
                                .text_size(px(11.))
                                .text_color(cx.theme().muted_foreground)
                                .child("Live activity across your servers"),
                        ),
                )
                .child(
                    shell::icon_button("fleet-refresh", UiIcon::RefreshCw, "Refresh computers")
                        .disabled(self.pending.contains("fleet"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.refresh_fleet();
                            cx.notify();
                        })),
                ),
        );
        let fleet_search = self.input(
            "fleet-task-search",
            "",
            "Find tasks across computers…",
            window,
            cx,
        );
        let query = self.value("fleet-task-search", cx).to_lowercase();
        root =
            root.child(Input::new(&fleet_search).prefix(Icon::new(UiIcon::Search).size(px(14.))));
        for entry in self.fleet_entries.clone() {
            let current = entry.address == self.address;
            let available = entry.result.is_ok();
            let icon = entry
                .result
                .as_ref()
                .map(|summary| shell::server_icon(&summary.runtime_icon))
                .unwrap_or(UiIcon::Server);
            let name = if current {
                self.server_label()
            } else if entry.name == entry.address {
                servers::address_label(&entry.address)
            } else {
                entry.name.clone()
            };
            let mut card = div()
                .flex()
                .flex_col()
                .gap_3()
                .p_4()
                .border_1()
                .border_color(cx.theme().border)
                .rounded(px(8.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .min_w_0()
                        .child(
                            div()
                                .size(px(32.))
                                .rounded(px(7.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .flex_shrink_0()
                                .bg(cx.theme().muted)
                                .child(
                                    Icon::new(icon)
                                        .size(px(17.))
                                        .text_color(cx.theme().muted_foreground),
                                ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .child(
                                    div()
                                        .truncate()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(name),
                                )
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(11.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(entry.address.clone()),
                                ),
                        )
                        .children(current.then(|| {
                            div()
                                .rounded(px(4.))
                                .px_2()
                                .py(px(3.))
                                .bg(cx.theme().primary.opacity(0.1))
                                .text_size(px(10.))
                                .text_color(cx.theme().primary)
                                .child("Connected")
                        }))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .flex_shrink_0()
                                .text_size(px(11.))
                                .text_color(cx.theme().muted_foreground)
                                .child(div().size(px(5.)).rounded_full().bg(if available {
                                    cx.theme().success
                                } else {
                                    cx.theme().warning
                                }))
                                .child(if available { "Online" } else { "Unavailable" }),
                        ),
                );
            card = match &entry.result {
                Ok(summary) => card.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_4()
                        .py_1()
                        .children(
                            [
                                (summary.projects, "Projects"),
                                (summary.tasks, "Tasks"),
                                (summary.running, "Running"),
                                (summary.review, "In review"),
                                (summary.failed, "Failed"),
                            ]
                            .into_iter()
                            .map(|(count, label)| {
                                div()
                                    .flex()
                                    .items_baseline()
                                    .gap_1()
                                    .child(
                                        div()
                                            .text_size(px(15.))
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(count.to_string()),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.))
                                            .text_color(cx.theme().muted_foreground)
                                            .child(label),
                                    )
                            }),
                        )
                        .children((summary.approvals + summary.questions > 0).then(|| {
                            div()
                                .text_size(px(11.))
                                .text_color(cx.theme().warning)
                                .child(format!(
                                    "{} approvals · {} questions waiting",
                                    summary.approvals, summary.questions
                                ))
                        })),
                ),
                Err(error) => card.child(
                    div()
                        .text_size(px(12.))
                        .text_color(cx.theme().muted_foreground)
                        .child(error.clone()),
                ),
            };
            if let Ok(summary) = &entry.result {
                let matches: Vec<_> = summary
                    .task_entries
                    .iter()
                    .filter(|task| {
                        format!("{} {} {}", task.title, task.project, task.status.label())
                            .to_lowercase()
                            .contains(&query)
                    })
                    .collect();
                let limit = *self.fleet_limits.get(&entry.address).unwrap_or(&5);
                for task in matches.iter().take(limit) {
                    let address = entry.address.clone();
                    let id = task.id.clone();
                    let can_open = address == self.address
                        || self.registry.profiles.iter().any(|p| p.address == address)
                        || self.servers.contains(&address);
                    card = card.child(
                        Button::new(SharedString::from(format!(
                            "fleet-task:{}:{}",
                            entry.id, task.id
                        )))
                        .ghost()
                        .small()
                        .w_full()
                        .h(px(40.))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .w_full()
                                .min_w_0()
                                .child(shell::harness_icon(&task.provider, cx))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .flex()
                                        .flex_col()
                                        .child(
                                            div()
                                                .truncate()
                                                .font_weight(FontWeight::MEDIUM)
                                                .child(task.title.clone()),
                                        )
                                        .child(
                                            div()
                                                .truncate()
                                                .text_size(px(10.))
                                                .text_color(cx.theme().muted_foreground)
                                                .child(task.project.clone()),
                                        ),
                                )
                                .child(
                                    div()
                                        .size(px(4.))
                                        .rounded_full()
                                        .bg(appearance::status_color(task.status, cx)),
                                )
                                .child(
                                    div()
                                        .text_size(px(10.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(task.status.label()),
                                )
                                .child(
                                    Icon::new(UiIcon::ChevronRight)
                                        .size(px(13.))
                                        .text_color(cx.theme().muted_foreground),
                                ),
                        )
                        .disabled(!can_open)
                        .on_click(cx.listener(
                            move |this, _, window, cx| {
                                this.open_fleet_task(&address, &id, window, cx);
                                cx.notify();
                            },
                        )),
                    );
                }
                if matches.len() > limit {
                    let address = entry.address.clone();
                    card = card.child(
                        Button::new(SharedString::from(format!("more-fleet-tasks:{}", entry.id)))
                            .label(format!(
                                "Show more tasks ({} remaining)",
                                matches.len() - limit
                            ))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.fleet_limits.insert(address.clone(), limit + 25);
                                cx.notify();
                            })),
                    );
                }
            }
            root = root.child(card);
        }
        for profile in self.registry.profiles.clone() {
            let active = profile.address == self.address;
            let id = profile.id.clone();
            let forgotten = profile.clone();
            let name_key = format!("server-name-{id}");
            let name = self.input(&name_key, &profile.name, "Server name", window, cx);
            let rename_id = id.clone();
            let changed = self.value(&name_key, cx).trim() != profile.name;
            root = root.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .justify_between()
                    .items_center()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded_md()
                    .child(div().w(px(180.)).child(Input::new(&name)))
                    .child(Button::new(SharedString::from(format!("rename-server-{id}")))
                        .label("Save name").disabled(!changed || self.servers.switching)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut registry = this.registry.clone();
                            match registry.rename_profile(&rename_id, &this.value(&name_key, cx))
                                .and_then(|()| this.storage.write(&registry)) {
                                Ok(()) => { this.registry = registry; this.fleet_updated = None; }
                                Err(error) => this.error = Some(error.to_string()),
                            }
                            cx.notify();
                        })))
                    .child(div().flex_1().min_w_0().truncate().child(profile.address.clone()))
                    .child(
                        Button::new(SharedString::from(format!("connect-{id}")))
                            .label(if active { "Reconnect" } else { "Connect" })
                            .disabled(self.servers.switching)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                match this.storage.connection(&profile) {
                                    Ok(connection) => {
                                        let mut registry = this.registry.clone();
                                        registry.active_id = Some(profile.id.clone());
                                        if let Err(error) = this.storage.write(&registry) {
                                            this.error = Some(error.to_string());
                                        } else {
                                            this.registry = registry;
                                            this.connect_server(connection, None, cx);
                                        }
                                    }
                                    Err(error) => this.error = Some(error.to_string()),
                                }
                                cx.notify();
                            })),
                    )
                    .child(Button::new(SharedString::from(format!("forget-{}",forgotten.id))).ghost().label("Forget credentials")
                        .on_click(cx.listener(move|this,_,_,cx| {
                            let mut registry=this.registry.clone();
                            registry.profiles.retain(|profile|profile.id!=forgotten.id);
                            if registry.active_id.as_deref()==Some(&forgotten.id){registry.active_id=None;}
                            match this.storage.write(&registry) {
                                Ok(())=>{
                                    this.registry=registry;
                                    this.servers.forget(&forgotten.address);
                                    if forgotten.address==this.address {this.command(Command::Disconnect);}
                                    if let Err(error)=this.storage.forget(&forgotten){this.error=Some(format!("Computer removed, but its keychain entry could not be deleted: {error}"));}
                                }
                                Err(error)=>this.error=Some(error.to_string()),
                            }
                            cx.notify();
                        }))),
            );
        }
        root=root.child(Self::header("Pair another computer","Generate a code on that computer, enter its runtime address and approve this device there."))
            .child(self.field("pair-address","Runtime address","","http://computer:8787",window,cx))
            .child(self.field("pair-code","Pairing code","","Eight digits",window,cx))
            .child(self.field("pair-name","This device's name","Dovo Studio GPUI","Device name",window,cx))
            .child(div().flex().gap_2().child(Button::new("pair").primary().label("Pair computer").disabled(self.pairing_pending).on_click(cx.listener(|this,_,_,cx| {this.command(Command::Pair{address:this.value("pair-address",cx),code:this.value("pair-code",cx),name:this.value("pair-name",cx)});cx.notify();})))
                .child(Button::new("check-pairing").label("Check approval / recover pairing").on_click(cx.listener(|this,_,_,cx| {this.command(Command::Claim);cx.notify();})))
                .child(Button::new("cancel-pairing").ghost().label("Cancel pairing").on_click(cx.listener(|this,_,_,cx| {this.command(Command::CancelPairing);cx.notify();}))));
        if let Some(snapshot) = self.snapshot.clone() {
            root = root.child(Self::header(
                "Trusted devices",
                "Only the runtime host can approve or revoke device trust.",
            ));
            if snapshot.owner {
                root = root.child(
                    Button::new("generate-code")
                        .label("Generate pairing code")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.request(
                                "pair-code",
                                "/api/pair/code",
                                json!({"autoApprove":false}),
                            );
                            cx.notify();
                        })),
                );
                if let Some(code) = self
                    .responses
                    .get("pair-code")
                    .and_then(|value| value.get("code"))
                    .and_then(Value::as_str)
                {
                    root = root.child(
                        div()
                            .text_2xl()
                            .font_weight(FontWeight::BOLD)
                            .child(code.to_owned()),
                    );
                }
                for device in snapshot.pending_devices {
                    let id = device.id.clone();
                    root = root.child(
                        div()
                            .flex()
                            .justify_between()
                            .child(format!("{} requests access", device.name))
                            .child(
                                Button::new(SharedString::from(format!("approve-{id}")))
                                    .label("Approve")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.request(
                                            format!("device-approve:{id}"),
                                            "/api/pair/approve",
                                            json!({"id":id,"allow":true}),
                                        );
                                        cx.notify();
                                    })),
                            ),
                    );
                }
            }
            for device in snapshot
                .devices
                .into_iter()
                .filter(|device| device.revoked_at.is_none())
            {
                let id = device.id.clone();
                root = root.child(
                    div().flex().justify_between().child(device.name).child(
                        Button::new(SharedString::from(format!("revoke-{id}")))
                            .label("Revoke")
                            .disabled(!snapshot.owner)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(
                                    format!("device-revoke:{id}"),
                                    "/api/devices/revoke",
                                    json!({"id":id}),
                                );
                                cx.notify();
                            })),
                    ),
                );
            }
        }
        root.into_any_element()
    }

    pub(super) fn settings_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let preferences = self.responses.get("preferences").cloned();
        let mut root = div()
            .id("settings-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(
                "Settings",
                "Computer preferences are shared with its other connected clients.",
            ));
        root = root
            .child(Self::header(
                "Appearance",
                "Saved on this device. System follows your desktop's light or dark setting.",
            ))
            .child(
                div().flex().gap_2().children(
                    [
                        (crate::storage::Appearance::System, "System"),
                        (crate::storage::Appearance::Light, "Light"),
                        (crate::storage::Appearance::Dark, "Dark"),
                    ]
                    .into_iter()
                    .map(|(appearance, label)| {
                        Button::new(label)
                            .label(label)
                            .selected(self.appearance == appearance)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                match this.storage.save_appearance(appearance) {
                                    Ok(()) => {
                                        this.appearance = appearance;
                                        use gpui_kit::component::{Theme, ThemeMode};
                                        match appearance {
                                            crate::storage::Appearance::System => {
                                                Theme::sync_system_appearance(Some(window), cx)
                                            }
                                            crate::storage::Appearance::Light => {
                                                Theme::change(ThemeMode::Light, Some(window), cx)
                                            }
                                            crate::storage::Appearance::Dark => {
                                                Theme::change(ThemeMode::Dark, Some(window), cx)
                                            }
                                        }
                                        super::appearance::apply(cx);
                                    }
                                    Err(error) => this.error = Some(error.to_string()),
                                }
                                cx.notify();
                            }))
                    }),
                ),
            );
        root = root.child(self.browser_profiles_editor(window, cx));
        root = root.child(
            Button::new("reload-preferences")
                .label("Reload settings")
                .on_click(cx.listener(|this, _, _, cx| {
                    this.request("preferences", "/api/runtime/preferences/read", json!({}));
                    cx.notify();
                })),
        );
        let Some(preferences) = preferences else {
            return root
                .child(Self::empty(
                    "Loading settings…",
                    "Connect a computer to edit its preferences.",
                ))
                .into_any_element();
        };
        for (key, label) in [
            ("enableArtifacts", "Enable interactive artifacts"),
            ("enableCodeReviews", "Enable experimental code reviews"),
            ("allowWebRequests", "Always allow web browsing and search"),
            (
                "enablePullRequestWatching",
                "Enable pull request monitoring",
            ),
            ("enablePipelineWatching", "Enable pipeline monitoring"),
            (
                "autoContinueAfterRestart",
                "Continue interrupted tasks after restart",
            ),
            (
                "preventSleepWhileRunning",
                "Keep the computer awake while tasks run",
            ),
            (
                "archiveOnPullMerge",
                "Archive threads after pull requests merge",
            ),
            (
                "settleOnPullClose",
                "Settle threads after pull requests close",
            ),
            ("autoLinkPullRequests", "Link pull requests automatically"),
            ("removeArchivedWorktrees", "Clean up archived worktrees"),
            (
                "removeWorktreesOnThreadDelete",
                "Remove clean worktrees when deleting threads",
            ),
        ] {
            let enabled = preferences
                .get(key)
                .and_then(Value::as_bool)
                .unwrap_or(false);
            root = root.child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(label)
                    .child(
                        Button::new(key)
                            .label(if enabled { "On" } else { "Off" })
                            .selected(enabled)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(
                                    "preferences-save",
                                    "/api/runtime/preferences/save",
                                    json!({key:!enabled}),
                                );
                                cx.notify();
                            })),
                    ),
            );
        }
        root=root.child(self.field("branch-prefix","Task branch prefix",preferences.get("branchPrefix").and_then(Value::as_str).unwrap_or("dovo/"),"dovo/",window,cx))
            .child(self.field("worktrees-root","Worktrees directory",preferences.get("worktreesRoot").and_then(Value::as_str).unwrap_or_default(),"Runtime default",window,cx))
            .child(Button::new("save-settings").primary().label("Save settings").on_click(cx.listener(|this,_,_,cx| {this.request("preferences-save","/api/runtime/preferences/save",json!({"branchPrefix":this.value("branch-prefix",cx),"worktreesRoot":this.value("worktrees-root",cx)}));cx.notify();})));
        for (key, label, choices) in [
            (
                "autoArchiveDays",
                "Archive inactive tasks after",
                vec![0, 7, 14, 30],
            ),
            (
                "activityRetentionDays",
                "Keep activity history for",
                vec![0, 30, 90, 365],
            ),
            (
                "maxActiveChildAgents",
                "Maximum active child agents",
                vec![1, 2, 4, 8, 16],
            ),
        ] {
            let current = preferences
                .get(key)
                .and_then(Value::as_i64)
                .unwrap_or_default();
            root = root
                .child(label)
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .children(choices.into_iter().map(|value| {
                            Button::new(SharedString::from(format!("{key}-{value}")))
                                .label(if value == 0 {
                                    "Off / forever".into()
                                } else if key == "maxActiveChildAgents" {
                                    value.to_string()
                                } else {
                                    format!("{value} days")
                                })
                                .selected(current == value)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.request(
                                        "preferences-save",
                                        "/api/runtime/preferences/save",
                                        json!({key:value}),
                                    );
                                    cx.notify();
                                }))
                        })),
                );
        }
        root.into_any_element()
    }

    pub(super) fn artifacts_page(&mut self, _: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        self.artifact_gallery(None, cx)
    }

    pub(super) fn artifact_gallery(
        &mut self,
        task_id: Option<&str>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let read_key = task_id
            .map(|id| format!("artifact-read:{id}"))
            .unwrap_or_else(|| "artifact-read".into());
        let entries = self
            .responses
            .get("artifact-library")
            .and_then(|value| value.get("artifacts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut root = div()
            .id("artifacts-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_3()
            .gap_3()
            .child(Self::header(
                "Artifacts",
                "Documents and interactive previews created by your agents.",
            ))
            .child(
                Button::new("reload-artifacts")
                    .label("Refresh")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.request("artifact-library", "/api/artifacts/library", json!({}));
                        cx.notify();
                    })),
            );
        for entry in entries.into_iter().filter(|entry| {
            task_id.is_none_or(|task| entry.get("taskId").and_then(Value::as_str) == Some(task))
        }) {
            let key = read_key.clone();
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let task_id = entry
                .get("taskId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            root = root.child(
                Button::new(SharedString::from(format!("artifact-{id}")))
                    .label(
                        entry
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or("Artifact")
                            .to_owned(),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            key.clone(),
                            "/api/artifacts/read",
                            json!({"taskId":task_id,"id":id}),
                        );
                        cx.notify();
                    })),
            );
        }
        if let Some(artifact) = self
            .responses
            .get(&read_key)
            .and_then(|value| value.get("artifact"))
        {
            let content = artifact
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let format = artifact
                .get("format")
                .and_then(Value::as_str)
                .unwrap_or("markdown");
            root = root.child(
                TextView::markdown(
                    "artifact-content",
                    if format == "markdown" {
                        content.to_owned()
                    } else {
                        format!("````\n{content}\n````")
                    },
                )
                .selectable(true),
            );
            if matches!(format, "html" | "svg") {
                let content = content.to_owned();
                let title = artifact
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Artifact")
                    .to_owned();
                root = root.child(
                    Button::new("preview-artifact")
                        .primary()
                        .label("Open interactive preview")
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Err(error) = crate::web_content::open_html(
                                &title,
                                crate::web_content::artifact_html(&content),
                                cx,
                            ) {
                                this.error = Some(error.to_string());
                                cx.notify();
                            }
                        })),
                );
            }
        }
        root.into_any_element()
    }

    pub(super) fn scm_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let reload = self.source_reload_button(cx);
        let content = if self
            .selected_work
            .as_ref()
            .is_some_and(|(page, _, _)| *page == self.page)
        {
            self.work_detail(window, cx)
        } else if self.page == Page::Pulls && self.selected_pull.is_some() {
            self.pull_detail(window, cx)
        } else {
            self.work_list_page(window, cx)
        };
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .child(reload)
            .child(content)
            .into_any_element()
    }

    pub(super) fn search_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let search = self.input(
            "command-search",
            "",
            "Search tasks and commands…",
            window,
            cx,
        );
        let query = search.read(cx).value().to_lowercase();
        let tasks = self
            .snapshot
            .as_ref()
            .map(|snapshot| {
                snapshot
                    .workspace
                    .tasks
                    .iter()
                    .filter(|task| task.title.to_lowercase().contains(&query))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        div()
            .id("search-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_3()
            .child(Self::header(
                "Search",
                "Find a task or navigate to a workspace page.",
            ))
            .child(Input::new(&search))
            .child(
                Button::new("close-search")
                    .ghost()
                    .label("Close search")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.search_open = false;
                        cx.notify();
                    })),
            )
            .children(
                Page::ALL
                    .into_iter()
                    .filter(|page| page.label().to_lowercase().contains(&query))
                    .map(|page| {
                        Button::new(page.label())
                            .label(page.label())
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.search_open = false;
                                this.navigate(page, cx);
                            }))
                    }),
            )
            .children(tasks.into_iter().map(|task| {
                let id = task.id.clone();
                Button::new(SharedString::from(id.clone()))
                    .label(task.title)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.search_open = false;
                        this.select_task(id.clone(), window, cx);
                    }))
            }))
            .into_any_element()
    }
}
