@echo off
chcp 65001 >nul
title Silent Protocol — 一键部署工具
cls

echo ╔════════════════════════════════════════════════════╗
echo ║     🤫 Silent Protocol — 一键部署工具             ║
echo ║     无需技术背景 · 云端自动配置                    ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM ---- 检查 Node.js ----
echo [1/4] 检查运行环境...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   ⚠ 未检测到 Node.js，正在自动下载安装...
    echo   请稍候（约 1-2 分钟）...
    powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'; Start-Process msiexec.exe -Wait -ArgumentList '/i %TEMP%\node-installer.msi /quiet /norestart'}"
    echo   安装完成，重新检查...
    where node >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo   ✗ Node.js 安装失败，请手动安装: https://nodejs.org
        pause
        exit /b 1
    )
)
echo   ✓ Node.js 已就绪 (%node --version%)
echo.

REM ---- 配置 API ----
echo [2/4] 配置云端 AI 连接...
set /p API_ENDPOINT="   请输入 API 地址 (默认: https://api.deepseek.com): "
if "%API_ENDPOINT%"=="" set API_ENDPOINT=https://api.deepseek.com

set /p API_KEY="   请输入 API Key: "
if "%API_KEY%"=="" (
    echo   ⚠ API Key 不能为空
    pause
    exit /b 1
)

echo.
echo   ✓ 连接信息已记录
echo.

REM ---- 安装依赖 ----
echo [3/4] 安装运行依赖...
call npm install --silent 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   ⚠ npm install 失败，重试...
    call npm install
)
echo   ✓ 依赖安装完成
echo.

REM ---- 创建配置文件 ----
echo [4/4] 初始化系统...

if not exist "%USERPROFILE%\.silent-protocol" mkdir "%USERPROFILE%\.silent-protocol"

echo {%>"%USERPROFILE%\.silent-protocol\config.json"
echo   "endpoint": "%API_ENDPOINT%",>>"%USERPROFILE%\.silent-protocol\config.json"
echo   "key": "%API_KEY%",>>"%USERPROFILE%\.silent-protocol\config.json"
echo   "version": "0.4.0",>>"%USERPROFILE%\.silent-protocol\config.json"
echo   "firstRun": true>>"%USERPROFILE%\.silent-protocol\config.json"
echo }>>"%USERPROFILE%\.silent-protocol\config.json"

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║     ✅ 部署完成！                                  ║
echo ║                                                    ║
echo ║     下一步：                                       ║
echo ║     双击 run.bat 启动系统                          ║
echo ║                                                    ║
echo ║     第一次启动时，云端 AI 将自动：                 ║
echo ║       🔍 扫描你的硬件和操作系统环境               ║
echo ║       🛠️  配置 Chatbox 或等效聊天界面            ║
echo ║       🔗 建立本地 MCP Server 连接                ║
echo ║       🧠 准备就绪后你就可以提需求了               ║
echo ║                                                    ║
echo ║     你只需要：验收 → 测试 → 适配                   ║
echo ╚════════════════════════════════════════════════════╝
echo.

pause
