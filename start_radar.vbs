' Starts Semi Trend-Day Radar hidden (no window). Placed in Windows Startup so it runs at login.
' Output goes to server.log next to the app. To stop it: Task Manager -> python.exe, or remove the Startup shortcut.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Ryan\Downloads\semi-trend-day-v6\semi-trend-day-redesign"
sh.Run "cmd /c """"C:\Users\Ryan\Downloads\semi-trend-day-v6\semi-trend-day\.venv\Scripts\python.exe"" -u server.py >> server.log 2>&1""", 0, False
