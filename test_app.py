import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import app


class StudyWorkflowTests(unittest.TestCase):
    def test_schedule_builder_saves_all_rows_or_nothing(self):
        entry = dict(subject_id=self.subject,weekday=0,start_minute=435,end_minute=600,kind='lecture',room='204')
        result = self.client.post('/api/schedules', json={'name': 'Full week', 'entries': [entry, {**entry, 'weekday': 2, 'kind': 'exercise'}]})
        self.assertEqual(result.status_code, 200)
        schedule_id = result.json['schedule']['id']
        entries = self.client.get(f'/api/schedules/{schedule_id}').json['entries']
        self.assertEqual(len(entries), 2)
        self.assertEqual([row['weekday'] for row in entries], [0, 2])
        before = len(self.client.get('/api/schedules').json['schedules'])
        invalid = self.client.post('/api/schedules', json={'name': 'Invalid batch', 'entries': [entry, {**entry, 'end_minute': 400}]})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json['entry_index'], 1)
        self.assertEqual(len(self.client.get('/api/schedules').json['schedules']), before)
        self.assertEqual(self.client.post('/api/schedules', json={'name': 'Bad data', 'entries': [None]}).status_code, 400)
        self.assertEqual(self.client.post('/api/schedules', json={'name': 'Too much', 'entries': [entry]*251}).status_code, 400)

    def test_named_schedules_entries_and_default_are_independent(self):
        first = self.client.post('/api/schedules', json={'name': 'First plan'}).json['schedule']['id']
        second = self.client.post('/api/schedules', json={'name': 'Another plan'}).json['schedule']['id']
        payload = dict(subject_id=self.subject, weekday=0, start_minute=435, end_minute=600, kind='lecture', room='204')
        entry = self.client.post(f'/api/schedules/{first}/entries', json=payload).json['entry']
        self.assertEqual(entry['start_minute'], 435)
        self.assertEqual(self.client.get(f'/api/schedules/{second}').json['entries'], [])
        self.assertEqual(self.client.patch(f'/api/schedules/{second}/entries/{entry["id"]}', json={'room': 'Wrong plan'}).status_code, 404)
        self.assertEqual(self.client.patch(f'/api/schedules/{first}/entries/{entry["id"]}', json={'kind': 'exercise', 'room': ''}).status_code, 200)
        self.client.patch(f'/api/schedules/{second}', json={'is_active': True})
        schedules = self.client.get('/api/schedules').json['schedules']
        self.assertEqual([row['id'] for row in schedules if row['is_active']], [second])
        self.assertEqual(self.client.delete(f'/api/schedules/{first}').status_code, 400)
        self.assertEqual(self.client.delete(f'/api/schedules/{first}', json={'confirm': True}).status_code, 200)
        with app.db() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM schedule_entries WHERE schedule_id=?', (first,)).fetchone()[0], 0)
        self.assertIn('schedules', self.client.get('/api/export').json)

    def test_schedule_entry_validation_and_overlap_preservation(self):
        schedule = self.client.post('/api/schedules', json={'name': 'Validation plan'}).json['schedule']['id']
        endpoint = f'/api/schedules/{schedule}/entries'
        payload = dict(subject_id=self.subject, weekday=0, start_minute=435, end_minute=600, kind='lecture')
        for invalid in ({'subject_id': 99999999}, {'weekday': 7}, {'start_minute': 600}, {'end_minute': 400}, {'kind': 'other'}, {'weekday': True}):
            self.assertEqual(self.client.post(endpoint, json={**payload, **invalid}).status_code, 400)
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 200)
        self.assertEqual(self.client.post(endpoint, json={**payload, 'start_minute': 540, 'end_minute': 630}).status_code, 200)
        self.assertEqual(len(self.client.get(f'/api/schedules/{schedule}').json['entries']), 2)
        self.client.patch(f'/api/subjects/{self.subject}', json={'archived': 1})
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 400)

    def test_context_notes_and_confirmed_recursive_folder_delete(self):
        root = self.client.post('/api/note-folders', json={'name': 'Standalone folder'}).json['folder']['id']
        child = self.client.post('/api/note-folders', json={'name': 'Subfolder', 'parent_id': root}).json['folder']['id']
        other = self.client.post('/api/note-folders', json={'name': 'Keep me'}).json['folder']['id']
        note = self.client.post('/api/notes', json={'title': 'Inside subfolder', 'body': 'Text', 'folder_id': child}).json['note']
        self.assertIsNone(note['subject_id'])
        self.assertEqual(note['folder_id'], child)
        self.assertEqual(self.client.patch(f'/api/notes/{note["id"]}', json={'body': 'Changed'}).status_code, 200)
        keep = self.client.post('/api/notes', json={'title': 'Unaffected', 'folder_id': other}).json['note']
        preview = self.client.get(f'/api/note-folders/{root}/delete-preview').json
        self.assertEqual(preview['subfolders'], 1)
        self.assertEqual(preview['notes'], 1)
        self.assertEqual(self.client.delete(f'/api/note-folders/{root}').status_code, 400)
        self.assertEqual(self.client.get(f'/api/notes/{note["id"]}').status_code, 200)
        deleted = self.client.delete(f'/api/note-folders/{root}', json={'confirm': True}).json
        self.assertEqual(deleted['folders'], 2)
        self.assertEqual(deleted['notes'], 1)
        self.assertEqual(self.client.get(f'/api/notes/{note["id"]}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/notes/{keep["id"]}').status_code, 200)

    def test_optional_finish_note_creates_and_reuses_subject_folder(self):
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.client.post('/api/timer/finish', json={'session_note': '   '})
        with app.db() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM notes WHERE subject_id=?', (self.subject,)).fetchone()[0], 0)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM note_folders WHERE subject_id=?', (self.subject,)).fetchone()[0], 0)
        manual = self.client.post('/api/note-folders', json={'name': 'Workflow test'}).json['folder']['id']
        for body in ['Learned TCP\nContinue with UDP', 'Second session note']:
            self.client.post('/api/timer/start', json={'subject_id': self.subject})
            response = self.client.post('/api/timer/finish', json={'session_note': body})
            self.assertEqual(response.status_code, 200)
        with app.db() as connection:
            notes = connection.execute('SELECT * FROM notes WHERE subject_id=? ORDER BY id', (self.subject,)).fetchall()
            self.assertEqual(len(notes), 2)
            self.assertEqual(notes[0]['body'], 'Learned TCP\nContinue with UDP')
            self.assertEqual(notes[0]['title'], 'Learned TCP')
            self.assertEqual({row['folder_id'] for row in notes}, {manual})
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM note_folders WHERE subject_id=?', (self.subject,)).fetchone()[0], 1)
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.assertEqual(self.client.post('/api/timer/finish', json={'session_note': 'x' * 100001}).status_code, 400)
        self.assertIsNotNone(self.client.get('/api/state').json['timer'])

    def test_nested_note_folders_move_search_and_cycle_protection(self):
        root = self.client.post('/api/note-folders', json={'name': 'My notebook'}).json['folder']['id']
        child = self.client.post('/api/note-folders', json={'name': 'Lectures', 'parent_id': root}).json['folder']['id']
        leaf = self.client.post('/api/note-folders', json={'name': 'Week 1', 'parent_id': child}).json['folder']['id']
        self.assertEqual(self.client.patch(f'/api/note-folders/{root}', json={'parent_id': leaf}).status_code, 400)
        self.assertEqual(self.client.post('/api/note-folders', json={'name': 'lectures', 'parent_id': root}).status_code, 409)
        note = self.client.post(f'/api/subjects/{self.subject}/notes', json={'title': 'Nested', 'body': 'Find this', 'folder_id': leaf}).json['note']
        result = self.client.get('/api/notes', query_string={'folder_id': root, 'q': 'find this'}).json
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['notes'][0]['id'], note['id'])
        self.assertEqual(self.client.get('/api/notes', query_string={'folder_id': root, 'direct': 1}).json['total'], 0)
        self.assertEqual(self.client.get('/api/notes', query_string={'folder_id': leaf, 'direct': 1}).json['total'], 1)
        self.assertEqual(self.client.delete(f'/api/note-folders/{leaf}').status_code, 400)
        self.assertEqual(self.client.delete(f'/api/note-folders/{root}').status_code, 400)
        self.client.patch(f'/api/subjects/{self.subject}/notes/{note["id"]}', json={'folder_id': root})
        self.assertEqual(self.client.get('/api/notes', query_string={'folder_id': leaf}).json['total'], 0)
        self.assertEqual(self.client.delete(f'/api/note-folders/{leaf}', json={'confirm': True}).status_code, 200)
        self.assertIn('note_folders', self.client.get('/api/export').json)

    def test_repeated_checkpoints_and_countdown_breaks(self):
        self.client.patch('/api/settings', json={'checkpoint_minutes': 45, 'break_minutes': 5})
        with patch.object(app, 'now', return_value=10000):
            self.client.post('/api/timer/start', json={'subject_id': self.subject})
        # A late poll must still cap the first block at exactly 45 minutes.
        with patch.object(app, 'now', return_value=14000):
            first = self.client.get('/api/state').json['timer']
            self.assertEqual(first['seconds'], 2700)
            self.client.post('/api/timer/resume')
        with patch.object(app, 'now', return_value=16699):
            self.assertEqual(self.client.get('/api/state').json['timer']['seconds'], 5399)
        with patch.object(app, 'now', return_value=16700):
            second = self.client.get('/api/state').json['timer']
            self.assertEqual(second['seconds'], 5400)
            self.assertIsNone(second['segment_at'])
            self.client.post('/api/timer/break')
        with patch.object(app, 'now', return_value=16820):
            paused = self.client.get('/api/state').json['timer']
            self.assertEqual(paused['break_remaining_seconds'], 180)
            self.assertEqual(paused['seconds'], 5400)
        with patch.object(app, 'now', return_value=17000):
            ended = self.client.get('/api/state').json['timer']
            self.assertEqual(ended['break_remaining_seconds'], 0)
            self.assertEqual(ended['break_due'], 1)
            self.assertIsNone(ended['segment_at'])
            self.client.post('/api/timer/resume')
        with patch.object(app, 'now', return_value=19700):
            self.assertEqual(self.client.get('/api/state').json['timer']['seconds'], 8100)

    def test_manual_break_preserves_remaining_checkpoint_time(self):
        self.client.patch('/api/settings', json={'checkpoint_minutes': 45, 'break_minutes': 3})
        with patch.object(app, 'now', return_value=10000):
            self.client.post('/api/timer/start', json={'subject_id': self.subject})
        with patch.object(app, 'now', return_value=10600):
            self.client.post('/api/timer/pause')
        with patch.object(app, 'now', return_value=10700):
            self.client.post('/api/timer/resume')
        with patch.object(app, 'now', return_value=12800):
            timer = self.client.get('/api/state').json['timer']
            self.assertEqual(timer['seconds'], 2700)
            self.assertEqual(timer['checkpoint_due'], 1)
            self.assertIsNone(timer['break_until'])
        self.assertEqual(self.client.patch('/api/settings', json={'break_minutes': 0}).status_code, 400)

    def test_old_native_notification_cannot_change_new_session(self):
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.client.post('/api/timer/pause', json={'timed_break': False})
        old = self.client.get('/api/state').json['timer']
        self.client.post('/api/timer/finish')
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        response = self.client.post('/api/timer/resume', json={
            'expected_started_at': old['started_at'], 'expected_elapsed_seconds': old['elapsed_seconds'],
        })
        self.assertEqual(response.status_code, 409)
    def test_subject_folder_paths_are_validated_and_preserved(self):
        folder = str(app.DATA.resolve())
        endpoint = f'/api/subjects/{self.subject}'
        self.assertEqual(self.client.patch(endpoint, json={'folder_path': folder}).status_code, 200)
        self.client.patch(endpoint, json={'next_step': 'Keep folder'})
        subject = next(row for row in self.client.get('/api/state').json['subjects'] if row['id'] == self.subject)
        self.assertEqual(subject['folder_path'], folder)
        for invalid in ('relative/path', str(app.DATA / 'missing'), str(app.DATA / 'learning.sqlite3')):
            self.assertEqual(self.client.patch(endpoint, json={'folder_path': invalid}).status_code, 400)
        self.assertEqual(self.client.patch(endpoint, json={'folder_path': ''}).status_code, 200)

    def test_global_notes_search_filter_and_pin_order(self):
        self.client.post('/api/subjects', json={'name': 'Second notebook'})
        other = self.client.get('/api/state').json['subjects'][-1]['id']
        first = self.client.post(f'/api/subjects/{self.subject}/notes', json={'title': 'Alpha', 'body': 'Željeni tekst'}).json['note']
        second = self.client.post(f'/api/subjects/{other}/notes', json={'title': 'Beta', 'body': 'Željeni tekst'}).json['note']
        self.client.patch(f'/api/subjects/{self.subject}/notes/{first["id"]}', json={'pinned': True})
        result = self.client.get('/api/notes', query_string={'q': 'ŽELJENI TEKST'}).json
        self.assertEqual(result['total'], 2)
        self.assertEqual(result['notes'][0]['id'], first['id'])
        self.assertNotIn('body', result['notes'][0])
        filtered = self.client.get('/api/notes', query_string={'q': 'željeni', 'subject_id': other}).json
        self.assertEqual(filtered['total'], 1)
        self.assertEqual(filtered['notes'][0]['id'], second['id'])
        self.assertEqual(self.client.get('/api/notes?subject_id=bad').status_code, 400)

    def test_notes_search_pagination_edit_and_subject_isolation(self):
        base = f'/api/subjects/{self.subject}/notes'
        for index in range(23):
            response = self.client.post(base, json={'title': f'Lecture {index}', 'body': 'Željeni primjer' if index == 0 else 'Exercise'})
            self.assertEqual(response.status_code, 200)
        listing = self.client.get(base).json
        self.assertEqual(listing['total'], 23)
        self.assertEqual(len(listing['notes']), 20)
        self.assertNotIn('body', listing['notes'][0])
        self.assertEqual(len(self.client.get(base+'?page=2').json['notes']), 3)
        search = self.client.get(base, query_string={'q': 'ŽELJENI'}).json
        self.assertEqual(search['total'], 1)
        note_id = search['notes'][0]['id']
        original = self.client.get(base+f'/{note_id}').json['note']
        updated = self.client.patch(base+f'/{note_id}', json={'title': 'Pinned lesson', 'body': 'Updated text', 'pinned': True}).json['note']
        self.assertEqual(updated['created_at'], original['created_at'])
        self.assertGreaterEqual(updated['updated_at'], original['updated_at'])
        self.assertEqual(self.client.get(base).json['notes'][0]['id'], note_id)
        self.assertEqual(self.client.get(f'/api/subjects/999999/notes/{note_id}').status_code, 404)
        self.assertEqual(self.client.patch(base+f'/{note_id}', json={'title': ''}).status_code, 400)
        self.assertEqual(self.client.get('/api/export').json['notes'][-1]['subject_id'], self.subject)
        self.assertEqual(self.client.delete(base+f'/{note_id}').status_code, 200)
        self.assertEqual(self.client.get(base+f'/{note_id}').status_code, 404)
        self.client.patch(f'/api/subjects/{self.subject}', json={'archived': 1})
        self.assertEqual(self.client.get(base).json['total'], 22)
        self.client.post('/api/subjects/delete', json={'ids': [self.subject]})
        with app.db() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM notes WHERE subject_id=?', (self.subject,)).fetchone()[0], 0)

    def test_bulk_delete_is_atomic_and_archive_only(self):
        self.client.post('/api/sessions', json={'subject_id': self.subject, 'started_at': datetime.now(timezone.utc).isoformat(), 'duration_seconds': 60})
        self.client.post('/api/subjects', json={'name': 'Another temporary subject'})
        other = self.client.get('/api/state').json['subjects'][-1]['id']
        self.client.patch(f'/api/subjects/{self.subject}', json={'archived': 1})
        self.assertEqual(self.client.post('/api/subjects/delete', json={'ids': [self.subject, other]}).status_code, 400)
        self.assertTrue(any(row['id'] == self.subject for row in self.client.get('/api/state').json['subjects']))
        self.client.patch(f'/api/subjects/{other}', json={'archived': 1})
        self.assertEqual(self.client.post('/api/subjects/delete', json={'ids': [self.subject, other]}).json['deleted'], 2)
        current = self.client.get('/api/state').json
        self.assertFalse(any(row['id'] in (self.subject, other) for row in current['subjects']))
        self.assertFalse(any(row['subject_id'] == self.subject for row in current['sessions']))
        self.assertEqual(self.client.post('/api/subjects/delete', json={'ids': []}).status_code, 400)
        self.assertEqual(self.client.post('/api/subjects/delete', json={'ids': [True]}).status_code, 400)

    def test_theme_and_checkpoint_settings_are_independent(self):
        original = self.client.get('/api/state').json['settings']['checkpoint_minutes']
        self.assertEqual(self.client.patch('/api/settings', json={'theme': 'dark'}).status_code, 200)
        settings = self.client.get('/api/state').json['settings']
        self.assertEqual(settings['theme'], 'dark')
        self.assertEqual(settings['checkpoint_minutes'], original)
        self.client.patch('/api/settings', json={'checkpoint_minutes': 37})
        self.assertEqual(self.client.get('/api/state').json['settings']['theme'], 'dark')
        self.assertEqual(self.client.patch('/api/settings', json={'theme': 'invalid'}).status_code, 400)

    def test_subject_appearance_survives_unrelated_edits(self):
        self.assertEqual(self.client.patch(f'/api/subjects/{self.subject}', json={
            'abbreviation': 'DEV', 'color': '#FFAA00',
        }).status_code, 200)
        self.client.patch(f'/api/subjects/{self.subject}', json={'next_step': 'Exercise 2'})
        subject = next(row for row in self.client.get('/api/state').json['subjects'] if row['id'] == self.subject)
        self.assertEqual(subject['abbreviation'], 'DEV')
        self.assertEqual(subject['color'], '#ffaa00')
        for invalid in ({'color': 'red;bad'}, {'abbreviation': 'TOO-LONG'}):
            self.assertEqual(self.client.patch(f'/api/subjects/{self.subject}', json=invalid).status_code, 400)
        self.assertEqual(self.client.post('/api/subjects', json={
            'name': 'Custom subject', 'abbreviation': 'CS', 'color': '#123456',
        }).status_code, 200)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original = app.DATA
        shutil.copy2(app.DATA / 'learning.sqlite3', Path(self.folder.name) / 'learning.sqlite3')
        app.DATA = Path(self.folder.name)
        with app.db() as connection:
            connection.execute('DELETE FROM timer')
        self.client = app.app.test_client()
        self.client.post('/api/subjects', json={'name': 'Workflow test'})
        self.subject = self.client.get('/api/state').json['subjects'][-1]['id']

    def tearDown(self):
        app.DATA = self.original
        self.folder.cleanup()

    def test_archive_preserves_history_and_blocks_timer(self):
        response = self.client.post('/api/sessions', json={
            'subject_id': self.subject, 'started_at': datetime.now(timezone.utc).isoformat(),
            'duration_seconds': 1800,
        })
        self.assertEqual(response.status_code, 200)
        before = len(self.client.get('/api/state').json['sessions'])
        self.assertEqual(self.client.patch(f'/api/subjects/{self.subject}', json={'archived': 1}).status_code, 200)
        self.assertEqual(len(self.client.get('/api/state').json['sessions']), before)
        self.assertEqual(self.client.post('/api/timer/start', json={'subject_id': self.subject}).status_code, 404)
        self.client.patch(f'/api/subjects/{self.subject}', json={'archived': 0})
        self.assertEqual(self.client.post('/api/timer/start', json={'subject_id': self.subject}).status_code, 200)
        self.assertEqual(self.client.patch(f'/api/subjects/{self.subject}', json={'archived': 1}).status_code, 409)

    def test_checkpoint_caps_time_even_after_browser_was_closed(self):
        self.client.patch('/api/settings', json={'checkpoint_minutes': 45})
        with patch.object(app, 'now', return_value=10000):
            self.client.post('/api/timer/start', json={'subject_id': self.subject})
        with patch.object(app, 'now', return_value=20000):
            timer = self.client.get('/api/state').json['timer']
            self.assertIsNone(timer['segment_at'])
            self.assertEqual(timer['seconds'], 2700)
            self.assertEqual(timer['checkpoint_due'], 1)
            self.client.post('/api/timer/resume')
        with patch.object(app, 'now', return_value=20060):
            resumed = self.client.get('/api/state').json['timer']
            self.assertEqual(resumed['seconds'], 2760)
            self.assertEqual(resumed['checkpoint_due'], 0)
            self.client.post('/api/timer/finish')
        saved = next(session for session in self.client.get('/api/state').json['sessions'] if session['subject_id'] == self.subject)
        self.assertEqual(saved['duration_seconds'], 2760)

    def test_invalid_manual_entry_and_export(self):
        for seconds in (-1, True, 99999999):
            self.assertEqual(self.client.post('/api/sessions', json={'duration_seconds': seconds}).status_code, 400)
        self.assertEqual(self.client.post('/api/sessions', json={
            'duration_seconds': 60, 'subject_id': self.subject, 'started_at': '2026-10-31',
        }).status_code, 400)
        self.assertEqual(self.client.patch('/api/settings', json={'checkpoint_minutes': -1}).status_code, 400)
        exported = self.client.get('/api/export')
        self.assertEqual(exported.status_code, 200)
        self.assertIn('attachment', exported.headers['Content-Disposition'])
        self.assertIn('sessions', exported.json)

    def test_custom_checkpoint_interval(self):
        for minutes in (7, 37, 90, 0):
            self.assertEqual(self.client.patch('/api/settings', json={'checkpoint_minutes': minutes}).status_code, 200)
            self.assertEqual(self.client.get('/api/state').json['settings']['checkpoint_minutes'], minutes)
        for minutes in (-1, 1.5, True, 525601):
            self.assertEqual(self.client.patch('/api/settings', json={'checkpoint_minutes': minutes}).status_code, 400)

    def test_finish_saves_next_step_with_session(self):
        self.client.post('/api/timer/start', json={'subject_id': self.subject})
        self.client.post('/api/timer/pause')
        response = self.client.post('/api/timer/finish', json={'next_step': 'Continue with exercise 6'})
        self.assertEqual(response.status_code, 200)
        state = self.client.get('/api/state').json
        self.assertIsNone(state['timer'])
        subject = next(row for row in state['subjects'] if row['id'] == self.subject)
        self.assertEqual(subject['next_step'], 'Continue with exercise 6')
        self.assertEqual(len([row for row in state['sessions'] if row['subject_id'] == self.subject]), 1)
        self.assertEqual(self.client.post('/api/timer/finish', json={}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
