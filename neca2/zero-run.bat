@echo off
chcp 65001 >nul
title Silent Protocol — 零摩擦启动

echo.
echo ============================================
echo     Silent Protocol — 零摩擦启动
echo     什么都不用填，双击就开干
echo ============================================
echo.

:: ===== 第一步：自我感知 =====
echo [1/5] 检测运行环境...
set "ROOT=%~dp0"
cd /d "%ROOT%"

:: 检查是否从项目根目录运行
if not exist "package.json" (
    echo 未找到 package.json，请确保在项目目录中运行
    pause
    exit /b 1
)

:: ===== 第二步：检测 Node.js =====
echo [2/5] 检查 Node.js...
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 未检测到 Node.js
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
        set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
    ) else (
        echo 需要 Node.js，正在打开下载页面...
        start https://nodejs.org/
        echo 下载后请重新运行本脚本
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('node --version') do set "NODE_VERSION=%%i"
echo Node.js %NODE_VERSION%

:: ===== 第三步：检查依赖 =====
echo [3/5] 检查依赖...
if not exist "node_modules" (
    echo 首次运行，正在安装依赖...
    call npm install --silent
    if %ERRORLEVEL% neq 0 (
        echo 依赖安装失败
        pause
        exit /b 1
    )
    echo 依赖已安装
) else (
    echo 依赖已就绪
)

:: ===== 第四步：检测 API Key =====
echo [4/5] 自动检测 API Key...

set "API_KEY="

:: 方式1: 环境变量
if defined DEEPSEEK_API_KEY (
    set "API_KEY=%DEEPSEEK_API_KEY%"
    echo 从环境变量获取到 API Key
)

:: 方式2: .env 文件
if not defined API_KEY (
    if exist ".env" (
        for /f "tokens=1,* delims==" %%i in ('type .env 2^>nul') do (
            if /i "%%i"=="DEEPSEEK_API_KEY" set "API_KEY=%%j"
            if /i "%%i"=="API_KEY" set "API_KEY=%%j"
        )
        if defined API_KEY echo 从 .env 文件获取到 API Key
    )
)

:: 方式3: 提示输入
if not defined API_KEY (
    echo.
    echo 未检测到 API Key。
    echo 需要 API Key 来连接 DeepSeek 云端服务。
    echo.
    set /p "API_KEY=请输入你的 API Key: "
    if not defined API_KEY (
        echo 未输入 API Key，无法启动
        pause
        exit /b 1
    )
    echo DEEPSEEK_API_KEY=%API_KEY%> .env
    echo 已保存到 .env 文件
)

:: ===== 第五步：启动 =====
echo [5/5] 启动 Silent Protocol...

:: 构建项目
echo 正在构建...
call npm run build >nul 2>nul

:: 启动 MCP Server
echo 正在启动 MCP Server...
start /B "" node dist/index.js

timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo  Silent Protocol 已就绪！
echo  你可以通过支持 MCP 的客户端连接使用。
echo  也可以直接在命令行输入需求：
echo.
echo  例如：
echo   帮我查看电脑配置
echo   帮我搭建一个聊天界面
echo   帮我爬取最近的AI论文
echo.
echo  按 Ctrl+C 停止服务
echo ============================================
echo.
