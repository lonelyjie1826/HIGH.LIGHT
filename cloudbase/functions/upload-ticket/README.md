# upload-ticket

CloudBase 云函数，用于校验上传口令并签发云存储直传信息。

## 环境变量

- `UPLOAD_TOKEN`：至少 24 位的随机口令，只保存在云函数环境变量中。
- `PUBLIC_BASE_URL`：云存储默认访问域名，末尾不要带 `/`。

## 函数配置

- 运行时：Node.js 18 或更新版本
- 内存：128MB
- 超时：5 秒

部署后，在云函数控制台安装 `package.json` 中的依赖并重新部署。
