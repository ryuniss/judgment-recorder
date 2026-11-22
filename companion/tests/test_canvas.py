import unittest
from companion.server import Problem,Store
from companion.tests.test_server import StoreFixture,PNG

class CanvasTest(StoreFixture,unittest.TestCase):
 def test_multiple_parents_excluded_parent_and_no_inference(self):
  rid,a=self.setup_round(False)
  b=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'b'})
  c=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'c'})
  self.store.judgment(self.pid,rid,{'result_id':a,'label':'EXCLUDE','request_id':'ja'})
  self.store.lineage(self.pid,rid,{'results':[{'result_id':c,'parent_ids':[a,b]}]})
  results=self.store.state(self.pid)['rounds'][-1]['results']
  self.assertEqual(set(results[2]['parent_ids']),{a,b});self.assertEqual(results[2]['judgments'],[])
  self.assertEqual(results[0]['judgments'][-1]['label'],'EXCLUDE')
  self.assertEqual(results[1]['parent_ids'],[])
  self.store.lineage(self.pid,rid,{'results':[{'result_id':c,'parent_ids':[]}]})
  self.assertEqual(len(self.store.history(research=True)['lineage_events']),2)
 def test_cycles_foreign_practice_context_rejected_atomically(self):
  rid,a=self.setup_round(False);b=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'b'})
  practice=self.store.state(self.pid)['rounds'][0]['results'][0]['id']
  ctx=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'ctx','is_context':True})
  other=self.store.participant(self.store.login(self.store.create_participant()));pr=self.store.start(other,True);foreign=self.store.state(other)['rounds'][0]['results'][0]['id']
  for child,parent in ((a,b),(a,a),(b,practice),(b,ctx),(b,foreign)):
   with self.subTest(parent=parent),self.assertRaises(Problem):self.store.lineage(self.pid,rid,{'results':[{'result_id':b,'parent_ids':[a]},{'result_id':child,'parent_ids':[parent]}]})
   self.assertEqual(self.store.state(self.pid)['rounds'][-1]['results'][1]['parent_ids'],[])
 def test_judgment_retry_revisions_and_checkpoint_preserve_ids(self):
  rid,a=self.setup_round(False)
  payload={'result_id':a,'label':'HOLD','reason':'다시 볼 후보','request_id':'j1'}
  first=self.store.judgment(self.pid,rid,payload);self.assertEqual(first,self.store.judgment(self.pid,rid,payload))
  with self.assertRaises(Problem):self.store.judgment(self.pid,rid,{**payload,'label':'EXCLUDE'})
  second=self.store.judgment(self.pid,rid,{**payload,'label':'UNDECIDED','request_id':'j2'})
  self.store.checkpoint(self.pid,rid)
  self.store.record(self.pid,rid,{'decisions':[{'result_id':a,'label':'UNDECIDED','reason':'다시 볼 후보'}]})
  ds=self.store.history(self.pid)['decisions'];self.assertEqual(len(ds),2);self.assertEqual(ds[1]['id'],second);self.assertEqual(ds[1]['previous_id'],first)
  new=self.store.start(self.pid)
  self.say(new,a,'이전 이미지에서 계속 생각해요.')
  self.store.judgment(self.pid,new,{'result_id':a,'label':'SELECT','request_id':'j3'})
  self.store.checkpoint(self.pid,new);self.store.record(self.pid,new,{'decisions':[{'result_id':a,'label':'SELECT','reason':''}]})
  self.assertEqual(self.store.state(self.pid)['rounds'][1]['results'][0]['judgments'][-1]['label'],'SELECT')
 def test_card_fields_and_additive_migration(self):
  self.store.card(self.pid,{'priority':'기준','issue':'의도','image':'이미지','secondary':'두 번째','question':'질문'})
  self.assertEqual(Store(self.store.path).state(self.pid)['card']['question'],'질문')
  self.store.card(self.pid,{'priority':'새 기준'})
  self.assertEqual(self.store.state(self.pid)['card']['issue'],'의도')
