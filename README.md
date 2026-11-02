# Ajde.

A local study app for tracking time, organizing subject notes, and keeping a weekly class schedule. Built with Python, Flask, SQLite, and vanilla JavaScript.

The interface defaults to Serbian (Latin), with an English option, light/dark themes, and a Windows desktop edition. No account is required. New installations start empty: add your own subjects and schedules.

## Install on Windows

You need Python (with pip) and Git installed.

```powershell
git clone https://github.com/CodeByNedo/learning-app.git
cd learning-app
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
```

## Start the desktop app

Double-click **start-desktop.vbs** in the project folder. You can create a Windows shortcut to this file on your desktop.

Or run:

```powershell
.\.venv\Scripts\python.exe desktop.py
```

The app opens in its own window. Windows desktop mode uses pywebview and requires Microsoft Edge WebView2 Runtime.

Keep the app running (minimized is fine) for native timer alerts. At each checkpoint, the timer pauses and a Windows popup and sound prompt you to continue, take a break, or finish. Closing the app pauses the timer. Sleep and fullscreen games may delay or hide alerts.

## Browser mode

For browser mode only, install `requirements.txt` instead of `requirements-desktop.txt`, then run:

```powershell
.\.venv\Scripts\python.exe app.py
```

Open **http://127.0.0.1:5000**. Stop the server with Ctrl+C. Native popups and opening local subject folders require desktop mode.

## Features

- Subjects with colors, abbreviations, exam dates, sorting, and archiving.
- Study timer with pause/resume, automatic checkpoints (default 45 minutes), and timed breaks (default 5 minutes).
- Daily and weekly study statistics, previous weeks, and session history.
- Searchable notes with folders, subfolders, and drag-and-drop organization.
- Optional session-end notes saved to the subject's notebook folder.
- Multiple weekly schedules with lectures/exercises, rooms, subject colors, and 12/24-hour time formats.
- Read-only daily class agenda and a multi-row schedule builder.
- Shortcuts to local subject folders in desktop mode.

## Your data and backups

Personal records are stored in **instance/learning.sqlite3**. The entire `instance/` folder, virtual environment, and `.env` are ignored by Git. Your subjects, notes, history, schedules, and saved folder paths are not included in this repository.

To back up or move your data, **close the desktop app and stop any browser server**, then copy the `instance/` folder somewhere safe. Restore it to the same location while the app is stopped. Keep this backup separate from Git, especially before updating or trying an older code version.

Settings also offers JSON export for inspection and portability; JSON import is not implemented. Theme, language, and clock-format preferences are stored in the browser/WebView profile.

This is a local single-user app, not a hosted service. It has no login or separate user accounts. Study time records effort, not mastery. Session totals belong to the day the session started; overnight sessions are not split across dates.

## Development

Run the checks after installing the desktop dependencies:

```powershell
.\.venv\Scripts\python.exe -m unittest -q test_app test_desktop_timer
```

Tests use temporary databases and do not alter your personal records.

## Versions

The first snapshot is tagged **v0.1.0**. Commits retain the source history; tags mark versions you can find again. Keep a database backup too: switching source versions does not restore old data.
