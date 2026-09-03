@echo off
rem Dafeiyu installer entry: locate python, then run install.py
where py >nul 2>nul && (set "PYCMD=py -3") || (set "PYCMD=python")
%PYCMD% "%~dp0install.py" %*
pause
