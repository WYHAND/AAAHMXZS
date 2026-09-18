"""services：业务逻辑层（《开发手册》6.1 分层架构 api/router → service → model/repository）。

约定：
- 所有函数第一个参数是 ``db: Session``；
- 需要当前用户时传 ``user: User``（由 router 通过 ``get_current_user`` 注入）；
- 抛 ``BusinessException`` 表达可预期失败，不返回错误码；
- 画像回流（7.8）统一调用 ``profile_service.apply_extracted_tags``。
"""
