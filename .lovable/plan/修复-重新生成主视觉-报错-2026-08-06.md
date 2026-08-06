# 修复「重新生成主视觉」报错

## 原因（已确认）

点击按钮后，图片生成本身是成功的，失败发生在**保存这一步**：

- 保存流程会先把图片压缩成小尺寸 WebP，压缩用的是 `sharp` 这个依赖原生二进制的图片库。
- 本项目的服务端运行在边缘 Worker 运行时里，没有原生二进制环境。`sharp` 加载失败后，内部代码执行 `err.code.endsWith(...)`，而此时 `err.code` 是 undefined，于是抛出 `Cannot read properties of undefined (reading 'endsWith')`。
- 依赖里能直接看到这行代码：`node_modules/sharp/dist/sharp.mjs:115`。

同一个库也被公开图片路由的缩略图分支使用（`?w=` 参数），所以缩略图请求同样会 500。

## 修复方案

1. 从服务端彻底移除 `sharp` 依赖（卸载包，删除 `src/lib/creditagent/image-transform.server.ts` 的原生实现）。
2. 用 Worker 兼容的 WebP 编解码 + 缩放方案替代（`@jsquash/webp` + `@jsquash/resize`，纯 WASM，构建期内联，无原生二进制）：
   - 上传前：解码 PNG → 最长边缩到 1200 → 编码 WebP（质量 82）。
   - 图片路由 `?w=`：同样走 WASM 缩放，输出 WebP 并保留现有缓存头。
3. 加保底：若 WASM 编码在运行时失败，不再抛错中断保存，而是**原样存 PNG**并记录日志——保证「生成主视觉」永远能成功落库，最坏情况只是文件大一点。
4. 前端错误提示保持不变，但保存失败时会回传更明确的信息，而不是底层报错文本。

## 技术说明

- 改动文件：`src/lib/creditagent/image-transform.server.ts`（重写）、`src/lib/creditagent/image-storage.server.ts`（容错分支）、`package.json`（换依赖）。
- `src/routes/api/public/creative-image/$.ts` 的调用签名不变，无需改路由逻辑。
- 数据库、存储桶结构与已存图片均不受影响，历史 base64 惰性迁移逻辑保留。

## 验证

- 在素材中心点击「生成/重新生成主视觉」，确认成功保存并刷新出图。
- 直接请求 `/api/public/creative-image/variants/<id>.webp?w=256`，确认返回 200 且为 WebP。
