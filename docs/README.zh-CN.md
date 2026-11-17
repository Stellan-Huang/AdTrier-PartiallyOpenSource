# AdTrier Engine — 研究展示版

这是从原始托管式 AdTrier 工程中提取的独立引擎版本，面向 GitHub 展示、研究生申请、教授套磁和技术面试。

## 项目重点

本仓库保留真正体现工程能力的核心链路：

1. **确定性商品归一化**：清洗商品文本、保守解析价格、规范化媒体 URL、去重并记录校验结果。
2. **多模态 Product Intelligence**：文本、图片、视频理解并行执行，随后由确定性代码合并事实、推断、视觉观察和执行记录。
3. **Capability-based 模型路由**：通过统一 Registry 配置不同 AI 能力使用的 Provider、模型层级和推理强度。
4. **Creative V2**：从可用事实构建 Creative Brief，生成创意候选、筛选创意，再扩展为结构化分镜脚本。
5. **视频生成与合成**：TTS、Seedance 异步任务、FFmpeg 视频合成、字幕与可选音效。
6. **质量控制**：确定性结构检查与可选多模态模型 QA。

## 快速运行

需要 Node.js 20+、npm。视频合成另外需要 FFmpeg。

```bash
npm install
cp .env.example .env
```

在 `.env` 中至少配置：

```dotenv
SEED_2_1_LITE_API=your_ark_key
SEED_2_1_PRO_API=your_ark_key
```

运行 Product Intelligence → Creative V2 示例：

```bash
npm run demo
```

示例商品和图片均为合成数据；图片由本地 fetch adapter 提供给图片理解阶段，不会访问真实商品网站。结果写入 `output/pipeline-result.json`。

可选视频生成需要额外配置 Seedance、TTS 和公开可访问的商品图片 URL：

```dotenv
SEEDANCE_2_5_API=your_seedance_key
SEED_TTS_2_0_API=your_tts_key
PUBLIC_PRODUCT_IMAGE_URL=https://your-public-host/path/product-image.png
```

然后执行：

```bash
npm run video
```

视频生成可能产生第三方 API 费用。

## 测试

```bash
npm test
npm run typecheck
```

单元测试尽可能使用注入的 Runner 和 Mock Provider，不需要真实模型密钥。

## 与原 SaaS 工程的边界

本版本主动剥离了 Next.js 页面/API、Prisma/生产数据库、用户认证与 OTP、积分、支付/退款、Resend 邮件、生产上传存储、Beta 密码门、内部 IDE/Agent 配置，以及真实第三方商品样例。

需要特别说明：原始压缩包中的 Agent 相关文件主要是 IDE 指令和支付集成 Skills，并不是产品运行时的 MCP Agent 编排系统。因此，本仓库展示的是应用内部的 AI capability orchestration，而不是 runtime MCP orchestration。

许可证没有代替你自动选择。公开发布前请阅读根目录的 `LICENSE_SELECTION.md` 并确认许可证。

