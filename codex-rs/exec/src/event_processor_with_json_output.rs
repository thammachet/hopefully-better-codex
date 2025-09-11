use std::collections::HashMap;
use std::path::PathBuf;

use codex_core::config::Config;
use codex_core::protocol::Event;
use codex_core::protocol::EventMsg;
use codex_core::protocol::TaskCompleteEvent;
use codex_protocol::mcp_protocol::ConversationId;
use serde_json::json;

use crate::event_processor::CodexStatus;
use crate::event_processor::EventProcessor;
use crate::event_processor::handle_last_message;
use codex_common::create_config_summary_entries;

pub(crate) struct EventProcessorWithJsonOutput {
    last_message_path: Option<PathBuf>,
    want_summary: bool,
    summary_file: Option<PathBuf>,
    // cached from SessionConfigured
    session_id: Option<ConversationId>,
    rollout_path: Option<PathBuf>,
    model: Option<String>,
}

impl EventProcessorWithJsonOutput {
    pub fn new(
        last_message_path: Option<PathBuf>,
        want_summary: bool,
        summary_file: Option<PathBuf>,
    ) -> Self {
        Self {
            last_message_path,
            want_summary,
            summary_file,
            session_id: None,
            rollout_path: None,
            model: None,
        }
    }
}

impl EventProcessor for EventProcessorWithJsonOutput {
    fn print_config_summary(&mut self, config: &Config, prompt: &str) {
        let entries = create_config_summary_entries(config)
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect::<HashMap<String, String>>();
        #[expect(clippy::expect_used)]
        let config_json =
            serde_json::to_string(&entries).expect("Failed to serialize config summary to JSON");
        println!("{config_json}");

        let prompt_json = json!({
            "prompt": prompt,
        });
        println!("{prompt_json}");
    }

    fn process_event(&mut self, event: Event) -> CodexStatus {
        let printable = event.clone();
        match event.msg {
            EventMsg::AgentMessageDelta(_) | EventMsg::AgentReasoningDelta(_) => {
                // Suppress streaming events in JSON mode.
                CodexStatus::Running
            }
            EventMsg::TaskComplete(TaskCompleteEvent { last_agent_message }) => {
                if let Some(output_file) = self.last_message_path.as_deref() {
                    handle_last_message(last_agent_message.as_deref(), output_file);
                }
                CodexStatus::InitiateShutdown
            }
            EventMsg::ShutdownComplete => {
                self.maybe_emit_summary();
                CodexStatus::Shutdown
            }
            EventMsg::SessionConfigured(ev) => {
                self.session_id = Some(ev.session_id);
                self.rollout_path = Some(ev.rollout_path);
                self.model = Some(ev.model);
                // Fall through to default printing via `_` arm below by printing here too
                // would duplicate; instead rely on the `_` arm by returning Running without printing.
                CodexStatus::Running
            }
            _ => {
                if let Ok(line) = serde_json::to_string(&printable) {
                    println!("{line}");
                }
                CodexStatus::Running
            }
        }
    }
}

impl EventProcessorWithJsonOutput {
    fn maybe_emit_summary(&self) {
        if !self.want_summary {
            return;
        }
        let Some(id) = self.session_id.as_ref() else {
            return;
        };
        let Some(path) = self.rollout_path.as_ref() else {
            return;
        };
        let model = self.model.clone().unwrap_or_default();

        let obj = json!({
            "type": "session_summary",
            "session_id": id,
            "rollout_path": format!("{}", path.display()),
            "model": model,
        });
        if let Ok(line) = serde_json::to_string(&obj) {
            println!("{line}");
        }
        if let Some(file) = self.summary_file.as_ref() {
            if let Ok(s) = serde_json::to_string_pretty(&obj) {
                let _ = std::fs::write(file, s);
            }
        }
    }
}
