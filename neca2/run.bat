@echo off
chcp 65001 >nul
title Silent Protocol — 🤫 Running...
cls

echo ╔════════════════════════════════════════════════════╗
echo ║     🤫 Silent Protocol                            ║
echo ║     人间界 ↔ 硅基界 通信网关                      ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM ---- 检查配置文件 ----
if not exist "%USERPROFILE%\.silent-protocol\config.json" (
    echo   ⚠ 未检测到配置文件。
    echo   请先运行 setup.bat 完成初始化。
    echo.
    pause
    exit /b 1
)

echo   🔍 正在唤醒云端 AI...
echo.

REM ---- 首次运行：云端自动扫描配置 ----
for /f "tokens=2 delims=:," %%a in ('type "%USERPROFILE%\.silent-protocol\config.json" ^| find "firstRun"') do (
    set firstRun=%%a
)
set firstRun=%firstRun: =%

if "%firstRun%"=="true" (
    echo   ┌─────────────────────────────────────────────┐
    echo   │  第一次启动，云端 AI 正在扫描你的环境...      │
    echo   │                                             │
    echo   │  🔍 检测操作系统版本...                       │
    echo   │  🔍 检测 CPU/内存/磁盘...                    │
    echo   │  🔍 检测已安装的软件...                      │
    echo   │  🔍 检测网络连接状态...                      │
    echo   │  🔍 检测本地 MCP 能力...                     │
    echo   │                                             │
    echo   │  这只需要几秒钟，请稍候...                   │
    echo   └─────────────────────────────────────────────┘
    echo.

    REM 启动云端 AI 自动配置
    npx tsx src/auto-onboard.ts

    REM 标记首次运行完成
    powershell -Command "(Get-Content '%USERPROFILE%\.silent-protocol\config.json') -replace '\"firstRun\": true', '\"firstRun\": false' | Set-Content '%USERPROFILE%\.silent-protocol\config.json'"

    echo.
    echo   ✅ 环境配置完成！
    echo   你现在可以直接向云端 AI 提需求了。
    echo.
    echo   例如：
    echo     "帮我检查一下我的 Windows 系统信息"
    echo     "给我的电脑装一个 Chatbox"
    echo     "帮我在本地搭建一个 MCP Server"
    echo     "从零开始构建一个聊天界面"
    echo.
    pause
    cls
)

echo   ┌─────────────────────────────────────────────┐
echo   │  🤫 Silent Protocol 已就绪                   │
echo   │                                             │
echo   │  你现在可以和云端 AI 对话了。                │
echo   │  不需要懂技术，只需要说你想做什么。           │
echo   │                                             │
echo   │  输入你的需求，然后按回车：                  │
echo   └─────────────────────────────────────────────┘
echo.

:mainLoop
set /p userRequest="  您 > "
if "%userRequest%"=="" goto mainLoop
if /i "%userRequest%"=="exit" goto end
if /i "%userRequest%"=="quit" goto end
if /i "%userRequest%"==退出 goto end

echo.
echo   🤖 云端 AI 正在处理...
echo.

REM 将用户请求发送到网关，网关转发给云端 DeepSeek
npx tsx src/cli.ts send cloud_ds delegate "{\"task\":\"%userRequest%\",\"cwd\":\"%cd%\",\"maxSteps\":20}" --callback

echo.
goto mainLoop

:end
echo.
echo   👋 再见！
timeout /t 2 >nul
