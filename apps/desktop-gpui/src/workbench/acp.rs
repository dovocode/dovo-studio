use super::*;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Installation {
    id: String,
    registry_id: String,
    name: String,
    version: String,
    distribution: String,
    installed_at: String,
    #[serde(default)]
    needs_repair: bool,
}
#[derive(Clone, Deserialize)]
struct RegistryEntry {
    id: String,
    name: String,
    version: String,
    description: String,
    distribution: String,
    available: bool,
}
#[derive(Deserialize)]
struct RegistryResult {
    version: String,
    agents: Vec<RegistryEntry>,
}
#[derive(Deserialize)]
struct InstallationList {
    installations: Vec<Installation>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Inspection {
    auth_methods: Vec<AuthMethod>,
    can_logout: bool,
    authentication: Option<AuthProgress>,
    terminal: Option<crate::model::Terminal>,
}
#[derive(Clone, Deserialize)]
struct AuthMethod {
    id: String,
    name: String,
    description: Option<String>,
    #[serde(rename = "type")]
    kind: AuthKind,
}
#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum AuthKind {
    Agent,
    Terminal,
}
#[derive(Clone, Deserialize)]
struct AuthProgress {
    status: AuthStatus,
    output: String,
    urls: Vec<String>,
    error: Option<String>,
}
#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum AuthStatus {
    Waiting,
    Completed,
    Failed,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sessions {
    sessions: Vec<Session>,
    next_cursor: Option<String>,
    can_delete: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    session_id: String,
    cwd: String,
    title: Option<String>,
    updated_at: Option<String>,
}
#[derive(Clone, PartialEq, Eq)]
struct Selection {
    id: String,
    installed_at: String,
}
impl From<&Installation> for Selection {
    fn from(item: &Installation) -> Self {
        Self {
            id: item.id.clone(),
            installed_at: item.installed_at.clone(),
        }
    }
}
#[derive(Clone)]
enum Operation {
    List,
    Registry,
    Inspect(Selection),
    Sessions(Selection, Option<String>),
    Install,
    Remove(String),
    Action(Selection, String),
    Probe(Selection),
}
impl Operation {
    fn lane(&self) -> &'static str {
        match self {
            Self::List => "list",
            Self::Registry => "registry",
            Self::Inspect(_) => "inspect",
            Self::Sessions(_, _) => "sessions",
            _ => "action",
        }
    }
    fn selection(&self) -> Option<&Selection> {
        match self {
            Self::Inspect(s) | Self::Sessions(s, _) | Self::Action(s, _) | Self::Probe(s) => {
                Some(s)
            }
            _ => None,
        }
    }
}
#[derive(Default)]
pub(super) struct AcpState {
    pub(super) installations: Vec<Installation>,
    entries: Vec<RegistryEntry>,
    registry_version: String,
    selected: Option<Selection>,
    inspection: Option<Inspection>,
    sessions: Option<Sessions>,
    requests: HashMap<String, Operation>,
    lanes: HashMap<&'static str, String>,
    error: Option<String>,
    notice: Option<String>,
    last_inspect: Option<std::time::Instant>,
}
impl AcpState {
    fn busy(&self) -> bool {
        self.lanes.contains_key("action")
    }
    fn select(&mut self, selected: Selection) {
        if self.selected.as_ref() == Some(&selected) {
            return;
        }
        self.selected = Some(selected);
        self.inspection = None;
        self.sessions = None;
        self.last_inspect = None;
        self.error = None;
        self.notice = None;
        self.lanes.remove("inspect");
        self.lanes.remove("sessions");
    }
    fn take_current(&mut self, key: &str) -> Option<Operation> {
        let operation = self.requests.remove(key)?;
        if self.lanes.get(operation.lane()).map(String::as_str) != Some(key) {
            return None;
        }
        self.lanes.remove(operation.lane());
        if operation
            .selection()
            .is_some_and(|selected| self.selected.as_ref() != Some(selected))
        {
            return None;
        }
        Some(operation)
    }
    fn merge_sessions(&mut self, page: Sessions, cursor: Option<String>) -> anyhow::Result<()> {
        if let Some(cursor) = cursor {
            let current = self
                .sessions
                .as_mut()
                .ok_or_else(|| anyhow::anyhow!("Session list changed; reload it"))?;
            anyhow::ensure!(
                current.next_cursor.as_ref() == Some(&cursor),
                "Session cursor changed; reload the list"
            );
            for session in page.sessions {
                if let Some(index) = current
                    .sessions
                    .iter()
                    .position(|s| s.session_id == session.session_id)
                {
                    current.sessions[index] = session;
                } else {
                    current.sessions.push(session);
                }
            }
            current.next_cursor = page.next_cursor;
            current.can_delete = page.can_delete;
        } else {
            self.sessions = Some(page);
        }
        Ok(())
    }
}
impl Workbench {
    fn acp_request(&mut self, operation: Operation, path: &str, input: Value) {
        let lane = operation.lane();
        if !self.online || self.acp.lanes.contains_key(lane) {
            return;
        }
        if lane == "action" {
            for read in ["list", "inspect", "sessions"] {
                self.acp.lanes.remove(read);
            }
        }
        let key = format!("acp:{lane}:{}", uuid::Uuid::new_v4());
        self.acp.lanes.insert(lane, key.clone());
        self.acp.requests.insert(key.clone(), operation);
        self.acp.error = None;
        self.request(key, path, input);
    }
    pub(super) fn refresh_acp(&mut self, registry: bool) {
        self.acp_request(Operation::List, "/api/agents/acp/list", json!({}));
        if registry {
            self.acp_request(Operation::Registry, "/api/agents/acp/registry", json!({}));
        }
    }
    pub(super) fn inspect_acp(&mut self) {
        if let Some(selected) = self.acp.selected.clone() {
            self.acp.last_inspect = Some(std::time::Instant::now());
            self.acp_request(
                Operation::Inspect(selected.clone()),
                "/api/agents/acp/inspect",
                json!({"id":selected.id}),
            );
        }
    }
    pub(super) fn poll_acp(&mut self) {
        let waiting = self.acp.inspection.as_ref().is_some_and(|i| {
            i.authentication
                .as_ref()
                .is_some_and(|a| a.status == AuthStatus::Waiting)
                || i.terminal.is_some()
        });
        if !self.acp.busy()
            && waiting
            && self
                .acp
                .last_inspect
                .is_none_or(|t| t.elapsed().as_secs() >= 2)
        {
            self.inspect_acp();
        }
    }
    fn select_acp(&mut self, item: Installation) {
        if self.page == Page::Acp {
            self.command(Command::DetachTerminals);
            self.selected_terminal = None;
        }
        self.acp.select(Selection::from(&item));
        self.inspect_acp();
    }
    fn acp_action(&mut self, action: &str, mut input: Value) {
        if let Some(selected) = self.acp.selected.clone() {
            input["id"] = json!(selected.id);
            self.acp_request(
                Operation::Action(selected, action.into()),
                &format!("/api/agents/acp/{action}"),
                input,
            );
        }
    }
    fn acp_sessions(&mut self, cursor: Option<String>) {
        if let Some(selected) = self.acp.selected.clone() {
            let mut input = json!({"id":selected.id});
            if let Some(cursor) = &cursor {
                input["cursor"] = json!(cursor);
            }
            self.acp_request(
                Operation::Sessions(selected, cursor),
                "/api/agents/acp/sessions",
                input,
            );
        }
    }
    pub(super) fn receive_acp(
        &mut self,
        key: &str,
        result: Result<Value, String>,
        cx: &mut Context<Self>,
    ) {
        let Some(operation) = self.acp.take_current(key) else {
            return;
        };
        let result = result
            .map_err(anyhow::Error::msg)
            .and_then(|value| -> anyhow::Result<()> {
                match operation {
                    Operation::List => {
                        let list: InstallationList = serde_json::from_value(value)?;
                        self.acp.installations = list.installations;
                        if let Some(selected) = self.acp.selected.clone() {
                            let next = self
                                .acp
                                .installations
                                .iter()
                                .find(|i| i.id == selected.id)
                                .cloned();
                            if let Some(next) = next {
                                if Selection::from(&next) != selected {
                                    self.select_acp(next);
                                }
                            } else {
                                self.acp.selected = None;
                                self.acp.inspection = None;
                                self.acp.sessions = None;
                                if self.page == Page::Acp {
                                    self.command(Command::DetachTerminals);
                                    self.selected_terminal = None;
                                }
                            }
                        }
                    }
                    Operation::Registry => {
                        let registry: RegistryResult = serde_json::from_value(value)?;
                        self.acp.entries = registry.agents;
                        self.acp.registry_version = registry.version;
                    }
                    Operation::Inspect(_) => {
                        let inspection: Inspection = serde_json::from_value(value)?;
                        if self.page == Page::Acp {
                            let terminal = inspection.terminal.as_ref().map(|t| t.id.clone());
                            if terminal != self.selected_terminal {
                                self.command(Command::DetachTerminals);
                                self.selected_terminal = terminal.clone();
                                if let Some(id) = terminal {
                                    self.command(Command::OpenTerminal(id));
                                }
                            }
                        }
                        self.acp.inspection = Some(inspection);
                    }
                    Operation::Sessions(_, cursor) => self
                        .acp
                        .merge_sessions(serde_json::from_value(value)?, cursor)?,
                    Operation::Install => {
                        let installation: Installation = serde_json::from_value(value)?;
                        if let Some(index) = self
                            .acp
                            .installations
                            .iter()
                            .position(|i| i.id == installation.id)
                        {
                            self.acp.installations[index] = installation.clone();
                        } else {
                            self.acp.installations.push(installation.clone());
                        }
                        self.select_acp(installation);
                        self.acp.notice = Some("Installation ready on this computer".into());
                        self.refresh_acp(false);
                    }
                    Operation::Remove(id) => {
                        anyhow::ensure!(
                            value.get("ok") == Some(&json!(true)),
                            "Removal was not confirmed"
                        );
                        self.acp.installations.retain(|i| i.id != id);
                        self.acp.selected = None;
                        self.acp.inspection = None;
                        self.acp.sessions = None;
                        self.acp.notice = Some("Installation removed".into());
                        self.refresh_acp(false);
                    }
                    Operation::Action(selection, action) => {
                        anyhow::ensure!(
                            value.get("ok") == Some(&json!(true)),
                            "Operation was not confirmed"
                        );
                        self.acp.notice = Some(
                            "Request completed. Check sign-in status and connection below.".into(),
                        );
                        if action.starts_with("authenticate/") {
                            self.inputs.remove(&format!(
                                "acp-callback:{}:{}",
                                selection.id, selection.installed_at
                            ));
                        }
                        self.acp.lanes.remove("sessions");
                        if action == "sessions/delete" {
                            self.acp.sessions = None;
                            self.acp_sessions(None);
                        }
                        self.acp.lanes.remove("inspect");
                        self.inspect_acp();
                    }
                    Operation::Probe(_) => {
                        let catalog: super::harness::ModelCatalog = serde_json::from_value(value)?;
                        self.acp.notice = Some(format!(
                            "Connection check succeeded · {} model choices",
                            catalog.models.len()
                        ));
                    }
                }
                Ok(())
            });
        if let Err(error) = result {
            self.acp.error = Some(error.to_string());
        }
        cx.notify();
    }
    fn confirm_acp(
        &mut self,
        action: &'static str,
        input: Value,
        message: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let generation = self.generation;
        let selection = self.acp.selected.clone();
        let prompt = window.prompt(
            PromptLevel::Warning,
            message,
            Some("This affects the selected installation on the runtime computer."),
            &["Cancel", "Continue"],
            cx,
        );
        cx.spawn(async move |this, cx| {
            if prompt.await == Ok(1) {
                let _ = this.update(cx, |this, cx| {
                    if this.generation != generation
                        || this.acp.selected != selection
                        || this.acp.busy()
                    {
                        return;
                    }
                    if action == "remove" {
                        if let Some(selected) = selection {
                            this.acp_request(
                                Operation::Remove(selected.id.clone()),
                                "/api/agents/acp/remove",
                                json!({"id":selected.id}),
                            );
                        }
                    } else {
                        this.acp_action(action, input);
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }
    pub(super) fn acp_installation_choices(
        &mut self,
        prefix: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut root = div().flex().flex_col().gap_2();
        let mut choices = div().flex().flex_wrap().gap_2();
        for (id, label) in std::iter::once((String::new(), "Custom ACP command".to_owned())).chain(
            self.acp
                .installations
                .iter()
                .map(|i| (i.id.clone(), format!("{} · {}", i.name, i.version))),
        ) {
            let prefix = prefix.to_owned();
            let selected = self.value(&format!("{prefix}:acpInstallationId"), cx) == id;
            choices = choices.child(
                Button::new(SharedString::from(format!("{prefix}:acp-choice:{id}")))
                    .label(label)
                    .selected(selected)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if this.value(&format!("{prefix}:acpInstallationId"), cx) == id {
                            return;
                        }
                        for (field, value) in [
                            ("acpInstallationId", id.clone()),
                            ("model", String::new()),
                            ("reasoning", String::new()),
                            ("acpMode", String::new()),
                            ("acpConfig", String::new()),
                        ] {
                            let key = format!("{prefix}:{field}");
                            if let Some(input) = this.inputs.get(&key) {
                                input.update(cx, |state, cx| {
                                    state.set_value(value.clone(), window, cx)
                                });
                            }
                            if let Some(input) = this.textareas.get(&key) {
                                input.update(cx, |state, cx| {
                                    state.set_value(value.clone(), window, cx)
                                });
                            }
                        }
                        this.responses.remove(&format!("harness-models:{prefix}"));
                        cx.notify();
                    })),
            );
        }
        root = root.child(choices).child(
            Button::new(SharedString::from(format!("{prefix}:acp-manage")))
                .label("Install and manage ACP agents…")
                .on_click(cx.listener(|this, _, _, cx| this.navigate(Page::Acp, cx))),
        );
        root.into_any_element()
    }
    pub(super) fn acp_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let busy = !self.online || self.acp.busy();
        let mut root=div().id("acp-page").flex().flex_col().flex_1().overflow_y_scroll().p_6().gap_3()
            .child(Self::header("ACP agents","Install agents on this computer, then choose an installation in an agent configuration."))
            .child(Button::new("acp-refresh").label("Refresh installed agents and registry").disabled(busy).on_click(cx.listener(|this,_,_,cx|{this.refresh_acp(true);this.inspect_acp();cx.notify();})));
        for item in self.acp.installations.clone() {
            let selected = self.acp.selected.as_ref() == Some(&Selection::from(&item));
            root = root.child(
                Button::new(SharedString::from(format!("acp-manage-{}", item.id)))
                    .label(format!(
                        "{} · {} · {}{}",
                        item.name,
                        item.version,
                        item.distribution,
                        if item.needs_repair {
                            " · needs repair"
                        } else {
                            ""
                        }
                    ))
                    .selected(selected)
                    .disabled(busy)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.select_acp(item.clone());
                        cx.notify();
                    })),
            );
        }
        if let Some(item) = self
            .acp
            .selected
            .as_ref()
            .and_then(|s| self.acp.installations.iter().find(|i| i.id == s.id))
            .cloned()
        {
            let registry = item.registry_id.clone();
            let locked = self.acp.inspection.as_ref().is_some_and(|i| {
                i.terminal.is_some()
                    || i.authentication
                        .as_ref()
                        .is_some_and(|a| a.status == AuthStatus::Waiting)
            });
            let actions = div()
                .flex()
                .flex_wrap()
                .gap_2()
                .child(
                    Button::new("acp-repair")
                        .label(if item.needs_repair {
                            "Repair installation"
                        } else {
                            "Check installation & updates"
                        })
                        .disabled(busy || locked)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.acp_request(
                                Operation::Install,
                                "/api/agents/acp/install",
                                json!({"registryId":registry}),
                            );
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("acp-remove")
                        .label("Remove installation…")
                        .disabled(busy || locked)
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.confirm_acp(
                                "remove",
                                json!({}),
                                "Remove this ACP installation?",
                                window,
                                cx,
                            )
                        })),
                );
            root = root.child(actions);
            if !item.needs_repair {
                root = root.child(self.acp_authentication(&item, window, cx));
            }
        }
        let search = self.input("acp-search", "", "Search registry agents…", window, cx);
        let query = self.value("acp-search", cx).to_lowercase();
        root = root
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(format!("Registry · {}", self.acp.registry_version)),
            )
            .child(Input::new(&search));
        if self.acp.lanes.contains_key("registry") {
            root = root.child("Loading registry…");
        }
        for entry in self.acp.entries.clone().into_iter().filter(|e| {
            format!("{} {} {}", e.id, e.name, e.description)
                .to_lowercase()
                .contains(&query)
        }) {
            let installed = self
                .acp
                .installations
                .iter()
                .any(|i| i.registry_id == entry.id);
            let id = entry.id.clone();
            root = root.child(
                div()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(format!(
                        "{} · {} · {}",
                        entry.name, entry.version, entry.distribution
                    ))
                    .child(entry.description)
                    .child(
                        Button::new(SharedString::from(format!("acp-install-{id}")))
                            .label(if installed {
                                "Check updates"
                            } else if entry.available {
                                "Install"
                            } else {
                                "Unavailable on this computer"
                            })
                            .disabled(busy || !entry.available)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.acp_request(
                                    Operation::Install,
                                    "/api/agents/acp/install",
                                    json!({"registryId":id}),
                                );
                                cx.notify();
                            })),
                    ),
            );
        }
        if let Some(notice) = &self.acp.notice {
            root = root.child(notice.clone());
        }
        if let Some(error) = &self.acp.error {
            root = root.child(div().text_color(cx.theme().danger).child(error.clone()));
        }
        root.into_any_element()
    }
    fn acp_authentication(
        &mut self,
        item: &Installation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let busy = !self.online || self.acp.busy();
        let mut root = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_3()
            .border_1()
            .border_color(cx.theme().border)
            .child(div().font_weight(FontWeight::SEMIBOLD).child("Sign-in"))
            .child(
                Button::new("acp-inspect")
                    .label("Refresh sign-in status")
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.inspect_acp();
                        cx.notify();
                    })),
            );
        if let Some(inspection) = self.acp.inspection.clone() {
            let waiting = inspection
                .authentication
                .as_ref()
                .is_some_and(|a| a.status == AuthStatus::Waiting);
            if let Some(auth) = inspection.authentication {
                root = root.child(match auth.status {
                    AuthStatus::Waiting => "Waiting for sign-in…".to_owned(),
                    AuthStatus::Completed => {
                        "Sign-in completed. Check the connection to verify access.".to_owned()
                    }
                    AuthStatus::Failed => auth.error.unwrap_or_else(|| "Sign-in failed".into()),
                });
                let callback = auth.urls.iter().any(|u| {
                    url::Url::parse(u)
                        .is_ok_and(|u| u.query_pairs().any(|(k, _)| k == "redirect_uri"))
                });
                for (index, link) in auth.urls.iter().enumerate() {
                    if let Ok(parsed) = url::Url::parse(link)
                        && matches!(parsed.scheme(), "http" | "https")
                    {
                        let link = link.clone();
                        root = root.child(
                            Button::new(SharedString::from(format!("acp-auth-url-{index}")))
                                .label(format!(
                                    "Open sign-in · {}",
                                    parsed.host_str().unwrap_or("browser")
                                ))
                                .on_click(cx.listener(move |_, _, _, cx| cx.open_url(&link))),
                        );
                    }
                }
                if !auth.output.is_empty() {
                    root = root.child(div().font_family("monospace").child(auth.output));
                }
                if waiting {
                    root = root.child(
                        Button::new("acp-auth-cancel")
                            .label("Cancel sign-in")
                            .disabled(busy)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.acp_action("authenticate/cancel", json!({}));
                                cx.notify();
                            })),
                    );
                    if callback {
                        let key = format!("acp-callback:{}:{}", item.id, item.installed_at);
                        let input = self.input(
                            &key,
                            "",
                            "Paste the full localhost browser callback address",
                            window,
                            cx,
                        );
                        let empty = self.value(&key, cx).trim().is_empty();
                        root=root.child("For a remote computer, paste the full browser callback address if localhost is unreachable.").child(Input::new(&input).disabled(busy))
                            .child(Button::new("acp-auth-callback").label("Complete remote sign-in").disabled(busy||empty).on_click(cx.listener(move|this,_,_,cx|{let url=this.value(&key,cx);this.acp_action("authenticate/callback",json!({"url":url.trim()}));cx.notify();})));
                    }
                }
            }
            for method in inspection.auth_methods {
                let id = method.id;
                root=root.child(div().child(format!("{}{}",method.name,method.description.map(|d|format!(" · {d}")).unwrap_or_default()))
                    .child(Button::new(SharedString::from(format!("acp-auth-{id}"))).label(if method.kind==AuthKind::Terminal{"Open sign-in terminal"}else{"Sign in"}).disabled(busy||waiting||inspection.terminal.is_some()).on_click(cx.listener(move|this,_,_,cx|{this.acp_action("authenticate",json!({"methodId":id,"background":method.kind!=AuthKind::Terminal}));cx.notify();}))));
            }
            if inspection.can_logout {
                root = root.child(
                    Button::new("acp-logout")
                        .label("Sign out…")
                        .disabled(busy || waiting || inspection.terminal.is_some())
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.confirm_acp(
                                "logout",
                                json!({}),
                                "Sign out of this agent?",
                                window,
                                cx,
                            )
                        })),
                );
            }
            if let Some(terminal) = inspection.terminal {
                let id = terminal.id;
                root = root
                    .child("Complete sign-in in this terminal, then check the connection.")
                    .child(
                        Button::new("acp-close-terminal")
                            .label("Stop sign-in terminal")
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(selected) = this.acp.selected.clone() {
                                    this.acp_request(
                                        Operation::Action(selected, "terminal-close".into()),
                                        "/api/terminals/close",
                                        json!({"id":id}),
                                    );
                                }
                                cx.notify();
                            })),
                    )
                    .child(div().h(px(300.)).child(self.native_terminal(window, cx)));
            }
        } else {
            root = root.child("Checking available sign-in methods…");
        }
        let id = item.id.clone();
        root=root.child(Button::new("acp-probe").label("Check connection").disabled(busy||self.selected_terminal.is_some()).on_click(cx.listener(move|this,_,_,cx|{if let Some(selected)=this.acp.selected.clone(){this.acp_request(Operation::Probe(selected),"/api/agents/models",json!({"provider":"acp","endpoint":"","model":"","acpInstallationId":id}));}cx.notify();})))
            .child(div().font_weight(FontWeight::SEMIBOLD).child("Saved agent sessions"))
            .child(Button::new("acp-sessions").label("Load / refresh sessions").disabled(busy||self.acp.lanes.contains_key("sessions")).on_click(cx.listener(|this,_,_,cx|{this.acp_sessions(None);cx.notify();})));
        if let Some(sessions) = self.acp.sessions.clone() {
            if sessions.sessions.is_empty() {
                root = root.child("No saved sessions");
            }
            for session in sessions.sessions {
                let id = session.session_id;
                let mut row = div().p_2().child(format!(
                    "{} · {}{}",
                    session.title.unwrap_or_else(|| id.clone()),
                    session.cwd,
                    session
                        .updated_at
                        .map(|d| format!(" · {d}"))
                        .unwrap_or_default()
                ));
                if sessions.can_delete {
                    row = row.child(
                        Button::new(SharedString::from(format!("acp-delete-{id}")))
                            .label("Delete session…")
                            .disabled(busy || self.acp.lanes.contains_key("sessions"))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.confirm_acp(
                                    "sessions/delete",
                                    json!({"sessionId":id}),
                                    "Delete this saved session and its context?",
                                    window,
                                    cx,
                                )
                            })),
                    );
                }
                root = root.child(row);
            }
            if let Some(cursor) = sessions.next_cursor {
                root = root.child(
                    Button::new("acp-more-sessions")
                        .label("Load more sessions")
                        .disabled(busy || self.acp.lanes.contains_key("sessions"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.acp_sessions(Some(cursor.clone()));
                            cx.notify();
                        })),
                );
            }
        }
        root.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    fn selected(id: &str) -> Selection {
        Selection {
            id: id.into(),
            installed_at: "v1".into(),
        }
    }
    #[test]
    fn inspection_and_session_responses_are_fenced_to_the_installation_version() {
        let mut state = AcpState::default();
        state.select(selected("first"));
        state
            .requests
            .insert("old".into(), Operation::Inspect(selected("first")));
        state.lanes.insert("inspect", "old".into());
        state.select(selected("second"));
        state
            .requests
            .insert("new".into(), Operation::Inspect(selected("second")));
        state.lanes.insert("inspect", "new".into());
        assert!(state.take_current("old").is_none());
        assert_eq!(state.lanes.get("inspect").unwrap(), "new");
        assert!(state.take_current("new").is_some());
        state.requests.insert(
            "sessions".into(),
            Operation::Sessions(selected("second"), None),
        );
        state.lanes.insert("sessions", "sessions".into());
        state.select(Selection {
            id: "second".into(),
            installed_at: "v2".into(),
        });
        assert!(state.take_current("sessions").is_none());
    }
    #[test]
    fn paginated_sessions_deduplicate_and_reject_obsolete_cursors() {
        let mut state = AcpState::default();
        let page = |ids: &[&str], next: Option<&str>| Sessions {
            sessions: ids
                .iter()
                .map(|id| Session {
                    session_id: id.to_string(),
                    cwd: "/tmp".into(),
                    title: None,
                    updated_at: None,
                })
                .collect(),
            next_cursor: next.map(str::to_owned),
            can_delete: true,
        };
        state
            .merge_sessions(page(&["a", "b"], Some("next")), None)
            .unwrap();
        state
            .merge_sessions(page(&["b", "c"], None), Some("next".into()))
            .unwrap();
        assert_eq!(state.sessions.as_ref().unwrap().sessions.len(), 3);
        assert!(
            state
                .merge_sessions(page(&["d"], None), Some("next".into()))
                .is_err()
        );
        assert_eq!(state.sessions.unwrap().sessions.len(), 3);
    }
}
