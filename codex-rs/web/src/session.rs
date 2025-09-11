use serde::Deserialize;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    UserMessage {
        text: String,
        images: Option<Vec<String>>,
    },
    Interrupt,
    ExecApproval {
        id: String,
        decision: codex_core::protocol::ReviewDecision,
    },
    PatchApproval {
        id: String,
        decision: codex_core::protocol::ReviewDecision,
    },
    Compact,
    OverrideTurnContext {
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<std::path::PathBuf>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        approval_policy: Option<codex_core::protocol::AskForApproval>,
        #[serde(skip_serializing_if = "Option::is_none")]
        effort: Option<codex_core::protocol_config_types::ReasoningEffort>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sandbox_mode: Option<codex_protocol::config_types::SandboxMode>,
    },
}

pub struct SessionEntry {
    pub broadcaster: broadcast::Sender<String>,
    pub ops_tx: mpsc::UnboundedSender<ClientMsg>,
    pub _event_task: JoinHandle<()>,
    pub _ops_task: JoinHandle<()>,
    pub initial_event_json: Option<String>,
}

// Tasks are spawned inline where the conversation handle is available to avoid
// referring to private types from codex-core.
