// Session page module: modernized chat UI while keeping behavior parity.
// Based on the original session.js structure and events.

// ---------- Utils ----------
const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => [...el.querySelectorAll(s)];
const setPill = (sel, text, kind = 'pill-info') => {
  const el = qs(sel); if(!el) return;
  el.textContent = text;
  el.classList.remove('pill-muted','pill-ok','pill-warn','pill-info');
  el.classList.add(kind);
};

// Theme toggle
function initTheme(){
  const KEY = 'codex-theme';
  const saved = localStorage.getItem(KEY);
  if(saved) document.body.setAttribute('data-theme', saved);
  qs('#theme')?.addEventListener('click', ()=>{
    const cur = document.body.getAttribute('data-theme') || 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
  });
}

// ---------- Markdown (safe-ish) ----------
function inlineCode(text){
  const parts = String(text||'').split('`');
  const frag = document.createDocumentFragment();
  for(let i=0;i<parts.length;i++){
    const t = parts[i];
    if(i%2===1){ const c=document.createElement('code'); c.textContent=t; frag.appendChild(c); }
    else { frag.appendChild(document.createTextNode(t)); }
  }
  return frag;
}
function linkify(node){
  const frag = document.createDocumentFragment();
  const maybe = (node && (node.textContent || (node.nodeType?node.textContent:'')));
  const text = typeof maybe==='string' ? maybe : '';
  if(!text){ frag.appendChild(node); return frag; }
  const re=/(https?:\/\/[^\s]+)|(www\.[^\s]+)/g; let last=0; let m; const s=text;
  while((m=re.exec(s))){
    const idx = m.index; if(idx>last) frag.appendChild(document.createTextNode(s.slice(last,idx)));
    const url = m[0]; const a=document.createElement('a');
    a.href = url.startsWith('http') ? url : `https://${url}`;
    a.textContent = url; a.target='_blank'; a.rel='noopener noreferrer';
    frag.appendChild(a); last = re.lastIndex;
  }
  if(last<s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  return frag;
}
function renderMarkdown(text){
  const root = document.createElement('div'); root.className='md';
  const lines = String(text||'').replace(/\r\n/g,'\n').split('\n');
  let i=0, inCode=false; let codeBuf=[]; let ul=null;
  function endUl(){ if(ul){ root.appendChild(ul); ul=null; } }
  for(; i<lines.length; i++){
    const line = lines[i];
    if(line.startsWith('```')){
      if(inCode){
        const pre=document.createElement('pre'); const code=document.createElement('code');
        code.textContent=codeBuf.join('\n'); pre.appendChild(code); root.appendChild(pre); codeBuf=[]; inCode=false;
      } else { endUl(); inCode=true; }
      continue;
    }
    if(inCode){ codeBuf.push(line); continue; }
    if(/^\s*[-*]\s+/.test(line)){
      if(!ul){ endUl(); ul=document.createElement('ul'); }
      const li=document.createElement('li');
      li.appendChild(linkify(inlineCode(line.replace(/^\s*[-*]\s+/,'').trim())));
      ul.appendChild(li);
      continue;
    }
    endUl();
    if(/^#{1,6}\s+/.test(line)){
      const h=document.createElement('div'); h.style.fontWeight='600';
      h.textContent=line.replace(/^#{1,6}\s+/,''); root.appendChild(h); continue;
    }
    const p=document.createElement('p'); p.appendChild(linkify(inlineCode(line))); root.appendChild(p);
  }
  endUl();
  if(inCode){
    const pre=document.createElement('pre'); const code=document.createElement('code');
    code.textContent=codeBuf.join('\n'); pre.appendChild(code); root.appendChild(pre);
  }
  return root;
}

// ---------- Session page boot ----------
function initSession(){
  const feed = qs('#feed');
  const wsPill = qs('#ws');
  const title = qs('#title');
  const tokensEl = qs('#tokens');
  const planEl = qs('#plan');
  const typing = qs('#typing');

  const id = location.pathname.split('/').pop();
  if(title) title.textContent = `Session ${id}`;

  // Feed helpers
  function makeMsg(who, contentNode, rawText){
    const wrap=document.createElement('div'); wrap.className=`msg msg-${who}`;
    const avatar=document.createElement('div'); avatar.className='avatar';
    avatar.textContent = who==='assistant'?'A':(who==='user'?'U':'S');

    const stack=document.createElement('div'); stack.className='stack';

    const head=document.createElement('div'); head.className='msg-head';
    const whoEl=document.createElement('span'); whoEl.className='who'; whoEl.textContent=who;
    const time=document.createElement('span'); time.className='time';
    try{ time.textContent=new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }catch{ time.textContent=''; }
    const copy=document.createElement('button'); copy.className='copy-btn'; copy.textContent='Copy';
    copy.addEventListener('click',()=>{
      try{
        const text=(rawText!==undefined && rawText!==null) ? rawText : (contentNode.innerText||'');
        navigator.clipboard.writeText(text);
      }catch{}
    });
    head.append(whoEl, time, copy);

    const bubble=document.createElement('div'); bubble.className='bubble';
    bubble.appendChild(contentNode);

    stack.append(head, bubble);
    wrap.append(avatar, stack);
    return wrap;
  }

  function makeReasoning(){
    const box=document.createElement('div'); box.className='reasoning collapsed';
    const head=document.createElement('div'); head.className='head';
    head.innerHTML='<span>Reasoning</span>';
    const toggle=document.createElement('button'); toggle.className='toggle-btn'; toggle.textContent='Show';
    head.append(toggle);
    const body=document.createElement('div'); body.className='body';
    box.append(head, body);
    toggle.addEventListener('click',()=>{
      const c=box.classList.contains('collapsed');
      box.classList.toggle('collapsed'); toggle.textContent=c?'Hide':'Show';
    });
    return {box, body};
  }
  function startTurn(){ const t=document.createElement('div'); t.className='turn'; feed.appendChild(t); return t; }
  function nearBottom(){ return (feed.scrollTop + feed.clientHeight) >= (feed.scrollHeight - 40); }
  function maybeAutoScroll(){ if(nearBottom()) feed.scrollTop=feed.scrollHeight; else qs('#new-ind').style.display='flex'; }
  qs('#scroll-new')?.addEventListener('click',()=>{ feed.scrollTop=feed.scrollHeight; qs('#new-ind').style.display='none'; });

  let currentTurn=null; let currentAssistant=null; let currentAssistantText=''; let currentReason=null; let currentReasonText='';

  function addUser(text){
    const node=renderMarkdown(text);
    const wrap=makeMsg('user', node, text);
    currentTurn=startTurn(); currentTurn.appendChild(wrap);
    currentAssistant=null; currentReason=null; currentAssistantText=''; currentReasonText='';
    maybeAutoScroll();
  }
  function addAssistantDelta(delta){
    if(!currentTurn){ currentTurn=startTurn(); }
    if(!currentAssistant){
      currentAssistantText=''; const node=renderMarkdown('');
      currentAssistant=makeMsg('assistant', node, '');
      currentTurn.appendChild(currentAssistant);
    }
    currentAssistantText += delta||'';
    const body=currentAssistant.querySelector('.md');
    body.replaceChildren(...renderMarkdown(currentAssistantText).childNodes);
    showTyping(true);
    scheduleHideTyping();
    maybeAutoScroll();
  }
  function addAssistant(text){ addAssistantDelta(text); maybeAutoScroll(); }
  function addReasoningDelta(delta){
    if(!currentTurn){ currentTurn=startTurn(); }
    if(!currentReason){
      currentReason=makeReasoning(); currentTurn.appendChild(currentReason.box);
    }
    currentReasonText += delta||'';
    currentReason.body.replaceChildren(...renderMarkdown(currentReasonText).childNodes);
    maybeAutoScroll();
  }
  function addReasoning(text){ addReasoningDelta(text); }
  function addSystem(text){
    const node=renderMarkdown(text);
    const wrap=makeMsg('system', node, text);
    if(!currentTurn){ currentTurn=startTurn(); }
    currentTurn.appendChild(wrap);
    maybeAutoScroll();
  }

  // Typing indicator helpers
  let typingTimer=null;
  function showTyping(on){ if(!typing) return; typing.setAttribute('aria-hidden', on?'false':'true'); }
  function scheduleHideTyping(){ clearTimeout(typingTimer); typingTimer=setTimeout(()=>showTyping(false), 800); }

  // WS
  const wsUrl = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/sessions/${encodeURIComponent(id)}/events`;
  let eventsLog=[];
  function b64_arr(arr){ try{ const bytes=new Uint8Array(arr); return new TextDecoder().decode(bytes); }catch{ return ''; } }

  function connect(){
    const ws=new WebSocket(wsUrl);
    ws.onopen=()=>{
      if(wsPill){ wsPill.textContent='WS: connected'; wsPill.classList.remove('pill-warn','pill-muted'); wsPill.classList.add('pill-ok'); }
      // Persisted overrides
      try{
        const effSel=qs('#effort'); const eff=effSel?.value||localStorage.getItem('codex-effort'); if(eff){ ws.send(JSON.stringify({type:'override_turn_context', effort: eff})); }
        const mSel=qs('#ctx-model'); const mVal=(mSel?.value||localStorage.getItem('codex-create-model')||'gpt-5'); let model=mVal;
        if(mVal==='custom'){ const mc=qs('#ctx-model-custom')?.value||localStorage.getItem('codex-create-model-custom')||''; if(mc) model=mc; }
        if(model){ ws.send(JSON.stringify({type:'override_turn_context', model})); }
        const ap=qs('#ctx-approval')?.value||localStorage.getItem('codex-create-approval'); if(ap){ ws.send(JSON.stringify({type:'override_turn_context', approval_policy: ap})); }
        const sb=qs('#ctx-sandbox')?.value||localStorage.getItem('codex-create-sandbox'); if(sb){ ws.send(JSON.stringify({type:'override_turn_context', sandbox_mode: sb})); }
        const cwd=qs('#ctx-cwd')?.value||localStorage.getItem('codex-create-cwd'); if(cwd){ ws.send(JSON.stringify({type:'override_turn_context', cwd})); }
      }catch{}
    };
    ws.onclose=()=>{
      if(wsPill){ wsPill.textContent='WS: disconnected'; wsPill.classList.remove('pill-ok'); wsPill.classList.add('pill-warn'); }
      showTyping(false);
      setTimeout(connect, 800);
    };
    ws.onmessage=(ev)=>{
      eventsLog.push(ev.data);
      try{
        const e=JSON.parse(ev.data); const t=e.msg?.type;
        if(t==='user_message'){ addUser(e.msg.message||''); }
        else if(t==='agent_message_delta'){ addAssistantDelta(e.msg.delta||''); }
        else if(t==='agent_message'){ addAssistant(e.msg.message||''); showTyping(false); }
        else if(t==='agent_reasoning_delta'){ addReasoningDelta(e.msg.delta||''); }
        else if(t==='agent_reasoning'){ addReasoning(e.msg.message||''); }
        else if(t==='agent_reasoning_raw_content_delta'){ addReasoningDelta((new TextDecoder().decode(new Uint8Array(e.msg.delta||[])))||''); }
        else if(t==='agent_reasoning_raw_content'){ addReasoning((e.msg.message||'')); }
        else if(t==='agent_reasoning_section_break'){ currentReasonText += '\n\n'; }
        else if(t==='exec_command_begin'){ addSystem(`exec: ${(e.msg.command||[]).join(' ')} (cwd ${e.msg.cwd||''})`); }
        else if(t==='exec_command_output_delta'){ const s=b64_arr(e.msg.chunk||[]); addSystem(s); }
        else if(t==='exec_command_end'){ addSystem(`exec end: exit ${e.msg.exit_code} in ${e.msg.duration||''}`); }
        else if(t==='exec_approval_request'){ openApproval('exec', e.id, e.msg||{}); }
        else if(t==='apply_patch_approval_request'){ openApproval('patch', e.id, e.msg||{}); }
        else if(t==='turn_diff'){ addSystem(e.msg.unified_diff||''); }
        else if(t==='web_search_begin'){ addSystem('web search: begin'); }
        else if(t==='web_search_end'){ addSystem(`web search: ${e.msg.query||''}`); }
        else if(t==='mcp_tool_call_begin'){ const inv=e.msg.invocation; addSystem(`mcp: ${inv?.server||''}.${inv?.tool||''} begin`); }
        else if(t==='mcp_tool_call_end'){ const inv=e.msg.invocation; const ok=e.msg.result && !e.msg.result.is_error; addSystem(`mcp: ${inv?.server||''}.${inv?.tool||''} ${ok?'ok':'error'}`); }
        else if(t==='patch_apply_begin'){ addSystem('patch apply: begin'); }
        else if(t==='patch_apply_end'){ addSystem(`patch apply: ${e.msg.success?'ok':'failed'}`); }
        else if(t==='token_count'){
          const i=e.msg.input_tokens||0; const c=e.msg.cached_input_tokens||0; const o=e.msg.output_tokens||0;
          if(tokensEl){ tokensEl.textContent=`Tokens: in ${i}${c?` (${c} cached)`:''}, out ${o}`; tokensEl.classList.remove('pill-muted'); tokensEl.classList.add('pill-info'); }
        }
        else if(t==='background_event'){ addSystem(e.msg.message||''); }
        else if(t==='stream_error'){ addSystem(`stream error: ${e.msg.message||''}`); showTyping(false); }
        else if(t==='error'){ addSystem(`error: ${e.msg.message||''}`); showTyping(false); }
        else if(t==='session_configured'){
          setPill('#model-pill', `Model: ${e.msg.model}`);
        }
        else if(t==='plan_update'){ renderPlan(e.msg); }
      }catch{}
    };
    window._ws = ws; // expose for palette/shortcuts
  }

  // Effort control
  (function(){
    const KEY='codex-effort'; const sel=qs('#effort');
    try{ const saved=localStorage.getItem(KEY); if(saved && sel) sel.value=saved; }catch{}
    sel?.addEventListener('change', ()=>{
      try{ localStorage.setItem(KEY, sel.value); }catch{}
      if(!window._ws || _ws.readyState!==1) return;
      _ws.send(JSON.stringify({type:'override_turn_context', effort: sel.value}));
      qs('#model-pill')?.classList.add('pill-info');
    });
  })();

  // Model/approval/sandbox/cwd controls
  (function(){
    const modelSel=qs('#ctx-model'); const modelCustom=qs('#ctx-model-custom'); const approvalSel=qs('#ctx-approval'); const sandboxSel=qs('#ctx-sandbox'); const cwdInput=qs('#ctx-cwd');
    try{
      const m=localStorage.getItem('codex-create-model'); if(m && modelSel){ modelSel.value=m; modelCustom?.classList.toggle('hidden', m!=='custom'); }
      const mc=localStorage.getItem('codex-create-model-custom'); if(mc && modelCustom){ modelCustom.value=mc; }
      const ap=localStorage.getItem('codex-create-approval'); if(ap && approvalSel){ approvalSel.value=ap; }
      const sb=localStorage.getItem('codex-create-sandbox'); if(sb && sandboxSel){ sandboxSel.value=sb; }
      const cwd=localStorage.getItem('codex-create-cwd'); if(cwd && cwdInput){ cwdInput.value=cwd; }
    }catch{}
    function refreshPills(){
      if(!modelSel) return;
      const modelVal = modelSel.value==='custom' ? ((modelCustom?.value)||'custom') : modelSel.value;
      setPill('#model-pill', `Model: ${modelVal}`);
      if(approvalSel) setPill('#approval-pill', `Approval: ${approvalSel.value}`);
      if(sandboxSel) setPill('#sandbox-pill', `Sandbox: ${sandboxSel.value}`);
      if(cwdInput){ const val=cwdInput.value||'—'; setPill('#cwd-pill', `CWD: ${val}`); }
    }
    refreshPills();
    function getCwdHistory(){ try{ const arr = JSON.parse(localStorage.getItem('codex-cwd-history')||'[]'); return Array.isArray(arr)?arr:[]; }catch{ return []; } }
    function updateCwdDatalist(){ const dl=qs('#cwd-list'); if(!dl) return; dl.innerHTML=''; for(const p of getCwdHistory().slice(0,10)){ const opt=document.createElement('option'); opt.value=p; dl.append(opt);} }
    updateCwdDatalist();

    modelSel?.addEventListener('change', ()=>{
      if(modelCustom){ modelCustom.classList.toggle('hidden', modelSel.value!=='custom'); }
      try{ localStorage.setItem('codex-create-model', modelSel.value);}catch{}
      refreshPills();
      const val=modelSel.value==='custom'?(modelCustom?.value||null):modelSel.value;
      if(!window._ws||_ws.readyState!==1) return; if(val) _ws.send(JSON.stringify({type:'override_turn_context', model: val}));
    });
    modelCustom?.addEventListener('input', ()=>{
      try{ localStorage.setItem('codex-create-model-custom', modelCustom.value);}catch{}
      refreshPills();
      if(!window._ws||_ws.readyState!==1) return;
      const v=modelCustom.value.trim(); if(v) _ws.send(JSON.stringify({type:'override_turn_context', model: v}));
    });
    approvalSel?.addEventListener('change', ()=>{
      try{ localStorage.setItem('codex-create-approval', approvalSel.value);}catch{}
      refreshPills();
      if(!window._ws||_ws.readyState!==1) return;
      _ws.send(JSON.stringify({type:'override_turn_context', approval_policy: approvalSel.value}));
    });
    sandboxSel?.addEventListener('change', ()=>{
      try{ localStorage.setItem('codex-create-sandbox', sandboxSel.value);}catch{}
      refreshPills();
      if(!window._ws||_ws.readyState!==1) return;
      _ws.send(JSON.stringify({type:'override_turn_context', sandbox_mode: sandboxSel.value}));
    });
    cwdInput?.addEventListener('change', ()=>{
      try{ localStorage.setItem('codex-create-cwd', cwdInput.value);}catch{}
      refreshPills();
      if(!window._ws||_ws.readyState!==1) return;
      const v=cwdInput.value.trim(); if(v) _ws.send(JSON.stringify({type:'override_turn_context', cwd: v}));
    });
  })();

  // Actions
  qs('#interrupt')?.addEventListener('click', ()=>{
    if(window._ws && _ws.readyState===1){ _ws.send(JSON.stringify({type:'interrupt'})); }
  });
  qs('#export')?.addEventListener('click', ()=>{
    try{
      const blob=new Blob([eventsLog.join('\n')],{type:'application/x-ndjson'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=`codex-session-${id}.jsonl`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch{ alert('Export failed'); }
  });
  // Copy transcript button
  (function(){
    const copyBtn=document.createElement('button'); copyBtn.className='btn ghost';
    copyBtn.textContent='Copy'; copyBtn.title='Copy transcript';
    copyBtn.addEventListener('click',()=>{ try{ navigator.clipboard.writeText(feed.innerText||''); }catch{} });
    qs('.actions')?.prepend(copyBtn);
  })();
  // Context toggle button (mobile)
  (function(){
    const ctxToggle=document.createElement('button'); ctxToggle.className='btn ghost';
    ctxToggle.textContent='Context'; ctxToggle.title='Show/Hide context';
    ctxToggle.addEventListener('click',()=>{
      const card=qs('#ctx-card'); const hidden=card.classList.toggle('hidden');
      ctxToggle.setAttribute('aria-expanded', String(!hidden));
    });
    qs('.actions')?.prepend(ctxToggle);
  })();

  // Approval modal
  let pendingApproval=null; // { kind: 'exec'|'patch', id, data }
  function openApproval(kind, id, data){
    pendingApproval={kind,id,data};
    const modal=qs('#approval-modal'); const body=qs('#approval-body'); const title=qs('#approval-title'); body.innerHTML='';
    if(kind==='exec'){
      title.textContent='Approve Command Execution';
      const left=document.createElement('div'); left.className='stack';
      const reason=document.createElement('div'); reason.className='muted'; reason.textContent= data.reason?`Reason: ${data.reason}`:'Command execution requested';
      const cmd=document.createElement('div'); cmd.textContent=(data.command||[]).join(' ');
      const cwd=document.createElement('div'); cwd.className='muted'; cwd.textContent=`cwd: ${data.cwd||''}`;
      left.append(reason, cmd, cwd);
      const right=document.createElement('div'); right.className='stack'; right.append(document.createElement('div'));
      body.append(left, right);
    } else if(kind==='patch'){
      title.textContent='Approve Code Changes';
      const list=document.createElement('div'); list.className='file-list';
      const viewer=document.createElement('div'); viewer.className='diff'; const pre=document.createElement('pre'); viewer.append(pre);
      const entries=Object.entries(data.changes||{});
      function renderFile(idx){
        pre.textContent=''; const [path, ch]=entries[idx];
        [...list.children].forEach((el,i)=>{ el.classList.toggle('active', i===idx); });
        if(ch && ch.update){ pre.textContent = ch.update.unified_diff || ''; }
        else if(ch && ch.add){ pre.textContent = ch.add.content || ''; }
        else if(ch && ch.delete){ pre.textContent = ch.delete.content || ''; }
        else {
          const t=ch?.type;
          if(t==='update'){ pre.textContent=ch.unified_diff||''; }
          else if(t==='add'){ pre.textContent=ch.content||''; }
          else if(t==='delete'){ pre.textContent=ch.content||''; }
          else { pre.textContent = JSON.stringify(ch,null,2); }
        }
      }
      entries.forEach(([path, ch], idx)=>{
        const item=document.createElement('div'); item.className='file-item';
        const name=document.createElement('div'); name.textContent=String(path);
        const tag=document.createElement('div'); tag.className='muted';
        if(ch && ch.update){ tag.textContent='update'; }
        else if(ch && ch.add){ tag.textContent='add'; }
        else if(ch && ch.delete){ tag.textContent='delete'; }
        else { tag.textContent=String(ch?.type||'change'); }
        item.append(name, tag); item.addEventListener('click',()=>renderFile(idx)); list.append(item);
      });
      if(entries.length){ renderFile(0); }
      const leftWrap=document.createElement('div'); leftWrap.append(list);
      const rightWrap=document.createElement('div'); rightWrap.append(viewer);
      if(data.reason){ const r=document.createElement('div'); r.className='muted'; r.textContent=`Reason: ${data.reason}`; rightWrap.prepend(r); }
      if(data.grant_root){ const g=document.createElement('div'); g.className='muted'; g.textContent=`Grant root requested: ${data.grant_root}`; rightWrap.prepend(g); }
      body.append(leftWrap, rightWrap);
    }
    modal.setAttribute('aria-hidden','false');
  }
  function closeApproval(){ qs('#approval-modal').setAttribute('aria-hidden','true'); pendingApproval=null; }
  qs('#approval-close')?.addEventListener('click', closeApproval);
  qs('#approve')?.addEventListener('click', ()=>{
    if(!pendingApproval||!window._ws||_ws.readyState!==1) return;
    const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval';
    _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'approved'})); closeApproval();
  });
  qs('#approve-session')?.addEventListener('click', ()=>{
    if(!pendingApproval||!window._ws||_ws.readyState!==1) return;
    const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval';
    _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'approved_for_session'})); closeApproval();
  });
  qs('#deny')?.addEventListener('click', ()=>{
    if(!pendingApproval||!window._ws||_ws.readyState!==1) return;
    const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval';
    _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'denied'})); closeApproval();
  });
  qs('#abort')?.addEventListener('click', ()=>{
    if(!pendingApproval||!window._ws||_ws.readyState!==1) return;
    const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval';
    _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'abort'})); closeApproval();
  });
  qs('#approval-modal')?.addEventListener('click',(e)=>{
    const m=qs('#approval-modal'); if(e.target===m) closeApproval();
  });
  window.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){ const m=qs('#approval-modal'); if(m.getAttribute('aria-hidden')==='false') closeApproval(); }
  });

  // Chat send + extras
  function sendChat(){
    const ta=qs('#chat'); const txt=(ta?.value||'').trim();
    if(!txt||!window._ws||_ws.readyState!==1) return;
    _ws.send(JSON.stringify({type:'user_message', text:txt}));
    if(ta){ ta.value=''; updateCharCount(); ta.focus(); }
  }
  // Default: Ctrl/Cmd+Enter sends, Shift+Enter new line. If "Enter to send" is on, Enter sends.
  qs('#send')?.addEventListener('click', sendChat);
  const enterToggle = qs('#enter-to-send');
  qs('#chat')?.addEventListener('keydown', (e)=>{
    const enterToSend = !!enterToggle?.checked;
    if(enterToSend){
      if(e.key==='Enter' && !e.shiftKey){
        e.preventDefault(); sendChat();
      }
    } else {
      if((e.ctrlKey||e.metaKey) && e.key==='Enter'){
        e.preventDefault(); sendChat();
      }
    }
  });

  // Char counter
  function updateCharCount(){
    const ta=qs('#chat'); const c=qs('#char-count');
    if(ta && c){ c.textContent = String((ta.value||'').length); }
  }
  qs('#chat')?.addEventListener('input', updateCharCount);
  updateCharCount();

  // Attachments (preview only, not uploaded here)
  qs('#attach')?.addEventListener('change', (e)=>{
    const box=qs('#attachments'); if(!box) return;
    box.innerHTML='';
    const files=[...(e.target?.files||[])];
    files.slice(0,5).forEach(f=>{
      const chip=document.createElement('span'); chip.className='attach-chip'; chip.textContent=`${f.name} (${Math.round(f.size/1024)} KB)`;
      box.append(chip);
    });
    if(files.length>5){
      const more=document.createElement('span'); more.className='attach-chip'; more.textContent=`+${files.length-5} more`;
      box.append(more);
    }
  });

  // Command palette (simple)
  (function(){
    const modal=qs('#palette-modal'); const input=qs('#palette-input'); const list=qs('#palette-list');
    const open=()=>{ modal.setAttribute('aria-hidden','false'); input.value=''; render(); input.focus(); };
    const close=()=>{ modal.setAttribute('aria-hidden','true'); };
    const act=(label, run, sub='')=>({label, sub, run});
    function actions(){ return [
      act('Interrupt', ()=>{ if(window._ws&&_ws.readyState===1) _ws.send(JSON.stringify({type:'interrupt'})); }),
      act('Open Approval', ()=>{ if(typeof openApproval==='function' && pendingApproval) openApproval(pendingApproval.kind, pendingApproval.id, pendingApproval.data); }, pendingApproval?`${pendingApproval.kind}`:'no pending'),
      act('Export JSONL', ()=>qs('#export')?.click()),
      act('Copy Transcript', ()=>navigator.clipboard.writeText(feed.innerText||'')),
      act('Toggle Reasoning', ()=>{ document.querySelectorAll('.reasoning').forEach(b=>{ const btn=b.querySelector('.toggle-btn'); if(btn) btn.click(); }); }),
      act('Set Effort: minimal', ()=>{ const sel=qs('#effort'); sel.value='minimal'; sel.dispatchEvent(new Event('change')); }),
      act('Set Effort: low', ()=>{ const sel=qs('#effort'); sel.value='low'; sel.dispatchEvent(new Event('change')); }),
      act('Set Effort: medium', ()=>{ const sel=qs('#effort'); sel.value='medium'; sel.dispatchEvent(new Event('change')); }),
      act('Set Effort: high', ()=>{ const sel=qs('#effort'); sel.value='high'; sel.dispatchEvent(new Event('change')); }),
    ]; }
    function render(){
      list.innerHTML='';
      const q=(input.value||'').toLowerCase();
      actions().filter(a=>!q||a.label.toLowerCase().includes(q)||(a.sub||'').toLowerCase().includes(q))
      .forEach(a=>{
        const row=document.createElement('div'); row.className='cmd-row'; row.tabIndex=0;
        const l=document.createElement('div'); l.className='cmd-left';
        const t=document.createElement('div'); t.className='cmd-title'; t.textContent=a.label;
        const s=document.createElement('div'); s.className='cmd-sub'; s.textContent=a.sub||'';
        l.append(t,s);
        const go=document.createElement('div'); go.className='muted'; go.textContent='↩';
        row.append(l, go);
        row.addEventListener('click',()=>{ a.run(); close(); });
        row.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ a.run(); close(); }});
        list.append(row);
      });
    }
    input?.addEventListener('input', render);
    window.addEventListener('keydown',(e)=>{
      const mod=e.ctrlKey||e.metaKey;
      if(mod && e.key.toLowerCase()==='k'){ e.preventDefault(); open(); }
      if(e.key==='Escape' && modal.getAttribute('aria-hidden')==='false'){ close(); }
      if(e.key==='/'){ // light shortcut: open palette on "/" when chat is empty
        const ta=qs('#chat');
        if(document.activeElement===ta && (ta?.value||'').trim()===''){
          e.preventDefault(); open();
        }
      }
    });
    modal?.addEventListener('click',(e)=>{ if(e.target===modal) close(); });
  })();

  // Plan rendering
  function renderPlan(data){
    if(!data || !planEl) return;
    const list=data.plan||[]; planEl.innerHTML='';
    list.forEach(item=>{
      const row=document.createElement('div'); row.className='plan-item';
      const step=document.createElement('div'); step.className='plan-step'; step.textContent=item.step||'';
      const b=document.createElement('span'); b.className='badge';
      const st=(item.status||'').toLowerCase();
      if(st==='pending') b.classList.add('b-pending');
      else if(st==='in_progress') b.classList.add('b-inprogress');
      else if(st==='completed') b.classList.add('b-completed');
      b.textContent=(st||'').replace('_',' ');
      row.append(step,b); planEl.append(row);
    });
    if(data.explanation){
      const ex=document.createElement('div'); ex.className='muted'; ex.textContent=data.explanation; planEl.prepend(ex);
    }
  }

  // Kick it off
  connect();
}

// Boot
initTheme();
initSession();
