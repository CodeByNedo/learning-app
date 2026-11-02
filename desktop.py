"""Windows desktop shell and checkpoint monitor for the local Ajde workspace."""
import json
import logging
import msvcrt
import subprocess
import sys
import threading
import os
import queue
from pathlib import Path

import webview
from werkzeug.serving import make_server

import app as study

ROOT = Path(__file__).resolve().parent
stop = threading.Event()
logger = logging.getLogger('ajde.desktop')
native_preferences = {'language': 'sr'}


class DesktopAPI:
    def __init__(self):
        self._window = None

    def set_language(self, language):
        native_preferences['language'] = 'en' if language == 'en' else 'sr'

    def choose_folder(self):
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else None

    def open_subject_folder(self, subject_id):
        try:
            with study.db() as connection:
                subject = connection.execute('SELECT folder_path FROM subjects WHERE id=?', (int(subject_id),)).fetchone()
            if not subject or not subject['folder_path']:
                return {'error': 'Choose a folder for this subject first.'}
            path = Path(subject['folder_path'])
            if not path.is_absolute() or not path.is_dir():
                return {'error': 'Folder not found. Update the path in subject details.'}
            os.startfile(str(path))
            return {'ok': True}
        except Exception:
            logger.exception('Could not open subject folder')
            return {'error': 'Could not open folder.'}


def notification_key(timer):
    if not timer:
        return None
    if timer['break_due']:
        return ('break', timer['started_at'], timer['break_until'], timer['elapsed_seconds'])
    if timer['checkpoint_due']:
        return ('study', timer['started_at'], timer['elapsed_seconds'])
    return None


def monitor(ui_jobs):
    # This loop never calls WebView/JavaScript: a suspended renderer cannot block timing.
    acknowledged = None
    popup = None
    popup_key = None
    try:
        while not stop.wait(0.25):
            try:
                with study.db() as connection:
                    timer = study.timer_state(connection)
                    subject = connection.execute('SELECT name FROM subjects WHERE id=?', (timer['subject_id'],)).fetchone() if timer else None
                key = notification_key(timer)
                if popup and key != popup_key:
                    if popup.poll() is None:
                        popup.terminate()
                    popup.communicate(timeout=3)
                    popup = None
                if popup and popup.poll() is not None:
                    output, errors = popup.communicate(timeout=3)
                    action = output.strip()
                    acknowledged = popup_key
                    popup = None
                    logger.info('Timer alert answered: key=%s action=%s', key, action)
                    if errors:
                        logger.warning('Timer alert output: %s', errors[-2000:])
                    expected = {'expected_started_at': timer['started_at'], 'expected_elapsed_seconds': timer['elapsed_seconds'], 'expected_break_until': timer['break_until']}
                    if action in ('resume', 'pause'):
                        route = 'resume' if action == 'resume' else ('dismiss-break' if key[0] == 'break' else 'break')
                        with study.app.test_client() as client:
                            response = client.post('/api/timer/' + route, json=expected, headers={'X-Timer-Source': 'native-alert'})
                            logger.info('Timer alert transition: %s status=%s', route, response.status_code)
                    elif action == 'finish':
                        ui_jobs.put(('finish', expected))
                    elif action:
                        logger.warning('Unknown timer alert action: %s', action)
                if key and key != acknowledged and not popup:
                    popup_key = key
                    payload = {'subject': subject['name'], 'language': native_preferences['language'], 'kind': key[0]}
                    popup = subprocess.Popen(
                        [sys.executable, str(ROOT / 'checkpoint_popup.py'), json.dumps(payload)],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8',
                        creationflags=subprocess.CREATE_NO_WINDOW,
                    )
                    logger.info('Timer alert opened: %s', key)
            except Exception:
                logger.exception('Checkpoint monitor error')
    finally:
        if popup and popup.poll() is None:
            popup.terminate()
            popup.communicate(timeout=3)


def dispatch_ui(window, jobs):
    # Potentially blocking UI work is isolated from the clock and popup delivery.
    while not stop.is_set():
        try:
            job = jobs.get(timeout=0.5)
        except queue.Empty:
            continue
        try:
            if isinstance(job, tuple) and job[0] == 'finish':
                window.restore()
                window.show()
                expected = json.dumps(job[1])
                window.evaluate_js(f"openStudyFinish({expected}).catch(error=>toast(error.message));")
        except Exception:
            logger.exception('Could not display timer finish screen')


def main():
    import ctypes
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('Ajde.LearningApp.Desktop')
    logging.basicConfig(filename=study.DATA / 'desktop.log', level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s')
    # One shell owns the native monitor. The file remains local and ignored by Git.
    lock = open(study.DATA / 'desktop.lock', 'a+b')
    lock.seek(0)
    lock.write(b'0')
    lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        import tkinter.messagebox
        tkinter.messagebox.showinfo('Ajde.', 'Ajde. je već pokrenut. Provjeri otvorene prozore.')
        lock.close()
        return
    server = make_server('127.0.0.1', 0, study.app, threaded=True)
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    serving.start()
    url = f'http://127.0.0.1:{server.server_port}/'
    desktop_api = DesktopAPI()
    window = webview.create_window('Ajde.', url, width=1200, height=850, js_api=desktop_api,
                                   min_size=(700, 550), confirm_close=True, maximized=True,
                                   background_color='#f6f7f2')
    desktop_api._window = window
    worker = None
    ui_jobs = queue.Queue()

    def loaded():
        nonlocal worker
        if worker is None:
            try:
                from windows_taskbar import configure_window
                configure_window(window.native.Handle.ToInt64(), ROOT)
            except Exception:
                logger.exception('Could not configure taskbar pin metadata')
            worker = threading.Thread(target=monitor, args=(ui_jobs,), daemon=True)
            worker.start()
            threading.Thread(target=dispatch_ui, args=(window, ui_jobs), daemon=True).start()

    window.events.loaded += loaded
    try:
        webview.start(gui='edgechromium', private_mode=False, storage_path=str(study.DATA / 'webview'),
                      icon=str(ROOT / 'assets' / 'ajde.ico'))
    finally:
        stop.set()
        if worker:
            worker.join(timeout=5)
        with study.app.test_client() as client:
            client.post('/api/timer/pause', json={'timed_break': False}, headers={'X-Timer-Source': 'desktop-close'})
        server.shutdown()
        lock.close()


if __name__ == '__main__':
    main()
