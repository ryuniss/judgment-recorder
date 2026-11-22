"""Supplied 06 design: multi-parent upload, live judgment, per-image chat, mobile tabs and card."""
import os,base64,json,tempfile,threading,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from companion.server import Store,make_server

def run():
 output=Path(os.environ.get('QA_OUTPUT','work/browser-check'));output.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory() as tmp:
  os.environ['AI_MODE']='demo';os.environ['COOKIE_SECURE']='0'
  store=Store(Path(tmp)/'db.sqlite');code=store.create_participant();pid=store.participant(store.login(code))
  pr=store.start(pid,True);store.checkpoint(pid,pr);store.record(pid,pr,{});store.flags(pid,{'intro_seen':True,'checkpoint_seen':True})
  rid=store.start(pid);ids=[]
  for i in range(2):ids.append(store.upload(pid,rid,{'image':'data:image/jpeg;base64,'+base64.b64encode(Path(f'companion/static/assets/cup-{i+1}.jpg').read_bytes()).decode(),'request_id':str(i)}))
  server=make_server(store,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1040});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}');page.locator('#code').fill(code);page.get_by_role('button',name='탐색 열기').click();expect(page.locator('.image-node')).to_have_count(2)
    page.locator('[data-action="criterion"]').first.click();page.locator('#issue').fill('책상 조명 탐색');page.locator('[data-action="card-step"][data-step="1"]').last.click();page.locator('#image').fill('빛이 넓게 퍼지는 조명');page.locator('[data-action="card-step"][data-step="2"]').last.click();page.locator('#priority').fill('눈부시지 않을 것. 밤늦게 오래 작업하는 사람이 쓰니까');page.locator('#secondary').fill('손 밑은 밝을 것');page.screenshot(path=str(output/'design-card-desktop.png'),full_page=True)
    page.locator('[data-action="card-step"][data-step="3"]').last.click();page.locator('#question').fill('눈부시지 않으면서 손 밑은 밝게 할 수 있을까?')
    page.route('**/api/card',lambda route:route.abort(),times=1);page.locator('[data-action="card-save"]').click();expect(page.locator('#criterion-error')).not_to_be_empty();expect(page.locator('#question')).not_to_be_empty();page.locator('[data-action="card-save"]').click();expect(page.locator('.card-strip')).to_contain_text('손 밑은 밝게')
    page.locator('.image-node').nth(0).click();page.locator('[data-action="canvas-judge"][data-value="EXCLUDE"]').click();expect(page.locator('.image-node.is-excluded')).to_have_count(1)
    page.locator('.image-node').nth(1).click();page.locator('[data-action="canvas-judge"][data-value="HOLD"]').click();expect(page.locator('[data-action="canvas-judge"][aria-pressed=true]')).to_have_text('보류')
    with page.expect_file_chooser() as chooser:page.locator('#upload-target').click()
    chooser.value.set_files(str(Path('companion/static/assets/cup-3.jpg').resolve()))
    expect(page.locator('.lineage-modal')).to_be_visible();page.locator('[data-action="lineage-toggle"]').nth(0).click();page.locator('[data-action="lineage-toggle"]').nth(1).click();page.screenshot(path=str(output/'design-source-desktop.png'),full_page=True)
    page.route('**/api/rounds/*/lineage',lambda route:route.abort(),times=1);page.locator('[data-action="lineage-save"]').click();expect(page.locator('#lineage-error')).not_to_be_empty();expect(page.locator('[data-action="lineage-toggle"][aria-pressed=true]')).to_have_count(2);page.locator('[data-action="lineage-save"]').click();expect(page.locator('#modal')).not_to_be_visible();expect(page.locator('.lineage-edge')).to_have_count(2)
    expect(page.locator('[data-action="canvas-judge"][aria-pressed=true]')).to_have_count(0)
    page.locator('[data-action="canvas-judge"][data-value="UNDECIDED"]').click();expect(page.locator('[data-action="canvas-judge"][aria-pressed=true]')).to_have_text('아직 모르겠어요')
    page.locator('[data-action="canvas-judge"][data-value="SELECT"]').click();expect(page.locator('.selected-header')).to_contain_text('아직 모르겠어요 → 선택')
    page.locator('#message').fill('광원은 안 보이는데 책상 전체가 밝아요.');page.locator('#compose button[type=submit]').click();expect(page.locator('.canvas-message.user')).to_contain_text('책상 전체가 밝아요');expect(page.locator('#message')).to_have_value('')
    page.locator('[data-action="canvas-reason"]').click();page.locator('#canvas-reason').fill('광원은 안 보이는데 책상 전체가 밝아요.');page.locator('[data-action="canvas-reason-save"]').click();expect(page.locator('#modal')).not_to_be_visible()
    page.screenshot(path=str(output/'design-canvas-desktop.png'),full_page=True)
    page.locator('#message').fill('C에 남긴 초안');page.locator('.image-node').first.click();expect(page.locator('.canvas-message.user')).to_have_count(0);page.locator('#message').fill('A에 남긴 초안');page.locator('.image-node').nth(2).click();expect(page.locator('#message')).to_have_value('C에 남긴 초안');page.locator('#message').fill('')
    page.reload();page.locator('.image-node').nth(2).click();expect(page.locator('.lineage-edge')).to_have_count(2);expect(page.locator('.selected-header')).to_contain_text('출처 A · B')
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(output/'design-canvas-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('[data-action="canvas-tab"][data-tab="chat"]').click();expect(page.locator('.design-chat')).to_be_visible();page.screenshot(path=str(output/'design-chat-mobile.png'),full_page=True)
    page.locator('[data-action="canvas-summary"]').first.click();expect(page.locator('.summary-results article')).to_have_count(3);page.screenshot(path=str(output/'design-summary-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1040});page.screenshot(path=str(output/'design-summary-desktop.png'),full_page=True);page.locator('[data-action="canvas-back"]').click()
    page.locator('[data-action="checkpoint"]').click();expect(page.locator('.result-check')).to_be_visible();expect(page.locator('[data-action="checkpoint-next"]')).to_be_enabled();page.locator('[data-action="checkpoint-next"]').click();page.locator('[data-action="record"]').click();expect(page.locator('.canvas-panel')).to_be_visible()
    history=store.history(pid);assert len(history['result_source_links'])==2
    assert all(not x['is_practice'] for rows in history.values() for x in rows)
    assert not errors,errors
    report={'passed':True,'multi_parent_sources':2,'excluded_parent_kept':True,'judgment_history':True,'card_and_per_image_drafts':True,'mobile_tabs':True,'console_errors':errors};(output/'canvas-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report));browser.close()
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':run()
