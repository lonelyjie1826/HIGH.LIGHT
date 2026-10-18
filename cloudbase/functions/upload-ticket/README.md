# upload-ticket

CloudBase 云函数（PostgreSQL 模式），用于校验上传口令，并签发 PG Storage API 的预签名上传链接。

它不使用 `@cloudbase/node-sdk` 的云存储接口 —— 那套接口在 PG 模式下会返回 `STORAGE_NOT_SUPPORTED`。
本函数只用 Node 内置的 `node:https` 直接调用 CloudBase HTTP 网关，**没有任何第三方依赖**。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `UPLOAD_TOKEN` | 是 | 网页上要手输的上传口令。长度不限，建议 8 位以上的字母＋数字 |
| `SERVICE_ROLE_KEY` | 是 | 控制台 API Key 管理里的 `api_key`，服务端管理员密钥 |
| `BUCKET_ID` | 是 | 云存储桶 ID，如 `high-light-media` |
| `ENV_ID` | 是 | 环境 ID。实测该 Web 函数运行时**不带** `TCB_ENV`，必须显式配置，否则报 `MISSING_ENV_ID` |

## 函数配置

- 类型：HTTP 云函数（WEB 框架），监听 `9000`
- 运行时：Node.js 20.19（代码兼容低版本，不依赖全局 `fetch`）
- 内存：256MB
- 超时：10 秒
- 网络配置 → **公网访问必须开启**（函数要访问 CloudBase HTTP 网关）

## 允许的对象路径

- 视频：`videos/<名字>.mp4`、`.webm`、`.mov`
- 封面：`covers/<名字>.png`、`.jpg`、`.jpeg`、`.webp`

其他路径一律拒绝，避免被当成任意文件存储。

## 动作

- `GET`：健康检查，返回 `{ ok: true, service: "upload-ticket", mode: "postgres" }`（`mode` 字段可用于确认线上跑的是新版代码）
- `sign-upload`：入参 `{ token, cloudPath }`，返回 `{ ok, upload: { url, token, objectName }, videoUrl, videoFileId }`
- `delete`：入参 `{ token, fileId }`，`fileId` 为对象名（如 `videos/xxx.mp4` 或 `covers/xxx.png`）

## 部署

修改 `index.js` 后，必须在云函数控制台的「函数代码」标签页里粘贴并点「部署」才会生效。

> 曾经踩过的坑：控制台默认打开的标签页是 `README_cn.md`，**把代码粘进去是无效的**。
> 确认标签页标题是 `index.js`、右下角语言显示 `JavaScript` 后再粘贴。

两个可访问入口：

- `https://wangzan-d8gpex18f673aac9d-1507394434.ap-shanghai.app.tcloudbase.com/upload-ticket`
- `https://wangzan-d8gpex18f673aac9d.service.tcloudbase.com/upload-ticket`
