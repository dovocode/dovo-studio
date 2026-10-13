use super::*;
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::{
    assets::IconName as UiIcon,
    component::menu::{DropdownMenu, PopupMenuItem},
    component::{Icon, Sizable},
};

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum TaskFilter {
    #[default]
    All,
    Active,
    Attention,
}
impl TaskFilter {
    fn label(self) -> &'static str {
        match self {
            Self::All => "All tasks",
            Self::Active => "Running",
            Self::Attention => "Needs attention",
        }
    }
    fn includes(self, task: &Task, snapshot: &Snapshot) -> bool {
        match self {
            Self::All => true,
            Self::Active => task.status == TaskStatus::Running,
            Self::Attention => {
                matches!(task.status, TaskStatus::Review | TaskStatus::Failed)
                    || needs_input(task, snapshot).is_some()
            }
        }
    }
}

fn needs_input(task: &Task, snapshot: &Snapshot) -> Option<&'static str> {
    let family = crate::task_family::ids(&snapshot.workspace.tasks, &task.id);
    if snapshot
        .approvals
        .iter()
        .any(|approval| family.contains(&approval.task_id))
    {
        Some("Approval")
    } else if snapshot
        .questions
        .iter()
        .any(|question| family.contains(&question.task_id))
    {
        Some("Question")
    } else {
        None
    }
}

impl Workbench {
    pub(super) fn tasks_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let archived = self.page == Page::Archived;
        let search = self.input("task-search", "", "Search tasks…", window, cx);
        let query = search.read(cx).value().to_lowercase();
        let tasks: Vec<_> =
            self.snapshot
                .as_ref()
                .map(|snapshot| {
                    snapshot
                        .workspace
                        .tasks
                        .iter()
                        .filter(|task| {
                            task.is_archived() == archived
                                && self.task_filter.includes(task, snapshot)
                                && (task.title.to_lowercase().contains(&query)
                                    || task.messages.iter().any(|message| {
                                        message.text.to_lowercase().contains(&query)
                                    }))
                        })
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
        let mut tasks = tasks;
        tasks.sort_by(|a, b| {
            b.pinned
                .unwrap_or(false)
                .cmp(&a.pinned.unwrap_or(false))
                .then_with(|| {
                    let active = |task: &Task| {
                        matches!(task.status, TaskStatus::Running | TaskStatus::Review)
                    };
                    active(b).cmp(&active(a))
                })
                .then_with(|| b.created_at.cmp(&a.created_at))
        });
        let mut count = tasks.len();
        let mut rows = Vec::new();
        let entity = cx.entity();
        let selected_filter = self.task_filter;
        let filter = Button::new("task-list-filter")
            .ghost()
            .small()
            .icon(UiIcon::ListFilter)
            .selected(selected_filter != TaskFilter::All)
            .accessibility_label("Filter tasks")
            .tooltip(selected_filter.label())
            .dropdown_menu(move |mut menu, _, _| {
                for filter in [TaskFilter::All, TaskFilter::Active, TaskFilter::Attention] {
                    let entity = entity.clone();
                    menu = menu.item(
                        PopupMenuItem::new(filter.label())
                            .checked(filter == selected_filter)
                            .on_click(move |_, _, cx| {
                                entity.update(cx, |this, cx| {
                                    this.task_filter = filter;
                                    cx.notify();
                                });
                            }),
                    );
                }
                menu
            });
        let mut last_section = "";
        for task in tasks {
            let section = if task.pinned.unwrap_or(false) {
                "Pinned"
            } else if matches!(task.status, TaskStatus::Running | TaskStatus::Review) {
                "Active"
            } else {
                "Recent"
            };
            if section != last_section {
                rows.push(
                    div()
                        .px_3()
                        .pt_3()
                        .pb_1()
                        .text_size(px(11.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(cx.theme().muted_foreground)
                        .child(section)
                        .into_any_element(),
                );
                last_section = section;
            }
            let id = task.id.clone();
            let selected = self.selected_task.as_ref() == Some(&id) && !self.new_task;
            let attention = self
                .snapshot
                .as_ref()
                .and_then(|snapshot| needs_input(&task, snapshot));
            let project = self
                .snapshot
                .as_ref()
                .and_then(|snapshot| {
                    snapshot
                        .workspace
                        .repositories
                        .iter()
                        .find(|repo| repo.id == task.repository_id)
                })
                .map(|repo| repo.name.clone())
                .unwrap_or_else(|| "No project".into());
            let date = chrono::DateTime::parse_from_rfc3339(&task.created_at)
                .map(|date| date.format("%b %e").to_string())
                .unwrap_or_default();
            let agent_icon = self.task_agent_icon(&task, cx);
            let preview = task
                .messages
                .iter()
                .find(|message| message.role == Role::User)
                .and_then(|message| message.text.lines().find(|line| !line.trim().is_empty()))
                .map(str::to_owned);
            rows.push(
                div()
                    .id(SharedString::from(task.id))
                    .mx_1()
                    .my(px(1.))
                    .px_2()
                    .py_2()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .border_l_2()
                    .border_color(if selected {
                        cx.theme().primary
                    } else {
                        cx.theme().transparent
                    })
                    .bg(if selected {
                        cx.theme().list_active
                    } else {
                        cx.theme().sidebar
                    })
                    .cursor_pointer()
                    .hover(|style| style.bg(cx.theme().list_hover))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .min_w_0()
                            .child(agent_icon)
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(task.title),
                            )
                            .children(task.pinned.unwrap_or(false).then(|| {
                                Icon::new(UiIcon::Pin)
                                    .size(px(12.))
                                    .text_color(cx.theme().muted_foreground)
                            })),
                    )
                    .children(preview.map(|text| {
                        div()
                            .truncate()
                            .text_size(px(11.))
                            .text_color(cx.theme().muted_foreground)
                            .child(text)
                    }))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .text_size(px(11.))
                            .text_color(cx.theme().muted_foreground)
                            .child(div().truncate().flex_1().min_w_0().child(project))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .child(
                                        div()
                                            .size(px(4.))
                                            .rounded_full()
                                            .bg(super::appearance::status_color(task.status, cx)),
                                    )
                                    .text_color(if attention.is_some() {
                                        cx.theme().warning
                                    } else {
                                        cx.theme().muted_foreground
                                    })
                                    .child(attention.unwrap_or(task.status.label())),
                            )
                            .child(date),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .text_size(px(10.))
                            .text_color(cx.theme().muted_foreground)
                            .child(Icon::new(self.runtime_icon()).size(px(11.)))
                            .child(self.server_label()),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_task(id.clone(), window, cx)
                    }))
                    .into_any_element(),
            );
        }
        if !archived {
            for entry in self
                .fleet_entries
                .clone()
                .into_iter()
                .filter(|entry| entry.address != self.address)
            {
                let server_name = if entry.name == entry.address {
                    servers::address_label(&entry.address)
                } else {
                    entry.name.clone()
                };
                let icon = entry
                    .result
                    .as_ref()
                    .map(|summary| shell::server_icon(&summary.runtime_icon))
                    .unwrap_or(UiIcon::Server);
                let address = entry.address.clone();
                rows.push(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_3()
                        .pt_4()
                        .pb_2()
                        .text_size(px(11.))
                        .text_color(cx.theme().muted_foreground)
                        .child(Icon::new(icon).size(px(12.)))
                        .child(server_name.clone())
                        .children(
                            entry
                                .result
                                .as_ref()
                                .err()
                                .map(|_| div().text_color(cx.theme().warning).child("Offline")),
                        )
                        .into_any_element(),
                );
                if let Ok(summary) = entry.result {
                    for task in summary
                        .task_entries
                        .into_iter()
                        .filter(|task| {
                            task.title.to_lowercase().contains(&query)
                                || task.project.to_lowercase().contains(&query)
                        })
                        .filter(|task| match self.task_filter {
                            TaskFilter::All => true,
                            TaskFilter::Active => task.status == TaskStatus::Running,
                            TaskFilter::Attention => {
                                task.needs_input
                                    || matches!(
                                        task.status,
                                        TaskStatus::Review | TaskStatus::Failed
                                    )
                            }
                        })
                    {
                        count += 1;
                        let target = address.clone();
                        let id = task.id.clone();
                        rows.push(
                            div()
                                .id(SharedString::from(format!("server-thread:{target}:{id}")))
                                .mx_1()
                                .px_2()
                                .py_2()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .cursor_pointer()
                                .hover(|s| s.bg(cx.theme().list_hover))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .min_w_0()
                                        .child(shell::harness_icon(&task.provider, cx))
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .truncate()
                                                .font_weight(FontWeight::MEDIUM)
                                                .child(task.title),
                                        ),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .text_size(px(11.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(
                                            div().flex_1().min_w_0().truncate().child(task.project),
                                        )
                                        .child(
                                            div()
                                                .size(px(4.))
                                                .rounded_full()
                                                .bg(appearance::status_color(task.status, cx)),
                                        )
                                        .child(if task.needs_input {
                                            "Needs input"
                                        } else {
                                            task.status.label()
                                        }),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_1()
                                        .text_size(px(10.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(Icon::new(icon).size(px(11.)))
                                        .child(server_name.clone()),
                                )
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.switch_server(&target, Some(id.clone()), cx)
                                }))
                                .into_any_element(),
                        );
                    }
                }
            }
        }
        let list = div()
            .flex()
            .flex_col()
            .size_full()
            .min_w_0()
            .min_h_0()
            .bg(cx.theme().sidebar)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(42.))
                    .px_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(if archived { "Archive" } else { "Tasks" })
                            .child(
                                div()
                                    .text_size(px(11.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(count.to_string()),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_1()
                            .child(filter)
                            .child(
                                shell::icon_button(
                                    "refresh-thread-servers",
                                    UiIcon::RefreshCw,
                                    "Refresh server threads",
                                )
                                .disabled(self.pending.contains("fleet"))
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.refresh_fleet();
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                Button::new("sidebar-new-task")
                                    .ghost()
                                    .small()
                                    .icon(UiIcon::Plus)
                                    .accessibility_label("New task")
                                    .tooltip("New task")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.page = Page::Tasks;
                                        this.new_task = true;
                                        this.read_task_agents();
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
            .child(
                div().px_3().pb_2().child(
                    Input::new(&search)
                        .small()
                        .prefix(Icon::new(UiIcon::Search).size(px(13.))),
                ),
            )
            .child(
                div()
                    .id("task-list")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .children(rows)
                    .when(count == 0, |list| {
                        list.child(
                            div()
                                .px_3()
                                .py_4()
                                .text_size(px(12.))
                                .text_color(cx.theme().muted_foreground)
                                .child(if query.is_empty() {
                                    "No tasks in this view."
                                } else {
                                    "No tasks match your search."
                                }),
                        )
                    }),
            );
        let detail = if self.new_task {
            self.new_task_page(window, cx)
        } else if let Some(task) = self.task().cloned() {
            self.task_detail(task, window, cx)
        } else {
            self.task_welcome(archived, cx)
        };
        let detail = div()
            .flex()
            .flex_col()
            .size_full()
            .min_w_0()
            .min_h_0()
            .child(detail);
        if !self.layout.task_sidebar_visible || self.tools_expanded {
            return detail.into_any_element();
        }
        use gpui_kit::component::resizable::{h_resizable, resizable_panel};
        let entity = cx.entity();
        h_resizable("task-workspace-panels")
            .with_state(&self.task_panels)
            .child(
                resizable_panel()
                    .size(px(self.layout.task_sidebar_width))
                    .size_range(px(220.)..px(440.))
                    .child(list),
            )
            .child(
                resizable_panel()
                    .size_range(px(400.)..Pixels::MAX)
                    .child(detail),
            )
            .on_resize(move |state, _, cx| {
                if let Some(width) = state.read(cx).sizes().first().copied() {
                    entity.update(cx, |this, cx| {
                        this.layout.task_sidebar_width = f32::from(width).round().clamp(220., 440.);
                        this.save_layout(cx);
                    });
                }
            })
            .into_any_element()
    }

    pub(super) fn save_layout(&mut self, cx: &mut Context<Self>) {
        if let Err(error) = self.storage.save_layout(&self.layout) {
            self.error = Some(error.to_string());
        }
        cx.notify();
    }

    pub(super) fn toggle_task_sidebar(&mut self, cx: &mut Context<Self>) {
        if matches!(self.page, Page::Tasks | Page::Archived) && !self.search_open {
            if self.tools_expanded {
                self.tools_expanded = false;
                self.layout.task_sidebar_visible = true;
            } else {
                self.layout.task_sidebar_visible = !self.layout.task_sidebar_visible;
            }
            self.save_layout(cx);
        }
    }

    fn task_welcome(&self, archived: bool, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .items_center()
            .justify_center()
            .p_6()
            .gap_3()
            .child(
                div()
                    .size(px(48.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(12.))
                    .bg(cx.theme().muted)
                    .child(
                        Icon::new(if archived {
                            UiIcon::Archive
                        } else {
                            UiIcon::Bot
                        })
                        .size(px(26.))
                        .text_color(cx.theme().primary),
                    ),
            )
            .child(
                div()
                    .text_size(px(20.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(if archived {
                        "Archived tasks"
                    } else {
                        "Your agent workspace"
                    }),
            )
            .child(
                div()
                    .max_w(px(360.))
                    .text_center()
                    .text_color(cx.theme().muted_foreground)
                    .child(if self.snapshot.is_none() {
                        "Connect a computer to work with its projects and agents."
                    } else {
                        "Open a task to pick up your work, or start a new conversation."
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .justify_center()
                    .gap_2()
                    .mt_2()
                    .when(self.snapshot.is_some(), |actions| {
                        actions
                            .child(
                                Button::new("welcome-new-task")
                                    .primary()
                                    .small()
                                    .icon(UiIcon::Plus)
                                    .label("New task")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.page = Page::Tasks;
                                        this.new_task = true;
                                        this.read_task_agents();
                                        cx.notify();
                                    })),
                            )
                            .when(!self.layout.task_sidebar_visible, |actions| {
                                actions.child(
                                    Button::new("welcome-browse-tasks")
                                        .ghost()
                                        .small()
                                        .icon(UiIcon::PanelLeft)
                                        .label("Browse tasks")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.layout.task_sidebar_visible = true;
                                            this.save_layout(cx);
                                        })),
                                )
                            })
                            .child(
                                Button::new("welcome-projects")
                                    .ghost()
                                    .small()
                                    .icon(UiIcon::FolderGit2)
                                    .label("Projects")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.navigate(Page::Projects, cx)
                                    })),
                            )
                    })
                    .when(self.snapshot.is_none(), |actions| {
                        actions.child(
                            Button::new("welcome-connect")
                                .primary()
                                .small()
                                .icon(UiIcon::Monitor)
                                .label("Connect computer")
                                .on_click(
                                    cx.listener(|this, _, _, cx| {
                                        this.navigate(Page::Computers, cx)
                                    }),
                                ),
                        )
                    }),
            )
            .child(
                div()
                    .mt_3()
                    .text_size(px(11.))
                    .text_color(cx.theme().muted_foreground)
                    .child(format!(
                        "{} new task   ·   {} search",
                        super::shell::shortcut("N"),
                        super::shell::shortcut("K")
                    )),
            )
            .into_any_element()
    }

    fn new_task_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(snapshot) = self.snapshot.clone() else {
            return Self::empty(
                "Connect a computer",
                "Pair a runtime to access its projects and agents.",
            );
        };
        let title = self.field(
            "new-task-title",
            "Task title",
            "",
            "What are you working on?",
            window,
            cx,
        );
        let repos = snapshot.workspace.repositories.clone();
        let agents = match self.task_agent_options() {
            Ok(agents) => agents,
            Err(error) => return Self::empty("Invalid agent configurations", &error.to_string()),
        };
        let mut form = div()
            .id("new-task-form")
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_4()
            .p_6()
            .max_w(px(700.))
            .child(Self::header(
                "New task",
                "Choose a project and agent, then describe what you want to build.",
            ))
            .child(title)
            .child("Project")
            .children(repos.iter().map(|repo| {
                let id = repo.id.clone();
                Button::new(SharedString::from(format!("project-{id}")))
                    .label(format!("{} · {}", repo.name, repo.path))
                    .selected(self.selected_repository.as_ref() == Some(&id))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.selected_repository = Some(id.clone());
                        this.selected_agent = None;
                        this.new_task_template = None;
                        this.read_task_agents();
                        cx.notify();
                    }))
            }))
            .child("Agent")
            .child(
                Button::new("use-default-harness")
                    .label("Use task defaults")
                    .selected(self.selected_agent.is_none())
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.selected_agent = None;
                        if let Some((_, template)) = this.new_task_template.as_mut() {
                            template.clear_agent();
                        }
                        cx.notify();
                    })),
            )
            .children(agents.iter().map(|agent| {
                let id = agent.id.clone();
                Button::new(SharedString::from(format!("agent-{id}")))
                    .label(format!(
                        "{} · {} {}",
                        agent.name,
                        agent.provider.name(),
                        agent.model
                    ))
                    .selected(self.selected_agent.as_ref() == Some(&id))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.selected_agent = Some(id.clone());
                        if let Some((_, template)) = this.new_task_template.as_mut() {
                            template.clear_agent();
                        }
                        cx.notify();
                    }))
            }));
        if repos.is_empty() {
            form = form.child(
                Button::new("add-first-project")
                    .label("Add a project")
                    .on_click(cx.listener(|this, _, _, cx| this.navigate(Page::Projects, cx))),
            );
        }
        if agents.is_empty() {
            form = form.child(
                Button::new("add-first-agent")
                    .label("Set up an agent")
                    .on_click(cx.listener(|this, _, _, cx| this.navigate(Page::Agents, cx))),
            );
        }
        let checkout = snapshot
            .workspace
            .repositories
            .iter()
            .find(|repo| self.selected_repository.as_ref() == Some(&repo.id));
        if let Some(repo) = checkout {
            form = form.child(self.new_task_templates(repo, cx));
            match super::task_defaults::resolve(&snapshot, repo) {
                Ok(defaults) => {
                    form = form.child(format!(
                        "Effective checkout: {:?}",
                        defaults.execution(repo.kind.is_some(), self.execution_worktree)
                    ))
                }
                Err(error) => {
                    return form
                        .child(format!("Invalid task defaults: {error}"))
                        .into_any_element();
                }
            }
        }
        form = form.child(self.text_field(
            "new-task-objective",
            "Initial request",
            "",
            "Ready to edit before sending",
            window,
            cx,
        ));
        form = form.child(self.linked_checkout_fields("new-task-links", json!([]), window, cx));
        form.child(div().flex().gap_2().children([(None,"Inherit checkout"),(Some(false),"Main project"),(Some(true),"Isolated worktree")].into_iter().map(|(choice,label)|Button::new(label).label(label).selected(self.execution_worktree==choice).on_click(cx.listener(move|this,_,_,cx|{this.execution_worktree=choice;cx.notify();})))) )
            .child(Button::new("create-task").primary().label("Create task").disabled(!self.online || self.selected_repository.is_none() || self.pending.iter().any(|key|key.starts_with("create-task:"))).on_click(cx.listener(|this, _, _, cx| {
                let title = this.value("new-task-title", cx);
                if title.trim().is_empty() { this.error = Some("Enter a task title".into()); cx.notify(); return; }
                let id = uuid::Uuid::new_v4().to_string();
                let repository_id = this.selected_repository.clone().unwrap_or_default();
                let Some(snapshot)=this.snapshot.as_ref() else {return};
                let Some(repository)=snapshot.workspace.repositories.iter().find(|repo|repo.id==repository_id) else {return};
                let agents=match this.task_agent_options(){Ok(agents)=>agents,Err(error)=>{this.error=Some(error.to_string());cx.notify();return;}};
                let selected=this.selected_agent.as_ref().and_then(|id|agents.iter().find(|agent|&agent.id==id));
                if this.selected_agent.is_some() && selected.is_none(){this.error=Some("The selected agent is no longer available in this project".into());cx.notify();return;}
                let checkout=match super::task_defaults::task_fields(snapshot,repository,this.execution_worktree,selected) {Ok(fields)=>fields,Err(error)=>{this.error=Some(error.to_string());cx.notify();return;}};
                let mut value = json!({"id":id,"title":title.trim(),"repositoryId":repository_id,"agentId":this.selected_agent.as_deref().unwrap_or_default(),"status":"draft","createdAt":chrono::Utc::now().to_rfc3339(),"messages":[],"files":[],"draft":this.text_value("new-task-objective",cx),"example":false});
                if let Some(fields)=checkout.as_object(){for (field,setting) in fields{value[field]=setting.clone();}}
                if let Some((repo,template))=&this.new_task_template && repo==&repository_id {
                    if let Some(fields)=project_presets::template_fields(template).as_object() {for (field,setting) in fields {if field!="draft"&&field!="execution" {value[field]=setting.clone();}}}
                    if repository.kind.is_some() {value["execution"]=json!("main");value["worktreeFromOrigin"]=json!(false);value.as_object_mut().map(|value|value.remove("setupCommand"));}
                }
                value["linkedCheckouts"] = match this.linked_checkout_value("new-task-links", cx) {Ok(links)=>links, Err(error)=>{this.error=Some(error.to_string());cx.notify();return;}};
                this.responses.insert(format!("create-task-draft:{id}"),value["draft"].clone());
                match WorkspacePatch::create("tasks", value) { Ok(patch) => this.patch(format!("create-task:{id}"), patch), Err(error) => this.error = Some(error.to_string()) }
                cx.notify();
            }))).into_any_element()
    }

    fn task_detail(
        &mut self,
        task: Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.task_workspace(&task, window, cx)
    }

    pub(super) fn open_task_tab(
        &mut self,
        tab: TaskTab,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(task_id) = self.selected_task.clone() else {
            return;
        };
        if tab != TaskTab::Chat {
            self.last_tool = tab;
        }
        if self.tab == TaskTab::Devices && tab != TaskTab::Devices {
            self.command(Command::DeviceClose);
            self.device_preview = None;
        }
        self.tab = tab;
        if tab == TaskTab::Chat {
            self.tools_expanded = false;
        }
        // A tab change removes the focused editor or terminal from the dispatch tree.
        // Keep workspace shortcuts reachable until the next editor claims focus.
        window.focus(&self.focus, cx);
        match tab {
            TaskTab::Changes => {
                if let Some(task) = self.task().cloned()
                    && !self.snapshot.as_ref().is_some_and(|snapshot| {
                        snapshot
                            .workspace
                            .repositories
                            .iter()
                            .any(|repo| repo.id == task.repository_id && repo.kind.is_some())
                    })
                {
                    self.request(
                        format!("changes:{task_id}"),
                        "/api/scm/changes",
                        json!({"repositoryId":task.repository_id,"taskId":task_id}),
                    );
                }
            }
            TaskTab::Artifacts => {
                self.request("artifact-library", "/api/artifacts/library", json!({}))
            }
            TaskTab::Review => self.refresh_task_review(&task_id),
            TaskTab::Devices => {
                self.request(
                    format!("preview-devices:{task_id}"),
                    "/api/previews/devices",
                    json!({"taskId":task_id}),
                );
                self.request_method(
                    "device-host-settings",
                    Method::GET,
                    "/api/device-hosts",
                    json!({}),
                );
            }
            TaskTab::Files => self.request(
                format!("files:{task_id}"),
                "/api/tasks/files/list",
                json!({"id":task_id}),
            ),
            _ => {}
        }
        cx.notify();
    }

    pub(super) fn conversation(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut root = div().flex().flex_col().flex_1().min_h_0();
        let cursor = self
            .history_cursor
            .get(&task.id)
            .cloned()
            .unwrap_or_else(|| task.history_before.clone());
        if let Some(cursor) = cursor {
            let id = task.id.clone();
            root = root.child(
                Button::new("older-messages")
                    .ghost()
                    .label("Load earlier messages")
                    .disabled(self.pending.contains(&format!("history:{id}")))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            format!("history:{id}"),
                            "/api/tasks/history",
                            json!({"id":id,"before":cursor}),
                        );
                        cx.notify();
                    })),
            );
        }
        let mut references = Vec::new();
        collect_mcp_references(
            &serde_json::to_value(task).unwrap_or(Value::Null),
            &mut references,
        );
        collect_mcp_references(
            &serde_json::to_value(&self.activity).unwrap_or(Value::Null),
            &mut references,
        );
        let mut seen = HashSet::new();
        for reference in references {
            let Some(id) = reference
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
            else {
                continue;
            };
            if !seen.insert(id.clone()) {
                continue;
            }
            let title = reference
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("MCP app")
                .to_owned();
            let task_id = task.id.clone();
            root = root.child(
                Button::new(SharedString::from(format!("mcp-open-{id}")))
                    .label(format!("Open app · {title}"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            format!("mcp-read:{id}"),
                            "/api/mcp-apps/read",
                            json!({"taskId":task_id,"id":id}),
                        );
                        cx.notify();
                    })),
            );
        }
        let messages = std::sync::Arc::new(self.messages.clone());
        let task_id = task.id.clone();
        let service = self.service.clone();
        let conversation_entity = cx.entity();
        let generation = self.generation;
        let turns = self.task_with_history(task).turns;
        let conversation = list(self.list.clone(), move |index, _, cx| {
            let Some(message) = messages.get(index) else { return div().into_any_element(); };
            let id = message.id.clone();
            let task_id = task_id.clone();
            let bookmark_service = service.clone();
            let bookmarked = message.bookmarked;
            let attachment_task = task_id.clone();
            let text = message.text.clone();
            let user = message.role == Role::User;
            let turn = turns.iter().find(|turn| turn.assistant_id == message.id);
            let header = div().flex().items_center().gap_2().min_w_0()
                .child(div().flex().items_center().justify_center().size(px(24.)).flex_shrink_0().rounded(px(5.))
                    .bg(if user {cx.theme().muted} else {cx.theme().primary.opacity(0.12)})
                    .text_color(if user {cx.theme().muted_foreground} else {cx.theme().primary})
                    .child(if user { Icon::new(UiIcon::UserRound).size(px(14.)).into_any_element() } else { shell::harness_icon(turn.map(|turn|turn.provider.name()).unwrap_or(""),cx) }))
                .child(div().text_size(px(12.)).font_weight(FontWeight::SEMIBOLD).child(if user { "You" } else { "Agent" }))
                .children(turn.map(|turn| div().min_w_0().truncate().text_size(px(11.)).text_color(cx.theme().muted_foreground).child(format!("{} · {}",turn.provider.name(),if turn.model.is_empty() {"Provider default"} else {&turn.model}))));
            let actions = div().flex().items_center().gap_1()
                .child(Button::new(SharedString::from(format!("copy-{id}"))).ghost().small().icon(UiIcon::Copy)
                    .accessibility_label("Copy message").tooltip("Copy message as Markdown")
                    .on_click(move |_,_,cx| cx.write_to_clipboard(ClipboardItem::new_string(text.clone()))))
                .when(!user, |actions| actions.child(Button::new(SharedString::from(format!("bookmark-{id}"))).ghost().small()
                    .icon(if bookmarked {UiIcon::BookmarkCheck} else {UiIcon::Bookmark})
                    .accessibility_label(if bookmarked {"Remove bookmark"} else {"Bookmark message"})
                    .tooltip(if bookmarked {"Remove bookmark"} else {"Bookmark message"})
                    .on_click(move |_, _, _| {
                        if let Err(error) = bookmark_service.send(Command::Request { generation, key: format!("bookmark:{id}"), method: Method::POST, path: "/api/tasks/message/bookmark".into(), input: json!({"id":task_id,"messageId":id,"bookmarked":!bookmarked}) }) { eprintln!("Could not bookmark message: {error}"); }
                    })));
            div().w_full().flex().justify_center().child(div().px_6().py_4().w_full().max_w(px(820.))
                .child(div().flex().items_center().justify_between().gap_2().mb_2().child(header).child(actions))
                .child(div().when(user, |body| body.p_3().rounded(px(6.)).bg(cx.theme().muted.opacity(0.5)).border_1().border_color(cx.theme().border.opacity(0.5)))
                    .child(TextView::markdown(SharedString::from(format!("message-{}", message.id)), message.text.clone()).selectable(true).on_link_click(|url, _, _, cx| {
                        if url::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "mailto")) { cx.open_url(url); }
                    })))
                .children(message.attachments.iter().map(|attachment| {
                    let attachment_id=attachment.id.clone();let task=attachment_task.clone();let entity=conversation_entity.clone();
                    Button::new(SharedString::from(format!("attachment-{attachment_id}"))).ghost().label(format!("Download {}",attachment.name))
                        .on_click(move|_,_,cx|{entity.update(cx,|this,cx| {this.request(format!("attachment-read:{task}:{attachment_id}"),"/api/attachments/read",json!({"taskId":task,"id":attachment_id}));cx.notify();});})
                }))
                ).into_any_element()
        }).flex_1().min_h_0();
        root =
            if self.messages.is_empty() {
                root.child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_h_0()
                        .items_center()
                        .justify_center()
                        .p_6()
                        .gap_3()
                        .child(
                            div()
                                .size(px(44.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(px(10.))
                                .bg(cx.theme().muted)
                                .child(
                                    Icon::new(UiIcon::Bot)
                                        .size(px(24.))
                                        .text_color(cx.theme().primary),
                                ),
                        )
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .text_size(px(17.))
                                .child("What would you like to build?"),
                        )
                        .child(div().text_color(cx.theme().muted_foreground).child(
                            "Describe a change, ask a question, or start with a suggestion.",
                        ))
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .justify_center()
                                .gap_2()
                                .mt_2()
                                .children(
                                [
                                    (
                                        UiIcon::FolderSearch,
                                        "Explore project",
                                        "Explore this project and explain its structure.",
                                    ),
                                    (
                                        UiIcon::ScanEye,
                                        "Review changes",
                                        "Review the current changes and point out any problems.",
                                    ),
                                    (
                                        UiIcon::Bug,
                                        "Find an issue",
                                        "Inspect this project for a bug worth fixing.",
                                    ),
                                ]
                                .into_iter()
                                .map(|(icon, label, prompt)| {
                                    Button::new(label)
                                        .ghost()
                                        .small()
                                        .icon(icon)
                                        .label(label)
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            this.composer.update(cx, |input, cx| {
                                                input.set_value(prompt, window, cx);
                                                input.focus(window, cx);
                                            });
                                            cx.notify();
                                        }))
                                }),
                            ),
                        ),
                )
            } else {
                root.child(conversation)
            };
        if !self.activity.is_empty() {
            root = root.child(
                Button::new("tool-activity-toggle")
                    .ghost()
                    .label(format!(
                        "{} tool events {}",
                        self.activity.len(),
                        if self.activity_expanded { "▾" } else { "▸" }
                    ))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.activity_expanded = !this.activity_expanded;
                        cx.notify();
                    })),
            );
            if self.activity_expanded {
                root = root.child(
                    div()
                        .id("tool-activity")
                        .max_h(px(220.))
                        .overflow_y_scroll()
                        .p_3()
                        .children(self.activity.iter().map(|event| {
                            div()
                                .py_2()
                                .border_b_1()
                                .border_color(cx.theme().border)
                                .child(format!("{} · {}", event.kind, event.summary))
                                .child(
                                    TextView::markdown(
                                        SharedString::from(format!("activity-{}", event.id)),
                                        event.payload.chars().take(8000).collect::<String>(),
                                    )
                                    .selectable(true),
                                )
                        })),
                );
            }
        }
        root = root.child(self.native_todos(task, cx));
        if let Some(snapshot) = &self.snapshot {
            let family = crate::task_family::ids(&snapshot.workspace.tasks, &task.id);
            let approvals: Vec<_> = snapshot
                .approvals
                .iter()
                .filter(|approval| family.contains(&approval.task_id))
                .cloned()
                .collect();
            let questions: Vec<_> = snapshot
                .questions
                .iter()
                .filter(|question| family.contains(&question.task_id))
                .cloned()
                .collect();
            for approval in approvals {
                let id = approval.id.clone();
                let actions = approval.actions();
                root =
                    root.child(
                        div()
                            .p_3()
                            .mx_4()
                            .my_2()
                            .rounded_md()
                            .bg(cx.theme().warning.opacity(0.15))
                            .child(approval.title)
                            .child(TextView::markdown(
                                SharedString::from(format!("approval-{id}")),
                                approval.detail,
                            ))
                            .child(div().flex().gap_2().mt_2().children(
                                actions.into_iter().map(
                                    |(decision, label)| {
                                        let id = id.clone();
                                        Button::new(label).label(label).on_click(cx.listener(
                                            move |this, _, _, cx| {
                                                this.request(
                                                    format!("approval:{id}"),
                                                    "/api/approvals",
                                                    json!({"id":id,"allow":decision!="deny","remember":decision=="always","decision":decision}),
                                                );
                                                cx.notify();
                                            },
                                        ))
                                    },
                                ),
                            )),
                    );
            }
            for question in questions {
                let question_id = question.id.clone();
                let mut form = div()
                    .p_3()
                    .mx_4()
                    .my_2()
                    .rounded_md()
                    .bg(cx.theme().info.opacity(0.15))
                    .child(question.prompt.title);
                for field in &question.prompt.questions {
                    let selected = self
                        .question_choices
                        .get(&question_id)
                        .and_then(|answers| answers.get(&field.id))
                        .cloned()
                        .unwrap_or_default();
                    form = form.child(div().mt_3().mb_2().child(field.question.clone()));
                    for option in &field.options {
                        let question_id = question_id.clone();
                        let field_id = field.id.clone();
                        let multiple = field.multiple;
                        let value = option.value.clone();
                        form = form.child(
                            Button::new(SharedString::from(format!(
                                "question-{question_id}-{field_id}-{value}"
                            )))
                            .label(option.label.clone())
                            .selected(selected.contains(&value))
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    let answers = this
                                        .question_choices
                                        .entry(question_id.clone())
                                        .or_default()
                                        .entry(field_id.clone())
                                        .or_default();
                                    if multiple {
                                        if answers.contains(&value) {
                                            answers.retain(|answer| answer != &value);
                                        } else {
                                            answers.push(value.clone());
                                        }
                                    } else {
                                        *answers = vec![value.clone()];
                                    }
                                    cx.notify();
                                },
                            )),
                        );
                    }
                    if field.custom {
                        let key = format!("question-{question_id}-{}", field.id);
                        let existed = self.inputs.contains_key(&key);
                        let input = self.input(&key, "", "Your answer", window, cx);
                        if field.secret && !existed {
                            input.update(cx, |state, cx| state.set_masked(true, window, cx));
                        }
                        form = form.child(Input::new(&input));
                    }
                }
                root = root.child(
                    form.child(
                        Button::new(SharedString::from(format!("answer-{question_id}")))
                            .primary()
                            .label("Submit answer")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let mut answers = this
                                    .question_choices
                                    .get(&question_id)
                                    .cloned()
                                    .unwrap_or_default();
                                for field in &question.prompt.questions {
                                    let custom = this
                                        .value(&format!("question-{question_id}-{}", field.id), cx);
                                    if !custom.trim().is_empty() {
                                        if field.multiple {
                                            answers
                                                .entry(field.id.clone())
                                                .or_default()
                                                .push(custom);
                                        } else {
                                            answers.insert(field.id.clone(), vec![custom]);
                                        }
                                    }
                                    if field.required
                                        && answers.get(&field.id).is_none_or(Vec::is_empty)
                                    {
                                        this.error = Some(format!("Answer {}", field.header));
                                        cx.notify();
                                        return;
                                    }
                                }
                                this.request(
                                    format!("answer:{question_id}"),
                                    "/api/tasks/answer",
                                    json!({"id":question_id,"answers":answers}),
                                );
                                cx.notify();
                            })),
                    ),
                );
            }
        }
        if !task.queue.is_empty() {
            let id = task.id.clone();
            let paused = task.queue_paused;
            root = root.child(div().p_3().mx_4().rounded_md().bg(cx.theme().muted)
                .child(div().flex().justify_between().child(format!("{} queued messages", task.queue.len())).child(Button::new("queue-pause").ghost().label(if paused {"Resume queue"} else {"Pause queue"}).on_click(cx.listener(move |this, _, _, cx| { this.request(format!("queue:{id}"), "/api/tasks/queue", json!({"id":id,"action":if paused {"resume"} else {"pause"}})); cx.notify(); }))))
                .children(task.queue.iter().map(|message| {
                    let id = task.id.clone(); let message_id = message.id.clone();
                    div().flex().items_center().justify_between().child(message.text.clone()).child(Button::new(SharedString::from(format!("remove-{message_id}"))).ghost().label("Remove").on_click(cx.listener(move |this, _, _, cx| { this.request(format!("queue-remove:{message_id}"), "/api/tasks/queue", json!({"id":id,"action":"remove","messageId":message_id})); cx.notify(); })))
                })));
        }
        if !task.is_archived() {
            for key in self.failed_sends.clone() {
                if let Some((task_id, text)) = self
                    .pending_sends
                    .get(&key)
                    .filter(|(id, _)| id == &task.id)
                    .cloned()
                {
                    let retry_key = key.clone();
                    let discard_key = key.clone();
                    root=root.child(div().p_3().mx_4().rounded_md().bg(cx.theme().warning.opacity(0.15)).child(format!("Delivery needs checking: {text}"))
                        .child(div().flex().gap_2().mt_2()
                            .child(Button::new(SharedString::from(format!("retry-{key}"))).label("Check receipt / retry").disabled(self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx| {this.pending.insert(retry_key.clone());this.command(Command::RetryMessage(retry_key.clone()));cx.notify();})))
                            .child(Button::new(SharedString::from(format!("discard-{key}"))).ghost().label("Discard saved retry").on_click(cx.listener(move|this,_,_,cx| {this.command(Command::DiscardMessage(discard_key.clone()));this.notice=Some("Discarding a saved retry does not cancel a message already accepted by the runtime.".into());cx.notify();})))));
                    let _ = task_id;
                }
            }
            let running = task.status == TaskStatus::Running;
            let sending = self.pending_sends.values().any(|(id, _)| id == &task.id);
            let empty = self.composer.read(cx).value().trim().is_empty()
                && task.draft_attachments.is_empty();
            let composer_focused = self.composer.read(cx).focus_handle(cx).is_focused(window);
            let attachment_pending = self.pending.iter().any(|key| {
                key == &format!("attachment-pick:{}", task.id)
                    || key == &format!("attachment-upload:{}", task.id)
                    || key.starts_with(&format!("attachment-remove:{}:", task.id))
            });
            let mut controls = div()
                .flex()
                .flex_wrap()
                .gap_2()
                .items_center()
                .justify_between()
                .mt_2()
                .child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(if !self.online {
                            "Offline · drafts saved locally".into()
                        } else if running {
                            format!(
                                "{} to queue · Steer changes this run",
                                super::shell::shortcut("Enter")
                            )
                        } else {
                            format!(
                                "{} to send · @ files · / commands",
                                super::shell::shortcut("Enter")
                            )
                        }),
                );
            let mut buttons = div().flex().gap_2();
            if running {
                let id = task.id.clone();
                let run_id = task.active_run_id.clone();
                buttons = buttons
                    .child(
                        Button::new("stop-task")
                            .small()
                            .icon(UiIcon::Square)
                            .label("Stop")
                            .disabled(run_id.is_none())
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(
                                    format!("cancel:{id}"),
                                    "/api/tasks/cancel",
                                    json!({"id":id,"runId":run_id}),
                                );
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("steer-task")
                            .small()
                            .label("Steer")
                            .disabled(
                                sending
                                    || !self.online
                                    || task.active_run_id.is_none()
                                    || empty
                                    || attachment_pending,
                            )
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.submit_message(true, window, cx)
                            })),
                    );
            }
            buttons = buttons.child(
                Button::new("send-message")
                    .primary()
                    .small()
                    .icon(UiIcon::ArrowUp)
                    .label(if sending {
                        "Sending…"
                    } else if running {
                        "Queue"
                    } else {
                        "Send"
                    })
                    .disabled(!self.online || sending || empty || attachment_pending)
                    .on_click(
                        cx.listener(|this, _, window, cx| this.submit_message(false, window, cx)),
                    ),
            );
            let uploading = self
                .pending
                .contains(&format!("attachment-upload:{}", task.id))
                || self
                    .pending
                    .contains(&format!("attachment-pick:{}", task.id));
            buttons = buttons.child(
                Button::new("attach-file")
                    .ghost()
                    .small()
                    .icon(UiIcon::Paperclip)
                    .label(if uploading {
                        "Uploading…"
                    } else {
                        "Attach file"
                    })
                    .disabled(uploading || !self.online || task.draft_attachments.len() >= 5)
                    .on_click(cx.listener(|this, _, _, cx| this.pick_attachment(cx))),
            );
            controls = controls.child(buttons);
            for attachment in &task.draft_attachments {
                let id = attachment.id.clone();
                let task_id = task.id.clone();
                controls = controls.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(format!("{} · {} bytes", attachment.name, attachment.size))
                        .child(
                            Button::new(SharedString::from(format!("remove-attachment-{id}")))
                                .ghost()
                                .label("Remove")
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.request(
                                        format!("attachment-remove:{task_id}:{id}"),
                                        "/api/attachments/remove",
                                        json!({"taskId":task_id,"id":id}),
                                    );
                                    cx.notify();
                                })),
                        ),
                );
            }
            root = root.child(
                div()
                    .flex()
                    .justify_center()
                    .flex_shrink_0()
                    .px_5()
                    .pt_3()
                    .pb_4()
                    .child(
                        div()
                            .id("task-composer")
                            .w_full()
                            .max_w(px(820.))
                            .p_3()
                            .rounded(px(6.))
                            .bg(cx.theme().muted)
                            .border_1()
                            .border_color(if composer_focused {
                                cx.theme().primary.opacity(0.65)
                            } else {
                                cx.theme().border
                            })
                            .child(self.composer_context(task, cx))
                            .child(self.saved_prompt_choices(task, cx))
                            .child(self.composer_editor(task, window, cx))
                            .child(controls),
                    ),
            );
        }
        root.into_any_element()
    }

    pub(super) fn changes_page(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let files: Vec<crate::model::ChangedFile> = match self
            .responses
            .get(&format!("changes:{}", task.id))
        {
            Some(value) => {
                match serde_json::from_value(value.get("files").cloned().unwrap_or(Value::Null)) {
                    Ok(files) => files,
                    Err(error) => return Self::empty("Could not load changes", &error.to_string()),
                }
            }
            None => task.files.clone(),
        };
        if files.is_empty() {
            return Self::empty("No changes", "Changes made by the agent appear here.");
        }
        let selected = self
            .selected_file
            .clone()
            .or_else(|| files.first().map(|file| file.path.clone()));
        let file = files
            .iter()
            .find(|file| Some(&file.path) == selected.as_ref())
            .cloned();
        let file_list = div()
            .flex()
            .flex_col()
            .id("changed-files-list")
            .max_h(px(150.))
            .flex_shrink_0()
            .overflow_y_scroll()
            .p_2()
            .gap_1()
            .children(files.iter().map(|file| {
                let path = file.path.clone();
                Button::new(SharedString::from(path.clone()))
                    .ghost()
                    .compact()
                    .small()
                    .w_full()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .w_full()
                            .min_w_0()
                            .child(Icon::new(UiIcon::File).size(px(13.)))
                            .child(div().truncate().child(path.clone())),
                    )
                    .selected(selected.as_ref() == Some(&path))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.selected_file = Some(path.clone());
                        cx.notify();
                    }))
            }));
        let Some(file) = file else {
            return Self::empty("Select a file", "Choose a changed file to review it.");
        };
        let key = format!("edit-{}-{}", task.id, file.path);
        let editor = self.code_editor(&key, &file.path, &file.after, window, cx);
        let diff = self.changed_file_diff(&key, &file.path, &file.before, &file.after, cx);
        let path = file.path.clone();
        let repository_id = task.repository_id.clone();
        let task_id = task.id.clone();
        let staged_paths: Vec<_> = files.iter().map(|file| file.path.clone()).collect();
        let commit = self.input("commit-message", "", "Commit message", window, cx);
        div().flex().flex_col().flex_1().min_w_0().min_h_0().child(file_list)
            .child(div().id("diff-view").flex().flex_col().flex_1().min_w_0().min_h_0().overflow_y_scroll().p_3().gap_2()
                .child(div().font_weight(FontWeight::SEMIBOLD).child(file.path.clone()))
                .child(diff)
                .child("After · editable draft")
                .child(Editor::new(&editor).h(px(350.)).flex_shrink_0())
                .child(Button::new("apply-file").label("Apply draft to disk").on_click(cx.listener(move |this, _, _, cx| {
                    this.request(format!("apply:{task_id}:{path}"), "/api/scm/apply", json!({"repositoryId":repository_id,"taskId":task_id,"path":path,"expected":file.disk_contents.as_ref().unwrap_or(&file.after),"contents":this.code_value(&key,cx)})); cx.notify();
                })))
                .child(div().flex().flex_wrap().gap_2().child(Button::new("stage-files").label("Stage all changes").on_click(cx.listener({ let task = task.clone(); move |this, _, _, cx| { this.request(format!("stage:{}", task.id), "/api/scm/stage", json!({"repositoryId":task.repository_id,"taskId":task.id,"paths":staged_paths})); cx.notify(); } }))).child(Input::new(&commit))
                    .child(Button::new("commit-files").primary().label("Commit").on_click(cx.listener({ let task = task.clone(); move |this, _, _, cx| { this.request(format!("commit:{}", task.id), "/api/scm/commit", json!({"repositoryId":task.repository_id,"taskId":task.id,"message":this.value("commit-message",cx)})); cx.notify(); } })))))
            .into_any_element()
    }

    pub(super) fn files_page(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let files: Vec<String> = match self.responses.get(&format!("files:{}", task.id)) {
            Some(value) => {
                match serde_json::from_value(value.get("files").cloned().unwrap_or(Value::Null)) {
                    Ok(files) => files,
                    Err(error) => {
                        return Self::empty("Could not load project files", &error.to_string());
                    }
                }
            }
            None => vec![],
        };
        let selected = self.selected_file.clone();
        let mut root = div().flex().flex_col().flex_1().min_w_0().min_h_0().child(
            div()
                .id("files-list")
                .max_h(px(160.))
                .flex_shrink_0()
                .overflow_y_scroll()
                .p_2()
                .children(files.into_iter().map(|path| {
                    let id = task.id.clone();
                    Button::new(SharedString::from(path.clone()))
                        .ghost()
                        .compact()
                        .small()
                        .w_full()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .w_full()
                                .min_w_0()
                                .child(Icon::new(UiIcon::File).size(px(13.)))
                                .child(div().truncate().child(path.clone())),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.selected_file = Some(path.clone());
                            this.request(
                                format!("file:{id}:{path}"),
                                "/api/tasks/files/read",
                                json!({"id":id,"path":path}),
                            );
                            cx.notify();
                        }))
                })),
        );
        if let Some(path) = selected {
            let response_key = format!("file:{}:{path}", task.id);
            if let Some(contents) = self
                .responses
                .get(&response_key)
                .and_then(|value| value.get("contents"))
                .and_then(Value::as_str)
                .map(str::to_owned)
            {
                let key = format!("file-editor:{}:{path}", task.id);
                let editor = self.code_editor(&key, &path, &contents, window, cx);
                let id = task.id.clone();
                root = root.child(div().flex().flex_col().flex_1().min_h_0().min_w_0().p_2().gap_2().child(Editor::new(&editor).flex_1().min_h_0()).child(div().flex().items_center().justify_between().gap_2().child(div().truncate().text_size(px(11.)).child(path.clone())).child(Button::new("save-file").ghost().small().icon(UiIcon::Save).label("Save").on_click(cx.listener(move |this, _, _, cx| { this.request(format!("save:{id}:{path}"), "/api/tasks/files/write", json!({"id":id,"path":path,"contents":this.code_value(&key,cx),"expectedContents":contents})); cx.notify(); })))));
            } else {
                root = root.child(Self::empty(
                    "Loading file…",
                    "File contents are read from the runtime.",
                ));
            }
        } else {
            root = root.child(Self::empty(
                "Project files",
                "Choose a file to read or edit it.",
            ));
        }
        root.into_any_element()
    }

    pub(super) fn terminal_page(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let command = self.input(
            "terminal-command",
            "",
            "Command to run in the task's shell",
            window,
            cx,
        );
        let task_id = task.id.clone();
        let terminals: Vec<_> = self
            .snapshot
            .as_ref()
            .map(|snapshot| {
                snapshot
                    .terminals
                    .iter()
                    .filter(|terminal| terminal.task_id == task.id)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let screen = self.native_terminal(window, cx);
        div().id("terminal-pane").flex().flex_col().size_full().min_h_0().min_w_0()
            .child(div().h(px(32.)).flex_shrink_0().flex().items_center().gap_1().px_2().bg(cx.theme().sidebar).border_b_1().border_color(cx.theme().border)
                .child(Icon::new(UiIcon::SquareTerminal).size(px(14.)).text_color(cx.theme().muted_foreground))
                .child(div().id("terminal-tabs").flex().flex_1().min_w_0().overflow_x_scroll().gap_1().children(terminals.into_iter().map(|terminal| {
                    let id=terminal.id.clone();let close=id.clone();
                    div().flex().items_center().gap_1()
                        .child(Button::new(SharedString::from(format!("terminal-tab:{id}"))).ghost().compact().small().label(terminal.title).selected(self.selected_terminal.as_ref()==Some(&id))
                            .on_click(cx.listener(move|this,_,_,cx|{this.selected_terminal=Some(id.clone());this.terminal_screens.entry(id.clone()).or_insert_with(||vt100::Parser::new(30,100,10_000));this.command(Command::OpenTerminal(id.clone()));cx.notify();})))
                        .child(shell::icon_button(SharedString::from(format!("close-terminal:{close}")),UiIcon::X,"Close terminal session").w(px(20.)).h(px(20.))
                            .on_click(cx.listener(move|this,_,_,cx|{this.request(format!("close-terminal:{close}"),"/api/terminals/close",json!({"id":close}));cx.notify();})))
                })))
                .child(shell::icon_button("hide-terminal",UiIcon::PanelBottom,"Hide terminal").on_click(cx.listener(|this,_,window,cx|this.set_bottom_terminal(false,window,cx)))))
            .child(screen)
            .child(div().flex_shrink_0().px_2().child(self.project_terminal_actions(task,cx)))
            .child(div().flex_shrink_0().flex().items_center().gap_2().p_1().border_t_1().border_color(cx.theme().border)
                .child(div().flex_1().min_w_0().child(Input::new(&command).small()))
                .child(Button::new("run-terminal-command").ghost().compact().small().icon(UiIcon::Play).label("Run").disabled(!self.online)
                    .on_click(cx.listener(move|this,_,_,cx|{this.request(format!("terminal-run:{task_id}"),"/api/terminals/run",json!({"taskId":task_id,"command":this.value("terminal-command",cx)}));cx.notify();}))))
            .into_any_element()
    }
}

fn collect_mcp_references(value: &Value, output: &mut Vec<Value>) {
    match value {
        Value::Object(object) => {
            if let Some(Value::Array(apps)) = object.get("mcpApps") {
                output.extend(apps.iter().cloned());
            }
            for (key, value) in object {
                if key != "mcpApps" {
                    collect_mcp_references(value, output);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_mcp_references(value, output);
            }
        }
        Value::String(text) => {
            if text.contains("\"mcpApps\"")
                && let Ok(value) = serde_json::from_str::<Value>(text)
            {
                collect_mcp_references(&value, output);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn attention_filters_include_child_approvals_without_crossing_task_families() {
        let task = |id: &str, parent: Option<&str>| {
            let mut value = json!({"id":id,"title":"Task","repositoryId":"repo","agentId":"agent","status":"running","createdAt":"now","messages":[],"files":[],"draft":"","example":false});
            if let Some(parent) = parent {
                value["delegation"] = json!({"parentTaskId":parent});
            }
            serde_json::from_value::<Task>(value).unwrap()
        };
        let tasks = vec![
            task("parent", None),
            task("child", Some("parent")),
            task("other", None),
        ];
        let mut snapshot: Snapshot = serde_json::from_value(json!({"revision":1,"workspace":{"version":1,"agents":[],"repositories":[],"tasks":tasks,"automations":[],"runtimeAddress":""},"approvals":[{"id":"approval","taskId":"child","title":"Approve","detail":"Private","kind":"tool","createdAt":"now"}],"questions":[],"terminals":[],"runs":[],"devices":[],"pendingDevices":[],"owner":true})).unwrap();
        let tasks = snapshot.workspace.tasks.clone();
        assert_eq!(needs_input(&tasks[0], &snapshot), Some("Approval"));
        assert!(TaskFilter::Attention.includes(&tasks[0], &snapshot));
        assert!(!TaskFilter::Attention.includes(&tasks[2], &snapshot));
        assert!(TaskFilter::Active.includes(&tasks[2], &snapshot));
        snapshot.approvals.clear();
        assert!(!TaskFilter::Attention.includes(&tasks[0], &snapshot));
        let mut failed = tasks[0].clone();
        failed.status = TaskStatus::Failed;
        assert!(TaskFilter::Attention.includes(&failed, &snapshot));
        assert!(!TaskFilter::Active.includes(&failed, &snapshot));
    }
}
