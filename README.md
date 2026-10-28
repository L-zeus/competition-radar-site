# Competition Radar 静态发布候选

此目录只包含审核后的静态产物，不包含完整开发工程或研究数据库。公开静态站不意味着完整项目源码开源；项目源码许可证尚未决定。第三方许可声明见 `site/third-party-notices.txt`。

来源数据截至日期与状态评估日期分别见 site/site-manifest.json 和 site/public-manifest.json。超过已公布截止日期的赛道会按设备日期自动标为待核验；该判断不证明平台关闭、延期或受理。来源变更仍须经受控证据审核并重新发布。

`python3 tools/verify.py` 核验已审核 Manifest 及每个静态文件。`--publish` 运行同样的完整性校验。校验哈希不能替代来源、版权和时效审查。

Push 和 pull request 只运行只读校验。上传和部署只在默认分支手动运行、publish=true 且仓库变量 G1514_PAGES_DEPLOYMENT=enabled 时进行。环境保护须在 GitHub 上另行配置；公开创建、推送、Pages 配置和首次部署须事先获得所有者明确授权。部署只上传 site 目录。保留并核验上一版本和 Manifest，可经相同人工流程回滚。
