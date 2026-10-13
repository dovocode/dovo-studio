use super::*;
use gpui_kit::{
    assets::IconName as UiIcon,
    component::{Icon, Sizable, TitleBar},
};

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
            Button::new(SharedString::from(format!("nav-{}", page.label())))
                .ghost()
                .icon(Icon::new(page.icon()).size(px(18.)))
                .accessibility_label(page.label())
                .tooltip(page.label())
                .selected(selected)
                .w(px(34.))
                .h(px(34.))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.search_open = false;
                    this.navigate(page, cx);
                }))
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

    pub(super) fn workspace_titlebar(&self, cx: &mut Context<Self>) -> AnyElement {
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
                            .child(div().font_weight(FontWeight::SEMIBOLD).child("dovo"))
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
                            .child(
                                Button::new("title-search")
                                    .ghost()
                                    .small()
                                    .icon(UiIcon::Search)
                                    .label("Search")
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
                                    .icon(UiIcon::Plus)
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
                    .icon(Icon::new(UiIcon::Monitor).size(px(12.)))
                    .label(if self.address.is_empty() {
                        "Connect a computer".into()
                    } else {
                        self.address.clone()
                    })
                    .tooltip("Manage connected computers")
                    .on_click(cx.listener(|this, _, _, cx| this.navigate(Page::Computers, cx))),
            )
            .into_any_element()
    }
}
