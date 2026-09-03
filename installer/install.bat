@echo off
rem Dafeiyu installer entry: locate python, then run install.py with --registry
rem (--registry is the default for double-click UX; dry-run = run install.py directly)
where py >nul 2>nul && (set "PYCMD=py -3") || (set "PYCMD=python")
%PYCMD% "%~dp0install.py" --registry %*
pause
