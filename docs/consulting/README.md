# 咨询简报导出

- 源稿：[`sea-credit-org-agent-brief.html`](sea-credit-org-agent-brief.html)（9 页 A4）
- PDF：[`sea-credit-org-agent-brief.pdf`](sea-credit-org-agent-brief.pdf)

重新导出：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$(pwd)/docs/consulting/sea-credit-org-agent-brief.pdf" \
  "file://$(pwd)/docs/consulting/sea-credit-org-agent-brief.html"
```

或用 Chrome 打开 HTML → 打印 → 另存为 PDF（建议开启「背景图形」）。
