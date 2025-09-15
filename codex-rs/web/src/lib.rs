#![deny(clippy::print_stdout, clippy::print_stderr)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::Path;
use axum::extract::State;
use axum::routing::get;
use axum::routing::post;
use codex_common::CliConfigOverrides;
use codex_core::config::Config;
use codex_core::config::ConfigOverrides;
use codex_core::protocol::AskForApproval;
use codex_protocol::config_types::SandboxMode;
use serde::Deserialize;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio::sync::broadcast;
use tracing::error;
use tracing::info;
use tracing_subscriber::EnvFilter;

mod server;
mod session;

use crate::session::ClientMsg;
use crate::session::SessionEntry;

#[derive(Clone, Debug)]
pub struct ServerOpts {
    pub host: String,
    pub port: u16,
    pub static_dir: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct CreateSessionReq {
    #[allow(dead_code)]
    prompt: Option<String>,
    cwd: Option<PathBuf>,
    model: Option<String>,
    approval_policy: Option<AskForApproval>,
    sandbox_mode: Option<SandboxMode>,
}

#[derive(Debug, Serialize)]
struct CreateSessionResp {
    session_id: uuid::Uuid,
}

pub async fn run_main(
    codex_linux_sandbox_exe: Option<PathBuf>,
    cli_config_overrides: CliConfigOverrides,
    opts: ServerOpts,
) -> anyhow::Result<()> {
    // Initialize logging once.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .try_init();

    // Parse overrides once and keep for per-session config merges.
    let cli_kv_overrides = match cli_config_overrides.parse_overrides() {
        Ok(v) => v,
        Err(e) => {
            error!("error parsing -c overrides: {e}");
            Vec::new()
        }
    };

    // Shared state: auth manager, sessions, overrides.
    let app_state = Arc::new(AppState::new(cli_kv_overrides, codex_linux_sandbox_exe));

    let mut app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        // Production static pages
        .route("/", get(home_static))
        .route("/session/:id", get(session_static))
        .route("/pty", get(pty_static))
        // APIs / WebSockets
        .route("/api/sessions", post(create_session))
        .route("/api/sessions/:id/events", get(server::ws_events))
        .route("/api/pty", get(server::ws_pty))
        .route("/api/sessions/resume", post(resume_session))
        .route(
            "/api/rollout/conversations",
            get(list_rollout_conversations),
        )
        .route("/api/login/start", post(start_login))
        .route("/api/login/status", get(login_status))
        .route("/api/login/cancel", post(cancel_login))
        .with_state(app_state);

    if let Some(dir) = opts.static_dir.clone() {
        app = app.nest_service("/", tower_http::services::ServeDir::new(dir));
    } else {
        // Also serve /assets from the built-in static folder if present
        let assets = format!("{}/static/assets", env!("CARGO_MANIFEST_DIR"));
        app = app.nest_service("/assets", tower_http::services::ServeDir::new(assets));
    }

    let addr: SocketAddr = format!("{}:{}", opts.host, opts.port).parse()?;
    info!("starting codex-web on http://{}", addr);
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[allow(dead_code)]
async fn home_page() -> axum::response::Html<String> {
    let html = r###"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Web</title>
    <style>
      :root{
        --bg:#0b0e14; --bg-soft:#0f1420; --glass:#0f1420cc; --fg:#e6edf3; --muted:#9aa4b2;
        --line:#1f2736; --accent:#5b9dff; --accent2:#9f5bff; --danger:#ff4d5f; --ok:#29d398;
        --glow: 0 0 0px rgba(91,157,255,0), 0 0 16px rgba(91,157,255,.35), 0 0 36px rgba(159,91,255,.25);
      }
      [data-theme="light"]{
        --bg:#ffffff; --bg-soft:#fafafa; --glass:#ffffffcc; --fg:#111418; --muted:#5b6270; --line:#e6e6ea;
        --glow: 0 0 0px rgba(91,157,255,0), 0 0 12px rgba(91,157,255,.25), 0 0 28px rgba(159,91,255,.15);
      }
      html,body{height:100%}
      body{
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        margin:0; color:var(--fg); background:radial-gradient(1200px 600px at -10% -10%, rgba(159,91,255,.15), transparent 60%),
        radial-gradient(900px 700px at 110% 20%, rgba(91,157,255,.12), transparent 60%), var(--bg);
        background-attachment: fixed;
      }
      header{ position:sticky; top:0; backdrop-filter: saturate(140%) blur(8px); background:linear-gradient(180deg, var(--glass), transparent);
        border-bottom:1px solid var(--line); padding:12px 16px; display:flex; align-items:center; gap:12px; z-index:10 }
      header h1{ font-size:18px; margin:0; letter-spacing:.3px }
      header nav a{ color:var(--fg); text-decoration:none; margin-right:12px; padding:6px 10px; border-radius:8px; border:1px solid var(--line); background:var(--bg-soft); transition:.2s }
      header nav a:hover{ box-shadow: var(--glow); border-color:transparent }
      .toggle{ margin-left:auto; }
      .toggle button{ padding:6px 10px; border-radius:999px; border:1px solid var(--line); background:var(--bg-soft); color:var(--fg); cursor:pointer }
      main{ padding:20px; max-width:1200px; margin:0 auto }
      .row{ display:flex; gap:16px; flex-wrap:wrap }
      .card{ border:1px solid var(--line); border-radius:16px; padding:18px; background:var(--glass); flex:1 1 360px; box-shadow: var(--glow) }
      .card h2{ margin:0 0 8px; font-size:16px }
      .muted{ color:var(--muted) }
      input, select, textarea, button { font:inherit; }
      input[type=text], select, textarea{ width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; box-sizing:border-box; background:var(--bg-soft); color:var(--fg) }
      label{ display:block; font-size:12px; margin:8px 0 4px; color:var(--muted) }
      button{ padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:linear-gradient(135deg, var(--accent), var(--accent2)); color:#fff; cursor:pointer; transition: transform .06s ease }
      button:hover{ transform: translateY(-1px) }
      button.secondary{ background:var(--bg-soft); color:var(--fg) }
      button.danger{ background:var(--danger); border-color:transparent }
      .list{ border-top:1px solid var(--line); margin-top:8px }
      .list .rowi{ display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line) }
      .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace }
      .pill{ display:inline-block; padding:4px 8px; border:1px solid var(--line); border-radius:999px; font-size:12px; background:var(--bg-soft) }
      .stack{ display:flex; flex-direction:column; gap:8px }
      .ws-status{ font-size:12px }
      .flow{ display:flex; flex-direction:column; gap:12px }
      .rowh{ display:flex; gap:8px; align-items:center }
      .feed{ border:1px solid var(--line); border-radius:16px; padding:12px; background:var(--glass); max-height:55vh; overflow:auto; box-shadow: var(--glow) }
      .msg{ padding:8px 8px; border-bottom:1px dashed var(--line) }
      .msg:last-child{ border-bottom:0 }
      .msg .meta{ font-size:12px; color:var(--muted) }
      pre{ margin:6px 0 0; white-space:pre-wrap; word-break:break-word }
      .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:12px }
      .right{ text-align:right }
      .hidden{ display:none }
      .spinner{ width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; animation:spin .8s linear infinite; display:inline-block }
      @keyframes spin{ to{ transform:rotate(360deg) } }
      .toast{ position:fixed; right:16px; bottom:16px; z-index:99; display:flex; flex-direction:column; gap:8px }
      .toast .t{ background:var(--glass); border:1px solid var(--line); padding:10px 14px; border-radius:12px; box-shadow: var(--glow) }
      .search{ display:flex; gap:8px; align-items:center }
    </style>
  </head>
  <body>
    <header>
      <h1>Codex Web</h1>
      <nav>
        <a href="/">Home</a>
        <a href="/pty">Terminal</a>
      </nav>
      <div class="toggle"><button id="theme-toggle">Theme</button></div>
      <div id="ws-global" class="muted ws-status"></div>
    </header>
    <main id="app"></main>
    <script type="module">
      const $ = sel => document.querySelector(sel);
      const el = (tag, attrs={}, children=[]) => { const n=document.createElement(tag); for(const[k,v] of Object.entries(attrs)){ if(k==='class') n.className=v; else if(k==='html') n.innerHTML=v; else n.setAttribute(k,v);} for(const c of (Array.isArray(children)?children:[children])) if(c!=null) n.append(c.nodeType?c:document.createTextNode(c)); return n; };
      const esc = s => String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
      const get = async (u) => { const r=await fetch(u); if(!r.ok) throw new Error(await r.text()); return r.json(); };
      const post = async (u, body) => { const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); if(!r.ok) throw new Error(await r.text()); return r.json(); };
      const Toast = { box:null, show(msg){ if(!this.box){ this.box=el('div',{class:'toast'}); document.body.append(this.box);} const t=el('div',{class:'t'}, msg); this.box.append(t); setTimeout(()=>t.remove(), 3500); } };

      // Theme toggle
      const themeBtn = $('#theme-toggle');
      const savedTheme = localStorage.getItem('codex-theme');
      if(savedTheme){ document.body.setAttribute('data-theme', savedTheme); }
      themeBtn.onclick = ()=>{ const cur=document.body.getAttribute('data-theme')||'dark'; const next=cur==='light'?'dark':'light'; document.body.setAttribute('data-theme', next); localStorage.setItem('codex-theme', next); };

      async function renderHome(){
        const app = $('#app');
        app.innerHTML='';
        const loginCard = el('div',{class:'card'});
        loginCard.append(el('h2',{html:'Login'}));
        const loginStatus = el('div',{class:'stack', id:'login-status', html:'Checking...'});
        const loginBtns = el('div',{class:'rowh'}, [
          el('button',{class:'primary', id:'btn-login-start'}, 'Start Login'),
          el('button',{id:'btn-login-cancel'}, 'Cancel Login'),
        ]);
        loginCard.append(loginStatus, loginBtns);

        const createCard = el('div',{class:'card'});
        createCard.append(el('h2',{html:'Create Session'}));
        const form = el('div',{class:'grid2'});
        form.append(
          el('div',{},[el('label',{for:'cwd'},'CWD'), el('input',{type:'text',id:'cwd',placeholder:'/path/to/workspace'})]),
          el('div',{},[el('label',{for:'model'},'Model'), el('input',{type:'text',id:'model',placeholder:'gpt-5'})]),
          el('div',{},[el('label',{for:'approval'},'Approval Policy'), selBox('approval',['untrusted','on-failure','on-request','never'],'on-request')]),
          el('div',{},[el('label',{for:'sandbox'},'Sandbox Mode'), selBox('sandbox',['read-only','workspace-write','danger-full-access'],'workspace-write')]),
          el('div',{}), el('div',{class:'right'}, el('button',{class:'primary',id:'btn-create'},'Create'))
        );
        createCard.append(form);

        const rollCard = el('div',{class:'card'});
        rollCard.append(el('h2',{html:'Resume from Rollouts'}));
        const search = el('div',{class:'search'}, [ el('input',{type:'text', id:'search', placeholder:'Filter…'}), el('button',{id:'refresh', class:'secondary'},'Refresh') ]);
        const rollList = el('div',{class:'list', id:'rollouts'}, el('div',{class:'muted'},'Loading...'));
        rollCard.append(search);
        rollCard.append(rollList);

        const row = el('div',{class:'row'}, [loginCard, createCard, rollCard]);
        app.append(row);

        // Wire actions
        try {
          const st = await get('/api/login/status');
          updateLogin(st);
        } catch(e){ loginStatus.innerHTML = '<span class=\'muted\'>Login status error</span>'; }
        $('#btn-login-start').onclick = async()=>{ const r=await post('/api/login/start',{}); updateLogin({pending:{auth_url:r.auth_url, port:r.port}}); pollLogin(); };
        $('#btn-login-cancel').onclick = async()=>{ await post('/api/login/cancel',{}); updateLogin({not_authenticated:null}); };

        $('#btn-create').onclick = async()=>{
          const btn=$('#btn-create'); const body = { cwd: $('#cwd').value || null, model: $('#model').value || 'gpt-5', approval_policy: $('#approval').value, sandbox_mode: $('#sandbox').value };
          try{ btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Creating…'; const r = await post('/api/sessions', body); Toast.show('Session created'); location.href = `/session/${r.session_id}`; }
          catch(e){ Toast.show('Create failed: '+e.message); }
          finally{ btn.disabled=false; btn.textContent='Create'; }
        };

        async function loadRollouts(){
          try{
            const data = await get('/api/rollout/conversations');
            rollList.innerHTML='';
            const items = (data.items||[]).sort((a,b)=> String(b.id).localeCompare(String(a.id)));
            if(!items.length){ rollList.append(el('div',{class:'muted'},'No rollouts found.')); return; }
            const q = ($('#search').value||'').toLowerCase();
            for(const it of items){
              if(q && !(`${it.id} ${it.path}`.toLowerCase().includes(q))) continue;
              const row = el('div',{class:'rowi'}, [
                el('div',{}, [el('div',{}, esc(it.id)), el('div',{class:'muted mono'}, it.path)]),
                el('div',{}, el('button',{id:`resume-${it.id}`, class:'secondary'},'Resume'))
              ]);
              rollList.append(row);
              row.querySelector('button').onclick = async()=>{
                try{ const r = await post('/api/sessions/resume',{path: it.path}); Toast.show('Resumed session'); location.href = `/session/${r.session_id}`; }
                catch(e){ Toast.show('Resume failed: '+e.message); }
              };
            }
          } catch(e){ rollList.innerHTML = '<span class="muted">Failed to load rollouts</span>'; }
        }
        $('#refresh').onclick = loadRollouts;
        $('#search').oninput = loadRollouts;
        loadRollouts();

        function updateLogin(st){
          if(st.pending){ loginStatus.innerHTML = `Pending. Open <a href="${esc(st.pending.auth_url)}" target="_blank">auth URL</a> (port ${st.pending.port}).`; return; }
          if(st.auth_mode){ loginStatus.textContent = `Authenticated via ${st.auth_mode}.`; return; }
          loginStatus.textContent = 'Not authenticated.';
        }
        function pollLogin(){ let n=0; const h=setInterval(async()=>{ try{ const st=await get('/api/login/status'); updateLogin(st); if(st.auth_mode) { clearInterval(h); } }catch{} if(++n>30) clearInterval(h); }, 2000); }

        function selBox(id, items, value){ const s=el('select',{id}); for(const v of items){ const o=el('option',{value:v},v); if(v===value) o.selected=true; s.append(o);} return s; }
      }
      renderHome();

      async function renderSession(id){
        const app=$('#app'); app.innerHTML='';
        const toolbar=el('div',{class:'rowh'}, [ el('a',{href:'#/','class':'pill'},'\u2190 Back'), el('span',{class:'muted'}, `Session ${esc(id)}`) ]);
        const grid=el('div',{class:'grid2'});
        // Left column: sub-agent status + feed
        const subagentsBox = el('div',{class:'muted', id:'subagents'}, '');
        const feed=el('div',{class:'feed', id:'feed'});
        const leftCol = el('div',{});
        leftCol.append(subagentsBox);
        leftCol.append(feed);
        grid.append(leftCol);
        // Right column: controls
        const controls=el('div',{class:'flow'});
        const chatBox=el('div',{class:'card'}, [ el('h2',{html:'Chat'}), el('textarea',{id:'chat',rows:'3',placeholder:'Type a prompt...'}), el('div',{class:'right'}, el('button',{class:'primary',id:'send'},'Send')) ]);
        const approveBox=el('div',{class:'card', id:'approvals'}, [ el('h2',{html:'Approvals'}), el('div',{class:'muted'},'No pending approvals') ]);
        const actionBox=el('div',{class:'card'}, [ el('h2',{html:'Actions'}), el('div',{class:'rowh'},[ el('button',{id:'interrupt', class:'danger'},'Interrupt') ]), el('div',{class:'stack'},[
          el('label',{},'Override model'), el('input',{id:'ov-model', type:'text', placeholder:'e.g. gpt-5'}),
          el('label',{},'Approval policy'), (function(){ const s=el('select',{id:'ov-approval'}); for(const v of ['untrusted','on-failure','on-request','never']) s.append(el('option',{value:v},v)); return s; })(),
          el('div',{class:'right'}, el('button',{id:'apply-override'},'Apply'))
        ]) ]);
        controls.append(chatBox, approveBox, actionBox);
        grid.append(controls);
        app.append(toolbar, el('div',{style:'height:8px'}), grid);

        // WS
        const wsUrl = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/sessions/${encodeURIComponent(id)}/events`;
        let ws; let reconnectDelay=500; const maxDelay=8000;
        const approvals=new Map(); // sub_id -> {kind:'exec'|'patch'}
        function connect(){
          ws = new WebSocket(wsUrl);
          ws.onopen = ()=>{ $('#ws-global').textContent='connected'; reconnectDelay=500; };
          ws.onclose = ()=>{ $('#ws-global').textContent='disconnected'; setTimeout(()=>connect(), reconnectDelay); reconnectDelay=Math.min(maxDelay, reconnectDelay*2); };
          ws.onerror = ()=>{ $('#ws-global').textContent='error'; };
          ws.onmessage = (ev)=>{
            try{ const evt = JSON.parse(ev.data); handleEvent(evt); } catch{}
          };
        }
        connect();

        $('#send').onclick = ()=>{
          const text=$('#chat').value.trim(); if(!text||ws.readyState!==1) return; ws.send(JSON.stringify({type:'user_message', text})); $('#chat').value='';
        };
        $('#interrupt').onclick = ()=>{ if(ws.readyState===1) ws.send(JSON.stringify({type:'interrupt'})); };
        $('#apply-override').onclick = ()=>{
          const model=$('#ov-model').value.trim()||null; const approval=$('#ov-approval').value||null;
          if(ws.readyState===1) ws.send(JSON.stringify({type:'override_turn_context', model, approval_policy: approval}));
        };

        const execBlocks = new Map(); // call_id -> pre
        const subagents = new Map(); // sub_id -> label/message
        let agentBubble = null; // current assistant message container during deltas
        let reasoningPre = null; // current reasoning collector

        function handleEvent(e){
          const t = e.msg?.type;
          switch(t){
            case 'session_configured':
              addMeta('Session configured: '+(e.msg.model||''));
              break;
            case 'task_started':
              addMeta('Task started');
              break;
            case 'task_complete':
              addMeta('Task complete');
              if(e.msg.last_agent_message){ ensureAgentBubble(); agentBubble.querySelector('pre').textContent += e.msg.last_agent_message; }
              break;
            case 'token_count':
              $('#ws-global').textContent = `tokens: in ${e.msg.input_tokens} out ${e.msg.output_tokens}${e.msg.reasoning_output_tokens?` (reason ${e.msg.reasoning_output_tokens})`:''}`;
              break;
            case 'user_message': {
              const m = e.msg?.message||'';
              let skip = false;
              try{
                const kind = String(e.msg?.kind||'').toLowerCase();
                const trimmed = m.trim();
                if(kind==='environment_context' || kind==='user_instructions' || trimmed.startsWith('<environment_context>') || trimmed.startsWith('<user_instructions>')) skip = true;
              }catch{}
              if(!skip) addChat('user', m);
              break;
            }
            case 'agent_message_delta':
              ensureAgentBubble(); agentBubble.querySelector('pre').textContent += e.msg.delta||''; break;
            case 'agent_message':
              ensureAgentBubble(); agentBubble.querySelector('pre').textContent += e.msg.message||''; agentBubble=null; break;
            case 'agent_reasoning_section_break':
              if(!reasoningPre) reasoningPre = addReasoning();
              reasoningPre.textContent += '\n\n';
              break;
            case 'agent_reasoning_delta':
            case 'agent_reasoning_raw_content_delta':
              if(!reasoningPre) reasoningPre = addReasoning();
              reasoningPre.textContent += (e.msg.delta||'');
              break;
            case 'agent_reasoning':
            case 'agent_reasoning_raw_content':
              if(!reasoningPre) reasoningPre = addReasoning();
              reasoningPre.textContent += (e.msg.text||'');
              break;
            case 'exec_command_begin':
              addExecBegin(e.msg);
              break;
            case 'exec_command_output_delta':
              appendExecDelta(e.msg);
              break;
            case 'exec_command_end':
              closeExec(e.msg);
              break;
            case 'turn_diff':
              addChanges(e.msg.unified_diff||'');
              break;
            case 'patch_apply_begin':
              addMeta('Applying patch'+(e.msg.auto_approved?' (auto-approved)':''));
              break;
            case 'patch_apply_end':
              addMeta('Patch apply '+(e.msg.success?'succeeded':'failed'));
              break;
            case 'background_event':
              addMeta('Note: '+(e.msg.message||''));
              break;
            case 'sub_agent_started': {
              const sid = e.msg?.sub_id||''; const label = e.msg?.label||sid;
              subagents.set(sid, `${label}: starting…`); refreshSubagents();
              break;
            }
            case 'sub_agent_status': {
              const sid = e.msg?.sub_id||''; const label = e.msg?.label||sid; const m = e.msg?.message||'working';
              const p = (typeof e.msg?.progress==='number') ? `${Math.round(e.msg.progress)}% ` : '';
              subagents.set(sid, `${label}: ${p}${m}`); refreshSubagents();
              break;
            }
            case 'sub_agent_completed': {
              const sid = e.msg?.sub_id||''; subagents.delete(sid); refreshSubagents();
              addMeta(`Sub-agent '${e.msg?.label||sid}' completed`);
              addSubagentSummary(e.msg?.label||sid, e.msg?.summary||'', e.msg?.commands||[]);
              break;
            }
            case 'sub_agent_failed': {
              const sid = e.msg?.sub_id||''; subagents.delete(sid); refreshSubagents();
              addMeta(`Sub-agent '${e.msg?.label||sid}' failed`);
              break;
            }
            case 'stream_error':
              addMeta('Stream error: '+(e.msg.message||''));
              break;
            case 'exec_approval_request':
              renderApproval(e, 'exec');
              break;
            case 'apply_patch_approval_request':
              renderApproval(e, 'patch');
              break;
            default:
              // Fallback: show brief payload
              addMeta(`[${t||'event'}]`);
          }
          feed.scrollTop = feed.scrollHeight;
        }

        function refreshSubagents(){
          const box=document.getElementById('subagents');
          if(!box) return;
          if(subagents.size===0){ box.textContent=''; return; }
          const lines = Array.from(subagents.values());
          box.textContent = `Sub-agents: `+lines.join(' • ');
        }

        function addSubagentSummary(label, text, cmds){
          const wrap = el('div',{class:'msg'});
          const header = el('div',{class:'meta'}, `Sub-agent summary: ${label} `);
          const btn = el('button',{},'Toggle'); header.append(btn); wrap.append(header);
          const pre = el('pre',{}); pre.style.display='none'; pre.textContent = text || '';
          wrap.append(pre);
          if(Array.isArray(cmds) && cmds.length){
            const cmdsHeader = el('div',{class:'meta'}, 'Commands'); wrap.append(cmdsHeader);
            const list = el('pre',{}); list.style.display='none'; list.textContent = cmds.join('\n');
            wrap.append(list);
            const cmdBtn = el('button',{},'Show Commands'); cmdsHeader.append(cmdBtn);
            cmdBtn.onclick = ()=>{ list.style.display = list.style.display==='none'?'block':'none'; };
          }
          btn.onclick = ()=>{ pre.style.display = pre.style.display==='none'?'block':'none'; };
          feed.append(wrap);
        }

        function addMeta(text){
          feed.append(el('div',{class:'msg'}, [ el('div',{class:'meta'}, text) ]));
        }
        function addChat(role, text){
          const wrap = el('div',{class:'msg'});
          wrap.append(el('div',{class:'meta'}, `${role}`));
          const pre = el('pre',{}); pre.textContent = text; wrap.append(pre); feed.append(wrap);
        }
        function ensureAgentBubble(){ if(agentBubble) return; agentBubble = el('div',{class:'msg'}); agentBubble.append(el('div',{class:'meta'}, 'assistant')); agentBubble.append(el('pre',{})); feed.append(agentBubble); }
        function addReasoning(){
          // Collapsible reasoning panel
          const box = el('div',{class:'msg'});
          const header = el('div',{class:'meta'}, 'Reasoning ');
          const btn = el('button',{}, 'Toggle'); header.append(btn); box.append(header);
          const pre = el('pre',{}); pre.style.display='none'; box.append(pre); btn.onclick=()=>{ pre.style.display = pre.style.display==='none'?'block':'none'; };
          feed.append(box); return pre;
        }
        function addExecBegin(msg){
          const block = el('div',{class:'msg'});
          const header = el('div',{class:'meta'}, `Exec: ${esc((msg.command||[]).join(' '))} (cwd: ${msg.cwd||''})`);
          block.append(header);
          const pre = el('pre',{}); block.append(pre); feed.append(block);
          execBlocks.set(msg.call_id, pre);
        }
        function appendExecDelta(msg){
          const pre = execBlocks.get(msg.call_id); if(!pre) return;
          try{
            const s = b64ToUtf8(msg.chunk||''); pre.textContent += s;
          }catch{ /* ignore */ }
        }
        function closeExec(msg){
          const pre = execBlocks.get(msg.call_id); if(!pre) return;
          pre.textContent += `\n[exit ${msg.exit_code}] duration ${formatDuration(msg.duration)}`;
          execBlocks.delete(msg.call_id);
        }
        function addChanges(unified){
          const box = el('div',{class:'msg'});
          box.append(el('div',{class:'meta'}, 'Changes'));
          const pre = el('pre',{}); pre.textContent = unified; box.append(pre); feed.append(box);
        }
        function b64ToUtf8(b64){
          const bin = atob(b64); const bytes = new Uint8Array([...bin].map(ch=>ch.charCodeAt(0))); return new TextDecoder().decode(bytes);
        }
        function formatDuration(d){
          if(typeof d==='string') return d; // serde may stringify
          if(!d) return '';
          const ms = (d.secs||0)*1000 + Math.floor((d.nanos||0)/1e6); return `${ms}ms`;
        }

        function renderApproval(e, kind){
          approvals.set(e.id, { kind });
          const box=$('#approvals'); box.innerHTML='';
          const row=el('div',{class:'rowh'},[ el('div',{}, `Pending ${kind} approval for id=${e.id}`),
            el('button',{class:'primary'},'Approve'), el('button',{},'Approve for Session'), el('button',{class:'danger'},'Deny'), el('button',{},'Abort') ]);
          const [_,btnApprove, btnSess, btnDeny, btnAbort] = row.children;
          btnApprove.onclick = ()=>sendDecision(e.id,'approved');
          btnSess.onclick = ()=>sendDecision(e.id,'approved_for_session');
          btnDeny.onclick = ()=>sendDecision(e.id,'denied');
          btnAbort.onclick = ()=>sendDecision(e.id,'abort');
          box.append(el('h2',{html:'Approvals'}), row);
        }
        function sendDecision(id, decision){
          const a = approvals.get(id); if(!a||ws.readyState!==1) return;
          if(a.kind==='exec') ws.send(JSON.stringify({type:'exec_approval', id, decision}));
          else ws.send(JSON.stringify({type:'patch_approval', id, decision}));
          approvals.delete(id);
          $('#approvals').innerHTML = '<div class=\'muted\'>No pending approvals</div>';
        }
      }

      async function renderPty(){
        const app=$('#app'); app.innerHTML='';
        app.append(el('div',{class:'rowh'},[ el('a',{href:'#/','class':'pill'},'\u2190 Back'), el('span',{class:'muted'}, 'Terminal Mode') ]));
        const out=el('pre',{class:'feed',style:'max-height:60vh; overflow:auto;'});
        const input=el('input',{type:'text',placeholder:'Type and press Enter to send...'});
        const card=el('div',{class:'card'},[ out, input ]); app.append(el('div',{style:'height:8px'}), card);
        const ws = new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/pty`);
        ws.onmessage = ev => { try{ out.textContent += ev.data; out.scrollTop = out.scrollHeight; }catch{} };
        ws.onopen = ()=>$('#ws-global').textContent='connected (pty)';
        ws.onclose = ()=>$('#ws-global').textContent='disconnected (pty)';
        input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ ws.send(input.value+'\n'); input.value=''; }});
      }
    </script>
  </body>
</html>"###;
    axum::response::Html(html.to_string())
}

#[allow(dead_code)]
async fn session_page(Path(id): Path<String>) -> axum::response::Html<String> {
    // Minimal page scaffolding; reuses the same CSS theme for consistency.
    let id_json = serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".to_string());
    let prefix = r###"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Session
    "###;
    let mid_title = r###"</title>
    <style>
      :root{ --bg:#0b0e14; --bg-soft:#0f1420; --glass:#0f1420cc; --fg:#e6edf3; --muted:#9aa4b2; --line:#1f2736; --accent:#5b9dff; --accent2:#9f5bff; }
      body{ margin:0; color:var(--fg); background:var(--bg); font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      header{ position:sticky; top:0; backdrop-filter:saturate(140%) blur(8px); background:linear-gradient(180deg, var(--glass), transparent); border-bottom:1px solid var(--line); padding:12px 16px; display:flex; align-items:center; gap:12px; z-index:10 }
      header a{ color:var(--fg); text-decoration:none; padding:6px 10px; border-radius:8px; border:1px solid var(--line); background:var(--bg-soft) }
      main{ padding:20px; max-width:1200px; margin:0 auto }
      .rowh{ display:flex; gap:8px; align-items:center }
      .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:12px }
      .feed{ border:1px solid var(--line); border-radius:16px; padding:12px; background:var(--glass); max-height:55vh; overflow:auto }
      .msg{ padding:8px 8px; border-bottom:1px dashed var(--line) }
      .msg:last-child{ border-bottom:0 }
      .meta{ font-size:12px; color:var(--muted) }
      pre{ margin:6px 0 0; white-space:pre-wrap; word-break:break-word }
      .card{ border:1px solid var(--line); border-radius:16px; padding:18px; background:var(--glass) }
      textarea, input, select, button{ font:inherit }
      textarea{ width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg-soft); color:var(--fg) }
      button{ padding:10px 14px; border-radius:12px; border:1px solid var(--line); background:linear-gradient(135deg, var(--accent), var(--accent2)); color:#fff; cursor:pointer }
      .muted{ color:var(--muted) }
      .pill{ display:inline-block; padding:4px 8px; border:1px solid var(--line); border-radius:999px; font-size:12px; background:var(--bg-soft) }
      .ws-status{ font-size:12px; margin-left:auto }
    </style>
  </head>
  <body>
    <header>
      <a href="/" class="pill">↩ Back</a>
      <div class="muted">Session
    "###;
    let mid_id = id;
    let rest = r###"</div>
      <div id="ws-global" class="ws-status"></div>
    </header>
    <main>
      <div class="grid2">
        <div class="feed" id="feed"></div>
        <div class="card">
          <h3>Chat</h3>
          <textarea id="chat" rows="3" placeholder="Type your prompt..."></textarea>
          <div style="text-align:right; margin-top:8px"><button id="send">Send</button></div>
          <div class="muted" style="margin-top:8px">Approvals will appear when needed.</div>
        </div>
      </div>
    </main>
    <script type="module">
      const id = 
    "###;
    let rest2 = r###";
      const feed=document.getElementById('feed'); const wsStatus=document.getElementById('ws-global');
      const add=(cls,meta,text)=>{ const row=document.createElement('div'); row.className=cls; const m=document.createElement('div'); m.className='meta'; m.textContent=meta; row.appendChild(m); const pre=document.createElement('pre'); pre.textContent=text||''; row.appendChild(pre); feed.appendChild(row); feed.scrollTop=feed.scrollHeight; return row; };
      const agent=()=>{ const row=document.createElement('div'); row.className='msg'; const m=document.createElement('div'); m.className='meta'; m.textContent='assistant'; row.appendChild(m); const pre=document.createElement('pre'); row.appendChild(pre); feed.appendChild(row); return pre; };
      let agentPre=null; const wsUrl = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/sessions/${encodeURIComponent(id)}/events`;
      function connect(){ const ws=new WebSocket(wsUrl); ws.onopen=()=>{ wsStatus.textContent='connected'; }; ws.onclose=()=>{ wsStatus.textContent='disconnected'; setTimeout(connect, 800); }; ws.onmessage=(ev)=>{ try{ const e=JSON.parse(ev.data); const t=e.msg?.type; if(t==='user_message'){ add('msg','user', e.msg.message||''); } else if(t==='agent_message_delta'){ if(!agentPre) agentPre=agent(); agentPre.textContent += e.msg.delta||''; } else if(t==='agent_message'){ if(!agentPre) agentPre=agent(); agentPre.textContent += e.msg.message||''; agentPre=null; } else if(t==='agent_reasoning' || t==='agent_reasoning_delta'){ add('msg','reasoning', e.msg.text||e.msg.delta||''); } else if(t==='exec_command_begin'){ add('msg','exec begin', (e.msg.command||[]).join(' ')); } else if(t==='exec_command_output_delta'){ const pre=agentPre??add('msg','exec output','').querySelector('pre'); pre.textContent += b64(e.msg.chunk||''); } else if(t==='exec_command_end'){ add('msg','exec end', `exit ${e.msg.exit_code}`); } else if(t==='turn_diff'){ add('msg','changes', e.msg.unified_diff||''); } else { add('msg', t||'event', ''); } }catch{} }; window._ws=ws; }
      function b64(x){ const bin=atob(x); const bytes=new Uint8Array([...bin].map(c=>c.charCodeAt(0))); return new TextDecoder().decode(bytes); }
      connect();
      document.getElementById('send').onclick=()=>{ const ta=document.getElementById('chat'); const txt=ta.value.trim(); if(!txt||!window._ws||_ws.readyState!==1) return; _ws.send(JSON.stringify({type:'user_message', text:txt})); ta.value=''; };
    </script>
  </body>
</html>"###;
    let mut html = String::new();
    html.push_str(prefix);
    html.push_str(&mid_id);
    html.push_str(mid_title);
    html.push_str(rest);
    html.push_str(&id_json);
    html.push_str(rest2);
    axum::response::Html(html)
}

#[allow(dead_code)]
async fn pty_page() -> axum::response::Html<String> {
    let html = r###"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Terminal</title>
    <style>
      :root{ --bg:#0b0e14; --fg:#e6edf3; --line:#1f2736; --glass:#0f1420; }
      body{ margin:0; background:var(--bg); color:var(--fg); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace }
      header{ position:sticky; top:0; background:var(--glass); border-bottom:1px solid var(--line); padding:12px 16px }
      a{ color:var(--fg); text-decoration:none; padding:6px 10px; border-radius:8px; border:1px solid var(--line) }
      main{ padding:16px; max-width:1100px; margin:0 auto }
      pre{ border:1px solid var(--line); background: #080b10; border-radius:12px; padding:12px; height:60vh; overflow:auto }
      input{ width:100%; padding:10px; border-radius:8px; border:1px solid var(--line); background:#0f1420; color:var(--fg) }
    </style>
  </head>
  <body>
    <header><a href="/">↩ Back</a></header>
    <main>
      <h3>Terminal Mode</h3>
      <pre id="out"></pre>
      <input id="in" placeholder="Type and press Enter to send..." />
    </main>
    <script type="module">
      const out=document.getElementById('out'); const input=document.getElementById('in');
      const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/pty`);
      ws.onmessage = ev => { out.textContent += ev.data; out.scrollTop=out.scrollHeight; };
      input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ ws.send(input.value+'\n'); input.value=''; } });
    </script>
  </body>
</html>"###;
    axum::response::Html(html.to_string())
}

// Static file handlers
async fn home_static() -> axum::response::Html<String> {
    let path = format!("{}/static/index.html", env!("CARGO_MANIFEST_DIR"));
    let html = tokio::fs::read_to_string(path).await.unwrap_or_else(|_| {
        "<!doctype html><html><body>Missing static index.html</body></html>".to_string()
    });
    axum::response::Html(html)
}

async fn session_static(Path(_id): Path<String>) -> axum::response::Html<String> {
    let path = format!("{}/static/session.html", env!("CARGO_MANIFEST_DIR"));
    let html = tokio::fs::read_to_string(path).await.unwrap_or_else(|_| {
        "<!doctype html><html><body>Missing static session.html</body></html>".to_string()
    });
    axum::response::Html(html)
}

async fn pty_static() -> axum::response::Html<String> {
    let path = format!("{}/static/pty.html", env!("CARGO_MANIFEST_DIR"));
    let html = tokio::fs::read_to_string(path).await.unwrap_or_else(|_| {
        "<!doctype html><html><body>Missing static pty.html</body></html>".to_string()
    });
    axum::response::Html(html)
}

#[derive(Clone)]
struct AppState {
    /// Global parsed `-c` overrides.
    cli_kv_overrides: Vec<(String, toml::Value)>,
    /// Optional path to linux sandbox exe to embed into per-session Config.
    codex_linux_sandbox_exe: Option<PathBuf>,
    /// Session map: id -> entry
    sessions: Arc<RwLock<HashMap<uuid::Uuid, SessionEntry>>>,
    login: Arc<RwLock<Option<LoginState>>>,
}

impl AppState {
    fn new(
        cli_kv_overrides: Vec<(String, toml::Value)>,
        codex_linux_sandbox_exe: Option<PathBuf>,
    ) -> Self {
        Self {
            cli_kv_overrides,
            codex_linux_sandbox_exe,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            login: Arc::new(RwLock::new(None)),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct LoginStartResp {
    auth_url: String,
    port: u16,
}

struct LoginState {
    _server: codex_login::LoginServer,
    shutdown: codex_login::ShutdownHandle,
    auth_url: String,
    port: u16,
}

async fn start_login(
    State(app): State<Arc<AppState>>,
) -> Result<Json<LoginStartResp>, (axum::http::StatusCode, String)> {
    let config =
        Config::load_with_cli_overrides(app.cli_kv_overrides.clone(), ConfigOverrides::default())
            .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("config error: {e}"),
            )
        })?;

    // Cancel any existing login server
    {
        let mut guard = app.login.write().await;
        if let Some(state) = guard.take() {
            state.shutdown.shutdown();
        }
    }

    let mut opts = codex_login::ServerOptions::new(
        config.codex_home.clone(),
        codex_login::CLIENT_ID.to_string(),
    );
    opts.open_browser = false;

    let server = codex_login::run_login_server(opts).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("login server error: {e}"),
        )
    })?;
    let resp = LoginStartResp {
        auth_url: server.auth_url.clone(),
        port: server.actual_port,
    };
    let shutdown = server.cancel_handle();
    let stored = LoginState {
        _server: server,
        shutdown,
        auth_url: resp.auth_url.clone(),
        port: resp.port,
    };
    {
        let mut guard = app.login.write().await;
        *guard = Some(stored);
    }

    Ok(Json(resp))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum LoginStatusResp {
    NotAuthenticated,
    AuthMode(codex_protocol::mcp_protocol::AuthMode),
    Pending { auth_url: String, port: u16 },
}

async fn login_status(
    State(app): State<Arc<AppState>>,
) -> Result<Json<LoginStatusResp>, (axum::http::StatusCode, String)> {
    if let Some(state) = app.login.read().await.as_ref() {
        return Ok(Json(LoginStatusResp::Pending {
            auth_url: state.auth_url.clone(),
            port: state.port,
        }));
    }

    let config =
        Config::load_with_cli_overrides(app.cli_kv_overrides.clone(), ConfigOverrides::default())
            .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("config error: {e}"),
            )
        })?;

    let auth_file = codex_login::get_auth_file(&config.codex_home);
    if !auth_file.exists() {
        return Ok(Json(LoginStatusResp::NotAuthenticated));
    }
    match codex_login::try_read_auth_json(&auth_file) {
        Ok(auth) => {
            let mode = if auth.openai_api_key.as_ref().is_some() {
                codex_protocol::mcp_protocol::AuthMode::ApiKey
            } else {
                codex_protocol::mcp_protocol::AuthMode::ChatGPT
            };
            Ok(Json(LoginStatusResp::AuthMode(mode)))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("auth read error: {e}"),
        )),
    }
}

async fn cancel_login(
    State(app): State<Arc<AppState>>,
) -> Result<(), (axum::http::StatusCode, String)> {
    let mut guard = app.login.write().await;
    if let Some(state) = guard.take() {
        state.shutdown.shutdown();
    }
    Ok(())
}

async fn create_session(
    State(app): State<Arc<AppState>>,
    Json(req): Json<CreateSessionReq>,
) -> Result<Json<CreateSessionResp>, (axum::http::StatusCode, String)> {
    // Merge per-session overrides with global -c overrides and build Config.
    let overrides = ConfigOverrides {
        model: req.model,
        cwd: req.cwd,
        approval_policy: req.approval_policy,
        sandbox_mode: req.sandbox_mode,
        model_provider: None,
        config_profile: None,
        codex_linux_sandbox_exe: app.codex_linux_sandbox_exe.clone(),
        base_instructions: None,
        // Enable the plan tool by default for web sessions so the UI's Plan section is populated.
        include_plan_tool: Some(true),
        include_apply_patch_tool: None,
        include_view_image_tool: None,
        show_raw_agent_reasoning: None,
        tools_web_search_request: None,
    };

    let config =
        Config::load_with_cli_overrides(app.cli_kv_overrides.clone(), overrides).map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("config error: {e}"),
            )
        })?;

    // Initialize AuthManager per server and spawn session.
    let auth_manager = codex_core::AuthManager::shared(config.codex_home.clone());

    let cm = codex_core::ConversationManager::new(auth_manager.clone());
    let conv = cm.new_conversation(config).await.map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("spawn error: {e}"),
        )
    })?;

    // Create a broadcaster and spawn tasks.
    let (tx, _rx) = broadcast::channel::<String>(1024);
    // Broadcast initial SessionConfigured (consumed by ConversationManager).
    let initial = codex_core::protocol::Event {
        id: "".to_string(),
        msg: codex_core::protocol::EventMsg::SessionConfigured(conv.session_configured.clone()),
    };
    let initial_event_json = match serde_json::to_string(&initial) {
        Ok(json) => {
            let _ = tx.send(json.clone());
            Some(json)
        }
        Err(_) => None,
    };
    // Event pump task (capture conversation without naming its type)
    let conversation_for_events = conv.conversation.clone();
    let tx_events = tx.clone();
    let event_task = tokio::spawn(async move {
        loop {
            let ev = match conversation_for_events.next_event().await {
                Ok(ev) => ev,
                Err(_) => break,
            };
            if let Ok(json) = serde_json::to_string(&ev) {
                let _ = tx_events.send(json);
            }
        }
    });

    // Ops consumer task
    let (ops_tx, mut ops_rx) = tokio::sync::mpsc::unbounded_channel::<ClientMsg>();
    let conversation_for_ops = conv.conversation.clone();
    let ops_task = tokio::spawn(async move {
        use codex_core::protocol::InputItem;
        use codex_core::protocol::Op;
        while let Some(msg) = ops_rx.recv().await {
            match msg {
                ClientMsg::UserMessage { text, images } => {
                    let mut items = vec![InputItem::Text { text }];
                    if let Some(imgs) = images {
                        for image_url in imgs {
                            items.push(InputItem::Image { image_url });
                        }
                    }
                    let _ = conversation_for_ops.submit(Op::UserInput { items }).await;
                }
                ClientMsg::Interrupt => {
                    let _ = conversation_for_ops.submit(Op::Interrupt).await;
                }
                ClientMsg::ExecApproval { id, decision } => {
                    let _ = conversation_for_ops
                        .submit(Op::ExecApproval { id, decision })
                        .await;
                }
                ClientMsg::PatchApproval { id, decision } => {
                    let _ = conversation_for_ops
                        .submit(Op::PatchApproval { id, decision })
                        .await;
                }
                ClientMsg::Compact => {
                    let _ = conversation_for_ops.submit(Op::Compact).await;
                }
                ClientMsg::OverrideTurnContext {
                    cwd,
                    model,
                    approval_policy,
                    effort,
                    sandbox_mode,
                } => {
                    use codex_core::protocol::SandboxPolicy;
                    use codex_protocol::config_types::SandboxMode;
                    let sandbox_policy = match sandbox_mode {
                        Some(SandboxMode::ReadOnly) => Some(SandboxPolicy::new_read_only_policy()),
                        Some(SandboxMode::WorkspaceWrite) => {
                            Some(SandboxPolicy::new_workspace_write_policy())
                        }
                        Some(SandboxMode::DangerFullAccess) => {
                            Some(SandboxPolicy::DangerFullAccess)
                        }
                        None => None,
                    };
                    let _ = conversation_for_ops
                        .submit(Op::OverrideTurnContext {
                            cwd,
                            approval_policy,
                            sandbox_policy,
                            model,
                            effort,
                            summary: None,
                            default_exec_timeout_ms: None,
                        })
                        .await;
                }
            }
        }
    });

    // Save session entry.
    let entry = SessionEntry {
        broadcaster: tx,
        ops_tx,
        _event_task: event_task,
        _ops_task: ops_task,
        initial_event_json,
    };
    {
        let mut guard = app.sessions.write().await;
        guard.insert(conv.conversation_id.into(), entry);
    }

    Ok(Json(CreateSessionResp {
        session_id: conv.conversation_id.into(),
    }))
}

#[derive(Debug, Deserialize)]
struct ResumeReq {
    path: PathBuf,
}

async fn resume_session(
    State(app): State<Arc<AppState>>,
    Json(req): Json<ResumeReq>,
) -> Result<Json<CreateSessionResp>, (axum::http::StatusCode, String)> {
    let config =
        Config::load_with_cli_overrides(app.cli_kv_overrides.clone(), ConfigOverrides::default())
            .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("config error: {e}"),
            )
        })?;
    let auth_manager = codex_core::AuthManager::shared(config.codex_home.clone());
    let cm = codex_core::ConversationManager::new(auth_manager.clone());
    let conv = cm
        .resume_conversation_from_rollout(config, req.path.clone(), auth_manager)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("resume error: {e}"),
            )
        })?;

    let (tx, _rx) = broadcast::channel::<String>(1024);
    let initial = codex_core::protocol::Event {
        id: "".to_string(),
        msg: codex_core::protocol::EventMsg::SessionConfigured(conv.session_configured.clone()),
    };
    let initial_event_json = match serde_json::to_string(&initial) {
        Ok(json) => {
            let _ = tx.send(json.clone());
            Some(json)
        }
        Err(_) => None,
    };
    let conversation_for_events = conv.conversation.clone();
    let tx_events = tx.clone();
    let event_task = tokio::spawn(async move {
        loop {
            let ev = match conversation_for_events.next_event().await {
                Ok(ev) => ev,
                Err(_) => break,
            };
            if let Ok(json) = serde_json::to_string(&ev) {
                let _ = tx_events.send(json);
            }
        }
    });
    let (ops_tx, mut ops_rx) = tokio::sync::mpsc::unbounded_channel::<ClientMsg>();
    let conversation_for_ops = conv.conversation.clone();
    let ops_task = tokio::spawn(async move {
        use codex_core::protocol::InputItem;
        use codex_core::protocol::Op;
        while let Some(msg) = ops_rx.recv().await {
            match msg {
                ClientMsg::UserMessage { text, images } => {
                    let mut items = vec![InputItem::Text { text }];
                    if let Some(imgs) = images {
                        for image_url in imgs {
                            items.push(InputItem::Image { image_url });
                        }
                    }
                    let _ = conversation_for_ops.submit(Op::UserInput { items }).await;
                }
                ClientMsg::Interrupt => {
                    let _ = conversation_for_ops.submit(Op::Interrupt).await;
                }
                ClientMsg::ExecApproval { id, decision } => {
                    let _ = conversation_for_ops
                        .submit(Op::ExecApproval { id, decision })
                        .await;
                }
                ClientMsg::PatchApproval { id, decision } => {
                    let _ = conversation_for_ops
                        .submit(Op::PatchApproval { id, decision })
                        .await;
                }
                ClientMsg::Compact => {
                    let _ = conversation_for_ops.submit(Op::Compact).await;
                }
                ClientMsg::OverrideTurnContext {
                    cwd,
                    model,
                    approval_policy,
                    effort,
                    sandbox_mode,
                } => {
                    use codex_core::protocol::SandboxPolicy;
                    use codex_protocol::config_types::SandboxMode;
                    let sandbox_policy = match sandbox_mode {
                        Some(SandboxMode::ReadOnly) => Some(SandboxPolicy::new_read_only_policy()),
                        Some(SandboxMode::WorkspaceWrite) => {
                            Some(SandboxPolicy::new_workspace_write_policy())
                        }
                        Some(SandboxMode::DangerFullAccess) => {
                            Some(SandboxPolicy::DangerFullAccess)
                        }
                        None => None,
                    };
                    let _ = conversation_for_ops
                        .submit(Op::OverrideTurnContext {
                            cwd,
                            approval_policy,
                            sandbox_policy,
                            model,
                            effort,
                            summary: None,
                            default_exec_timeout_ms: None,
                        })
                        .await;
                }
            }
        }
    });
    let entry = SessionEntry {
        broadcaster: tx,
        ops_tx,
        _event_task: event_task,
        _ops_task: ops_task,
        initial_event_json,
    };
    {
        let mut guard = app.sessions.write().await;
        guard.insert(conv.conversation_id.into(), entry);
    }
    Ok(Json(CreateSessionResp {
        session_id: conv.conversation_id.into(),
    }))
}

#[derive(Debug, Serialize)]
struct RolloutListItem {
    id: String,
    path: PathBuf,
}

#[derive(Debug, Serialize)]
struct RolloutListResp {
    items: Vec<RolloutListItem>,
}

async fn list_rollout_conversations(
    State(app): State<Arc<AppState>>,
) -> Result<Json<RolloutListResp>, (axum::http::StatusCode, String)> {
    let config =
        Config::load_with_cli_overrides(app.cli_kv_overrides.clone(), ConfigOverrides::default())
            .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("config error: {e}"),
            )
        })?;
    match codex_core::RolloutRecorder::list_conversations(&config.codex_home, 20, None).await {
        Ok(page) => {
            let items = page
                .items
                .into_iter()
                .map(|it| {
                    let id = it
                        .path
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| it.path.display().to_string());
                    RolloutListItem { id, path: it.path }
                })
                .collect();
            Ok(Json(RolloutListResp { items }))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("list error: {e}"),
        )),
    }
}
