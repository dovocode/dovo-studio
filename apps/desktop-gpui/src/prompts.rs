use gpui_kit::{
    component::{ActiveTheme, button::Button},
    *,
};

pub fn render_prompt(
    _level: PromptLevel,
    message: &str,
    detail: Option<&str>,
    answers: &[PromptButton],
    handle: PromptHandle,
    window: &mut Window,
    cx: &mut App,
) -> RenderablePromptHandle {
    let view = cx.new(|cx| Confirmation {
        message: message.into(),
        detail: detail.map(str::to_owned),
        answers: answers.to_vec(),
        focus: cx.focus_handle(),
    });
    handle.with_view(view, window, cx)
}

struct Confirmation {
    message: String,
    detail: Option<String>,
    answers: Vec<PromptButton>,
    focus: FocusHandle,
}
impl EventEmitter<PromptResponse> for Confirmation {}
impl Focusable for Confirmation {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for Confirmation {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let max_height = (f32::from(window.viewport_size().height) - 80.).max(160.);
        let mut body = div()
            .id("confirmation-body")
            .w_full()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .w_full()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .whitespace_normal()
                    .child(self.message.clone()),
            );
        if let Some(detail) = &self.detail {
            body = body.child(div().w_full().whitespace_normal().child(detail.clone()));
        }
        let buttons = div().flex().flex_wrap().justify_end().gap_2().children(
            self.answers.iter().enumerate().map(|(index, answer)| {
                Button::new(index)
                    .label(answer.label().clone())
                    .outline()
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(PromptResponse(index));
                        cx.stop_propagation();
                    }))
            }),
        );
        let dialog = div()
            .track_focus(&self.focus)
            .w(px(560.))
            .max_w_full()
            .max_h(px(max_height))
            .p_5()
            .rounded_lg()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .border_1()
            .border_color(cx.theme().border)
            .shadow_lg()
            .flex()
            .flex_col()
            .gap_5()
            .child(body)
            .child(buttons)
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" && !this.answers.is_empty() {
                    cx.emit(PromptResponse(0));
                    cx.stop_propagation();
                }
            }));
        div()
            .size_full()
            .absolute()
            .top_0()
            .left_0()
            .bg(rgba(0x00000099))
            .flex()
            .items_center()
            .justify_center()
            .p_5()
            .child(dialog)
    }
}
