use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::WidgetRef;

use super::popup_consts::MAX_POPUP_ROWS;
use super::scroll_state::ScrollState;
use super::selection_popup_common::GenericDisplayRow;
use super::selection_popup_common::render_rows;
use codex_common::model_presets::ModelPreset;
use codex_common::model_presets::builtin_model_presets;

pub(crate) struct ModelSearchPopup {
    query: String,
    matches: Vec<ModelPreset>,
    state: ScrollState,
}

impl ModelSearchPopup {
    pub(crate) fn new() -> Self {
        Self {
            query: String::new(),
            matches: Vec::new(),
            state: ScrollState::new(),
        }
    }

    pub(crate) fn has_matches(query: &str) -> bool {
        if query.is_empty() {
            return false;
        }
        let q = query.to_ascii_lowercase();
        builtin_model_presets()
            .iter()
            .any(|p| p.model.to_ascii_lowercase().starts_with(&q))
    }

    pub(crate) fn set_query(&mut self, query: &str) {
        self.query.clear();
        self.query.push_str(query);

        let q = self.query.to_ascii_lowercase();
        let mut matches: Vec<ModelPreset> = builtin_model_presets()
            .iter()
            .filter(|p| p.model.to_ascii_lowercase().starts_with(&q))
            .cloned()
            .collect();

        // Sort by model, then by effort descending (High → Medium → Low → Minimal).
        matches.sort_by(|a, b| {
            use codex_core::protocol_config_types::ReasoningEffort as Effort;
            let rank = |e: Effort| match e {
                Effort::High => 0,
                Effort::Medium => 1,
                Effort::Low => 2,
                Effort::Minimal => 3,
            };
            match a.model.cmp(b.model) {
                std::cmp::Ordering::Equal => rank(a.effort).cmp(&rank(b.effort)),
                other => other,
            }
        });

        let old_sel = self.state.selected_idx;
        self.matches = std::mem::take(&mut matches);
        let len = self.matches.len();
        self.state.clamp_selection(len);
        if old_sel.is_none() && len > 0 {
            self.state.selected_idx = Some(0);
        }
        self.state.ensure_visible(len, len.min(MAX_POPUP_ROWS));
    }

    pub(crate) fn move_up(&mut self) {
        let len = self.matches.len();
        self.state.move_up_wrap(len);
        self.state.ensure_visible(len, len.min(MAX_POPUP_ROWS));
    }

    pub(crate) fn move_down(&mut self) {
        let len = self.matches.len();
        self.state.move_down_wrap(len);
        self.state.ensure_visible(len, len.min(MAX_POPUP_ROWS));
    }

    pub(crate) fn selected_display_string(&self) -> Option<String> {
        self.state
            .selected_idx
            .and_then(|idx| self.matches.get(idx))
            .map(|m| {
                let eff = match m.effort {
                    codex_core::protocol_config_types::ReasoningEffort::Minimal => "minimal",
                    codex_core::protocol_config_types::ReasoningEffort::Low => "low",
                    codex_core::protocol_config_types::ReasoningEffort::Medium => "medium",
                    codex_core::protocol_config_types::ReasoningEffort::High => "high",
                };
                let mut s = String::new();
                s.push('@');
                s.push_str(m.model);
                if eff != "default" {
                    s.push('-');
                    s.push_str(eff);
                }
                s
            })
    }

    pub(crate) fn calculate_required_height(&self) -> u16 {
        self.matches.len().clamp(1, MAX_POPUP_ROWS) as u16
    }
}

impl WidgetRef for &ModelSearchPopup {
    fn render_ref(&self, area: Rect, buf: &mut Buffer) {
        let rows_all: Vec<GenericDisplayRow> = if self.matches.is_empty() {
            Vec::new()
        } else {
            self.matches
                .iter()
                .map(|m| GenericDisplayRow {
                    name: format!(
                        "@{}-{}",
                        m.model,
                        match m.effort {
                            codex_core::protocol_config_types::ReasoningEffort::Minimal =>
                                "minimal",
                            codex_core::protocol_config_types::ReasoningEffort::Low => "low",
                            codex_core::protocol_config_types::ReasoningEffort::Medium => "medium",
                            codex_core::protocol_config_types::ReasoningEffort::High => "high",
                        }
                    ),
                    match_indices: None,
                    is_current: false,
                    description: Some(m.description.to_string()),
                })
                .collect()
        };
        render_rows(
            area,
            buf,
            &rows_all,
            &self.state,
            MAX_POPUP_ROWS,
            false,
            "type at least 1 char",
        );
    }
}
