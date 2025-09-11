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

#[cfg(test)]
mod tests {
    use super::EventProcessorWithJsonOutput;
    use crate::event_processor::EventProcessor;
    use codex_core::protocol::{Event, EventMsg, SessionConfiguredEvent, TaskCompleteEvent};
    use codex_protocol::mcp_protocol::ConversationId;
    use std::path::PathBuf;

    #[test]
    fn writes_summary_file_on_shutdown() {
        let dir = tempfile::tempdir().expect("tempdir");
        let summary_path = dir.path().join("summary.json");

        let session_id = ConversationId::default();
        let rollout_path: PathBuf = dir.path().join("rollout-xyz.jsonl");
        let configured = SessionConfiguredEvent {
            session_id,
            model: "gpt-5".to_string(),
            history_log_id: 0,
            history_entry_count: 0,
            initial_messages: None,
            rollout_path: rollout_path.clone(),
        };

        let mut proc = EventProcessorWithJsonOutput::new(None, true, Some(summary_path.clone()));
        let _ = proc.process_event(Event { id: "0".into(), msg: EventMsg::SessionConfigured(configured) });
        let _ = proc.process_event(Event { id: "1".into(), msg: EventMsg::TaskComplete(TaskCompleteEvent { last_agent_message: None }) });
        let _ = proc.process_event(Event { id: "2".into(), msg: EventMsg::ShutdownComplete });

        let buf = std::fs::read_to_string(&summary_path).expect("read summary");
        let v: serde_json::Value = serde_json::from_str(&buf).expect("parse summary json");
        assert_eq!(v.get("type").and_then(|x| x.as_str()), Some("session_summary"));
        let got_path = v.get("rollout_path").and_then(|x| x.as_str()).unwrap_or("");
        assert!(got_path.ends_with("rollout-xyz.jsonl"), "unexpected rollout_path: {got_path}");
        assert!(v.get("session_id").is_some(), "missing session_id");
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
                // Print the event now (to preserve the original id) and continue.
                if let Ok(line) = serde_json::to_string(&printable) {
                    println!("{line}");
                }
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
        if let Some(file) = self.summary_file.as_ref()
            && let Ok(s) = serde_json::to_string_pretty(&obj)
        {
            let _ = std::fs::write(file, s);
        }
    }
}
