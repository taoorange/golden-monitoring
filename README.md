# 攒金小本本（黄金监测）

工行如意金积存监测 + 上金所走势 + 本地账本提醒。Electron + Vue 3。

## 开发

```bash
cd /Users/github/golden-monitoring
npm install
npm run dev
```

## 打包

```bash
npm run build:mac   # macOS dmg/zip
npm run build:win   # Windows NSIS（建议在 Windows 或配好交叉环境）
npm run smoke       # 启动构建后的应用做启动自检

# Windows 打包前自动升版本号
npm run build:win -- --patch   # 补丁号 +1
npm run build:win -- --minor   # 次版本 +1
npm run build:win -- --major   # 主版本 +1
```

`build:win` 会先构建、再做一次启动自检；自检失败会停止打包，不会继续生成安装包。

## 后台运行

关闭窗口会隐藏到**系统托盘**，主进程继续轮询工行价并按设置弹系统通知。  
托盘菜单：「显示窗口」/「设置…」/「退出」（退出才会结束监测）。

## 本地数据

目录（升级安装一般不丢）：

- macOS：`~/Library/Application Support/com.taotao.golden-monitoring/`
- Windows：`%APPDATA%\\com.taotao.golden-monitoring\\`

含 `ledger.json`（账本）、`settings.json`（设置）、`alert-state.json`（提醒状态）。  
旧版 `localStorage` 会在首次启动时尽量迁移。

接口日志：`logs/api-YYYY-MM-DD.log`（JSON Lines，工行/上金所每次请求一行；响应过长会截断）。

## 文档

- 规格：`docs/superpowers/specs/2026-11-18-工行如意金监测与账本提醒.md`
- 计划：`docs/superpowers/plans/2026-11-18-工行如意金监测实现计划.md`
