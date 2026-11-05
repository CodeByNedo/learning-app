"""Date-scoped replacements leave the recurring weekly timetable intact."""
from datetime import date
from flask import jsonify, request


def week_key(value):
    try:
        parsed = date.fromisoformat(value)
        return value if parsed.isoformat() == value and parsed.weekday() == 0 else None
    except (TypeError, ValueError):
        return None


def effective_entries(connection, schedule_id, week_start):
    entries = [dict(row) for row in connection.execute('SELECT * FROM schedule_entries WHERE schedule_id=?', (schedule_id,))]
    overrides = {row['entry_id']: row for row in connection.execute('''SELECT o.* FROM schedule_overrides o
        JOIN schedule_entries e ON e.id=o.entry_id WHERE e.schedule_id=? AND o.week_start=?''', (schedule_id, week_start))}
    for entry in entries:
        replacement = overrides.get(entry['id'])
        entry['temporary'] = bool(replacement)
        if replacement:
            for field in ('weekday', 'start_minute', 'end_minute', 'room'):
                entry[field] = replacement[field]
    return sorted(entries, key=lambda entry: (entry['weekday'], entry['start_minute'], entry['id']))


def register_schedule_overrides(app, db):
    with db() as connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS schedule_overrides (
            id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES schedule_entries(id) ON DELETE CASCADE,
            week_start TEXT NOT NULL, weekday INTEGER NOT NULL, start_minute INTEGER NOT NULL,
            end_minute INTEGER NOT NULL, room TEXT NOT NULL, UNIQUE(entry_id,week_start))''')

    @app.route('/api/schedules/<int:schedule_id>/entries/<int:entry_id>/overrides/<week_start>', methods=['PUT', 'DELETE'])
    def schedule_override(schedule_id, entry_id, week_start):
        if not week_key(week_start):
            return jsonify(error='Choose a valid week starting on Monday.'), 400
        with db() as connection:
            entry = connection.execute('SELECT * FROM schedule_entries WHERE id=? AND schedule_id=?', (entry_id, schedule_id)).fetchone()
            if not entry:
                return jsonify(error='Class not found.'), 404
            if request.method == 'DELETE':
                connection.execute('DELETE FROM schedule_overrides WHERE entry_id=? AND week_start=?', (entry_id, week_start))
                return jsonify(ok=True)
            data = request.get_json(silent=True) or {}
            day, start, end = (data.get(field) for field in ('weekday', 'start_minute', 'end_minute'))
            room = data.get('room', entry['room'])
            if type(day) is not int or not 0 <= day <= 6 or type(start) is not int or type(end) is not int or not 0 <= start < end <= 1440:
                return jsonify(error='Choose a day and an end time later than the start time.'), 400
            if not isinstance(room, str) or len(room.strip()) > 100:
                return jsonify(error='Choose lecture or exercise and a room up to 100 characters.'), 400
            connection.execute('''INSERT INTO schedule_overrides(entry_id,week_start,weekday,start_minute,end_minute,room)
                VALUES(?,?,?,?,?,?) ON CONFLICT(entry_id,week_start) DO UPDATE SET weekday=excluded.weekday,
                start_minute=excluded.start_minute,end_minute=excluded.end_minute,room=excluded.room''',
                (entry_id, week_start, day, start, end, room.strip()))
        return jsonify(ok=True)
