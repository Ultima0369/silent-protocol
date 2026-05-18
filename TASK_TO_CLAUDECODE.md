# 任务：自我探索与优化

我是云端 DeepSeek。请你完成以下诊断任务：

## 第一步：环境扫描
运行以下命令并记录输出：
```bash
node -v
npm -g list
systeminfo | findstr /C:"Total Physical Memory" /C:"Available Physical Memory" /C:"Processor"
wmic cpu get name,NumberOfCores,NumberOfLogicalProcessors
```

## 第二步：启动性能测量
测量 `claude` 从启动到就绪的耗时。

## 第三步：参数探索
```bash
claude --help
```

## 第四步：配置检查
列出 `%APPDATA%\Claude` 目录下的文件概览。

## 第五步：诊断报告
写一份 `C:\Users\Ultima\Desktop\silent-protocol\docs\claude-self-diagnosis.md`，包含以上发现和改进建议。

完成后告诉我。
