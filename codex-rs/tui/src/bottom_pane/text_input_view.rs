use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Modifier;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Widget;

use crate::app_event_sender::AppEventSender;

use super::BottomPane;
use super::bottom_pane_view::BottomPaneView;

/// Callback invoked when the user confirms input (Enter).
type InputAction = Box<dyn Fn(&AppEventSender, String) + Send + Sync>;

/// Simple one-line text input view used for quick configuration edits.
pub(crate) struct TextInputView {
    title: String,
    subtitle: Option<String>,
    footer_hint: Option<String>,
    value: String,
    on_accept: InputAction,
    app_event_tx: AppEventSender,
    complete: bool,
}

impl TextInputView {
    pub(crate) fn new(
        title: String,
        subtitle: Option<String>,
        footer_hint: Option<String>,
        initial_value: String,
        on_accept: InputAction,
        app_event_tx: AppEventSender,
    ) -> Self {
        Self {
            title,
            subtitle,
            footer_hint,
            value: initial_value,
            on_accept,
            app_event_tx,
            complete: false,
        }
    }
}

impl BottomPaneView for TextInputView {
    fn handle_key_event(&mut self, _pane: &mut BottomPane, key_event: KeyEvent) {
        match key_event.code {
            KeyCode::Esc => {
                self.complete = true;
            }
            KeyCode::Enter => {
                (self.on_accept)(&self.app_event_tx, self.value.clone());
                self.complete = true;
            }
            KeyCode::Backspace => {
                self.value.pop();
            }
            KeyCode::Char(c) => {
                // Only accept printable, ignore control modifiers
                if !key_event
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
                    && !key_event
                        .modifiers
                        .contains(crossterm::event::KeyModifiers::ALT)
                {
                    self.value.push(c);
                }
            }
            _ => {}
        }
    }

    fn is_complete(&self) -> bool {
        self.complete
    }

    fn on_ctrl_c(&mut self, _pane: &mut BottomPane) -> super::CancellationEvent {
        self.complete = true;
        super::CancellationEvent::Handled
    }

    fn desired_height(&self, _width: u16) -> u16 {
        // Title + (optional subtitle + spacer) + input line + (optional footer)
        let mut h = 2; // title + input
        if self.subtitle.is_some() {
            h += 2; // subtitle + spacer
        }
        if self.footer_hint.is_some() {
            h += 2; // spacer + footer
        }
        h
    }

    #[allow(clippy::vec_init_then_push)]
    fn render(&self, area: Rect, buf: &mut Buffer) {
        if area.height == 0 || area.width == 0 {
            return;
        }

        // Title
        Paragraph::new(Line::from(self.title.clone())).render(
            Rect {
                x: area.x,
                y: area.y,
                width: area.width,
                height: 1,
            },
            buf,
        );

        let mut y = area.y + 1;
        if let Some(sub) = &self.subtitle {
            Paragraph::new(Line::from(sub.as_str())).render(
                Rect {
                    x: area.x,
                    y,
                    width: area.width,
                    height: 1,
                },
                buf,
            );
            y += 2; // leave a blank line after subtitle
        }

        // Input line: prefix + value (no cursor, inline input only)
        let mut spans: Vec<Span> = Vec::new();
        spans.push(Span::from("▌ ").style(Style::default().add_modifier(Modifier::DIM)));
        spans.push(Span::from(self.value.clone()));
        Paragraph::new(Line::from(spans)).render(
            Rect {
                x: area.x,
                y,
                width: area.width,
                height: 1,
            },
            buf,
        );
        y += 1;

        if let Some(hint) = &self.footer_hint {
            Paragraph::new(Line::from(hint.as_str())).render(
                Rect {
                    x: area.x,
                    y,
                    width: area.width,
                    height: 1,
                },
                buf,
            );
        }
    }
}
