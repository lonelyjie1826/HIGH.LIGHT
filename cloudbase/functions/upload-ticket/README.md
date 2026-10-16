# upload-ticket

CloudBase 云函数（PostgreSQL 模式），用于校验上传口令并签发 PG Storage API 的预签名上传链接。

它不使用 `@cloudbase/node-sdk` 的云存储接口 —— 那套接口在 PG 模式下会返回 `STORAGE_NOT_SUPPORTED`。
本函数直接用内置 `fetch` 调用 CloudBase HTTP 网关。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `UPLOAD_TOKEN` | 是 | 至少 24 位的随机口令，只保存在云函数环境变量中 |
| `SERVICE_ROLE_KEY` | 是 | 控制台 API Key 管理里的 `api_key`，服务端管理员密钥 |
| `BUCKET_ID` | 是 | 云存储桶 ID |
| `ENV_ID` | 是 | 环境 ID。实测该 Web 函数运行时**不带** `TCB_ENV`，必须显式配置 |

## 函数配置

- 运行时：**Node.js 18 或更新版本**（需要内置 `fetch`）
- 内存：128MB
- 超时：10 秒（只做两次短请求，不需要更长）

## 动作

- `sign-upload`：入参 `{ token, cloudPath }`，返回 `{ ok, upload: { url, token, objectName }, videoUrl, videoFileId }`
- `delete`：入参 `{ token, fileId }`，`fileId` 为对象名（如 `videos/xxx.mp4`）

修改本文件后，必须在云函数控制台重新保存并部署才会生效。
