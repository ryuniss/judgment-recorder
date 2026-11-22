import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const wait=async(fn,message)=>{const end=Date.now()+8000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+message);};
test('new participant: spotlight → practice → round 1 → confirmation → history, with failed writes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'companion-ui-'));const database=join(dir,'test.sqlite');
 const setup=spawnSync('python3',['-c',`from companion.server import Store; print(Store(${JSON.stringify(database)}).create_participant())`],{encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);const code=setup.stdout.trim();
 const server=spawn('python3',['-u','-c',`from companion.server import Store,make_server; s=make_server(Store(${JSON.stringify(database)}),port=0); print(s.server_port,flush=True); s.serve_forever()`],{env:{...process.env,AI_MODE:'demo',COOKIE_SECURE:'0',ADMIN_KEY:'test-admin-12345678901234567890'}});
 let port='';server.stdout.on('data',chunk=>{port+=chunk;});let dom;
 try{
  await wait(()=>port.trim(),'test server');const base=`http://127.0.0.1:${port.trim()}`;let cookie='',failTurn=false,failRecord=false;const calls=[];
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM(readFileSync('companion/static/index.html','utf8'),{url:base,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
  w.Element.prototype.scrollIntoView=function(){};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.fetch=async(path,options={})=>{calls.push({path,body:options.body});if(failTurn&&path.endsWith('/turn'))throw Error('offline');if(failRecord&&path.endsWith('/record'))throw Error('offline');const response=await fetch(base+path,{...options,headers:{...options.headers,Cookie:cookie}});const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];if(path==='/api/state'||path==='/api/history'){
   const value=await response.json();const rows=path==='/api/state'?value.rounds.flatMap(r=>r.results):value.results;
   rows.forEach((r,i)=>{if(i%3===0)r.label=null;else if(i%3===1)delete r.label;else r.label='';});
   return {ok:response.ok,status:response.status,json:async()=>value};
  }return response;};
  w.eval(readFileSync('companion/static/app.js','utf8'));
  const q=s=>w.document.querySelector(s);const click=s=>{const el=q(s);assert.ok(el,s);assert.equal(el.disabled,false,s+' enabled');el.click();};const input=(s,value)=>{q(s).value=value;q(s).dispatchEvent(new w.Event('input',{bubbles:true}));};
  await wait(()=>q('#login'),'login');input('#code',code);q('#login').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>q('.coach-card'),'first guide');assert.match(q('#coach-title').textContent,/결과를 올려요/);
  click('[data-action="guide-next"]');assert.match(q('#coach-title').textContent,/크게 보여요/);
  click('[data-action="guide-next"]');assert.ok(q('#attach-button'));assert.equal(q('.attachment'),null,'guide does not attach result');
  click('[data-action="guide-next"]');click('[data-action="guide-next"]');assert.match(q('[data-action="guide-next"]').textContent,/연습 라운드 시작/);click('[data-action="guide-next"]');
  await wait(()=>!q('.coach-card'),'guide closed');assert.equal(q('#app').inert,false);
  click('#first-result');assert.ok(q('.viewer'));assert.equal(q('.attachment'),null,'viewing alone does not attach');click('[data-action="attach"]');assert.match(q('.attachment').textContent,/A를 보며/);
  const original='손잡이가 좀 두꺼워 보여요.\n아직 정하지 못했어요.';input('#message',original);failTurn=true;q('#compose').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>q('#send-error')?.textContent,'failed send');assert.equal(q('#message').value,original,'failed send preserves text');
  failTurn=false;q('#compose').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>q('.say')?.textContent===original&&q('#message')?.value==='','successful send');
  click('[data-action="grid"]');click('[data-action="view"][aria-label="B 크게 보기"]');click('[data-action="attach"]');input('#message','곡선은 좋은데 다리가 좀 애매해요.');q('#compose').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>q('#message')?.value==='','second result message');
  click('[data-action="checkpoint"]');await wait(()=>q('.result-check')&&q('.coach-card'),'checkpoint and Coach6');assert.match(q('#coach-title').textContent,/내 판단/);click('[data-action="guide-next"]');await wait(()=>!q('.coach-card'),'close Coach6');
  assert.equal(q('[data-action="record"]'),null);assert.equal(q('[data-action="checkpoint-next"]').disabled,true);assert.doesNotMatch(q('#stage').textContent,/null|undefined/);assert.equal(q('[data-action="link"]'),null);assert.equal(q('[data-reason]').value,original);assert.equal(q('[role="radio"][aria-checked="true"]'),null,'no inferred default label');
  assert.equal(w.document.querySelectorAll('.result-check').length,1,'one result at a time');assert.match(q('#checkpoint-progress').textContent,/2개 중 0개/);
  click('[data-action="label"][data-value="UNDECIDED"]');assert.equal(q('[data-action="checkpoint-next"]').disabled,true);assert.match(q('#checkpoint-progress').textContent,/2개 중 1개/);
  input('[data-reason]','내가 고친 말');assert.equal(q('.edited-tag').hidden,false);assert.equal(q('.original').hidden,false);click('[data-action="restore"]');assert.equal(q('[data-reason]').value,original);
  click('.result-pick[aria-label="결과 B"]');click('[data-action="label"][data-value="HOLD"]');assert.equal(q('[data-action="checkpoint-next"]').disabled,false);assert.match(q('#checkpoint-progress').textContent,/2개 중 2개/);
  click('.result-pick[aria-label="결과 C"]');assert.equal(q('[data-action="checkpoint-next"]').disabled,false,'viewing optional result does not gate progress');
  const beforeNext=calls.length;click('[data-action="checkpoint-next"]');assert.equal(calls.length,beforeNext,'step change is frontend-only');assert.equal(q('.result-check'),null);assert.equal(w.document.querySelectorAll('.judgment-summary li').length,2);assert.equal(w.document.querySelectorAll('.chip').length,2);assert.ok([...w.document.querySelectorAll('.chip')].every(x=>!x.disabled));assert.doesNotMatch(q('#stage').textContent,/null|undefined|판단을 고르면/);
  click('[data-action="edit-judgment"]');assert.equal(q('[data-reason]').value,original);click('[data-action="checkpoint-next"]');
  input('[data-move]','다음에는 다시 볼래요.');click('[data-action="link"]');click('[data-action="add-move"]');input('#move-1','다른 형태도 살펴볼래요.');click('[data-action="link"][data-index="1"]');click('[data-action="checkpoint-back"]');click('[data-action="checkpoint-next"]');assert.equal(q('#move-1').value,'다른 형태도 살펴볼래요.');failRecord=true;click('[data-action="record"]');await wait(()=>q('#record-error')?.textContent,'record failed');assert.equal(q('.summary-reason').textContent,original);assert.equal(q('[data-move]').value,'다음에는 다시 볼래요.');assert.match(q('[data-action="record"]').textContent,/다시 기록/);
  failRecord=false;click('[data-action="record"]');await wait(()=>q('#modal').open&&q('[data-action="start-real"]'),'practice done');click('[data-action="start-real"]');await wait(()=>q('.team-badge')?.textContent.includes('라운드 1'),'real round 1');assert.equal(q('.practice'),null);
  const state=await (await w.fetch('/api/state')).json();const real=state.rounds.find(r=>!r.is_practice);const image='data:image/jpeg;base64,'+readFileSync('companion/static/assets/cup-1.jpg').toString('base64');
  let response=await w.fetch(`/api/rounds/${real.id}/upload`,{method:'POST',body:JSON.stringify({image,request_id:'fixture'}),headers:{'Content-Type':'application/json'}});assert.equal(response.status,200);
  // Re-enter through the real session to exercise persisted flags and ongoing round restoration.
  w.eval('boot()');await wait(()=>q('.image-node'),'uploaded result');assert.equal(q('.coach-card'),null,'intro appears only once');click('.image-node');input('#message','실제 라운드에서 한 말');q('#compose').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>q('.canvas-message.user p')?.textContent==='실제 라운드에서 한 말'&&q('#message')?.value==='','real message');click('[data-action="checkpoint"]');await wait(()=>q('.result-check'),'real checkpoint');assert.equal(q('.coach-card'),null,'Coach6 appears only once');click('[data-action="label"][data-value="UNDECIDED"]');click('[data-action="checkpoint-next"]');click('[data-action="record"]');await wait(()=>q('.canvas-panel')&&q('.team-badge')?.textContent==='나의 탐색','recorded');click('[data-action="canvas-more"]');await wait(()=>q('[data-action="history"]'),'menu');click('[data-action="history"]');await wait(()=>q('.history-list'),'history');assert.doesNotMatch(q('.history-list').textContent,/연습|손잡이가/);assert.match(q('.history-list').textContent,/아직 모르겠어요/);
  response=await fetch(base+'/api/admin/research',{headers:{Authorization:'Bearer test-admin-12345678901234567890'}});const research=await response.json();assert.equal(research.rounds.length,2);assert.equal(research.rounds[0].number,null);assert.equal(research.rounds[1].number,1);assert.equal(research.decisions.filter(d=>d.is_practice).length,2);assert.equal(research.moves.filter(m=>m.is_practice).length,2);assert.equal(research.decisions.filter(d=>!d.is_practice)[0].label,'UNDECIDED');assert.ok(research.move_decision_links[0].is_practice);
  response=await fetch(base+'/api/admin/export',{headers:{Authorization:'Bearer test-admin-12345678901234567890'}});const exported=await response.json();assert.ok(Object.values(exported).flat().every(r=>!r.is_practice));assert.deepEqual(errors,[]);
 }finally{dom?.window.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(dir,{recursive:true,force:true});}
});
