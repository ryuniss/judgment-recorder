"""Latest uploaded HTML and real app: initial/current/pending criteria and confirmation timeline.
Synthetic fixture data; provider replies are controlled, never production research records.
"""
import os,re,base64,gzip,json,tempfile,threading,shutil
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright,expect
from companion.server import Store,make_server
from companion.q6 import Q6
from companion.tests.test_q6 import response

INITIAL='눈부시지 않을 것. 밤늦게 오래 작업하는 사람이 쓰니까'
CURRENT='눈부심을 막으면서 손 밑은 밝게'
PROPOSAL='광원은 숨기고, 빛은 넓게'
QUOTE='눈부심은 그대로 막아요. 광원이 안 보이니까요. 대신 빛은 넓게 퍼져야 한다는 게 더 분명해졌어요.'
def reference_assets():
 s=Path('design/redesign-reference.html').read_text();manifest=json.loads(re.search(r'<script type="__bundler/manifest">(.*?)</script>',s,re.S)[1])
 for v in manifest.values():
  if v['mime']!='text/html':continue
  raw=base64.b64decode(v['data']);html=(gzip.decompress(raw) if v.get('compressed') else raw).decode()
  if '<title>탐색 캔버스' not in html:continue
  assets=json.loads(re.search(r'<script type="__bundler/manifest">(.*?)</script>',html,re.S)[1]);template=json.loads(re.search(r'<script type="__bundler/template">(.*?)</script>',html,re.S)[1]);images=[]
  for key in dict.fromkeys(re.findall(r'<img src="([^"]+)"',template)):
   v=assets[key];raw=base64.b64decode(v['data']);raw=gzip.decompress(raw) if v.get('compressed') else raw;images.append('data:'+v['mime']+';base64,'+base64.b64encode(raw).decode())
  return html,images
 raise AssertionError('Reference 06 missing')
def run():
 output=Path(os.environ.get('QA_OUTPUT','work/browser-check'));output.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'AI_MODE':'live','COOKIE_SECURE':'0','OPENAI_API_KEY':'test-fixture'}):
  html,images=reference_assets();store=Store(Path(tmp)/'db.sqlite');code=store.create_participant();pid=store.participant(store.login(code));pr=store.start(pid,True);store.checkpoint(pid,pr);store.record(pid,pr,{});store.flags(pid,{'intro_seen':True,'checkpoint_seen':True})
  store.card(pid,{'priority':INITIAL,'secondary':'손 밑은 밝을 것','question':'눈부시지 않으면서 손 밑은 밝게 할 수 있을까?'})
  rid=store.start(pid);ids=[store.upload(pid,rid,{'image':image,'request_id':str(i)}) for i,image in enumerate(images)]
  for i,label in enumerate(['EXCLUDE','HOLD','SELECT']):store.judgment(pid,rid,{'result_id':ids[i],'label':label,'reason':'광원은 안 보이는데 책상 전체가 밝아요.' if i==2 else '','request_id':'j'+str(i)})
  for result_id,title in zip(ids,['깊은 갓','확산 패널','벽 반사']):store.name_result(pid,{'result_id':result_id,'title':title})
  store.lineage(pid,rid,{'results':[{'result_id':ids[2],'parent_ids':ids[:2]}]})
  question=Q6.replace('[카드의 1순위 기준]',INITIAL)
  with patch('urllib.request.urlopen',return_value=response({'question_id':'Q6','reply':question})):
   store.turn(pid,rid,{'content':'깊은 갓을 제외하고 개방된 형태를 골랐어요.','result_id':ids[0],'request_id':'q'})
  qid=store.state(pid)['rounds'][-1]['turns'][-1]['id'];quote='눈부심만 막으면 안 되고, 손 밑도 밝아야 해서요.'
  with patch('urllib.request.urlopen',return_value=response({'question_id':'NONE','reply':'','criterion_proposal':{'text':CURRENT,'quote':quote}})):
   store.turn(pid,rid,{'content':quote,'result_id':ids[0],'request_id':'first-change','response_to':qid})
  first=store.state(pid)['criteria']['changes'][0]['id'];store.confirm_criterion(pid,first,{'change_type':'REFINE','text':CURRENT,'rank':1})
  with patch('urllib.request.urlopen',return_value=response({'question_id':'NONE','reply':'','criterion_proposal':{'text':PROPOSAL,'quote':QUOTE}})):
   store.turn(pid,rid,{'content':QUOTE,'result_id':ids[2],'request_id':'second-change'})
  server=make_server(store,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    # Render the exact supplied 06 in a separate, isolated page for visual comparison.
    ref=browser.new_page(viewport={'width':1440,'height':1100});ref.route('http://reference.local/**',lambda route:route.fulfill(body=html,content_type='text/html'));ref.goto('http://reference.local/');expect(ref.get_by_text('처음 기준과의 관계',exact=True)).to_be_visible();ref.screenshot(path=str(output/'reference-06.png'),full_page=False);ref.close()
    page.goto(base);page.screenshot(path=str(output/'latest-login.png'),full_page=True);page.locator('#code').fill(code);page.get_by_role('button',name='탐색 열기').click();page.locator('.image-node').nth(2).click()
    review=page.locator('.criterion-review');expect(review).to_be_visible();expect(review.locator('[data-action="criterion-type"]')).to_have_count(5);expect(review.locator('[aria-pressed=true]')).to_have_count(0);expect(review.locator('[data-action="criterion-confirm"]')).to_be_disabled()
    expect(page.locator('.criterion-evolution')).to_contain_text(INITIAL);expect(page.locator('.criterion-pending')).to_contain_text(PROPOSAL);assert store.state(pid)['card']['priority']==CURRENT
    page.screenshot(path=str(output/'latest-06-desktop.png'),full_page=True)
    page.locator('[data-action="criterion-timeline"]').click();expect(page.locator('.timeline-step')).to_have_count(3);expect(page.locator('.timeline-step.pending')).to_contain_text('유형 고르기 전');expect(page.locator('.criteria-timeline')).to_contain_text('Q6에 대한 응답');expect(page.locator('.criteria-timeline')).to_contain_text('연결된 질문 없음');page.screenshot(path=str(output/'latest-03-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(output/'latest-03-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('[data-action="criterion-open"]').click();expect(page.locator('#modal .criterion-review')).to_be_visible();page.locator('#modal [data-action="criterion-type"][data-value="REFINE"]').click();page.locator('#modal [data-action="criterion-edit"]').click();page.locator('#modal textarea').fill(PROPOSAL+' (학생이 고친 말)')
    page.route('**/api/criteria/*/confirm',lambda route:route.abort(),times=1);page.locator('#modal [data-action="criterion-confirm"]').click();expect(page.locator('#modal .criterion-review-error')).not_to_be_empty();expect(page.locator('#modal textarea')).to_have_value(PROPOSAL+' (학생이 고친 말)');assert store.state(pid)['card']['priority']==CURRENT
    page.screenshot(path=str(output/'latest-confirmation-mobile.png'),full_page=True);page.locator('#modal [data-action="criterion-confirm"]').click();expect(page.locator('#modal')).not_to_be_visible();expect(page.locator('.timeline-step.pending')).to_have_count(0);expect(page.locator('.timeline-step.current')).to_contain_text('학생 수정·확인')
    state=store.state(pid);assert state['criteria']['initial']['priority']==INITIAL;assert state['card']['priority']==PROPOSAL+' (학생이 고친 말)'
    page.locator('[data-action="canvas-back"]').click();page.locator('[data-action="canvas-tab"][data-tab="chat"]').click();page.screenshot(path=str(output/'latest-06-mobile.png'),full_page=True)
    page.locator('[data-action="criterion-from-turn"]').click();page.locator('#new-criterion').fill('내가 직접 추가한 기준');page.locator('[data-action="criterion-propose"]').click();expect(page.locator('#modal .criterion-review')).to_be_visible();assert store.state(pid)['card']['priority']==PROPOSAL+' (학생이 고친 말)';page.locator('#modal [data-action="criterion-reject"]').click();expect(page.locator('#modal')).not_to_be_visible()
    page.locator('[data-action="canvas-tab"][data-tab="records"]').click();expect(page.locator('.record-panel')).to_be_visible()
    page.locator('[data-action="note-new"]').click();page.locator('#note-editor textarea').fill('깊은 갓은 책상 가장자리가 어둡다');page.locator('#note-editor [type=submit]').click();expect(page.locator('#modal')).not_to_be_visible();expect(page.locator('.record-panel')).to_contain_text('깊은 갓은 책상 가장자리가 어둡다')
    page.locator('[data-action="note-edit"]').click();page.locator('#note-editor textarea').fill('갓의 깊이와 밝아지는 범위를 함께 살핀다');page.locator('#note-editor [type=submit]').click();expect(page.locator('#modal')).not_to_be_visible();assert store.state(pid)['notes'][-1]['original_text']=='깊은 갓은 책상 가장자리가 어둡다'
    page.screenshot(path=str(output/'latest-records-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1100});page.locator('[data-action="record-layout"]').click();expect(page.locator('.list-layout')).to_be_visible();expect(page.locator('.record-panel')).to_contain_text('갓의 깊이와 밝아지는 범위를 함께 살핀다');page.screenshot(path=str(output/'latest-02-desktop.png'),full_page=True)
    page.locator('[data-action="note-edit"]').click();page.locator('[data-action="note-delete"]').click();expect(page.locator('#modal')).not_to_be_visible();expect(page.locator('[data-action="note-edit"]')).to_have_count(0);assert len(store.state(pid)['notes'])==3
    page.locator('[data-action="record-layout"]').click();page.locator('[data-action="canvas-tab"][data-tab="chat"]').evaluate('(e)=>e.click()')
    # Image names are student input, including literal HTML-like characters.
    title='"><img src=x onerror="window.titleInjected=1"> & 이름'
    page.locator('[data-action="canvas-name"]').click();page.locator('#result-title').fill(title);page.locator('[data-action="canvas-name-save"]').click();expect(page.locator('#modal')).not_to_be_visible()
    expect(page.locator('[data-action="canvas-name"]')).to_have_text('C '+title);expect(page.locator('img[src="x"]')).to_have_count(0);assert not page.evaluate('window.titleInjected || false')
    page.locator('[data-action="canvas-enlarge"]').click();expect(page.locator('#modal h2')).to_have_text('C '+title);page.locator('#modal [data-action="close-modal"]').click()
    page.locator('[data-action="canvas-summary"]').first.click();expect(page.locator('.summary-results')).to_contain_text(title);expect(page.locator('img[src="x"]')).to_have_count(0)
    assert not errors,errors
    report={'passed':True,'fixture_data':True,'initial_preserved':True,'pending_does_not_replace_current':True,'five_types_no_default':True,'confirmation_retry':True,'question_context_separate_from_author':True,'reference':'design/redesign-reference.html','console_errors':errors};(output/'criteria-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report));browser.close()
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':run()
