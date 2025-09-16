use codex_core::CodexAuth;
use codex_core::ConversationManager;
use codex_core::ModelProviderInfo;
use codex_core::built_in_model_providers;
use codex_core::protocol::AskForApproval;
use codex_core::protocol::EventMsg;
use codex_core::protocol::ExecCommandEndEvent;
use codex_core::protocol::InputItem;
use codex_core::protocol::Op;
use codex_core::protocol::SandboxPolicy;
use core_test_support::load_default_config_for_test;
use core_test_support::load_sse_fixture_with_id_from_str;
use core_test_support::wait_for_event;
use tempfile::TempDir;
use wiremock::Mock;
use wiremock::MockServer;
use wiremock::ResponseTemplate;
use wiremock::matchers::body_string_contains;
use wiremock::matchers::method;
use wiremock::matchers::path;

/// SSE body for main agent that triggers a sub-agent launch.
fn sse_main_launch() -> String {
    let json = r#"[
  {
    "type": "response.output_item.done",
    "item": {
      "type": "function_call",
      "id": "fc-main-1",
      "name": "sub_agent_launch",
      "arguments": "{\"prompt\":\"run the command\"}",
      "call_id": "call-main-1"
    }
  },
  {
    "type": "response.output_item.done",
    "item": {
      "type": "message",
      "role": "assistant",
      "content": [{"type": "output_text", "text": "launching sub"}]
    }
  },
  {
    "type": "response.completed",
    "response": {"id": "__ID__", "usage": {"input_tokens":0,"input_tokens_details":null,"output_tokens":0,"output_tokens_details":null,"total_tokens":0}}
  }
]"#;
    load_sse_fixture_with_id_from_str(json, "resp-main")
}

/// SSE body for the sub-agent that calls the `shell` tool and then emits an assistant message.
fn sse_sub_runs_shell_with_escalated(script: &str, with_escalated: bool) -> String {
    let json = r#"[
  {
    "type": "response.output_item.done",
    "item": {
      "type": "function_call",
      "id": "fc-sub-1",
      "name": "shell",
      "arguments": "__ARGS__",
      "call_id": "call-sub-1"
    }
  },
  {
    "type": "response.output_item.done",
    "item": {
      "type": "message",
      "role": "assistant",
      "content": [{"type": "output_text", "text": "ok"}]
    }
  },
  {
    "type": "response.completed",
    "response": {"id": "__ID__", "usage": {"input_tokens":0,"input_tokens_details":null,"output_tokens":0,"output_tokens_details":null,"total_tokens":0}}
  }
]"#;
    let args = if with_escalated {
        format!(
            "{{\\\"command\\\":[\\\"bash\\\",\\\"-lc\\\",\\\"{script}\\\"],\\\"timeout\\\":2000,\\\"with_escalated_permissions\\\":true}}"
        )
    } else {
        format!(
            "{{\\\"command\\\":[\\\"bash\\\",\\\"-lc\\\",\\\"{script}\\\"],\\\"timeout\\\":2000}}"
        )
    };
    let json = json.replace("__ARGS__", &args);
    load_sse_fixture_with_id_from_str(&json, "resp-sub")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sub_agent_exec_inherits_policies_and_runs() {
    // Two sequential SSE responses: main turn (launch) then sub-agent turn (shell)
    let server = MockServer::start().await;

    let sse1 = sse_main_launch();
    let first = ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_raw(sse1, "text/event-stream");
    Mock::given(method("POST"))
        .and(body_string_contains("trigger sub-agent"))
        .and(path("/v1/responses"))
        .respond_with(first)
        .expect(1)
        .mount(&server)
        .await;

    // Simple command that should succeed under inherited policies.
    let sse2 = sse_sub_runs_shell_with_escalated("echo ok", false);
    let second = ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_raw(sse2, "text/event-stream");
    Mock::given(method("POST"))
        .and(body_string_contains("run the command"))
        .and(path("/v1/responses"))
        .respond_with(second)
        .expect(1)
        .mount(&server)
        .await;

    let model_provider = ModelProviderInfo {
        base_url: Some(format!("{}/v1", server.uri())),
        ..built_in_model_providers()["openai"].clone()
    };

    let cwd = TempDir::new().unwrap();
    let codex_home = TempDir::new().unwrap();
    let mut config = load_default_config_for_test(&codex_home);
    // Ensure permissive policies so the sub-agent can run without per-call overrides.
    config.approval_policy = AskForApproval::Never;
    config.sandbox_policy = SandboxPolicy::DangerFullAccess;
    config.cwd = cwd.path().to_path_buf();
    config.model_provider = model_provider;

    let conversation_manager =
        ConversationManager::with_auth(CodexAuth::from_api_key("Test API Key"));
    let codex = conversation_manager
        .new_conversation(config)
        .await
        .expect("create new conversation")
        .conversation;

    codex
        .submit(Op::UserInput {
            items: vec![InputItem::Text {
                text: "trigger sub-agent".into(),
            }],
        })
        .await
        .unwrap();

    // Drive the stream and capture the approval request so we can respond to it.
    let mut saw_started = false;
    loop {
        let ev = codex.next_event().await.expect("event");
        match ev.msg {
            EventMsg::SubAgentStarted(_) => {
                saw_started = true;
            }
            EventMsg::SubAgentCompleted(_) => {
                assert!(saw_started, "expected sub-agent to have started");
                break;
            }
            _ => {}
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sub_agent_exec_succeeds_with_danger_full_access() {
    // Two sequential SSE responses: main turn (launch with danger) then sub-agent turn (shell)
    let server = MockServer::start().await;

    let sse1 = sse_main_launch();
    let first = ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_raw(sse1, "text/event-stream");
    Mock::given(method("POST"))
        .and(body_string_contains("trigger sub-agent"))
        .and(path("/v1/responses"))
        .respond_with(first)
        .expect(1)
        .mount(&server)
        .await;

    let sse2 = sse_sub_runs_shell_with_escalated("echo from sub-agent", false);
    let second = ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_raw(sse2, "text/event-stream");
    Mock::given(method("POST"))
        .and(body_string_contains("run the command"))
        .and(path("/v1/responses"))
        .respond_with(second)
        .expect(1)
        .mount(&server)
        .await;

    let model_provider = ModelProviderInfo {
        base_url: Some(format!("{}/v1", server.uri())),
        ..built_in_model_providers()["openai"].clone()
    };

    let cwd = TempDir::new().unwrap();
    let codex_home = TempDir::new().unwrap();
    let mut config = load_default_config_for_test(&codex_home);
    // Ensure permissive policies so the sub-agent can run without per-call overrides.
    config.approval_policy = AskForApproval::Never;
    config.sandbox_policy = SandboxPolicy::DangerFullAccess;
    config.cwd = cwd.path().to_path_buf();
    config.model_provider = model_provider;

    let conversation_manager =
        ConversationManager::with_auth(CodexAuth::from_api_key("Test API Key"));
    let codex = conversation_manager
        .new_conversation(config)
        .await
        .expect("create new conversation")
        .conversation;

    codex
        .submit(Op::UserInput {
            items: vec![InputItem::Text {
                text: "trigger sub-agent".into(),
            }],
        })
        .await
        .unwrap();

    // Sub-agent starts.
    wait_for_event(&codex, |ev| matches!(ev, EventMsg::SubAgentStarted(_))).await;

    // Capture the exec ending successfully (exit code 0).
    let ev = wait_for_event(&codex, |ev| matches!(ev, EventMsg::ExecCommandEnd(_))).await;
    let EventMsg::ExecCommandEnd(ExecCommandEndEvent { exit_code, .. }) = ev else {
        unreachable!()
    };
    assert_eq!(exit_code, 0, "expected sub-agent command to succeed");

    // And the sub-agent should complete afterwards.
    wait_for_event(&codex, |ev| matches!(ev, EventMsg::SubAgentCompleted(_))).await;
}
