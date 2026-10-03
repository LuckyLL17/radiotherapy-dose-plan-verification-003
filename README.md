# 医疗放射治疗剂量计划验证与器官风险评估系统

本项目使用 React + Vite + TypeScript + Node.js + Fastify，提供专业分析工作流、参数计算、复核门禁和结果追踪。

```bash
npm install
npm run build
npm run dev
```

后端端口：6202；前端通过 Vite 代理访问 `/api`。

## 自适应评估模块

治疗期间体重、肿瘤位置或肺部密度变化时，在「自适应评估」页签按计划录入：

- `GET /api/plans/:id/adaptive-assessments`：返回该计划的基线、判定阈值与评估历史（按计划隔离，最新在前）。
- `POST /api/plans/:id/adaptive-assessments`：服务端计算靶区 D95 覆盖、肺部 V20 与建议结论（continue/review/replan），历史仅追加、永不覆盖。
  - 空值、非数字、肿瘤位移负值、越界值返回 `400` 并附字段级错误；计划不存在返回 `404`。
  - 阈值临界值含等号：覆盖 95.00%、V20 25.00% 不判失败，95–96% / 24–25% 为临界复核带（review）。
  - 同一计划 30 秒内输入完全一致的重复提交返回 `409`，不生成新记录。
- 前端组件以计划 id 为 key 重挂载并用 AbortController 取消旧请求，切换计划或刷新不会串数据；计算只发生在服务端。
