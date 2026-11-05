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
.\.venv\Scripts\python.exe -m unittest -q test_app test_desktop_timer test_practice test_study_improvements
```

Tests use temporary databases and do not alter your personal records.

## Versions

The first snapshot is tagged **v0.1.0**. Commits retain the source history; tags mark versions you can find again. Keep a database backup too: switching source versions does not restore old data.


## Study shortcuts and next-session tasks

Use **Study** in the header (or **Alt+S**) to search subjects and start a session. If a timer already exists, this opens the current session. The home chart includes every subject in the default timetable, including zero-study subjects, and uses bars to compare all-time saved study time, independently of the selected activity week.

Notes have a separate **TODO** field: write multiple tasks, one per line. Only the most recently changed TODO for that subject appears on the study screen. Ordinary note changes do not replace it. Clearing the latest TODO hides it without bringing back older tasks. Finishing a study session consumes previously assigned tasks: if you leave the final TODO blank, they will not appear next session. Historical note contents are preserved. During a pause, use Notes to edit the current subject TODO; there is no separate pause-only TODO editor. The session finish screen also offers separate note and TODO fields. Existing `TODO:` blocks in notes are recognized during migration; a blank line ends the block.

Root-level notes stay in **Global notes** below the folder tree even while viewing a folder. A paused timer has a distinct banner color and a **View break** link.

## Temporary timetable changes

Use the week arrows to choose a week, open an existing class, then choose **Only this week** when changing its day, time or room. The replacement is marked **Temporary**; the recurring class remains unchanged in other weeks. **Restore regular class** removes that week's exception. **Every week** edits the recurring timetable. Adding new classes still adds recurring classes.

## PDF practice (first version)

**Practice** supports subject collections containing multiple text PDFs, saved open-ended questions, written answers, approximate concept-coverage feedback, source quotes/page links, and one answer-based follow-up question. Saved questions and all attempts stay in SQLite. Retrying a saved question does not regenerate it. AI feedback is an estimate and should be checked against the source.

Copy `.env.example` to `.env`, add your own `OPENAI_API_KEY`, and optionally change `OPENAI_MODEL` (default `gpt-4.1-mini`). The key stays on the server and is never returned to the browser or JSON export. No API request is made just by uploading a PDF. Generation sends selected extracted text to OpenAI; grading sends the answer and cited source pages. API usage can incur charges. Without a key, PDF upload and collection management work, but generation and grading are unavailable.

Limits: 10 PDFs / 20 MB per upload, 300 pages per PDF, 1–10 questions per round and 100,000 extracted characters per generation request. Larger selections must be split into smaller groups. Scanned PDFs need OCR beforehand; OCR, voice answers and multiple-choice questions are not included yet. Blank pages are reported in the readable-page count. AI citations are checked against extracted source text before saving, but this does not guarantee that the generated explanation is correct.

Original PDFs are saved in SQLite, so a stopped-app database backup includes them. JSON export contains the extracted source text and practice records, but not original PDF bytes; it is not a full backup. Automated AI tests use mocked service responses; a real generation/assessment needs a configured API key and has not been verified in this workspace.

The home screen also shows **Where you left off**: active subjects with current TODO tasks, ordered by most recent study. Each card opens notes or starts the subject timer. Subjects without tasks are omitted; if none have tasks, a compact empty message is shown. These are current tasks even when browsing an older activity week.

Calendar comments belong to exact dates and are shared across timetable views. Use **Comment** to choose any date, or the comment icon beside a date in the week header. Multiple comments appear in a separate row above the time grid; click a comment to edit, move to another date, or delete with confirmation. They never recur weekly. Weekend comments are visible with **Show weekend**. Comments are included in SQLite backups and JSON export.
