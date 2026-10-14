use gpui_kit::{component::Theme, *};

pub(crate) fn load_fonts(cx: &App) -> anyhow::Result<()> {
    use std::borrow::Cow;
    cx.text_system().add_fonts(vec![
        Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-Regular.ttf")),
        Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-Medium.ttf")),
        Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-SemiBold.ttf")),
        Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-Bold.ttf")),
        Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-Italic.ttf")),
        Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-BoldItalic.ttf")),
    ])
}

pub(super) fn status_color(status: crate::model::TaskStatus, cx: &App) -> Hsla {
    use crate::model::TaskStatus;
    use gpui_kit::component::ActiveTheme;
    match status {
        TaskStatus::Running => cx.theme().primary,
        TaskStatus::Review => cx.theme().warning,
        TaskStatus::Done => cx.theme().success,
        TaskStatus::Failed => cx.theme().danger,
        TaskStatus::Draft | TaskStatus::Cancelled => cx.theme().muted_foreground,
    }
}

// One palette for the workbench and native controls, including popovers and editors.
// Apply after changing the mode so a system appearance change cannot restore Kit defaults.
pub(super) fn apply(cx: &mut App) {
    let installed = cx.text_system().all_font_names();
    let font = [
        "Inter",
        "SF Pro Text",
        "Segoe UI",
        "DejaVu Sans",
        "Noto Sans",
    ]
    .into_iter()
    .find(|name| installed.iter().any(|installed| installed == name));
    Theme::update(cx, |theme| {
        let dark = theme.mode.is_dark();
        let color =
            |dark_color, light_color| rgb(if dark { dark_color } else { light_color }).into();
        let background = color(0x202329, 0xffffff);
        let panel = color(0x191c21, 0xf5f6f8);
        let surface = color(0x262a31, 0xf9fafb);
        let hover = color(0x2d323a, 0xebeef2);
        let selection = color(0x2b3546, 0xe8eef8);
        let foreground = color(0xdfe3eb, 0x242a35);
        let muted = color(0x969eac, 0x657083);
        let border = color(0x31363e, 0xe3e6ec);
        let primary = color(0x8ab4f8, 0x426ac4);
        theme.font_size = px(13.);
        if let Some(font) = font {
            theme.font_family = font.into();
        }
        theme.radius = px(5.);
        theme.radius_lg = px(8.);
        theme.background = background;
        theme.foreground = foreground;
        theme.border = border;
        theme.input = border;
        theme.muted = surface;
        theme.muted_foreground = muted;
        theme.accent = hover;
        theme.accent_foreground = foreground;
        theme.secondary = surface;
        theme.secondary_foreground = foreground;
        theme.secondary_hover = hover;
        theme.secondary_active = selection;
        theme.primary = primary;
        theme.primary_foreground = color(0x172030, 0xffffff);
        theme.primary_hover = color(0xa3bfeb, 0x315b99);
        theme.primary_active = color(0x7a9bd0, 0x284e85);
        theme.button_primary = primary;
        theme.button_primary_foreground = theme.primary_foreground;
        theme.button_primary_hover = theme.primary_hover;
        theme.button_primary_active = theme.primary_active;
        theme.button = surface;
        theme.button_foreground = foreground;
        theme.button_hover = hover;
        theme.button_active = selection;
        theme.ring = primary;
        theme.caret = primary;
        theme.selection = selection;
        theme.link = primary;
        theme.link_hover = theme.primary_hover;
        theme.link_active = theme.primary_active;
        theme.sidebar = panel;
        theme.sidebar_foreground = foreground;
        theme.sidebar_border = border;
        theme.sidebar_accent = selection;
        theme.sidebar_accent_foreground = foreground;
        theme.sidebar_primary = primary;
        theme.sidebar_primary_foreground = theme.primary_foreground;
        theme.colors.list = panel;
        theme.list_hover = hover;
        theme.list_active = selection;
        theme.list_active_border = primary;
        theme.list_head = panel;
        theme.popover = surface;
        theme.popover_foreground = foreground;
        theme.tab_bar = panel;
        theme.tab = panel;
        theme.tab_foreground = muted;
        theme.tab_active = background;
        theme.tab_active_foreground = foreground;
        theme.title_bar = panel;
        theme.title_bar_border = border;
        theme.scrollbar = panel;
        theme.scrollbar_thumb = color(0x49515f, 0xb8c1ce);
        theme.scrollbar_thumb_hover = muted;
        theme.success = color(0x8dbd9a, 0x398357);
        theme.warning = color(0xdbb77c, 0x93661f);
        theme.danger = color(0xd99199, 0xb64256);
    });
}
