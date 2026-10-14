use super::*;
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::{
    assets::IconName as UiIcon,
    component::{Icon, Sizable, TitleBar},
};

pub(super) fn icon_button(id: impl Into<ElementId>, icon: UiIcon, label: &'static str) -> Button {
    Button::new(id)
        .ghost()
        .compact()
        .small()
        .icon(Icon::new(icon).size(px(16.)))
        .w(px(28.))
        .h(px(28.))
        .rounded(px(5.))
        .accessibility_label(label)
        .tooltip(label)
}

pub(super) fn harness_icon(provider: &str, cx: &App) -> AnyElement {
    if matches!(
        provider,
        "codex" | "claude" | "opencode" | "hermes" | "copilot" | "grok" | "muse" | "cursor" | "acp"
    ) {
        svg()
            .path(SharedString::from(format!("harness/{provider}.svg")))
            .size(px(14.))
            .flex_shrink_0()
            .text_color(cx.theme().muted_foreground)
            .into_any_element()
    } else {
        Icon::new(UiIcon::Bot)
            .size(px(14.))
            .text_color(cx.theme().muted_foreground)
            .into_any_element()
    }
}

pub(super) fn harness_label(provider: &str) -> &str {
    match provider {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "opencode" => "OpenCode",
        "hermes" => "Hermes",
        "copilot" => "GitHub Copilot",
        "grok" => "Grok",
        "muse" => "Muse",
        "cursor" => "Cursor",
        "acp" => "ACP",
        other => other,
    }
}

pub(super) fn server_icon(name: &str) -> UiIcon {
    match name {
        "laptop" => UiIcon::Laptop,
        "server" => UiIcon::Server,
        "cloud" => UiIcon::Cloud,
        "cpu" => UiIcon::Cpu,
        "terminal" => UiIcon::SquareTerminal,
        _ => UiIcon::Monitor,
    }
}

impl Workbench {
    pub(super) fn task_agent_icon(&self, task: &Task, cx: &App) -> AnyElement {
        let provider = task
            .extra
            .get("harness")
            .and_then(|h| h.get("provider"))
            .and_then(Value::as_str)
            .or_else(|| {
                self.snapshot
                    .as_ref()?
                    .workspace
                    .agents
                    .iter()
                    .find(|a| a.id == task.agent_id)
                    .map(|a| a.provider.name())
            })
            .unwrap_or("");
        harness_icon(provider, cx)
    }
    pub(super) fn runtime_icon(&self) -> UiIcon {
        server_icon(
            self.snapshot
                .as_ref()
                .and_then(|s| s.extra.get("runtimeIcon"))
                .and_then(Value::as_str)
                .unwrap_or("desktop"),
        )
    }
}

impl Page {
    fn icon(self) -> UiIcon {
        match self {
            Self::Tasks => UiIcon::MessagesSquare,
            Self::Artifacts => UiIcon::Shapes,
            Self::Projects => UiIcon::FolderGit2,
            Self::Pulls => UiIcon::GitPullRequest,
            Self::Issues => UiIcon::CircleDot,
            Self::Pipelines => UiIcon::ListChecks,
            Self::Automations => UiIcon::Workflow,
            Self::Archived => UiIcon::Archive,
            Self::Agents => UiIcon::Bot,
            Self::Acp => UiIcon::Package,
            Self::Defaults => UiIcon::SlidersHorizontal,
            Self::Resources => UiIcon::Blocks,
            Self::Integrations => UiIcon::Plug,
            Self::Settings => UiIcon::Settings,
            Self::Computers => UiIcon::Monitor,
            Self::Usage => UiIcon::ChartNoAxesCombined,
        }
    }

    pub(super) fn is_settings(self) -> bool {
        matches!(
            self,
            Self::Agents
                | Self::Acp
                | Self::Defaults
                | Self::Resources
                | Self::Integrations
                | Self::Settings
                | Self::Usage
        )
    }
}

pub(super) fn shortcut(key: &str) -> String {
    format!(
        "{}{}",
        if cfg!(target_os = "macos") {
            "⌘"
        } else {
            "Ctrl+"
        },
        key
    )
}

impl Workbench {
    pub(super) fn activity_rail(&self, cx: &mut Context<Self>) -> AnyElement {
        let primary = [
            Page::Tasks,
            Page::Artifacts,
            Page::Projects,
            Page::Pulls,
            Page::Issues,
            Page::Pipelines,
            Page::Automations,
            Page::Archived,
        ];
        let item = |page: Page, selected: bool, cx: &mut Context<Self>| {
            div()
                .relative()
                .w(px(40.))
                .h(px(36.))
                .flex()
                .items_center()
                .justify_center()
                .children(selected.then(|| {
                    div()
                        .absolute()
                        .left_0()
                        .top(px(8.))
                        .bottom(px(8.))
                        .w(px(2.))
                        .bg(cx.theme().primary)
                }))
                .child(
                    Button::new(SharedString::from(format!("nav-{}", page.label())))
                        .ghost()
                        .icon(
                            Icon::new(page.icon())
                                .size(px(18.))
                                .text_color(if selected {
                                    cx.theme().primary
                                } else {
                                    cx.theme().muted_foreground
                                }),
                        )
                        .accessibility_label(page.label())
                        .tooltip(page.label())
                        .selected(selected)
                        .w(px(34.))
                        .h(px(34.))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.search_open = false;
                            this.navigate(page, cx);
                        })),
                )
        };
        div()
            .id("workspace-sidebar")
            .flex()
            .flex_col()
            .items_center()
            .w(px(48.))
            .flex_shrink_0()
            .py_2()
            .gap_1()
            .bg(cx.theme().sidebar)
            .border_r_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .id("workspace-navigation")
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .children(
                        primary
                            .into_iter()
                            .map(|page| item(page, self.page == page, cx)),
                    ),
            )
            .child(
                Button::new("search")
                    .ghost()
                    .icon(UiIcon::Search)
                    .accessibility_label("Search workspace")
                    .tooltip(format!("Search workspace · {}", shortcut("K")))
                    .w(px(34.))
                    .h(px(34.))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.search_open = true;
                        cx.notify();
                    })),
            )
            .child(item(Page::Computers, self.page == Page::Computers, cx))
            .child(item(Page::Settings, self.page.is_settings(), cx))
            .into_any_element()
    }

    pub(super) fn settings_sidebar(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id("settings-navigation")
            .flex()
            .flex_col()
            .w(px(220.))
            .flex_shrink_0()
            .bg(cx.theme().sidebar)
            .border_r_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .h(px(42.))
                    .flex()
                    .items_center()
                    .px_4()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Settings"),
            )
            .child(
                div()
                    .id("settings-sections")
                    .flex()
                    .flex_col()
                    .gap_1()
                    .p_2()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .children(Page::ALL.into_iter().filter(|page| page.is_settings()).map(
                        |page| {
                            Button::new(SharedString::from(format!(
                                "settings-nav-{}",
                                page.label()
                            )))
                            .ghost()
                            .small()
                            .accessibility_label(page.label())
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .w_full()
                                    .child(Icon::new(page.icon()).size(px(14.)))
                                    .child(page.label()),
                            )
                            .selected(self.page == page)
                            .on_click(cx.listener(move |this, _, _, cx| this.navigate(page, cx)))
                        },
                    )),
            )
            .into_any_element()
    }

    pub(super) fn workspace_titlebar(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let project = self
            .task()
            .and_then(|task| {
                self.snapshot
                    .as_ref()?
                    .workspace
                    .repositories
                    .iter()
                    .find(|repo| repo.id == task.repository_id)
            })
            .filter(|_| f32::from(window.viewport_size().width) >= 1000.)
            .map(|repo| repo.name.clone());
        TitleBar::new()
            .bg(cx.theme().title_bar)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .flex_1()
                    .min_w_0()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .min_w_0()
                            .child(
                                div()
                                    .font_weight(FontWeight::BOLD)
                                    .text_size(px(14.))
                                    .child("dovo"),
                            )
                            .child(self.server_picker(cx))
                            .children(project.map(|name| {
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .min_w_0()
                                    .child(div().text_color(cx.theme().muted_foreground).child("/"))
                                    .child(
                                        div()
                                            .truncate()
                                            .text_color(cx.theme().muted_foreground)
                                            .child(name),
                                    )
                            }))
                            .child(div().text_color(cx.theme().muted_foreground).child("/"))
                            .child(div().truncate().child(if self.search_open {
                                "Search"
                            } else {
                                self.page.label()
                            })),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .children(
                                (matches!(self.page, Page::Tasks | Page::Archived)
                                    && !self.search_open)
                                    .then(|| {
                                        Button::new("toggle-task-sidebar")
                                            .ghost()
                                            .small()
                                            .icon(UiIcon::PanelLeft)
                                            .selected(self.layout.task_sidebar_visible)
                                            .accessibility_label("Toggle task sidebar")
                                            .tooltip(format!(
                                                "Toggle task sidebar · {}",
                                                shortcut("B")
                                            ))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.toggle_task_sidebar(cx)
                                            }))
                                    }),
                            )
                            .child(
                                Button::new("title-search")
                                    .ghost()
                                    .small()
                                    .icon(Icon::new(UiIcon::Search).size(px(13.)))
                                    .child(div().when(
                                        f32::from(window.viewport_size().width) >= 1000.,
                                        |content| {
                                            content
                                                .flex()
                                                .items_center()
                                                .gap_4()
                                                .child("Search workspace")
                                                .child(
                                                    div().text_size(px(10.)).child(shortcut("K")),
                                                )
                                        },
                                    ))
                                    .bg(cx.theme().background)
                                    .border_1()
                                    .border_color(cx.theme().border)
                                    .text_color(cx.theme().muted_foreground)
                                    .accessibility_label("Search workspace")
                                    .tooltip(format!("Search workspace · {}", shortcut("K")))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.search_open = true;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new("new-task")
                                    .ghost()
                                    .small()
                                    .icon(Icon::new(UiIcon::Plus).size(px(14.)))
                                    .label("New task")
                                    .tooltip(format!("New task · {}", shortcut("N")))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.search_open = false;
                                        this.page = Page::Tasks;
                                        this.new_task = true;
                                        this.read_task_agents();
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    pub(super) fn workspace_statusbar(&self, cx: &mut Context<Self>) -> AnyElement {
        let branch = self
            .task()
            .and_then(|task| {
                self.snapshot
                    .as_ref()?
                    .workspace
                    .repositories
                    .iter()
                    .find(|repo| repo.id == task.repository_id)
            })
            .map(|repo| repo.branch.clone());
        div()
            .flex()
            .items_center()
            .justify_between()
            .h(px(24.))
            .flex_shrink_0()
            .px_3()
            .bg(cx.theme().sidebar)
            .border_t_1()
            .border_color(cx.theme().border)
            .text_size(px(11.))
            .text_color(cx.theme().muted_foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(div().size(px(5.)).rounded_full().bg(if self.online {
                                cx.theme().success
                            } else {
                                cx.theme().warning
                            }))
                            .child(self.status.clone()),
                    )
                    .children(branch.map(|branch| {
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(Icon::new(UiIcon::GitBranch).size(px(12.)))
                            .child(branch)
                    })),
            )
            .child(
                Button::new("connection-status")
                    .ghost()
                    .compact()
                    .h(px(22.))
                    .icon(Icon::new(self.runtime_icon()).size(px(12.)))
                    .label(self.server_label())
                    .tooltip(if self.address.is_empty() {
                        "Manage connected computers".into()
                    } else {
                        self.address.clone()
                    })
                    .on_click(cx.listener(|this, _, _, cx| this.navigate(Page::Computers, cx))),
            )
            .into_any_element()
    }
}
