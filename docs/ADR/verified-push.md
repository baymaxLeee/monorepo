# 当前决策：本地验证与受控推送

开发期间按影响范围验证。推送前复核最终差异，取得提交与推送授权。
`just push` 检查工作树、提交、远端 main 祖先关系和目标分支能否快进，
再推送固定 SHA。这样可以复用开发期间的验证，也防止把检查之后移动的 HEAD 当作发布对象。

远端 build-images 对推送的 SHA 执行 `just ci-code`。本地需要诊断时，
`just ci-plan` 展示影响范围，`just ci` 执行检查并留下日志。排查质量、
镜像发布和部署问题时，分别核对对应 job 的结果。

命令、竞争条件和故障处理见[仓库 CLI 指南](../../scripts/README.md#local-ci-and-fast-push)。
推送边界由[实现](../../scripts/local-ci.mjs)与[临时 Git 仓库测试](../../scripts/local-ci.test.mjs)维护。
远端分支保护与凭据权限由仓库管理员配置。
