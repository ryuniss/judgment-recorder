const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {SELECT:'선택', HOLD:'보류', EXCLUDE:'제외', UNDECIDED:'아직 모르겠어요'};
const meanings = {SELECT:'이 방향으로 이어갈래요.', HOLD:'판단했어요. 다음에 다시 볼 후보로 남겨둘게요.', EXCLUDE:'이 방향은 이어가지 않을래요.', UNDECIDED:'느낀 건 있지만 아직 정하지 못했어요.'};
// A result's display name is independent from its nullable judgment label.
function ordinalName(index) {
  let name='';
  for(let n=index+1;n>0;n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name;
  return name;
}
function normalizeResultNames(rows) {
  const counts=new Map();
  for(const result of rows) {
    if(result.is_context){result.label='생성 화면';continue;}
    const index=counts.get(result.round_id)||0;
    result.label=ordinalName(index);counts.set(result.round_id,index+1);
  }
  return rows;
}
function previousRoundName(decision) { return decision.number == null ? '이전 연습' : `라운드 ${decision.number}`; }
function knownResult(id) { return state?.rounds.flatMap(r=>r.results).find(r=>r.id===id); }

const app = $('#app'), modal = $('#modal');
let state, current, config = {}, view = null, attached = null, checkpoint = null, draft = null, sending = false, saving = false, uploadBusy = false, uploadError = '', pendingUploads = [], toastTimer;
let sourceDraft=null,sourceCandidates=[],sourceSaving=false,mapNodes=new Map(),mapEdges=[],mapObserver=null;
let guide = null, guideReturnFocus = null, guideReturnView = null, modalReturnFocus = null, lastReplyFailure = null, historyData = null;
const key = type => type==='compose'&&state?.practice_completed&&!current?.is_practice?`companion-v2:${state.id}:canvas:${attached||'general'}:compose`:`companion-v2:${state?.id}:${current?.id}:${type}`;
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
  for(const round of state.rounds) normalizeResultNames(round.results);
  current = state.rounds.find(x => x.status !== 'recorded') || null;
  if (attached && !(current?.is_practice?results():state.rounds.filter(r=>!r.is_practice).flatMap(r=>r.results)).some(x => x.id === attached)) attached = null;
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
  document.body.classList.remove('redesign');
  app.innerHTML=`<header class="design-header"><b>탐색 기록</b><span>내 기준으로 이어가는 탐색</span></header><main class="entry design-entry"><section class="entry-card"><div><p class="entry-eyebrow">기준 · 이미지 · 판단</p><h1>나의 디자인 탐색 기록</h1><p class="muted">처음 기준을 적고, 탐색하며 달라진 생각을 남겨요.</p></div><form id="login"><label for="code">참여 코드</label><input id="code" name="code" type="password" autocomplete="off" maxlength="128" required placeholder="받은 참여 코드를 입력해주세요"><button class="primary" type="submit">탐색 열기</button><p id="login-error" class="error" role="alert"></p></form><p class="muted">처음이라면 컵 사진으로 한 번 연습해요.</p>${config.demo?'<small>화면 테스트용이에요. 실제 AI 대화가 아니에요.</small>':''}</section></main>`;
}
function header() {
  const recent=state.rounds.filter(x=>!x.is_practice).slice(-4);
  return `<header class="top"><div class="brand"><b>탐색 기록</b><span>연습 · 이미지와 대화</span></div><ol class="rounds" aria-label="라운드">${current?.is_practice?'<li class="practice" aria-current="step">연습 라운드</li>':recent.map(r=>`<li class="${r.id===current?.id?'now':''}" ${r.id===current?.id?'aria-current="step"':''}><span class="round-number">${r.number}</span>${r.status==='recorded'?'기록됨':r.status==='checkpoint'?'확인 중':'진행 중'}</li>`).join('')}</ol><span class="spacer"></span>${button('criterion','1순위 기준','ghost')}${button('guide','사용 안내','ghost')}${button('map','탐색 지도')}${button('history','기록 목록','ghost')}${button('logout','나가기','ghost')}</header>`;
}
function render() {
  if(!state) return;
  if(state.practice_completed&&!current?.is_practice){renderCanvasApp();return;}
  document.body.classList.remove('redesign');
  app.innerHTML=`${config.demo?'<div class="notice" role="note">화면 테스트 · 정해진 대화 응답을 사용해요. 실제 AI 대화가 아니에요.</div>':''}<div class="app">${header()}<div class="body"><main class="stage" id="stage"><div class="workspace-heading"><b>${current?.status==='checkpoint'?'라운드 확인':'이미지 작업대'}</b><span>${current?.status==='checkpoint'?'내 판단으로 남기기':'결과를 올리고 살펴보는 곳'}</span></div>${!current?.is_practice?`<div class="criterion-strip"><span><b>1순위 기준</b> ${state.card?.priority?esc(state.card.priority):'아직 적지 않았어요.'}</span>${button('criterion',state.card?.priority?'고치기':'적기','ghost')}</div>`:''}${current?.status==='checkpoint'?checkpointHTML():stageHTML()}</main><aside class="side" aria-label="대화">${chatHTML()}</aside></div></div>`;
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
  return `${banner}${!current&&savedMessage()?`<div class="banner" role="status"><p>${savedMessage()}</p></div>`:''}<div class="bar"><span>${list.length?`${current?.is_practice?'연습용':'올린'} 결과 ${list.length}개`:'새 결과를 올려주세요'}</span><div class="actions">${current?.results.some(x=>x.is_context)?button('context','생성 화면 보기'):''}${current&&!current.is_practice&&current.number>1&&list.length?button('sources','이전 시도 연결','ghost'):''}${button('upload','이미지 더 올리기','','id="upload-target" '+(uploadBusy?'disabled':''))}</div></div>${list.length?`<div class="grid">${list.map((r,i)=>`<button type="button" class="tile ${attached===r.id?'attached':''}" data-action="view" data-id="${r.id}" ${i===0?'id="first-result"':''} aria-label="${r.label} 크게 보기"><div class="cap"><span>${r.label}</span>${attached===r.id?'<small>대화에 붙음</small>':''}</div>${pic(r)}</button>`).join('')}</div>`:`<section class="upload" id="drop-zone"><span class="upload-icon" aria-hidden="true">＋</span><h1>보고 싶은 결과를 올려주세요</h1><p>파일을 끌어다 놓거나, 복사한 이미지를 붙여넣어요.<br>JPG · PNG · WebP / 한 장에 8MB까지</p>${button('upload','파일 고르기','primary',uploadBusy?'disabled':'')}</section>`}<div class="error" role="status">${esc(status)}${uploadError&&pendingUploads.length?button('retry-upload','다시 올리기'):''}</div><div class="context"><span class="muted">(선택) 생성 화면 전체 캡처<br><small>결과를 만든 맥락을 함께 남겨요.</small></span>${button('upload-context','생성 화면 올리기','ghost',uploadBusy?'disabled':'')}</div>`;
}
function chatHTML() {
  const cp=current?.status==='checkpoint';
  const turns=(current?.turns||[]).filter(x=>!cp||x.role==='user');
  const list=results();
  return `${cp?'<div class="readonly"><b>이번 라운드에서 한 말</b><span class="muted">읽기만 가능</span></div>':'<div class="chat-heading"><b>대화</b><span>보고 있는 결과에 대해 말하는 곳</span></div>'}<div class="log" aria-live="polite">${!cp?`<div class="divider">${current?roundTitle(current)+' 시작':'탐색 기록'}</div>`:''}${turns.map(t=>t.role==='user'?`<div class="message">${t.result_id?`<span class="tag">${esc(list.find(x=>x.id===t.result_id)?.label||'결과')}를 보며</span>`:''}<p class="say">${esc(t.content)}</p></div>`:`<p class="ai">${esc(t.content)}</p>`).join('')}${!turns.length?`<p class="ai muted">${cp?'이번 라운드에는 대화가 없어요.':'보이는 대로, 떠오른 그대로 말해보세요.'}</p>`:''}${sending?'<p class="ai" role="status">답을 쓰고 있어요.</p>':''}${lastReplyFailure&&!cp?`<div class="panel"><p class="error">말은 저장됐지만 답을 받지 못했어요.</p>${button('retry-reply','다시 답 받기')}</div>`:''}</div>${cp?'<p class="readonly-note">기록하면 다음 라운드 대화를 이어갈 수 있어요.</p>':`<form class="compose" id="compose">${attached?`<div class="attachment">${esc(list.find(x=>x.id===attached)?.label)}를 보며${button('detach','×','','aria-label="붙이기 해제"')}</div>`:''}<label class="sr-only" for="message">하고 싶은 말</label><textarea id="message" rows="3" placeholder="보면서 떠오른 걸 그대로 적어주세요" ${sending?'readonly':''}></textarea><div class="row"><small>이미지를 누르면 크게 보고 붙일 수 있어요</small><button type="submit" class="primary" ${!current||sending?'disabled':''}>${sending?'보내는 중':'보내기'}</button></div><p id="send-error" class="error" role="alert"></p></form>${button('checkpoint',current?.is_practice?'연습 마치고 확인하기':'라운드 마치고 확인하기','end','id="end-button" '+(!current||sending?'disabled':''))}`}`;
}
function options(id, value, revision=false) { return `<div role="radiogroup" aria-label="${esc(checkpoint?.results.find(r=>r.id===id)?.label || checkpoint?.previous.find(r=>r.id===id)?.result_label || '결과')}에 대한 내 판단" class="opts">${Object.entries(names).map(([v,n])=>button(revision?'revision-label':'label',n,'opt',`role="radio" aria-checked="${value===v}" data-id="${esc(id)}" data-value="${v}"`)).join('')}</div>`; }
function draftSave() { if(draft) writeLocal(key('checkpoint'),draft); }
async function loadCheckpoint() {
  checkpoint=await api(route('checkpoint'),{});
  // The unchanged API returns label=null to mean an unchosen judgment.
  // Restore display names from the authoritative upload order, not that field.
  const ordered=results();
  const order=new Map(ordered.map((r,i)=>[r.id,i]));
  checkpoint.results.sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER));
  checkpoint.results.forEach((r,i)=>{r.label=knownResult(r.id)?.label||ordinalName(i);});
  checkpoint.previous.forEach(d=>{d.result_label=knownResult(d.result_id)?.label||'결과';});

  const stored=readLocal(key('checkpoint'),null);
  draft=stored||{decisions:{},moves:[],revisions:{}};
  for(const r of checkpoint.results) {
    if(r.judgment&&!draft.decisions[r.id])draft.decisions[r.id]={label:r.judgment.label,reason:r.judgment.reason,original:r.original_text};
    if(r.discussed&&!draft.decisions[r.id]) draft.decisions[r.id]={label:null,reason:r.original_text};
    // A resumed conversation may have new words; update only reasons the student has not edited.
    const d=draft.decisions[r.id];
    if(d && d.original!==undefined && d.reason===d.original) d.reason=r.original_text;
    if(d) d.original=r.original_text;
  }
  if(!stored && checkpoint.moves?.length) draft.moves=checkpoint.moves;
  if(!draft.moves.length) draft.moves=[{content:'',original_text:'',links:[]}];
  draft.ui ||= {step:1,focusId:null};
  if(!checkpoint.results.some(r=>r.id===draft.ui.focusId)) draft.ui.focusId=checkpoint.results.find(r=>r.discussed)?.id||checkpoint.results[0]?.id||null;
  if(checkpoint.results.some(r=>r.discussed&&!names[draft.decisions[r.id]?.label])) draft.ui.step=1;
  draftSave();
}
function chosenResults() { return checkpoint.results.filter(r=>names[draft.decisions[r.id]?.label]); }
function decisionFor(result) {
  return draft.decisions[result.id] ||= {label:null,reason:result.original_text,original:result.original_text};
}
function checkpointStepper() {
  const second=draft.ui.step===2;
  return `<ol class="stepper" aria-label="확인 단계"><li class="${second?'done':'current'}" ${second?'':'aria-current="step"'}><span>1</span>결과마다 판단</li><li class="step-line" aria-hidden="true"></li><li class="${second?'current':''}" ${second?'aria-current="step"':''}><span>2</span>다음에 해볼 것</li></ol>`;
}
function checkpointPick(result) {
  const choice=draft.decisions[result.id]?.label;
  return button('checkpoint-result',`${pic(result)}<span>${result.label}<small class="${choice?'chosen':''}">${names[choice]||(result.discussed?'아직':'')}</small></span>`,'result-pick '+(result.discussed?'':'optional'),`data-id="${result.id}" aria-current="${draft.ui.focusId===result.id}" aria-label="결과 ${result.label}${draft.ui.focusId===result.id?' 보는 중':''}"`);
}
function focusResultHTML(result) {
  const d=draft.decisions[result.id]||{label:null,reason:result.original_text};
  const edited=d.reason!==result.original_text,index=checkpoint.results.indexOf(result);
  const prev=checkpoint.results[index-1],next=checkpoint.results[index+1];
  return `<section class="result-check checkpoint-focus" aria-labelledby="focus-name">${pic(result)}<div class="focus-column"><h2 id="focus-name">${result.label}</h2><div><div class="field-label"><label for="reason-${result.id}">${result.label}를 보며 내가 한 말</label><span class="tag edited-tag" ${edited?'':'hidden'}>내가 고침</span></div><textarea id="reason-${result.id}" data-reason="${result.id}" rows="2">${esc(d.reason)}</textarea><p class="hint">이 말이 판단의 이유로 남아요. 고치면 처음 한 말도 함께 남아요.</p></div><div class="original" ${edited?'':'hidden'}><span>처음 한 말</span><p>${esc(result.original_text)}</p>${button('restore','처음 말로 되돌리기','link',`data-id="${result.id}"`)}</div><div><p class="field-label" id="judgment-question">${result.label}에 대한 내 판단</p><div id="checkpoint-choices" role="radiogroup" aria-labelledby="judgment-question" class="judgment-choices">${Object.entries(names).map(([value,name])=>button('label',`<b>${name}</b><span>${meanings[value]}</span>`,'choice',`role="radio" aria-label="${name}" aria-checked="${d.label===value}" data-id="${result.id}" data-value="${value}"`)).join('')}</div></div><div class="result-nav">${prev?button('checkpoint-result',`← ${prev.label}`,'',`data-id="${prev.id}"`):'<span></span>'}${next?button('checkpoint-result',`${next.label} 보기 →`,'',`data-id="${next.id}"`):'<span></span>'}</div></div></section>`;
}
function judgmentsHTML() {
  const talked=checkpoint.results.filter(r=>r.discussed),quiet=checkpoint.results.filter(r=>!r.discussed);
  const completed=talked.filter(r=>names[draft.decisions[r.id]?.label]).length;
  const active=checkpoint.results.find(r=>r.id===draft.ui.focusId);
  return `<h1 id="checkpoint-heading" tabindex="-1">대화에서 이야기한 결과마다 내 판단을 골라요</h1><div class="result-picks">${talked.length?`<section class="pick-group" aria-label="이야기한 결과"><h2>이야기한 결과</h2><div class="pick-row">${talked.map(checkpointPick).join('')}</div></section>`:''}${quiet.length?`<section class="pick-group" aria-label="이야기하지 않은 결과"><h2>이야기하지 않은 결과 (골라도 되고 안 골라도 돼요)</h2><div class="pick-row">${quiet.map(checkpointPick).join('')}</div></section>`:''}</div>${active?focusResultHTML(active):'<p class="empty">이번 라운드에 확인할 결과가 없어요. 이대로 다음으로 가거나 대화로 돌아갈 수 있어요.</p>'}<div class="checkpoint-footer"><span id="checkpoint-progress" role="status">이야기한 결과 ${talked.length}개 중 ${completed}개 골랐어요</span>${button('checkpoint-next','다음: 해볼 것 정하기','primary',`aria-describedby="checkpoint-progress" ${completed<talked.length?'disabled':''}`)}</div>${button('reopen','대화로 돌아가기','ghost checkpoint-return')}`;
}
function previousRevisionsHTML() {
  if(!checkpoint.previous.length)return '';
  return `<details class="panel" ${Object.keys(draft.revisions).length?'open':''}><summary>이전 라운드의 판단 다시 보기</summary><p class="muted">판단이 바뀌었다면 새 판단으로 남길 수 있어요. 처음 기록도 함께 남아요.</p>${checkpoint.previous.map(d=>`<section class="panel"><b>${previousRoundName(d)}의 ${d.result_label} ${names[d.label]||'판단'}</b><p class="say">${esc(d.reason)}</p>${draft.revisions[d.id]?`${options(d.id,draft.revisions[d.id].label,true)}<label for="revision-${d.id}">바뀐 이유</label><textarea id="revision-${d.id}" data-revision="${d.id}">${esc(draft.revisions[d.id].reason)}</textarea>${button('cancel-revision','바꾸지 않기','ghost',`data-id="${d.id}"`)}`:button('revise','판단 바꾸기','',`data-id="${d.id}"`)}</section>`).join('')}</details>`;
}
function movesHTML() {
  const chosen=chosenResults();
  const missing=checkpoint.results.some(r=>r.discussed&&!names[draft.decisions[r.id]?.label]);
  return `<h1 id="checkpoint-heading" tabindex="-1">다음 라운드에서 해볼 것을 적어요</h1>${checkpoint.analysis_error?`<p class="error">${esc(checkpoint.analysis_error)}</p>`:''}<section class="panel" aria-labelledby="judgment-summary"><h2 id="judgment-summary" class="summary-heading">이번 라운드에서 고른 판단</h2><ul class="judgment-summary">${chosen.map(r=>{const d=draft.decisions[r.id];return `<li>${pic(r)}<b>${r.label}</b><span class="judgment-tag">${names[d.label]}</span><span class="summary-reason">${esc(d.reason)}</span>${button('edit-judgment','고치기','link',`data-id="${r.id}" aria-label="${r.label} 판단 고치기"`)}</li>`;}).join('')}</ul>${chosen.length?'':'<p class="muted">이번 라운드에서 고른 판단이 없어요.</p>'}</section>${draft.moves.map((m,i)=>`<section class="panel move-block"><div class="bar"><h2><label for="move-${i}">해볼 것${i?' '+(i+1):''}</label></h2>${i?button('remove-move','지우기','ghost',`data-index="${i}" aria-label="해볼 것 ${i+1} 지우기"`):''}</div><textarea id="move-${i}" data-move="${i}" rows="2">${esc(m.content)}</textarea>${m.original_text?'<p class="hint">대화에서 한 말을 넣어뒀어요. 고쳐도 되고, 지우고 새로 적어도 돼요.</p>':''}<p class="field-label">이 생각과 이어지는 판단을 골라요 (여러 개 골라도 돼요)</p><div class="actions">${chosen.map(r=>{const d=draft.decisions[r.id];return button('link',`<b>${r.label} ${names[d.label]}</b>${esc(d.reason.slice(0,45))}`,'chip',`data-id="${r.id}" data-index="${i}" aria-pressed="${m.links.includes(r.id)}"`);}).join('')}${checkpoint.previous.filter(d=>names[draft.revisions[d.id]?.label||d.label]).map(d=>button('link',`<b>${previousRoundName(d)}의 ${d.result_label} ${names[draft.revisions[d.id]?.label||d.label]}</b>${esc((draft.revisions[d.id]?.reason??d.reason).slice(0,45))}`,'chip',`data-id="${d.id}" data-index="${i}" aria-pressed="${m.links.includes(d.id)}"`)).join('')}</div></section>`).join('')}${button('add-move','해볼 것 하나 더 적기','add-move')}${previousRevisionsHTML()}<div class="checkpoint-footer">${button('checkpoint-back','← 판단으로 돌아가기','',saving?'disabled':'')}${button('record',saving?'기록하는 중':'이대로 기록하기','primary',missing||saving?'disabled':'')}</div><p id="record-error" class="error" role="alert"></p>`;
}
function checkpointHTML() {
  if(!checkpoint||!draft)return '<p>확인 내용을 불러오고 있어요.</p>';
  return checkpointStepper()+(draft.ui.step===2?movesHTML():judgmentsHTML());
}
function checkpointStage(step,focusId) {
  draft.ui.step=step;
  if(focusId)draft.ui.focusId=focusId;
  draftSave();render();
  $('#checkpoint-heading')?.focus({preventScroll:true});$('#stage')?.scrollIntoView({block:'start',behavior:'instant'});
}
function openModal(html) { mapObserver?.disconnect();modal.classList.remove('map-modal','source-modal','lineage-modal','criteria-modal');if(!modal.open)modalReturnFocus=document.activeElement;modal.innerHTML=`<div class="modal-body">${html}</div>`;if(!modal.open)modal.showModal(); }
modal.addEventListener('close',()=>{mapObserver?.disconnect();modalReturnFocus?.isConnected&&modalReturnFocus.focus();});
modal.addEventListener('cancel',event=>{if(sourceSaving||lineageBusy||criteriaBusy)event.preventDefault();});
function practiceDone() { openModal(`<h1>연습을 마쳤어요</h1><p>이제 내 결과를 올리고 탐색을 시작할 수 있어요.<br>연습에서 한 말과 판단은 연구 기록에 들어가지 않아요.</p><div class="actions">${button('practice-again','연습 한 번 더 하기')}${button('start-real','라운드 1 시작','primary')}</div>`); }
async function showHistory() {
  historyData=await api('/history');
  normalizeResultNames(historyData.results);
  const {rounds,decisions,moves,results:rs,move_decision_links:links}=historyData;
  openModal(`<div class="bar"><h1>탐색 과정 보기</h1>${button('close-modal','닫기')}</div><p class="muted">내가 확인하고 기록한 탐색이에요.</p><div class="history-list">${rounds.length?rounds.map(r=>`<section class="panel"><h2>라운드 ${r.number}</h2>${decisions.filter(d=>d.round_id===r.id&&!decisions.some(n=>n.previous_id===d.id&&n.version_reason==='checkpoint_correction')).map(d=>`<div><b>${esc(rs.find(x=>x.id===d.result_id)?.label)} ${names[d.label]}</b>${d.version_reason==='judgment_revision'?'<small> 판단이 바뀌었어요</small>':''}<p class="say">${esc(d.reason)}</p></div>`).join('')}${moves.filter(m=>m.round_id===r.id).map(m=>`<div><h3>다음에 해볼 것</h3><p class="say">${esc(m.content)}</p><small>${links.filter(l=>l.move_id===m.id).map(l=>{const d=decisions.find(d=>d.id===l.decision_id);const result=rs.find(x=>x.id===d?.result_id);return d?`${result?.label} ${names[d.label]}`:'';}).join(' / ')}</small></div>`).join('')}</section>`).join(''):'<p class="empty">아직 기록한 탐색이 없어요.</p>'}</div>${button('download-history','기록 내려받기')}`);
}
async function showSources(ids,automatic=false) {
  if(!current||current.is_practice||current.status!=='active')return;
  const history=await api('/history');
  const eligible=new Map(history.rounds.filter(r=>r.number<current.number).map(r=>[r.id,r]));
  sourceCandidates=history.moves.filter(m=>m.status==='student_confirmed'&&eligible.has(m.round_id)).map(m=>({...m,number:eligible.get(m.round_id).number}));
  if(!sourceCandidates.length){if(!automatic)toast('이전 라운드에 기록한 해볼 것이 아직 없어요.');return;}
  const targets=results().filter(r=>ids.includes(r.id));
  sourceDraft=Object.fromEntries(targets.map(r=>[r.id,[...(r.source_move_ids||[])]]));sourceSaving=false;
  openModal(`<div class="bar"><div><p class="eyebrow">라운드 ${current.number} · 결과 연결</p><h1>어떤 시도에서 이어진 결과인가요?</h1></div></div><p class="muted">이전 라운드에서 적은 해볼 것과 연결할 수 있어요. 여러 개를 고르거나 건너뛰어도 돼요.</p><div class="source-results">${targets.map(r=>`<section class="source-result"><div class="source-image">${pic(r)}<b>결과 ${r.label}</b></div><div class="source-options">${sourceCandidates.map(m=>button('source-toggle',`<small>라운드 ${m.number}에서 해볼 것</small><span>${esc(m.content)}</span>`,'source-choice',`data-result="${r.id}" data-id="${m.id}" aria-pressed="${sourceDraft[r.id].includes(m.id)}"`)).join('')}</div></section>`).join('')}</div><p id="source-error" class="error" role="alert"></p><div class="source-footer">${button('source-skip',automatic?'이번에는 건너뛰기':'닫기')}${button('source-save','선택한 연결 저장','primary')}</div>`);
  modal.classList.add('source-modal');
}
async function saveSources() {
  if(sourceSaving||!sourceDraft)return;sourceSaving=true;
  modal.querySelectorAll('button').forEach(b=>b.disabled=true);
  try {
    await api(route('sources'),{results:Object.entries(sourceDraft).map(([result_id,move_ids])=>({result_id,move_ids}))});
    await refresh();sourceSaving=false;modal.close();render();toast('내가 고른 연결을 저장했어요. 라운드를 기록하면 탐색 지도에 보여요.');
  } catch(error) {sourceSaving=false;modal.querySelectorAll('button').forEach(b=>b.disabled=false);$('#source-error').textContent=error.message;}
}
let selectedMapId=null;
function mapNode(kind,row,round,result) {
  const id=kind+'-'+row.id;
  const title=kind==='result'?`결과 ${row.label}`:kind==='decision'?`${result?.label||'결과'} ${names[row.label]||'판단'}`:'다음에 해볼 것';
  mapNodes.set(id,{id,kind,row,round,result,title});
  return button('map-node',`<span class="node-kind">${kind==='result'?'결과':kind==='decision'?(row.version_reason==='judgment_revision'?'바뀐 판단':'내 판단'):'다음 시도'}</span>${kind==='result'?pic(row):''}<b>${esc(title)}</b>${kind!=='result'?`<span class="node-quote">${esc(kind==='decision'?row.reason:row.content)}</span>`:''}`,'map-node node-'+kind,`data-id="${id}" aria-label="라운드 ${round.number} ${esc(title)} 상세 보기" aria-pressed="false"`);
}
async function showMap() {
  historyData=await api('/history');normalizeResultNames(historyData.results);
  const {rounds,results:rs,decisions,moves,move_decision_links:links}=historyData;
  const ds=decisions.filter(d=>!decisions.some(n=>n.previous_id===d.id&&n.version_reason==='checkpoint_correction'));
  mapNodes=new Map();mapEdges=[];selectedMapId=null;
  const columns=rounds.map(round=>{
    const roundResults=rs.filter(r=>r.round_id===round.id&&!r.is_context);
    const judgments=ds.filter(d=>d.round_id===round.id);
    return `<section class="map-round" id="map-round-${round.id}" aria-label="라운드 ${round.number}"><header><span class="round-number">${round.number}</span><h2>라운드 ${round.number}</h2><span class="muted">기록됨</span></header><div class="map-result-rows">${roundResults.map(r=>`<div class="map-pair">${mapNode('result',r,round,r)}<div class="map-decisions">${judgments.filter(d=>d.result_id===r.id).map(d=>mapNode('decision',d,round,r)).join('')}</div></div>`).join('')}${judgments.filter(d=>!roundResults.some(r=>r.id===d.result_id)).map(d=>`<div class="map-revision">${mapNode('decision',d,round,rs.find(r=>r.id===d.result_id))}</div>`).join('')}</div><div class="map-moves">${moves.filter(m=>m.round_id===round.id).map(m=>mapNode('move',m,round)).join('')}</div>${roundResults.length||judgments.length||moves.some(m=>m.round_id===round.id)?'':'<p class="muted">이 라운드는 기록만 남겼어요.</p>'}</section>`;
  }).join('');
  const edge=(from,to,kind)=>{if(mapNodes.has(from)&&mapNodes.has(to))mapEdges.push({from,to,kind});};
  for(const d of ds){edge('result-'+d.result_id,'decision-'+d.id,'judgment');if(d.previous_id)edge('decision-'+d.previous_id,'decision-'+d.id,'revision');}
  for(const link of links)edge('decision-'+link.decision_id,'move-'+link.move_id,'intent');
  for(const link of historyData.result_move_links||[])edge('move-'+link.move_id,'result-'+link.result_id,'continuation');
  openModal(`<div class="bar"><div><p class="eyebrow">내가 이어 온 생각</p><h1>탐색 지도</h1></div><div class="actions">${button('history','기록 목록')}${button('download-history','기록 내려받기','ghost')}${button('close-modal','닫기')}</div></div><p class="map-intro">결과에서 판단으로, 판단에서 다음 시도로 이어져요. 노드를 누르면 이미지와 당시의 말을 볼 수 있어요.</p>${rounds.length?`<div class="map-legend"><span>결과 → 내 판단 → 다음 시도 → 새 결과</span><small>확정한 기록과 내가 고른 연결만 보여요.</small></div><nav class="map-round-nav" aria-label="라운드로 이동">${rounds.map(r=>button('map-round',`라운드 ${r.number}`,'ghost',`data-id="${r.id}"`)).join('')}</nav><div class="map-layout"><div class="map-scroll" tabindex="0" role="region" aria-label="탐색 지도. 가로로 스크롤해 다음 라운드를 볼 수 있어요."><div class="map-canvas"><svg class="map-lines" aria-hidden="true"></svg><div class="map-columns">${columns}</div></div></div><aside class="map-detail" aria-label="선택한 노드의 내용" aria-live="polite"><h2>기록을 살펴보세요</h2><p>결과, 판단, 다음 시도를 누르면 원문과 연결을 볼 수 있어요.</p></aside></div>`:'<section class="map-empty"><h2>탐색이 이어지면 여기에 보여요</h2><p>라운드를 기록하면 결과와 내 판단, 다음 시도가 지도에 남아요.<br>새 결과를 올릴 때 이전 시도와 연결할 수 있어요.</p>'+button('close-modal','작업으로 돌아가기','primary')+'</section>'}`);
  modal.classList.add('map-modal');
  if(rounds.length){requestAnimationFrame(drawMapEdges);if(typeof ResizeObserver!=='undefined'){mapObserver=new ResizeObserver(drawMapEdges);mapObserver.observe($('.map-canvas'));}document.fonts?.ready.then(()=>{if(modal.classList.contains('map-modal'))drawMapEdges();});}
}
function drawMapEdges() {
  const canvas=$('.map-canvas'),svg=$('.map-lines');if(!canvas||!svg)return;
  const bounds=canvas.getBoundingClientRect();svg.setAttribute('width',String(canvas.scrollWidth));svg.setAttribute('height',String(canvas.scrollHeight));
  svg.innerHTML='<defs><marker id="map-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#6e7569"/></marker></defs>';
  for(const edge of mapEdges){
    const from=$(`.map-node[data-id="${edge.from}"]`),to=$(`.map-node[data-id="${edge.to}"]`);if(!from||!to)continue;
    const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();let x1=a.right-bounds.left,y1=a.top+a.height/2-bounds.top,x2=b.left-bounds.left,y2=b.top+b.height/2-bounds.top;
    let path;
    if(edge.kind==='intent'&&Math.abs(a.left-b.left)<400&&b.top>a.bottom){x1=a.left+a.width/2-bounds.left;y1=a.bottom-bounds.top;x2=b.left+b.width/2-bounds.left;y2=b.top-bounds.top;const mid=(y1+y2)/2;path=`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;}
    else{const bend=Math.max(24,Math.abs(x2-x1)*.45);path=`M${x1},${y1} C${x1+bend},${y1} ${x2-bend},${y2} ${x2},${y2}`;}
    const element=document.createElementNS('http://www.w3.org/2000/svg','path');element.setAttribute('d',path);element.setAttribute('class','map-edge edge-'+edge.kind);element.setAttribute('marker-end','url(#map-arrow)');element.dataset.from=edge.from;element.dataset.to=edge.to;svg.appendChild(element);
  }
  highlightMap();
}
function highlightMap() {
  const connected=new Set([selectedMapId]);for(const e of mapEdges)if(e.from===selectedMapId||e.to===selectedMapId){connected.add(e.from);connected.add(e.to);}
  modal.querySelectorAll('.map-node').forEach(n=>{n.classList.toggle('map-dim',!!selectedMapId&&!connected.has(n.dataset.id));n.classList.toggle('selected',n.dataset.id===selectedMapId);n.setAttribute('aria-pressed',String(n.dataset.id===selectedMapId));});
  modal.querySelectorAll('.map-edge').forEach(e=>{e.classList.toggle('map-dim',!!selectedMapId&&e.dataset.from!==selectedMapId&&e.dataset.to!==selectedMapId);e.classList.toggle('highlight',e.dataset.from===selectedMapId||e.dataset.to===selectedMapId);});
}
function selectMapNode(id) {
  selectedMapId=id;highlightMap();const node=mapNodes.get(id),detail=$('.map-detail');if(!detail)return;
  if(!node){detail.innerHTML='<h2>기록을 살펴보세요</h2><p>결과, 판단, 다음 시도를 누르면 원문과 연결을 볼 수 있어요.</p>';return;}
  const incoming=mapEdges.filter(e=>e.to===id),outgoing=mapEdges.filter(e=>e.from===id);
  const list=(edges,inbound)=>edges.length?`<ul class="map-related">${edges.map(e=>{const n=mapNodes.get(inbound?e.from:e.to);return `<li>${button('map-node',`<small>라운드 ${n.round.number}</small><span>${esc(n.title)}</span>`,'',`data-id="${n.id}"`)}</li>`;}).join('')}</ul>`:'<p class="muted">연결한 기록이 없어요.</p>';
  detail.innerHTML=`<p class="eyebrow">라운드 ${node.round.number}</p><h2>${esc(node.title)}</h2>${node.kind==='result'?pic(node.row):`<p class="map-original">${esc(node.kind==='decision'?node.row.reason:node.row.content)}</p>`}${node.kind==='decision'&&node.row.reason!==node.row.original_text?`<details><summary>처음 한 말</summary><p class="map-original">${esc(node.row.original_text)}</p></details>`:''}<h3>이 기록으로 이어진 것</h3>${list(incoming,true)}<h3>이 기록에서 이어간 것</h3>${list(outgoing,false)}${button('map-clear','전체 연결 보기','ghost')}`;
}

function downloadJSON(value,name) { const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function sendMessage(retry=null) {
  if(sending)return;
  if(!current&&state.practice_completed){try{await api('/rounds',{is_practice:false});await refresh();}catch(error){toast(error.message);return;}}
  if(!current)return;
  let pending=retry||readLocal(key('compose'),{text:''});
  const text=retry?.content??$('#message').value;
  if(!text.trim())return;
  const request=retry||{content:text,result_id:pending.request_id?pending.result_id:attached,request_id:pending.request_id||crypto.randomUUID(),response_to:pending.request_id?pending.response_to:responseTo};
  const composeKey=retry&&state.practice_completed&&!current.is_practice?`companion-v2:${state.id}:canvas:${retry.result_id||'general'}:compose`:key('compose');
  if(!retry)writeLocal(composeKey,{text,request_id:request.request_id,result_id:attached,response_to:request.response_to});
  sending=true;render();
  try {
    const response=await api(route('turn'),request);
    if(response.saved){if(readLocal(composeKey,{}).text===request.content)removeLocal(composeKey);lastReplyFailure=response.reply?null:request;responseTo=null;}
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
  const uploaded=[];
  uploadBusy=true;uploadError='';render();
  try {
    for(const item of [...pendingUploads]) {
      if(!['image/png','image/jpeg','image/webp'].includes(item.file.type))throw new Error('JPG, PNG, WebP 이미지를 골라주세요.');
      if(item.file.size>8*1024*1024)throw new Error('이미지 한 장은 8MB 이하여야 해요. 크기를 줄여 다시 골라주세요.');
      const image=await fileData(item.file);
      if(!current){await api('/rounds',{is_practice:!state.practice_completed});await refresh();}
      const saved=await api(route('upload'),{image,is_context:item.context,request_id:item.id});
      if(!item.context)uploaded.push(saved.id);
      pendingUploads=pendingUploads.filter(x=>x!==item);
    }
    await refresh();
  } catch(error) { uploadError=error.message; }
  finally {uploadBusy=false;render();}
  if(uploaded.length&&current&&!current.is_practice){attached=uploaded.at(-1);render();try{await showLineage(uploaded);}catch(error){toast('이미지는 올렸어요. 출처는 이미지의 고치기에서 다시 고를 수 있어요. '+error.message);}}
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
  if(e.target.dataset.reason){const id=e.target.dataset.reason;decisionFor(checkpoint.results.find(r=>r.id===id)).reason=e.target.value;draftSave();const section=e.target.closest('.result-check');const edited=e.target.value!==checkpoint.results.find(r=>r.id===id).original_text;$('.edited-tag',section).hidden=!edited;$('.original',section).hidden=!edited;}
  if(e.target.dataset.move!==undefined){draft.moves[+e.target.dataset.move].content=e.target.value;draftSave();}
  if(e.target.dataset.revision){draft.revisions[e.target.dataset.revision].reason=e.target.value;draftSave();}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='login'){e.preventDefault();const submit=$('button',e.target);submit.disabled=true;try{await api('/login',{code:$('#code').value});await boot();}catch(error){$('#login-error').textContent=error.message;submit.disabled=false;}}
  if(e.target.id==='compose'){e.preventDefault();await sendMessage();}
});
async function act(action,node) {
  if(/^(record-|note-|question-skip)/.test(action)){await recordsAction(action,node);return;}
  const id=node.dataset.id,index=Number(node.dataset.index);
  if(action.startsWith('criterion-')){await criterionAction(action,node);return;}
  if(/^(canvas-|lineage-|card-)/.test(action)){await canvasAction(action,node);return;}
  switch(action){
    case 'criterion':if(state.practice_completed&&!current?.is_practice){openCard();break;}openModal(`<h1>1순위 기준</h1><p>이번 탐색에서 가장 중요하게 지키려는 기준을 내 말로 적어주세요.</p><label for="priority">가장 중요한 기준과 이유</label><textarea id="priority" maxlength="1000" rows="4">${esc(state.card?.priority||'')}</textarea><p class="muted">고치기 전의 기준도 기록에 남아요.</p><p id="criterion-error" class="error" role="alert"></p><div class="actions">${button('close-modal','닫기')}${button('save-criterion','저장','primary')}</div>`);break;
    case 'save-criterion':node.disabled=true;try{await api('/card',{priority:$('#priority').value});await refresh();modal.close();render();toast('1순위 기준을 저장했어요.');}catch(error){$('#criterion-error').textContent=error.message;node.disabled=false;}break;
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
      node.disabled=true;try{await loadCheckpoint();await refresh();view=null;render();if(!state.checkpoint_seen&&checkpoint.results.length)startGuide(true);}catch(e){node.disabled=false;throw e;}break;
    case 'reopen':await api(route('reopen'),{});await refresh();render();break;
    case 'label':decisionFor(checkpoint.results.find(r=>r.id===id)).label=node.dataset.value;draftSave();render();$(`[data-action="label"][data-id="${id}"][data-value="${node.dataset.value}"]`)?.focus();break;
    case 'checkpoint-result':draft.ui.focusId=id;draftSave();render();$('#focus-name')?.scrollIntoView({block:'nearest',behavior:'instant'});$('#checkpoint-choices button')?.focus({preventScroll:true});break;
    case 'checkpoint-next':if(!checkpoint.results.some(r=>r.discussed&&!names[draft.decisions[r.id]?.label]))checkpointStage(2);break;
    case 'checkpoint-back':checkpointStage(1);break;
    case 'edit-judgment':checkpointStage(1,id);break;
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
      try{await api(route('record'),{decisions:Object.entries(draft.decisions).filter(([,d])=>names[d.label]).map(([result_id,d])=>({result_id,label:d.label,reason:d.reason})),moves:draft.moves,revisions:Object.values(draft.revisions)});removeLocal(draftKey);await refresh();checkpoint=null;draft=null;attached=null;lastReplyFailure=null;saving=false;render();if(practice)practiceDone();else toast(savedMessage());}
      catch(error){saving=false;render();$('#record-error').textContent=error.message;const retry=$('[data-action="record"]');retry.textContent='다시 기록하기';}break;
    }
    case 'start-real':modal.close();await api('/rounds',{is_practice:false});await refresh();view=null;render();break;
    case 'practice-again':modal.close();await api('/rounds',{is_practice:true});await refresh();view=null;render();break;
    case 'map':await showMap();break;
    case 'map-node':selectMapNode(id);break;
    case 'map-round':$('#map-round-'+id)?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});break;
    case 'map-clear':selectMapNode(null);break;
    case 'sources':await showSources(results().map(r=>r.id));break;
    case 'source-toggle':{const list=sourceDraft[node.dataset.result];sourceDraft[node.dataset.result]=list.includes(id)?list.filter(x=>x!==id):[...list,id];node.setAttribute('aria-pressed',String(sourceDraft[node.dataset.result].includes(id)));break;}
    case 'source-save':await saveSources();break;
    case 'source-skip':if(!sourceSaving){modal.close();toast('이미지는 그대로 두었어요. 이전 시도 연결은 나중에 고를 수 있어요.');}break;
    case 'history':await showHistory();break;
    case 'download-history':downloadJSON(historyData,'companion-history.json');break;
    case 'close-modal':modal.close();break;
    case 'context':{const r=current.results.find(x=>x.is_context);openModal(`<div class="bar"><h2>생성 화면</h2>${button('close-modal','닫기')}</div>${pic(r)}<p class="muted">결과를 만든 맥락 자료예요.</p>`);break;}
    case 'guide':if(state.practice_completed&&!current?.is_practice&&current?.status!=='checkpoint'){openModal(`<h1>탐색 캔버스 사용하기</h1><p>이미지를 올리고 출처를 고르면 선이 이어져요. 이미지를 누르면 오른쪽에서 그 이미지의 대화를 볼 수 있어요.</p><p>선택·보류·제외·아직 모르겠어요는 직접 고릅니다. 발언과 판단은 따로 저장돼요.</p>${button('close-modal','닫기')}`);break;}if(current?.status==='checkpoint'&&draft.ui.step!==1)checkpointStage(1);startGuide(current?.status==='checkpoint');break;
    case 'guide-next':if(guide.checkpoint||guide.step===4)await closeGuide();else{guide.step++;drawGuide();}break;
    case 'guide-close':await closeGuide();break;
    case 'logout':await api('/logout',{});state=null;current=null;attached=null;responseTo=null;canvasScreen='explore';if(modal.open)modal.close();renderLogin();break;
  }
}
document.addEventListener('click',e=>{const node=e.target.closest('[data-action]');if(node&&!node.disabled)act(node.dataset.action,node).catch(error=>toast(error.message));});
const coachSteps=[
 ['#guide-criterion','내 1순위 기준이 여기 있어요','카드에 적은 1순위 기준이 탐색하는 동안 계속 보여요. 결과를 볼 때 이 기준과 함께 생각해 보세요.'],
 ['#guide-upload','결과를 올리고, 어디서 이어졌는지 골라요','바탕이 된 이미지를 고르면 선이 이어져요. 여러 장을 고를 수 있고, 처음 만든 이미지라면 ‘새로 시작’을 골라요.'],
 ['#guide-chat','이미지를 누르면 그 이미지에 대해 이야기해요','오른쪽 대화는 지금 고른 이미지에 붙어요. 보면서 떠오른 말을 그대로 적어요.'],
 ['#guide-judgment','판단은 내가 직접 골라요','선택·보류·제외·아직 모르겠어요 중에서 골라요. 내가 한 말과 판단은 따로 저장되고, 고르지 않은 이미지는 ‘판단 전’으로 남아요.'],
 ['#guide-confirm','기준이 달라지면 확인을 받아요','대화에서 기준이 달라진 것 같으면 정리 제안이 떠요. 변화 유형을 고르고 ‘맞아요’를 누르기 전에는 내 기준이 바뀌지 않아요.']
];

function startGuide(cp=false) {
  if(guide)return;
  if(!current){toast('결과를 올려 라운드를 시작하면 사용 안내를 볼 수 있어요.');return;}
  guideReturnFocus=document.activeElement;guideReturnView=view;guide={step:0,checkpoint:cp};drawGuide();
}
function drawGuide() {
  if(!guide)return;
  if(!guide.checkpoint)renderGuideExample();
  const info=guide.checkpoint?['#checkpoint-choices','결과마다 내 판단을 골라요','네 가지 중 하나를 골라요. 위 칸에는 대화에서 내가 한 말이 그대로 들어 있고, 고칠 수 있어요. 다 고르면 다음에 해볼 것을 적어요.']:coachSteps[guide.step];
  let target=$(info[0]);if(!target)target=$('#stage');
  target.scrollIntoView({block:'center',behavior:'instant'});
  $('#coach-root').innerHTML=`<div class="coach-shade" data-shade="top"></div><div class="coach-shade" data-shade="left"></div><div class="coach-shade" data-shade="right"></div><div class="coach-shade" data-shade="bottom"></div><div class="coach-ring"></div><section class="coach-card" role="dialog" aria-modal="true" aria-labelledby="coach-title"><div class="coach-dots"><b class="coach-kicker">사용 안내</b><span class="coach-step-dots" aria-label="${guide.checkpoint?'확인 화면 안내':`안내 ${guide.step+1} / 5`}">${Array.from({length:guide.checkpoint?1:5},(_,i)=>`<i class="${i===guide.step?'current':''}"></i>`).join('')}</span></div><h2 id="coach-title">${info[1]}</h2><p>${info[2]}</p><div class="actions">${button('guide-close','안내 건너뛰기','ghost')}${button('guide-next',guide.checkpoint?'확인했어요':guide.step===4?(current.is_practice?'연습 라운드 시작':'안내 마치기'):'다음','primary')}</div></section>`;
  app.inert=true;placeGuide();$('[data-action="guide-next"]')?.focus();
}
function placeGuide() {
  if(!guide)return;
  const selector=guide.checkpoint?'#checkpoint-choices':coachSteps[guide.step][0];const target=$(selector)||$('#stage');if(!target)return;
  const r=target.getBoundingClientRect(), w=innerWidth,h=innerHeight,pad=4;
  const left=Math.max(4,Math.min(w-4,r.left-pad)),top=Math.max(4,Math.min(h-4,r.top-pad)),right=Math.max(4,Math.min(w-4,r.right+pad)),bottom=Math.max(4,Math.min(h-4,r.bottom+pad));
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
window.addEventListener('resize',()=>{if(!guide)return;requestAnimationFrame(()=>{if(!guide)return;const target=$(guide.checkpoint?'#checkpoint-choices':coachSteps[guide.step][0])||$('#stage');target?.scrollIntoView({block:'center',behavior:'instant'});placeGuide();});});window.addEventListener('scroll',placeGuide,{passive:true});
document.addEventListener('keydown',e=>{
  if(guide){if(e.key==='Escape'){e.preventDefault();closeGuide();}if(e.key==='Tab'){const buttons=[...$('.coach-card').querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}return;}
  if(e.target.matches('[role="radio"]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const group=[...e.target.parentElement.querySelectorAll('[role="radio"]')],i=group.indexOf(e.target);group[(i+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+group.length)%group.length].click();}
  if(e.key==='Escape'&&view&&!modal.open){view=null;render();}
});
// Working canvas from the supplied 06 artboard. Relationships are explicitly chosen.
let canvasScreen='explore',canvasTab='canvas',canvasZoom=1,cardStep=0,cardDraft=null,lineageDraft=null,lineageBusy=false,canvasSaving=false;
const canvasItems=()=>{const rows=state.rounds.filter(r=>!r.is_practice).flatMap(r=>r.results.filter(x=>!x.is_context)),order=new Map(rows.map((r,i)=>[r.id,i]));return rows.map((x,i)=>({...x,canvasName:ordinalName(i),parent_ids:[...(x.parent_ids||[])].sort((a,b)=>order.get(a)-order.get(b))}));};
const canvasTitle=r=>(r?.canvasName||r?.label||'결과')+(r?.title?' '+r.title:'');
const latestJudgment=r=>r?.judgments?.at(-1);
function stateChip(label){return `<span class="judgment-chip chip-${label||'empty'}">${names[label]||'판단 전'}</span>`;}
function canvasHeader(){return `<header class="design-header"><div><b>탐색 기록</b><span class="team-badge">${current?roundTitle(current):'나의 탐색'}</span></div><nav>${button('criterion','카드 보기','ghost')}${button('record-layout',exploreLayout==='canvas'?'목록·기록 보기':'캔버스 보기','ghost')}${button('canvas-summary','정리본','ghost')}${button('canvas-more','더 보기','ghost')}${button(current?.status==='checkpoint'?'reopen':'checkpoint',current?.status==='checkpoint'?'탐색으로 돌아가기':'마무리하고 정리하기','primary',!current?'disabled':'')}</nav></header>`;}
function criterionSummary(){return latestCriterionSummary();}

function renderCanvasApp(){
 document.body.classList.add('redesign');
 if(canvasScreen==='card'){renderCard();return;}
 if(canvasScreen==='summary'){renderSummary();return;}
 const cp=current?.status==='checkpoint';
 app.innerHTML=`${config.demo?'<div class="notice">화면 테스트 · 정해진 대화 응답을 사용해요. 실제 AI 대화가 아니에요.</div>':''}${canvasHeader()}<div class="design-wrap">${criterionSummary()}<nav class="mobile-tabs" aria-label="탐색 화면">${button('canvas-tab','결과','',`data-tab="canvas" aria-pressed="${canvasTab==='canvas'}"`)}${button('canvas-tab','대화','',`data-tab="chat" aria-pressed="${canvasTab==='chat'}"`)}${button('canvas-tab',`기록 ${latestNotes().length+(state.criteria?.changes.filter(c=>c.status!=='rejected').length||0)+canvasItems().filter(r=>latestJudgment(r)).length} ${pendingCriteria().length?'· '+pendingCriteria().length+' 확인 전':''}`,'',`data-tab="records" aria-pressed="${canvasTab==='records'}"`)}</nav><div class="design-workspace ${cp?'design-checkpoint':''} ${exploreLayout==='list'&&!cp?'list-layout':''}" data-tab="${canvasTab}"><main id="stage" class="${cp?'stage':'canvas-panel'}">${cp?checkpointHTML():exploreLayout==='list'?resultList():canvasHTML()}</main><aside class="side design-chat" aria-label="선택한 이미지의 대화">${cp?chatHTML():canvasChat()}</aside>${!cp&&(exploreLayout==='list'||canvasTab==='records')?recordPanel():''}</div></div>`;
 const input=$('#message');if(input)input.value=readLocal(key('compose'),{text:''}).text;
 setupDrop();const log=$('.design-chat .log');if(log)log.scrollTop=log.scrollHeight;
}
function canvasHTML(){
 const items=canvasItems(),depth=new Map(),heights=new Map(),positions=new Map();
 for(const r of items){const d=Math.max(0,...(r.parent_ids||[]).map(id=>(depth.get(id)||0)+1));depth.set(r.id,d);const y=heights.get(d)??(d?114:22);positions.set(r.id,{x:40+d*406,y,w:attached===r.id?290:242,h:latestJudgment(r)?.label==='EXCLUDE'?76:300});heights.set(d,y+(latestJudgment(r)?.label==='EXCLUDE'?204:340));}
 const width=Math.max(900,...[...positions.values()].map(p=>p.x+p.w+60)),height=Math.max(690,...[...heights.values()].map(y=>y+120));
 const links=items.flatMap(r=>(r.parent_ids||[]).map(parent=>({parent,child:r.id})));const byId=new Map(items.map(r=>[r.id,r]));
 const paths=links.map(l=>{const a=positions.get(l.parent),b=positions.get(l.child);if(!a||!b)return '';const gray=latestJudgment(byId.get(l.parent))?.label==='EXCLUDE';const x=a.x+a.w,y=a.y+a.h/2,tx=b.x,ty=b.y+b.h/2;return `<path class="lineage-edge ${gray?'excluded-edge':''}" d="M${x} ${y} C${x+110} ${y},${tx-110} ${ty},${tx} ${ty}" marker-end="url(#${gray?'canvas-arrow-muted':'canvas-arrow'})"/>`;}).join('');
 return `<div class="canvas-toolbar"><b>이미지 ${items.length} · 연결 ${links.length}</b><div>${button('canvas-zoom','−','ghost','data-delta="-0.1" aria-label="캔버스 축소"')}<span>${Math.round(canvasZoom*100)}%</span>${button('canvas-zoom','＋','ghost','data-delta="0.1" aria-label="캔버스 확대"')}${button('upload','＋ 이미지 올리기','primary',`id="upload-target" ${uploadBusy?'disabled':''}`)}</div></div><div class="canvas-viewport" tabindex="0" aria-label="이미지 출처 캔버스, 가로와 세로로 이동할 수 있어요"><div style="width:${width*canvasZoom}px;height:${height*canvasZoom}px"><div class="canvas-surface" style="width:${width}px;height:${height}px;transform:scale(${canvasZoom})"><svg class="canvas-lines" width="${width}" height="${height}" aria-hidden="true"><defs><marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#111"/></marker><marker id="canvas-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#a8a8a8"/></marker></defs>${paths}</svg>${items.map(r=>{const p=positions.get(r.id),j=latestJudgment(r),excluded=j?.label==='EXCLUDE',turns=state.rounds.flatMap(x=>x.turns).filter(t=>t.result_id===r.id);return `<div class="canvas-node-wrap" style="left:${p.x}px;top:${p.y}px;width:${p.w}px">${r.parent_ids?.length?`<span class="node-parents">${r.parent_ids.map(id=>esc(canvasTitle(byId.get(id)))).join(' + ')}에서 이어짐</span>`:''}<button type="button" data-action="canvas-select" data-id="${r.id}" class="image-node ${excluded?'is-excluded':''}" aria-pressed="${attached===r.id}" aria-label="${esc(canvasTitle(r))} 이미지와 대화 보기"><img src="${esc(r.image)}" alt="${esc(canvasTitle(r))} 결과"><div class="node-meta"><b>${esc(canvasTitle(r))}</b>${stateChip(j?.label)}</div>${!excluded?`<p>${j?.reason?`“${esc(j.reason)}”`:'<span class="muted">이유 미기록</span>'}</p><small>대화 ${turns.length}${attached===r.id?' · 오른쪽에서 열림':''}</small>`:''}</button></div>`;}).join('')}<button class="canvas-drop" id="drop-zone" data-action="upload" style="left:${items.length?Math.min(width-350,446):Math.max(40,(width-350)/2)}px;top:${Math.max(440,...[...positions.values()].map(p=>p.y+p.h+24))}px" ${uploadBusy?'disabled':''}><b>${uploadBusy?'이미지를 올리고 있어요':'Midjourney 결과를 끌어다 놓기'}</b><span>올릴 때 어디서 이어졌는지 골라요</span></button></div></div></div><div class="canvas-legend"><span>― 출처 연결</span><span class="muted">― 제외한 이미지에서 온 연결</span><span>선은 학생이 고른 출처로만 생겨요</span><span>${stateChip(null)} 아직 고르지 않음</span><span>${stateChip('HOLD')} 판단했고, 다시 볼 후보로 남김</span><span>${stateChip('UNDECIDED')} 느낀 건 있지만 아직 정하지 못함</span></div><div class="canvas-status" role="status">${esc(uploadError)}${uploadError&&pendingUploads.length?button('retry-upload','다시 올리기'):''}</div>`;
}
function canvasChat(){
 const items=canvasItems(),r=items.find(r=>r.id===attached),j=latestJudgment(r),turns=state.rounds.filter(x=>!x.is_practice).flatMap(x=>x.turns).filter(t=>r?t.result_id===r.id:!t.result_id);
 return `<div class="selected-header"><div class="selected-top">${r?`<button class="selected-image" data-action="canvas-enlarge" aria-label="이미지 크게 보기"><img src="${esc(r.image)}" alt="${esc(canvasTitle(r))}"></button>`:''}<div>${r?button('canvas-name',esc(canvasTitle(r)),'selected-title',`aria-label="${esc(canvasTitle(r))} 이름 고치기"`):'<b>이미지를 선택해 대화해요</b>'}<div class="judgment-controls" role="group" aria-label="이미지 판단">${r?Object.entries(names).map(([value,name])=>button('canvas-judge',name,'judgment-chip',`data-value="${value}" aria-pressed="${j?.label===value}" title="${meanings[value]}" ${canvasSaving?'disabled':''}`)).join(''):''}</div></div></div>${r?`<small>출처 ${r.parent_ids?.length?r.parent_ids.map(id=>esc(canvasTitle(items.find(x=>x.id===id)))).join(' · '):'새로 시작'} ${r.round_id===current?.id?button('canvas-sources','고치기','ghost'):''}</small><small>판단 이력 · ${r.judgments?.length?r.judgments.filter((d,i,all)=>!i||d.label!==all[i-1].label).map(d=>names[d.label]).join(' → '):'아직 고르지 않음'}</small><div class="selected-reason">${j?.reason?`<span>“${esc(j.reason)}”</span>`:'<span class="muted">이유 미기록</span>'}${j?button('canvas-reason','이유 '+(j.reason?'고치기':'적기'),'ghost'):''}</div>`:''}</div><div class="log" aria-live="polite">${(r?.judgments||[]).filter((d,i,all)=>i&&d.label!==all[i-1].label).map(d=>`<p class="judgment-event">${esc(canvasTitle(r))} · ${names[d.label]}로 바꿨어요. 판단 이력에 남겼어요.</p>`).join('')}${turns.map(t=>`<div class="canvas-message ${t.role}"><p>${esc(t.content)}</p>${t.role==='user'?`<small>발언 저장됨 · 판단은 별도</small>${button('criterion-from-turn','기준으로 남기기','ghost',`data-id="${t.id}"`)}${button('note-from-turn','기록 남기기','ghost',`data-id="${t.id}"`)}`:t.question_id==='Q6'?(state.question_skips?.some(q=>q.turn_id===t.id)?'<small>질문을 건너뛰었어요 · 판단은 그대로 남아요</small>':button('criterion-response','이 질문에 답하기','ghost',`data-id="${t.id}"`)+button('question-skip','다음에 할게요','ghost',`data-id="${t.id}"`)):''}</div>`).join('')}${!turns.length?'<p class="conversation-empty">이미지를 보며 떠오른 생각을 적어 주세요. 기준에 대한 말은 발언 아래 ‘기준으로 남기기’에서 정리할 수 있어요.</p>':''}${sending?'<div class="canvas-message assistant"><p role="status">기록 모델이 읽고 있어요…</p></div>':''}${pendingCriteria().filter(c=>r?c.result_id===r.id:!c.result_id).map(criterionReview).join('')}${lastReplyFailure?`<div class="reply-failure"><p>발언은 저장됐지만 답을 받지 못했어요.</p>${button('retry-reply','다시 답 받기')}</div>`:''}</div><form id="compose" class="canvas-compose">${responseTo?`<div class="response-context">Q6에 대한 응답으로 연결돼요 ${button('criterion-response','연결 안 하기','ghost')}</div>`:''}<label class="sr-only" for="message">${r?esc(canvasTitle(r))+'에 대한 메시지':'메시지'}</label><textarea id="message" rows="3" maxlength="20000" placeholder="${r?esc(canvasTitle(r))+'에 대한 메시지':'이미지를 보고 생각한 것을 적어 주세요'}"></textarea><button type="submit" class="primary" ${sending?'disabled':''}>${sending?'보내는 중':'보내기'}</button><p id="send-error" class="error" role="alert"></p></form>`;
}
function openCard(){canvasScreen='card';cardStep=state.card?2:0;cardDraft=readLocal(`card:${state.id}`,null)||{issue:state.card?.issue||'',image:state.card?.image||'',priority:state.card?.priority||'',secondary:state.card?.secondary||'',question:state.card?.question||''};render();}
function renderCard(){
 const steps=['의도','떠오르는 이미지','판단 기준','탐색 질문'];const headings=['어떤 디자인을 탐색하려고 하나요?','지금 떠오르는 이미지는 어떤 모습인가요?','이 디자인의 판단 기준은<br>무엇이고, 왜 그런가요?','이번 탐색에서 무엇을 알아보고 싶나요?'];const fields=[['issue','프로젝트와 해결하려는 문제'],['image','떠오르는 이미지'],['priority','1순위 기준'],['question','탐색 질문']];const [field,label]=fields[cardStep];
 app.innerHTML=`<header class="design-header"><b>탐색 기록</b>${button('card-exit','탐색으로 돌아가기','ghost')}</header><main class="card-page"><nav aria-label="카드 작성 단계"><b>기준·의도 카드 ${cardStep+1} / 4</b>${steps.map((s,i)=>button('card-step',`<span>${i<cardStep?'✓':i+1}</span>${s}`,i===cardStep?'active':i<cardStep?'done':'',`data-step="${i}" ${i===cardStep?'aria-current="step"':''}`)).join('')}</nav><section><h1>${headings[cardStep]}</h1><p class="card-description">${cardStep===2?'중요한 순서대로, 이유와 함께 적어 주세요. 탐색하는 동안 내 선택을 이 기준과 함께 보여 줘요.':'내가 생각한 내용을 그대로 적어 주세요. 나중에 다시 고칠 수 있어요.'}</p><label for="${field}">${label}</label><textarea id="${field}" data-card-field="${field}" rows="4" maxlength="${field==='priority'?1000:2000}">${esc(cardDraft[field])}</textarea>${cardStep===2?`${cardDraft.secondary||cardDraft.secondaryOpen?`<label for="secondary">2순위 기준 (선택)</label><textarea id="secondary" data-card-field="secondary" rows="2" maxlength="2000">${esc(cardDraft.secondary)}</textarea>`:button('card-secondary','2순위 기준 적기','secondary')}<div class="card-help"><b>이렇게 써 보세요</b><p>‘편안하게’보다 ‘눈부시지 않게’처럼 결과를 보고 확인할 수 있는 말로, 이유를 함께 적어요.</p></div>`:''}<p id="criterion-error" class="error" role="alert"></p><div class="card-footer">${button('card-step','이전','secondary',`data-step="${Math.max(0,cardStep-1)}" ${cardStep===0?'disabled':''}`)}${cardStep<3?button('card-step','다음','primary',`data-step="${cardStep+1}"`):button('card-save','저장하고 탐색하기','primary')}${state.card&&cardStep<3?button('card-save','저장','primary'):''}</div></section></main>`;
}
function renderSummary(){
 const items=canvasItems().sort((a,b)=>(['SELECT','HOLD','UNDECIDED',undefined,'EXCLUDE'].indexOf(latestJudgment(a)?.label))-(['SELECT','HOLD','UNDECIDED',undefined,'EXCLUDE'].indexOf(latestJudgment(b)?.label))),judged=items.filter(r=>latestJudgment(r)).length;
 const confirmed=latestNotes().length+judged+(state.criteria?.initial?1:0)+(state.criteria?.changes.filter(c=>c.status==='confirmed').length||0),total=confirmed+pendingCriteria().length;
 const moves=[...state.rounds.filter(r=>!r.is_practice&&r.status==='recorded').flatMap(r=>r.moves||[]),...latestNotes().filter(n=>n.kind==='action').map(n=>({content:n.text}))];
 app.innerHTML=`<header class="design-header"><b>탐색 기록</b><nav>${button('canvas-back','탐색으로 돌아가기','ghost')}${button('canvas-download','정리본 내려받기','primary')}</nav></header><main class="summary-page"><div class="summary-hero"><div><small>나의 탐색</small><h1>오늘의 탐색 정리</h1></div><dl><div><dt>결과</dt><dd>${items.length}개</dd></div><div><dt>판단</dt><dd>${judged}개</dd></div><div><dt>내가 확인한 기록</dt><dd>${confirmed} / ${total}</dd></div></dl></div><section class="summary-result-panel"><h2>결과별 판단</h2><div class="summary-results">${items.map(r=>{const j=latestJudgment(r);return `<article class="${j?.label==='EXCLUDE'?'summary-excluded':''}"><button class="summary-image" data-action="canvas-summary-select" data-id="${r.id}" aria-label="${esc(canvasTitle(r))} 이미지와 대화 보기"><img src="${esc(r.image)}" alt="${esc(canvasTitle(r))}"></button><header><h3>${esc(canvasTitle(r))}</h3>${stateChip(j?.label)}</header><div class="summary-reason-block"><small>이유</small><p>${j?.reason?`“${esc(j.reason)}”`:'아직 적지 않았어요.'}</p>${!j?.reason?button(j?'canvas-summary-reason':'canvas-summary-select',j?'이유 적기':'판단 남기기','ghost',`data-id="${r.id}"`):''}</div></article>`;}).join('')||'<p>아직 올린 결과가 없어요.</p>'}</div></section>${criterionTimeline()}<section class="summary-result-panel"><h2>발견</h2>${latestNotes().filter(n=>n.kind==='discovery').map(n=>`<p>${esc(n.text)}</p>`).join('')||'<p class="muted">아직 남긴 발견이 없어요.</p>'}${button('note-new','발견 남기기','ghost')}</section><section class="summary-next-action"><div><h2>${moves.length?'다음 행동':'다음 행동이 비어 있어요'}</h2>${moves.length?moves.map(m=>`<p>“${esc(m.content)}”</p>`).join(''):'<p>다음 수업 전에 해 볼 일을 하나 적어 두면, 이어서 시작하기 쉬워요.</p>'}</div>${button('canvas-next-action','다음 행동 적기')}</section><div class="summary-history-links">${button('history','기록 목록','ghost')}${button('map','탐색 지도','ghost')}</div></main>`;
}

async function showLineage(ids){
 const items=canvasItems(),eligible=items.filter(r=>!ids.includes(r.id));if(!eligible.length)return;
 lineageDraft=Object.fromEntries(ids.map(id=>[id,[...(items.find(r=>r.id===id)?.parent_ids||[])]]));
 openModal(`<h1>어디서 이어졌나요?</h1><p>이 이미지를 만들 때 바탕이 된 이미지를 모두 골라 주세요. 고른 이미지에서 선이 이어져요.</p>${ids.map(id=>{const target=items.find(r=>r.id===id),index=items.findIndex(r=>r.id===id);return `<section class="lineage-choice-section"><div class="lineage-target"><img src="${esc(target.image)}" alt="${esc(canvasTitle(target))}"><b>${esc(canvasTitle(target))}</b></div><div class="lineage-options">${eligible.filter(r=>items.indexOf(r)<index).map(r=>button('lineage-toggle',`<img src="${esc(r.image)}" alt=""><b>${esc(canvasTitle(r))}</b><small>${names[latestJudgment(r)?.label]||'판단 전'}</small>`,'lineage-option',`data-result="${id}" data-id="${r.id}" aria-pressed="${lineageDraft[id].includes(r.id)}"`)).join('')}${button('lineage-root','<b>새로 시작</b><small>연결 없이 올려요</small>','lineage-option',`data-result="${id}" aria-pressed="${!lineageDraft[id].length}"`)}</div></section>`;}).join('')}<p class="lineage-note">출처로 골라도 그 이미지가 선택되지는 않아요. 새 이미지는 ‘판단 전’으로 올라가고, 판단은 따로 정해요.</p><p id="lineage-error" class="error" role="alert"></p><div class="lineage-footer">${button('close-modal','나중에 고르기')}${button('lineage-save','출처 저장','primary')}</div>`);modal.classList.add('lineage-modal');
}
async function saveCanvasJudgment(label,reason,node){
 if(canvasSaving)return;const r=canvasItems().find(x=>x.id===attached);if(!r)return;
 const payload={result_id:r.id,label,reason};const cacheKey=`judgment:${state.id}:${r.id}`,old=readLocal(cacheKey,null);payload.request_id=old&&JSON.stringify(old.payload)===JSON.stringify(payload)?old.id:crypto.randomUUID();writeLocal(cacheKey,{payload:{result_id:r.id,label,reason},id:payload.request_id});
 canvasSaving=true;node.disabled=true;
 try{if(!current){await api('/rounds',{is_practice:false});await refresh();}await api(route('judgment'),payload);removeLocal(cacheKey);await refresh();if(modal.open)modal.close();render();toast('판단을 저장했어요. 발언과 출처 연결은 그대로 남아요.');}
 finally{canvasSaving=false;node.disabled=false;document.querySelectorAll('[data-action="canvas-judge"]').forEach(b=>b.disabled=false);}
}
async function canvasAction(action,node){
 switch(action){
 case 'canvas-select':case 'canvas-summary-select':responseTo=null;attached=node.dataset.id;canvasScreen='explore';render();return true;
 case 'canvas-name':{const r=canvasItems().find(x=>x.id===attached);openModal(`<h1>이미지 이름</h1><label for="result-title">${r.canvasName}에 붙일 이름</label><input id="result-title" maxlength="100" value="${esc(r.title||'')}" placeholder="예: 벽 반사"><p id="name-error" class="error" role="alert"></p><div class="actions">${button('close-modal','취소')}${button('canvas-name-save','저장','primary')}</div>`);return true;}
 case 'canvas-name-save':node.disabled=true;try{await api('/results/name',{result_id:attached,title:$('#result-title').value});await refresh();modal.close();render();}catch(error){$('#name-error').textContent=error.message;node.disabled=false;}return true;
 case 'canvas-tab':canvasTab=node.dataset.tab;render();return true;
 case 'canvas-zoom':canvasZoom=Math.max(.4,Math.min(1.5,canvasZoom+Number(node.dataset.delta)));render();return true;
 case 'canvas-enlarge':{const r=canvasItems().find(x=>x.id===attached);openModal(`<div class="bar"><h2>${esc(canvasTitle(r))}</h2>${button('close-modal','닫기')}</div>${pic(r)}`);return true;}
 case 'canvas-judge':if(latestJudgment(canvasItems().find(r=>r.id===attached))?.label!==node.dataset.value)await saveCanvasJudgment(node.dataset.value,latestJudgment(canvasItems().find(r=>r.id===attached))?.reason||'',node);return true;
 case 'canvas-reason':{const j=latestJudgment(canvasItems().find(r=>r.id===attached));openModal(`<h1>내 판단의 이유</h1><label for="canvas-reason">이렇게 판단한 이유를 내 말로 적어 주세요.</label><textarea id="canvas-reason" rows="4" maxlength="20000">${esc(j.reason)}</textarea><p id="reason-error" class="error" role="alert"></p><div class="actions">${button('close-modal','취소')}${button('canvas-reason-save','저장','primary',`data-value="${j.label}"`)}</div>`);return true;}
 case 'canvas-reason-save':try{await saveCanvasJudgment(node.dataset.value,$('#canvas-reason').value,node);}catch(e){$('#reason-error').textContent=e.message;}return true;
 case 'canvas-sources':await showLineage([attached]);return true;
 case 'lineage-toggle':{const ids=lineageDraft[node.dataset.result];lineageDraft[node.dataset.result]=ids.includes(node.dataset.id)?ids.filter(x=>x!==node.dataset.id):[...ids,node.dataset.id];node.setAttribute('aria-pressed',String(lineageDraft[node.dataset.result].includes(node.dataset.id)));$(`[data-action="lineage-root"][data-result="${node.dataset.result}"]`).setAttribute('aria-pressed',String(!lineageDraft[node.dataset.result].length));return true;}
 case 'lineage-root':lineageDraft[node.dataset.result]=[];document.querySelectorAll(`[data-action="lineage-toggle"][data-result="${node.dataset.result}"]`).forEach(b=>b.setAttribute('aria-pressed','false'));node.setAttribute('aria-pressed','true');return true;
 case 'lineage-save':if(lineageBusy)return true;lineageBusy=true;modal.querySelectorAll('button').forEach(b=>b.disabled=true);try{await api(route('lineage'),{results:Object.entries(lineageDraft).map(([result_id,parent_ids])=>({result_id,parent_ids}))});await refresh();modal.close();render();}catch(e){$('#lineage-error').textContent=e.message;}finally{lineageBusy=false;modal.querySelectorAll('button').forEach(b=>b.disabled=false);}return true;
 case 'canvas-summary-reason':attached=node.dataset.id;canvasScreen='explore';render();await canvasAction('canvas-reason',node);return true;
 case 'canvas-next-action':canvasScreen='explore';if(!current){await api('/rounds',{is_practice:false});await refresh();}if(current.status==='active')await loadCheckpoint();await refresh();render();if(draft&&!checkpoint.results.some(r=>r.discussed&&!names[draft.decisions[r.id]?.label]))checkpointStage(2);return true;
 case 'canvas-summary':canvasScreen='summary';render();return true;
 case 'canvas-back':canvasScreen='explore';render();return true;
 case 'canvas-download':downloadJSON({card:state.card,criteria:state.criteria,results:canvasItems(),notes:state.notes,question_skips:state.question_skips,history:await api('/history')},'탐색-정리본.json');return true;
 case 'canvas-more':openModal(`<h2>탐색 메뉴</h2><div class="actions">${button('map','탐색 지도')}${button('history','기록 목록')}${current&&current.number>1&&results().length?button('sources','이전 시도 연결'):''}${button('guide','사용 안내')}${button('upload-context','생성 화면 올리기')}${current?.results.some(r=>r.is_context)?button('context','생성 화면 보기'):''}${button('logout','나가기')}${button('close-modal','닫기')}</div>`);return true;
 case 'card-secondary':cardDraft.secondaryOpen=true;render();return true;
 case 'card-step':cardStep=Number(node.dataset.step);render();return true;
 case 'card-exit':canvasScreen='explore';render();return true;
 case 'card-save':node.disabled=true;try{await api('/card',cardDraft);removeLocal(`card:${state.id}`);await refresh();canvasScreen='explore';render();}catch(e){$('#criterion-error').textContent=e.message;node.disabled=false;}return true;
 }
 return false;
}
document.addEventListener('input',e=>{if(e.target.dataset.cardField){cardDraft[e.target.dataset.cardField]=e.target.value;writeLocal(`card:${state.id}`,cardDraft);}});

const changeNames={REFINE:'구체화',REPLACE:'바뀜',ADD:'새 기준 추가',REORDER:'순위 변경',UNSURE:'아직 구분하기 어려워요'};
let responseTo=null,criteriaBusy=false;
const criterionDraftKey=id=>`criterion-review:${state.id}:${id}`;
const criterionRows=()=>[state.card?.priority||'',state.card?.secondary||'',...JSON.parse(state.card?.extra_criteria||'[]')];
const pendingCriteria=()=>state.criteria?.changes.filter(c=>c.status==='proposed')||[];
function criterionContext(c){return c.question_id?`${c.question_id}에 대한 응답`:'연결된 질문 없음';}
function criterionAuthor(c){return c.author==='ai'?(c.status==='confirmed'?(c.final_text===c.proposed_text?'AI 정리 제안 → 학생 확인':'AI 정리 제안 → 학생 수정·확인'):'AI 정리 제안'):'학생이 직접 정리';}
function criterionOrigin(c){const r=canvasItems().find(r=>r.id===c.result_id);return `<div class="criterion-origin">${r?`<img src="${esc(r.image)}" alt="${esc(canvasTitle(r))}">`:''}<div><small>계기 · ${r?esc(canvasTitle(r))+'를 보며 한 말':'탐색 중 한 말'}</small><p>“${esc(c.original_text)}”</p></div></div>`;}
function criterionMeta(c){return `<div class="criterion-meta"><span><b>발언 맥락</b> ${criterionContext(c)}</span><span><b>작성</b> ${criterionAuthor(c)}</span><span><b>상태</b> ${c.status==='confirmed'?'학생 확인':c.status==='rejected'?'반영하지 않음':'제안 중'}</span></div>`;}
function criterionReview(c){
 const d=readLocal(criterionDraftKey(c.id),{text:c.proposed_text,type:null,rank:1,editing:false});
 return `<section class="criterion-review" data-change="${c.id}"><header><b>1순위 기준 · 정리 제안</b><span>확인 전 · 아직 기록 안 됨</span></header><p class="criterion-notice">처음 기준 ‘${esc(state.criteria?.initial?.priority||'')}’은 그대로 남고, 이 정리가 다음 단계로 이어져요.</p>${d.editing?`<label>기준 정리<textarea data-criterion-text="${c.id}" rows="3" maxlength="2000">${esc(d.text)}</textarea></label>`:`<h3>${esc(d.text)}</h3>`}<p class="criterion-quote">내가 한 말: “${esc(c.original_text)}”</p><div class="criterion-actions">${button('criterion-confirm','맞아요','primary',`data-id="${c.id}" ${!d.type?'disabled':''}`)}${button('criterion-edit','고칠게요','secondary',`data-id="${c.id}"`)}</div><b class="criterion-relation">처음 기준과의 관계</b><div class="criterion-types" role="group" aria-label="기준 변화 유형">${Object.entries(changeNames).map(([value,name])=>button('criterion-type',name,'judgment-chip',`data-id="${c.id}" data-value="${value}" aria-pressed="${d.type===value}"`)).join('')}</div>${d.type?`<div class="criterion-target">${d.type==='REORDER'?`<label>순서를 바꿀 기준<select data-criterion-existing="${c.id}"><option value="">기존 기준 고르기</option>${criterionRows().map((v,i)=>v?`<option value="${esc(v)}" ${d.text===v?'selected':''}>${i+1}순위 · ${esc(v)}</option>`:'').join('')}</select></label>`:''}${d.type==='ADD'?'<p>새 기준으로 추가하며, 지금 1순위 기준은 유지해요.</p>':`<label>${d.type==='REORDER'?'옮길 순위':'반영할 기준'}<select data-criterion-rank="${c.id}">${criterionRows().map((v,i)=>`<option value="${i+1}" ${d.rank===i+1?'selected':''}>${i+1}순위${v?' · '+esc(v):' · 아직 비어 있음'}</option>`).join('')}</select></label>`}</div>`:''}<p class="criterion-review-error error" role="alert"></p><small>확인 전에는 지금 기준과 Q6의 비교 기준이 바뀌지 않아요.</small>${button('criterion-reject','반영하지 않기','ghost',`data-id="${c.id}"`)}</section>`;
}
function criterionTimeline(){
 const history=state.criteria||{cards:[],changes:[]},initial=history.initial;
 const steps=history.cards.filter((c,i,all)=>!i||c.priority!==all[i-1].priority||c.secondary!==all[i-1].secondary||c.extra_criteria!==all[i-1].extra_criteria);
 const items=steps.map((card,i)=>{const c=history.changes.find(x=>x.confirmed_card_id===card.id);const current=card.id===steps.at(-1)?.id;
 return `<li class="timeline-step ${current?'current':''}"><div class="timeline-step-title"><b>${!i?'처음 · 카드':current?'지금 기준':'이전 기준'}</b>${c?`${stateChipText(changeNames[c.student_type])}<small>내가 고른 유형</small>`:i?'<small>카드에서 직접 수정 · 유형 미선택</small>':''}</div><p class="timeline-criterion">${esc(card.priority||'1순위 기준을 적지 않았어요.')}</p>${card.secondary?`<p class="timeline-secondary">2순위 · ${esc(card.secondary)}</p>`:''}${JSON.parse(card.extra_criteria||'[]').map((v,n)=>`<p class="timeline-secondary">${n+3}순위 · ${esc(v)}</p>`).join('')}${c?criterionOrigin(c)+criterionMeta(c):'<div class="criterion-meta"><span><b>작성</b> 학생 원문</span><span><b>상태</b> 카드에 직접 씀</span></div>'}</li>`;}).join('');
 return `<section class="criteria-timeline" id="criteria-timeline"><header><h2>1순위 기준의 변화</h2><span>지금 기준은 내가 확인한 마지막 단계예요</span></header>${initial?`<ol>${items}${history.changes.filter(c=>c.status==='proposed').map(c=>`<li class="timeline-step pending"><div class="timeline-step-title"><b>정리 제안 · 확인 전</b><span class="judgment-chip chip-empty">유형 고르기 전</span></div><p class="timeline-proposal">${esc(c.proposed_text)}</p>${criterionOrigin(c)}${criterionMeta(c)}<div class="timeline-confirm">${button('criterion-open','확인하고 유형 고르기','primary',`data-id="${c.id}"`)}<small>확인 전에는 지금 기준과 Q6의 비교 기준이 바뀌지 않아요</small></div></li>`).join('')}</ol>`:'<p>처음 기준을 카드에 적으면 여기에 이력이 남아요.</p>'}${history.changes.some(c=>c.status==='rejected')?`<details><summary>반영하지 않은 제안 ${history.changes.filter(c=>c.status==='rejected').length}개</summary>${history.changes.filter(c=>c.status==='rejected').map(c=>`<p>${esc(c.proposed_text)}</p>${criterionMeta(c)}`).join('')}</details>`:''}<p>탐색 질문: ${esc(state.card?.question||'아직 적지 않았어요.')}</p></section>`;
}
function stateChipText(text){return `<span class="judgment-chip chip-SELECT">${esc(text||'유형 미선택')}</span>`;}
function latestCriterionSummary(){const initial=state.criteria?.initial,proposal=pendingCriteria().at(-1),origin=canvasItems().find(r=>r.id===proposal?.result_id);return `<section class="card-strip criterion-evolution" aria-label="기준·의도 카드 요약"><div><b>1순위 기준</b><span class="criterion-initial"><strong>처음</strong> ${esc(initial?.priority||state.card?.priority||'아직 적지 않았어요.')}</span>${state.card?.priority&&state.card.priority!==initial?.priority?`<span aria-hidden="true">›</span><span class="criterion-current"><strong>지금</strong> ${esc(state.card.priority)}</span>`:''}${proposal?`<span aria-hidden="true">›</span><span class="criterion-pending"><strong>기준 정리 제안${origin?' · '+esc(canvasTitle(origin))+'에서':''}</strong> ${esc(proposal.proposed_text)}</span>`:''}${button('criterion-timeline','기준 이력','ghost')}${!state.card?button('criterion','카드 적기','ghost'):''}</div><div><b>탐색 질문</b><span>${esc(state.card?.question||'아직 적지 않았어요.')}</span></div></section>`;}
async function criterionAction(action,node){
 const id=node.dataset.id,c=state.criteria?.changes.find(c=>c.id===id),d=c?readLocal(criterionDraftKey(id),{text:c.proposed_text,type:null,rank:1,editing:false}):null;
 switch(action){
 case 'criterion-timeline':canvasScreen='summary';render();$('#criteria-timeline')?.scrollIntoView({block:'start'});break;
 case 'criterion-open':openModal(criterionReview(c));modal.classList.add('criteria-modal');break;
 case 'criterion-edit':d.editing=true;writeLocal(criterionDraftKey(id),d);node.closest('.criterion-review').outerHTML=criterionReview(c);break;
 case 'criterion-type':d.type=node.dataset.value;if(d.type==='ADD')d.rank=criterionRows().length+1;else if(d.rank>criterionRows().length)d.rank=1;writeLocal(criterionDraftKey(id),d);node.closest('.criterion-review').outerHTML=criterionReview(c);break;
 case 'criterion-confirm':if(criteriaBusy)return;criteriaBusy=true;node.disabled=true;try{await api(`/criteria/${id}/confirm`,{change_type:d.type,text:d.text,rank:d.rank});removeLocal(criterionDraftKey(id));await refresh();if(modal.open)modal.close();render();toast('확인한 기준을 반영했어요. 처음 기준과 원문도 그대로 남아요.');}catch(error){node.closest('.criterion-review').querySelector('.criterion-review-error').textContent=error.message;node.disabled=false;}finally{criteriaBusy=false;}break;
 case 'criterion-reject':await api(`/criteria/${id}/reject`,{});await refresh();if(modal.open)modal.close();render();break;
 case 'criterion-from-turn':{const t=state.rounds.flatMap(r=>r.turns).find(t=>t.id===id);if(!state.card){toast('처음 기준을 카드에 먼저 적어주세요.');openCard();break;}openModal(`<h1>내 말에서 기준 남기기</h1><p class="criterion-quote">“${esc(t.content)}”</p><label for="new-criterion">기준으로 남길 내용</label><textarea id="new-criterion" rows="3" maxlength="2000">${esc(t.content)}</textarea><p class="error" id="new-criterion-error" role="alert"></p><div class="actions">${button('close-modal','취소')}${button('criterion-propose','확인 단계로','primary',`data-id="${id}"`)}</div>`);break;}
 case 'criterion-propose':node.disabled=true;try{const saved=await api('/criteria/propose',{source_turn_id:id,text:$('#new-criterion').value});await refresh();openModal(criterionReview(state.criteria.changes.find(c=>c.id===saved.id)));modal.classList.add('criteria-modal');render();}catch(error){$('#new-criterion-error').textContent=error.message;node.disabled=false;}break;
 case 'criterion-response':responseTo=id||null;render();break;
 }
}
document.addEventListener('input',e=>{const id=e.target.dataset.criterionText;if(id){const c=state.criteria.changes.find(c=>c.id===id),d=readLocal(criterionDraftKey(id),{text:c.proposed_text,type:null,rank:1,editing:true});d.text=e.target.value;writeLocal(criterionDraftKey(id),d);}});
document.addEventListener('change',e=>{const id=e.target.dataset.criterionRank||e.target.dataset.criterionExisting;if(id){const d=readLocal(criterionDraftKey(id),{});if(e.target.dataset.criterionRank)d.rank=Number(e.target.value);else d.text=e.target.value;writeLocal(criterionDraftKey(id),d);const c=state.criteria.changes.find(c=>c.id===id);e.target.closest('.criterion-review').outerHTML=criterionReview(c);}});

let recordFilter='all',exploreLayout='canvas';
const noteKinds={discovery:'발견',intent:'의도',action:'다음 행동'};
function latestNotes(){const rows=state.notes||[],older=new Set(rows.map(n=>n.previous_id));return rows.filter(n=>!older.has(n.id)&&!n.deleted);}
function recordPanel(){
 const notes=latestNotes(),items=canvasItems(),criteria=(state.criteria?.changes||[]).filter(c=>c.status!=='rejected');
 const filters=[['all','전체'],['judgment','판단'],['criterion','기준'],...Object.entries(noteKinds)];
 return `<section class="record-panel" aria-label="탐색 기록"><header><h2>기록 ${notes.length+items.filter(r=>latestJudgment(r)).length+criteria.length}</h2>${button('note-new','직접 추가','ghost')}</header><nav class="record-filters">${filters.map(([v,t])=>button('record-filter',t,'',`data-value="${v}" aria-pressed="${recordFilter===v}"`)).join('')}</nav><div class="record-items">${['all','criterion'].includes(recordFilter)?pendingCriteria().map(criterionReview).join('')+criteria.filter(c=>c.status==='confirmed').map(c=>`<article><small>기준 · 학생 확인</small><h3>${esc(c.final_text)}</h3><p>내가 한 말: “${esc(c.original_text)}”</p>${button('criterion-timeline','기준 이력','ghost')}</article>`).join(''):''}${['all','judgment'].includes(recordFilter)?items.filter(r=>latestJudgment(r)).map(r=>{const j=latestJudgment(r);return `<article class="record-judgment"><img src="${esc(r.image)}" alt=""><div><small>판단 ${stateChip(j.label)}</small><h3>${esc(canvasTitle(r))}</h3><p>${j.reason?esc(j.reason):'이유 미기록'}</p>${button('canvas-summary-reason',j.reason?'이유 고치기':'이유 적기','ghost',`data-id="${r.id}"`)}</div></article>`;}).join(''):''}${notes.filter(n=>recordFilter==='all'||recordFilter===n.kind).map(n=>`<article><small>${noteKinds[n.kind]} · 직접 기록</small><h3>${esc(n.text)}</h3><p>내가 한 말: “${esc(n.original_text)}”</p>${button('note-edit','고치기','ghost',`data-id="${n.id}"`)}</article>`).join('')}${!notes.length&&!criteria.length&&!items.some(r=>latestJudgment(r))?'<p class="muted">기준과 판단, 탐색하며 발견한 내용을 여기에 남겨요.</p>':''}</div><small>발언 원문과 이전 기록은 그대로 남아요.</small></section>`;
}
function resultList(){return `<section class="result-list"><header><h2>결과 ${canvasItems().length}</h2>${button('upload','이미지 붙여넣기')}</header>${canvasItems().sort((a,b)=>(latestJudgment(a)?.label==='EXCLUDE')-(latestJudgment(b)?.label==='EXCLUDE')).map(r=>`<button class="result-list-item ${latestJudgment(r)?.label==='EXCLUDE'?'excluded':''}" data-action="canvas-select" data-id="${r.id}" aria-pressed="${attached===r.id}"><img src="${esc(r.image)}" alt="${esc(canvasTitle(r))}"><span>${esc(canvasTitle(r))}${stateChip(latestJudgment(r)?.label)}</span></button>`).join('')||'<p>AI 도구에서 만든 이미지를 붙여 넣으면 여기서 나란히 볼 수 있어요.</p>'}</section>`;}
function noteEditor(id,source){const n=(state.notes||[]).find(n=>n.id===id),turn=state.rounds.flatMap(r=>r.turns).find(t=>t.id===source);openModal(`<h2>기록 ${n?'고치기':'남기기'}</h2><form id="note-editor" data-id="${id||''}" data-source="${source||''}"><label>종류<select name="kind">${Object.entries(noteKinds).map(([v,t])=>`<option value="${v}" ${n?.kind===v?'selected':''}>${t}</option>`).join('')}</select></label><label>내가 한 말</label><blockquote>${esc(n?.original_text||turn?.content||'직접 적은 내용을 원문으로 남겨요.')}</blockquote><p>원래 한 말은 그대로 두고, 정리만 고칠 수 있어요.</p><label>정리<textarea name="text" required maxlength="20000">${esc(n?.text||turn?.content||'')}</textarea></label><p class="error" id="note-error" role="alert"></p><div class="actions"><button type="submit" class="primary">저장</button>${button('close-modal','취소')}${n?button('note-delete','이 기록 지우기','ghost',`data-id="${n.id}"`):''}</div></form>`);}
async function recordsAction(action,node){
 if(action==='record-filter'){recordFilter=node.dataset.value;render();return true;}
 if(action==='record-layout'){exploreLayout=exploreLayout==='canvas'?'list':'canvas';render();return true;}
 if(action==='note-new'||action==='note-edit'||action==='note-from-turn'){noteEditor(action==='note-edit'?node.dataset.id:null,action==='note-from-turn'?node.dataset.id:null);return true;}
 if(action==='note-delete'){const n=state.notes.find(n=>n.id===node.dataset.id);await api('/notes',{previous_id:n.id,kind:n.kind,text:n.text,deleted:true});await refresh();modal.close();render();return true;}
 if(action==='question-skip'){await api('/questions/skip',{turn_id:node.dataset.id});if(responseTo===node.dataset.id)responseTo=null;await refresh();render();return true;}
 return false;
}
document.addEventListener('submit',async e=>{if(e.target.id!=='note-editor')return;e.preventDefault();const f=e.target,b=f.querySelector('[type=submit]');b.disabled=true;try{await api('/notes',{kind:f.elements.kind.value,text:f.elements.text.value,previous_id:f.dataset.id||null,source_turn_id:f.dataset.source||null});await refresh();modal.close();render();toast('기록을 저장했어요.');}catch(err){$('#note-error').textContent=err.message;b.disabled=false;}});

function renderGuideExample(){
 const cups=results().slice(0,3),step=guide.step;
 app.innerHTML=`<header class="design-header"><b>탐색 기록</b><span>사용 안내 · 연습용 예시</span></header><main class="guide-example"><section id="guide-criterion" class="card-strip"><b>1순위 기준</b> 손에 쥐기 편할 것 <small>(연습용 예시)</small></section><div class="guide-demo-grid"><section class="guide-demo-canvas"><div id="guide-upload"><b>이미지 3 · 연결 2</b><button>＋ 이미지 올리기</button></div><svg viewBox="0 0 600 400" aria-hidden="true"><path d="M160 100 C300 100 280 210 380 210 M160 320 C300 320 280 210 380 210" fill="none" stroke="#111" stroke-width="2"/></svg>${cups.map((r,i)=>`<article class="guide-cup cup-${i}"><img src="${esc(r.image)}" alt="컵 ${ordinalName(i)}"><b>컵 ${ordinalName(i)}</b>${stateChip(['HOLD',null,'SELECT'][i])}</article>`).join('')}${step===1?'<div class="guide-source"><b>어디서 이어졌나요?</b><p>□ 컵 A　□ 컵 B　　새로 시작</p><small>여러 이미지를 고를 수 있어요.</small></div>':''}</section><section id="guide-chat" class="guide-demo-chat"><b>컵 C</b><div id="guide-judgment">${Object.entries(names).map(([k,v])=>`<span class="judgment-chip chip-${k}">${v}</span>`).join('')}</div><p class="guide-ai">보이는 대로 말해 보세요.</p><p class="guide-student">손잡이가 커서 잡기 편해 보여요.</p><section id="guide-confirm" class="criterion-review"><small>1순위 기준 · 정리 제안 · 확인 전</small><h3>손에 쥐기 편하고, 뜨거워도 잡을 수 있게</h3><p>확인 전에는 지금 기준이 바뀌지 않아요.</p><div class="actions"><button class="primary">맞아요</button><button>고칠게요</button></div></section></section></div><p>안내용 예시예요. 여기서 보이는 말과 판단은 연구 기록에 저장되지 않아요.</p></main>`;
}

boot().catch(error=>{app.innerHTML='<p class="loading">앱을 열지 못했어요. 새로고침해주세요.</p>';toast(error.message);});
