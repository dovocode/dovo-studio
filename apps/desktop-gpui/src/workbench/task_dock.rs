use super::*;
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::{
    assets::IconName as UiIcon,
    component::{
        Icon,
        resizable::{h_resizable, resizable_panel, v_resizable},
    },
};

impl TaskTab {
    fn title(self) -> &'static str {
        match self {
            Self::Chat => "Conversation",
            Self::Details => "Task settings",
            Self::Files => "Project files",
            Self::LinkedProjects => "Linked projects",
            Self::Artifacts => "Artifacts",
            Self::Changes => "Changes",
            Self::Browser => "Browsers",
            Self::SideChats => "Side conversations",
            Self::Agents => "Agents",
            Self::Review => "Code review",
            Self::Devices => "Devices",
        }
    }
    fn icon(self) -> UiIcon {
        match self {
            Self::Chat => UiIcon::MessagesSquare,
            Self::Details => UiIcon::SlidersHorizontal,
            Self::Files => UiIcon::Files,
            Self::LinkedProjects => UiIcon::FolderSymlink,
            Self::Artifacts => UiIcon::Shapes,
            Self::Changes => UiIcon::FileDiff,
            Self::Browser => UiIcon::Globe,
            Self::SideChats => UiIcon::MessageCircleQuestionMark,
            Self::Agents => UiIcon::Bot,
            Self::Review => UiIcon::ScanEye,
            Self::Devices => UiIcon::Smartphone,
        }
    }
}

impl Workbench {
    pub(super) fn tools_fit(&self, window: &Window) -> bool {
        let sidebar = if self.layout.task_sidebar_visible && !self.tools_expanded {
            self.layout.task_sidebar_width
        } else {
            0.
        };
        f32::from(window.viewport_size().width) - sidebar - 88. >= 720.
    }

    pub(super) fn set_bottom_terminal(
        &mut self,
        open: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(id) = self.selected_task.clone() else {
            return;
        };
        self.bottom_terminal_open = open;
        if open {
            self.request(
                format!("terminal:{id}"),
                "/api/terminals/ensure",
                json!({"taskId":id}),
            );
        } else {
            self.command(Command::DetachTerminals);
            self.selected_terminal = None;
        }
        window.focus(&self.focus, cx);
        cx.notify();
    }

    pub(super) fn task_workspace(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let header = self.thread_header(task, cx);
        let rail = self.thread_tools(cx);
        let compact = !self.tools_fit(window);
        let expanded = self.tools_expanded || compact;
        let main = if self.tab != TaskTab::Chat {
            let tools = self.tool_pane(task, window, cx);
            if expanded {
                tools
            } else {
                let chat = self.chat_workspace(task, window, cx);
                let entity = cx.entity();
                h_resizable("thread-tool-panels")
                    .with_state(&self.tool_panels)
                    .child(
                        resizable_panel()
                            .size_range(px(300.)..Pixels::MAX)
                            .child(chat),
                    )
                    .child(
                        resizable_panel()
                            .size(px(self.layout.tools_sidebar_width))
                            .size_range(px(300.)..px(680.))
                            .child(tools),
                    )
                    .on_resize(move |state, _, cx| {
                        if let Some(width) = state.read(cx).sizes().get(1).copied() {
                            entity.update(cx, |this, cx| {
                                this.layout.tools_sidebar_width =
                                    f32::from(width).round().clamp(300., 680.);
                                this.save_layout(cx);
                            });
                        }
                    })
                    .into_any_element()
            }
        } else {
            self.chat_workspace(task, window, cx)
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_w_0()
            .min_h_0()
            .child(header)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .child(main)
                    .child(rail),
            )
            .into_any_element()
    }

    fn chat_workspace(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let chat = self.conversation(task, window, cx);
        if !self.bottom_terminal_open {
            return chat;
        }
        let terminal = self.terminal_page(task, window, cx);
        let entity = cx.entity();
        v_resizable("thread-terminal-panels")
            .with_state(&self.terminal_panels)
            .child(
                resizable_panel()
                    .size_range(px(260.)..Pixels::MAX)
                    .child(chat),
            )
            .child(
                resizable_panel()
                    .size(px(self.layout.terminal_height))
                    .size_range(px(140.)..px(420.))
                    .child(terminal),
            )
            .on_resize(move |state, _, cx| {
                if let Some(height) = state.read(cx).sizes().get(1).copied() {
                    entity.update(cx, |this, cx| {
                        this.layout.terminal_height = f32::from(height).round().clamp(140., 420.);
                        this.save_layout(cx);
                    });
                }
            })
            .into_any_element()
    }

    fn thread_header(&self, task: &Task, cx: &mut Context<Self>) -> AnyElement {
        let pinned = task.pinned.unwrap_or(false);
        let pin_task = task.clone();
        let archive_task = task.clone();
        div()
            .h(px(44.)).flex_shrink_0().flex().items_center().gap_2().px_3()
            .border_b_1().border_color(cx.theme().border)
            .child(self.task_agent_icon(task, cx))
            .child(div().flex().items_center().gap_1().min_w_0().max_w(px(160.))
                .text_size(px(11.)).text_color(cx.theme().muted_foreground)
                .child(Icon::new(self.runtime_icon()).size(px(12.)))
                .child(div().truncate().child(self.server_label())).child("/"))
            .child(div().flex_1().min_w_0().truncate().font_weight(FontWeight::MEDIUM).child(task.title.clone()))
            .child(div().flex().items_center().gap_1().text_size(px(11.)).text_color(cx.theme().muted_foreground)
                .child(div().size(px(4.)).rounded_full().bg(appearance::status_color(task.status, cx)))
                .child(task.status.label()))
            .child(div().flex().items_center().gap_1().border_l_1().border_color(cx.theme().border).pl_2()
                .children((!self.messages.is_empty()).then(|| shell::icon_button("latest-message", UiIcon::ArrowDown, "Jump to latest message")
                    .on_click(cx.listener(|this, _, _, cx| {this.list.scroll_to_end(); cx.notify();}))))
                .child(shell::icon_button("pin-task", if pinned {UiIcon::PinOff} else {UiIcon::Pin}, if pinned {"Unpin task"} else {"Pin task"})
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.patch(format!("pin:{}", pin_task.id), WorkspacePatch::update("tasks", pin_task.id.clone(), "pinned", json!(pin_task.pinned), json!(!pinned)));
                        cx.notify();
                    })))
                .child(shell::icon_button("archive-task", if task.is_archived() {UiIcon::ArchiveRestore} else {UiIcon::Archive}, if task.is_archived() {"Restore task"} else {"Archive task"})
                    .disabled(task.status == TaskStatus::Running)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(format!("lifecycle:{}", archive_task.id), "/api/tasks/lifecycle", json!({"id":archive_task.id,"action":if archive_task.is_archived(){"restore"}else{"archive"}}));
                        cx.notify();
                    }))))
            .child(div().flex().items_center().gap_1().border_l_1().border_color(cx.theme().border).pl_2()
                .child(shell::icon_button("thread-left-panel", UiIcon::PanelLeft, "Toggle task sidebar")
                    .selected(self.layout.task_sidebar_visible && !self.tools_expanded)
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_task_sidebar(cx))))
                .child(shell::icon_button("thread-bottom-panel", UiIcon::PanelBottom, "Toggle terminal")
                    .tooltip("Toggle terminal · Ctrl+`").selected(self.bottom_terminal_open)
                    .on_click(cx.listener(|this, _, window, cx| this.set_bottom_terminal(!this.bottom_terminal_open, window, cx))))
                .child(shell::icon_button("thread-right-panel", UiIcon::PanelRight, "Toggle tools sidebar")
                    .tooltip(format!("Toggle tools sidebar · {}", shell::shortcut("Shift+B"))).selected(self.tab != TaskTab::Chat)
                    .on_click(cx.listener(|this, _, window, cx| {
                        let tab = if this.tab == TaskTab::Chat {this.last_tool} else {TaskTab::Chat};
                        this.open_task_tab(tab, window, cx);
                    }))))
            .into_any_element()
    }

    fn thread_tools(&self, cx: &mut Context<Self>) -> AnyElement {
        let tools = [
            TaskTab::Files,
            TaskTab::LinkedProjects,
            TaskTab::Artifacts,
            TaskTab::Changes,
            TaskTab::Agents,
            TaskTab::SideChats,
            TaskTab::Review,
            TaskTab::Browser,
            TaskTab::Devices,
        ];
        div()
            .id("thread-tools")
            .flex()
            .flex_col()
            .items_center()
            .w(px(40.))
            .flex_shrink_0()
            .py_2()
            .gap_1()
            .bg(cx.theme().sidebar)
            .border_l_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .id("thread-tools-icons")
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .children(tools.into_iter().map(|tab| {
                        div()
                            .when(tab == TaskTab::Browser, |row| {
                                row.mt_2()
                                    .pt_2()
                                    .border_t_1()
                                    .border_color(cx.theme().border)
                            })
                            .child(
                                shell::icon_button(tab.title(), tab.icon(), tab.title())
                                    .selected(self.tab == tab)
                                    .icon(Icon::new(tab.icon()).size(px(18.)))
                                    .w(px(34.))
                                    .h(px(34.))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        let next =
                                            if this.tab == tab { TaskTab::Chat } else { tab };
                                        this.open_task_tab(next, window, cx);
                                    })),
                            )
                    })),
            )
            .child(
                shell::icon_button(
                    "thread-settings",
                    TaskTab::Details.icon(),
                    TaskTab::Details.title(),
                )
                .selected(self.tab == TaskTab::Details)
                .on_click(cx.listener(|this, _, window, cx| {
                    let next = if this.tab == TaskTab::Details {
                        TaskTab::Chat
                    } else {
                        TaskTab::Details
                    };
                    this.open_task_tab(next, window, cx);
                })),
            )
            .into_any_element()
    }

    fn tool_pane(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let title = self.tab.title();
        let icon = self.tab.icon();
        let content = match self.tab {
            TaskTab::LinkedProjects => div()
                .id("linked-projects-pane")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p_3()
                .child(self.task_linked_checkouts(task, window, cx))
                .into_any_element(),
            TaskTab::Artifacts => self.artifact_gallery(Some(&task.id), cx),
            TaskTab::Changes => self.changes_page(task, window, cx),
            TaskTab::Files => self.files_page(task, window, cx),
            TaskTab::Browser => self.browser_page(task, window, cx),
            TaskTab::Details => self.task_controls(task, window, cx),
            TaskTab::SideChats => self.side_chats(task, window, cx),
            TaskTab::Review => self.task_review_page(task, window, cx),
            TaskTab::Agents => self.child_agents_page(task, window, cx),
            TaskTab::Devices => self.devices_page(task, window, cx),
            _ => div().into_any_element(),
        };
        div()
            .id("task-tool-pane")
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .child(
                div()
                    .h(px(34.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_3()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .bg(cx.theme().sidebar)
                    .text_size(px(12.))
                    .child(
                        Icon::new(icon)
                            .size(px(14.))
                            .text_color(cx.theme().muted_foreground),
                    )
                    .child(div().flex_1().child(title))
                    .child(
                        shell::icon_button(
                            "expand-thread-tool",
                            if self.tools_expanded {
                                UiIcon::Minimize2
                            } else {
                                UiIcon::Maximize2
                            },
                            "Expand or restore tool pane",
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.tools_expanded = !this.tools_expanded;
                            cx.notify();
                        })),
                    )
                    .child(
                        shell::icon_button("close-thread-tool", UiIcon::X, "Close tool pane")
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.tools_expanded = false;
                                this.open_task_tab(TaskTab::Chat, window, cx);
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .overflow_hidden()
                    .child(content),
            )
            .into_any_element()
    }
}
