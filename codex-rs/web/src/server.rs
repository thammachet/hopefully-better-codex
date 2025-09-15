use std::sync::Arc;

use axum::extract::Path;
use axum::extract::State;
use axum::extract::WebSocketUpgrade;
use axum::extract::ws::Message;
use axum::extract::ws::WebSocket;
use axum::response::IntoResponse;
use futures_util::SinkExt;
use futures_util::StreamExt;
use tokio::task::JoinHandle;
use tracing::debug;

use crate::AppState;
use crate::session::ClientMsg;
#[cfg(unix)]
use portable_pty::CommandBuilder;
#[cfg(unix)]
use portable_pty::NativePtySystem;
#[cfg(unix)]
use portable_pty::PtySize;
#[cfg(unix)]
use portable_pty::PtySystem;

pub async fn ws_events(
    State(app): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let session_id = uuid::Uuid::parse_str(&id).ok();
    ws.on_upgrade(move |socket| async move {
        if let Some(uuid) = session_id {
            handle_socket(app, uuid, socket).await;
        } else {
            let mut sock = socket;
            let _ = sock
                .send(Message::Text(
                    "{\"type\":\"error\",\"message\":\"invalid session id\"}".to_string(),
                ))
                .await;
        }
    })
}

async fn handle_socket(app: Arc<AppState>, session_id: uuid::Uuid, mut socket: WebSocket) {
    // Lookup session and subscribe to its broadcaster.
    let (mut rx, ops_tx_opt, initial_event_json) = {
        let guard = app.sessions.read().await;
        match guard.get(&session_id) {
            Some(entry) => (
                entry.broadcaster.subscribe(),
                Some(entry.ops_tx.clone()),
                entry.initial_event_json.clone(),
            ),
            None => (tokio::sync::broadcast::channel::<String>(1).1, None, None),
        }
    };

    let ops_tx = match ops_tx_opt {
        Some(tx) => tx,
        None => {
            let _ = socket
                .send(Message::Text(
                    "{\"type\":\"error\",\"message\":\"session not found\"}".to_string(),
                ))
                .await;
            return;
        }
    };

    // Fan-out task: forward broadcasted events to the websocket.
    let (mut sender, mut receiver) = socket.split();
    // Send the initial SessionConfigured to the new subscriber so UIs can render history.
    if let Some(json) = initial_event_json {
        let _ = sender.send(Message::Text(json)).await;
    }
    let fwd_task: JoinHandle<()> = tokio::spawn(async move {
        while let Ok(s) = rx.recv().await {
            if sender.send(Message::Text(s)).await.is_err() {
                break;
            }
        }
    });

    // Read loop: accept client control messages and submit to conversation.
    while let Some(msg) = receiver.next().await {
        let Ok(msg) = msg else { break };
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMsg>(&text) {
                Ok(msg) => {
                    let _ = ops_tx.send(msg);
                }
                Err(e) => {
                    debug!("bad client message: {e}");
                }
            },
            Message::Close(_) => break,
            Message::Ping(_p) => {}
            _ => {}
        }
    }

    // Close: stop forwarder
    fwd_task.abort();
}

// WebSocket that proxies a PTY running the TUI. Unix-only; on non-Unix returns an error.
pub async fn ws_pty(State(_app): State<Arc<AppState>>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_pty_socket)
}

#[cfg(unix)]
async fn handle_pty_socket(mut socket: WebSocket) {
    use std::io::Read;
    use std::io::Write;

    let pty_system = NativePtySystem::default();
    let pair = match pty_system.openpty(PtySize {
        rows: 30,
        cols: 100,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            let _ = socket
                .send(Message::Text(format!(
                    "{{\"type\":\"error\",\"message\":\"pty open failed: {e}\"}}"
                )))
                .await;
            return;
        }
    };

    let cmd = CommandBuilder::new("codex");
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            let _ = socket
                .send(Message::Text(format!(
                    "{{\"type\":\"error\",\"message\":\"spawn failed: {e}\"}}"
                )))
                .await;
            return;
        }
    };

    let mut reader = pair.master.try_clone_reader().expect("clone reader");
    let mut writer = pair.master.take_writer().expect("take writer");

    // PTY -> WS via channel
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let read_task = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = tx.send(s);
                }
                Err(_) => break,
            }
        }
    });
    let ws_send_task = tokio::spawn(async move {
        while let Some(s) = rx.recv().await {
            if sender.send(Message::Text(s)).await.is_err() {
                break;
            }
        }
    });

    // WS -> PTY
    while let Some(msg) = receiver.next().await {
        let Ok(msg) = msg else { break };
        match msg {
            Message::Text(s) => {
                let _ = writer.write_all(s.as_bytes());
                let _ = writer.flush();
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    let _ = read_task.await;
    let _ = ws_send_task.await;
    let _ = child.kill();
}

#[cfg(not(unix))]
async fn handle_pty_socket(mut socket: WebSocket) {
    let _ = socket
        .send(Message::Text(
            "{\"type\":\"error\",\"message\":\"pty not supported on this platform\"}".to_string(),
        ))
        .await;
}
