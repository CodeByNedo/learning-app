import sqlite3
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True


@app.after_request
def prevent_stale_assets(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


DATA = Path(app.instance_path)
DATA.mkdir(exist_ok=True)


@contextmanager
def db():
    connection = sqlite3.connect(DATA / 'learning.sqlite3', timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    try:
        with connection:
            connection.execute('BEGIN IMMEDIATE')
            yield connection
    finally:
        connection.close()


with db() as connection:
    connection.executescript('''
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL,
            exam_date TEXT, next_step TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            subject_id INTEGER NOT NULL REFERENCES subjects(id),
            started_at TEXT NOT NULL, duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0)
        );
        CREATE TABLE IF NOT EXISTS timer (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            subject_id INTEGER NOT NULL REFERENCES subjects(id),
            started_at TEXT NOT NULL, segment_at REAL,
            elapsed_seconds INTEGER NOT NULL DEFAULT 0
        );
    ''')
    if 'archived' not in {row['name'] for row in connection.execute('PRAGMA table_info(subjects)')}:
        connection.execute('ALTER TABLE subjects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
    if 'checkpoint_due' not in {row['name'] for row in connection.execute('PRAGMA table_info(timer)')}:
        connection.execute('ALTER TABLE timer ADD COLUMN checkpoint_due INTEGER NOT NULL DEFAULT 0')
    connection.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), checkpoint_minutes INTEGER NOT NULL)')
    connection.execute('INSERT OR IGNORE INTO settings(id, checkpoint_minutes) VALUES(1, 45)')
    connection.execute('''CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )''')
    connection.execute('CREATE INDEX IF NOT EXISTS notes_subject_date ON notes(subject_id, pinned, updated_at)')
    connection.execute('''CREATE TABLE IF NOT EXISTS note_folders (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        parent_id INTEGER REFERENCES note_folders(id),
        subject_id INTEGER UNIQUE REFERENCES subjects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
    )''')
    if 'folder_id' not in {row['name'] for row in connection.execute('PRAGMA table_info(notes)')}:
        connection.execute('ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES note_folders(id) ON DELETE SET NULL')
        for subject in connection.execute('SELECT DISTINCT s.id,s.name FROM subjects s JOIN notes n ON n.subject_id=s.id').fetchall():
            cursor = connection.execute('INSERT INTO note_folders(name,subject_id,created_at) VALUES(?,?,?)',
                                        (subject['name'], subject['id'], datetime.now(timezone.utc).isoformat()))
            connection.execute('UPDATE notes SET folder_id=? WHERE subject_id=?', (cursor.lastrowid, subject['id']))
    if next(row for row in connection.execute('PRAGMA table_info(notes)') if row['name'] == 'subject_id')['notnull']:
        connection.execute('''CREATE TABLE notes_v2 (
            id INTEGER PRIMARY KEY, subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
            title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            folder_id INTEGER REFERENCES note_folders(id) ON DELETE SET NULL
        )''')
        connection.execute('INSERT INTO notes_v2 SELECT id,subject_id,title,body,pinned,created_at,updated_at,folder_id FROM notes')
        connection.execute('DROP TABLE notes')
        connection.execute('ALTER TABLE notes_v2 RENAME TO notes')
        connection.execute('CREATE INDEX notes_subject_date ON notes(subject_id,pinned,updated_at)')
    connection.execute('CREATE INDEX IF NOT EXISTS notes_folder ON notes(folder_id)')
    if 'theme' not in {row['name'] for row in connection.execute('PRAGMA table_info(settings)')}:
        connection.execute("ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'light'")
    if 'break_minutes' not in {row['name'] for row in connection.execute('PRAGMA table_info(settings)')}:
        connection.execute('ALTER TABLE settings ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 5')
    timer_columns = {row['name'] for row in connection.execute('PRAGMA table_info(timer)')}
    for column, definition in [('next_checkpoint_seconds', 'INTEGER'), ('break_until', 'REAL'), ('break_due', 'INTEGER NOT NULL DEFAULT 0')]:
        if column not in timer_columns:
            connection.execute(f'ALTER TABLE timer ADD COLUMN {column} {definition}')
    connection.execute('''CREATE TABLE IF NOT EXISTS timer_events (
        id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, session_started_at TEXT,
        event TEXT NOT NULL, source TEXT NOT NULL, elapsed_seconds INTEGER NOT NULL
    )''')
    subject_columns = {row['name'] for row in connection.execute('PRAGMA table_info(subjects)')}
    if 'abbreviation' not in subject_columns:
        connection.execute("ALTER TABLE subjects ADD COLUMN abbreviation TEXT NOT NULL DEFAULT ''")
    if 'folder_path' not in subject_columns:
        connection.execute("ALTER TABLE subjects ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''")
    if 'color' not in subject_columns:
        connection.execute("ALTER TABLE subjects ADD COLUMN color TEXT NOT NULL DEFAULT '#295a45'")
        palette = ['#e6eee0', '#e7edf3', '#f1e9dc', '#eee8f2', '#f5e4e4', '#e0efed']
        for row in connection.execute('SELECT id FROM subjects').fetchall():
            connection.execute('UPDATE subjects SET color=? WHERE id=?', (palette[row['id'] % len(palette)], row['id']))


def now():
    return datetime.now(timezone.utc).timestamp()


def valid_folder(value):
    return isinstance(value, str) and len(value) <= 2048 and ('\x00' not in value) and (not value or (Path(value).is_absolute() and Path(value).is_dir()))


def ensure_subject_note_folder(connection, subject_id):
    row = connection.execute('SELECT id FROM note_folders WHERE subject_id=?', (subject_id,)).fetchone()
    if row:
        return row['id']
    subject = connection.execute('SELECT name FROM subjects WHERE id=?', (subject_id,)).fetchone()
    # Reuse a manually created top-level folder with this subject's name.
    row = next((row for row in connection.execute('SELECT id,name FROM note_folders WHERE parent_id IS NULL AND subject_id IS NULL')
                if row['name'].casefold() == subject['name'].casefold()), None)
    if row:
        connection.execute('UPDATE note_folders SET subject_id=? WHERE id=?', (subject_id, row['id']))
        return row['id']
    return connection.execute('INSERT INTO note_folders(name,subject_id,created_at) VALUES(?,?,?)',
                              (subject['name'], subject_id, datetime.now(timezone.utc).isoformat())).lastrowid


def folder_exists(connection, folder_id):
    return folder_id is None or (type(folder_id) is int and connection.execute('SELECT id FROM note_folders WHERE id=?', (folder_id,)).fetchone() is not None)


def folder_descendants(connection, folder_id):
    ids = {folder_id}
    rows = connection.execute('SELECT id,parent_id FROM note_folders').fetchall()
    while True:
        found = {row['id'] for row in rows if row['parent_id'] in ids}
        if found <= ids:
            return ids
        ids |= found


def record_timer_event(connection, state, event, source='server'):
    connection.execute('INSERT INTO timer_events(occurred_at, session_started_at, event, source, elapsed_seconds) VALUES(?,?,?,?,?)',
                       (datetime.now(timezone.utc).isoformat(), state['started_at'], event, source, state['elapsed_seconds']))


def timer_state(connection):
    row = connection.execute('SELECT * FROM timer').fetchone()
    if not row:
        return None
    state = dict(row)
    interval = connection.execute('SELECT checkpoint_minutes FROM settings WHERE id=1').fetchone()[0] * 60
    if interval and state['next_checkpoint_seconds'] is None:
        state['next_checkpoint_seconds'] = (state['elapsed_seconds'] // interval + 1) * interval
        connection.execute('UPDATE timer SET next_checkpoint_seconds=?', (state['next_checkpoint_seconds'],))
    elapsed = state['elapsed_seconds']
    if state['segment_at'] is not None:
        elapsed += max(0, int(now() - state['segment_at']))
    if interval and state['segment_at'] is not None and elapsed >= state['next_checkpoint_seconds']:
        state['elapsed_seconds'] = state['next_checkpoint_seconds']
        state['segment_at'] = None
        connection.execute('UPDATE timer SET elapsed_seconds=?, segment_at=NULL, checkpoint_due=1', (state['elapsed_seconds'],))
        state['checkpoint_due'] = 1
        elapsed = state['elapsed_seconds']
        record_timer_event(connection, state, 'checkpoint')
    if state['break_until'] is not None and now() >= state['break_until'] and not state['break_due']:
        state['break_due'] = 1
        connection.execute('UPDATE timer SET break_due=1')
        record_timer_event(connection, state, 'break_finished')
    state['seconds'] = elapsed
    state['break_remaining_seconds'] = max(0, int(state['break_until'] - now() + 0.999)) if state['break_until'] else None
    return state


@app.get('/')
def index():
    return render_template('index.html')


@app.get('/api/state')
def state():
    with db() as connection:
        return jsonify(subjects=[dict(r) for r in connection.execute('SELECT * FROM subjects ORDER BY id')],
                       sessions=[dict(r) for r in connection.execute('SELECT * FROM sessions ORDER BY started_at DESC')],
                       timer=timer_state(connection),
                       settings=dict(connection.execute('SELECT checkpoint_minutes, theme, break_minutes FROM settings WHERE id=1').fetchone()))


@app.post('/api/subjects')
def add_subject():
    data = request.get_json()
    name = str(data.get('name', '')).strip()
    exam = data.get('exam_date') or None
    abbreviation = str(data.get('abbreviation', '')).strip()
    color = data.get('color', '#295a45')
    folder = data.get('folder_path', '').strip() if isinstance(data.get('folder_path', ''), str) else None
    if not valid_folder(folder):
        return jsonify(error='Choose an existing folder with an absolute path.'), 400
    if len(abbreviation) > 6 or not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
        return jsonify(error='Use up to 6 characters and a valid color.'), 400
    if not name or len(name) > 120:
        return jsonify(error='Enter a subject name (up to 120 characters).'), 400
    if exam:
        try:
            datetime.strptime(exam, '%Y-%m-%d')
        except ValueError:
            return jsonify(error='Enter a valid exam date.'), 400
    with db() as connection:
        connection.execute('INSERT INTO subjects(name, exam_date, abbreviation, color, folder_path) VALUES (?, ?, ?, ?, ?)',
                           (name, exam, abbreviation, color.lower(), folder))
    return jsonify(ok=True)


@app.patch('/api/subjects/<int:subject_id>')
def update_subject(subject_id):
    data = request.get_json()
    with db() as connection:
        subject = connection.execute('SELECT * FROM subjects WHERE id=?', (subject_id,)).fetchone()
        if not subject:
            return jsonify(error='Subject not found.'), 404
        archived = data.get('archived', subject['archived'])
        if archived not in (0, 1, False, True):
            return jsonify(error='Invalid archive status.'), 400
        if archived and connection.execute('SELECT id FROM timer WHERE subject_id=?', (subject_id,)).fetchone():
            return jsonify(error='Finish the current session first.'), 409
        name = str(data.get('name', subject['name'])).strip()
        abbreviation = str(data.get('abbreviation', subject['abbreviation'])).strip()
        color = data.get('color', subject['color'])
        folder = data.get('folder_path', subject['folder_path'])
        if 'folder_path' in data:
            folder = folder.strip() if isinstance(folder, str) else None
            if not valid_folder(folder):
                return jsonify(error='Choose an existing folder with an absolute path.'), 400
        if len(abbreviation) > 6 or not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            return jsonify(error='Use up to 6 characters and a valid color.'), 400
        exam = data.get('exam_date', subject['exam_date']) or None
        if not name or len(name) > 120:
            return jsonify(error='Enter a subject name (up to 120 characters).'), 400
        if exam:
            try:
                datetime.strptime(exam, '%Y-%m-%d')
            except (ValueError, TypeError):
                return jsonify(error='Enter a valid exam date.'), 400
        connection.execute('UPDATE subjects SET name=?, exam_date=?, next_step=?, archived=?, abbreviation=?, color=?, folder_path=? WHERE id=?',
                           (name, exam, str(data.get('next_step', subject['next_step']))[:1000], int(archived), abbreviation, color.lower(), folder, subject_id))
    return jsonify(ok=True)


@app.post('/api/timer/<action>')
def timer_action(action):
    data = request.get_json(silent=True) or {}
    source = request.headers.get('X-Timer-Source', 'interface')[:80]
    with db() as connection:
        current = timer_state(connection)
        settings = connection.execute('SELECT * FROM settings WHERE id=1').fetchone()
        interval = settings['checkpoint_minutes'] * 60
        if data.get('expected_started_at') is not None:
            if not current or current['started_at'] != data['expected_started_at'] or current['elapsed_seconds'] != data.get('expected_elapsed_seconds') or current['segment_at'] is not None:
                return jsonify(error='Timer changed. Use the current timer controls.'), 409
            if 'expected_break_until' in data and current['break_until'] != data['expected_break_until']:
                return jsonify(error='Timer changed. Use the current timer controls.'), 409
        if action == 'start':
            if current:
                return jsonify(error='Finish the current session first.'), 409
            subject_id = data.get('subject_id')
            if not connection.execute('SELECT id FROM subjects WHERE id=? AND archived=0', (subject_id,)).fetchone():
                return jsonify(error='Subject not found.'), 404
            stamp = datetime.now(timezone.utc).isoformat()
            connection.execute('INSERT INTO timer(id,subject_id,started_at,segment_at,elapsed_seconds,next_checkpoint_seconds) VALUES(1,?,?,?,?,?)',
                               (subject_id, stamp, now(), 0, interval or None))
            record_timer_event(connection, {'started_at': stamp, 'elapsed_seconds': 0}, 'start', source)
        elif not current:
            return jsonify(error='No active session.'), 400
        elif action in ('pause', 'break'):
            timed = action == 'break' or data.get('timed_break', True)
            until = current['break_until']
            if timed and until is None:
                until = now() + settings['break_minutes'] * 60
            if not timed:
                until = None
            connection.execute('UPDATE timer SET elapsed_seconds=?,segment_at=NULL,checkpoint_due=0,break_until=?,break_due=0',
                               (current['seconds'], until))
            current['elapsed_seconds'] = current['seconds']
            record_timer_event(connection, current, 'break_started' if timed else 'pause', source)
        elif action == 'dismiss-break':
            connection.execute('UPDATE timer SET break_until=NULL,break_due=0,checkpoint_due=0')
            record_timer_event(connection, current, 'break_dismissed', source)
        elif action == 'resume':
            if current['segment_at'] is None:
                target = current['next_checkpoint_seconds']
                if interval and (target is None or target <= current['elapsed_seconds']):
                    target = (current['elapsed_seconds'] // interval + 1) * interval
                connection.execute('UPDATE timer SET segment_at=?,checkpoint_due=0,break_until=NULL,break_due=0,next_checkpoint_seconds=?',
                                   (now(), target if interval else None))
                record_timer_event(connection, current, 'resume', source)
        elif action == 'finish':
            session_note = data.get('session_note', '')
            if not isinstance(session_note, str) or len(session_note) > 100000:
                return jsonify(error='Note text must be at most 100000 characters.'), 400
            if session_note.strip():
                folder_id = ensure_subject_note_folder(connection, current['subject_id'])
                stamp = datetime.now(timezone.utc).isoformat()
                title = next(line.strip() for line in session_note.splitlines() if line.strip())[:120]
                connection.execute('INSERT INTO notes(subject_id,folder_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                                   (current['subject_id'], folder_id, title, session_note.strip(), stamp, stamp))
            if 'next_step' in data:
                connection.execute('UPDATE subjects SET next_step=? WHERE id=?', (str(data['next_step'])[:1000], current['subject_id']))
            connection.execute('INSERT INTO sessions(subject_id,started_at,duration_seconds) VALUES(?,?,?)',
                               (current['subject_id'], current['started_at'], current['seconds']))
            current['elapsed_seconds'] = current['seconds']
            record_timer_event(connection, current, 'finish', source)
            connection.execute('DELETE FROM timer')
        else:
            return jsonify(error='Unknown action.'), 400
    return jsonify(ok=True)


@app.post('/api/sessions')
def add_session():
    data = request.get_json()
    seconds = data.get('duration_seconds')
    if not isinstance(seconds, int) or isinstance(seconds, bool) or not 0 < seconds <= 604800:
        return jsonify(error='Enter a duration between 0 and 10080 minutes.'), 400
    try:
        start = datetime.fromisoformat(data.get('started_at', ''))
        if start.tzinfo is None or start.timestamp() > now() + 60:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify(error='Enter a valid session date.'), 400
    with db() as connection:
        subject_id = data.get('subject_id')
        if not connection.execute('SELECT id FROM subjects WHERE id=? AND archived=0', (subject_id,)).fetchone():
            return jsonify(error='Subject not found.'), 404
        connection.execute('INSERT INTO sessions(subject_id, started_at, duration_seconds) VALUES (?, ?, ?)',
                           (subject_id, start.astimezone(timezone.utc).isoformat(), seconds))
    return jsonify(ok=True)


@app.patch('/api/settings')
def save_settings():
    data = request.get_json()
    with db() as connection:
        current = connection.execute('SELECT * FROM settings WHERE id=1').fetchone()
        minutes = data.get('checkpoint_minutes', current['checkpoint_minutes'])
        theme = data.get('theme', current['theme'])
        break_minutes = data.get('break_minutes', current['break_minutes'])
        if type(break_minutes) is not int or not 1 <= break_minutes <= 1440:
            return jsonify(error='Enter a break duration between 1 and 1440 minutes.'), 400
        if type(minutes) is not int or not 0 <= minutes <= 525600:
            return jsonify(error='Invalid checkpoint interval.'), 400
        if theme not in ('light', 'dark'):
            return jsonify(error='Invalid theme.'), 400
        timer = timer_state(connection)
        if minutes != current['checkpoint_minutes'] and timer:
            seconds = timer['seconds']
            target = (seconds // (minutes * 60) + 1) * minutes * 60 if minutes else None
            connection.execute('UPDATE timer SET elapsed_seconds=?,segment_at=?,next_checkpoint_seconds=?', (seconds, now() if timer['segment_at'] is not None else None, target))
            record_timer_event(connection, dict(timer, elapsed_seconds=seconds), 'interval_changed', 'settings')
        connection.execute('UPDATE settings SET checkpoint_minutes=?,theme=?,break_minutes=? WHERE id=1', (minutes, theme, break_minutes))
    return jsonify(ok=True)


@app.get('/api/export')
def export_data():
    with db() as connection:
        response = jsonify(version=1, exported_at=datetime.now(timezone.utc).isoformat(),
                           subjects=[dict(r) for r in connection.execute('SELECT * FROM subjects')],
                           sessions=[dict(r) for r in connection.execute('SELECT * FROM sessions')],
                           notes=[dict(r) for r in connection.execute('SELECT * FROM notes')],
                           note_folders=[dict(r) for r in connection.execute('SELECT * FROM note_folders')],
                           schedules=[dict(r) for r in connection.execute('SELECT * FROM schedules')],
                           schedule_entries=[dict(r) for r in connection.execute('SELECT * FROM schedule_entries')],
                           timer=timer_state(connection),
                           settings=dict(connection.execute('SELECT checkpoint_minutes, theme, break_minutes FROM settings').fetchone()))
    response.headers['Content-Disposition'] = 'attachment; filename=ajde-backup.json'
    return response


@app.route('/api/sessions/<int:session_id>', methods=['PATCH', 'DELETE'])
def edit_session(session_id):
    with db() as connection:
        if request.method == 'DELETE':
            connection.execute('DELETE FROM sessions WHERE id=?', (session_id,))
        else:
            value = request.get_json().get('duration_seconds')
            if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > 604800:
                return jsonify(error='Enter a duration between 0 and 10080 minutes.'), 400
            connection.execute('UPDATE sessions SET duration_seconds=? WHERE id=?', (value, session_id))
    return jsonify(ok=True)


@app.route('/api/note-folders', methods=['GET', 'POST'])
@app.route('/api/note-folders/<int:folder_id>', methods=['PATCH', 'DELETE'])
def note_folders(folder_id=None):
    with db() as connection:
        if request.method == 'GET':
            return jsonify(folders=[dict(row) for row in connection.execute('''
                SELECT f.*, (SELECT COUNT(*) FROM notes n WHERE n.folder_id=f.id) AS note_count
                FROM note_folders f ORDER BY f.name COLLATE NOCASE, f.id''')])
        old = connection.execute('SELECT * FROM note_folders WHERE id=?', (folder_id,)).fetchone() if folder_id else None
        if folder_id and not old:
            return jsonify(error='Folder not found.'), 404
        if request.method == 'DELETE':
            if (request.get_json(silent=True) or {}).get('confirm') is not True:
                return jsonify(error='Confirm folder deletion first.'), 400
            ids = folder_descendants(connection, folder_id)
            placeholders = ','.join('?' for _ in ids)
            deleted_notes = connection.execute(f'DELETE FROM notes WHERE folder_id IN ({placeholders})', list(ids)).rowcount
            connection.execute(f'UPDATE note_folders SET parent_id=NULL WHERE id IN ({placeholders})', list(ids))
            connection.execute(f'DELETE FROM note_folders WHERE id IN ({placeholders})', list(ids))
            return jsonify(ok=True, folders=len(ids), notes=deleted_notes)
        data = request.get_json()
        name = data.get('name', old['name'] if old else '')
        parent = data.get('parent_id', old['parent_id'] if old else None)
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
            return jsonify(error='Enter a folder name up to 100 characters.'), 400
        name = name.strip()
        if not folder_exists(connection, parent):
            return jsonify(error='Folder not found.'), 404
        if old and parent in folder_descendants(connection, folder_id):
            return jsonify(error='A folder cannot be moved inside itself.'), 400
        siblings = connection.execute('SELECT id,name FROM note_folders WHERE parent_id IS ?', (parent,)).fetchall()
        if any(row['id'] != folder_id and row['name'].casefold() == name.casefold() for row in siblings):
            return jsonify(error='A folder with this name already exists here.'), 409
        if old:
            connection.execute('UPDATE note_folders SET name=?,parent_id=? WHERE id=?', (name, parent, folder_id))
        else:
            folder_id = connection.execute('INSERT INTO note_folders(name,parent_id,created_at) VALUES(?,?,?)',
                                           (name, parent, datetime.now(timezone.utc).isoformat())).lastrowid
        return jsonify(folder=dict(connection.execute('SELECT * FROM note_folders WHERE id=?', (folder_id,)).fetchone()))


@app.get('/api/note-folders/<int:folder_id>/delete-preview')
def folder_deletion_preview(folder_id):
    with db() as connection:
        folder = connection.execute('SELECT * FROM note_folders WHERE id=?', (folder_id,)).fetchone()
        if not folder:
            return jsonify(error='Folder not found.'), 404
        ids = folder_descendants(connection, folder_id)
        placeholders = ','.join('?' for _ in ids)
        count = connection.execute(f'SELECT COUNT(*) FROM notes WHERE folder_id IN ({placeholders})', list(ids)).fetchone()[0]
        return jsonify(name=folder['name'], subfolders=len(ids)-1, notes=count)


@app.route('/api/notes', methods=['GET', 'POST'])
def all_notes():
    if request.method == 'POST':
        data = request.get_json()
        subject_id = data.get('subject_id')
        folder_id = data.get('folder_id')
        title = str(data.get('title', '')).strip()
        body = str(data.get('body', ''))
        if not title or len(title) > 160 or len(body) > 100000:
            return jsonify(error='Enter a title (up to 160 characters) and a note up to 100000 characters.'), 400
        with db() as connection:
            if subject_id is not None and (type(subject_id) is not int or not connection.execute('SELECT id FROM subjects WHERE id=?', (subject_id,)).fetchone()):
                return jsonify(error='Subject not found.'), 404
            if not folder_exists(connection, folder_id):
                return jsonify(error='Folder not found.'), 404
            stamp = datetime.now(timezone.utc).isoformat()
            cursor = connection.execute('INSERT INTO notes(subject_id,folder_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                                        (subject_id, folder_id, title, body, stamp, stamp))
            return jsonify(note=dict(connection.execute('SELECT * FROM notes WHERE id=?', (cursor.lastrowid,)).fetchone()))
    try:
        page = max(1, int(request.args.get('page', 1)))
        subject_id = int(request.args['subject_id']) if request.args.get('subject_id') else None
    except ValueError:
        return jsonify(error='Invalid page.'), 400
    query = request.args.get('q', '').strip()[:200].casefold()
    with db() as connection:
        sql = 'SELECT * FROM notes'
        params = []
        if subject_id is not None:
            sql += ' WHERE subject_id=?'
            params.append(subject_id)
        rows = connection.execute(sql + ' ORDER BY pinned DESC, updated_at DESC, id DESC', params).fetchall()
        matches = [dict(row) for row in rows if not query or query in row['title'].casefold() or query in row['body'].casefold()]
        if request.args.get('folder_id'):
            try:
                folder_id = int(request.args['folder_id'])
            except ValueError:
                return jsonify(error='Folder not found.'), 404
            if not connection.execute('SELECT id FROM note_folders WHERE id=?', (folder_id,)).fetchone():
                return jsonify(error='Folder not found.'), 404
            ids = {folder_id} if request.args.get('direct') == '1' else folder_descendants(connection, folder_id)
            matches = [row for row in matches if row['folder_id'] in ids]
        count = len(matches)
        page = min(page, max(1, (count + 19) // 20))
        notes = []
        for row in matches[(page - 1) * 20:page * 20]:
            row['preview'] = row.pop('body')[:180]
            notes.append(row)
        return jsonify(notes=notes, total=count, page=page, pages=max(1, (count + 19) // 20))


@app.route('/api/subjects/<int:subject_id>/notes', methods=['GET', 'POST'])
def subject_notes(subject_id):
    with db() as connection:
        if not connection.execute('SELECT id FROM subjects WHERE id=?', (subject_id,)).fetchone():
            return jsonify(error='Subject not found.'), 404
        if request.method == 'POST':
            data = request.get_json()
            title = str(data.get('title', '')).strip()
            body = str(data.get('body', ''))
            if not title or len(title) > 160 or len(body) > 100000:
                return jsonify(error='Enter a title (up to 160 characters) and a note up to 100000 characters.'), 400
            stamp = datetime.now(timezone.utc).isoformat()
            folder_id = data.get('folder_id') if 'folder_id' in data else ensure_subject_note_folder(connection, subject_id)
            if not folder_exists(connection, folder_id):
                return jsonify(error='Folder not found.'), 404
            cursor = connection.execute('INSERT INTO notes(subject_id,title,body,created_at,updated_at,folder_id) VALUES(?,?,?,?,?,?)',
                                        (subject_id, title, body, stamp, stamp, folder_id))
            return jsonify(note=dict(connection.execute('SELECT * FROM notes WHERE id=?', (cursor.lastrowid,)).fetchone()))
        try:
            page = max(1, int(request.args.get('page', 1)))
        except ValueError:
            return jsonify(error='Invalid page.'), 400
        query = request.args.get('q', '').strip()[:200].casefold()
        # Python casefold handles Serbian Latin characters consistently with SQLite's
        # limited built-in Unicode case-insensitive search. Bodies are not returned in lists.
        rows = connection.execute('SELECT * FROM notes WHERE subject_id=? ORDER BY pinned DESC, updated_at DESC, id DESC', (subject_id,)).fetchall()
        matches = [dict(row) for row in rows if not query or query in row['title'].casefold() or query in row['body'].casefold()]
        count = len(matches)
        page = min(page, max(1, (count + 19) // 20))
        notes = []
        for row in matches[(page - 1) * 20:page * 20]:
            row['preview'] = row.pop('body')[:140]
            notes.append(row)
        return jsonify(notes=notes, total=count, page=page, pages=max(1, (count + 19) // 20))


@app.route('/api/subjects/<int:subject_id>/notes/<int:note_id>', methods=['GET', 'PATCH', 'DELETE'])
@app.route('/api/notes/<int:note_id>', methods=['GET', 'PATCH', 'DELETE'])
def note_detail(note_id, subject_id=None):
    with db() as connection:
        row = connection.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
        if row and subject_id is not None and row['subject_id'] != subject_id:
            row = None
        if not row:
            return jsonify(error='Note not found.'), 404
        if request.method == 'DELETE':
            connection.execute('DELETE FROM notes WHERE id=?', (note_id,))
            return jsonify(ok=True)
        if request.method == 'PATCH':
            data = request.get_json()
            title = str(data.get('title', row['title'])).strip()
            body = str(data.get('body', row['body']))
            pinned = data.get('pinned', row['pinned'])
            folder_id = data.get('folder_id', row['folder_id'])
            if not folder_exists(connection, folder_id):
                return jsonify(error='Folder not found.'), 404
            if not title or len(title) > 160 or len(body) > 100000 or type(pinned) not in (bool, int) or pinned not in (0, 1):
                return jsonify(error='Enter a title (up to 160 characters) and a note up to 100000 characters.'), 400
            connection.execute('UPDATE notes SET title=?,body=?,pinned=?,updated_at=?,folder_id=? WHERE id=?',
                               (title, body, int(pinned), datetime.now(timezone.utc).isoformat(), folder_id, note_id))
            row = connection.execute('SELECT * FROM notes WHERE id=?', (note_id,)).fetchone()
        return jsonify(note=dict(row))


@app.post('/api/subjects/delete')
def delete_archived_subjects():
    ids = request.get_json().get('ids')
    if not isinstance(ids, list) or not ids or len(ids) > 500 or any(type(value) is not int for value in ids):
        return jsonify(error='Select archived subjects to delete.'), 400
    ids = list(set(ids))
    placeholders = ','.join('?' for _ in ids)
    with db() as connection:
        rows = connection.execute(f'SELECT id, archived FROM subjects WHERE id IN ({placeholders})', ids).fetchall()
        if len(rows) != len(ids) or any(not row['archived'] for row in rows):
            return jsonify(error='Only archived subjects can be deleted.'), 400
        if connection.execute(f'SELECT id FROM timer WHERE subject_id IN ({placeholders})', ids).fetchone():
            return jsonify(error='Finish the current session first.'), 409
        connection.execute(f'DELETE FROM sessions WHERE subject_id IN ({placeholders})', ids)
        connection.execute(f'DELETE FROM subjects WHERE id IN ({placeholders})', ids)
    return jsonify(ok=True, deleted=len(ids))


from schedules import register_schedules
register_schedules(app, db)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
