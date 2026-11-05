from schedule_overrides import effective_entries, week_key
"""Named, recurring weekly timetables for existing subjects."""
from datetime import datetime, timezone
from flask import jsonify, request


def register_schedules(app, db):
    with db() as connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )''')
        connection.execute('CREATE UNIQUE INDEX IF NOT EXISTS one_active_schedule ON schedules(is_active) WHERE is_active=1')
        connection.execute('''CREATE TABLE IF NOT EXISTS schedule_entries (
            id INTEGER PRIMARY KEY,
            schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
            subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
            start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
            end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
            kind TEXT NOT NULL CHECK(kind IN ('lecture','exercise')),
            room TEXT NOT NULL DEFAULT '', CHECK(end_minute>start_minute)
        )''')
        connection.execute('CREATE INDEX IF NOT EXISTS schedule_entry_day ON schedule_entries(schedule_id,weekday,start_minute)')

    @app.route('/api/schedules', methods=['GET', 'POST'])
    def schedules_list():
        with db() as connection:
            if request.method == 'GET':
                return jsonify(schedules=[dict(row) for row in connection.execute('''SELECT s.*,
                    (SELECT COUNT(*) FROM schedule_entries e WHERE e.schedule_id=s.id) AS entry_count
                    FROM schedules s ORDER BY s.is_active DESC,s.id''')])
            data = request.get_json()
            name = data.get('name')
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
                return jsonify(error='Enter a schedule name up to 100 characters.'), 400
            entries = data.get('entries', [])
            if not isinstance(entries, list) or len(entries) > 250:
                return jsonify(error='Use up to 250 classes per schedule.'), 400
            validated = []
            for index, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    return jsonify(error='Invalid class.', entry_index=index), 400
                subject_id = entry.get('subject_id')
                subject = connection.execute('SELECT id FROM subjects WHERE id=? AND archived=0', (subject_id,)).fetchone() if type(subject_id) is int else None
                if not subject:
                    return jsonify(error='Choose an existing active subject.', entry_index=index), 400
                day, start, end = (entry.get(key) for key in ('weekday', 'start_minute', 'end_minute'))
                if type(day) is not int or not 0 <= day <= 6 or type(start) is not int or type(end) is not int or not 0 <= start < end <= 1440:
                    return jsonify(error='Choose a day and an end time later than the start time.', entry_index=index), 400
                room = entry.get('room', '')
                kind = entry.get('kind')
                if kind not in ('lecture', 'exercise') or not isinstance(room, str) or len(room.strip()) > 100:
                    return jsonify(error='Choose lecture or exercise and a room up to 100 characters.', entry_index=index), 400
                validated.append((subject_id, day, start, end, kind, room.strip()))
            first = not connection.execute('SELECT id FROM schedules').fetchone()
            stamp = datetime.now(timezone.utc).isoformat()
            cursor = connection.execute('INSERT INTO schedules(name,is_active,created_at,updated_at) VALUES(?,?,?,?)',
                                        (name.strip(), int(first), stamp, stamp))
            schedule_id = cursor.lastrowid
            connection.executemany('INSERT INTO schedule_entries(subject_id,weekday,start_minute,end_minute,kind,room,schedule_id) VALUES(?,?,?,?,?,?,?)',
                                   [(*entry, schedule_id) for entry in validated])
            return jsonify(schedule=dict(connection.execute('SELECT * FROM schedules WHERE id=?', (schedule_id,)).fetchone()))

    @app.route('/api/schedules/<int:schedule_id>', methods=['GET', 'PATCH', 'DELETE'])
    def schedule_detail(schedule_id):
        with db() as connection:
            row = connection.execute('SELECT * FROM schedules WHERE id=?', (schedule_id,)).fetchone()
            if not row:
                return jsonify(error='Schedule not found.'), 404
            if request.method == 'GET':
                week_start = request.args.get('week_start')
                if week_start and not week_key(week_start):
                    return jsonify(error='Choose a valid week starting on Monday.'), 400
                entries = effective_entries(connection, schedule_id, week_start) if week_start else [dict(item) for item in connection.execute(
                    'SELECT * FROM schedule_entries WHERE schedule_id=? ORDER BY weekday,start_minute,id', (schedule_id,))]
                return jsonify(schedule=dict(row), entries=entries)
            data = request.get_json(silent=True) or {}
            if request.method == 'DELETE':
                if data.get('confirm') is not True:
                    return jsonify(error='Confirm schedule deletion first.'), 400
                connection.execute('DELETE FROM schedules WHERE id=?', (schedule_id,))
                if row['is_active']:
                    connection.execute('UPDATE schedules SET is_active=1 WHERE id=(SELECT MIN(id) FROM schedules)')
                return jsonify(ok=True)
            name = data.get('name', row['name'])
            active = data.get('is_active', row['is_active'])
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
                return jsonify(error='Enter a schedule name up to 100 characters.'), 400
            if type(active) not in (bool, int) or active not in (0, 1):
                return jsonify(error='Invalid schedule.'), 400
            if active:
                connection.execute('UPDATE schedules SET is_active=0')
            connection.execute('UPDATE schedules SET name=?,is_active=?,updated_at=? WHERE id=?',
                               (name.strip(), int(active), datetime.now(timezone.utc).isoformat(), schedule_id))
            return jsonify(ok=True)

    @app.post('/api/schedules/<int:schedule_id>/entries')
    @app.route('/api/schedules/<int:schedule_id>/entries/<int:entry_id>', methods=['PATCH', 'DELETE'])
    def schedule_entry(schedule_id, entry_id=None):
        with db() as connection:
            if not connection.execute('SELECT id FROM schedules WHERE id=?', (schedule_id,)).fetchone():
                return jsonify(error='Schedule not found.'), 404
            old = connection.execute('SELECT * FROM schedule_entries WHERE id=? AND schedule_id=?', (entry_id, schedule_id)).fetchone() if entry_id else None
            if entry_id and not old:
                return jsonify(error='Class not found.'), 404
            if request.method == 'DELETE':
                if (request.get_json(silent=True) or {}).get('confirm') is not True:
                    return jsonify(error='Confirm class deletion first.'), 400
                connection.execute('DELETE FROM schedule_entries WHERE id=?', (entry_id,))
                return jsonify(ok=True)
            data = request.get_json()
            values = {key: data.get(key, old[key] if old else None) for key in ('subject_id','weekday','start_minute','end_minute','kind')}
            subject = connection.execute('SELECT * FROM subjects WHERE id=?', (values['subject_id'],)).fetchone() if type(values['subject_id']) is int else None
            if not subject or (subject['archived'] and (not old or old['subject_id'] != subject['id'])):
                return jsonify(error='Choose an existing active subject.'), 400
            day, start, end = (values[key] for key in ('weekday','start_minute','end_minute'))
            room = data.get('room', old['room'] if old else '')
            if type(day) is not int or not 0 <= day <= 6 or type(start) is not int or type(end) is not int or not 0 <= start < end <= 1440:
                return jsonify(error='Choose a day and an end time later than the start time.'), 400
            if values['kind'] not in ('lecture','exercise') or not isinstance(room, str) or len(room.strip()) > 100:
                return jsonify(error='Choose lecture or exercise and a room up to 100 characters.'), 400
            payload = (values['subject_id'], day, start, end, values['kind'], room.strip())
            if old:
                connection.execute('UPDATE schedule_entries SET subject_id=?,weekday=?,start_minute=?,end_minute=?,kind=?,room=? WHERE id=?', (*payload, entry_id))
            else:
                entry_id = connection.execute('INSERT INTO schedule_entries(subject_id,weekday,start_minute,end_minute,kind,room,schedule_id) VALUES(?,?,?,?,?,?,?)', (*payload, schedule_id)).lastrowid
            connection.execute('UPDATE schedules SET updated_at=? WHERE id=?', (datetime.now(timezone.utc).isoformat(), schedule_id))
            return jsonify(entry=dict(connection.execute('SELECT * FROM schedule_entries WHERE id=?', (entry_id,)).fetchone()))
