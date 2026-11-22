import unittest
from companion.server import Problem
from companion.tests.test_server import StoreFixture
class NotesTest(StoreFixture,unittest.TestCase):
 def test_edit_delete_preserve_original_and_ownership(self):
  rid,result=self.setup_round(False)
  first=self.store.save_note(self.pid,{'kind':'discovery','text':'처음 발견','result_id':result})
  second=self.store.save_note(self.pid,{'kind':'discovery','text':'고친 발견','previous_id':first})
  with self.assertRaises(Problem):self.store.save_note(self.pid,{'kind':'discovery','text':'덮어쓰기','previous_id':first})
  code=self.store.create_participant();other=self.store.participant(self.store.login(code))
  with self.assertRaises(Problem):self.store.save_note(other,{'kind':'discovery','text':'다른 학생','previous_id':second})
  with self.assertRaises(Problem):self.store.save_note(other,{'kind':'discovery','text':'다른 이미지','result_id':result})
  self.store.save_note(self.pid,{'kind':'intent','text':'고친 발견','previous_id':second,'deleted':True})
  notes=self.store.state(self.pid)['notes'];self.assertEqual(len(notes),3);self.assertEqual(notes[-1]['original_text'],'처음 발견');self.assertEqual(notes[-1]['deleted'],1)
  self.assertEqual(len(self.store.history(research=True)['exploration_notes']),3)
 def test_practice_source_rejected(self):
  rid,result=self.setup_round(True)
  with self.assertRaises(Problem):self.store.save_note(self.pid,{'kind':'discovery','text':'연습','result_id':result})
