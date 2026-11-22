"""Real browser + HTTP + SQLite; provider output is a controlled fixture, not a model evaluation."""
import base64,os,json,tempfile,threading,shutil
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright,expect
from companion.server import Store,make_server
from companion.tests.test_q6 import PRIORITY,S3,answer,response
from companion.tests.test_server import PNG

def run():
 output=Path(os.environ.get('QA_OUTPUT','work/browser-check'));output.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'COOKIE_SECURE':'0','AI_MODE':'live','OPENAI_API_KEY':'fixture-key'}):
  store=Store(Path(tmp)/'db.sqlite');code=store.create_participant();pid=store.participant(store.login(code))
  practice=store.start(pid,True);store.checkpoint(pid,practice);store.record(pid,practice,{})
  store.flags(pid,{'intro_seen':True,'checkpoint_seen':True})
  rid=store.start(pid);store.upload(pid,rid,{'image':'data:image/jpeg;base64,'+base64.b64encode(Path('companion/static/assets/cup-1.jpg').read_bytes()).decode(),'request_id':'image'})
  server=make_server(store,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}');page.locator('#code').fill(code);page.get_by_role('button',name='탐색 열기').click()
    page.locator('[data-action=criterion]').first.click();page.locator('[data-action=card-step][data-step="2"]').first.click();page.locator('#priority').fill(PRIORITY);page.locator('[data-action=card-step][data-step="3"]').last.click()
    page.route('**/api/card',lambda route:route.abort(),times=1)
    page.locator('[data-action="card-save"]').click();expect(page.locator('#criterion-error')).not_to_be_empty();expect(page.locator('#question')).to_be_visible()
    page.locator('[data-action="card-save"]').click();expect(page.locator('.card-strip')).to_be_visible()
    page.reload();expect(page.locator('.card-strip')).to_contain_text(PRIORITY)
    page.locator('.image-node').first.click()
    with patch('urllib.request.urlopen',return_value=response(answer())):
     page.locator('#message').fill(S3);page.locator('#compose button[type="submit"]').click()
     expect(page.locator('.side')).to_contain_text(answer()['reply'])
    page.screenshot(path=str(output/'q6-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.locator('[data-action=canvas-tab][data-tab=chat]').click();page.screenshot(path=str(output/'q6-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    event=store.history(research=True)['question_events'][0];assert event['question_id']=='Q6'
    page.locator('[data-action=criterion]').first.click();page.locator('#priority').fill('새 기준');page.locator('[data-action="card-save"]').click();expect(page.locator('.card-strip')).to_be_visible()
    assert json.loads(store.history(research=True)['question_events'][0]['context_json'])['priority']==PRIORITY
    assert not errors,errors
    report={'passed':True,'provider':'fixture, not live model','card_retry_reload':True,'q6_display_and_audit':True,'original_criterion_preserved':True,'console_errors':errors}
    (output/'q6-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report));browser.close()
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':run()
