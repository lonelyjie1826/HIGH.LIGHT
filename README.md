# HIGH·LIGHT

私人游戏高光与搞笑瞬间分享站。

> 每一帧都值得重播。

![HIGH·LIGHT 首页预览](docs/首页桌面预览.png)

## 功能

- 三列极简画廊
- 作品详情与大播放器
- 可视化发布作品
- 可视化删除作品
- CloudBase 云端视频与封面上传
- 网站图标与分享卡片

## 本地使用

双击 `启动网站.bat`，浏览器会自动打开网站。

发布、删除和修改作品的具体步骤见 [使用说明.md](使用说明.md)。

「发布时刻」和「作品管理」只在本机运行时显示。公开网址的访客只能浏览，不能修改仓库或线上网站。

点「保存并发布」后，本机会自动提交并推送到 GitHub，约 1～3 分钟后公开网站更新。只有推送失败时才需要双击 `发布到GitHub.bat` 手动补推。

视频和封面都上传到腾讯云 CloudBase，不进入 GitHub 仓库。仓库只保存网页代码和作品数据。

CloudBase 配置记录见 [cloudbase/README.md](cloudbase/README.md)。上传口令只保存在腾讯云云函数环境变量中，不进入本仓库。

## 发布到 GitHub Pages

仓库推送到 GitHub 后，可以在仓库的 `Settings > Pages` 中选择 `Deploy from a branch`，然后将 `main` 分支作为发布来源。
