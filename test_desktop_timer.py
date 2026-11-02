"""Native notification scheduling tests without opening windows or playing sound."""
import queue
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import desktop


class NativeClockTests(unittest.TestCase):
    def test_native_continue_allows_second_alert_without_webview_calls(self):
        base = dict(started_at='session', subject_id=1, checkpoint_due=1,
                    break_due=0, break_until=None, segment_at=None)
        first = dict(base, elapsed_seconds=2700)
        second = dict(base, elapsed_seconds=5400)
        connection = MagicMock()
        connection.execute.return_value.fetchone.return_value = {'name': 'Test subject'}

        @contextmanager
        def fake_db():
            yield connection

        def popup(*args, **kwargs):
            process = MagicMock()
            process.poll.return_value = 0
            process.communicate.return_value = ('resume', '')
            return process

        client = MagicMock()
        client.post.return_value.status_code = 200
        client.__enter__.return_value = client
        jobs = queue.Queue()
        with patch.object(desktop.stop, 'wait', side_effect=[False, False, False, True]), \
                patch.object(desktop.study, 'db', fake_db), \
                patch.object(desktop.study, 'timer_state', side_effect=[first, first, second]), \
                patch.object(desktop.study.app, 'test_client', return_value=client), \
                patch.object(desktop.subprocess, 'Popen', side_effect=popup) as launched:
            desktop.monitor(jobs)
        self.assertEqual(launched.call_count, 2)
        self.assertEqual(client.post.call_args.args[0], '/api/timer/resume')
        self.assertEqual(client.post.call_args.kwargs['json']['expected_elapsed_seconds'], 2700)
        self.assertTrue(jobs.empty())

    def test_break_notification_has_its_own_key(self):
        timer = dict(started_at='session', elapsed_seconds=2700, checkpoint_due=0,
                     break_due=1, break_until=10000)
        self.assertEqual(desktop.notification_key(timer)[0], 'break')
        timer['break_due'] = 0
        self.assertIsNone(desktop.notification_key(timer))


if __name__ == '__main__':
    unittest.main()
