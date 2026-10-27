# Competition Radar 静态发布候选

此目录只包含审核后的静态产物，不包含完整开发工程或研究数据库。公开静态站不意味着完整项目源码开源；项目源码许可证尚未决定。第三方许可声明见 `site/third-party-notices.txt`。

来源数据截至日期与状态评估日期分别见 site/site-manifest.json 和 site/public-manifest.json。状态按公布日期计算，不代表报名平台受理。状态会随时间过期；下一报名节点到来前应重新评估、构建和审核。

`python3 tools/verify.py` 核验已审核 Manifest 及每个静态文件。`--publish` 同时限定该候选可在北京时间 2026-10-27 至 2026-10-29 部署；之后须重新构建和复核。校验哈希不能替代来源、版权和时效审查。

Push 和 pull request 只运行只读校验。上传和部署只在默认分支手动运行、publish=true 且仓库变量 G1514_PAGES_DEPLOYMENT=enabled 时进行。环境保护须在 GitHub 上另行配置；公开创建、推送、Pages 配置和首次部署须事先获得所有者明确授权。部署只上传 site 目录。保留并核验上一版本和 Manifest，可经相同人工流程回滚。
