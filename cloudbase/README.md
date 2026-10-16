# CloudBase 上传服务

## 云函数

- 环境：`wangzan-d8gpex18f673aac9d`
- 函数名：`upload-ticket`
- 类型：HTTP 云函数
- 入口一：`https://wangzan-d8gpex18f673aac9d-1507394434.ap-shanghai.app.tcloudbase.com/upload-ticket`
- 入口二：`https://wangzan-d8gpex18f673aac9d.service.tcloudbase.com/upload-ticket`
- 代码目录：`cloudbase/functions/upload-ticket`

## 云函数环境变量

```text
UPLOAD_TOKEN=仅保存在腾讯云函数环境变量中的长随机口令
PUBLIC_BASE_URL=https://7761-wangzan-d8gpex18f673aac9d-1507394434.tcb.qcloud.la
```

不要把 `UPLOAD_TOKEN` 写入仓库或网页代码。

## 云存储

- 存储桶：`high-light-media`
- 默认访问域名：`https://7761-wangzan-d8gpex18f673aac9d-1507394434.tcb.qcloud.la`
- 访问策略：`anon` 角色允许 `SELECT`，匹配 `bucket_id = 'high-light-media'`
- 不创建 `INSERT`、`UPDATE`、`DELETE` 策略
