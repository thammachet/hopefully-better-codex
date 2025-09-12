<h1 align="center">OpenAI Codex CLI</h1>

<p align="center"><strong>Fork notice:</strong> This repository is a fork of the upstream OpenAI Codex CLI. To use this fork’s changes, <strong>build from source</strong> instead of installing the upstream npm or Homebrew packages.</p>

<p align="center"><strong>Codex CLI</strong> is a coding agent from OpenAI that runs locally on your computer.</br>If you are looking for the <em>cloud-based agent</em> from OpenAI, <strong>Codex Web</strong>, see <a href="https://chatgpt.com/codex">chatgpt.com/codex</a>.</p>

<p align="center">
  <img src="./.github/codex-cli-splash.png" alt="Codex CLI splash" width="80%" />
  </p>

---

## Quickstart

### Installing and running Codex CLI

Recommended for this fork: build from source with Cargo.

```shell
cd codex-rs
cargo install --path cli --profile dev --target-dir ./target
codex
```

This compiles the Rust CLI and installs the `codex` binary into your Cargo bin directory (typically `~/.cargo/bin`).

Alternative (upstream package; not recommended for this fork):

- npm:

  ```shell
  npm install -g @openai/codex
  ```

- Homebrew:

  ```shell
  brew install codex
  ```

These install the upstream OpenAI package and may not include this fork’s changes.

### Codex Web (local web UI)

Run a local web UI for Codex alongside the CLI.

Start the server:

```shell
codex web
```

By default it binds to `0.0.0.0:7878`. Open `http://localhost:7878` in your browser.

Flags:

- `--host <ip>`: interface to bind (default `0.0.0.0`)
- `--port <port>`: port to listen on (default `7878`)
- `--static-dir <dir>`: serve a custom static site at `/` (optional)

What you can do in Codex Web:

- Create new sessions: choose CWD, model, approval policy, and sandbox mode.
- Resume rollout sessions and monitor events live.
- Manage authentication: start/cancel login and view status.
- Use the built-in terminal at `/pty`.

Note: This is the local web UI for Codex CLI. For OpenAI’s hosted, cloud-based agent, Codex Web, visit https://chatgpt.com/codex.

<details>
<summary>You can also go to the <a href="https://github.com/openai/codex/releases/latest">latest GitHub Release</a> and download the appropriate binary for your platform.</summary>

Each GitHub Release contains many executables, but in practice, you likely want one of these:

- macOS
  - Apple Silicon/arm64: `codex-aarch64-apple-darwin.tar.gz`
  - x86_64 (older Mac hardware): `codex-x86_64-apple-darwin.tar.gz`
- Linux
  - x86_64: `codex-x86_64-unknown-linux-musl.tar.gz`
  - arm64: `codex-aarch64-unknown-linux-musl.tar.gz`

Each archive contains a single entry with the platform baked into the name (e.g., `codex-x86_64-unknown-linux-musl`), so you likely want to rename it to `codex` after extracting it.

</details>

### Using Codex with your ChatGPT plan

<p align="center">
  <img src="./.github/codex-cli-login.png" alt="Codex CLI login" width="80%" />
  </p>

Run `codex` and select **Sign in with ChatGPT**. We recommend signing into your ChatGPT account to use Codex as part of your Plus, Pro, Team, Edu, or Enterprise plan. [Learn more about what's included in your ChatGPT plan](https://help.openai.com/en/articles/11369540-codex-in-chatgpt).

You can also use Codex with an API key, but this requires [additional setup](./docs/authentication.md#usage-based-billing-alternative-use-an-openai-api-key). If you previously used an API key for usage-based billing, see the [migration steps](./docs/authentication.md#migrating-from-usage-based-billing-api-key). If you're having trouble with login, please comment on [this issue](https://github.com/openai/codex/issues/1243).

### Model Context Protocol (MCP)

Codex CLI supports [MCP servers](./docs/advanced.md#model-context-protocol-mcp). Enable by adding an `mcp_servers` section to your `~/.codex/config.toml`.


### Configuration

Codex CLI supports a rich set of configuration options, with preferences stored in `~/.codex/config.toml`. For full configuration options, see [Configuration](./docs/config.md).

---

### Docs & FAQ

- [**Getting started**](./docs/getting-started.md)
  - [CLI usage](./docs/getting-started.md#cli-usage)
  - [Running with a prompt as input](./docs/getting-started.md#running-with-a-prompt-as-input)
  - [Example prompts](./docs/getting-started.md#example-prompts)
  - [Memory with AGENTS.md](./docs/getting-started.md#memory-with-agentsmd)
  - [Configuration](./docs/config.md)
- [**Sandbox & approvals**](./docs/sandbox.md)
- [**Authentication**](./docs/authentication.md)
  - [Auth methods](./docs/authentication.md#forcing-a-specific-auth-method-advanced)
  - [Login on a "Headless" machine](./docs/authentication.md#connecting-on-a-headless-machine)
- [**Advanced**](./docs/advanced.md)
  - [Non-interactive / CI mode](./docs/advanced.md#non-interactive--ci-mode)
  - [Tracing / verbose logging](./docs/advanced.md#tracing--verbose-logging)
  - [Model Context Protocol (MCP)](./docs/advanced.md#model-context-protocol-mcp)
- [**Zero data retention (ZDR)**](./docs/zdr.md)
- [**Contributing**](./docs/contributing.md)
- [**Install & build**](./docs/install.md)
  - [System Requirements](./docs/install.md#system-requirements)
  - [DotSlash](./docs/install.md#dotslash)
  - [Build from source](./docs/install.md#build-from-source)
- [**FAQ**](./docs/faq.md)
- [**Open source fund**](./docs/open-source-fund.md)

---

## Chain codex exec runs (resume)

The non‑interactive CLI (`codex exec`) can emit a final summary with the session id and rollout file path so you can resume the same conversation in a subsequent run.

- Enable summary output:

  - `--session-summary`: print a final summary when the run completes.
  - `--session-summary-format {text|json|shell}`: choose output format (default: `text`).
  - `--session-summary-file <path>`: also write the summary as JSON to a file.

- Example (POSIX shells):

  ```sh
  # First run: capture env exports for chaining
  eval $(codex exec --full-auto --session-summary --session-summary-format shell "bootstrap the project repo")
  
  # Next run: resume using the rollout path
  codex exec --full-auto -c experimental_resume="$CODEX_ROLLOUT_PATH" "continue: add unit tests"
  ```

- Example (PowerShell):

  ```powershell
  $summary = codex exec --session-summary --session-summary-format json "prep: scaffold modules" |
    ConvertFrom-Json | Where-Object { $_.type -eq 'session_summary' } | Select-Object -First 1
  $rollout = $summary.rollout_path
  codex exec --full-auto -c experimental_resume="$rollout" "continue: wire up CLI"
  ```

Notes:

- The rollout file lives under `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl`.
- Resuming via `-c experimental_resume="<path>"` preserves the same `conversation_id`.
- Default behavior remains unchanged unless you pass `--session-summary`.

### Advanced: Controller → Worker Orchestration

Use a “Controller” Codex to plan work and a “Worker” Codex to execute steps while preserving the Worker’s history across runs.

- Pattern:
  - Controller produces a single imperative one‑line instruction.
  - Worker executes that instruction under `codex exec -q -C "<cwd>" -c experimental_resume="<rollout.jsonl>"` so its conversation history is chained.

- PowerShell SOP (persist Worker once, then reuse):

  ```powershell
  # Ensure storage for rollout pointers
  New-Item -ItemType Directory -Force .codex | Out-Null

  # Start Worker if missing and persist its rollout
  if (-not (Test-Path .codex/worker.rollout)) {
    $w = codex exec -C "$PWD" --session-summary --session-summary-format json "Worker: reply READY" |
      ConvertFrom-Json | Where-Object { $_.type -eq 'session_summary' } | Select-Object -First 1
    if (-not $w) { throw "Failed to start worker Codex" }
    Set-Content -Path .codex/worker.rollout -Value $w.rollout_path
  }
  $WORKER_ROLLOUT = Get-Content .codex/worker.rollout -Raw

  # Controller: emit a single one‑line instruction
  codex exec -q -C "$PWD" --output-last-message ctrl_last.txt "Manager: output a single, imperative one-line instruction for the Worker. No preamble."
  $INSTR = Get-Content ctrl_last.txt -Raw

  # Worker: execute with chained history
  codex exec -q -C "$PWD" --full-auto -c experimental_resume="$WORKER_ROLLOUT" $INSTR
  ```

- POSIX SOP (uses jq):

  ```sh
  mkdir -p .codex
  if [ ! -f .codex/worker.rollout ]; then
    ROLLOUT=$(codex exec -C "$PWD" --session-summary --session-summary-format json "Worker: reply READY" \
      | jq -r 'select(.type=="session_summary") | .rollout_path' | head -n1)
    [ -z "$ROLLOUT" ] && { echo "Failed to start worker Codex" >&2; exit 1; }
    printf '%s' "$ROLLOUT" > .codex/worker.rollout
  fi
  WORKER_ROLLOUT=$(cat .codex/worker.rollout)

  # Controller → Worker handoff
  codex exec -q -C "$PWD" --output-last-message ctrl_last.txt "Manager: output a single, imperative one-line instruction for the Worker. No preamble."
  INSTR=$(cat ctrl_last.txt)
  codex exec -q -C "$PWD" --full-auto -c experimental_resume="$WORKER_ROLLOUT" "$INSTR"
  ```

- Prompting the Controller (suggested):
  - “You are the Controller for a separate Worker Codex in the project root. Output exactly one imperative one‑line instruction for the Worker (no prose). Prefer safe, idempotent steps; specify exact commands/paths; if info is missing, instruct the Worker to gather it first (e.g., run tests, scan files). When the goal is fully complete, output exactly: DONE.”

- Notes:
  - Keep the same `$WORKER_ROLLOUT` to chain Worker history.
  - Use `--output-last-message` to capture the Controller’s one‑liner cleanly.
  - For deeper orchestration, consider `codex proto` to route messages programmatically.

#### Controller Prompt (Self‑Contained, No PowerShell)

Copy/paste this as the prompt to your first (Controller) Codex. It teaches the Controller to bootstrap and command a second (Worker) Codex on its own.

```
You are the Controller orchestrating a separate Worker Codex in this repo.

Standard Operating Procedure (SOP):
- Storage: use a file .codex/worker.rollout to remember the Worker’s rollout path.
- Bootstrap Worker (only if the file is missing):
  1) Ensure .codex exists.
  2) Run: codex exec -C "<cwd>" --session-summary --session-summary-format json "Worker: reply READY"
  3) Parse the JSON line with type=="session_summary" to get rollout_path.
     - Prefer jq if available; else use: node -e "process.stdin.once('data',d=>{const x=JSON.parse(d.toString());if(x.type==='session_summary')console.log(x.rollout_path)})"
  4) Write rollout_path to .codex/worker.rollout
- Send instruction to Worker:
  1) Read rollout from .codex/worker.rollout
  2) Run: codex exec -C "<cwd>" --full-auto -c experimental_resume="<rollout>" "<ONE-LINE INSTRUCTION>"

Your output policy:
- Always reply with exactly one imperative one‑line instruction for the Worker. No prose, no markdown, no code fences.
- Steps must be safe and idempotent; specify exact commands/paths. Use conventional commits when committing.
- If information is missing, first instruct the Worker to gather it (e.g., scan files, run tests) before proposing changes.
- When the overall goal is fully complete, output exactly: DONE

Goal: <PUT HIGH‑LEVEL GOAL HERE>
```

## License

This repository is licensed under the [Apache-2.0 License](LICENSE).

