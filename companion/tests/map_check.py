"""Browser regression for student-chosen lineage and the exploration map."""
import base64,json,os,shutil,tempfile,threading
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from companion.server import Store,make_server

def run():
 output=Path(os.environ.get('QA_OUTPUT','work/browser-check'));output.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory() as temp:
  os.environ['COOKIE_SECURE']='0';os.environ['AI_MODE']='demo'
  store=Store(Path(temp)/'test.sqlite3');code=store.create_participant();pid=store.participant(store.login(code))
  practice=store.start(pid,True);store.checkpoint(pid,practice);store.record(pid,practice,{})
  store.flags(pid,{'intro_seen':True,'checkpoint_seen':True})
  rid=store.start(pid);results=[]
  texts=['형태의 중심이 흐려진 느낌이에요. 다음에는 다리를 단순하게 해볼래요.','곡선은 좋은데 다리가 좀 애매해요.']
  for i in range(2):
   image='data:image/jpeg;base64,'+base64.b64encode(Path(f'companion/static/assets/cup-{i+1}.jpg').read_bytes()).decode()
   result=store.upload(pid,rid,{'image':image,'request_id':f'image-{i}' });results.append(result)
   store.turn(pid,rid,{'content':texts[i],'result_id':result,'request_id':f'turn-{i}'})
  store.checkpoint(pid,rid)
  store.record(pid,rid,{'decisions':[{'result_id':r,'label':['EXCLUDE','HOLD'][i],'reason':texts[i]} for i,r in enumerate(results)],'moves':[{'content':'다리를 더 단순하게 해볼래요.','links':results},{'content':'곡선의 크기를 바꿔볼래요.','links':[results[1]]}]})
  server=make_server(store,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base);page.locator('#code').fill(code);page.get_by_role('button',name='탐색 열기').click()
    expect(page.locator('.workspace-heading')).to_contain_text('이미지 작업대');expect(page.locator('.chat-heading')).to_contain_text('대화')
    assert page.locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor') in ['rgba(0, 0, 0, 0)','rgb(255, 255, 255)']
    assert page.locator('#stage').evaluate('(e)=>getComputedStyle(e).backgroundColor')!=page.locator('.side').evaluate('(e)=>getComputedStyle(e).backgroundColor')
    assert float(page.locator('#stage').evaluate('(e)=>parseFloat(getComputedStyle(e).borderTopLeftRadius)'))<=12
    page.screenshot(path=str(output/'workspace-white-desktop.png'),full_page=True)
    with page.expect_file_chooser() as chooser:page.locator('#upload-target').click()
    chooser.value.set_files(str(Path('companion/static/assets/cup-3.jpg').resolve()))
    expect(page.locator('.source-modal')).to_be_visible();expect(page.locator('.source-choice')).to_have_count(2)
    expect(page.locator('.source-choice[aria-pressed="true"]')).to_have_count(0)
    page.locator('.source-choice').nth(0).click();page.locator('.source-choice').nth(1).click()
    page.screenshot(path=str(output/'source-connections-desktop.png'),full_page=True)
    page.route('**/api/rounds/*/sources',lambda route:route.abort(),times=1)
    page.locator('[data-action="source-save"]').click();expect(page.locator('#source-error')).not_to_be_empty()
    expect(page.locator('.source-choice[aria-pressed="true"]')).to_have_count(2)
    page.locator('[data-action="source-save"]').click();expect(page.locator('#modal')).not_to_be_visible()
    page.reload();expect(page.locator('.tile')).to_have_count(1)
    page.locator('[data-action="sources"]').click();expect(page.locator('.source-choice[aria-pressed="true"]')).to_have_count(2)
    page.locator('[data-action="source-skip"]').click()
    page.locator('#first-result').click();page.locator('[data-action="attach"]').click();page.locator('#message').fill('이번 형태로 이어가볼래요.');page.get_by_role('button',name='보내기',exact=True).click();expect(page.locator('#message')).to_have_value('')
    page.locator('[data-action="checkpoint"]').click();page.get_by_role('radio',name='선택',exact=True).click();page.locator('[data-action="checkpoint-next"]').click()
    page.locator('#move-0').fill('다음에는 비율을 바꿔볼래요.');page.locator('[data-action="link"]').first.click();page.locator('[data-action="record"]').click()
    expect(page.locator('.banner')).to_contain_text('라운드 2을 기록했어요')
    page.locator('[data-action="map"]').click();expect(page.locator('.map-round')).to_have_count(2)
    expect(page.locator('.node-result')).to_have_count(3);expect(page.locator('.node-decision')).to_have_count(3);expect(page.locator('.node-move')).to_have_count(3)
    expect(page.locator('.edge-continuation')).to_have_count(2);expect(page.locator('.edge-intent')).to_have_count(4)
    assert '연습' not in page.locator('.map-columns').inner_text()
    page.screenshot(path=str(output/'exploration-map-desktop.png'),full_page=True)
    page.locator('.node-result').nth(2).click();expect(page.locator('.map-detail')).to_contain_text('이 기록으로 이어진 것')
    expect(page.locator('.map-detail .map-related').first.locator('li')).to_have_count(2)
    page.locator('.node-decision').first.click();expect(page.locator('.map-original')).to_have_text(texts[0])
    expect(page.locator('.map-node.selected')).to_have_count(1)
    page.screenshot(path=str(output/'exploration-map-detail.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(output/'exploration-map-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('[data-action="map-round"]').nth(1).click()
    expect(page.locator('.map-round').nth(1)).to_be_in_viewport()
    page.locator('[data-action="close-modal"]').click()
    page.screenshot(path=str(output/'workspace-white-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1000})
    # A later upload can be explicitly skipped; no speculative lineage is created.
    with page.expect_file_chooser() as chooser:page.locator('#upload-target').click()
    chooser.value.set_files(str(Path('companion/static/assets/cup-1.jpg').resolve()))
    page.locator('[data-action="source-skip"]').click();expect(page.locator('.tile')).to_have_count(1)
    page.locator('[data-action="checkpoint"]').click();page.locator('[data-action="checkpoint-next"]').click();page.locator('[data-action="record"]').click()
    page.locator('[data-action="map"]').click();expect(page.locator('.map-round')).to_have_count(3)
    expect(page.locator('.edge-continuation')).to_have_count(2)
    page.screenshot(path=str(output/'exploration-map-three-rounds.png'),full_page=True)
    history=store.history(pid);assert len(history['result_move_links'])==2
    assert all(not r['is_practice'] for rows in history.values() for r in rows)
    assert not errors,errors
    report={'passed':True,'rounds':3,'student_source_links':2,'skipped_round_has_no_inferred_links':True,'console_errors':errors,'viewports':['1440x1000','390x844']}
    (output/'map-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report));browser.close()
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':run()
