"""Calendar comments belong to exact dates, independent of recurring classes."""
from datetime import date, datetime, timedelta, timezone
from flask import jsonify, request


def parse_date(value):
    try:
        result = date.fromisoformat(value)
        return result if result.isoformat() == value else None
    except (ValueError, TypeError):
        return None


def register_calendar_comments(app, db):
    with db() as connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS calendar_comments (
            id INTEGER PRIMARY KEY, comment_date TEXT NOT NULL, body TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        connection.execute('CREATE INDEX IF NOT EXISTS calendar_comments_date ON calendar_comments(comment_date,id)')

    @app.route('/api/calendar-comments', methods=['GET', 'POST'])
    def calendar_comments():
        if request.method == 'GET':
            start = parse_date(request.args.get('week_start'))
            if not start or start.weekday() != 0:
                return jsonify(error='Choose a valid week starting on Monday.'), 400
            with db() as connection:
                return jsonify(comments=[dict(row) for row in connection.execute(
                    'SELECT * FROM calendar_comments WHERE comment_date>=? AND comment_date<? ORDER BY comment_date,created_at,id',
                    (start.isoformat(), (start + timedelta(days=7)).isoformat()))])
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error='Enter a date and a comment (up to 5000 characters).'), 400
        comment_date, body = parse_date(data.get('comment_date')), data.get('body')
        if not comment_date or not isinstance(body, str) or not 1 <= len(body.strip()) <= 5000:
            return jsonify(error='Enter a date and a comment (up to 5000 characters).'), 400
        stamp = datetime.now(timezone.utc).isoformat()
        with db() as connection:
            cursor = connection.execute('INSERT INTO calendar_comments(comment_date,body,created_at,updated_at) VALUES(?,?,?,?)',
                                        (comment_date.isoformat(), body.strip(), stamp, stamp))
            return jsonify(comment=dict(connection.execute('SELECT * FROM calendar_comments WHERE id=?', (cursor.lastrowid,)).fetchone()))

    @app.route('/api/calendar-comments/<int:comment_id>', methods=['PATCH', 'DELETE'])
    def calendar_comment(comment_id):
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error='Enter a date and a comment (up to 5000 characters).'), 400
        with db() as connection:
            row = connection.execute('SELECT * FROM calendar_comments WHERE id=?', (comment_id,)).fetchone()
            if not row:
                return jsonify(error='Comment not found.'), 404
            if request.method == 'DELETE':
                if data.get('confirm') is not True:
                    return jsonify(error='Confirm comment deletion first.'), 400
                connection.execute('DELETE FROM calendar_comments WHERE id=?', (comment_id,))
                return jsonify(ok=True)
            comment_date = parse_date(data.get('comment_date', row['comment_date']))
            body = data.get('body', row['body'])
            if not comment_date or not isinstance(body, str) or not 1 <= len(body.strip()) <= 5000:
                return jsonify(error='Enter a date and a comment (up to 5000 characters).'), 400
            connection.execute('UPDATE calendar_comments SET comment_date=?,body=?,updated_at=? WHERE id=?',
                (comment_date.isoformat(), body.strip(), datetime.now(timezone.utc).isoformat(), comment_id))
            return jsonify(comment=dict(connection.execute('SELECT * FROM calendar_comments WHERE id=?', (comment_id,)).fetchone()))
