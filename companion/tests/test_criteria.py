import io,json,os,unittest
from unittest.mock import patch
from companion.server import Problem
from companion.tests.test_server import StoreFixture
from companion.tests.test_q6 import PRIORITY,S3,answer,response
from companion.q6 import protocol_reply

class CriteriaTest(StoreFixture,unittest.TestCase):
 def setup_criteria(self):
  rid,result=self.setup_round(False);self.store.card(self.pid,{'priority':PRIORITY,'secondary':'손 밑은 밝을 것'});return rid,result
 def proposal(self,rid,result,request='source',response_to=None):
  with patch.dict(os.environ,{'AI_MODE':'demo'}):self.store.turn(self.pid,rid,{'content':'광원은 숨기고 빛은 넓게 퍼져야 해요.','result_id':result,'request_id':request,'response_to':response_to})
  turn=next(t for t in self.store.state(self.pid)['rounds'][-1]['turns'] if t['request_id']==request and t['role']=='user')
  return self.store.propose_criterion(self.pid,{'source_turn_id':turn['id'],'text':'광원은 숨기고, 빛은 넓게'})
 def test_pending_confirmation_idempotency_and_initial_preserved(self):
  rid,result=self.setup_criteria();cid=self.proposal(rid,result)
  before=self.store.state(self.pid);self.assertEqual(before['card']['priority'],PRIORITY);self.assertIsNone(before['criteria']['changes'][0]['student_type'])
  with self.assertRaises(Problem):self.store.confirm_criterion(self.pid,cid,{'text':'새 기준','change_type':None})
  data={'text':'광원은 숨기고, 빛은 넓게','change_type':'REFINE','rank':1};version=self.store.confirm_criterion(self.pid,cid,data);self.assertEqual(version,self.store.confirm_criterion(self.pid,cid,data))
  state=self.store.state(self.pid);self.assertEqual(state['criteria']['initial']['priority'],PRIORITY);self.assertEqual(state['card']['priority'],data['text']);self.assertEqual(len(state['criteria']['cards']),2)
  self.assertEqual(state['criteria']['changes'][0]['original_text'],'광원은 숨기고 빛은 넓게 퍼져야 해요.')
 def test_add_and_reorder_keep_original_and_research_coding_separate(self):
  rid,result=self.setup_criteria();cid=self.proposal(rid,result)
  self.store.confirm_criterion(self.pid,cid,{'text':'새 재료','change_type':'ADD','rank':3})
  self.assertEqual(self.store.state(self.pid)['card']['priority'],PRIORITY)
  second=self.proposal(rid,result,'second');self.store.confirm_criterion(self.pid,second,{'text':'손 밑은 밝을 것','change_type':'REORDER','rank':1})
  self.assertEqual(self.store.state(self.pid)['card']['priority'],'손 밑은 밝을 것')
  self.store.code_criterion({'criterion_id':cid,'code':'REPLACE','note':'독립 사후 코딩'})
  self.assertEqual(self.store.state(self.pid)['criteria']['changes'][0]['student_type'],'ADD');self.assertNotIn('criterion_codings',self.store.state(self.pid))
  self.assertEqual(len(self.store.history(research=True)['criterion_codings']),1)
 def test_explicit_q6_response_context_and_unlinked_turn(self):
  rid,result=self.setup_criteria()
  with patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'fixture'}),patch('urllib.request.urlopen',return_value=response(answer())):
   self.store.turn(self.pid,rid,{'content':S3,'result_id':result,'request_id':'q6'})
  assistant=next(t for t in self.store.state(self.pid)['rounds'][-1]['turns'] if t['role']=='assistant')
  first=self.proposal(rid,result,response_to=assistant['id']);second=self.proposal(rid,result,'unlinked')
  changes=self.store.state(self.pid)['criteria']['changes'];self.assertEqual(changes[0]['question_id'],'Q6');self.assertEqual(changes[0]['response_to'],assistant['id']);self.assertIsNone(changes[1]['question_id'])
 def test_foreign_and_stale_proposal_rejected(self):
  rid,result=self.setup_criteria();cid=self.proposal(rid,result)
  other=self.store.participant(self.store.login(self.store.create_participant()))
  with self.assertRaises(Problem):self.store.confirm_criterion(other,cid,{'text':'x','change_type':'REFINE'})
  source=self.store.state(self.pid)['criteria']['changes'][0]['source_turn_id']
  with self.assertRaises(Problem):self.store.propose_criterion(other,{'source_turn_id':source,'text':'x'})
  self.store.card(self.pid,{'priority':'직접 고친 기준'})
  with self.assertRaises(Problem):self.store.confirm_criterion(self.pid,cid,{'text':'x','change_type':'REFINE'})
  self.store.reject_criterion(self.pid,cid);self.assertEqual(self.store.state(self.pid)['card']['priority'],'직접 고친 기준')
 def test_model_proposal_original_quote_and_confirmation_gate(self):
  rid,result=self.setup_criteria();out=answer('NONE');out['criterion_proposal']={'text':'정리 제안','quote':'개방형 로비'}
  with patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'fixture'}),patch('urllib.request.urlopen',return_value=response(out)):
   self.store.turn(self.pid,rid,{'content':S3,'result_id':result,'request_id':'ai'})
  state=self.store.state(self.pid);self.assertEqual(state['card']['priority'],PRIORITY);self.assertEqual(state['criteria']['changes'][0]['author'],'ai');self.assertIsNone(state['criteria']['changes'][0]['student_type'])
  out['criterion_proposal']['quote']='학생이 말하지 않은 문장'
  with patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'fixture'}),patch('urllib.request.urlopen',return_value=response(out)):
   self.store.turn(self.pid,rid,{'content':S3,'result_id':result,'request_id':'invalid'})
  self.assertEqual(len(self.store.state(self.pid)['criteria']['changes']),1)
