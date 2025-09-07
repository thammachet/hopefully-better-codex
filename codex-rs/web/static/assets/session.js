// Session page module: extracted from inline scripts in session.html
// Keeps behavior parity while improving structure and layout.

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
function linkifyText(text){
  const re=/(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const frag=document.createDocumentFragment();
  let last=0; let m;
  while((m=re.exec(text))){
    const idx=m.index; if(idx>last) frag.appendChild(document.createTextNode(text.slice(last,idx)));
    const url=m[0]; const a=document.createElement('a');
    a.href=url.startsWith('http')?url:`https://${url}`; a.textContent=url; a.target='_blank'; a.rel='noopener noreferrer';
    frag.appendChild(a); last=re.lastIndex;
  }
  if(last<text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}
function linkifyIn(container){
  const stack=[container];
  while(stack.length){
    const node=stack.pop();
    for(let i=0;i<node.childNodes.length;i++){
      const child=node.childNodes[i];
      if(child.nodeType===3){ // Text
        const txt = child.textContent || '';
        if(!(/https?:\/\//.test(txt) || txt.includes('www.'))) continue;
        const frag=linkifyText(txt);
        const count = frag.childNodes.length;
        if(count>1 || (frag.firstChild && frag.firstChild.nodeType!==3)){
          node.replaceChild(frag, child);
          i += count - 1; // skip inserted nodes
        }
      } else if(child.nodeType===1){
        if(child.tagName!=='CODE') stack.push(child);
      }
    }
  }
}
function parseBoldItalics(text){
  // Simple non-nested parser for **bold** and *italic*
  const frag=document.createDocumentFragment();
  let i=0; let current=document.createElement('span'); frag.appendChild(current);
  function pushText(t){ if(t) current.appendChild(document.createTextNode(t)); }
  while(i<text.length){
    if(text.startsWith('**', i)){
      // find closing **
      const close=text.indexOf('**', i+2);
      if(close>-1){
        const bold=document.createElement('strong');
        bold.appendChild(document.createTextNode(text.slice(i+2, close)));
        current.appendChild(bold);
        i=close+2; continue;
      }
    }
    if(text[i]==='*'){
      const close=text.indexOf('*', i+1);
      if(close>-1){
        const em=document.createElement('em');
        em.appendChild(document.createTextNode(text.slice(i+1, close)));
        current.appendChild(em);
        i=close+1; continue;
      }
    }
    // default: accumulate until next marker or end
    let j=i+1;
    while(j<text.length && !text.startsWith('**', j) && text[j]!=='*') j++;
    pushText(text.slice(i, j));
    i=j;
  }
  return frag;
}
function parseInline(text){
  const parts=String(text||'').split('`');
  const frag=document.createDocumentFragment();
  for(let i=0;i<parts.length;i++){
    const seg=parts[i];
    if(i%2===1){ const c=document.createElement('code'); c.textContent=seg; frag.appendChild(c); }
    else { const piece=parseBoldItalics(seg); linkifyIn(piece); frag.appendChild(piece); }
  }
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
      if(inCode){ const pre=document.createElement('pre'); const code=document.createElement('code'); code.textContent=codeBuf.join('\n'); pre.appendChild(code); root.appendChild(pre); codeBuf=[]; inCode=false; }
      else { endUl(); inCode=true; }
      continue;
    }
    if(inCode){ codeBuf.push(line); continue; }
    if(/^\s*[-*]\s+/.test(line)){
      if(!ul){ endUl(); ul=document.createElement('ul'); }
      const li=document.createElement('li'); li.appendChild(parseInline(line.replace(/^\s*[-*]\s+/,'').trim())); ul.appendChild(li);
      continue;
    }
    endUl();
    if(/^#{1,6}\s+/.test(line)){ const h=document.createElement('div'); h.style.fontWeight='600'; h.textContent=line.replace(/^#{1,6}\s+/,''); root.appendChild(h); continue; }
    const p=document.createElement('p'); p.appendChild(parseInline(line)); root.appendChild(p);
  }
  endUl();
  if(inCode){ const pre=document.createElement('pre'); const code=document.createElement('code'); code.textContent=codeBuf.join('\n'); pre.appendChild(code); root.appendChild(pre); }
  return root;
}

// ---------- Session page boot ----------
function initSession(){
  const feed = qs('#feed');
  const wsPill = qs('#ws');
  const title = qs('#title');
  const tokensEl = qs('#tokens');
  const planEl = qs('#plan');
  const reasonPill = qs('#reason-pill');

  // Move reasoning pill next to Chat title in composer
  try{
    const composer = qs('.card.composer');
    const chatTitle = composer ? qs('h3', composer) : null;
    if(composer && chatTitle && reasonPill){
      let head = qs(':scope > .card-head', composer);
      if(!head){
        head = document.createElement('div');
        head.className = 'card-head';
        composer.insertBefore(head, chatTitle);
      }
      head.appendChild(chatTitle); // move title into header
      head.appendChild(reasonPill); // move pill into header
      // Ensure pill starts with a sane default
      reasonPill.textContent = 'Reasoning: —';
    }
  }catch{}

  const id = location.pathname.split('/').pop();
  if(title) title.textContent = `Session ${id}`;
  // On very short viewports, collapse context card by default
  if(window.innerHeight <= 420){ qs('#ctx-card')?.classList.add('hidden'); }
  window.addEventListener('resize', ()=>{ if(window.innerHeight <= 420) qs('#ctx-card')?.classList.add('hidden'); });

  // Make feed use available viewport height by default
  function adjustFeedHeight(){
    try{
      const f = qs('#feed'); if(!f) return;
      // Compute available height from feed top to viewport bottom with a small margin
      const top = f.getBoundingClientRect().top;
      const h = Math.max(160, Math.floor(window.innerHeight - top - 16));
      f.style.height = `${h}px`;
      f.style.maxHeight = `${h}px`;
    }catch{}
  }
  adjustFeedHeight();
  let rh=null; window.addEventListener('resize', ()=>{ clearTimeout(rh); rh=setTimeout(adjustFeedHeight, 100); });

  // Feed helpers
  function makeMsg(who, contentNode, rawText){
    const wrap=document.createElement('div'); wrap.className=`msg msg-${who}`;
    const head=document.createElement('div'); head.className='msg-head';
    const whoEl=document.createElement('span'); whoEl.className='who'; whoEl.textContent=who;
    const copy=document.createElement('button'); copy.className='copy-btn'; copy.textContent='Copy';
    copy.addEventListener('click',()=>{ try{ const text=(rawText!==undefined && rawText!==null) ? rawText : (contentNode.innerText||''); navigator.clipboard.writeText(text); }catch{} });
    head.append(whoEl, copy); wrap.append(head, contentNode); return wrap;
  }
  function makeReasoning(){ const box=document.createElement('div'); box.className='reasoning collapsed'; const head=document.createElement('div'); head.className='head'; head.innerHTML='<span>Reasoning</span>'; const toggle=document.createElement('button'); toggle.className='toggle-btn'; toggle.textContent='Show'; head.append(toggle); const body=document.createElement('div'); body.className='body'; box.append(head, body); toggle.addEventListener('click',()=>{ const c=box.classList.contains('collapsed'); box.classList.toggle('collapsed'); toggle.textContent=c?'Hide':'Show'; }); return {box, body}; }
  function startTurn(){ const t=document.createElement('div'); t.className='turn'; feed.appendChild(t); currentToolGroup=null; currentToolCount=0; return t; }
  function nearBottom(){ return (feed.scrollTop + feed.clientHeight) >= (feed.scrollHeight - 40); }
  const newInd = qs('#new-ind');
  let autoScroll = true;
  function updateAutoScrollFlag(){ autoScroll = nearBottom(); if(autoScroll && newInd) newInd.style.display='none'; }
  function maybeAutoScroll(){ if(autoScroll){ feed.scrollTop=feed.scrollHeight; if(newInd) newInd.style.display='none'; } else { if(newInd) newInd.style.display='flex'; } }
  feed.addEventListener('scroll', updateAutoScrollFlag, { passive:true });
  qs('#scroll-new')?.addEventListener('click',()=>{ feed.scrollTop=feed.scrollHeight; autoScroll=true; if(newInd) newInd.style.display='none'; });

  let currentTurn=null; let currentAssistant=null; let currentAssistantText=''; let currentReason=null; let currentReasonText=''; let assistantHadDelta=false;
  function addUser(text){ const node=renderMarkdown(text); const wrap=makeMsg('user', node, text); currentTurn=startTurn(); currentTurn.appendChild(wrap); currentAssistant=null; currentReason=null; currentAssistantText=''; currentReasonText=''; assistantHadDelta=false; maybeAutoScroll(); }
  function addAssistantDelta(delta){ if(!currentTurn){ currentTurn=startTurn(); } if(!currentAssistant){ currentAssistantText=''; const node=renderMarkdown(''); currentAssistant=makeMsg('assistant', node, ''); currentTurn.appendChild(currentAssistant); } assistantHadDelta=true; currentAssistantText += delta||''; const body=currentAssistant.querySelector('.md'); body.replaceChildren(...renderMarkdown(currentAssistantText).childNodes); maybeAutoScroll(); }
  function addAssistant(text){ if(!currentTurn){ currentTurn=startTurn(); } if(!currentAssistant){ const node=renderMarkdown(''); currentAssistant=makeMsg('assistant', node, ''); currentTurn.appendChild(currentAssistant); } // Final message: replace with full text to avoid duplicates
    currentAssistantText = text||''; const body=currentAssistant.querySelector('.md'); body.replaceChildren(...renderMarkdown(currentAssistantText).childNodes); maybeAutoScroll(); }
  function addReasoningDelta(delta){ if(!currentTurn){ currentTurn=startTurn(); } if(!currentReason){ currentReason=makeReasoning(); currentTurn.appendChild(currentReason.box); } currentReasonText += delta||''; currentReason.body.replaceChildren(...renderMarkdown(currentReasonText).childNodes); maybeAutoScroll(); }
  function setReasoning(text){ if(!currentTurn){ currentTurn=startTurn(); } if(!currentReason){ currentReason=makeReasoning(); currentTurn.appendChild(currentReason.box); } currentReasonText = text||''; currentReason.body.replaceChildren(...renderMarkdown(currentReasonText).childNodes); maybeAutoScroll(); }
  function addSystem(text){
    const node=renderMarkdown(text);
    const wrap=makeMsg('system', node, text);
    if(!currentTurn){ currentTurn=startTurn(); }
    try{
      if(currentAssistant && currentAssistant.parentElement===currentTurn){
        currentTurn.insertBefore(wrap, currentAssistant);
      } else {
        currentTurn.appendChild(wrap);
      }
    }catch{ currentTurn.appendChild(wrap); }
    try{
      const md = wrap.querySelector('.md');
      const t = String(text||'');
      const lineCount = (t.match(/\n/g)||[]).length + 1;
      if(t.length > 160 || lineCount > 2){
        const btn=document.createElement('button');
        btn.className='show-more';
        btn.setAttribute('aria-expanded','false');
        btn.textContent='More';
        btn.addEventListener('click', ()=>{
          const on = wrap.classList.toggle('expanded');
          btn.textContent = on ? 'Less' : 'More';
          btn.setAttribute('aria-expanded', String(on));
        });
        if(md && md.parentElement){ md.parentElement.appendChild(btn); }
      }
    }catch{}
    maybeAutoScroll();
  }

  // Tool/activity renderer
  const activeTools = new Map(); // call_id -> {wrap, head, pre, pill, status, titleEl, subEl, previewEl, kind, collapsed, lineCount, lastLine, exitCode}
  function ensureTurn(){ if(!currentTurn) currentTurn=startTurn(); return currentTurn; }
  // Grouping for tools within a turn
  let currentToolGroup=null; let currentToolCount=0;
  function ensureToolGroup(){
    if(!currentTurn) ensureTurn();
    if(currentToolGroup && currentToolGroup.parentElement===currentTurn) return currentToolGroup;
    const group=document.createElement('div'); group.className='tool-group';
    const head=document.createElement('div'); head.className='tool-group-head';
    const title=document.createElement('div'); title.className='tool-group-title'; title.textContent='Tools';
    const count=document.createElement('span'); count.className='pill pill-muted'; count.textContent='0';
    head.append(title, count); group.append(head); currentTurn.appendChild(group);
    // If an assistant message already exists for this turn, keep it below the tools group
    try{
      if(currentAssistant && currentAssistant.parentElement===currentTurn){
        currentTurn.insertBefore(currentAssistant, group.nextSibling);
      }
    }catch{}
    head.addEventListener('click', ()=>{
      const tools=[...group.querySelectorAll(':scope > .tool')];
      const anyCollapsed=tools.some(t=>t.classList.contains('collapsed'));
      tools.forEach(t=> t.classList.toggle('collapsed', !anyCollapsed));
    });
    currentToolGroup=group; currentToolCount=0; return group;
  }
  function bumpGroupCount(){ try{ currentToolCount++; const pill=currentToolGroup?.querySelector('.tool-group-head .pill'); if(pill) pill.textContent=String(currentToolCount); }catch{} }
  function safeCreateIcon(kind){ const span=document.createElement('span'); span.className='tool-icn'; let txt='*'; if(kind==='exec') txt='>'; else if(kind==='patch') txt='+/-'; else if(kind==='search') txt='?'; else if(kind==='mcp') txt='@'; span.textContent=txt; return span; }
  function createIcon(kind){ const span=document.createElement('span'); span.className='tool-icn'; let txt=''; if(kind==='exec') txt='›'; else if(kind==='patch') txt='±'; else if(kind==='search') txt='🔎'; else if(kind==='mcp') txt='🔌'; else txt='•'; span.textContent=txt; return span; }
  function toggleCollapsed(obj, to){ const next=(to===undefined)?!obj.collapsed:!!to; obj.collapsed=next; obj.wrap.classList.toggle('collapsed', next); obj.head?.setAttribute('aria-expanded', String(!next)); }
  function updateExecPreview(obj){ if(!obj) return; const count=obj.lineCount||0; const code=obj.exitCode; if(code===undefined || code===null){ obj.previewEl.textContent = count>0 ? `${count} lines…` : 'running…'; } else if(code===0){ obj.previewEl.textContent = count>0 ? `${count} lines output` : 'no output'; } else { const last=(obj.lastLine||'').trim(); obj.previewEl.textContent = last ? last : `exit ${code}`; } }
  function createTool(kind, callId, title, sub){
    const wrap=document.createElement('div'); wrap.className='tool'; wrap.setAttribute('data-kind', kind); wrap.setAttribute('data-id', callId||'');
    const head=document.createElement('div'); head.className='tool-head';
    const left=document.createElement('div'); left.className='tool-left';
    const icn=safeCreateIcon(kind);
    const sep2=document.createElement('span'); sep2.className='tool-sep'; sep2.textContent='|';
    const titleEl=document.createElement('div'); titleEl.className='tool-title'; titleEl.textContent=title;
    const sep=document.createElement('span'); sep.className='tool-sep'; sep.textContent='•';
    const subEl=document.createElement('div'); subEl.className='tool-sub'; subEl.textContent=sub||'';
    const previewEl=document.createElement('span'); previewEl.className='tool-preview'; previewEl.textContent='';
    if(sub){ left.append(icn, titleEl, sep2, subEl, previewEl); } else { left.append(icn, titleEl, previewEl); }
    const status=document.createElement('div'); status.className='tool-status';
    const spinner=document.createElement('span'); spinner.className='spin';
    const dot=document.createElement('span'); dot.className='dot dot-run';
    const pill=document.createElement('span'); pill.className='pill pill-info'; pill.textContent='running'; // hidden via CSS
    status.append(spinner, dot, pill);
    head.append(left, status);
    const body=document.createElement('div'); body.className='tool-body';
    const pre=document.createElement('div'); pre.className='pre'; body.append(pre);
    const bodyId = `tool-body-${Math.random().toString(36).slice(2)}`; body.id=bodyId; head.setAttribute('role','button'); head.setAttribute('tabindex','0'); head.setAttribute('aria-controls', bodyId);
    wrap.append(head, body);
    ensureToolGroup().appendChild(wrap); bumpGroupCount();
    const obj={ wrap, head, pre, pill, status, titleEl, subEl, previewEl, kind, collapsed:false, lineCount:0, lastLine:'', exitCode:undefined, dot };
    // default collapsed: start collapsed for all tools
    toggleCollapsed(obj, true);
    updateExecPreview(obj);
    head.addEventListener('click', ()=> toggleCollapsed(obj));
    head.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); toggleCollapsed(obj); }});
    if(callId) activeTools.set(callId, obj);
    maybeAutoScroll();
    return obj;
  }
  function toolOk(callId, text){ const t=activeTools.get(callId); if(!t) return; t.wrap.classList.add('ok'); t.wrap.classList.remove('err'); t.pill.textContent = text||'ok'; t.dot?.classList.remove('dot-run','dot-err'); t.dot?.classList.add('dot-ok'); t.status.querySelector('.spin')?.remove(); }
  function toolErr(callId, text){ const t=activeTools.get(callId); if(!t) return; t.wrap.classList.add('err'); t.wrap.classList.remove('ok'); t.pill.textContent = text||'error'; t.dot?.classList.remove('dot-run','dot-ok'); t.dot?.classList.add('dot-err'); t.status.querySelector('.spin')?.remove(); }
  function toolAppend(callId, s){
    const t=activeTools.get(callId); if(!t) return;
    t.pre.textContent += s;
    try{ const parts=String(s).split(/\r?\n/); if(parts.length>1) t.lineCount += (parts.length-1); const rev=[...parts].reverse(); const lastNonEmpty=rev.find(x=>x && x.trim().length>0); if(lastNonEmpty!==undefined) t.lastLine=lastNonEmpty; }catch{}
    updateExecPreview(t);
    t.pre.scrollTop = t.pre.scrollHeight; maybeAutoScroll();
  }

  // WS
  const wsUrl = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/sessions/${encodeURIComponent(id)}/events`;
  let eventsLog=[];
  let reasonHeaderBuffer='';
  function extractFirstBold(md){
    const open = md.indexOf('**'); if(open<0) return null; const after = md.indexOf('**', open+2); if(after<0) return null; return md.slice(open+2, after).trim();
  }
  function showReasonHeader(){
    const header = extractFirstBold(reasonHeaderBuffer);
    if(reasonPill) reasonPill.textContent = `Reasoning: ${header||'working…'}`;
  }
  function resetReasonHeader(){ if(reasonPill) reasonPill.textContent='Reasoning: —'; }
  function decodeChunk(x){
    try{
      if(x==null) return '';
      if(Array.isArray(x)){
        return new TextDecoder().decode(new Uint8Array(x));
      }
      if(typeof x === 'object' && Array.isArray(x.data)){
        return new TextDecoder().decode(new Uint8Array(x.data));
      }
      if(typeof x === 'string'){
        // base64 string → bytes → utf-8
        const bin = atob(x);
        const bytes = new Uint8Array([...bin].map(c=>c.charCodeAt(0)));
        return new TextDecoder().decode(bytes);
      }
    }catch{}
    return '';
  }

  function fmtDuration(d){
    try{
      if(!d) return '';
      if(typeof d === 'string') return d;
      if(typeof d === 'number'){
        const ms = d > 1000 ? d : d*1000; // guess units
        if(ms >= 1000) return `${(ms/1000).toFixed(ms>=10000?0:2)}s`;
        return `${Math.round(ms)}ms`;
      }
      if(typeof d === 'object'){
        const secs = ('secs' in d) ? d.secs : (('seconds' in d)? d.seconds : 0);
        const nanos = ('nanos' in d) ? d.nanos : (('ns' in d)? d.ns : 0);
        const totalMs = (secs*1000) + Math.round(nanos/1e6);
        if(totalMs >= 1000) return `${(totalMs/1000).toFixed(totalMs>=10000?0:2)}s`;
        return `${Math.max(1, totalMs)}ms`;
      }
    }catch{}
    return '';
  }

  function connect(){
    const ws=new WebSocket(wsUrl);
    ws.onopen=()=>{
      if(wsPill){ wsPill.textContent='WS: connected'; wsPill.classList.remove('pill-warn','pill-muted'); wsPill.classList.add('pill-ok'); }
      // Persisted overrides
      try{
        const effSel=qs('#effort'); const eff=effSel?.value||localStorage.getItem('codex-effort'); if(eff){ ws.send(JSON.stringify({type:'override_turn_context', effort: eff})); }
        const mSel=qs('#ctx-model');
        const model=(mSel?.value||localStorage.getItem('codex-create-model')||'gpt-5');
        if(model){ ws.send(JSON.stringify({type:'override_turn_context', model})); }
        const ap=qs('#ctx-approval')?.value||localStorage.getItem('codex-create-approval'); if(ap){ ws.send(JSON.stringify({type:'override_turn_context', approval_policy: ap})); }
        const sb=qs('#ctx-sandbox')?.value||localStorage.getItem('codex-create-sandbox'); if(sb){ ws.send(JSON.stringify({type:'override_turn_context', sandbox_mode: sb})); }
        const cwd=qs('#ctx-cwd')?.value||localStorage.getItem('codex-create-cwd'); if(cwd){ ws.send(JSON.stringify({type:'override_turn_context', cwd})); }
      }catch{}
    };
    ws.onclose=()=>{ if(wsPill){ wsPill.textContent='WS: disconnected'; wsPill.classList.remove('pill-ok'); wsPill.classList.add('pill-warn'); } setTimeout(connect, 800); };
    ws.onmessage=(ev)=>{
      eventsLog.push(ev.data);
      try{
        const e=JSON.parse(ev.data); const t=e.msg?.type;
        if(t==='user_message'){ const m=e.msg.message||''; if(lastEchoedUser && m===lastEchoedUser){ lastEchoedUser=null; } else { addUser(m); } }
        else if(t==='agent_message_delta'){ addAssistantDelta(e.msg.delta||''); }
        else if(t==='agent_message'){ addAssistant(e.msg.message||''); }
        else if(t==='agent_reasoning_delta'){ addReasoningDelta(e.msg.delta||''); reasonHeaderBuffer += (e.msg.delta||''); showReasonHeader(); }
        else if(t==='agent_reasoning'){ setReasoning(e.msg.text||''); reasonHeaderBuffer=''; const h=extractFirstBold(e.msg.text||''); if(reasonPill) reasonPill.textContent=`Reasoning: ${h||'done'}`; }
        else if(t==='agent_reasoning_raw_content_delta'){ const d=(new TextDecoder().decode(new Uint8Array(e.msg.delta||[])))||''; addReasoningDelta(d); reasonHeaderBuffer += d; showReasonHeader(); }
        else if(t==='agent_reasoning_raw_content'){ setReasoning((e.msg.text||'')); reasonHeaderBuffer=''; const h=extractFirstBold(e.msg.text||''); if(reasonPill) reasonPill.textContent=`Reasoning: ${h||'done'}`; }
        else if(t==='agent_reasoning_section_break'){ currentReasonText += '\n\n'; reasonHeaderBuffer=''; showReasonHeader(); }
        else if(t==='exec_command_begin'){
          const cmd=(e.msg.command||[]).join(' '); const cwd=e.msg.cwd||''; createTool('exec', e.msg.call_id, cmd, cwd);
        }
        else if(t==='exec_command_output_delta'){
          const s=decodeChunk(e.msg.chunk); toolAppend(e.msg.call_id, s);
        }
        else if(t==='exec_command_end'){
          const code=e.msg.exit_code; const dur=fmtDuration(e.msg.duration);
          const tool=activeTools.get(e.msg.call_id); if(tool){ tool.exitCode=code; updateExecPreview(tool); }
          if(code===0) toolOk(e.msg.call_id, `ok${dur?` (${dur})`:''}`); else toolErr(e.msg.call_id, `exit ${code}${dur?` (${dur})`:''}`);
        }
        else if(t==='exec_approval_request'){ openApproval('exec', e.id, e.msg||{}); }
        else if(t==='apply_patch_approval_request'){ openApproval('patch', e.id, e.msg||{}); }
        else if(t==='turn_diff'){ addSystem(e.msg.unified_diff||''); }
        else if(t==='task_started'){ /* optional: show meta */ reasonHeaderBuffer=''; resetReasonHeader(); }
        else if(t==='task_complete'){
          // Some backends include last_agent_message here; avoid duplicates if we already rendered the assistant content.
          const last = e.msg.last_agent_message;
          if(last && !assistantHadDelta && (!currentAssistantText || currentAssistantText.trim().length===0)){
            addAssistant(last);
          }
          assistantHadDelta = false; /* keep last reasoning header visible; if none, set to default */ if(!reasonHeaderBuffer) resetReasonHeader(); reasonHeaderBuffer='';
        }
        else if(t==='web_search_begin'){
          createTool('search', e.msg.call_id, 'web search', '');
        }
        else if(t==='web_search_end'){
          const q=e.msg.query||''; const tool=activeTools.get(e.msg.call_id) || createTool('search', e.msg.call_id, 'web search', '');
          if(tool){ tool.subEl.textContent=q; const n=Array.isArray(e.msg.results)? e.msg.results.length : undefined; tool.previewEl.textContent = (n!==undefined) ? `${n} results` : 'done'; toolOk(e.msg.call_id, 'done'); }
        }
        else if(t==='patch_apply_begin'){
          const changes=e.msg.changes||{}; const files=Object.keys(changes);
          const tool=createTool('patch', e.msg.call_id, 'apply_patch', `${files.length} files`);
          let totalAdd=0, totalRem=0; const list=document.createElement('div'); list.className='patch-list';
          files.forEach((path)=>{
            const c = changes[path]||{}; let diff=''; let adds=0, rems=0;
            try{
              if(c.update && typeof c.update.unified_diff==='string'){
                diff = c.update.unified_diff;
                for(const line of diff.split(/\r?\n/)){
                  if(line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
                  if(line.startsWith('+')) adds++;
                  else if(line.startsWith('-')) rems++;
                }
              } else if(c.add && typeof c.add.contents==='string'){
                diff = c.add.contents; adds = diff.split(/\r?\n/).length;
              } else if(c.delete){ rems = 0; }
            }catch{}
            totalAdd += adds; totalRem += rems;
            const row=document.createElement('div'); row.className='patch-file';
            const head=document.createElement('div'); head.className='patch-file-head';
            const name=document.createElement('div'); name.className='patch-file-name'; name.textContent=path;
            const chips=document.createElement('div'); chips.className='patch-chips';
            const a=document.createElement('span'); a.className='chip chip-add'; a.textContent=`+${adds}`;
            const r=document.createElement('span'); r.className='chip chip-rem'; r.textContent=`-${rems}`;
            chips.append(a,r); head.append(name, chips);
            const diffBox=document.createElement('div'); diffBox.className='patch-diff'; const pre=document.createElement('pre'); const code=document.createElement('code'); code.textContent=diff; pre.appendChild(code); diffBox.append(pre);
            row.append(head, diffBox);
            head.addEventListener('click', ()=>{ row.classList.toggle('open'); });
            list.append(row);
          });
          tool.previewEl.textContent = `+${totalAdd}/-${totalRem}`;
          tool.pre.replaceWith(list); tool.pre = list;
        }
        else if(t==='mcp_tool_call_begin'){
          const inv=e.msg.invocation||{}; createTool('mcp', e.msg.call_id, `${inv.server||''}.${inv.tool||''}`, '');
        }
        else if(t==='mcp_tool_call_end'){
          const ok = e.msg.result && !e.msg.result.is_error; const tool=activeTools.get(e.msg.call_id); if(tool){ tool.previewEl.textContent = ok? 'ok' : 'error'; } if(ok) toolOk(e.msg.call_id, 'ok'); else toolErr(e.msg.call_id, 'error');
        }
        else if(t==='patch_apply_begin'){
          const changes=e.msg.changes||{}; const n=Object.keys(changes).length; const sub=e.msg.auto_approved?`auto-approved • ${n} files`:`${n} files`;
          createTool('patch', e.msg.call_id, 'apply_patch', sub);
        }
        else if(t==='patch_apply_end'){
          if(e.msg.success) toolOk(e.msg.call_id, 'applied'); else toolErr(e.msg.call_id, 'failed');
        }
        else if(t==='token_count'){
          const i=e.msg.input_tokens||0; const c=e.msg.cached_input_tokens||0; const o=e.msg.output_tokens||0;
          if(tokensEl){ tokensEl.textContent=`Tokens: in ${i}${c?` (${c} cached)`:''}, out ${o}`; tokensEl.classList.remove('pill-muted'); tokensEl.classList.add('pill-info'); }
        }
        else if(t==='background_event'){ addSystem(e.msg.message||''); }
        else if(t==='stream_error'){ addSystem(`stream error: ${e.msg.message||''}`); }
        else if(t==='error'){ addSystem(`error: ${e.msg.message||''}`); }
        else if(t==='session_configured'){
          try{
            // Model
            const model = e.msg.model || '';
            const modelSel = qs('#ctx-model');
            if(modelSel && model){
              let opt = [...(modelSel.options||[])].find(o=>o.value===model);
              if(!opt){ opt = document.createElement('option'); opt.value=model; opt.textContent=model; modelSel.appendChild(opt); }
              modelSel.value = model;
            }
            setPill('#model-pill', `Model: ${model||'—'}`);
            // Approval
            if(e.msg.approval_policy){ const apSel = qs('#ctx-approval'); if(apSel){ apSel.value = e.msg.approval_policy; } setPill('#approval-pill', `Approval: ${e.msg.approval_policy}`); }
            // Sandbox
            if(e.msg.sandbox_mode){ const sbSel = qs('#ctx-sandbox'); if(sbSel){ sbSel.value = e.msg.sandbox_mode; } setPill('#sandbox-pill', `Sandbox: ${e.msg.sandbox_mode}`); }
            // CWD
            if(e.msg.cwd){ const cwdInput = qs('#ctx-cwd'); if(cwdInput){ cwdInput.value = e.msg.cwd; }
              setPill('#cwd-pill', `CWD: ${e.msg.cwd}`);
              // record in history
              try{ const key='codex-cwd-history'; const arr=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(arr)){ const list=[e.msg.cwd, ...arr.filter(p=>p!==e.msg.cwd)]; localStorage.setItem(key, JSON.stringify(list.slice(0,20))); } }catch{}
            }
          }catch{}
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
    const modelSel=qs('#ctx-model'); const approvalSel=qs('#ctx-approval'); const sandboxSel=qs('#ctx-sandbox'); const cwdInput=qs('#ctx-cwd');
    try{
      const m=localStorage.getItem('codex-create-model'); if(m && modelSel){
        const opt=[...(modelSel.options||[])].find(o=>o.value===m);
        if(opt){ modelSel.value=m; }
      }
      const ap=localStorage.getItem('codex-create-approval'); if(ap && approvalSel){ approvalSel.value=ap; }
      const sb=localStorage.getItem('codex-create-sandbox'); if(sb && sandboxSel){ sandboxSel.value=sb; }
      const cwd=localStorage.getItem('codex-create-cwd'); if(cwd && cwdInput){ cwdInput.value=cwd; }
    }catch{}
    function refreshPills(){
      if(!modelSel) return;
      const modelVal = modelSel.value || '—';
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
      try{ localStorage.setItem('codex-create-model', modelSel.value);}catch{}
      refreshPills(); if(!window._ws||_ws.readyState!==1) return; const val=modelSel.value; if(val) _ws.send(JSON.stringify({type:'override_turn_context', model: val}));
    });
    approvalSel?.addEventListener('change', ()=>{ try{ localStorage.setItem('codex-create-approval', approvalSel.value);}catch{} refreshPills(); if(!window._ws||_ws.readyState!==1) return; _ws.send(JSON.stringify({type:'override_turn_context', approval_policy: approvalSel.value})); });
    sandboxSel?.addEventListener('change', ()=>{ try{ localStorage.setItem('codex-create-sandbox', sandboxSel.value);}catch{} refreshPills(); if(!window._ws||_ws.readyState!==1) return; _ws.send(JSON.stringify({type:'override_turn_context', sandbox_mode: sandboxSel.value})); });
    cwdInput?.addEventListener('change', ()=>{ try{ localStorage.setItem('codex-create-cwd', cwdInput.value);}catch{} refreshPills(); if(!window._ws||_ws.readyState!==1) return; const v=cwdInput.value.trim(); if(v) _ws.send(JSON.stringify({type:'override_turn_context', cwd: v})); });
  })();

  // Actions
  // New session: carry current page context (cwd, model, approval, sandbox)
  qs('#new-session')?.addEventListener('click', async ()=>{
    const btn = qs('#new-session'); if(btn) { btn.disabled = true; btn.textContent = 'New…'; }
    try{
      let cwd = (qs('#ctx-cwd')?.value||'').trim();
      if(!cwd){
        const pill = qs('#cwd-pill')?.textContent||'';
        const idx = pill.indexOf(':');
        if(idx>=0) cwd = pill.slice(idx+1).trim();
        if(cwd==='—') cwd = '';
      }
      const model = qs('#ctx-model')?.value || 'gpt-5';
      const approval_policy = qs('#ctx-approval')?.value || undefined;
      const sandbox_mode = qs('#ctx-sandbox')?.value || undefined;
      const body = { cwd: cwd || null, model, approval_policy, sandbox_mode };
      const r = await fetch('/api/sessions', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      if(!r.ok){ throw new Error(await r.text()); }
      const j = await r.json();
      location.href = `/session/${j.session_id}`;
    } catch(e){ alert(`Create failed: ${e?.message||e}`); }
    finally{ if(btn){ btn.disabled=false; btn.textContent='New'; } }
  });

  qs('#interrupt')?.addEventListener('click', ()=>{ if(window._ws && _ws.readyState===1){ _ws.send(JSON.stringify({type:'interrupt'})); } });
  qs('#export')?.addEventListener('click', ()=>{ try{ const blob=new Blob([eventsLog.join('\n')],{type:'application/x-ndjson'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`codex-session-${id}.jsonl`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);}catch{ alert('Export failed'); } });
  // Copy transcript button
  (function(){
    const copyBtn=document.createElement('button');
    copyBtn.className='btn ghost icon';
    copyBtn.title='Copy transcript';
    copyBtn.setAttribute('aria-label','Copy transcript');
    copyBtn.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7zm-3 3h1v7a3 3 0 0 0 3 3h9v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V10z"/></svg><span class="label">Copy</span>';
    copyBtn.addEventListener('click',()=>{ try{ navigator.clipboard.writeText(feed.innerText||''); }catch{} });
    qs('.actions')?.prepend(copyBtn);
  })();
  // Context toggle button (mobile)
  (function(){ const ctxToggle=document.createElement('button'); ctxToggle.className='btn ghost'; ctxToggle.textContent='Context'; ctxToggle.title='Show/Hide context'; ctxToggle.addEventListener('click',()=>{ const card=qs('#ctx-card'); const hidden=card.classList.toggle('hidden'); ctxToggle.setAttribute('aria-expanded', String(!hidden)); }); qs('.actions')?.prepend(ctxToggle); })();

  // Git Auto-Commit
  (function(){
    const modal=qs('#git-modal'); const msg=qs('#git-message'); const bOpen=qs('#git-btn'); const bClose=qs('#git-close'); const bRun=qs('#git-run'); const bCancel=qs('#git-cancel');
    const LS_MSG='codex-git-message';
    function open(){ modal.setAttribute('aria-hidden','false'); try{ const saved=localStorage.getItem(LS_MSG); if(saved && msg) msg.value=saved; }catch{} msg?.focus(); }
    function close(){ modal.setAttribute('aria-hidden','true'); }
    bOpen?.addEventListener('click', open);
    bClose?.addEventListener('click', close);
    bCancel?.addEventListener('click', close);
    function run(){
      const m = (msg?.value||'').trim() || 'chore: update';
      try{ localStorage.setItem(LS_MSG, m); }catch{}
      const pull = qs('#git-pull')?.checked; const add = qs('#git-add')?.checked; const push = qs('#git-push')?.checked;
      const steps = [];
      if(pull) steps.push('git pull --rebase');
      if(add) steps.push('git add -A');
      steps.push(`git commit -m "${m.replace(/"/g,'\\"')}" || true`);
      if(push) steps.push('git push');
      const cwd = (qs('#ctx-cwd')?.value||'').trim();
      const instruct = [
        'Please perform a Git auto-commit in the current workspace.',
        cwd?`CWD: ${cwd}`:'',
        'Steps:',
        ...steps.map(s=>`- ${s}`),
        'Use the default remote/branch. If pull fails due to divergence, attempt a rebase. Summarize what changed.'
      ].filter(Boolean).join('\n');
      if(!window._ws || _ws.readyState!==1){ alert('WebSocket not connected'); return; }
      _ws.send(JSON.stringify({type:'user_message', text: instruct}));
      close();
    }
    bRun?.addEventListener('click', run);
    modal?.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && (e.metaKey||e.ctrlKey)) run(); });
    modal?.addEventListener('click', (e)=>{ if(e.target===modal) close(); });
  })();

  // Approval modal
  let pendingApproval=null; // { kind: 'exec'|'patch', id, data }
  function openApproval(kind, id, data){ pendingApproval={kind,id,data}; const modal=qs('#approval-modal'); const body=qs('#approval-body'); const title=qs('#approval-title'); body.innerHTML='';
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
      function renderFile(idx){ pre.textContent=''; const [path, ch]=entries[idx];
        [...list.children].forEach((el,i)=>{ el.classList.toggle('active', i===idx); });
        if(ch && ch.update){ pre.textContent = ch.update.unified_diff || ''; }
        else if(ch && ch.add){ pre.textContent = ch.add.content || ''; }
        else if(ch && ch.delete){ pre.textContent = ch.delete.content || ''; }
        else { const t=ch?.type; if(t==='update'){ pre.textContent=ch.unified_diff||''; } else if(t==='add'){ pre.textContent=ch.content||''; } else if(t==='delete'){ pre.textContent=ch.content||''; } else { pre.textContent = JSON.stringify(ch,null,2); } }
      }
      entries.forEach(([path, ch], idx)=>{ const item=document.createElement('div'); item.className='file-item'; const name=document.createElement('div'); name.textContent=String(path); const tag=document.createElement('div'); tag.className='muted'; if(ch && ch.update){ tag.textContent='update'; } else if(ch && ch.add){ tag.textContent='add'; } else if(ch && ch.delete){ tag.textContent='delete'; } else { tag.textContent=String(ch?.type||'change'); } item.append(name, tag); item.addEventListener('click',()=>renderFile(idx)); list.append(item); });
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
  qs('#approve')?.addEventListener('click', ()=>{ if(!pendingApproval||!window._ws||_ws.readyState!==1) return; const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval'; _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'approved'})); closeApproval(); });
  qs('#approve-session')?.addEventListener('click', ()=>{ if(!pendingApproval||!window._ws||_ws.readyState!==1) return; const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval'; _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'approved_for_session'})); closeApproval(); });
  qs('#deny')?.addEventListener('click', ()=>{ if(!pendingApproval||!window._ws||_ws.readyState!==1) return; const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval'; _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'denied'})); closeApproval(); });
  qs('#abort')?.addEventListener('click', ()=>{ if(!pendingApproval||!window._ws||_ws.readyState!==1) return; const type=pendingApproval.kind==='exec'?'exec_approval':'patch_approval'; _ws.send(JSON.stringify({type, id: pendingApproval.id, decision:'abort'})); closeApproval(); });
  qs('#approval-modal')?.addEventListener('click',(e)=>{ const m=qs('#approval-modal'); if(e.target===m) closeApproval(); });
  window.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ const m=qs('#approval-modal'); if(m.getAttribute('aria-hidden')==='false') closeApproval(); } });

  // Chat queue + send
  let lastEchoedUser = null;
  const queueEl = qs('#queue'); const queueListEl = qs('#queue-list'); const queueCountEl = qs('#queue-count');
  const taSend = qs('#chat');
  const QKEY = `codex-queue-${id||'session'}`;
  let queue = [];
  function loadQueue(){ try{ const s=localStorage.getItem(QKEY); const arr=JSON.parse(s||'[]'); if(Array.isArray(arr)) queue = arr.filter(x=>typeof x?.text==='string').map((x,i)=>({id:x.id||String(Date.now()+i), text:x.text})); }catch{ queue=[]; } }
  function saveQueue(){ try{ localStorage.setItem(QKEY, JSON.stringify(queue)); }catch{} }
  function updateQueueVisibility(){ if(queueEl) queueEl.classList.toggle('hidden', queue.length===0); if(queueCountEl) queueCountEl.textContent=String(queue.length); }
  function renderQueue(){ if(!queueListEl) return; queueListEl.innerHTML=''; queue.forEach((it, idx)=>{
      const row=document.createElement('div'); row.className='queue-item'; row.setAttribute('data-id', it.id);
      const text=document.createElement('div'); text.className='queue-text'; text.title=it.text; text.textContent=it.text.replace(/\s+/g,' ').slice(0,200);
      const actions=document.createElement('div'); actions.className='queue-actions';
      const btnUse=document.createElement('button'); btnUse.className='btn-sm'; btnUse.textContent='Use'; btnUse.title='Move to composer'; btnUse.addEventListener('click',()=>{ if(taSend){ taSend.value=it.text; taSend.focus(); autoSizeChat(); } queue.splice(idx,1); saveQueue(); renderQueue(); updateQueueVisibility(); });
      const btnSend=document.createElement('button'); btnSend.className='btn-sm'; btnSend.textContent='Send'; btnSend.title='Send this now'; btnSend.addEventListener('click',()=>{ sendText(it.text); queue.splice(idx,1); saveQueue(); renderQueue(); updateQueueVisibility(); if(!taSend || !taSend.value.trim()){ if(queue.length>0){ const next=queue.shift(); if(taSend){ taSend.value=next.text; taSend.focus(); autoSizeChat(); } saveQueue(); renderQueue(); updateQueueVisibility(); } } });
      const btnUp=document.createElement('button'); btnUp.className='btn-sm'; btnUp.textContent='↑'; btnUp.title='Move up'; btnUp.addEventListener('click',()=>{ if(idx>0){ const tmp=queue[idx-1]; queue[idx-1]=queue[idx]; queue[idx]=tmp; saveQueue(); renderQueue(); } });
      const btnDown=document.createElement('button'); btnDown.className='btn-sm'; btnDown.textContent='↓'; btnDown.title='Move down'; btnDown.addEventListener('click',()=>{ if(idx<queue.length-1){ const tmp=queue[idx+1]; queue[idx+1]=queue[idx]; queue[idx]=tmp; saveQueue(); renderQueue(); } });
      const btnDel=document.createElement('button'); btnDel.className='btn-sm'; btnDel.textContent='×'; btnDel.title='Remove'; btnDel.addEventListener('click',()=>{ queue.splice(idx,1); saveQueue(); renderQueue(); updateQueueVisibility(); });
      actions.append(btnUse, btnSend, btnUp, btnDown, btnDel); row.append(text, actions); queueListEl.append(row);
    }); updateQueueVisibility(); }
  function addToQueue(text){ if(!text || !text.trim()) return; queue.push({id:String(Date.now()), text:text.trim()}); saveQueue(); renderQueue(); updateQueueVisibility(); }
  function sendText(text){ const s=(text||'').trim(); if(!s||!window._ws||_ws.readyState!==1) return; addUser(s); lastEchoedUser = s; _ws.send(JSON.stringify({type:'user_message', text:s})); }
  function autoSizeChat(){ try{ const ta=qs('#chat'); if(!ta) return; ta.style.height='auto'; const max=Math.max(100, Math.round(window.innerHeight*0.4)); const h=Math.min(ta.scrollHeight, max); ta.style.height=`${h}px`; }catch{} }
  // Wire send button
  qs('#send')?.addEventListener('click', ()=>{ const txt=(taSend?.value||'').trim(); if(!txt) return; sendText(txt); if(taSend){ taSend.value=''; autoSizeChat(); }
    if(queue.length>0){ const next=queue.shift(); if(taSend){ taSend.value=next.text; autoSizeChat(); taSend.focus(); } saveQueue(); renderQueue(); updateQueueVisibility(); }
  });
  // Queue button
  qs('#queue-add')?.addEventListener('click', ()=>{ const v=(taSend?.value||'').trim(); if(!v) return; addToQueue(v); if(taSend){ taSend.value=''; autoSizeChat(); taSend.focus(); } });
  // Keyboard: Enter sends, Shift+Enter newline, Ctrl/Cmd+Enter queues
  qs('#chat')?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){
      e.preventDefault(); const v=(taSend?.value||'').trim(); if(!v) return; addToQueue(v); if(taSend){ taSend.value=''; autoSizeChat(); taSend.focus(); }
      return;
    }
    if(e.key==='Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey){
      e.preventDefault(); const v=(taSend?.value||'').trim(); if(!v) return; sendText(v); if(taSend){ taSend.value=''; autoSizeChat(); }
      if(queue.length>0){ const next=queue.shift(); if(taSend){ taSend.value=next.text; autoSizeChat(); taSend.focus(); } saveQueue(); renderQueue(); updateQueueVisibility(); }
      return;
    }
  });
  // Load queue from storage
  loadQueue(); renderQueue(); updateQueueVisibility();

  // Chat autosize: one-line by default, grow with content/newlines
  (function(){
    const ta = qs('#chat'); if(!ta) return;
    function autosize(){
      ta.style.height = 'auto';
      const max = Math.max(100, Math.round(window.innerHeight * 0.4));
      const h = Math.min(ta.scrollHeight, max);
      ta.style.height = `${h}px`;
      if(typeof adjustFeedHeight === 'function') adjustFeedHeight();
    }
    ['input','change'].forEach(ev=> ta.addEventListener(ev, autosize));
    ta.addEventListener('focus', autosize);
    ta.addEventListener('paste', ()=> setTimeout(autosize, 0));
    setTimeout(autosize, 0);
  })();

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
    function render(){ list.innerHTML=''; const q=(input.value||'').toLowerCase(); actions().filter(a=>!q||a.label.toLowerCase().includes(q)||(a.sub||'').toLowerCase().includes(q)).forEach(a=>{ const row=document.createElement('div'); row.className='cmd-row'; row.tabIndex=0; const l=document.createElement('div'); l.className='cmd-left'; const t=document.createElement('div'); t.className='cmd-title'; t.textContent=a.label; const s=document.createElement('div'); s.className='cmd-sub'; s.textContent=a.sub||''; l.append(t,s); const go=document.createElement('div'); go.className='muted'; go.textContent='↩'; row.append(l, go); row.addEventListener('click',()=>{ a.run(); close(); }); row.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ a.run(); close(); }}); list.append(row); }); }
    input?.addEventListener('input', render);
    window.addEventListener('keydown',(e)=>{ const mod=e.ctrlKey||e.metaKey; if(mod && e.key.toLowerCase()==='k'){ e.preventDefault(); open(); } if(e.key==='Escape' && modal.getAttribute('aria-hidden')==='false'){ close(); } });
    modal?.addEventListener('click',(e)=>{ if(e.target===modal) close(); });
  })();

  // Expand/Collapse all tools in current turn: Alt+Shift+E
  (function(){
    window.addEventListener('keydown', (e)=>{
      if(!(e.altKey && e.shiftKey && (e.key==='E' || e.key==='e'))) return;
      e.preventDefault();
      try{
        const turns = feed.querySelectorAll('.turn');
        const lastTurn = turns.length ? turns[turns.length-1] : null;
        const scope = lastTurn || feed;
        const tools = [...scope.querySelectorAll('.tool')];
        if(!tools.length) return;
        const anyCollapsed = tools.some(t=>t.classList.contains('collapsed'));
        tools.forEach(t=> t.classList.toggle('collapsed', !anyCollapsed));
      }catch{}
    });
  })();

  // ASCII fallback for icons/preview text in limited environments
  (function(){
    try{
      // Override icon generator to ASCII-only glyphs
      createIcon = function(kind){
        const span=document.createElement('span'); span.className='tool-icn';
        let txt='*'; if(kind==='exec') txt='>'; else if(kind==='patch') txt='+/-'; else if(kind==='search') txt='?'; else if(kind==='mcp') txt='@';
        span.textContent = txt; return span;
      };
      // Override preview to avoid Unicode ellipsis
      const _origPreview = updateExecPreview;
      updateExecPreview = function(obj){ if(!obj) return; const count=obj.lineCount||0; const code=obj.exitCode; if(code===undefined || code===null){ obj.previewEl.textContent = count>0 ? `${count} lines...` : 'running...'; } else if(code===0){ obj.previewEl.textContent = count>0 ? `${count} lines output` : 'no output'; } else { const last=(obj.lastLine||'').trim(); obj.previewEl.textContent = last ? last : `exit ${code}`; } };
    }catch{}
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
      if(st==='pending'){ b.classList.add('b-pending'); row.classList.add('b-pending'); }
      else if(st==='in_progress'){ b.classList.add('b-inprogress'); row.classList.add('b-inprogress'); }
      else if(st==='completed'){ b.classList.add('b-completed'); row.classList.add('b-completed'); }
      b.textContent=(st||'').replace('_',' ');
      row.append(step,b); planEl.append(row);
    });
    if(data.explanation){ const ex=document.createElement('div'); ex.className='muted'; ex.textContent=data.explanation; planEl.prepend(ex); }
  }

  // Kick it off
  connect();
}

// Boot
initTheme();
initSession();

// Auto-hide header on scroll (show on scroll up or when cursor near top)
(function(){
  const header = document.querySelector('.app-header'); if(!header) return;
  const container = document.querySelector('main.container');
  let last = 0; let hidden = false; let ticking=false;
  const scrollEl = document.querySelector('#feed') || window;

  function cur(){
    return scrollEl===window ? (window.pageYOffset || document.documentElement.scrollTop) : scrollEl.scrollTop;
  }

  // Adjust layout so when header hides, content moves up (no empty gap)
  function adjustContainerOffset(isHidden){
    if(!container) return;
    try{
      const h = header.offsetHeight || 0;
      // Use negative margin to pull content up under the hidden header.
      container.style.marginTop = isHidden ? `-${h}px` : '';
    }catch{}
  }

  function setHidden(h){
    if(h===hidden) return;
    hidden = h;
    header.classList.toggle('header-hidden', hidden);
    adjustContainerOffset(hidden);
  }

  function onScroll(){
    const y = cur();
    if(Math.abs(y-last) < 3) return;
    if(y > last && y > 12) setHidden(true); else setHidden(false);
    last = y;
  }
  function onWheel(){ if(!ticking){ window.requestAnimationFrame(()=>{ onScroll(); ticking=false; }); ticking=true; } }

  // Initial measurement
  adjustContainerOffset(false);
  // Recompute on resize (header height can change with breakpoints)
  window.addEventListener('resize', ()=> adjustContainerOffset(hidden));

  (scrollEl===window?window:scrollEl).addEventListener('scroll', onScroll, { passive:true });
  (scrollEl===window?window:scrollEl).addEventListener('wheel', onWheel, { passive:true });
  // Reveal when mouse near top
  window.addEventListener('mousemove', (e)=>{ if(e.clientY < 16) setHidden(false); });
  header.addEventListener('mouseenter', ()=> setHidden(false));
})();
