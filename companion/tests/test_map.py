import sqlite3, unittest
from companion.server import Store,Problem
from test_server import StoreFixture,PNG

class MapLinksTest(StoreFixture,unittest.TestCase):
 def first(self):
  rid,result=self.setup_round(False);self.say(rid,result);self.record(rid,result)
  history=self.store.history(self.pid);return rid,result,history['moves'][0]['id']
 def next_result(self):
  rid=self.store.start(self.pid);result=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'next'});return rid,result
 def test_link_is_student_selected_and_only_visible_when_recorded(self):
  _,_,mid=self.first();rid,result=self.next_result()
  self.assertEqual(self.store.state(self.pid)['rounds'][-1]['results'][0]['source_move_ids'],[])
  self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[mid,mid]}]})
  self.assertEqual(self.store.history(self.pid)['result_move_links'],[])
  self.assertEqual(self.store.state(self.pid)['rounds'][-1]['results'][0]['source_move_ids'],[mid])
  self.store.checkpoint(self.pid,rid);self.store.record(self.pid,rid,{})
  links=self.store.history(self.pid)['result_move_links'];self.assertEqual(len(links),1);self.assertEqual(links[0]['move_id'],mid);self.assertEqual(links[0]['result_id'],result)
  self.assertEqual(links[0]['is_practice'],0)
  with self.assertRaises(Problem):self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[]}]})
 def test_skip_replace_and_clear_before_confirmation(self):
  _,_,mid=self.first();rid,result=self.next_result()
  payload={'results':[{'result_id':result,'move_ids':[mid]}]}
  self.store.sources(self.pid,rid,payload);self.store.sources(self.pid,rid,payload)
  self.assertEqual(len(self.store.history(research=True)['result_move_links']),1)
  self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[]}]})
  self.assertEqual(self.store.history(research=True)['result_move_links'],[])
  self.store.checkpoint(self.pid,rid);self.store.record(self.pid,rid,{})
  self.assertEqual(self.store.history(self.pid)['result_move_links'],[])
 def test_owner_round_context_practice_and_unconfirmed_sources_rejected_atomically(self):
  _,_,mid=self.first();rid,result=self.next_result()
  self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[mid]}]})
  other=self.store.participant(self.store.login(self.store.create_participant()))
  with self.assertRaises(Problem):self.store.sources(other,rid,{'results':[{'result_id':result,'move_ids':[mid]}]})
  context=self.store.upload(self.pid,rid,{'image':PNG,'request_id':'context','is_context':True})
  for bad_result,ids in [(context,[mid]),('foreign-result',[mid]),(result,['nonexistent']),(result,[None])]:
   with self.assertRaises(Problem):self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[]},{'result_id':bad_result,'move_ids':ids}]})
   self.assertEqual(self.store.state(self.pid)['rounds'][-1]['results'][0]['source_move_ids'],[mid])
  with self.store.db() as db:
   db.execute("UPDATE moves SET status='model_proposed' WHERE id=?",(mid,))
  with self.assertRaises(Problem):self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[mid]}]})
 def test_foreign_student_and_practice_moves_never_linked(self):
  practice=self.store.start(self.pid,True);pr=self.store.state(self.pid)['rounds'][0]['results'][0]['id'];self.say(practice,pr);self.record(practice,pr)
  practice_move=self.store.history(research=True)['moves'][0]['id']
  rid,result=self.next_result()
  with self.assertRaises(Problem):self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[practice_move]}]})
  other=self.store.participant(self.store.login(self.store.create_participant()))
  p=self.store.start(other,True);self.store.checkpoint(other,p);self.store.record(other,p,{})
  r=self.store.start(other);self.store.checkpoint(other,r);self.store.record(other,r,{'moves':[{'content':'other student'}]})
  foreign_move=self.store.history(other)['moves'][0]['id']
  with self.assertRaises(Problem):self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[foreign_move]}]})
 def test_same_or_future_round_move_rejected(self):
  _,_,mid=self.first();rid,result=self.next_result()
  with self.store.db() as db:db.execute('UPDATE moves SET round_id=? WHERE id=?',(rid,mid))
  with self.assertRaises(Problem):self.store.sources(self.pid,rid,{'results':[{'result_id':result,'move_ids':[mid]}]})
 def test_additive_schema_migration_preserves_existing_rows(self):
  self.first()
  with self.store.db() as db:db.execute('DROP TABLE result_move_links')
  before=self.pid
  reopened=Store(self.store.path)
  self.assertEqual(reopened.state(self.pid)['id'],before)
  self.assertEqual(len(reopened.history(self.pid)['moves']),1)
  self.assertEqual(reopened.history(self.pid)['result_move_links'],[])
if __name__=='__main__':unittest.main()
