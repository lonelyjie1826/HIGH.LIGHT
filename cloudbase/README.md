# CloudBase 上传服务（PostgreSQL 模式）

## 环境信息

- 环境 ID：`wangzan-d8gpex18f673aac9d`
- 环境形态：**PostgreSQL 模式（PG 模式）**
- 函数名：`upload-ticket`（Web 函数，监听 9000 端口）
- 入口一：`https://wangzan-d8gpex18f673aac9d-1507394434.ap-shanghai.app.tcloudbase.com/upload-ticket`
- 入口二：`https://wangzan-d8gpex18f673aac9d.service.tcloudbase.com/upload-ticket`
- Storage API 网关：`https://wangzan-d8gpex18f673aac9d.api.tcloudbasegateway.com/v1/storages`
- 上传代理：本机 `server.js` 的 `/api/cloud-upload`，浏览器不直接跨域调用 CloudBase
- 代码目录：`cloudbase/functions/upload-ticket`

> PG 模式与传统模式最大的区别：云存储不再支持「客户端拿临时签名直传 COS」，
> 所有读写都必须经过 Storage API，权限由 PostgreSQL 的 RLS 策略控制。
> 传统模式的 `app.getUploadMetadata()` / `app.uploadFile()` 在 PG 环境会直接报
> `STORAGE_NOT_SUPPORTED`，本函数已改为调用 PG Storage API。

## 云函数环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `UPLOAD_TOKEN` | 是 | 至少 24 位的随机口令，网页上要手输的那一个 |
| `SERVICE_ROLE_KEY` | 是 | 控制台「环境 → API Key 管理」里 `api_key` 类型的密钥，拥有环境管理员权限 |
| `BUCKET_ID` | 是 | 云存储桶 ID，例如 `high-light-media` |
| `ENV_ID` | 是 | 环境 ID（`wangzan-d8gpex18f673aac9d`）。实测该 Web 函数运行时**不带** `TCB_ENV`，必须显式配置，否则报 `MISSING_ENV_ID` |

`SERVICE_ROLE_KEY` 和 `UPLOAD_TOKEN` 都**只**存在于云函数环境变量中，不写进仓库、不写进网页。

## 云存储桶

PG 模式下 Bucket 是 `storage.buckets` 表里的一行，**必须手动创建**（传统模式那个隐式 COS 桶不存在）。
在控制台的 SQL 编辑器里执行：

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'high-light-media',
  'high-light-media',
  true,
  200 * 1024 * 1024,
  ARRAY['video/mp4','video/webm','video/quicktime','image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 公开读（任何人都能播放），写入仍然只走 service_role
DROP POLICY IF EXISTS objects_public_read ON storage.objects;
CREATE POLICY objects_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM storage.buckets b
      WHERE b.id = storage.objects.bucket_id AND b.public
    )
  );
```

不要为 `anon` 开放 `INSERT` / `UPDATE` / `DELETE` —— 否则任何人不用口令就能往桶里塞文件。

## 上传链路

视频和封面走同一条链路，只是对象路径不同（`videos/…` 与 `covers/…`）：

1. 浏览器把文件 POST 到本机 `server.js` 的 `/api/cloud-upload`（口令放在请求头，不落盘）。
2. `server.js` 带口令调用云函数 `upload-ticket` 的 `sign-upload`。
3. 云函数用 `SERVICE_ROLE_KEY` 请求
   `POST /v1/storages/object/upload/sign/{bucketId}/{objectName}`，拿到预签名上传链接和 token。
4. `server.js` 用 `PUT <链接>?token=xxx` 把文件二进制直传到云存储（不经过云函数，避免大文件超时）。
5. 公开地址为 `https://{envId}.api.tcloudbasegateway.com/v1/storages/object/public/{bucketId}/{objectName}`，
   由云函数一并返回，写进 `data/works.js` 的 `video` / `cover` 字段。

### 保存作品（B 方案：全自动）

1. 视频、封面都传完后，浏览器 POST `{ work }` 到本机 `/api/save-work`。
2. `server.js` 读取并追加 `data/works.js`。
3. `server.js` 自动执行 `git add -A -- data/works.js` → `git commit` → `git push origin main`。
4. push 之后还会比较 `HEAD` 和 `origin/main`，**确认远端真的收到**才算成功（避免假成功）。

删除作品同理，走 `/api/delete-work`：先删云端对象，再改 `works.js`，最后自动发布。

> 注意：签名接口返回的 `url` 是 `/v1/storages/...` 相对路径，不是绝对地址。
> `server.js` 会读 `cloudbase/config.json` 里的 `gatewayBase` / `bucketId` 把它补成绝对 URL；
> 云函数里也用 `toAbsoluteUrl()` 做了同样处理。两边都改了，哪边先生效都不会出问题。

## 常见错误对照

| 错误码 | 含义 |
| --- | --- |
| `UNAUTHORIZED` | 口令与 `UPLOAD_TOKEN` 不一致 |
| `MISSING_SERVICE_ROLE_KEY` | 云函数没配置 API Key |
| `MISSING_BUCKET_ID` | 云函数没配置 `BUCKET_ID` |
| `MISSING_ENV_ID` | 云函数同时没有 `ENV_ID` 和 `TCB_ENV` |
| `STORAGE_BUCKET_NOT_FOUND` | 桶还没创建，或 ID 拼错 |
| `STORAGE_NOT_SUPPORTED` | 说明代码又用回了传统模式的云存储接口 |
| `STORAGE_UPLOAD_FAILED_403` | 预签名 token 过期、被改过，或桶的 MIME / 大小限制拒绝了这个文件 |

## 修改后必须重新部署

改完 `functions/upload-ticket/index.js`，必须在云函数控制台重新保存并部署才会生效。
只改本机 `server.js` / `publish.js` 的话，重启 `启动网站.bat` 即可。
