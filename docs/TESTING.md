# 测试记录

版本：v1.4.0。验证日期：2026-09-11。

## 已完成的检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 窗口创建、语言、数量、错误处理 | 通过 | `launcher.test.mjs` |
| 文件过滤、排序、103 份文档映射、消息校验、防重复点击 | 通过 | `folder.test.mjs` |
| 顺序等待、点击间隔、失败跳过、停止 | 通过 | `translation-queue.test.mjs` |
| 工具栏真实 Chrome API、搜索、输入法、数量记忆 | 通过 | `browser-verification.json` |
| 只放入文件、不自动点击 | 通过 | `folder-manual-verification.json` |
| 文件夹自动点击与顺序、间隔 | 通过 | `folder-auto-verification.json` |
| 第一份点击后停止，后续不点击 | 通过 | `folder-stop-verification.json` |
| 真实 Google 翻译页面 | 通过 | `folder-live-auto-verification.json` |

上表中的脚本、JSON 和截图均位于 `chrome-translate-ten-tabs-dev/`。单元测试合计 20 项，无失败。JSON 是当时运行产生的检查结果，其中标签页编号和时间戳属于隔离测试会话。

真实浏览器版本：Chrome 152.0.7977.83，Windows。使用独立临时浏览器配置，不使用日常浏览器登录会话。

## 真实页面验证内容

脚本生成 3 份示例 PDF：文档1.pdf、文档2.pdf、文档10.pdf。其中第三份约 470 KB，用于验证多块传输。检查：

1. 一个无痕窗口包含 3 个标签页，目标语言法语。
2. 文档与标签页按自然顺序一一对应。
3. 上传后的文件 SHA-256 与源文件一致，图片输入框未被改动。
4. 点击顺序为 1 → 2 → 10，实际相邻间隔为 2017 ms、2011 ms。
5. 重发同一点击请求不会增加点击次数。

这些结果验证自动放入与点击行为，不表示测试对所有文档格式、所有目标语言的翻译质量作出了保证。

## 复现

单元测试只需要支持 Node.js 内置测试工具的版本（建议 Node.js 20 或更高）：

```sh
npm test
```

浏览器测试额外安装 Playwright，图标重建额外安装 sharp：

```sh
npm install --no-save playwright sharp
```

测试脚本默认 Chrome 路径为 `C:/Program Files/Google/Chrome/Application/chrome.exe`；如安装位置不同，请先调整脚本中的 `executablePath`。浏览器检查使用 Chrome 扩展调试接口，需要支持该接口的 Chrome。

```sh
node chrome-translate-ten-tabs-dev/verify-browser.cjs
node chrome-translate-ten-tabs-dev/verify-folder.cjs
node chrome-translate-ten-tabs-dev/verify-folder.cjs --auto
node chrome-translate-ten-tabs-dev/verify-folder.cjs --auto --stop
```

以上文件夹检查用本地模拟网页代替 Google 内容。联网实测会向谷歌提交脚本生成的示例 PDF：

```sh
node chrome-translate-ten-tabs-dev/verify-folder.cjs --live --auto
```

脚本退出时删除本次创建的临时目录和浏览器配置，保留检查结果与截图。`inspect-translate.cjs` 是开发时检查文档控件的辅助脚本，不是完整回归测试。
