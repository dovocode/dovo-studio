use crate::{
    connection::Connection,
    model::{ChatMessage, Role, Snapshot, Task, TaskStatus, WorkspacePatch},
    service::{Command, Event, Service},
    storage::{Registry, Storage},
};
use gpui_kit::{
    component::{
        ActiveTheme, Disableable, Selectable,
        button::{Button, ButtonVariants},
        diff::{Diff, DiffFile, DiffState},
        input::{Editor, EditorState, Input, InputEvent, InputState, Textarea, TextareaState},
        text::TextView,
    },
    *,
};
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};

mod acp;
mod attachments;
mod automation_editor;
mod automation_runs;
pub(crate) mod browser;
mod child_agents;
mod code;
mod device_hosts;
mod devices;
mod harness;
mod linked_checkouts;
mod mcp;
mod mentions;
mod pages;
pub(crate) mod project_presets;
mod pull_actions;
mod pulls;
mod resource_catalogs;
mod resources;
mod scm_context;
mod scm_lists;
mod scm_settings;
mod scm_work;
pub(crate) mod scoped_agents;
mod scoped_defaults;
mod task_controls;
pub(crate) mod task_defaults;
mod task_review;
mod task_revisions;
mod tasks;
mod terminal;
mod usage;

actions!(dovo, [Quit, SendMessage, NewTask, Search]);

pub fn init(cx: &mut App) {
    mentions::init(cx);
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Page {
    Tasks,
    Artifacts,
    Projects,
    Pulls,
    Issues,
    Pipelines,
    Integrations,
    Agents,
    Acp,
    Automations,
    Settings,
    Defaults,
    Resources,
    Computers,
    Usage,
    Archived,
}
impl Page {
    pub const ALL: [Self; 16] = [
        Self::Tasks,
        Self::Artifacts,
        Self::Projects,
        Self::Pulls,
        Self::Issues,
        Self::Pipelines,
        Self::Integrations,
        Self::Agents,
        Self::Acp,
        Self::Automations,
        Self::Settings,
        Self::Defaults,
        Self::Resources,
        Self::Computers,
        Self::Usage,
        Self::Archived,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::Tasks => "Tasks",
            Self::Artifacts => "Artifacts",
            Self::Projects => "Projects",
            Self::Pulls => "Pull requests",
            Self::Issues => "Issues",
            Self::Pipelines => "Pipelines",
            Self::Integrations => "Source accounts",
            Self::Agents => "Agents",
            Self::Acp => "ACP installations",
            Self::Automations => "Automations",
            Self::Settings => "Settings",
            Self::Defaults => "Task defaults",
            Self::Resources => "Skills & MCP",
            Self::Usage => "Usage",
            Self::Computers => "Computers",
            Self::Archived => "Archived tasks",
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TaskTab {
    Chat,
    Details,
    SideChats,
    Agents,
    Review,
    Devices,
    Changes,
    Terminal,
    Browser,
    Files,
}

pub struct Workbench {
    service: Service,
    storage: Storage,
    appearance: crate::storage::Appearance,
    registry: Registry,
    fleet_serial: u64,
    fleet_limits: HashMap<String, usize>,
    pending_open_task: Option<String>,
    fleet_entries: Vec<crate::fleet::Entry>,
    fleet_updated: Option<std::time::Instant>,
    snapshot: Option<Snapshot>,
    generation: u64,
    address: String,
    online: bool,
    status: String,
    error: Option<String>,
    notice: Option<String>,
    page: Page,
    resource_scope: &'static str,
    resource_agent: Option<String>,
    selected_task: Option<String>,
    selected_repository: Option<String>,
    selected_pull: Option<u64>,
    selected_work: Option<(Page, scm_lists::WorkSource, String)>,
    work_source: Option<scm_lists::WorkSource>,
    work_lists: HashMap<String, scm_lists::WorkList>,
    source_contexts: scm_context::SourceContexts,
    acp: acp::AcpState,
    agent_scope: &'static str,
    catalog_serial: u64,
    catalogs: HashMap<String, resource_catalogs::CatalogState>,
    staged_resources: HashMap<String, (String, Value)>,
    defaults_scope: &'static str,
    defaults_prompts: HashMap<String, Vec<scoped_defaults::Prompt>>,
    scoped_agent_editor: Option<(String, Value)>,
    agent_submissions: HashMap<String, (String, Value, Value)>,
    work_form: Option<(Page, scm_lists::WorkSource)>,
    work_form_submissions: HashMap<String, (Page, scm_lists::WorkSource, Value)>,
    forge_editor: Option<Value>,
    jira_editor: Option<Value>,
    project_editor: Option<String>,
    preset_editor: Option<project_presets::PresetDraft>,
    new_task_template: Option<(String, project_presets::SavedItem)>,
    scm_editor_baselines: HashMap<String, Value>,
    work_task_requests: HashMap<String, uuid::Uuid>,
    work_issue_baselines: HashMap<String, scm_work::Issue>,
    work_issue_rebase: HashSet<String>,
    selected_agent: Option<String>,
    selected_file: Option<String>,
    tab: TaskTab,
    native_thread: Option<child_agents::ThreadDraft>,
    hide_finished_agents: bool,
    task_reviews: HashMap<String, task_review::ReviewState>,
    review_deliveries: HashMap<String, crate::outbox::SavedMessage>,
    inputs: HashMap<String, Entity<InputState>>,
    textareas: HashMap<String, Entity<TextareaState>>,
    editors: HashMap<String, Entity<EditorState>>,
    diffs: HashMap<String, code::CachedDiff>,
    composer: Entity<TextareaState>,
    mentions: mentions::MentionState,
    drafts: BTreeMap<String, String>,
    messages: Vec<ChatMessage>,
    activity: Vec<crate::model::ActivityEvent>,
    activity_expanded: bool,
    history: HashMap<String, Vec<ChatMessage>>,
    history_turns: HashMap<String, Vec<crate::model::Turn>>,
    history_cursor: HashMap<String, Option<String>>,
    list: ListState,
    pending: HashSet<String>,
    attachment_receipts: HashMap<String, String>,
    pending_sends: HashMap<String, (String, String)>,
    pending_text_submissions: HashMap<String, (String, String)>,
    failed_sends: HashSet<String>,
    responses: HashMap<String, Value>,
    new_task: bool,
    create_project: bool,
    create_automation: bool,
    graph: Option<automation_editor::GraphDraft>,
    checkout_drafts: HashMap<String, linked_checkouts::CheckoutDraft>,
    automation_starts: HashMap<String, String>,
    usage_days: u32,
    execution_worktree: Option<bool>,
    question_choices: HashMap<String, BTreeMap<String, Vec<String>>>,
    pairing_pending: bool,
    search_open: bool,
    focus: FocusHandle,
    terminal_focus: FocusHandle,
    terminal_screens: HashMap<String, vt100::Parser>,
    terminal_status: HashMap<String, String>,
    selected_terminal: Option<String>,
    terminal_marked: String,
    terminal_bounds: Option<Bounds<Pixels>>,
    terminal_cell_width: f32,
    terminal_selection: Option<terminal::TerminalSelection>,
    terminal_mouse_cell: Option<(String, u16, u16, Option<u16>)>,
    device_preview: Option<devices::NativeDevice>,
    mcp_windows: HashMap<String, mcp::McpSession>,
    mcp_prompts: Vec<mcp::McpPrompt>,
    browser: browser::BrowserState,
    browser_windows: HashMap<String, WindowHandle<crate::web_content::WebWindow>>,
    _events: gpui_kit::Task<()>,
}

impl Workbench {
    pub fn new(
        storage: Storage,
        initial: Option<Connection>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<Self> {
        let (service, receiver) = Service::new(storage.clone())?;
        let registry = storage.read()?;
        let appearance = storage.appearance()?;
        use gpui_kit::component::{Theme, ThemeMode};
        match appearance {
            crate::storage::Appearance::System => Theme::sync_system_appearance(Some(window), cx),
            crate::storage::Appearance::Light => Theme::change(ThemeMode::Light, Some(window), cx),
            crate::storage::Appearance::Dark => Theme::change(ThemeMode::Dark, Some(window), cx),
        }
        let weak = cx.weak_entity();
        window
            .observe_window_appearance(move |window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    if this.appearance == crate::storage::Appearance::System {
                        Theme::sync_system_appearance(Some(window), cx);
                    }
                });
            })
            .detach();
        let composer = cx.new(|cx| {
            TextareaState::new(window, cx)
                .placeholder("Ask your agent…")
                .auto_grow(3, 10)
        });
        cx.observe(&composer, |_, _, cx| cx.notify()).detach();
        cx.subscribe(&composer, |this, input, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change)
                && let Some(id) = &this.selected_task
            {
                let text = input.read(cx).value().to_string();
                this.drafts.insert(id.clone(), text.clone());
                this.command(Command::SaveDraft {
                    generation: this.generation,
                    id: id.clone(),
                    text,
                });
            }
        })
        .detach();
        let main_window = window.window_handle();
        let events = cx.spawn(async move |this, cx| {
            while let Ok(event) = receiver.recv().await {
                if !cx
                    .update_window(main_window, |_, window, cx| {
                        this.update(cx, |this, cx| this.receive(event, window, cx))
                    })
                    .is_ok_and(|result| result.is_ok())
                {
                    break;
                }
            }
        });
        let mut this = Self {
            service,
            storage,
            appearance,
            registry,
            fleet_serial: 0,
            fleet_limits: HashMap::new(),
            pending_open_task: None,
            fleet_entries: Vec::new(),
            fleet_updated: None,
            snapshot: None,
            generation: 0,
            address: String::new(),
            online: false,
            status: "Choose a computer to connect".into(),
            error: None,
            notice: None,
            page: Page::Tasks,
            resource_scope: "environment",
            resource_agent: None,
            selected_task: None,
            selected_repository: None,
            selected_pull: None,
            selected_work: None,
            work_source: None,
            work_lists: HashMap::new(),
            source_contexts: scm_context::SourceContexts::default(),
            acp: acp::AcpState::default(),
            agent_scope: "environment",
            defaults_scope: "environment",
            defaults_prompts: HashMap::new(),
            catalog_serial: 0,
            catalogs: HashMap::new(),
            staged_resources: HashMap::new(),
            scoped_agent_editor: None,
            agent_submissions: HashMap::new(),
            work_form: None,
            work_form_submissions: HashMap::new(),
            forge_editor: None,
            jira_editor: None,
            project_editor: None,
            preset_editor: None,
            new_task_template: None,
            scm_editor_baselines: HashMap::new(),
            work_task_requests: HashMap::new(),
            work_issue_baselines: HashMap::new(),
            work_issue_rebase: HashSet::new(),
            selected_agent: None,
            selected_file: None,
            tab: TaskTab::Chat,
            native_thread: None,
            hide_finished_agents: false,
            task_reviews: HashMap::new(),
            review_deliveries: HashMap::new(),
            inputs: HashMap::new(),
            textareas: HashMap::new(),
            editors: HashMap::new(),
            diffs: HashMap::new(),
            composer,
            mentions: mentions::MentionState::default(),
            drafts: BTreeMap::new(),
            messages: vec![],
            activity: vec![],
            activity_expanded: false,
            history: HashMap::new(),
            history_turns: HashMap::new(),
            history_cursor: HashMap::new(),
            list: ListState::new(0, ListAlignment::Bottom, px(600.)),
            pending: HashSet::new(),
            attachment_receipts: HashMap::new(),
            pending_sends: HashMap::new(),
            pending_text_submissions: HashMap::new(),
            failed_sends: HashSet::new(),
            responses: HashMap::new(),
            new_task: false,
            create_project: false,
            create_automation: false,
            graph: None,
            checkout_drafts: HashMap::new(),
            automation_starts: HashMap::new(),
            usage_days: 30,
            execution_worktree: None,
            question_choices: HashMap::new(),
            pairing_pending: false,
            search_open: false,
            focus: cx.focus_handle(),
            terminal_focus: cx.focus_handle(),
            terminal_screens: HashMap::new(),
            terminal_status: HashMap::new(),
            selected_terminal: None,
            terminal_marked: String::new(),
            terminal_bounds: None,
            terminal_cell_width: 7.8,
            terminal_selection: None,
            terminal_mouse_cell: None,
            device_preview: None,
            mcp_windows: HashMap::new(),
            mcp_prompts: vec![],
            browser: browser::BrowserState::default(),
            browser_windows: HashMap::new(),
            _events: events,
        };
        let initial = initial.or_else(|| {
            this.registry
                .active_id
                .as_ref()
                .and_then(|id| {
                    this.registry
                        .profiles
                        .iter()
                        .find(|profile| &profile.id == id)
                })
                .and_then(|profile| match this.storage.connection(profile) {
                    Ok(connection) => Some(connection),
                    Err(error) => {
                        this.error = Some(error.to_string());
                        None
                    }
                })
        });
        if let Some(connection) = initial {
            this.command(Command::Connect {
                connection,
                open_task: None,
            });
        }
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(2))
                    .await;
                if this
                    .update(cx, |this, _| {
                        if this.page == Page::Computers
                            && this.fleet_updated.is_none_or(|time| {
                                time.elapsed() >= std::time::Duration::from_secs(15)
                            })
                        {
                            this.refresh_fleet();
                        }
                        if this.page == Page::Acp && this.online {
                            this.poll_acp();
                        }
                        if this.page == Page::Tasks
                            && this.tab == TaskTab::Review
                            && this.online
                            && let Some(id) = this.selected_task.clone()
                        {
                            this.refresh_task_review(&id);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        Ok(this)
    }

    fn command(&mut self, command: Command) {
        if let Err(error) = self.service.send(command) {
            self.error = Some(error.to_string());
        }
    }
    fn request(&mut self, key: impl Into<String>, path: &str, input: Value) {
        self.request_method(key, Method::POST, path, input);
    }
    fn request_method(&mut self, key: impl Into<String>, method: Method, path: &str, input: Value) {
        let key = key.into();
        if self.pending.contains(&key) {
            return;
        }
        if let Err(error) = self.capture_source_request(&key, path, &input) {
            self.error = Some(error.to_string());
            self.work_form_submissions.remove(&key);
            self.agent_submissions.remove(&key);
            self.responses.remove(&format!("scm-form-receipt:{key}"));
            self.responses.remove(&format!("resource-created:{key}"));
            self.responses
                .remove(&format!("resource-stage-receipt:{key}"));
            self.responses
                .remove(&format!("pull-edit-submission:{key}"));
            self.pending_text_submissions.remove(&key);
            self.fail_work_request(&key);
            return;
        }
        self.pending.insert(key.clone());
        self.error = None;
        self.command(Command::Request {
            generation: self.generation,
            key,
            method,
            path: path.into(),
            input,
        });
    }
    fn patch(&mut self, key: impl Into<String>, patch: WorkspacePatch) {
        match serde_json::to_value(patch) {
            Ok(input) => self.request_method(key, Method::PATCH, "/api/workspace", input),
            Err(error) => self.error = Some(error.to_string()),
        }
    }
    fn receive(&mut self, event: Event, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            Event::Fleet {
                generation,
                request,
                result,
            } if generation == self.generation && request == self.fleet_serial => {
                self.pending.remove("fleet");
                self.fleet_updated = Some(std::time::Instant::now());
                match result {
                    Ok(entries) => {
                        self.fleet_entries = entries
                            .into_iter()
                            .filter(|entry| {
                                entry.id == "current" && entry.address == self.address
                                    || self.registry.profiles.iter().any(|profile| {
                                        profile.id == entry.id && profile.address == entry.address
                                    })
                            })
                            .collect()
                    }
                    Err(error) => self.error = Some(error),
                }
            }
            Event::BrowserAction {
                generation,
                id,
                action,
            } if generation == self.generation => {
                self.browser_action(&id, &action, cx);
                if action == "close" {
                    window.activate_window();
                }
            }
            Event::McpToolMessage {
                generation,
                nonce,
                payload,
            } if generation == self.generation => self.mcp_tool_message(nonce, payload, cx),
            Event::McpClosed { generation, nonce } if generation == self.generation => {
                self.mcp_windows.remove(&nonce);
                self.mcp_prompts.retain(|prompt| prompt.nonce != nonce);
            }
            Event::McpExport {
                generation,
                nonce,
                request,
                result,
            } if generation == self.generation => match result {
                Ok(files) => self.save_mcp_exports(nonce, request, files, cx),
                Err(error) => self.mcp_reply(&nonce, &request, Err(error), cx),
            },
            Event::Activity {
                generation,
                task,
                events,
            } if generation == self.generation && self.selected_task.as_deref() == Some(&task) => {
                self.activity = events
            }
            Event::Drafts { generation, values } if generation == self.generation => {
                self.drafts = values
            }
            Event::McpIpc {
                generation,
                nonce,
                payload,
            } if generation == self.generation => {
                let count = self.mcp_prompts.len();
                self.mcp_event(nonce, payload, cx);
                if self.mcp_prompts.len() > count {
                    window.activate_window();
                }
            }
            Event::LocalRuntime(result) => {
                self.pending.remove("local-runtime");
                match result {
                    Ok(connection) => self.command(Command::Connect {
                        connection,
                        open_task: None,
                    }),
                    Err(error) => self.error = Some(error),
                }
            }
            Event::Connected {
                generation,
                address,
                open_task,
            } => {
                for (_, session) in self.mcp_windows.drain() {
                    let _ = session
                        .window
                        .update(cx, |view, window, cx| view.close(window, cx));
                }
                self.mcp_prompts.clear();
                for (_, handle) in self.browser_windows.drain() {
                    let _ = handle.update(cx, |view, window, cx| view.close(window, cx));
                }
                self.browser = browser::BrowserState::default();
                self.generation = generation;
                self.address = address;
                self.fleet_entries.clear();
                self.fleet_updated = None;
                self.pending_open_task = open_task;
                self.fleet_limits.clear();
                self.selected_task = None;
                self.drafts.clear();
                self.snapshot = None;
                self.online = false;
                self.activity.clear();
                self.history.clear();
                self.history_turns.clear();
                self.preset_editor = None;
                self.new_task_template = None;
                self.automation_starts.clear();
                self.mentions = mentions::MentionState::default();
                self.acp = acp::AcpState::default();
                self.task_reviews.clear();
                self.review_deliveries.clear();
                self.native_thread = None;
                self.resource_agent = None;
                self.history_cursor.clear();
                self.messages.clear();
                self.list.reset(0);
                self.responses.clear();
                self.inputs.clear();
                self.textareas.clear();
                self.editors.clear();
                self.graph = None;
                self.checkout_drafts.clear();
                self.selected_work = None;
                self.work_source = None;
                self.work_lists.clear();
                self.source_contexts = scm_context::SourceContexts::default();
                self.scoped_agent_editor = None;
                self.defaults_prompts.clear();
                self.agent_submissions.clear();
                self.catalogs.clear();
                self.staged_resources.clear();
                self.work_form = None;
                self.work_form_submissions.clear();
                self.forge_editor = None;
                self.jira_editor = None;
                self.project_editor = None;
                self.scm_editor_baselines.clear();
                self.work_task_requests.clear();
                self.work_issue_baselines.clear();
                self.work_issue_rebase.clear();
                self.device_preview = None;
                self.diffs.clear();
                self.pending.clear();
                self.attachment_receipts.clear();
                self.pending_sends.clear();
                self.pending_text_submissions.clear();
                self.failed_sends.clear();
                self.terminal_screens.clear();
                self.terminal_status.clear();
                self.terminal_selection = None;
                self.selected_terminal = None;
                self.status = "Connecting…".into();
            }
            Event::Status {
                generation,
                online,
                detail,
            } if generation >= self.generation => {
                if generation > self.generation {
                    self.fleet_entries.clear();
                    self.fleet_updated = None;
                    for (_, session) in self.mcp_windows.drain() {
                        let _ = session
                            .window
                            .update(cx, |view, window, cx| view.close(window, cx));
                    }
                    self.mcp_prompts.clear();
                    for (_, handle) in self.browser_windows.drain() {
                        let _ = handle.update(cx, |view, window, cx| view.close(window, cx));
                    }
                    self.browser = browser::BrowserState::default();
                    self.native_thread = None;
                    self.mentions = mentions::MentionState::default();
                    self.acp = acp::AcpState::default();
                    self.snapshot = None;
                    self.address.clear();
                    self.pending_open_task = None;
                    self.fleet_limits.clear();
                    self.messages.clear();
                    self.list.reset(0);
                    self.responses.clear();
                    self.pending.clear();
                    self.terminal_screens.clear();
                    self.terminal_status.clear();
                    self.terminal_selection = None;
                    self.selected_terminal = None;
                }
                self.generation = generation;
                self.online = online;
                self.status = detail;
            }
            Event::Snapshot {
                generation,
                task,
                snapshot,
            } if generation == self.generation && task == self.selected_task => {
                if self.snapshot.as_ref().is_some_and(|previous| {
                    previous.runtime_instance_id == snapshot.runtime_instance_id
                        && previous.revision > snapshot.revision
                }) {
                    return;
                }
                let app_approval = snapshot.approvals.iter().any(|approval| {
                    self.mcp_windows
                        .values()
                        .any(|session| session.task == approval.task_id)
                        && !self.snapshot.as_ref().is_some_and(|previous| {
                            previous.approvals.iter().any(|old| old.id == approval.id)
                        })
                });
                if app_approval {
                    self.page = Page::Tasks;
                    self.tab = TaskTab::Chat;
                    window.activate_window();
                }
                if let Some(previous) = &self.snapshot {
                    for task in &snapshot.workspace.tasks {
                        if previous
                            .workspace
                            .tasks
                            .iter()
                            .find(|old| old.id == task.id)
                            .is_some_and(|old| old.history_revision != task.history_revision)
                        {
                            self.history.remove(&task.id);
                            self.history_turns.remove(&task.id);
                            self.history_cursor.remove(&task.id);
                        }
                    }
                }
                self.attachment_receipts.retain(|task_id, id| {
                    if snapshot
                        .workspace
                        .tasks
                        .iter()
                        .find(|task| &task.id == task_id)
                        .is_some_and(|task| {
                            task.draft_attachments
                                .iter()
                                .any(|attachment| &attachment.id == id)
                        })
                    {
                        self.pending.remove(&format!("attachment-upload:{task_id}"));
                        false
                    } else {
                        true
                    }
                });
                self.snapshot = Some(*snapshot);
                if let Some(id) = self.pending_open_task.take() {
                    if self
                        .snapshot
                        .as_ref()
                        .is_some_and(|s| s.workspace.tasks.iter().any(|task| task.id == id))
                    {
                        self.select_task(id, window, cx);
                    } else {
                        self.error = Some("This task is no longer available on the selected computer. Refresh the computer overview.".into());
                    }
                }
                self.refresh_messages();
            }
            Event::Response {
                generation,
                key,
                result,
            } if generation == self.generation => {
                self.pending.remove(&key);
                if !self.accept_source_response(&key) {
                    self.work_form_submissions.remove(&key);
                    self.agent_submissions.remove(&key);
                    self.responses.remove(&format!("scm-form-receipt:{key}"));
                    self.responses.remove(&format!("resource-created:{key}"));
                    self.responses
                        .remove(&format!("resource-stage-receipt:{key}"));
                    self.responses
                        .remove(&format!("pull-edit-submission:{key}"));
                    self.pending_text_submissions.remove(&key);
                    self.fail_work_request(&key);
                    self.error = Some("The source changed while the request was in progress. Reload source views; unsaved drafts have been kept.".into());
                    cx.notify();
                    return;
                }
                if key.starts_with("browser:") {
                    self.receive_browser(&key, result, cx);
                    cx.notify();
                    return;
                }
                if key.starts_with("mention-files:") {
                    self.receive_mention_files(&key, result);
                    cx.notify();
                    return;
                }
                if key.starts_with("acp:") {
                    self.receive_acp(&key, result, cx);
                    return;
                }
                if key.starts_with("task-review:") {
                    self.receive_task_review(&key, result);
                    cx.notify();
                    return;
                }
                if key.starts_with("native-thread:") {
                    if self
                        .native_thread
                        .as_ref()
                        .is_some_and(|thread| thread.key == key)
                    {
                        match result {
                            Ok(value) => self.receive_native_thread(&key, &value),
                            Err(error) => self.error = Some(error),
                        }
                    }
                    cx.notify();
                    return;
                }
                if key.starts_with("resource-catalog:") {
                    if self.catalog_is_current(&key) {
                        match result {
                            Ok(value) => self.receive_resource_catalog(&key, &value),
                            Err(error) => {
                                self.fail_resource_catalog(&key);
                                self.error = Some(error);
                            }
                        }
                    }
                    cx.notify();
                    return;
                }
                if key.starts_with("work-list:")
                    && !self.work_lists.values().any(|list| list.is_current(&key))
                {
                    return;
                }
                if let Some(id) = key.strip_prefix("terminal-stream:") {
                    if let Err(error) = result {
                        self.terminal_status.insert(id.to_owned(), error);
                    }
                    cx.notify();
                    return;
                }
                if let Some(key) = key.strip_prefix("mcp-rpc:") {
                    if let Some((nonce, request)) = key.split_once(':') {
                        let result = result.and_then(|value| {
                            value
                                .get("result")
                                .cloned()
                                .ok_or_else(|| "Missing MCP result".into())
                        });
                        self.mcp_reply(nonce, request, result, cx);
                    }
                    cx.notify();
                    return;
                }
                match result {
                    Ok(value) => {
                        if key.starts_with("attachment-read:")
                            && let Err(error) = self.save_attachment_result(&value, cx)
                        {
                            self.error = Some(error.to_string());
                        }
                        if let Some(task_id) = key.strip_prefix("attachment-upload:") {
                            if let Some(id) =
                                value.pointer("/attachment/id").and_then(Value::as_str)
                            {
                                if !self.snapshot.as_ref().is_some_and(|snapshot| {
                                    snapshot
                                        .workspace
                                        .tasks
                                        .iter()
                                        .find(|task| task.id == task_id)
                                        .is_some_and(|task| {
                                            task.draft_attachments
                                                .iter()
                                                .any(|attachment| attachment.id == id)
                                        })
                                }) {
                                    self.attachment_receipts.insert(task_id.into(), id.into());
                                    self.pending.insert(key.clone());
                                }
                            } else {
                                self.error = Some(
                                    "The runtime returned an invalid attachment receipt".into(),
                                );
                            }
                        }
                        if key.starts_with("mcp-read:")
                            && let Err(error) = self.open_mcp_result(&value, cx)
                        {
                            self.error = Some(error.to_string());
                        }
                        if let Some((task_id, text)) = self.pending_sends.remove(&key) {
                            self.failed_sends.remove(&key);
                            if value.get("discarded") != Some(&json!(true))
                                && self.drafts.get(&task_id) == Some(&text)
                            {
                                if self.selected_task.as_ref() == Some(&task_id)
                                    && self.composer.read(cx).value().as_ref() == text
                                {
                                    self.composer
                                        .update(cx, |input, cx| input.set_value("", window, cx));
                                }
                                self.drafts.insert(task_id.clone(), String::new());
                                self.command(Command::SaveDraft {
                                    generation: self.generation,
                                    id: task_id,
                                    text: String::new(),
                                });
                            }
                        }
                        if let Some(task_id) = key.strip_prefix("history:") {
                            let current = self
                                .snapshot
                                .as_ref()
                                .and_then(|snapshot| {
                                    snapshot
                                        .workspace
                                        .tasks
                                        .iter()
                                        .find(|task| task.id == task_id)
                                })
                                .and_then(|task| task.history_revision)
                                .unwrap_or(0);
                            if value
                                .get("historyRevision")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                != current
                            {
                                self.error=Some("Conversation changed while loading history; load the latest page again".into());
                                cx.notify();
                                return;
                            }
                            match serde_json::from_value::<crate::model::ConversationPage>(
                                value.clone(),
                            ) {
                                Ok(page) => {
                                    let history = self.history.entry(task_id.into()).or_default();
                                    let mut earlier: Vec<_> = page
                                        .messages
                                        .into_iter()
                                        .filter(|message| {
                                            !history.iter().any(|old| old.id == message.id)
                                        })
                                        .collect();
                                    earlier.append(history);
                                    *history = earlier;
                                    let turns =
                                        self.history_turns.entry(task_id.into()).or_default();
                                    for turn in page.turns {
                                        if let Some(old) =
                                            turns.iter_mut().find(|old| old.id == turn.id)
                                        {
                                            *old = turn;
                                        } else {
                                            turns.push(turn);
                                        }
                                    }
                                    turns.sort_by(|a, b| a.started_at.cmp(&b.started_at));
                                    self.history_cursor.insert(task_id.into(), page.before);
                                    self.refresh_messages();
                                }
                                Err(error) => {
                                    self.error =
                                        Some(format!("Invalid conversation history: {error}"))
                                }
                            }
                        }
                        if let Some(task_id) = key.strip_prefix("create-task:") {
                            self.checkout_drafts.remove("new-task-links");
                            self.inputs
                                .retain(|key, _| !key.starts_with("new-task-links:"));
                            if let Some(draft) = self
                                .responses
                                .remove(&format!("create-task-draft:{task_id}"))
                                .and_then(|value| value.as_str().map(str::to_owned))
                            {
                                self.drafts.insert(task_id.into(), draft.clone());
                                self.command(Command::SaveDraft {
                                    generation: self.generation,
                                    id: task_id.into(),
                                    text: draft,
                                });
                            }
                            self.select_task(task_id.into(), window, cx);
                        }
                        if (key.starts_with("fork-turn:") || key.starts_with("worktree-thread:"))
                            && let Some(id) = value.get("id").and_then(Value::as_str)
                        {
                            self.notice =
                                Some(format!("Fork created ({id}); choose it from the task list"));
                        }
                        if key.starts_with("pull-task:") {
                            if let Some(error) = value.get("error").and_then(Value::as_str) {
                                self.error = Some(error.to_owned());
                            } else {
                                self.notice = Some(
                                    "Pull request task created; choose it from the task list"
                                        .into(),
                                );
                            }
                        }
                        if let Some(source) = key.strip_prefix("work-detail:issues:") {
                            let baseline = format!("issue-edit:{source}");
                            if self.work_issue_rebase.contains(&baseline)
                                && let Some(issue) = value.get("issue")
                                && let Ok(issue) = serde_json::from_value(issue.clone())
                            {
                                self.work_issue_baselines.insert(baseline.clone(), issue);
                                self.work_issue_rebase.remove(&baseline);
                            }
                        }
                        self.receive_automation_action(&key, &value);
                        self.receive_task_revision(&key);
                        self.receive_linked_checkouts(&key);
                        self.receive_device_host_save(&key, &value, cx);
                        self.receive_device_action(&key);
                        self.receive_preset_save(&key);
                        if key.starts_with("template-save:") {
                            self.notice = Some("Task template saved".into());
                        }
                        self.receive_work_response(&key, &value, cx);
                        self.receive_scm_settings(&key, &value, cx);
                        self.receive_scoped_agents(&key, &value, cx);
                        self.receive_task_defaults(&key, &value, cx);
                        self.receive_resource_catalog(&key, &value);
                        self.receive_pull_action(&key, &value);
                        self.refresh_work_action(&key);
                        if key.starts_with("work-task:")
                            && let Some(id) = value.get("id").and_then(Value::as_str)
                        {
                            self.work_task_requests.remove(&key);
                            self.selected_task = Some(id.to_owned());
                            self.page = Page::Tasks;
                            self.tab = TaskTab::Chat;
                            self.command(Command::Select(self.selected_task.clone()));
                        }
                        if key == "create-project" {
                            self.create_project = false;
                        }
                        if key == "create-automation" {
                            self.create_automation = false;
                        }
                        if let Some((editor, text)) = self.pending_text_submissions.remove(&key)
                            && self.text_value(&editor, cx) == text
                        {
                            self.textareas.remove(&editor);
                        }
                        if let Some(saved) = key.strip_prefix("save:")
                            && let Some((task_id, path)) = saved.split_once(':')
                        {
                            self.request(
                                format!("file:{task_id}:{path}"),
                                "/api/tasks/files/read",
                                json!({"id":task_id,"path":path}),
                            );
                        }
                        if let Some(applied) = key.strip_prefix("apply:")
                            && let Some((task_id, _)) = applied.split_once(':')
                            && let Some(task) = self
                                .snapshot
                                .as_ref()
                                .and_then(|snapshot| {
                                    snapshot
                                        .workspace
                                        .tasks
                                        .iter()
                                        .find(|task| task.id == task_id)
                                })
                                .cloned()
                        {
                            self.request(
                                format!("changes:{task_id}"),
                                "/api/scm/changes",
                                json!({"repositoryId":task.repository_id,"taskId":task_id}),
                            );
                        }
                        if let Some(id) = key.strip_prefix("graph-save:") {
                            if let Some(draft) = &mut self.graph {
                                draft.acknowledge_save_for(id);
                            }
                            self.notice = Some("Workflow saved".into());
                        }
                        self.receive_resources(&key, &value, cx);
                        if key == "device-host-settings-save" {
                            self.responses
                                .insert("device-host-settings".into(), value.clone());
                        }
                        if key == "usage-price-save" {
                            self.read_usage(false);
                        }
                        if key == "preferences-save" {
                            self.responses.insert("preferences".into(), value.clone());
                        }
                        if self.page == Page::Tasks
                            && (key.strip_prefix("terminal:") == self.selected_task.as_deref()
                                || key.strip_prefix("terminal-run:")
                                    == self.selected_task.as_deref())
                            && let Some(id) = value.get("id").and_then(Value::as_str)
                        {
                            if key.starts_with("terminal-run:") {
                                self.tab = TaskTab::Terminal;
                            }
                            self.selected_terminal = Some(id.to_owned());
                            self.terminal_screens
                                .entry(id.to_owned())
                                .or_insert_with(|| vt100::Parser::new(30, 100, 10_000));
                            self.command(Command::OpenTerminal(id.to_owned()));
                        }
                        if let Some(opened) = key.strip_prefix("device-open:")
                            && opened.split_once(':').map(|(task, _)| task)
                                == self.selected_task.as_deref()
                            && self.tab == TaskTab::Devices
                        {
                            match self.open_device(&value) {
                                Ok(()) => {}
                                Err(error) => self.error = Some(error.to_string()),
                            }
                        }
                        self.responses.insert(key, value);
                    }
                    Err(message) => {
                        self.work_form_submissions.remove(&key);
                        self.agent_submissions.remove(&key);
                        self.responses.remove(&format!("scm-form-receipt:{key}"));
                        self.responses.remove(&format!("resource-created:{key}"));
                        self.responses
                            .remove(&format!("resource-stage-receipt:{key}"));
                        self.responses
                            .remove(&format!("pull-edit-submission:{key}"));
                        self.fail_work_request(&key);
                        self.fail_resource_catalog(&key);
                        self.pending_text_submissions.remove(&key);
                        if self.pending_sends.contains_key(&key) {
                            self.failed_sends.insert(key);
                        }
                        self.error = Some(message);
                    }
                }
            }
            Event::Pairing { pending, message } => {
                self.pairing_pending = pending;
                self.notice = Some(message);
            }
            Event::Registry(registry) => self.registry = registry,
            Event::Paired {
                registry,
                connection,
            } => {
                self.registry = registry;
                self.pairing_pending = false;
                self.notice = Some("Computer paired successfully".into());
                self.command(Command::Connect {
                    connection,
                    open_task: None,
                });
            }
            Event::DeviceClosed { generation, id } if generation == self.generation => {
                if self
                    .device_preview
                    .as_ref()
                    .is_some_and(|preview| preview.id == id)
                {
                    self.device_preview = None;
                    self.notice =
                        Some("Device preview disconnected; reopen it to reconnect".into());
                }
            }
            Event::DeviceFrame {
                generation,
                id,
                frame,
            } if generation == self.generation => {
                if let Some(preview) = self.device_preview.as_mut()
                    && preview.id == id
                {
                    let sequence = frame.sequence;
                    preview.width = frame.width;
                    preview.height = frame.height;
                    preview.image = Some(std::sync::Arc::new(Image::from_bytes(
                        ImageFormat::Jpeg,
                        frame.bytes,
                    )));
                    self.command(Command::DeviceInput {
                        generation,
                        input: json!({"type":"frameAck","sequence":sequence}),
                    });
                }
            }
            Event::TerminalStarted { generation, id } if generation == self.generation => {
                self.terminal_status.remove(&id);
                let (rows, cols) = self
                    .terminal_screens
                    .get(&id)
                    .map(|parser| parser.screen().size())
                    .unwrap_or((30, 100));
                self.terminal_screens
                    .insert(id.clone(), vt100::Parser::new(rows, cols, 10_000));
                self.command(Command::TerminalResize { id, rows, cols });
                self.terminal_mouse_cell = None;
                self.terminal_selection = None;
            }
            Event::TerminalData {
                generation,
                id,
                data,
            } if generation == self.generation => {
                self.terminal_screens
                    .entry(id)
                    .or_insert_with(|| vt100::Parser::new(30, 100, 10_000))
                    .process(&data);
            }
            Event::Outbox {
                generation,
                messages,
            } if generation == self.generation => {
                for message in messages {
                    if message.path.starts_with("/api/review/task/") {
                        self.review_deliveries.insert(message.key.clone(), message);
                        continue;
                    }
                    if message.path == "/api/jobs/run" {
                        if let (Some(id), Some(request_id)) = (
                            message.input.get("id").and_then(Value::as_str),
                            message.input.get("requestId").and_then(Value::as_str),
                        ) {
                            self.automation_starts.insert(id.into(), request_id.into());
                        }
                        continue;
                    }
                    if let (Some(task), Some(text)) = (
                        message.input.get("id").and_then(Value::as_str),
                        message.input.get("text").and_then(Value::as_str),
                    ) {
                        self.pending_sends
                            .insert(message.key.clone(), (task.to_owned(), text.to_owned()));
                        self.failed_sends.insert(message.key);
                    }
                }
            }
            _ => {}
        }
        cx.notify();
    }
    fn task(&self) -> Option<&Task> {
        self.snapshot
            .as_ref()?
            .workspace
            .tasks
            .iter()
            .find(|task| Some(&task.id) == self.selected_task.as_ref())
    }
    fn refresh_messages(&mut self) {
        let previous = self.messages.len();
        let messages = if let Some(task) = self.task() {
            let mut messages = self.history.get(&task.id).cloned().unwrap_or_default();
            let live_ids: HashSet<_> = task.messages.iter().map(|message| &message.id).collect();
            messages.retain(|message| !live_ids.contains(&message.id));
            messages.extend(task.messages.clone());
            messages
        } else {
            vec![]
        };
        let count = messages.len();
        let prepend = previous > 0
            && count > previous
            && messages.get(count - previous).map(|message| &message.id)
                == self.messages.first().map(|message| &message.id);
        self.messages = messages;
        if count > previous {
            let index = if prepend { 0 } else { previous };
            self.list.splice(index..index, count - previous);
        } else if count < previous {
            self.list.reset(count);
        }
    }
    fn select_task(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.activity.clear();
        self.native_thread = None;
        self.mentions = mentions::MentionState::default();
        self.selected_task = Some(id.clone());
        self.page = Page::Tasks;
        self.new_task = false;
        self.tab = TaskTab::Chat;
        self.selected_file = None;
        self.selected_terminal = None;
        self.terminal_screens.clear();
        self.terminal_selection = None;
        self.device_preview = None;
        self.messages.clear();
        self.list.reset(0);
        let value = self
            .drafts
            .get(&id)
            .cloned()
            .or_else(|| self.task().map(|task| task.draft.clone()))
            .unwrap_or_default();
        self.composer
            .update(cx, |input, cx| input.set_value(value, window, cx));
        self.refresh_messages();
        self.command(Command::Select(Some(id.clone())));
        cx.notify();
    }
    fn input(
        &mut self,
        key: &str,
        value: &str,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(input) = self.inputs.get(key) {
            return input.clone();
        }
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(value.to_owned())
                .placeholder(placeholder.to_owned())
        });
        cx.subscribe(&input, |_, _, _: &InputEvent, cx| cx.notify())
            .detach();
        self.inputs.insert(key.to_owned(), input.clone());
        input
    }
    fn textarea(
        &mut self,
        key: &str,
        value: &str,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<TextareaState> {
        self.textareas
            .entry(key.to_owned())
            .or_insert_with(|| {
                cx.new(|cx| {
                    TextareaState::new(window, cx)
                        .default_value(value.to_owned())
                        .placeholder(placeholder.to_owned())
                        .auto_grow(4, 16)
                })
            })
            .clone()
    }
    fn value(&self, key: &str, cx: &App) -> String {
        self.inputs
            .get(key)
            .map(|input| input.read(cx).value().to_string())
            .unwrap_or_default()
    }
    fn text_value(&self, key: &str, cx: &App) -> String {
        self.textareas
            .get(key)
            .map(|input| input.read(cx).value().to_string())
            .unwrap_or_default()
    }
    fn field(
        &mut self,
        key: &str,
        label: &str,
        value: &str,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let input = self.input(key, value, placeholder, window, cx);
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(label.to_owned())
            .child(Input::new(&input))
            .into_any_element()
    }
    fn text_field(
        &mut self,
        key: &str,
        label: &str,
        value: &str,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let input = self.textarea(key, value, placeholder, window, cx);
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(label.to_owned())
            .child(Textarea::new(&input))
            .into_any_element()
    }
    fn start_new_task(&mut self, _: &NewTask, _: &mut Window, cx: &mut Context<Self>) {
        self.page = Page::Tasks;
        self.new_task = true;
        self.read_task_agents();
        cx.notify();
    }
    fn send_message(&mut self, _: &SendMessage, window: &mut Window, cx: &mut Context<Self>) {
        self.submit_message(false, window, cx);
    }
    fn submit_message(&mut self, steer: bool, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).value().to_string();
        if text.trim().is_empty()
            && self
                .task()
                .is_none_or(|task| task.draft_attachments.is_empty())
        {
            return;
        }
        let Some(task) = self.task().cloned() else {
            return;
        };
        if task.is_archived() || !self.online {
            return;
        }
        if steer && task.active_run_id.is_none() {
            self.error = Some("Refresh this task before steering its current run".into());
            return;
        }
        if self.pending.iter().any(|key| {
            key == &format!("attachment-pick:{}", task.id)
                || key == &format!("attachment-upload:{}", task.id)
                || key.starts_with(&format!("attachment-remove:{}:", task.id))
        }) {
            return;
        }
        let attachment_ids: Vec<_> = task
            .draft_attachments
            .iter()
            .map(|attachment| attachment.id.clone())
            .collect();
        let message_id = uuid::Uuid::new_v4().to_string();
        let key = format!("send:{}:{message_id}", task.id);
        self.pending_sends
            .insert(key.clone(), (task.id.clone(), text.clone()));
        self.request(
            key,
            if steer {
                "/api/tasks/steer"
            } else {
                "/api/tasks/message"
            },
            match serde_json::to_value(crate::model::MessageInput {
                id: task.id,
                message_id,
                text,
                attachment_ids,
                run_id: task.active_run_id,
            }) {
                Ok(input) => input,
                Err(error) => {
                    self.error = Some(error.to_string());
                    return;
                }
            },
        );
        // Keep the draft while delivery is uncertain. A confirmed receipt clears it on the next render.
        let _ = window;
        cx.notify();
    }
    fn navigate(&mut self, page: Page, cx: &mut Context<Self>) {
        if !matches!(page, Page::Tasks | Page::Archived) {
            self.command(Command::DetachTerminals);
            self.command(Command::DeviceClose);
            self.selected_terminal = None;
            self.device_preview = None;
        } else if self
            .task()
            .is_some_and(|task| task.is_archived() != (page == Page::Archived))
        {
            self.selected_task = None;
            self.messages.clear();
            self.list.reset(0);
            self.command(Command::Select(None));
        } else if self.tab == TaskTab::Terminal
            && let Some(id) = self.selected_task.clone()
        {
            self.request(
                format!("terminal:{id}"),
                "/api/terminals/ensure",
                json!({"taskId":id}),
            );
        }
        self.page = page;
        self.new_task = false;
        match page {
            Page::Artifacts => {
                self.request("artifact-library", "/api/artifacts/library", json!({}))
            }
            Page::Resources => self.read_resources(),
            Page::Agents => {
                self.read_scoped_agents();
                self.refresh_acp(false);
            }
            Page::Acp => {
                self.refresh_acp(true);
                self.inspect_acp();
            }
            Page::Defaults => self.read_task_defaults(),
            Page::Computers => self.refresh_fleet(),
            Page::Usage => self.read_usage(false),
            Page::Settings => {
                self.request("preferences", "/api/runtime/preferences/read", json!({}))
            }
            Page::Issues | Page::Pipelines | Page::Pulls => {
                let source = self
                    .work_source
                    .clone()
                    .filter(|source| {
                        page == Page::Issues
                            || matches!(source, scm_lists::WorkSource::Repository(_))
                    })
                    .or_else(|| {
                        self.selected_repository
                            .clone()
                            .map(scm_lists::WorkSource::Repository)
                    });
                if let Some(source) = source {
                    self.select_work_source(page, source);
                }
            }
            Page::Integrations | Page::Projects => {
                self.request("forge-connections", "/api/scm/connections/read", json!({}));
            }
            _ => {}
        }
        cx.notify();
    }
    fn header(title: &str, subtitle: &str) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap_2()
            .pb_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(title.to_owned()),
            )
            .child(div().text_sm().opacity(0.65).child(subtitle.to_owned()))
            .into_any_element()
    }
    fn empty(title: &str, description: &str) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .flex_1()
            .gap_3()
            .p_8()
            .child(div().text_lg().child(title.to_owned()))
            .child(div().text_sm().opacity(0.65).child(description.to_owned()))
            .into_any_element()
    }
}

impl Focusable for Workbench {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = if self.search_open {
            self.search_page(window, cx)
        } else {
            match self.page {
                Page::Tasks | Page::Archived => self.tasks_page(window, cx),
                Page::Projects => self.projects_page(window, cx),
                Page::Agents => self.agents_page(window, cx),
                Page::Acp => self.acp_page(window, cx),
                Page::Defaults => self.defaults_page(window, cx),
                Page::Automations => self.automations_page(window, cx),
                Page::Computers => self.computers_page(window, cx),
                Page::Settings => self.settings_page(window, cx),
                Page::Resources => self.resources_page(window, cx),
                Page::Usage => self.usage_page(window, cx),
                Page::Integrations => self.scm_settings_page(window, cx),
                Page::Artifacts => self.artifacts_page(window, cx),
                Page::Pulls | Page::Issues | Page::Pipelines => self.scm_page(window, cx),
            }
        };
        let mcp_confirmation = self.mcp_confirmation(cx);
        let sidebar = div()
            .id("workspace-sidebar")
            .overflow_y_scroll()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .w(px(190.))
            .flex_shrink_0()
            .border_r_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().sidebar)
            .text_color(cx.theme().sidebar_foreground)
            .p_3()
            .gap_1()
            .child(
                div()
                    .h(px(48.))
                    .flex()
                    .items_center()
                    .px_2()
                    .font_weight(FontWeight::BOLD)
                    .text_lg()
                    .child("dovo"),
            )
            .child(
                Button::new("new-task")
                    .primary()
                    .label("+ New task")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.page = Page::Tasks;
                        this.new_task = true;
                        this.read_task_agents();
                        cx.notify();
                    })),
            )
            .child(div().h_3())
            .children(Page::ALL.into_iter().map(|page| {
                Button::new(page.label())
                    .ghost()
                    .label(page.label())
                    .selected(self.page == page)
                    .on_click(cx.listener(move |this, _, _, cx| this.navigate(page, cx)))
            }))
            .child(div().flex_1())
            .child(
                Button::new("search")
                    .ghost()
                    .label("Search  ⌘K")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.search_open = true;
                        cx.notify();
                    })),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .p_2()
                    .child("Rust · GPUI"),
            );
        div()
            .key_context("DovoWorkbench")
            .track_focus(&self.focus)
            .on_action(cx.listener(Self::start_new_task))
            .on_action(cx.listener(Self::send_message))
            .on_action(cx.listener(|this, _: &Search, _, cx| {
                this.search_open = !this.search_open;
                cx.notify();
            }))
            .size_full()
            .flex()
            .flex_col()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .text_sm()
            .child(
                div().flex().flex_1().min_h_0().child(sidebar).child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .min_h_0()
                        .overflow_hidden()
                        .child(content),
                ),
            )
            .children(mcp_confirmation)
            .children(self.error.clone().map(|error| {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_4()
                    .py_2()
                    .bg(cx.theme().danger.opacity(0.15))
                    .text_color(cx.theme().foreground)
                    .child(error)
                    .child(
                        Button::new("dismiss-error")
                            .ghost()
                            .label("Dismiss")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.error = None;
                                cx.notify();
                            })),
                    )
            }))
            .children(self.notice.clone().map(|notice| {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_4()
                    .py_2()
                    .bg(cx.theme().info.opacity(0.15))
                    .text_color(cx.theme().foreground)
                    .child(notice)
                    .child(
                        Button::new("dismiss-notice")
                            .ghost()
                            .label("Dismiss")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.notice = None;
                                cx.notify();
                            })),
                    )
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(30.))
                    .px_4()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .text_xs()
                    .child(
                        div()
                            .text_color(if self.online {
                                cx.theme().success
                            } else {
                                cx.theme().warning
                            })
                            .child(format!("● {}", self.status)),
                    )
                    .child(
                        Button::new("connection-status")
                            .ghost()
                            .label(if self.address.is_empty() {
                                "Connect a computer".into()
                            } else {
                                self.address.clone()
                            })
                            .on_click(
                                cx.listener(|this, _, _, cx| this.navigate(Page::Computers, cx)),
                            ),
                    ),
            )
    }
}
