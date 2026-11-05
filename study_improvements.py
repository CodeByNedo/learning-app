"""Separate next-session tasks from ordinary notebook text."""
import re


def extract_todo(body):
    match = re.search(r'(?im)^\s*TODO\s*:\s*([^\n]*)(?:\n|$)', body)
    if not match:
        return ''
    lines = [match.group(1).strip()]
    for line in body[match.end():].splitlines():
        if not line.strip() or re.match(r'^\s*(?:#{1,6}\s|[^:]{1,40}:\s*$)', line):
            break
        lines.append(line.strip())
    return '\n'.join(line for line in lines if line).strip()[:10000]


def note_todo(data, body, previous=None):
    value = data.get('todo', extract_todo(body) if previous is None else previous)
    if not isinstance(value, str) or len(value) > 10000:
        return None
    return value.strip()


def register_study_improvements(db):
    with db() as connection:
        if 'todo_consumed_at' not in {row['name'] for row in connection.execute('PRAGMA table_info(subjects)')}:
            connection.execute("ALTER TABLE subjects ADD COLUMN todo_consumed_at TEXT NOT NULL DEFAULT ''")
        if 'todo_draft' not in {row['name'] for row in connection.execute('PRAGMA table_info(timer)')}:
            connection.execute('ALTER TABLE timer ADD COLUMN todo_draft TEXT')
        if 'todo' not in {row['name'] for row in connection.execute('PRAGMA table_info(notes)')}:
            connection.execute("ALTER TABLE notes ADD COLUMN todo TEXT NOT NULL DEFAULT ''")
            for row in connection.execute('SELECT id,body FROM notes').fetchall():
                value = extract_todo(row['body'])
                if value:
                    connection.execute('UPDATE notes SET todo=? WHERE id=?', (value, row['id']))

        if 'todo_updated_at' not in {row['name'] for row in connection.execute('PRAGMA table_info(notes)')}:
            connection.execute('ALTER TABLE notes ADD COLUMN todo_updated_at TEXT')
            connection.execute("UPDATE notes SET todo_updated_at=updated_at WHERE trim(todo)<>''")

def subjects_with_tasks(connection):
    return [dict(row) for row in connection.execute('''SELECT s.*,
        COALESCE((SELECT n.todo FROM notes n WHERE n.subject_id=s.id AND n.todo_updated_at IS NOT NULL AND n.todo_updated_at>s.todo_consumed_at
          ORDER BY n.todo_updated_at DESC,n.id DESC LIMIT 1),'') AS latest_todo,
        (SELECT n.id FROM notes n WHERE n.subject_id=s.id AND n.todo_updated_at IS NOT NULL AND n.todo_updated_at>s.todo_consumed_at
          ORDER BY n.todo_updated_at DESC,n.id DESC LIMIT 1) AS todo_note_id
        FROM subjects s ORDER BY s.id''')]
