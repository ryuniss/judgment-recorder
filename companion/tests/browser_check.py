"""Real Chromium regression check. Run from the repo root.
Requires playwright and an installed Chromium (CHROMIUM_PATH optional).
Uses synthetic local participants and an isolated SQLite DB; never touches production.
"""
import json, os, shutil, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from companion.server import Store, make_server

OUTPUT=Path(os.environ.get('QA_OUTPUT','work/browser-check'))
OUTPUT.mkdir(parents=True,exist_ok=True)

def run():
 with tempfile.TemporaryDirectory() as temp:
  store=Store(Path(temp)/'test.sqlite3');code=store.create_participant()
  server=make_server(store,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  os.environ['COOKIE_SECURE']='0';os.environ['AI_MODE']='demo'
  base=f'http://127.0.0.1:{server.server_port}'
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base);page.locator('#code').fill(code);page.get_by_role('button',name='탐색 열기').click()
    expect(page.locator('.coach-card')).to_be_visible()
    assert page.locator('.coach-card').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(22, 22, 22)'
    expect(page.locator('.coach-kicker')).to_have_text('사용 안내')
    page.screenshot(path=str(OUTPUT/'coach1-desktop.png'),full_page=False)
    for i in range(4):page.locator('[data-action="guide-next"]').click()
    page.locator('[data-action="guide-next"]').click()
    expect(page.locator('.coach-card')).to_have_count(0)
    # Empty practice: unspoken results can be skipped and do not block progression.
    page.locator('[data-action="checkpoint"]').click();expect(page.locator('#checkpoint-choices')).to_be_visible()
    expect(page.locator('.coach-card')).to_be_visible()
    ring=page.locator('.coach-ring').bounding_box();choices=page.locator('#checkpoint-choices').bounding_box()
    assert abs(ring['x']-choices['x'])<=5 and abs(ring['width']-choices['width'])<=10
    page.screenshot(path=str(OUTPUT/'coach6-desktop.png'),full_page=False)
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_function("(()=>{const r=document.querySelector('#checkpoint-choices').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()")
    page.screenshot(path=str(OUTPUT/'coach6-mobile.png'),full_page=False)
    ring=page.locator('.coach-ring').bounding_box();choices=page.locator('#checkpoint-choices').bounding_box();card=page.locator('.coach-card').bounding_box()
    assert ring['height']>=choices['height'] and ring['height']>0
    assert card['y']+card['height']<=choices['y'] or card['y']>=choices['y']+choices['height']
    page.keyboard.press('Tab');assert page.locator('.coach-card').evaluate('(e)=>e.contains(document.activeElement)')
    page.keyboard.press('Escape');expect(page.locator('.coach-card')).to_have_count(0)
    page.set_viewport_size({'width':1440,'height':1000})
    expect(page.locator('#checkpoint-progress')).to_have_text('이야기한 결과 0개 중 0개 골랐어요')
    page.locator('[data-action="checkpoint-next"]').click();expect(page.locator('.chip')).to_have_count(0)
    page.locator('[data-action="record"]').click();page.locator('[data-action="start-real"]').click()
    # Upload three actual images through the file-picker flow.
    with page.expect_file_chooser() as chooser:page.locator('#upload-target').click()
    chooser.value.set_files([str(Path(f'companion/static/assets/cup-{i}.jpg').resolve()) for i in (1,2,3)])
    expect(page.locator('.tile')).to_have_count(3)
    messages={'A':'손잡이가 두꺼워 보여요.\n다음에는 손잡이 형태를 바꿔볼래요.','B':'옆면의 곡선이 눈에 들어와요.\n다른 곡선도 살펴볼래요.'}
    for label,content in messages.items():
     if page.locator('[data-action="grid"]').count():page.locator('[data-action="grid"]').click()
     page.get_by_role('button',name=f'{label} 크게 보기',exact=True).click()
     page.get_by_role('button',name=f'{label}를 보며 말하기',exact=True).click()
     page.locator('#message').fill(content);page.get_by_role('button',name='보내기',exact=True).click();expect(page.locator('#message')).to_have_value('')
    page.locator('[data-action="checkpoint"]').click();expect(page.locator('.coach-card')).to_have_count(0)
    expect(page.locator('.result-check')).to_have_count(1)
    expect(page.locator('[data-action="record"]')).to_have_count(0)
    expect(page.locator('[data-action="checkpoint-next"]')).to_be_disabled()
    expect(page.locator('[data-reason]')).to_have_value(messages['A'])
    page.get_by_role('radio',name='제외',exact=True).click()
    page.locator('[data-reason]').fill('학생이 직접 고친 이유예요.');expect(page.locator('.edited-tag')).to_be_visible()
    page.locator('[data-action="restore"]').click();expect(page.locator('[data-reason]')).to_have_value(messages['A'])
    page.locator('.result-pick[aria-label="결과 B"]').click();page.get_by_role('radio',name='아직 모르겠어요',exact=True).click()
    expect(page.locator('#checkpoint-progress')).to_have_text('이야기한 결과 2개 중 2개 골랐어요')
    assert 'null' not in page.locator('#stage').inner_text() and 'undefined' not in page.locator('#stage').inner_text()
    page.screenshot(path=str(OUTPUT/'checkpoint-step1-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUTPUT/'checkpoint-step1-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1440,'height':1000})
    page.locator('.result-pick[aria-label="결과 C"]').click();expect(page.locator('[data-action="checkpoint-next"]')).to_be_enabled()
    page.locator('[data-action="checkpoint-next"]').click();expect(page.locator('.chip')).to_have_count(2)
    expect(page.locator('.judgment-summary li')).to_have_count(2)
    page.locator('#move-0').fill('다음에는 손잡이 형태를 바꿔볼래요.')
    page.locator('[data-action="link"][data-index="0"]').first.click()
    page.locator('[data-action="add-move"]').click();page.locator('#move-1').fill('다른 곡선도 살펴볼래요.')
    page.locator('[data-action="link"][data-index="1"]').nth(1).click()
    # Step changes preserve both moves and links and make no writes.
    page.locator('[data-action="checkpoint-back"]').click();page.locator('[data-action="checkpoint-next"]').click()
    expect(page.locator('#move-1')).to_have_value('다른 곡선도 살펴볼래요.')
    expect(page.locator('[data-action="link"][aria-pressed="true"]')).to_have_count(2)
    page.reload();expect(page.locator('#move-1')).to_have_value('다른 곡선도 살펴볼래요.')
    expect(page.locator('[data-action="link"][aria-pressed="true"]')).to_have_count(2)
    page.screenshot(path=str(OUTPUT/'checkpoint-step2-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUTPUT/'checkpoint-step2-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1440,'height':1000})
    # A failed final write must keep all inputs and selections.
    page.route('**/api/rounds/*/record',lambda route:route.abort(),times=1)
    page.locator('[data-action="record"]').click();expect(page.locator('#record-error')).not_to_be_empty()
    expect(page.locator('#move-0')).to_have_value('다음에는 손잡이 형태를 바꿔볼래요.')
    page.locator('[data-action="record"]').click();expect(page.locator('.banner')).to_contain_text('라운드 1을 기록했어요')
    page.locator('[data-action="history"]').click();expect(page.locator('.history-list')).to_contain_text('A 제외');expect(page.locator('.history-list')).to_contain_text('B 아직 모르겠어요')
    expect(page.locator('.history-list')).to_contain_text('다른 곡선도 살펴볼래요.')
    page.screenshot(path=str(OUTPUT/'recorded-history-desktop.png'),full_page=True)
    # Prior confirmed decisions are available in the next round, while unchosen C stays absent.
    page.locator('[data-action="close-modal"]').click()
    with page.expect_file_chooser() as chooser:page.locator('#upload-target').click()
    chooser.value.set_files(str(Path('companion/static/assets/cup-1.jpg').resolve()));expect(page.locator('.tile')).to_have_count(1)
    page.locator('[data-action="checkpoint"]').click();page.locator('[data-action="checkpoint-next"]').click()
    expect(page.locator('.chip')).to_have_count(2);expect(page.locator('.chip').first).to_contain_text('라운드 1의 A 제외')
    expect(page.locator('.chip').nth(1)).to_contain_text('라운드 1의 B 아직 모르겠어요')
    # Demonstrate missing legacy names without modifying the backend schema or API.
    def legacy(route):
     response=route.fetch();data=response.json()
     for rnd in data['rounds']:
      for index,result in enumerate(rnd['results']):
       if index%2:result.pop('label',None)
       else:result['label']=None
     route.fulfill(response=response,json=data)
    page.route('**/api/state',legacy);page.reload();expect(page.locator('.chip')).to_have_count(2)
    assert 'null' not in page.locator('#app').inner_text() and 'undefined' not in page.locator('#app').inner_text()
    rows=store.history(research=True)
    real_round=next(r for r in rows['rounds'] if r['number']==1)
    decisions=[r for r in rows['decisions'] if r['round_id']==real_round['id'] and r['status']=='student_confirmed']
    moves=[r for r in rows['moves'] if r['round_id']==real_round['id']]
    assert len(decisions)==2 and len(moves)==2
    assert {d['label'] for d in decisions}=={'EXCLUDE','UNDECIDED'}
    links=[x for x in rows['move_decision_links'] if x['move_id'] in {m['id'] for m in moves}];assert len(links)==2
    assert not errors,errors
    summary={'browser':'Chromium','viewports':['1440x1000','390x844'],'passed':True,'recorded_decisions':len(decisions),'recorded_moves':len(moves),'recorded_links':len(links),'backend_api_changed':False,'console_errors':errors,'screenshots':sorted(x.name for x in OUTPUT.glob('*.png'))}
    (OUTPUT/'verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print(json.dumps(summary,ensure_ascii=False));browser.close()
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':run()
