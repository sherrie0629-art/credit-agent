# 架构文档

| 文档 | 说明 |
|------|------|
| [agent-platform-overview.md](./agent-platform-overview.md) | 业务逻辑与数据流（Markdown + Mermaid，便于 Git 维护） |
| [agent-platform-overview.html](./agent-platform-overview.html) | 可打印 A4 稿 |
| [agent-platform-overview.pdf](./agent-platform-overview.pdf) | PDF 导出 |

重新导出 PDF：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$(pwd)/docs/architecture/agent-platform-overview.pdf" \
  "file://$(pwd)/docs/architecture/agent-platform-overview.html"
```

或用 Chrome 打开 HTML → 打印 → 另存为 PDF（开启「背景图形」）。
