"""services：业务逻辑层（《开发手册》6.1 分层架构 api/router → service → model/repository）。

约定：
- 所有函数第一个参数是 ``db: Session``；
- 需要当前用户时传 ``user: User``（由 router 通过 ``get_current_user`` 注入）；
- 抛 ``BusinessException`` 表达可预期失败，不返回错误码；
- 画像回流（7.8）统一调用 ``profile_service.apply_tags``（写标签）+
  ``profile_service.recompute_stage``（重算阶段），异步抽取入口是
  ``profile_service.extract_tags_from_text``。

补实现的两个 service（设计说明书 5.4 的需求，手册 4.1 的 services 清单未列，
见 backend/README.md 第 6 节）：
- ``home_service``：首页聚合 + ``next_action`` 决策（产品「AI 主动性」落点）
- ``event_service``：行为埋点上报（当前只写结构化日志，**未持久化**）
"""
