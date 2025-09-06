// Helpers
const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => [...el.querySelectorAll(s)];
const getJSON = (u) => fetch(u).then((r) => { if(!r.ok) throw new Error(`GET ${u} ${r.status}`); return r.json(); });
const postJSON = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b||{}) }).then((r)=>{ if(!r.ok) throw new Error(`POST ${u} ${r.status}`); return r.json(); });

// Theme
const THEME_KEY = 'codex-theme';
function initTheme(){
  let saved = localStorage.getItem(THEME_KEY);
  if(!saved){
    try{ saved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }catch{ saved = 'dark'; }
  }
  document.body.setAttribute('data-theme', saved);
  qs('#theme')?.addEventListener('click', ()=>{
    const cur = document.body.getAttribute('data-theme') || 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
  });
}

// Global status pills
function setPill(id, text, kind){
  const el = qs(id); if(!el) return;
  el.textContent = text;
  el.classList.remove('pill-muted','pill-ok','pill-warn','pill-info');
  el.classList.add(kind||'pill-info');
}

// Login status and quick actions
async function updateLogin(){
  const statusEl = qs('#login-status');
  try{
    const st = await getJSON('/api/login/status');
    // Auth pill update
    if(st.auth_mode){
      setPill('#auth-pill', `Auth: ${st.auth_mode}`, 'pill-ok');
      if(statusEl) statusEl.textContent = `Authenticated via ${st.auth_mode}.`;
    } else if(st.pending){
      setPill('#auth-pill', 'Auth: pending', 'pill-info');
      if(statusEl){
        statusEl.textContent = 'Pending. Open auth URL (new tab) and finish login.';
        // Show a safe link next to status
        const link = document.createElement('a');
        link.href = st.pending.auth_url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = ` Open (${st.pending.port})`;
        statusEl.appendChild(link);
      }
    } else {
      setPill('#auth-pill', 'Auth: none', 'pill-warn');
      if(statusEl) statusEl.textContent = 'Not authenticated.';
    }
  }catch{
    setPill('#auth-pill', 'Auth: error', 'pill-warn');
    if(statusEl) statusEl.textContent = 'Status error';
  }
}

function initLogin(){
  qs('#login-start')?.addEventListener('click', async()=>{ try{ await postJSON('/api/login/start', {}); }finally{ updateLogin(); } });
  qs('#login-cancel')?.addEventListener('click', async()=>{ try{ await postJSON('/api/login/cancel', {}); }finally{ updateLogin(); } });
  updateLogin();
  // Poll occasionally for status changes
  setInterval(updateLogin, 5000);
}

// Create session
function initCreate(){
  const approval = qs('#approval');
  const sandbox = qs('#sandbox');
  const modelSel = qs('#model');
  const modelCustom = qs('#model-custom');
  const approvalPill = qs('#approval-pill');
  const sandboxPill = qs('#sandbox-pill');

  const LS = {
    model: 'codex-create-model',
    modelCustom: 'codex-create-model-custom',
    effort: 'codex-effort',
    approval: 'codex-create-approval',
    sandbox: 'codex-create-sandbox',
    cwd: 'codex-create-cwd',
    cwdHistory: 'codex-cwd-history',
  };

  // Restore persisted choices
  try{
    const savedModel = localStorage.getItem(LS.model);
    if(savedModel){
      if(modelSel){ modelSel.value = savedModel; }
      if(savedModel==='custom' && modelCustom){ modelCustom.style.display='block'; }
    }
    const savedCustom = localStorage.getItem(LS.modelCustom);
    if(savedCustom && modelCustom){ modelCustom.value = savedCustom; }
    const savedApproval = localStorage.getItem(LS.approval);
    if(savedApproval && approval){ approval.value = savedApproval; }
    const savedSandbox = localStorage.getItem(LS.sandbox);
    if(savedSandbox && sandbox){ sandbox.value = savedSandbox; }
    const savedCwd = localStorage.getItem(LS.cwd);
    if(savedCwd){ const cwd = qs('#cwd'); if(cwd) cwd.value = savedCwd; }
  }catch{}

  // Populate CWD datalist from history
  function getCwdHistory(){
    try{ const arr = JSON.parse(localStorage.getItem(LS.cwdHistory)||'[]'); return Array.isArray(arr)?arr:[]; }catch{ return []; }
  }
  function setCwdHistory(list){
    try{ localStorage.setItem(LS.cwdHistory, JSON.stringify(list)); }catch{}
  }
  function updateCwdDatalist(){
    const dl = qs('#cwd-list'); if(!dl) return;
    dl.innerHTML='';
    for(const p of getCwdHistory().slice(0,10)){
      const opt = document.createElement('option'); opt.value = p; dl.append(opt);
    }
  }
  updateCwdDatalist();

  function persist(){
    try{
      if(modelSel) localStorage.setItem(LS.model, modelSel.value);
      if(modelCustom) localStorage.setItem(LS.modelCustom, modelCustom.value||'');
      if(approval) localStorage.setItem(LS.approval, approval.value);
      if(sandbox) localStorage.setItem(LS.sandbox, sandbox.value);
      const cwd = qs('#cwd'); if(cwd) localStorage.setItem(LS.cwd, cwd.value||'');
    }catch{}
  }
  function refreshPills(){
    if(approval) setPill('#approval-pill', `Approval: ${approval.value}`, 'pill-info');
    if(sandbox) setPill('#sandbox-pill', `Sandbox: ${sandbox.value}`, 'pill-info');
  }
  approval?.addEventListener('change', ()=>{ refreshPills(); persist(); });
  sandbox?.addEventListener('change', ()=>{ refreshPills(); persist(); });
  modelSel?.addEventListener('change', ()=>{
    if(modelSel.value==='custom'){ modelCustom.style.display='block'; }
    else { modelCustom.style.display='none'; }
    persist();
  });
  modelCustom?.addEventListener('input', persist);
  qs('#cwd')?.addEventListener('input', persist);
  refreshPills();

  // Presets
  qsa('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      const k = ch.getAttribute('data-preset');
      if(!k) return;
      if(k==='default'){ if(approval) approval.value='on-request'; if(sandbox) sandbox.value='workspace-write'; }
      if(k==='safe'){ if(approval) approval.value='on-request'; if(sandbox) sandbox.value='read-only'; }
      if(k==='untrusted'){ if(approval) approval.value='untrusted'; if(sandbox) sandbox.value='workspace-write'; }
      if(k==='auto'){ if(approval) approval.value='never'; if(sandbox) sandbox.value='danger-full-access'; try{ localStorage.setItem(LS.effort, 'high'); }catch{} }
      refreshPills();
      persist();
    });
  });

  qs('#create')?.addEventListener('click', async()=>{
    const errEl = qs('#create-error');
    const selVal = modelSel?.value || 'gpt-5';
    let model = selVal;
    if(selVal==='custom'){
      const custom = (modelCustom?.value || '').trim();
      model = custom || 'gpt-5';
    }
    const body = {
      cwd: (qs('#cwd')?.value || '').trim() || null,
      model,
      approval_policy: approval?.value,
      sandbox_mode: sandbox?.value,
    };
    // basic client validation
    if(body.cwd && !body.cwd.startsWith('/') && !body.cwd.includes('\\')){
      errEl.textContent = 'CWD should be an absolute path.';
      return;
    }
    try{
      errEl.textContent = '';
      persist();
      const r = await postJSON('/api/sessions', body);
      // Update CWD history
      try{
        const cwdVal = body.cwd || '';
        if(cwdVal){
          const hist = getCwdHistory();
          const i = hist.indexOf(cwdVal); if(i>=0) hist.splice(i,1);
          hist.unshift(cwdVal);
          setCwdHistory(hist.slice(0,10));
        }
      }catch{}
      const url = `/session/${r.session_id}`;
      const w = window.open(url, '_blank'); if(w) w.opener = null;
    }catch(e){
      errEl.textContent = 'Create failed';
    }
  });
}

// Rollouts list
let lastRollouts = [];
function renderRollouts(filter){
  const box = qs('#rollouts');
  if(!box) return;
  box.innerHTML = '';
  const q = (filter||'').toLowerCase();
  const items = (lastRollouts||[]).sort((a,b)=> String(b.id).localeCompare(String(a.id)));
  let count = 0;
  for(const it of items){
    const sid = String(it.id||'');
    const p = String(it.path||'');
    if(q && !(sid.toLowerCase().includes(q) || p.toLowerCase().includes(q))) continue;

    const row = document.createElement('div'); row.className = 'rowi'; row.setAttribute('role','listitem');
    const left = document.createElement('div');
    const idDiv = document.createElement('div'); idDiv.textContent = sid; idDiv.className='mono';
    const pathDiv = document.createElement('div'); pathDiv.textContent = p; pathDiv.className='muted mono';
    left.append(idDiv, pathDiv);
    const btn = document.createElement('button'); btn.textContent = 'Resume'; btn.className='btn ghost';
    btn.addEventListener('click', async()=>{
      try{ const r = await postJSON('/api/sessions/resume', { path: it.path }); const url = `/session/${r.session_id}`; const w = window.open(url, '_blank'); if(w) w.opener = null; }
      catch{ alert('Resume failed'); }
    });
    row.append(left, btn);
    box.append(row); count++;
  }
  if(count===0){
    const empty = document.createElement('div'); empty.className='muted'; empty.textContent = 'No rollouts'; box.append(empty);
  }
  const ts = new Date().toLocaleTimeString();
  const syncEl = qs('#last-sync'); if(syncEl) syncEl.textContent = ts;
}

async function loadRollouts(){
  try{
    const data = await getJSON('/api/rollout/conversations');
    lastRollouts = data.items || [];
    renderRollouts(qs('#filter')?.value || '');
  }catch{
    const box = qs('#rollouts'); if(box){ box.innerHTML = ''; const e = document.createElement('div'); e.className='muted'; e.textContent = 'Failed to load'; box.append(e); }
  }
}

function initRollouts(){
  qs('#refresh')?.addEventListener('click', loadRollouts);
  const f = qs('#filter');
  let h = null; f?.addEventListener('input', ()=>{ clearTimeout(h); h = setTimeout(()=> renderRollouts(f.value||''), 120); });
  loadRollouts();
}

// Command palette (simple)
function initPalette(){
  const modal = qs('#palette-modal');
  const input = qs('#palette-input');
  const list = qs('#palette-list');
  const open = ()=>{ modal.setAttribute('aria-hidden','false'); input.value=''; render(); input.focus(); };
  const close = ()=>{ modal.setAttribute('aria-hidden','true'); };
  const actions = [
    { id:'create', title:'Create Session', sub:'Open create form', run:()=> qs('#create')?.click() },
    { id:'resume-last', title:'Resume Last Session', sub:'Open most recent rollout', run:()=>{
      const it = (lastRollouts||[]).sort((a,b)=> String(b.id).localeCompare(String(a.id)))[0]; if(!it) return; postJSON('/api/sessions/resume',{path:it.path}).then(r=>location.href=`/session/${r.session_id}`).catch(()=>alert('Resume failed'));
    }},
    { id:'toggle-theme', title:'Toggle Theme', sub:'Light/Dark', run:()=> qs('#theme')?.click() },
  ];
  const items = ()=> [
    ...actions,
    ...(lastRollouts||[]).map(it=>({ id:`session-${it.id}`, title:`Session ${it.id}`, sub:String(it.path||'') , run:()=> postJSON('/api/sessions/resume',{path:it.path}).then(r=>location.href=`/session/${r.session_id}`).catch(()=>alert('Resume failed')) }))
  ];
  function render(){
    list.innerHTML='';
    const q = (input.value||'').toLowerCase();
    const filtered = items().filter(x=> !q || x.title.toLowerCase().includes(q) || x.sub.toLowerCase().includes(q));
    for(const it of filtered.slice(0,50)){
      const row = document.createElement('div'); row.className='cmd-row'; row.setAttribute('role','option'); row.tabIndex=0;
      const left = document.createElement('div'); left.className='cmd-left';
      const t = document.createElement('div'); t.className='cmd-title'; t.textContent = it.title;
      const s = document.createElement('div'); s.className='cmd-sub'; s.textContent = it.sub;
      left.append(t,s);
      const go = document.createElement('div'); go.className='muted'; go.textContent = '↩';
      row.append(left, go);
      row.addEventListener('click', ()=>{ it.run(); close(); });
      row.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ it.run(); close(); } });
      list.append(row);
    }
  }
  input?.addEventListener('input', render);
  qs('#palette')?.addEventListener('click', open);
  window.addEventListener('keydown', (e)=>{
    const mod = e.ctrlKey || e.metaKey; if(mod && e.key.toLowerCase()==='k'){ e.preventDefault(); open(); }
    if(e.key==='Escape' && modal.getAttribute('aria-hidden')==='false'){ close(); }
  });
  modal?.addEventListener('click', (e)=>{ if(e.target===modal) close(); });
}

// Boot
initTheme();
initLogin();
initCreate();
initRollouts();
initPalette();

// Auto-hide header on scroll for home page
(function(){
  const header = document.querySelector('.app-header'); if(!header) return;
  let last = 0; let hidden=false; let ticking=false;
  function cur(){ return window.pageYOffset || document.documentElement.scrollTop; }
  function setHidden(h){ if(h===hidden) return; hidden=h; header.classList.toggle('header-hidden', hidden); }
  function onScroll(){ const y=cur(); if(Math.abs(y-last)<3) return; if(y>last && y>12) setHidden(true); else setHidden(false); last=y; }
  function onWheel(){ if(!ticking){ window.requestAnimationFrame(()=>{ onScroll(); ticking=false; }); ticking=true; } }
  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('wheel', onWheel, { passive:true });
  window.addEventListener('mousemove', (e)=>{ if(e.clientY<16) setHidden(false); });
  header.addEventListener('mouseenter', ()=> setHidden(false));
})();
