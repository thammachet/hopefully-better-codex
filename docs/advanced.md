## Advanced

## Non-interactive / CI mode

Run Codex head-less in pipelines. Example GitHub Action step:

```yaml
- name: Update changelog via Codex
  run: |
    npm install -g @openai/codex
    export OPENAI_API_KEY="${{ secrets.OPENAI_KEY }}"
    codex exec --full-auto "update CHANGELOG for next release"
```

## Tracing / verbose logging

Because Codex is written in Rust, it honors the `RUST_LOG` environment variable to configure its logging behavior.

The TUI defaults to `RUST_LOG=codex_core=info,codex_tui=info` and log messages are written to `~/.codex/log/codex-tui.log`, so you can leave the following running in a separate terminal to monitor log messages as they are written:

```
tail -F ~/.codex/log/codex-tui.log
```

By comparison, the non-interactive mode (`codex exec`) defaults to `RUST_LOG=error`, but messages are printed inline, so there is no need to monitor a separate file.

See the Rust documentation on [`RUST_LOG`](https://docs.rs/env_logger/latest/env_logger/#enabling-logging) for more information on the configuration options.

## Model Context Protocol (MCP)

The Codex CLI can be configured to leverage MCP servers by defining an [`mcp_servers`](./config.md#mcp_servers) section in `~/.codex/config.toml`. It is intended to mirror how tools such as Claude and Cursor define `mcpServers` in their respective JSON config files, though the Codex format is slightly different since it uses TOML rather than JSON, e.g.:

```toml
# IMPORTANT: the top-level key is `mcp_servers` rather than `mcpServers`.
[mcp_servers.server-name]
command = "npx"
args = ["-y", "mcp-server"]
env = { "API_KEY" = "value" }
```

> [!TIP]
> It is somewhat experimental, but the Codex CLI can also be run as an MCP _server_ via `codex mcp`. If you launch it with an MCP client such as `npx @modelcontextprotocol/inspector codex mcp` and send it a `tools/list` request, you will see that there is only one tool, `codex`, that accepts a grab-bag of inputs, including a catch-all `config` map for anything you might want to override. Feel free to play around with it and provide feedback via GitHub issues. 

## Controller → Worker Orchestration

Use a “Controller” Codex to plan work and a “Worker” Codex to execute steps while preserving the Worker’s history across runs.

- Pattern:
  - Controller produces a single imperative one‑line instruction.
  - Worker executes that instruction under `codex exec -c experimental_resume="<rollout.jsonl>"` so its conversation history is chained.

- PowerShell SOP (persist Worker once, then reuse):

  ```powershell
  # Ensure storage for rollout pointers
  New-Item -ItemType Directory -Force .codex | Out-Null

  # Start Worker if missing and persist its rollout
  if (-not (Test-Path .codex/worker.rollout)) {
    $w = codex exec --session-summary --session-summary-format json "Worker: reply READY" |
      ConvertFrom-Json | Where-Object { $_.type -eq 'session_summary' } | Select-Object -First 1
    if (-not $w) { throw "Failed to start worker Codex" }
    Set-Content -Path .codex/worker.rollout -Value $w.rollout_path
  }
  $WORKER_ROLLOUT = Get-Content .codex/worker.rollout -Raw

  # Controller: emit a single one‑line instruction
  codex exec --output-last-message ctrl_last.txt "Manager: output a single, imperative one‑line instruction for the Worker. No preamble."
  $INSTR = Get-Content ctrl_last.txt -Raw

  # Worker: execute with chained history
  codex exec --full-auto -c experimental_resume="$WORKER_ROLLOUT" $INSTR
  ```

- POSIX SOP (uses jq):

  ```sh
  mkdir -p .codex
  if [ ! -f .codex/worker.rollout ]; then
    ROLLOUT=$(codex exec --session-summary --session-summary-format json "Worker: reply READY" \
      | jq -r 'select(.type=="session_summary") | .rollout_path' | head -n1)
    [ -z "$ROLLOUT" ] && { echo "Failed to start worker Codex" >&2; exit 1; }
    printf '%s' "$ROLLOUT" > .codex/worker.rollout
  fi
  WORKER_ROLLOUT=$(cat .codex/worker.rollout)

  # Controller → Worker handoff
  codex exec --output-last-message ctrl_last.txt "Manager: output a single, imperative one‑line instruction for the Worker. No preamble."
  INSTR=$(cat ctrl_last.txt)
  codex exec --full-auto -c experimental_resume="$WORKER_ROLLOUT" "$INSTR"
  ```

- Controller prompt suggestion:
  - “You are the Controller for a separate Worker Codex in the project root. Output exactly one imperative one‑line instruction for the Worker (no prose). Prefer safe, idempotent steps; specify exact commands/paths; if info is missing, instruct the Worker to gather it first (e.g., run tests, scan files). When the goal is fully complete, output exactly: DONE.”

- Notes:
  - Keep the same `$WORKER_ROLLOUT` to chain Worker history.
  - Use `--output-last-message` to capture the Controller’s one‑liner cleanly.
  - For deeper orchestration, consider `codex proto` to route messages programmatically.

### Controller Prompt (Self‑Contained, No PowerShell)

Copy/paste this as the prompt to your first (Controller) Codex. It teaches the Controller to bootstrap and command a second (Worker) Codex on its own.

```
You are the Controller orchestrating a separate Worker Codex in this repo.

Standard Operating Procedure (SOP):
- Storage: use a file .codex/worker.rollout to remember the Worker’s rollout path.
- Bootstrap Worker (only if the file is missing):
  1) Ensure .codex exists.
  2) Run: codex exec --session-summary --session-summary-format json "Worker: reply READY"
  3) Parse the JSON line with type=="session_summary" to get rollout_path.
     - Prefer jq if available; else use: node -e "process.stdin.once('data',d=>{const x=JSON.parse(d.toString());if(x.type==='session_summary')console.log(x.rollout_path)})"
  4) Write rollout_path to .codex/worker.rollout
- Send instruction to Worker:
  1) Read rollout from .codex/worker.rollout
  2) Run: codex exec --full-auto -c experimental_resume="<rollout>" "<ONE-LINE INSTRUCTION>"

Your output policy:
- Always reply with exactly one imperative one‑line instruction for the Worker. No prose, no markdown, no code fences.
- Steps must be safe and idempotent; specify exact commands/paths. Use conventional commits when committing.
- If information is missing, first instruct the Worker to gather it (e.g., scan files, run tests) before proposing changes.
- When the overall goal is fully complete, output exactly: DONE

Goal: <PUT HIGH‑LEVEL GOAL HERE>
```
