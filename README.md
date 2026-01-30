# ISPTranslator

轻量级运营商名称翻译微服务，基于 Cloudflare Workers + D1 + Workers AI。

## 项目结构

- `src/index.ts`: 核心 Worker 逻辑
- `schema.sql`: 数据库结构
- `wrangler.toml`: 项目配置

## 部署步骤

1. **安装依赖**
   ```bash
   npm install
   ```

2. **创建 D1 数据库**
   ```bash
   npx wrangler d1 create isp-translator-db
   ```
   *注意：将输出的 `database_id` 更新到 `wrangler.toml` 中。*

3. **初始化数据库表**
   ```bash
   npx wrangler d1 execute isp-translator-db --file=./schema.sql
   # 生产环境
   npx wrangler d1 execute isp-translator-db --file=./schema.sql --remote
   ```

4. **设置 Secret**
   ```bash
   npx wrangler secret put API_TOKEN
   npx wrangler secret put AI_API_TOKEN
   ```

5. **本地开发**
   在根目录创建 `.dev.vars` 文件并填写：
   ```text
   API_TOKEN=your_token
   AI_API_TOKEN=your_ai_token
   ```
   然后运行：
   ```bash
   npx wrangler dev
   ```

6. **部署**
   ```bash
   npx wrangler deploy
   ```

## 本地测试 (Frontend UI)

项目包含一个基于 React 的测试前端，位于 `test-ui` 目录。

1. **启动 Worker**
   ```bash
   npx wrangler dev
   ```

2. **启动测试 UI**
   ```bash
   cd test-ui
   npm install
   npm run dev
   ```
   访问 `http://localhost:5173` 即可使用图形化界面测试翻译功能。

## API 使用

**Endpoint**: `POST /`

**Headers**:
- `Authorization`: `<Your-API-TOKEN>`
- `Content-Type`: `application/json`

**Body**:
```json
{
  "text": "China Telecom",
  "locale": "zh"
}
```

**Response**:
```json
{
  "original": "China Telecom",
  "translated": "中国电信",
  "source": "ai" 
}
```
