use super::*;
use std::ops::Range;

#[derive(Clone, Copy)]
pub(super) struct TerminalSelection {
    anchor: (u16, u16),
    head: (u16, u16),
}
impl TerminalSelection {
    fn range(self) -> ((u16, u16), (u16, u16)) {
        (self.anchor.min(self.head), self.anchor.max(self.head))
    }
    fn contains(self, row: u16, col: u16) -> bool {
        let (start, end) = self.range();
        (row, col) >= start && (row, col) < end
    }
}

fn key_input(key: &Keystroke, application_cursor: bool) -> Option<String> {
    let modifiers = &key.modifiers;
    if modifiers.control {
        let control = match key.key.as_str() {
            "space" | "@" | "2" => Some(0),
            "[" | "3" => Some(27),
            "\\" | "4" => Some(28),
            "]" | "5" => Some(29),
            "^" | "6" => Some(30),
            "_" | "7" | "-" => Some(31),
            "?" | "8" => Some(127),
            value if value.len() == 1 && value.as_bytes()[0].is_ascii_alphabetic() => {
                Some(value.as_bytes()[0].to_ascii_lowercase() - b'a' + 1)
            }
            _ => None,
        };
        if let Some(control) = control {
            let prefix = if modifiers.alt { "\x1b" } else { "" };
            return Some(format!("{prefix}{}", char::from(control)));
        }
    }
    let modifier = 1
        + u8::from(modifiers.shift)
        + 2 * u8::from(modifiers.alt)
        + 4 * u8::from(modifiers.control);
    let final_code = match key.key.as_str() {
        "up" => Some('A'),
        "down" => Some('B'),
        "right" => Some('C'),
        "left" => Some('D'),
        "home" => Some('H'),
        "end" => Some('F'),
        "f1" => Some('P'),
        "f2" => Some('Q'),
        "f3" => Some('R'),
        "f4" => Some('S'),
        _ => None,
    };
    if let Some(code) = final_code {
        return Some(if modifier > 1 {
            format!("\x1b[1;{modifier}{code}")
        } else {
            let application = application_cursor || key.key.starts_with('f');
            format!("\x1b{}{code}", if application { "O" } else { "[" })
        });
    }
    let tilde = match key.key.as_str() {
        "insert" => Some(2),
        "delete" => Some(3),
        "pageup" => Some(5),
        "pagedown" => Some(6),
        "f5" => Some(15),
        "f6" => Some(17),
        "f7" => Some(18),
        "f8" => Some(19),
        "f9" => Some(20),
        "f10" => Some(21),
        "f11" => Some(23),
        "f12" => Some(24),
        _ => None,
    };
    if let Some(code) = tilde {
        return Some(if modifier > 1 {
            format!("\x1b[{code};{modifier}~")
        } else {
            format!("\x1b[{code}~")
        });
    }
    let sequence = match key.key.as_str() {
        "enter" => "\r".into(),
        "backspace" => "\x7f".into(),
        "tab" => if modifiers.shift { "\x1b[Z" } else { "\t" }.into(),
        "escape" => return Some("\x1b".into()),
        value if modifiers.alt && value.chars().count() == 1 => {
            if modifiers.shift {
                value.to_uppercase()
            } else {
                value.into()
            }
        }
        "space" if modifiers.alt => " ".into(),
        _ => return None,
    };
    Some(if modifiers.alt {
        format!("\x1b{sequence}")
    } else {
        sequence
    })
}

#[derive(Clone, Copy)]
enum MouseReport {
    Press(u16),
    Release(u16),
    Motion(Option<u16>),
    Wheel(bool),
}

fn mouse_input(
    screen: &vt100::Screen,
    cell: (u16, u16),
    report: MouseReport,
    modifiers: Modifiers,
) -> Option<Vec<u8>> {
    use vt100::{MouseProtocolEncoding as Encoding, MouseProtocolMode as Mode};
    let mode = screen.mouse_protocol_mode();
    if modifiers.shift || mode == Mode::None {
        return None;
    }
    let (mut code, release) = match report {
        MouseReport::Press(button) => (button, false),
        MouseReport::Release(button) if mode != Mode::Press => (button, true),
        MouseReport::Motion(button)
            if mode == Mode::AnyMotion || mode == Mode::ButtonMotion && button.is_some() =>
        {
            (32 + button.unwrap_or(3), false)
        }
        MouseReport::Wheel(up) if mode != Mode::Press => (if up { 64 } else { 65 }, false),
        _ => return None,
    };
    if mode != Mode::Press {
        code += 8 * u16::from(modifiers.alt) + 16 * u16::from(modifiers.control);
    }
    let (row, col) = cell;
    if screen.mouse_protocol_encoding() == Encoding::Sgr {
        return Some(
            format!(
                "\x1b[<{code};{};{}{}",
                col + 1,
                row + 1,
                if release { 'm' } else { 'M' }
            )
            .into_bytes(),
        );
    }
    if release {
        code = 3 + 8 * u16::from(modifiers.alt) + 16 * u16::from(modifiers.control);
    }
    let values = [code + 32, col + 33, row + 33];
    if screen.mouse_protocol_encoding() == Encoding::Default {
        let mut bytes = b"\x1b[M".to_vec();
        for value in values {
            bytes.push(u8::try_from(value).ok()?);
        }
        return Some(bytes);
    }
    Some(
        format!(
            "\x1b[M{}",
            values
                .into_iter()
                .map(|value| char::from_u32(u32::from(value)))
                .collect::<Option<String>>()?
        )
        .into_bytes(),
    )
}

fn mouse_button(button: MouseButton) -> Option<u16> {
    match button {
        MouseButton::Left => Some(0),
        MouseButton::Middle => Some(1),
        MouseButton::Right => Some(2),
        _ => None,
    }
}

impl Workbench {
    fn terminal_cell(&self, position: Point<Pixels>) -> Option<(u16, u16)> {
        let bounds = self.terminal_bounds?;
        let screen = self
            .terminal_screens
            .get(self.selected_terminal.as_ref()?)?
            .screen();
        let (rows, cols) = screen.size();
        let row = ((f32::from(position.y - bounds.origin.y) - 8.) / 18.)
            .floor()
            .clamp(0., f32::from(rows.saturating_sub(1))) as u16;
        let col = ((f32::from(position.x - bounds.origin.x) - 8.) / self.terminal_cell_width)
            .round()
            .clamp(0., f32::from(cols)) as u16;
        Some((row, col))
    }
    fn report_terminal_mouse(
        &mut self,
        position: Point<Pixels>,
        report: MouseReport,
        modifiers: Modifiers,
    ) -> bool {
        let Some(id) = self.selected_terminal.clone() else {
            return false;
        };
        let Some((row, _)) = self.terminal_cell(position) else {
            return false;
        };
        let Some(bounds) = self.terminal_bounds else {
            return false;
        };
        let Some(parser) = self.terminal_screens.get(&id) else {
            return false;
        };
        if modifiers.shift
            || parser.screen().mouse_protocol_mode() == vt100::MouseProtocolMode::None
        {
            return false;
        }
        let col = ((f32::from(position.x - bounds.origin.x) - 8.) / self.terminal_cell_width)
            .floor()
            .clamp(0., f32::from(parser.screen().size().1.saturating_sub(1)))
            as u16;
        if let MouseReport::Motion(button) = report {
            let cell = (id.clone(), row, col, button);
            if self.terminal_mouse_cell.as_ref() == Some(&cell) {
                return true;
            }
            self.terminal_mouse_cell = Some(cell);
        } else {
            self.terminal_mouse_cell = None;
        }
        if let Some(data) = mouse_input(parser.screen(), (row, col), report, modifiers) {
            self.command(Command::TerminalBytesInput { id, data });
        }
        true
    }
    pub(super) fn native_terminal(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(id) = self.selected_terminal.clone() else {
            return Self::empty(
                "Opening terminal…",
                "The shell stays on the runtime computer.",
            );
        };
        let font_id = cx.text_system().resolve_font(&font("monospace"));
        let cell_width = match cx.text_system().advance(font_id, px(13.), 'M') {
            Ok(size) => f32::from(size.width),
            Err(error) => {
                self.error = Some(format!("Cannot measure terminal font: {error}"));
                return Self::empty(
                    "Terminal font unavailable",
                    "Choose an installed monospace font.",
                );
            }
        };
        self.terminal_cell_width = cell_width;
        let screen = self.terminal_screens.get(&id).map(|parser| parser.screen());
        let rows: Vec<_> = screen
            .map(|screen| {
                (0..screen.size().0)
                    .map(|row| {
                        let mut text = String::new();
                        let mut highlights = Vec::new();
                        for col in 0..screen.size().1 {
                            if let Some(cell) = screen.cell(row, col) {
                                if cell.is_wide_continuation() {
                                    continue;
                                }
                                let start = text.len();
                                text.push_str(if cell.has_contents() {
                                    cell.contents()
                                } else {
                                    " "
                                });
                                let mut fg = terminal_color(cell.fgcolor(), 0xe4e7ec);
                                let mut bg = terminal_color(cell.bgcolor(), 0x0e1014);
                                if cell.inverse() {
                                    std::mem::swap(&mut fg, &mut bg);
                                }
                                if self
                                    .terminal_selection
                                    .is_some_and(|selection| selection.contains(row, col))
                                {
                                    bg = rgb(0x344a72).into();
                                }
                                highlights.push((
                                    start..text.len(),
                                    HighlightStyle {
                                        color: Some(fg),
                                        background_color: Some(bg),
                                        font_weight: Some(if cell.bold() {
                                            FontWeight::BOLD
                                        } else {
                                            FontWeight::NORMAL
                                        }),
                                        font_style: Some(if cell.italic() {
                                            FontStyle::Italic
                                        } else {
                                            FontStyle::Normal
                                        }),
                                        ..Default::default()
                                    },
                                ));
                            }
                        }
                        (text, highlights)
                    })
                    .collect()
            })
            .unwrap_or_default();
        let focus = self.terminal_focus.clone();
        let entity = cx.entity();
        let cursor = screen
            .map(|screen| screen.cursor_position())
            .unwrap_or_default();
        div()
            .id("terminal-screen")
            .track_focus(&focus)
            .key_context("DovoTerminal")
            .relative()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .bg(rgb(0x0e1014))
            .text_color(rgb(0xe4e7ec))
            .p_2()
            .font_family("monospace")
            .text_size(px(13.))
            .line_height(px(18.))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    window.focus(&this.terminal_focus, cx);
                    if this.report_terminal_mouse(
                        event.position,
                        MouseReport::Press(0),
                        event.modifiers,
                    ) {
                        this.terminal_selection = None;
                        cx.stop_propagation();
                        return;
                    }
                    this.terminal_selection =
                        this.terminal_cell(event.position)
                            .map(|cell| TerminalSelection {
                                anchor: cell,
                                head: cell,
                            });
                    cx.notify();
                }),
            )
            .on_mouse_down(
                MouseButton::Middle,
                cx.listener(|this, event: &MouseDownEvent, _, cx| {
                    if this.report_terminal_mouse(
                        event.position,
                        MouseReport::Press(1),
                        event.modifiers,
                    ) {
                        cx.stop_propagation();
                    }
                }),
            )
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|this, event: &MouseDownEvent, _, cx| {
                    if this.report_terminal_mouse(
                        event.position,
                        MouseReport::Press(2),
                        event.modifiers,
                    ) {
                        cx.stop_propagation();
                    }
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, event: &MouseUpEvent, _, cx| {
                    if this.report_terminal_mouse(
                        event.position,
                        MouseReport::Release(0),
                        event.modifiers,
                    ) {
                        cx.stop_propagation();
                    }
                }),
            )
            .on_mouse_up(
                MouseButton::Middle,
                cx.listener(|this, event: &MouseUpEvent, _, cx| {
                    if this.report_terminal_mouse(
                        event.position,
                        MouseReport::Release(1),
                        event.modifiers,
                    ) {
                        cx.stop_propagation();
                    }
                }),
            )
            .on_mouse_up(
                MouseButton::Right,
                cx.listener(|this, event: &MouseUpEvent, _, cx| {
                    if this.report_terminal_mouse(
                        event.position,
                        MouseReport::Release(2),
                        event.modifiers,
                    ) {
                        cx.stop_propagation();
                    }
                }),
            )
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                if this.report_terminal_mouse(
                    event.position,
                    MouseReport::Motion(event.pressed_button.and_then(mouse_button)),
                    event.modifiers,
                ) {
                    cx.stop_propagation();
                    return;
                }
                if event.dragging()
                    && let Some(cell) = this.terminal_cell(event.position)
                    && let Some(selection) = this.terminal_selection.as_mut()
                {
                    selection.head = cell;
                    cx.notify();
                }
            }))
            .on_scroll_wheel(cx.listener(|this, event: &ScrollWheelEvent, _, cx| {
                let delta = (f32::from(event.delta.pixel_delta(px(18.)).y) / 18.).round() as isize;
                if delta != 0
                    && this.report_terminal_mouse(
                        event.position,
                        MouseReport::Wheel(delta > 0),
                        event.modifiers,
                    )
                {
                    for _ in 1..delta.unsigned_abs().min(20) {
                        this.report_terminal_mouse(
                            event.position,
                            MouseReport::Wheel(delta > 0),
                            event.modifiers,
                        );
                    }
                    cx.stop_propagation();
                    return;
                }
                this.terminal_selection = None;
                if let Some(id) = &this.selected_terminal
                    && let Some(parser) = this.terminal_screens.get_mut(id)
                {
                    let delta =
                        (f32::from(event.delta.pixel_delta(px(18.)).y) / 18.).round() as isize;
                    let next = parser.screen().scrollback().saturating_add_signed(delta);
                    parser.screen_mut().set_scrollback(next);
                    cx.notify();
                    cx.stop_propagation();
                }
            }))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                let Some(id) = this.selected_terminal.clone() else {
                    return;
                };
                if (event.keystroke.modifiers.platform
                    || event.keystroke.modifiers.control && event.keystroke.modifiers.shift)
                    && event.keystroke.key == "c"
                    && let Some(selection) = this.terminal_selection
                    && let Some(parser) = this.terminal_screens.get(&id)
                {
                    let (start, end) = selection.range();
                    let text = parser
                        .screen()
                        .contents_between(start.0, start.1, end.0, end.1);
                    if !text.is_empty() {
                        cx.write_to_clipboard(ClipboardItem::new_string(text));
                        cx.stop_propagation();
                        return;
                    }
                }
                if (event.keystroke.modifiers.platform
                    || event.keystroke.modifiers.control && event.keystroke.modifiers.shift)
                    && event.keystroke.key == "v"
                {
                    if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                        let bracketed = this
                            .terminal_screens
                            .get(&id)
                            .is_some_and(|parser| parser.screen().bracketed_paste());
                        this.command(Command::TerminalInput {
                            id,
                            data: if bracketed {
                                format!("\x1b[200~{text}\x1b[201~")
                            } else {
                                text
                            },
                        });
                    }
                    cx.stop_propagation();
                    return;
                }
                let application_cursor = this
                    .terminal_screens
                    .get(&id)
                    .is_some_and(|parser| parser.screen().application_cursor());
                if let Some(data) = key_input(&event.keystroke, application_cursor) {
                    this.command(Command::TerminalInput { id, data });
                    cx.stop_propagation();
                }
                let _ = window;
            }))
            .children(
                rows.into_iter()
                    .enumerate()
                    .map(|(row, (text, highlights))| {
                        div()
                            .relative()
                            .h(px(18.))
                            .child(StyledText::new(text).with_highlights(highlights))
                            .children(
                                (row == cursor.0 as usize
                                    && self.terminal_focus.is_focused(window))
                                .then(|| {
                                    div()
                                        .absolute()
                                        .left(px(cursor.1 as f32 * cell_width))
                                        .w(px(cell_width))
                                        .h(px(18.))
                                        .bg(rgba(0xe4e7ec60))
                                }),
                            )
                    }),
            )
            .children(self.terminal_status.get(&id).map(|status| {
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .bg(rgb(0x313c51))
                    .p_2()
                    .child(status.clone())
            }))
            .children((!self.terminal_marked.is_empty()).then(|| {
                div()
                    .absolute()
                    .bottom_0()
                    .bg(rgb(0x313c51))
                    .child(self.terminal_marked.clone())
            }))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |this, _| this.terminal_bounds = Some(bounds));
                        bounds
                    },
                    {
                        let entity = cx.entity();
                        move |_, bounds: Bounds<Pixels>, window, cx| {
                            let focus = entity.read(cx).terminal_focus.clone();
                            window.handle_input(
                                &focus,
                                ElementInputHandler::new(bounds, entity.clone()),
                                cx,
                            );
                            let rows = ((f32::from(bounds.size.height) - 16.) / 18.)
                                .floor()
                                .clamp(2., 300.) as u16;
                            let cols = ((f32::from(bounds.size.width) - 16.) / cell_width)
                                .floor()
                                .clamp(2., 500.) as u16;
                            entity.update(cx, |this, _| {
                                if let Some(id) = this.selected_terminal.clone()
                                    && let Some(parser) = this.terminal_screens.get_mut(&id)
                                    && parser.screen().size() != (rows, cols)
                                {
                                    parser.screen_mut().set_size(rows, cols);
                                    this.command(Command::TerminalResize { id, rows, cols });
                                }
                            });
                        }
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .into_any_element()
    }
}

impl EntityInputHandler for Workbench {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let units: Vec<_> = self.terminal_marked.encode_utf16().collect();
        let start = range.start.min(units.len());
        let end = range.end.min(units.len());
        *actual = Some(start..end);
        String::from_utf16(&units[start..end]).ok()
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let end = self.terminal_marked.encode_utf16().count();
        Some(UTF16Selection {
            range: end..end,
            reversed: false,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        (!self.terminal_marked.is_empty()).then(|| 0..self.terminal_marked.encode_utf16().count())
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.terminal_marked.clear();
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.terminal_marked.clear();
        if let Some(id) = self.selected_terminal.clone() {
            self.command(Command::TerminalInput {
                id,
                data: text.into(),
            });
        }
        cx.notify();
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.terminal_marked = text.into();
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let (row, col) = self
            .selected_terminal
            .as_ref()
            .and_then(|id| self.terminal_screens.get(id))
            .map(|parser| parser.screen().cursor_position())
            .unwrap_or_default();
        Some(Bounds::new(
            point(
                bounds.origin.x + px(col as f32 * self.terminal_cell_width),
                bounds.origin.y + px(row as f32 * 18.),
            ),
            size(px(self.terminal_cell_width), px(18.)),
        ))
    }
    fn character_index_for_point(
        &mut self,
        _: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        Some(0)
    }
}

fn terminal_color(color: vt100::Color, default: u32) -> Hsla {
    let value = match color {
        vt100::Color::Default => default,
        vt100::Color::Rgb(r, g, b) => (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b),
        vt100::Color::Idx(index) => {
            const PALETTE: [u32; 16] = [
                0x1e2229, 0xe06c75, 0x98c379, 0xe5c07b, 0x61afef, 0xc678dd, 0x56b6c2, 0xabb2bf,
                0x5c6370, 0xff7b86, 0xb5e890, 0xffd68a, 0x7bc5ff, 0xe295ff, 0x70d4df, 0xffffff,
            ];
            if index < 16 {
                PALETTE[index as usize]
            } else if index >= 232 {
                let v = 8 + u32::from(index - 232) * 10;
                (v << 16) | (v << 8) | v
            } else {
                let n = u32::from(index - 16);
                let level = |v: u32| if v == 0 { 0 } else { 55 + v * 40 };
                (level(n / 36) << 16) | (level((n / 6) % 6) << 8) | level(n % 6)
            }
        }
    };
    rgb(value).into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn mouse_modes_encoding_and_selection_override() {
        let mut parser = vt100::Parser::new(30, 200, 0);
        let modifiers = Modifiers::default();
        assert_eq!(
            mouse_input(parser.screen(), (2, 5), MouseReport::Press(0), modifiers),
            None
        );
        parser.process(b"\x1b[?1000h\x1b[?1006h");
        assert_eq!(
            mouse_input(parser.screen(), (2, 150), MouseReport::Press(0), modifiers).as_deref(),
            Some("\x1b[<0;151;3M".as_bytes())
        );
        assert_eq!(
            mouse_input(parser.screen(), (2, 5), MouseReport::Release(0), modifiers).as_deref(),
            Some("\x1b[<0;6;3m".as_bytes())
        );
        assert_eq!(
            mouse_input(
                parser.screen(),
                (2, 5),
                MouseReport::Motion(Some(0)),
                modifiers
            ),
            None
        );
        assert_eq!(
            mouse_input(
                parser.screen(),
                (2, 5),
                MouseReport::Press(0),
                Modifiers {
                    shift: true,
                    ..modifiers
                }
            ),
            None
        );
        parser.process(b"\x1b[?1002h");
        assert_eq!(
            mouse_input(
                parser.screen(),
                (2, 5),
                MouseReport::Motion(Some(0)),
                modifiers
            )
            .as_deref(),
            Some("\x1b[<32;6;3M".as_bytes())
        );
        assert_eq!(
            mouse_input(
                parser.screen(),
                (2, 5),
                MouseReport::Motion(None),
                modifiers
            ),
            None
        );
        parser.process(b"\x1b[?1003h");
        assert_eq!(
            mouse_input(
                parser.screen(),
                (2, 5),
                MouseReport::Motion(None),
                modifiers
            )
            .as_deref(),
            Some("\x1b[<35;6;3M".as_bytes())
        );
        assert_eq!(
            mouse_input(
                parser.screen(),
                (2, 5),
                MouseReport::Wheel(false),
                modifiers
            )
            .as_deref(),
            Some("\x1b[<65;6;3M".as_bytes())
        );
        parser.process(b"\x1b[?1006l");
        assert_eq!(
            mouse_input(parser.screen(), (2, 150), MouseReport::Press(0), modifiers).as_deref(),
            Some(b"\x1b[M \xb7#".as_slice())
        );
        assert_eq!(
            mouse_input(
                parser.screen(),
                (222, 222),
                MouseReport::Press(0),
                modifiers
            )
            .as_deref(),
            Some(b"\x1b[M \xff\xff".as_slice())
        );
        assert_eq!(
            mouse_input(parser.screen(), (2, 223), MouseReport::Press(0), modifiers),
            None
        );
        parser.process(b"\x1b[?1005h");
        assert_eq!(
            mouse_input(parser.screen(), (2, 150), MouseReport::Press(0), modifiers).as_deref(),
            Some("\x1b[M \u{b7}#".as_bytes())
        );
    }

    #[test]
    fn terminal_selection_uses_cells_and_preserves_wide_characters() {
        let mut parser = vt100::Parser::new(3, 20, 0);
        parser.process("a🦀b\r\nsecond".as_bytes());
        let selection = super::TerminalSelection {
            anchor: (1, 3),
            head: (0, 1),
        };
        let (start, end) = selection.range();
        assert_eq!(
            parser
                .screen()
                .contents_between(start.0, start.1, end.0, end.1),
            "🦀b\nsec"
        );
        assert!(selection.contains(0, 2));
        assert!(!selection.contains(1, 3));
    }

    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn control_and_application_cursor_sequences() {
        assert_eq!(
            key_input(
                &Keystroke {
                    key: "c".into(),
                    modifiers: Modifiers {
                        control: true,
                        ..Default::default()
                    },
                    ..Default::default()
                },
                false
            ),
            Some("\x03".into())
        );
        assert_eq!(
            key_input(
                &Keystroke {
                    key: "up".into(),
                    ..Default::default()
                },
                true
            ),
            Some("\x1bOA".into())
        );
        assert_eq!(
            key_input(
                &Keystroke {
                    key: "🦀".into(),
                    ..Default::default()
                },
                false
            ),
            None
        );
    }
    #[test]
    fn modified_keys_follow_xterm_sequences() {
        for (key, modifiers, expected) in [
            (
                "left",
                Modifiers {
                    control: true,
                    shift: true,
                    ..Default::default()
                },
                "\x1b[1;6D",
            ),
            ("f1", Modifiers::default(), "\x1bOP"),
            (
                "f12",
                Modifiers {
                    alt: true,
                    ..Default::default()
                },
                "\x1b[24;3~",
            ),
            (
                "space",
                Modifiers {
                    control: true,
                    ..Default::default()
                },
                "\0",
            ),
            (
                "[",
                Modifiers {
                    control: true,
                    ..Default::default()
                },
                "\x1b",
            ),
            (
                "b",
                Modifiers {
                    alt: true,
                    ..Default::default()
                },
                "\x1bb",
            ),
            (
                "tab",
                Modifiers {
                    shift: true,
                    ..Default::default()
                },
                "\x1b[Z",
            ),
        ] {
            assert_eq!(
                key_input(
                    &Keystroke {
                        key: key.into(),
                        modifiers,
                        ..Default::default()
                    },
                    true
                )
                .as_deref(),
                Some(expected)
            );
        }
    }
}
