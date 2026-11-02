Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
shell.Run Chr(34) & folder & "\.venv\Scripts\pythonw.exe" & Chr(34) & " " & Chr(34) & folder & "\desktop.py" & Chr(34), 0, False
