import io,json,os,unittest
from pathlib import Path
from unittest.mock import patch
from companion.q6 import Q6,ACK,check_template,protocol_reply
from companion.server import Store,Problem
from companion.tests.test_server import StoreFixture

PRIORITY='들어오자마자 내부가 다 보이지 않을 것'
S3='결과 중에 입구에서 내부가 한눈에 보이는 개방형 로비가 제일 좋아서 그걸로 가기로 했어요. 밝고 환영하는 느낌이라서요.'
def context(text=S3,priority=PRIORITY):return {'priority':priority,'turns':[{'id':'u1','role':'user','content':text,'result_id':None}],'protocol':'q6-only-v1'}
def answer(qid='Q6',text=None):return {'question_id':qid,'reply':text if text is not None else Q6.replace('[카드의 1순위 기준]',PRIORITY),'evidence':S3,'rationale':'model judgment fixture'}
def response(value):return io.StringIO(json.dumps({'choices':[{'message':{'content':json.dumps(value,ensure_ascii=False)}}]}))

class ProtocolTest(unittest.TestCase):
 def test_legacy_template_parity(self):
  source=Path('supabase/functions/record-model/prompt.ts').read_text()
  self.assertIn(Q6,source)
  self.assertTrue(check_template('Q6',answer()['reply']))
  self.assertTrue(check_template('Q6','기록했어요. '+answer()['reply']))
  self.assertFalse(check_template('Q6','카드의 기준과 다른 선택이네요. 어떻게 생각하세요?'))
  self.assertIsNone(check_template('NONE',ACK))
 def test_s3_model_choice_and_payload_without_confirmed_label_gate(self):
  with patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'test'}),patch('urllib.request.urlopen',return_value=response(answer())) as call:
   out=protocol_reply(context())
   self.assertEqual(out['question_id'],'Q6');self.assertTrue(out['template_ok'])
   sent=json.loads(call.call_args.args[0].data)
   self.assertEqual(json.loads(sent['messages'][1]['content']),context())
   self.assertIn('선택이 카드의 우선순위와 어긋날 때 → Q6',sent['messages'][0]['content'])
 def test_model_none_stays_none(self):
  with patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'test'}),patch('urllib.request.urlopen',return_value=response(answer('NONE',ACK))):
   self.assertEqual(protocol_reply(context('입구에서 내부를 가리는 안으로 갈래요.'))['question_id'],'NONE')
 def test_missing_priority_and_demo_do_not_call_provider(self):
  with patch.dict(os.environ,{'AI_MODE':'live'}),patch('urllib.request.urlopen') as call:
   self.assertEqual(protocol_reply(context(priority=' '))['outcome'],'missing_priority');call.assert_not_called()
  with patch.dict(os.environ,{'AI_MODE':'demo'}),patch('urllib.request.urlopen') as call:
   self.assertEqual(protocol_reply(context())['outcome'],'demo');call.assert_not_called()
 def test_paraphrase_wrong_slot_and_extra_question_are_blocked_and_audited(self):
  for text in ('기준이 바뀌었나요?',answer()['reply'].replace(PRIORITY,'가짜 기준'),answer()['reply']+' 왜요?'):
   with self.subTest(text=text),patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'test'}),patch('urllib.request.urlopen',return_value=response(answer(text=text))):
    out=protocol_reply(context());self.assertEqual(out['question_id'],'NONE');self.assertEqual(out['reply'],ACK);self.assertEqual(out['outcome'],'invalid_template_or_slot');self.assertIn(text,json.loads(out['raw_response'])['reply'])

class PersistenceTest(StoreFixture,unittest.TestCase):
 def test_card_versions_and_input_validation(self):
  first=self.store.card(self.pid,{'priority':PRIORITY})
  self.assertEqual(first,self.store.card(self.pid,{'priority':PRIORITY}))
  second=self.store.card(self.pid,{'priority':'새 기준'});self.assertNotEqual(first,second)
  self.assertEqual(self.store.state(self.pid)['card']['priority'],'새 기준')
  self.assertEqual(len(self.store.history(research=True)['criterion_cards']),2)
  with self.assertRaises(Problem):self.store.card(self.pid,{'priority':'a'*1001})
 def test_failure_retry_snapshots_history_and_card_then_idempotent(self):
  rid,result=self.setup_round(False);card=self.store.card(self.pid,{'priority':PRIORITY})
  data={'content':S3,'result_id':result,'request_id':'q6'}
  with patch('companion.server.ai_reply',side_effect=TimeoutError):
   self.assertIsNone(self.store.turn(self.pid,rid,data)['reply'])
  self.store.card(self.pid,{'priority':'수정한 기준'})
  with patch.dict(os.environ,{'AI_MODE':'live','OPENAI_API_KEY':'test'}),patch('urllib.request.urlopen',return_value=response(answer())) as call:
   out=self.store.turn(self.pid,rid,data);self.assertEqual(out['reply'],answer()['reply'])
   snapshot=json.loads(json.loads(call.call_args.args[0].data)['messages'][1]['content'])
   self.assertEqual(snapshot['priority'],PRIORITY)
   self.assertEqual([t['content'] for t in snapshot['turns']],[S3])
  with patch('companion.server.ai_reply') as ai:
   self.assertEqual(out,self.store.turn(self.pid,rid,data));ai.assert_not_called()
  event=self.store.history(research=True)['question_events'][0]
  self.assertEqual(event['card_id'],card);self.assertEqual(event['question_id'],'Q6');self.assertEqual(event['outcome'],'asked')
  self.assertNotIn('question_events',self.store.history(self.pid))
  restored=Store(self.store.path);self.assertEqual(restored.history(research=True)['question_events'][0],event)
 def test_practice_is_excluded_and_other_participant_history_not_sent(self):
  rid,result=self.setup_round();self.store.card(self.pid,{'priority':PRIORITY});self.say(rid,result)
  self.assertEqual(self.store.history(research=True)['question_events'],[])
  self.record(rid,result)
  other=self.store.participant(self.store.login(self.store.create_participant()))
  self.store.card(other,{'priority':'他人の秘密'})
  rid=self.store.start(self.pid)
  with patch.dict(os.environ,{'AI_MODE':'demo'}):self.store.turn(self.pid,rid,{'content':S3,'request_id':'real'})
  event=self.store.history(self.pid,research=True)['question_events'][0]
  self.assertNotIn('他人',event['context_json']);self.assertEqual(len(json.loads(event['context_json'])['turns']),1)
  self.assertEqual(len(self.store.history(self.pid,research=True)['criterion_cards']),1)
