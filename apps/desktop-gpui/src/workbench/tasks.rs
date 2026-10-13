use super::*;
use gpui_kit::prelude::FluentBuilder;

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
                .cmp(&a.pinned)
                .then_with(|| b.created_at.cmp(&a.created_at))
        });
        let list = div()
            .flex()
            .flex_col()
            .w(px(265.))
            .flex_shrink_0()
            .border_r_1()
            .border_color(cx.theme().border)
            .child(div().p_3().child(Input::new(&search)))
            .child(
                div()
                    .id("task-list")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .children(tasks.into_iter().map(|task| {
                        let id = task.id.clone();
                        div()
                            .id(SharedString::from(task.id))
                            .p_3()
                            .border_b_1()
                            .border_color(cx.theme().border)
                            .cursor_pointer()
                            .bg(if self.selected_task.as_ref() == Some(&id) {
                                cx.theme().secondary
                            } else {
                                cx.theme().background
                            })
                            .hover(|style| style.bg(cx.theme().muted))
                            .child(div().font_weight(FontWeight::MEDIUM).child(format!(
                                "{}{}",
                                if task.pinned.unwrap_or(false) {
                                    "● "
                                } else {
                                    ""
                                },
                                task.title
                            )))
                            .child(
                                div()
                                    .mt_1()
                                    .text_xs()
                                    .text_color(if task.status == TaskStatus::Running {
                                        cx.theme().success
                                    } else {
                                        cx.theme().muted_foreground
                                    })
                                    .child(task.status.label()),
                            )
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.select_task(id.clone(), window, cx)
                            }))
                    })),
            );
        let detail = if self.new_task {
            self.new_task_page(window, cx)
        } else if let Some(task) = self.task().cloned() {
            self.task_detail(task, window, cx)
        } else {
            Self::empty(
                if archived {
                    "Archived tasks"
                } else {
                    "Your agent workspace"
                },
                "Choose a task, or create one to start working with an agent.",
            )
        };
        div()
            .flex()
            .size_full()
            .child(list)
            .child(div().flex().flex_col().flex_1().min_w_0().child(detail))
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
                "The selected runtime owns execution, files and credentials.",
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
        let title = task.title.clone();
        let task_id = task.id.clone();
        let tabs = [
            (TaskTab::Chat, "Chat"),
            (TaskTab::Changes, "Changes"),
            (TaskTab::Terminal, "Terminal"),
            (TaskTab::Files, "Files"),
            (TaskTab::Browser, "Browser"),
            (TaskTab::Details, "Details"),
            (TaskTab::SideChats, "Side chats"),
            (TaskTab::Agents, "Agents"),
            (TaskTab::Review, "Review"),
            (TaskTab::Devices, "Devices"),
        ];
        let header = div().flex().items_center().justify_between().p_3().border_b_1().border_color(cx.theme().border)
            .child(div().flex().flex_col().gap_1().child(div().font_weight(FontWeight::SEMIBOLD).child(title)).child(div().text_xs().text_color(cx.theme().muted_foreground).child(task.status.label())))
            .child(div().flex().gap_2()
                .child(Button::new("pin-task").ghost().label(if task.pinned.unwrap_or(false) { "Unpin" } else { "Pin" }).on_click(cx.listener({ let task = task.clone(); move |this, _, _, cx| { this.patch(format!("pin:{}", task.id), WorkspacePatch::update("tasks", task.id.clone(), "pinned", json!(task.pinned), json!(!task.pinned.unwrap_or(false)))); cx.notify(); } })))
                .child(Button::new("archive-task").ghost().label(if task.is_archived() { "Restore" } else { "Archive" }).disabled(task.status == TaskStatus::Running).on_click(cx.listener({ let task = task.clone(); move |this, _, _, cx| { this.request(format!("lifecycle:{}", task.id), "/api/tasks/lifecycle", json!({"id":task.id,"action":if task.is_archived() {"restore"} else {"archive"}})); cx.notify(); } }))));
        let toolbar = div()
            .id("task-tabs")
            .flex()
            .flex_wrap()
            .gap_1()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(cx.theme().border)
            .children(tabs.into_iter().map(|(tab, label)| {
                let task_id = task_id.clone();
                Button::new(label)
                    .ghost()
                    .label(label)
                    .selected(self.tab == tab)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if this.tab == TaskTab::Terminal && tab != TaskTab::Terminal {
                            this.command(Command::DetachTerminals);
                            this.selected_terminal = None;
                        }
                        if this.tab == TaskTab::Devices && tab != TaskTab::Devices {
                            this.command(Command::DeviceClose);
                            this.device_preview = None;
                        }
                        this.tab = tab;
                        match tab {
                            TaskTab::Changes => {
                                if let Some(task) = this.task().cloned()
                                    && !this.snapshot.as_ref().is_some_and(|snapshot| {
                                        snapshot.workspace.repositories.iter().any(|repo| {
                                            repo.id == task.repository_id && repo.kind.is_some()
                                        })
                                    })
                                {
                                    this.request(
                                        format!("changes:{task_id}"),
                                        "/api/scm/changes",
                                        json!({"repositoryId":task.repository_id,"taskId":task_id}),
                                    );
                                }
                            }
                            TaskTab::Review => this.refresh_task_review(&task_id),
                            TaskTab::Devices => {
                                this.request(
                                    format!("preview-devices:{task_id}"),
                                    "/api/previews/devices",
                                    json!({"taskId":task_id}),
                                );
                                this.request_method(
                                    "device-host-settings",
                                    Method::GET,
                                    "/api/device-hosts",
                                    json!({}),
                                );
                            }
                            TaskTab::Files => this.request(
                                format!("files:{task_id}"),
                                "/api/tasks/files/list",
                                json!({"id":task_id}),
                            ),
                            TaskTab::Terminal => this.request(
                                format!("terminal:{task_id}"),
                                "/api/terminals/ensure",
                                json!({"taskId":task_id}),
                            ),
                            _ => {}
                        }
                        cx.notify();
                    }))
            }));
        let content = match self.tab {
            TaskTab::Chat => self.conversation(&task, window, cx),
            TaskTab::Changes => self.changes_page(&task, window, cx),
            TaskTab::Terminal => self.terminal_page(&task, window, cx),
            TaskTab::Files => self.files_page(&task, window, cx),
            TaskTab::Browser => self.browser_page(&task, window, cx),
            TaskTab::Details => self.task_controls(&task, window, cx),
            TaskTab::SideChats => self.side_chats(&task, window, cx),
            TaskTab::Review => self.task_review_page(&task, window, cx),
            TaskTab::Agents => self.child_agents_page(&task, window, cx),
            TaskTab::Devices => self.devices_page(&task, window, cx),
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(header)
            .child(toolbar)
            .child(content)
            .into_any_element()
    }

    fn conversation(
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
        let conversation = list(self.list.clone(), move |index, _, cx| {
            let Some(message) = messages.get(index) else { return div().into_any_element(); };
            let id = message.id.clone(); let task_id = task_id.clone(); let bookmark_service = service.clone(); let bookmarked = message.bookmarked; let attachment_task=task_id.clone();
            div().px_5().py_3().w_full()
                .child(div().flex().items_center().justify_between().mb_2()
                    .child(div().text_xs().font_weight(FontWeight::SEMIBOLD).text_color(if message.role == Role::User { cx.theme().primary } else { cx.theme().success }).child(if message.role == Role::User { "You" } else { "Agent" }))
                    .when(message.role != Role::User, |header| header.child(Button::new(SharedString::from(format!("bookmark-{id}"))).ghost().label(if bookmarked { "★" } else { "☆" }).on_click(move |_, _, _| {
                        if let Err(error) = bookmark_service.send(Command::Request { generation, key: format!("bookmark:{id}"), method: Method::POST, path: "/api/tasks/message/bookmark".into(), input: json!({"id":task_id,"messageId":id,"bookmarked":!bookmarked}) }) { eprintln!("Could not bookmark message: {error}"); }
                    }))))
                .child(TextView::markdown(SharedString::from(format!("message-{}", message.id)), message.text.clone()).selectable(true).on_link_click(|url, _, _, cx| {
                    if url::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "mailto")) { cx.open_url(url); }
                }))
                .children(message.attachments.iter().map(|attachment| {
                    let attachment_id=attachment.id.clone();let task=attachment_task.clone();let entity=conversation_entity.clone();
                    Button::new(SharedString::from(format!("attachment-{attachment_id}"))).ghost().label(format!("Download {}",attachment.name))
                        .on_click(move|_,_,cx|{entity.update(cx,|this,cx| {this.request(format!("attachment-read:{task}:{attachment_id}"),"/api/attachments/read",json!({"taskId":task,"id":attachment_id}));cx.notify();});})
                }))
                .border_b_1().border_color(cx.theme().border).into_any_element()
        }).flex_1().min_h_0();
        root = root.child(conversation);
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
            let mut controls = div().flex().items_center().justify_between().mt_2().child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("⌘/Ctrl+Enter to send"),
            );
            let mut buttons = div().flex().gap_2();
            if running {
                let id = task.id.clone();
                let run_id = task.active_run_id.clone();
                buttons = buttons
                    .child(
                        Button::new("stop-task")
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
                            .label("Steer")
                            .disabled(sending || !self.online || task.active_run_id.is_none())
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.submit_message(true, window, cx)
                            })),
                    );
            }
            buttons = buttons.child(
                Button::new("send-message")
                    .primary()
                    .label(if sending {
                        "Sending…"
                    } else if running {
                        "Queue"
                    } else {
                        "Send"
                    })
                    .disabled(!self.online || sending)
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
                    .p_4()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .child(self.saved_prompt_choices(task, cx))
                    .child(self.composer_editor(task, window, cx))
                    .child(controls),
            );
        }
        root.into_any_element()
    }

    fn changes_page(
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
        let file_list =
            div()
                .flex()
                .flex_col()
                .w(px(220.))
                .p_2()
                .gap_1()
                .children(files.iter().map(|file| {
                    let path = file.path.clone();
                    Button::new(SharedString::from(path.clone()))
                        .ghost()
                        .label(path.clone())
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
        div().flex().flex_1().min_h_0().child(file_list)
            .child(div().id("diff-view").flex().flex_col().flex_1().min_w_0().overflow_y_scroll().p_4().gap_3()
                .child(div().font_weight(FontWeight::SEMIBOLD).child(file.path.clone()))
                .child(diff)
                .child("After · editable draft")
                .child(Editor::new(&editor).h(px(350.)).flex_shrink_0())
                .child(Button::new("apply-file").label("Apply draft to disk").on_click(cx.listener(move |this, _, _, cx| {
                    this.request(format!("apply:{task_id}:{path}"), "/api/scm/apply", json!({"repositoryId":repository_id,"taskId":task_id,"path":path,"expected":file.disk_contents.as_ref().unwrap_or(&file.after),"contents":this.code_value(&key,cx)})); cx.notify();
                })))
                .child(div().flex().gap_2().child(Button::new("stage-files").label("Stage all changes").on_click(cx.listener({ let task = task.clone(); move |this, _, _, cx| { this.request(format!("stage:{}", task.id), "/api/scm/stage", json!({"repositoryId":task.repository_id,"taskId":task.id,"paths":staged_paths})); cx.notify(); } }))).child(Input::new(&commit))
                    .child(Button::new("commit-files").primary().label("Commit").on_click(cx.listener({ let task = task.clone(); move |this, _, _, cx| { this.request(format!("commit:{}", task.id), "/api/scm/commit", json!({"repositoryId":task.repository_id,"taskId":task.id,"message":this.value("commit-message",cx)})); cx.notify(); } })))))
            .into_any_element()
    }

    fn files_page(
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
        let mut root = div().flex().flex_1().min_h_0().child(
            div()
                .id("files-list")
                .w(px(230.))
                .overflow_y_scroll()
                .p_2()
                .children(files.into_iter().map(|path| {
                    let id = task.id.clone();
                    Button::new(SharedString::from(path.clone()))
                        .ghost()
                        .label(path.clone())
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
                root = root.child(div().flex().flex_col().flex_1().p_4().gap_3().child(path.clone()).child(Editor::new(&editor).h(px(350.)).flex_shrink_0()).child(Button::new("save-file").primary().label("Save to disk").on_click(cx.listener(move |this, _, _, cx| { this.request(format!("save:{id}:{path}"), "/api/tasks/files/write", json!({"id":id,"path":path,"contents":this.code_value(&key,cx),"expectedContents":contents})); cx.notify(); }))));
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

    fn terminal_page(
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
        div()
            .id("terminal-pane")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .p_4()
            .gap_3()
            .child(Self::header(
                "Terminal",
                "Commands run in the task checkout on the connected computer.",
            ))
            .children(terminals.into_iter().map(|terminal| {
                let id = terminal.id.clone();
                div()
                    .flex()
                    .justify_between()
                    .child(format!(
                        "{} · {}",
                        terminal.title,
                        if terminal.exited { "Exited" } else { "Running" }
                    ))
                    .child(
                        Button::new(SharedString::from(format!("close-{id}")))
                            .label("Close")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(
                                    format!("close-terminal:{id}"),
                                    "/api/terminals/close",
                                    json!({"id":id}),
                                );
                                cx.notify();
                            })),
                    )
            }))
            .child(self.project_terminal_actions(task, cx))
            .child(screen)
            .child(Input::new(&command))
            .child(
                Button::new("run-terminal-command")
                    .primary()
                    .label("Run command")
                    .disabled(!self.online)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            format!("terminal-run:{task_id}"),
                            "/api/terminals/run",
                            json!({"taskId":task_id,"command":this.value("terminal-command",cx)}),
                        );
                        cx.notify();
                    })),
            )
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
