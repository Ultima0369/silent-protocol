@echo off
chcp 65001 >nul
title Silent Protocol — 打包发布
cls

echo ╔════════════════════════════════════════════════════╗
echo ║     📦 Silent Protocol — 发布包构建               ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM ---- 构建 ----
echo [1/3] 编译 TypeScript...
call npx tsc
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 编译失败
    pause
    exit /b 1
)
echo   ✓ 编译成功
echo.

REM ---- 创建发布目录 ----
echo [2/3] 组织发布文件...
set RELEASE_DIR=.\release\silent-protocol-windows

if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\src"
mkdir "%RELEASE_DIR%\dist"
mkdir "%RELEASE_DIR%\docs"
mkdir "%RELEASE_DIR%\examples"

REM 核心文件
copy /Y setup.bat "%RELEASE_DIR%\" >nul
copy /Y run.bat "%RELEASE_DIR%\" >nul
copy /Y README.md "%RELEASE_DIR%\" >nul
copy /Y CHANGELOG.md "%RELEASE_DIR%\" >nul 2>nul
copy /Y LICENSE "%RELEASE_DIR%\" >nul
copy /Y package.json "%RELEASE_DIR%\" >nul

REM 编译产物
xcopy /E /I /Y dist "%RELEASE_DIR%\dist\" >nul

REM 关键源文件（auto-onboard 和 cli）
copy /Y src\auto-onboard.ts "%RELEASE_DIR%\src\" >nul
copy /Y src\cli.ts "%RELEASE_DIR%\src\" >nul

REM 文档
copy /Y docs\zero-config-deployment.md "%RELEASE_DIR%\docs\" >nul
copy /Y docs\benchmarking-methodology.md "%RELEASE_DIR%\docs\" >nul 2>nul

REM Hello World 示例
copy /Y examples\hello-world\README.md "%RELEASE_DIR%\examples\" >nul 2>nul

echo   ✓ 文件已组织
echo.

REM ---- 打包 ZIP ----
echo [3/3] 创建 ZIP 包...
powershell -Command "& {Compress-Archive -Path '%RELEASE_DIR%' -DestinationPath '.\release\silent-protocol-windows.zip' -Force}"
echo   ✓ 发布包已创建: .\release\silent-protocol-windows.zip
echo.

echo ┌─────────────────────────────────────────────┐
echo │  发布包内容:                                 │
echo │    silent-protocol-windows.zip              │
echo │    ├── setup.bat        ← 一键安装          │
echo │    ├── run.bat          ← 日常使用          │
echo │    ├── dist/             ← 核心程序         │
echo │    ├── docs/             ← 使用文档         │
echo │    └── examples/         ← 示例             │
echo │                                             │
echo │  大小:                                      │
dir /s ".\release\silent-protocol-windows.zip" | find "silent-protocol-windows.zip"
echo └─────────────────────────────────────────────┘
echo.

pause
