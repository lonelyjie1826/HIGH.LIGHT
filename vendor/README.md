# vendor

`cloudbase.full.js` 由官方 npm 包 `@cloudbase/js-sdk@3.10.2` 打包生成：

```text
esbuild node_modules/@cloudbase/js-sdk/dist/index.esm.js \
  --bundle --format=iife --global-name=cloudbase --minify --platform=browser
```

该文件仅包含公开的浏览器 SDK，不包含任何腾讯云密钥。
