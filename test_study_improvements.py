import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import app
from study_improvements import extract_todo


class ImprovementsTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original = app.DATA
        with closing(sqlite3.connect(app.DATA / 'learning.sqlite3')) as source, closing(sqlite3.connect(Path(self.folder.name) / 'learning.sqlite3')) as target:
            source.backup(target)
        app.DATA = Path(self.folder.name)
        self.client = app.app.test_client()
        with app.db() as connection:
            connection.execute('DELETE FROM timer')
        self.client.post('/api/subjects', json={'name': 'Improvement check'})
        self.subject = self.client.get('/api/state').json['subjects'][-1]['id']

    def tearDown(self):
        app.DATA = self.original
        self.folder.cleanup()

    def subject_state(self):
        return next(row for row in self.client.get('/api/state').json['subjects'] if row['id'] == self.subject)

    def note(self, todo='', body='Ordinary notes'):
        result = self.client.post(f'/api/subjects/{self.subject}/notes', json={'title': 'Tasks', 'body': body, 'todo': todo})
        self.assertEqual(result.status_code, 200, result.json)
        return result.json['note']

    def schedule_entry(self):
        result = self.client.post('/api/schedules', json={'name': 'Check schedule', 'entries': [dict(
            subject_id=self.subject, weekday=2, start_minute=1065, end_minute=1155, kind='exercise', room='307')]})
        schedule = result.json['schedule']['id']
        entry = self.client.get(f'/api/schedules/{schedule}').json['entries'][0]
        return schedule, entry

    def test_latest_todo_survives_ordinary_notes_and_clear_does_not_revive_old_tasks(self):
        first = self.note('Old task')
        latest = self.note('Task one\nTask two')
        self.note(body='Newer ordinary text without a TODO')
        self.assertEqual(self.subject_state()['latest_todo'], 'Task one\nTask two')
        # Editing an older note's ordinary text must not make its TODO current.
        self.client.patch(f"/api/notes/{first['id']}", json={'body': 'Changed ordinary notes'})
        self.assertEqual(self.subject_state()['todo_note_id'], latest['id'])
        self.client.patch(f"/api/notes/{latest['id']}", json={'todo': ''})
        self.assertEqual(self.subject_state()['latest_todo'], '')
        self.assertEqual(self.subject_state()['todo_note_id'], latest['id'])
        self.client.patch(f"/api/notes/{latest['id']}", json={'pinned': True})
        self.assertEqual(self.subject_state()['latest_todo'], '')

    def test_legacy_todo_block_stops_before_ordinary_text(self):
        text = 'Lecture notes\nTODO:\n- Read chapter 2\n- Solve examples\n\nOrdinary text again.'
        self.assertEqual(extract_todo(text), '- Read chapter 2\n- Solve examples')
        result = self.client.post(f'/api/subjects/{self.subject}/notes', json={'title': 'Legacy', 'body': text})
        self.assertEqual(result.status_code, 200)
        self.assertNotIn('Ordinary', self.subject_state()['latest_todo'])

    def test_todo_only_wrapup_is_saved_and_reloaded_for_same_subject(self):
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        result = self.client.post('/api/timer/finish', json={'session_note': '', 'todo': 'Review TCP\nSolve five questions'})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(self.subject_state()['latest_todo'], 'Review TCP\nSolve five questions')
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        state = self.client.get('/api/state').json
        self.assertEqual(state['timer']['subject_id'], self.subject)
        notes = self.client.get(f'/api/subjects/{self.subject}/notes').json['notes']
        self.assertEqual(notes[0]['title'], 'TODO')

    def test_blank_wrapup_consumes_previous_tasks_without_deleting_notes(self):
        old = self.note('Previously assigned task')
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.assertEqual(self.subject_state()['latest_todo'], 'Previously assigned task')
        self.assertEqual(self.client.post('/api/timer/finish', json={'todo': ''}).status_code, 200)
        self.assertEqual(self.subject_state()['latest_todo'], '')
        self.assertEqual(self.client.get(f"/api/notes/{old['id']}").json['note']['todo'], 'Previously assigned task')
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.assertEqual(self.subject_state()['latest_todo'], '')

    def test_pause_todo_draft_survives_resume_and_is_used_at_finish(self):
        self.note('Previous task')
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.assertEqual(self.client.post('/api/timer/todo', json={'todo': 'New task'}).status_code, 409)
        self.client.post('/api/timer/pause', json={'timed_break': True})
        timer = self.client.get('/api/state').json['timer']
        response = self.client.post('/api/timer/todo', json={'todo': 'Task one\nTask two',
            'expected_started_at': timer['started_at'], 'expected_elapsed_seconds': timer['elapsed_seconds']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.subject_state()['latest_todo'], 'Previous task')
        self.client.post('/api/timer/resume', json={})
        self.assertEqual(self.client.get('/api/state').json['timer']['todo_draft'], 'Task one\nTask two')
        self.client.post('/api/timer/finish', json={})
        self.assertEqual(self.subject_state()['latest_todo'], 'Task one\nTask two')

    def test_explicit_empty_finish_clears_pause_draft_and_old_tasks(self):
        self.note('Old task')
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.client.post('/api/timer/pause', json={})
        self.client.post('/api/timer/todo', json={'todo': 'Draft task'})
        self.client.post('/api/timer/finish', json={'todo': '', 'session_note': 'Ordinary final notes'})
        self.assertEqual(self.subject_state()['latest_todo'], '')

    def test_global_notes_are_root_only_and_search_includes_todo(self):
        root = self.client.post('/api/notes', json={'title': 'Global', 'body': 'Text', 'todo': 'Unique task phrase'}).json['note']
        folder = self.client.post('/api/note-folders', json={'name': 'Task folder'}).json['folder']['id']
        self.client.post('/api/notes', json={'title': 'In folder', 'body': 'Text', 'folder_id': folder})
        rows = self.client.get('/api/notes?root=1').json['notes']
        self.assertIn(root['id'], [row['id'] for row in rows])
        self.assertTrue(all(row['folder_id'] is None for row in rows))
        self.assertIsNone(next(row for row in rows if row['id'] == root['id'])['subject_id'])
        self.assertEqual(self.client.get('/api/notes?q=Unique%20task%20phrase').json['notes'][0]['id'], root['id'])

    def test_override_moves_one_occurrence_and_next_week_reverts(self):
        schedule, entry = self.schedule_entry()
        url = f"/api/schedules/{schedule}/entries/{entry['id']}/overrides/2026-11-09"
        result = self.client.put(url, json={'weekday': 0, 'start_minute': 960, 'end_minute': 1050, 'room': '208'})
        self.assertEqual(result.status_code, 200)
        changed = self.client.get(f'/api/schedules/{schedule}?week_start=2026-11-09').json['entries']
        self.assertEqual(len(changed), 1)
        self.assertEqual((changed[0]['weekday'], changed[0]['start_minute'], changed[0]['temporary']), (0, 960, True))
        normal = self.client.get(f'/api/schedules/{schedule}?week_start=2026-11-16').json['entries'][0]
        self.assertEqual((normal['weekday'], normal['start_minute'], normal['temporary']), (2, 1065, False))
        base = self.client.get(f'/api/schedules/{schedule}').json['entries'][0]
        self.assertEqual(base['weekday'], 2)
        self.assertEqual(self.client.delete(url).status_code, 200)
        restored = self.client.get(f'/api/schedules/{schedule}?week_start=2026-11-09').json['entries'][0]
        self.assertFalse(restored['temporary'])

    def test_override_validation_and_schedule_scope(self):
        schedule, entry = self.schedule_entry()
        payload = {'weekday': 0, 'start_minute': 960, 'end_minute': 1050}
        self.assertEqual(self.client.put(f"/api/schedules/{schedule}/entries/{entry['id']}/overrides/2026-11-10", json=payload).status_code, 400)
        self.assertEqual(self.client.put(f"/api/schedules/{schedule}/entries/{entry['id']}/overrides/2026-11-09", json={**payload, 'end_minute': 800}).status_code, 400)
        other = self.client.post('/api/schedules', json={'name': 'Other'}).json['schedule']['id']
        self.assertEqual(self.client.put(f"/api/schedules/{other}/entries/{entry['id']}/overrides/2026-11-09", json=payload).status_code, 404)
        self.assertEqual(self.client.get(f'/api/schedules/{schedule}?week_start=not-a-week').status_code, 400)

    def test_default_schedule_includes_zero_study_subject_and_exports_overrides(self):
        schedule, entry = self.schedule_entry()
        self.client.patch(f'/api/schedules/{schedule}', json={'is_active': True})
        self.assertIn(self.subject, self.client.get('/api/state').json['scheduled_subject_ids'])
        self.assertFalse(any(row['subject_id'] == self.subject for row in self.client.get('/api/state').json['sessions']))
        self.client.put(f"/api/schedules/{schedule}/entries/{entry['id']}/overrides/2026-11-09", json={'weekday': 0, 'start_minute': 960, 'end_minute': 1050})
        exported = self.client.get('/api/export').json
        self.assertTrue(any(row['entry_id'] == entry['id'] for row in exported['schedule_overrides']))
