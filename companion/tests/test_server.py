import base64, json, os, tempfile, threading, unittest, urllib.request, urllib.error
from pathlib import Path
from unittest.mock import patch
from companion.server import Store, Problem, make_server

PNG='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
class StoreFixture:
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'db.sqlite');self.code=self.store.create_participant();self.token=self.store.login(self.code);self.pid=self.store.participant(self.token)
 def tearDown(self):self.temp.cleanup()
 def practice(self):
  rid=self.store.start(self.pid,True);self.store.checkpoint(self.pid,rid);self.store.record(self.pid,rid,{});return rid
 def setup_round(self,practice=True):
  if not practice:self.practice()
  rid=self.store.start(self.pid,practice)
  if not practice:self.store.upload(self.pid,rid,{'image':PNG,'request_id':'upload1'})
  result=self.store.state(self.pid)['rounds'][-1]['results'][0]['id'];return rid,result
 def say(self,rid,result,text='느낌은 있지만 아직 정하지 못했어요.\n다음엔 다시 보고 싶어요.'):
  with patch.dict(os.environ,{'AI_MODE':'demo'}):return self.store.turn(self.pid,rid,{'content':text,'result_id':result,'request_id':'turn1'})
 def record(self,rid,result,label='UNDECIDED',reason='내가 쓴 말'):
  self.store.checkpoint(self.pid,rid)
  return self.store.record(self.pid,rid,{'decisions':[{'result_id':result,'label':label,'reason':reason}],'moves':[{'content':'다시 보기','links':[result]}]})
class StoreTest(StoreFixture, unittest.TestCase):
 def test_practice_gate_numbering_and_resume(self):
  with self.assertRaises(Problem):self.store.start(self.pid)
  rid=self.store.start(self.pid,True);self.assertEqual(rid,self.store.start(self.pid,True));self.assertIsNone(self.store.state(self.pid)['rounds'][0]['number'])
  self.store.flags(self.pid,{'intro_seen':True,'practice_completed':True})
  with self.assertRaises(Problem):self.store.start(self.pid)
  self.practice();real=self.store.start(self.pid);self.assertEqual(self.store.state(self.pid)['rounds'][-1]['number'],1)
  with self.assertRaises(Problem):self.store.start(self.pid,True)
 def test_practice_filtered_from_history_and_exports(self):
  rid,result=self.setup_round();self.say(rid,result);self.record(rid,result)
  self.assertTrue(all(not rows for rows in self.store.history(self.pid).values()))
  research=self.store.history(research=True)
  for table in ('rounds','results','turns','decisions','moves','move_decision_links'):
   self.assertTrue(research[table],table);self.assertTrue(all(x['is_practice']==1 for x in research[table]),table)
 def test_undecided_is_distinct_from_null_and_atomic(self):
  rid,result=self.setup_round();self.say(rid,result);self.store.checkpoint(self.pid,rid)
  for label in (None,'','invalid'):
   with self.assertRaises(Problem):self.record(rid,result,label)
  self.assertEqual(self.store.history(research=True)['decisions'],[])
  self.record(rid,result);self.assertEqual(self.store.history(research=True)['decisions'][-1]['label'],'UNDECIDED')
 def test_verbatim_and_append_only_correction(self):
  rid,result=self.setup_round();text='  학생이 한 말\n전체를 그대로.  ';self.say(rid,result,text)
  cp=self.store.checkpoint(self.pid,rid);self.assertEqual(cp['results'][0]['original_text'],text);self.assertIsNone(cp['results'][0]['label'])
  self.record(rid,result,reason='학생이 직접 고침')
  ds=self.store.history(research=True)['decisions'];self.assertEqual(len(ds),2);self.assertEqual(ds[0]['reason'],text);self.assertEqual(ds[1]['original_text'],text);self.assertEqual(ds[1]['previous_id'],ds[0]['id']);self.assertEqual(ds[1]['version_reason'],'checkpoint_correction')
 def test_idempotent_turn_and_record(self):
  rid,result=self.setup_round();self.say(rid,result);self.say(rid,result);self.record(rid,result);before=self.store.history(research=True);self.store.record(self.pid,rid,{});self.assertEqual(before,self.store.history(research=True));self.assertEqual(len(before['turns']),3)
 def test_ai_failure_keeps_student_words_and_retry(self):
  rid,result=self.setup_round()
  with patch('companion.server.ai_reply',side_effect=TimeoutError): response=self.store.turn(self.pid,rid,{'content':'지우면 안 되는 말','result_id':result,'request_id':'turn1'})
  self.assertTrue(response['saved']);self.assertIsNone(response['reply']);self.say(rid,result,'지우면 안 되는 말');turns=self.store.state(self.pid)['rounds'][0]['turns'];self.assertEqual(len(turns),3)
 def test_undiscussed_results_optional_and_empty_round(self):
  self.practice();rid=self.store.start(self.pid);self.store.checkpoint(self.pid,rid);self.store.record(self.pid,rid,{});self.assertEqual(self.store.state(self.pid)['rounds'][-1]['status'],'recorded')
 def test_cross_participant_and_context_isolation(self):
  rid,result=self.setup_round();other=self.store.participant(self.store.login(self.store.create_participant()))
  with self.assertRaises(Problem):self.store.checkpoint(other,rid)
  ctx=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'ctx','is_context':True})
  with self.assertRaises(Problem):self.say(rid,ctx)
  self.assertEqual(len(self.store.checkpoint(self.pid,rid)['results']),3)
 def test_invalid_link_rolls_back_whole_record(self):
  rid,result=self.setup_round();self.say(rid,result);self.store.checkpoint(self.pid,rid)
  with self.assertRaises(Problem):self.store.record(self.pid,rid,{'decisions':[{'result_id':result,'label':'HOLD','reason':'이유'}],'moves':[{'content':'다음','links':['not-owned']} ]})
  self.assertEqual(self.store.history(research=True)['decisions'],[]);self.assertFalse(self.store.state(self.pid)['practice_completed'])
 def test_revision_and_previous_links(self):
  rid,result=self.setup_round(False);self.say(rid,result);self.record(rid,result,reason='이유')
  old=self.store.history(self.pid)['decisions'][-1];rid2=self.store.start(self.pid);cp=self.store.checkpoint(self.pid,rid2);self.assertEqual(cp['previous'][0]['id'],old['id'])
  self.store.record(self.pid,rid2,{'revisions':[{'previous_id':old['id'],'label':'SELECT','reason':'지금은 선택'}],'moves':[{'content':'다음 탐색','links':[old['id']]}]})
  h=self.store.history(self.pid);self.assertEqual(h['decisions'][-1]['version_reason'],'judgment_revision');self.assertEqual(h['decisions'][-1]['previous_id'],old['id']);self.assertEqual(h['move_decision_links'][-1]['decision_id'],h['decisions'][-1]['id'])
 def test_upload_validation_and_idempotency(self):
  rid,result=self.setup_round();data={'image':PNG,'request_id':'repeat'}
  self.assertEqual(self.store.upload(self.pid,rid,data),self.store.upload(self.pid,rid,data))
  with self.assertRaises(Problem):self.store.upload(self.pid,rid,{'image':'data:image/png;base64,ZmFrZQ==','request_id':'bad'})
 def test_ai_inference_hidden_and_moves_require_verbatim_source(self):
  rid,result=self.setup_round();self.say(rid,result,'다음엔 손잡이를 얇게 해볼래요.')
  turn=self.store.state(self.pid)['rounds'][0]['turns'][1]
  proposals={'decisions':[{'result_id':result,'label':'HOLD'}],'moves':[{'turn_id':turn['id'],'text':'손잡이를 얇게 해볼래요.'},{'turn_id':turn['id'],'text':'학생이 말하지 않은 행동'}]}
  with patch('companion.server.ai_extract',return_value=proposals):cp=self.store.checkpoint(self.pid,rid)
  self.assertIsNone(cp['results'][0]['label']);self.assertEqual(len(cp['moves']),1);self.assertEqual(cp['moves'][0]['content'],'손잡이를 얇게 해볼래요.')
  public=self.store.state(self.pid);self.assertNotIn('proposals',public['rounds'][0])
  research=self.store.history(research=True);self.assertEqual([x for x in research['proposals'] if x['kind']=='DECISION'][0]['inferred_label'],'HOLD')
  self.store.record(self.pid,rid,{'decisions':[{'result_id':result,'label':'UNDECIDED','reason':cp['results'][0]['original_text']}],'moves':cp['moves']})
  research=self.store.history(research=True);self.assertEqual([x for x in research['proposals'] if x['kind']=='MOVE'][0]['status'],'student_confirmed')
 def test_unaccepted_move_is_rejected_but_preserved(self):
  rid,result=self.setup_round();self.say(rid,result,'다음에 다시 볼래요.')
  turn=self.store.state(self.pid)['rounds'][0]['turns'][1]
  with patch('companion.server.ai_extract',return_value={'moves':[{'turn_id':turn['id'],'text':'다음에 다시 볼래요.'}]}):self.store.checkpoint(self.pid,rid)
  self.store.record(self.pid,rid,{'decisions':[{'result_id':result,'label':'HOLD','reason':'다음에 다시 볼래요.'}]})
  proposal=[x for x in self.store.history(research=True)['proposals'] if x['kind']=='MOVE'][0];self.assertEqual(proposal['status'],'student_rejected')
 def test_analysis_failure_allows_manual_confirmation(self):
  rid,result=self.setup_round();self.say(rid,result)
  with patch('companion.server.ai_extract',side_effect=TimeoutError):cp=self.store.checkpoint(self.pid,rid)
  self.assertTrue(cp['analysis_error']);self.assertEqual(cp['moves'],[]);self.assertTrue(cp['results'][0]['original_text'])
 def test_persistence_after_restart(self):
  self.practice();reopened=Store(self.store.path);self.assertTrue(reopened.state(self.pid)['practice_completed'])

class HttpTest(StoreFixture, unittest.TestCase):
 def test_http_flow_cookie_csrf_and_admin(self):
  server=make_server(self.store,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
  def request(path,data=None,cookie='',headers=None):
   req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Cookie':cookie,**(headers or {})});return urllib.request.urlopen(req)
  try:
   with patch.dict(os.environ,{'COOKIE_SECURE':'0','ADMIN_KEY':'a'*32}):
    with request('/api/login',{'code':self.code}) as response:cookie=response.headers['Set-Cookie'].split(';')[0];self.assertIn('HttpOnly',response.headers['Set-Cookie'])
    with request('/api/rounds',{'is_practice':True},cookie) as response:rid=json.load(response)['id']
    with request('/api/state',cookie=cookie) as response:state=json.load(response)
    result=state['rounds'][0]['results'][0]['id']
    with patch.dict(os.environ,{'AI_MODE':'demo'}):request(f'/api/rounds/{rid}/turn',{'content':'아직 정하지 못했어요','result_id':result,'request_id':'e2e'},cookie).close()
    request(f'/api/rounds/{rid}/checkpoint',{},cookie).close()
    request(f'/api/rounds/{rid}/record',{'decisions':[{'result_id':result,'label':'UNDECIDED','reason':'아직 정하지 못했어요'}]},cookie).close()
    with request('/api/rounds',{},cookie) as response:real=json.load(response)['id']
    request(f'/api/rounds/{real}/checkpoint',{},cookie).close();request(f'/api/rounds/{real}/record',{},cookie).close()
    with request('/api/history',cookie=cookie) as response:h=json.load(response);self.assertEqual(len(h['rounds']),1);self.assertEqual(h['rounds'][0]['number'],1)
    with self.assertRaises(urllib.error.HTTPError) as e:request('/api/admin/research',cookie=cookie)
    self.assertEqual(e.exception.code,401)
    with request('/api/admin/research',headers={'Authorization':'Bearer '+'a'*32}) as response:self.assertEqual(json.load(response)['decisions'][0]['label'],'UNDECIDED')
    with self.assertRaises(urllib.error.HTTPError) as e:request('/api/flags',{'intro_seen':True},cookie,{'Origin':'https://evil.example'})
    self.assertEqual(e.exception.code,403)
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main()
