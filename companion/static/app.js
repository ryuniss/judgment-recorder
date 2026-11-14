const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {SELECT:'선택', HOLD:'보류', EXCLUDE:'제외', UNDECIDED:'아직 모르겠어요'};
const app = $('#app'), modal = $('#modal');
let state, current, config = {}, view = null, attached = null, checkpoint = null, draft = null, sending = false, saving = false, uploadBusy = false, uploadError = '', pendingUploads = [], toastTimer;
let guide = null, guideReturnFocus = null, guideReturnView = null, modalReturnFocus = null, lastReplyFailure = null, historyData = null;
const key = type => `companion-v2:${state?.id}:${current?.id}:${type}`;
function readLocal(name, fallback) { try { return JSON.parse(localStorage.getItem(name)) ?? fallback; } catch { return fallback; } }
function writeLocal(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); } catch { toast('이 브라우저에는 임시 내용을 보관할 수 없어요. 창을 닫기 전에 기록해주세요.'); } }
function removeLocal(name) { try { localStorage.removeItem(name); } catch {} }
function toast(message) { $('#toast').textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 6500); }
async function api(path, data) {
  let response;
  try { response = await fetch(`/api${path}`, {method:data === undefined ? 'GET':'POST', headers:{'Content-Type':'application/json'}, ...(data === undefined ? {} : {body:JSON.stringify(data)})}); }
  catch { throw new Error('연결하지 못했어요. 입력한 내용은 그대로 있어요. 연결을 확인하고 다시 시도해주세요.'); }
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '요청을 마치지 못했어요. 다시 시도해주세요.'); error.status = response.status; throw error; }
  return result;
}
const route = action => `/rounds/${current.id}/${action}`;
const results = () => current?.results.filter(x => !x.is_context) || [];
const roundTitle = r => r.is_practice ? '연습 라운드' : `라운드 ${r.number}`;
function pic(result, className = 'image') { return `<div class="${className}"><img src="${esc(result.image)}" alt="${esc(result.label)} 결과 이미지" loading="lazy"></div>`; }
function button(action, text, cls = '', attrs = '') { return `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${text}</button>`; }
function savedMessage() { const r=state.rounds.filter(x=>x.status==='recorded'&&!x.is_practice).at(-1); return r ? `라운드 ${r.number}을 기록했어요. 새 결과를 올리면 라운드 ${r.number+1}이 시작돼요.` : ''; }
async function refresh() {
  state = await api('/state');
  current = state.rounds.find(x => x.status !== 'recorded') || null;
  if (attached && !results().some(x => x.id === attached)) attached = null;
}
async function boot() {
  config = await api('/config');
  try {
    await refresh();
    if (!current && !state.practice_completed) { await api('/rounds',{is_practice:true}); await refresh(); }
    if (current?.status === 'checkpoint') await loadCheckpoint();
    render();
    if (!state.intro_seen && current?.is_practice && current.status==='active') startGuide();
  } catch(error) { if(error.status===401) renderLogin(); else { renderLogin(); $('#login-error').textContent=error.message; } }
}
function renderLogin() {
  app.innerHTML = `<main class="entry"><section class="entry-card"><div class="mark" aria-hidden="true">c.</div><div><h1>나의 디자인 탐색 기록</h1><p class="muted">보고, 말하고, 내 판단으로 남겨요.</p></div><form id="login"><label for="code">참여 코드</label><input id="code" name="code" type="password" autocomplete="off" maxlength="128" required placeholder="받은 참여 코드를 입력해주세요"><button class="primary" type="submit">탐색 열기</button><p id="login-error" class="error" role="alert"></p></form><p class="muted">처음이라면 컵 사진으로 한 번 연습해요.</p>${config.demo?'<small>화면 테스트용이에요. 대화에는 정해진 응답을 사용해요.</small>':''}</section></main>`;
}
function header() {
  const recent=state.rounds.filter(x=>!x.is_practice).slice(-4);
  return `<header class="top"><div class="brand"><b>Companion</b><span>의자 형태 탐색</span></div><ol class="rounds" aria-label="라운드">${current?.is_practice?'<li class="practice" aria-current="step">연습 라운드</li>':recent.map(r=>`<li class="${r.id===current?.id?'now':''}" ${r.id===current?.id?'aria-current="step"':''}><span class="round-number">${r.number}</span>${r.status==='recorded'?'기록됨':r.status==='checkpoint'?'확인 중':'진행 중'}</li>`).join('')}</ol><span class="spacer"></span>${button('guide','사용 안내','ghost')}${button('history','탐색 과정 보기')}${button('logout','나가기','ghost')}</header>`;
}
function render() {
  if(!state) return;
  app.innerHTML=`${config.demo?'<div class="notice" role="note">화면 테스트 · 정해진 대화 응답을 사용해요. 실제 AI 대화가 아니에요.</div>':''}<div class="app">${header()}<div class="body"><main class="stage" id="stage">${current?.status==='checkpoint'?checkpointHTML():stageHTML()}</main><aside class="side" aria-label="대화">${chatHTML()}</aside></div></div>`;
  const input=$('#message'); if(input) input.value=readLocal(key('compose'),{text:''}).text;
  setupDrop();
}
function stageHTML() {
  const list=results();
  const banner=current?.is_practice?`<div class="banner"><p><b>연습 라운드예요.</b> 컵 사진으로 올리기, 말하기, 확인까지 한 번 해봐요. 여기서 한 말과 판단은 연구 기록에 들어가지 않아요.</p>${button('guide','사용 안내 다시 보기')}</div>`:'';
  if(view && list.some(x=>x.id===view)) {
    const i=list.findIndex(x=>x.id===view), r=list[i];
    return `${banner}<section class="viewer"><div class="bar">${button('grid','← 결과 모두 보기','ghost')}<b>${esc(r.label)}</b><span></span></div>${pic(r)}<div class="thumbs">${list.map(x=>button('view',`<img src="${esc(x.image)}" alt="${esc(x.label)}">`,'thumb',`data-id="${x.id}" aria-label="${x.label} 크게 보기" aria-current="${x.id===view}"`)).join('')}</div><div class="viewer-foot"><div class="actions">${button('prev','←','',`aria-label="이전 결과" ${i===0?'disabled':''}`)}${button('next','→','',`aria-label="다음 결과" ${i===list.length-1?'disabled':''}`)}</div>${button('attach',`${r.label}를 보며 말하기`,'primary','id="attach-button"')}</div></section>`;
  }
  const status=uploadBusy?'이미지를 올리고 있어요.':uploadError;
  return `${banner}${!current&&savedMessage()?`<div class="banner" role="status"><p>${savedMessage()}</p></div>`:''}<div class="bar"><span>${list.length?`${current?.is_practice?'연습용':'올린'} 결과 ${list.length}개`:'새 결과를 올려주세요'}</span><div class="actions">${current?.results.some(x=>x.is_context)?button('context','생성 화면 보기'):''}${button('upload','이미지 더 올리기','','id="upload-target" '+(uploadBusy?'disabled':''))}</div></div>${list.length?`<div class="grid">${list.map((r,i)=>`<button type="button" class="tile ${attached===r.id?'attached':''}" data-action="view" data-id="${r.id}" ${i===0?'id="first-result"':''} aria-label="${r.label} 크게 보기"><div class="cap"><span>${r.label}</span>${attached===r.id?'<small>대화에 붙음</small>':''}</div>${pic(r)}</button>`).join('')}</div>`:`<section class="upload" id="drop-zone"><span class="upload-icon" aria-hidden="true">＋</span><h1>보고 싶은 결과를 올려주세요</h1><p>파일을 끌어다 놓거나, 복사한 이미지를 붙여넣어요.<br>JPG · PNG · WebP / 한 장에 8MB까지</p>${button('upload','파일 고르기','primary',uploadBusy?'disabled':'')}</section>`}<div class="error" role="status">${esc(status)}${uploadError&&pendingUploads.length?button('retry-upload','다시 올리기'):''}</div><div class="context"><span class="muted">(선택) 생성 화면 전체 캡처<br><small>결과를 만든 맥락을 함께 남겨요.</small></span>${button('upload-context','생성 화면 올리기','ghost',uploadBusy?'disabled':'')}</div>`;
}
function chatHTML() {
  const cp=current?.status==='checkpoint';
  const turns=(current?.turns||[]).filter(x=>!cp||x.role==='user');
  const list=results();
  return `${cp?'<div class="readonly"><b>이번 라운드에서 한 말</b><span class="muted">읽기만 가능</span></div>':''}<div class="log" aria-live="polite">${!cp?`<div class="divider">${current?roundTitle(current)+' 시작':'탐색 기록'}</div>`:''}${turns.map(t=>t.role==='user'?`<div class="message">${t.result_id?`<span class="tag">${esc(list.find(x=>x.id===t.result_id)?.label||'결과')}를 보며</span>`:''}<p class="say">${esc(t.content)}</p></div>`:`<p class="ai">${esc(t.content)}</p>`).join('')}${!turns.length?`<p class="ai muted">${cp?'이번 라운드에는 대화가 없어요.':'보이는 대로, 떠오른 그대로 말해보세요.'}</p>`:''}${sending?'<p class="ai" role="status">답을 쓰고 있어요.</p>':''}${lastReplyFailure&&!cp?`<div class="panel"><p class="error">말은 저장됐지만 답을 받지 못했어요.</p>${button('retry-reply','다시 답 받기')}</div>`:''}</div>${cp?'<p class="readonly-note">기록하면 다음 라운드 대화를 이어갈 수 있어요.</p>':`<form class="compose" id="compose">${attached?`<div class="attachment">${esc(list.find(x=>x.id===attached)?.label)}를 보며${button('detach','×','','aria-label="붙이기 해제"')}</div>`:''}<label class="sr-only" for="message">하고 싶은 말</label><textarea id="message" rows="3" placeholder="보면서 떠오른 걸 그대로 적어주세요" ${sending?'readonly':''}></textarea><div class="row"><small>이미지를 누르면 크게 보고 붙일 수 있어요</small><button type="submit" class="primary" ${!current||sending?'disabled':''}>${sending?'보내는 중':'보내기'}</button></div><p id="send-error" class="error" role="alert"></p></form>${button('checkpoint',current?.is_practice?'연습 마치고 확인하기':'라운드 마치고 확인하기','end','id="end-button" '+(!current||sending?'disabled':''))}`}`;
}
function options(id, value, revision=false) { return `<div role="radiogroup" aria-label="${esc(checkpoint?.results.find(r=>r.id===id)?.label || checkpoint?.previous.find(r=>r.id===id)?.result_label || '결과')}에 대한 내 판단" class="opts">${Object.entries(names).map(([v,n])=>button(revision?'revision-label':'label',n,'opt',`role="radio" aria-checked="${value===v}" data-id="${esc(id)}" data-value="${v}"`)).join('')}</div>`; }
function draftSave() { if(draft) writeLocal(key('checkpoint'),draft); }
async function loadCheckpoint() {
  checkpoint=await api(route('checkpoint'),{});
  const stored=readLocal(key('checkpoint'),null);
  draft=stored||{decisions:{},moves:[],revisions:{}};
  for(const r of checkpoint.results) {
    if(r.discussed&&!draft.decisions[r.id]) draft.decisions[r.id]={label:null,reason:r.original_text};
    // A resumed conversation may have new words; update only reasons the student has not edited.
    const d=draft.decisions[r.id];
    if(d && d.original!==undefined && d.reason===d.original) d.reason=r.original_text;
    if(d) d.original=r.original_text;
  }
  if(!stored && checkpoint.moves?.length) draft.moves=checkpoint.moves;
  if(!draft.moves.length) draft.moves=[{content:'',original_text:'',links:[]}];
  draftSave();
}
function checkpointHTML() {
  if(!checkpoint||!draft)return '<p>확인 내용을 불러오고 있어요.</p>';
  const shown=checkpoint.results.filter(r=>draft.decisions[r.id]);
  const quiet=checkpoint.results.filter(r=>!draft.decisions[r.id]);
  const missing=shown.filter(r=>!draft.decisions[r.id].label);
  return `<h1>결과마다 내 판단을 골라주세요</h1><p class="lead">이유 칸에는 대화에서 내가 한 말이 그대로 들어 있어요. 고치면 고친 내용으로 기록되고, 처음 말도 함께 남아요.</p>${checkpoint.analysis_error?`<p class="error">${esc(checkpoint.analysis_error)}</p>`:''}<dl class="defs"><dt>보류</dt><dd>판단했어요. 다음에 다시 볼 후보로 남겨둘게요.</dd><dt>아직 모르겠어요</dt><dd>느낀 건 있지만 아직 정하지 못했어요.</dd></dl><div class="pair">${shown.map((r,i)=>{const d=draft.decisions[r.id], edited=d.reason!==r.original_text;return `<section class="result-check" ${i===0?'id="first-check"':''} aria-label="결과 ${r.label}"><div class="cap">${r.label}</div>${pic(r)}${options(r.id,d.label)}${!d.label?'<span class="warn">아직 고르지 않았어요</span>':''}<div><div class="field-label"><label for="reason-${r.id}">이유</label><span class="tag edited-tag" ${edited?'':'hidden'}>내가 고침</span></div><textarea id="reason-${r.id}" data-reason="${r.id}" rows="2">${esc(d.reason)}</textarea></div><div class="original" ${edited?'':'hidden'}><span>처음 한 말</span><p>${esc(r.original_text)}</p>${button('restore','처음 말로 되돌리기','link',`data-id="${r.id}"`)}</div></section>`;}).join('')}</div>${!shown.length?'<p class="empty">이번 라운드에 확인할 판단이 없어요. 이대로 기록하거나 대화로 돌아갈 수 있어요.</p>':''}${quiet.length?`<section class="quiet"><span class="spacer">대화에서 이야기하지 않은 결과</span>${quiet.map(r=>button('add-decision',`${r.label} 판단 적기`,'',`data-id="${r.id}"`)).join('')}</section>`:''}${draft.moves.map((m,i)=>`<section class="panel"><div class="bar"><h2>${i?'다음에 해볼 것 '+(i+1):'다음에 해볼 것'}</h2>${i?button('remove-move','지우기','ghost',`data-index="${i}"`):''}</div><label class="sr-only" for="move-${i}">다음에 해볼 것 ${i+1}</label><textarea id="move-${i}" data-move="${i}" rows="1">${esc(m.content)}</textarea><small>이 행동과 관련된 판단</small><div class="actions">${checkpoint.results.map(r=>{const d=draft.decisions[r.id];return button('link',d?.label?`<b>${r.label} ${names[d.label]}</b>${esc(d.reason.slice(0,45))}`:`${r.label}는 판단을 고르면 여기에 나와요`,'chip',`data-id="${r.id}" data-index="${i}" aria-pressed="${m.links.includes(r.id)}" ${d?.label?'':'disabled'}`);}).join('')}${checkpoint.previous.map(d=>button('link',`<b>라운드 ${d.number}의 ${d.result_label} ${names[draft.revisions[d.id]?.label||d.label]}</b>${esc((draft.revisions[d.id]?.reason??d.reason).slice(0,45))}`,'chip',`data-id="${d.id}" data-index="${i}" aria-pressed="${m.links.includes(d.id)}"`)).join('')}</div></section>`).join('')}${button('add-move','＋ 다음에 해볼 것 추가','ghost')}${checkpoint.previous.length?`<details class="panel" ${Object.keys(draft.revisions).length?'open':''}><summary>이전 라운드의 판단 다시 보기</summary><p class="muted">판단이 바뀌었다면 새 판단으로 남길 수 있어요. 처음 기록도 함께 남아요.</p>${checkpoint.previous.map(d=>`<section class="panel"><b>라운드 ${d.number}의 ${d.result_label} ${names[d.label]}</b><p class="say">${esc(d.reason)}</p>${draft.revisions[d.id]?`${options(d.id,draft.revisions[d.id].label,true)}<label for="revision-${d.id}">바뀐 이유</label><textarea id="revision-${d.id}" data-revision="${d.id}">${esc(draft.revisions[d.id].reason)}</textarea>${button('cancel-revision','바꾸지 않기','ghost',`data-id="${d.id}"`)}`:button('revise','판단 바꾸기','',`data-id="${d.id}"`)}</section>`).join('')}</details>`:''}<div class="record-actions">${button('reopen','대화로 돌아가기','',saving?'disabled':'')}<span class="warn" id="record-hint">${missing.length?`${missing.map(r=>r.label).join(', ')}에서 하나를 고르면 기록할 수 있어요. 아직 모르겠으면 그렇게 골라도 돼요.`:''}</span>${button('record',saving?'기록하는 중':'이대로 기록하기','primary',`aria-describedby="record-hint" ${missing.length||saving?'disabled':''}`)}</div><p id="record-error" class="error" role="alert"></p>`;
}
function openModal(html) { modalReturnFocus=document.activeElement;modal.innerHTML=`<div class="modal-body">${html}</div>`;modal.showModal(); }
modal.addEventListener('close',()=>modalReturnFocus?.isConnected&&modalReturnFocus.focus());
function practiceDone() { openModal(`<h1>연습을 마쳤어요</h1><p>이제 내 결과를 올리고 탐색을 시작할 수 있어요.<br>연습에서 한 말과 판단은 연구 기록에 들어가지 않아요.</p><div class="actions">${button('practice-again','연습 한 번 더 하기')}${button('start-real','라운드 1 시작','primary')}</div>`); }
async function showHistory() {
  historyData=await api('/history');
  const {rounds,decisions,moves,results:rs,move_decision_links:links}=historyData;
  openModal(`<div class="bar"><h1>탐색 과정 보기</h1>${button('close-modal','닫기')}</div><p class="muted">내가 확인하고 기록한 탐색이에요.</p><div class="history-list">${rounds.length?rounds.map(r=>`<section class="panel"><h2>라운드 ${r.number}</h2>${decisions.filter(d=>d.round_id===r.id&&!decisions.some(n=>n.previous_id===d.id&&n.version_reason==='checkpoint_correction')).map(d=>`<div><b>${esc(rs.find(x=>x.id===d.result_id)?.label)} ${names[d.label]}</b>${d.version_reason==='judgment_revision'?'<small> 판단이 바뀌었어요</small>':''}<p class="say">${esc(d.reason)}</p></div>`).join('')}${moves.filter(m=>m.round_id===r.id).map(m=>`<div><h3>다음에 해볼 것</h3><p class="say">${esc(m.content)}</p><small>${links.filter(l=>l.move_id===m.id).map(l=>{const d=decisions.find(d=>d.id===l.decision_id);const result=rs.find(x=>x.id===d?.result_id);return d?`${result?.label} ${names[d.label]}`:'';}).join(' / ')}</small></div>`).join('')}</section>`).join(''):'<p class="empty">아직 기록한 탐색이 없어요.</p>'}</div>${button('download-history','기록 내려받기')}`);
}
function downloadJSON(value,name) { const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function sendMessage(retry=null) {
  if(sending||!current)return;
  let pending=retry||readLocal(key('compose'),{text:''});
  const text=retry?.content??$('#message').value;
  if(!text.trim())return;
  const request=retry||{content:text,result_id:pending.request_id?pending.result_id:attached,request_id:pending.request_id||crypto.randomUUID()};
  if(!retry)writeLocal(key('compose'),{text,request_id:request.request_id,result_id:attached});
  sending=true;render();
  try {
    const response=await api(route('turn'),request);
    if(response.saved){removeLocal(key('compose'));lastReplyFailure=response.reply?null:request;}
    await refresh();
    sending=false;render();
    if(response.error)toast(response.error);else $('#message')?.focus();
  } catch(error) { sending=false;render();$('#send-error').textContent=error.message; }
}
function pickFiles(context=false) { const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=!context;input.addEventListener('change',()=>uploadFiles([...input.files],context));input.click(); }
function fileData(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('파일을 읽지 못했어요. 파일을 다시 골라주세요.'));reader.readAsDataURL(file);}); }
async function uploadFiles(files,context=false,retry=false) {
  if(uploadBusy||!files.length)return;
  if(!retry)pendingUploads=files.map(file=>({file,context,id:crypto.randomUUID()}));
  uploadBusy=true;uploadError='';render();
  try {
    for(const item of [...pendingUploads]) {
      if(!['image/png','image/jpeg','image/webp'].includes(item.file.type))throw new Error('JPG, PNG, WebP 이미지를 골라주세요.');
      if(item.file.size>8*1024*1024)throw new Error('이미지 한 장은 8MB 이하여야 해요. 크기를 줄여 다시 골라주세요.');
      const image=await fileData(item.file);
      if(!current){await api('/rounds',{is_practice:!state.practice_completed});await refresh();}
      await api(route('upload'),{image,is_context:item.context,request_id:item.id});
      pendingUploads=pendingUploads.filter(x=>x!==item);
    }
    await refresh();
  } catch(error) { uploadError=error.message; }
  finally {uploadBusy=false;render();}
}
function setupDrop() {
  const stage=$('#stage');if(!stage||current?.status==='checkpoint')return;
  stage.addEventListener('dragover',e=>{e.preventDefault();$('#drop-zone')?.classList.add('dragging');});
  stage.addEventListener('dragleave',()=>$('#drop-zone')?.classList.remove('dragging'));
  stage.addEventListener('drop',e=>{e.preventDefault();uploadFiles([...e.dataTransfer.files]);});
}
document.addEventListener('paste',e=>{
  if(!state||guide||modal.open||current?.status==='checkpoint'||e.target.matches('textarea,input'))return;
  const files=[...e.clipboardData.items].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile()).filter(Boolean);
  if(files.length){e.preventDefault();uploadFiles(files);}else toast('붙여넣은 내용에 이미지가 없어요. 이미지를 복사하거나 파일을 골라주세요.');
});
document.addEventListener('input',e=>{
  if(e.target.id==='message')writeLocal(key('compose'),{text:e.target.value});
  if(e.target.dataset.reason){const id=e.target.dataset.reason;draft.decisions[id].reason=e.target.value;draftSave();const section=e.target.closest('.result-check');const edited=e.target.value!==checkpoint.results.find(r=>r.id===id).original_text;$('.edited-tag',section).hidden=!edited;$('.original',section).hidden=!edited;}
  if(e.target.dataset.move!==undefined){draft.moves[+e.target.dataset.move].content=e.target.value;draftSave();}
  if(e.target.dataset.revision){draft.revisions[e.target.dataset.revision].reason=e.target.value;draftSave();}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='login'){e.preventDefault();const submit=$('button',e.target);submit.disabled=true;try{await api('/login',{code:$('#code').value});await boot();}catch(error){$('#login-error').textContent=error.message;submit.disabled=false;}}
  if(e.target.id==='compose'){e.preventDefault();await sendMessage();}
});
async function act(action,node) {
  const id=node.dataset.id,index=Number(node.dataset.index);
  switch(action){
    case 'upload':pickFiles();break;
    case 'upload-context':pickFiles(true);break;
    case 'retry-upload':await uploadFiles(pendingUploads.map(x=>x.file),false,true);break;
    case 'view':view=id;render();$('#attach-button')?.focus();break;
    case 'grid':view=null;render();$('#first-result')?.focus();break;
    case 'prev':case 'next':{const list=results();const i=list.findIndex(r=>r.id===view);view=list[i+(action==='next'?1:-1)]?.id||view;render();break;}
    case 'attach':attached=view;render();$('#message')?.focus();break;
    case 'detach':attached=null;render();$('#message')?.focus();break;
    case 'retry-reply':await sendMessage(lastReplyFailure);break;
    case 'checkpoint':
      if(readLocal(key('compose'),{text:''}).text.trim()){toast('아직 보내지 않은 말이 있어요. 먼저 보내주세요.');return;}
      node.disabled=true;try{await loadCheckpoint();await refresh();view=null;render();if(!state.checkpoint_seen&&checkpoint.results.some(r=>draft.decisions[r.id]))startGuide(true);}catch(e){node.disabled=false;throw e;}break;
    case 'reopen':await api(route('reopen'),{});await refresh();render();break;
    case 'label':draft.decisions[id].label=node.dataset.value;draftSave();render();$(`[data-action="label"][data-id="${id}"][data-value="${node.dataset.value}"]`)?.focus();break;
    case 'add-decision':{const r=checkpoint.results.find(r=>r.id===id);draft.decisions[id]={label:null,reason:r.original_text,original:r.original_text};draftSave();render();$(`#reason-${id}`)?.focus();break;}
    case 'restore':draft.decisions[id].reason=checkpoint.results.find(r=>r.id===id).original_text;draftSave();render();$(`#reason-${id}`)?.focus();break;
    case 'link':{const links=draft.moves[index].links;draft.moves[index].links=links.includes(id)?links.filter(x=>x!==id):[...links,id];draftSave();render();$(`[data-action="link"][data-id="${id}"][data-index="${index}"]`)?.focus();break;}
    case 'add-move':draft.moves.push({content:'',original_text:'',links:[]});draftSave();render();$(`#move-${draft.moves.length-1}`)?.focus();break;
    case 'remove-move':draft.moves.splice(index,1);draftSave();render();break;
    case 'revise':{const old=checkpoint.previous.find(d=>d.id===id);draft.revisions[id]={previous_id:id,label:old.label,reason:old.reason};draftSave();render();break;}
    case 'cancel-revision':delete draft.revisions[id];draftSave();render();break;
    case 'revision-label':draft.revisions[id].label=node.dataset.value;draftSave();render();break;
    case 'record':{
      if(saving)return;saving=true;render();const practice=current.is_practice;const draftKey=key('checkpoint');
      try{await api(route('record'),{decisions:Object.entries(draft.decisions).map(([result_id,d])=>({result_id,label:d.label,reason:d.reason})),moves:draft.moves,revisions:Object.values(draft.revisions)});removeLocal(draftKey);await refresh();checkpoint=null;draft=null;attached=null;lastReplyFailure=null;saving=false;render();if(practice)practiceDone();else toast(savedMessage());}
      catch(error){saving=false;render();$('#record-error').textContent=error.message;const retry=$('[data-action="record"]');retry.textContent='다시 기록하기';}break;
    }
    case 'start-real':modal.close();await api('/rounds',{is_practice:false});await refresh();view=null;render();break;
    case 'practice-again':modal.close();await api('/rounds',{is_practice:true});await refresh();view=null;render();break;
    case 'history':await showHistory();break;
    case 'download-history':downloadJSON(historyData,'companion-history.json');break;
    case 'close-modal':modal.close();break;
    case 'context':{const r=current.results.find(x=>x.is_context);openModal(`<div class="bar"><h2>생성 화면</h2>${button('close-modal','닫기')}</div>${pic(r)}<p class="muted">결과를 만든 맥락 자료예요.</p>`);break;}
    case 'guide':startGuide(current?.status==='checkpoint');break;
    case 'guide-next':if(guide.checkpoint||guide.step===4)await closeGuide();else{guide.step++;drawGuide();}break;
    case 'guide-close':await closeGuide();break;
    case 'logout':await api('/logout',{});state=null;current=null;renderLogin();break;
  }
}
document.addEventListener('click',e=>{const node=e.target.closest('[data-action]');if(node&&!node.disabled)act(node.dataset.action,node).catch(error=>toast(error.message));});
const coachSteps=[
  ['#upload-target','여기에 결과를 올려요','파일을 고르거나, 끌어다 놓거나, 복사한 이미지를 붙여넣을 수 있어요.'],
  ['#first-result','이미지를 누르면 크게 보여요','어떤 결과부터 볼지는 자유예요. 이미지를 눌러 살펴보세요.'],
  ['#attach-button','보던 결과를 대화에 붙여요','크게 보기에서 “보며 말하기”를 누르면 이 결과를 보며 말할 수 있어요.'],
  ['#compose','떠오른 그대로 적어요','보고 있는 결과에 대해 떠오른 말을 적고 보내기를 눌러요.'],
  ['#end-button','다 봤으면 라운드를 마쳐요','확인 화면에서 내 판단과 말을 살펴보고 기록해요.']
];
function startGuide(cp=false) {
  if(guide)return;
  if(!current){toast('결과를 올려 라운드를 시작하면 사용 안내를 볼 수 있어요.');return;}
  guideReturnFocus=document.activeElement;guideReturnView=view;guide={step:0,checkpoint:cp};drawGuide();
}
function drawGuide() {
  if(!guide)return;
  if(!guide.checkpoint){view=guide.step===2?results()[0]?.id:null;render();}
  const info=guide.checkpoint?['#first-check','결과마다 내 판단을 골라요','이유 칸에는 내가 한 말이 그대로 들어 있어요. 내용을 확인하고 내 판단을 골라요.']:coachSteps[guide.step];
  let target=$(info[0]);if(!target)target=$('#stage');
  target.scrollIntoView({block:'center',behavior:'instant'});
  $('#coach-root').innerHTML=`<div class="coach-shade" data-shade="top"></div><div class="coach-shade" data-shade="left"></div><div class="coach-shade" data-shade="right"></div><div class="coach-shade" data-shade="bottom"></div><div class="coach-ring"></div><section class="coach-card" role="dialog" aria-modal="true" aria-labelledby="coach-title"><div class="coach-dots" aria-label="${guide.checkpoint?'확인 화면 안내':`안내 ${guide.step+1} / 5`}">${Array.from({length:guide.checkpoint?1:5},(_,i)=>`<i class="${i===guide.step?'current':''}"></i>`).join('')}</div><h2 id="coach-title">${info[1]}</h2><p>${info[2]}</p><div class="actions">${button('guide-close','안내 건너뛰기','ghost')}${button('guide-next',guide.checkpoint?'확인했어요':guide.step===4?(current.is_practice?'연습 라운드 시작':'안내 마치기'):'다음','primary')}</div></section>`;
  app.inert=true;placeGuide();$('[data-action="guide-next"]')?.focus();
}
function placeGuide() {
  if(!guide)return;
  const selector=guide.checkpoint?'#first-check':coachSteps[guide.step][0];const target=$(selector)||$('#stage');if(!target)return;
  const r=target.getBoundingClientRect(), w=innerWidth,h=innerHeight,pad=4;
  const left=Math.max(4,r.left-pad),top=Math.max(4,r.top-pad),right=Math.min(w-4,r.right+pad),bottom=Math.min(h-4,r.bottom+pad);
  const rect=(node,x,y,width,height)=>Object.assign(node.style,{left:`${x}px`,top:`${y}px`,width:`${Math.max(0,width)}px`,height:`${Math.max(0,height)}px`});
  rect($('[data-shade="top"]'),0,0,w,top);rect($('[data-shade="bottom"]'),0,bottom,w,h-bottom);rect($('[data-shade="left"]'),0,top,left,bottom-top);rect($('[data-shade="right"]'),right,top,w-right,bottom-top);rect($('.coach-ring'),left,top,right-left,bottom-top);
  const card=$('.coach-card'),cw=card.offsetWidth,ch=card.offsetHeight;
  let x=right+16,y=top;if(x+cw>w-16){x=left-cw-16;if(x<16){x=Math.max(16,Math.min(w-cw-16,left));y=bottom+16;if(y+ch>h-16)y=top-ch-16;}}
  Object.assign(card.style,{left:`${Math.max(16,Math.min(w-cw-16,x))}px`,top:`${Math.max(16,Math.min(h-ch-16,y))}px`});
}
async function closeGuide() {
  if(!guide)return;const cp=guide.checkpoint;guide=null;$('#coach-root').innerHTML='';app.inert=false;view=guideReturnView;render();guideReturnFocus?.isConnected?guideReturnFocus.focus():$('[data-action="guide"]')?.focus();
  try{await api('/flags',{[cp?'checkpoint_seen':'intro_seen']:true});state[cp?'checkpoint_seen':'intro_seen']=1;}catch(error){toast(error.message);}
}
window.addEventListener('resize',placeGuide);window.addEventListener('scroll',placeGuide,{passive:true});
document.addEventListener('keydown',e=>{
  if(guide){if(e.key==='Escape'){e.preventDefault();closeGuide();}if(e.key==='Tab'){const buttons=[...$('.coach-card').querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}return;}
  if(e.target.matches('[role="radio"]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const group=[...e.target.parentElement.querySelectorAll('[role="radio"]')],i=group.indexOf(e.target);group[(i+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+group.length)%group.length].click();}
  if(e.key==='Escape'&&view&&!modal.open){view=null;render();}
});
boot().catch(error=>{app.innerHTML='<p class="loading">앱을 열지 못했어요. 새로고침해주세요.</p>';toast(error.message);});
