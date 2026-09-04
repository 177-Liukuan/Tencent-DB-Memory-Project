import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "examples");

function buildMessages(facts, startTimestamp) {
  const start = Date.parse(startTimestamp);
  return facts.flatMap((fact, index) => {
    const userTime = new Date(start + index * 5 * 60_000).toISOString();
    const assistantTime = new Date(start + index * 5 * 60_000 + 60_000).toISOString();
    return [
      {
        role: "user",
        content: fact.user,
        timestamp: userTime,
      },
      {
        role: "assistant",
        content: fact.assistant,
        timestamp: assistantTime,
      },
    ];
  });
}

async function writeExample(fileName, sessionId, facts, startTimestamp) {
  const body = {
    session_id: sessionId,
    messages: buildMessages(facts, startTimestamp),
  };
  await writeFile(resolve(outputDirectory, fileName), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

const codingRules = [
  "仓库统一使用 Node.js 22 和 pnpm 10，本地开发与 CI 必须保持相同主版本",
  "TypeScript 项目开启 strict 和 exactOptionalPropertyTypes，不用 any 绕过类型检查",
  "新增源文件使用 kebab-case 文件名，导出的类和类型使用 PascalCase",
  "公共函数必须明确声明返回类型，内部短小回调可以依赖类型推断",
  "业务错误使用带 code 的 Error 子类，不通过字符串内容判断错误类型",
  "HTTP 接口统一返回 code、message、request_id 和 data 四个字段",
  "用户输入在入口校验，进入业务层后不再重复猜测字段类型",
  "外部接口超时必须使用 AbortSignal，不能只用 Promise.race 放弃等待",
  "只读请求允许重试一次，写请求默认不自动重试",
  "日志中不得记录 Authorization、Cookie、API Key 和完整用户输入",
  "时间在接口和存储中统一使用带时区的 ISO 8601 字符串",
  "金额使用整数分保存和计算，禁止用浮点数直接表示人民币元",
  "数据库事务只包住必要写操作，事务内不调用远程 HTTP 服务",
  "新增表必须同时提供正向迁移和可执行的回滚说明",
  "SQL 查询必须使用参数绑定，不能拼接用户提供的条件",
  "分页接口必须限制最大 page_size，默认值由服务端统一提供",
  "缓存键必须带业务前缀和版本号，结构变化时提升版本",
  "Redis 锁必须设置过期时间，并且只能由持有者释放",
  "消息消费者按业务幂等键去重，不能依赖消息投递恰好一次",
  "事件结构新增字段应保持可选，删除字段前要经过一个兼容周期",
  "控制器只处理协议转换，业务规则放在 service 层",
  "数据访问代码集中在 repository 层，业务层不直接拼 SQL",
  "单元测试使用 Arrange、Act、Assert 的顺序组织，不共享可变全局状态",
  "修复缺陷时先添加能够复现问题的测试，再修改生产代码",
  "测试名称应描述条件和结果，不使用 test1 或 works 等含糊名称",
  "涉及数据库的测试必须清理自己创建的数据，不能依赖执行顺序",
  "快照测试只用于稳定结构，动态时间和随机 ID 应使用明确断言",
  "Mock 只替换网络、时钟和随机数等边界，不 Mock 被测业务本身",
  "提交前运行格式检查、类型检查和受影响模块的完整测试",
  "每个提交只解决一个清楚的问题，重构和行为变更尽量分开",
  "提交信息使用 type(scope): summary 格式，summary 使用英文祈使句",
  "禁止提交 .env、私钥、访问令牌和本地数据库文件",
  "配置示例只能放占位值，不复制测试或生产环境的真实凭据",
  "功能开关默认选择安全状态，删除开关前确认所有环境已经迁移",
  "命令行参数缺失时返回非零退出码，并把可操作的原因写到 stderr",
  "脚本必须支持 --help，破坏性操作还必须提供 --dry-run",
  "批处理任务记录成功、跳过和失败数量，单项失败不能被静默忽略",
  "文件写入先落临时文件再原子替换，避免进程中断留下半份内容",
  "解析 JSON 时区分格式错误和字段错误，错误信息包含文件位置",
  "用户可见错误不返回堆栈，完整堆栈只写入服务端日志",
  "健康检查不得访问高延迟的外部依赖，依赖状态通过单独就绪检查暴露",
  "指标名称使用稳定英文，标签不能放 user_id 等高基数字段",
  "新增功能必须说明成功条件、失败行为和重试边界",
  "修改公共接口前先检索所有调用方和测试，不能只修改定义文件",
  "删除代码前确认没有动态加载、配置引用或脚本调用",
  "异步任务必须等待或显式登记，不能留下无人处理的 Promise",
  "并发更新使用版本号或数据库条件更新，不能依赖先读后写",
  "资源关闭放在 finally 中，测试也要验证异常路径能够释放资源",
  "性能优化必须提供优化前后的同一组测量数据",
  "完成改动后检查最终 diff，移除调试日志和与任务无关的格式变化",
];

const codingFacts = codingRules.map((rule, index) => ({
  user: index % 3 === 0
    ? `请记住第 ${index + 1} 项编码约定：${rule}。后续修改代码时按这项规则执行。`
    : index % 3 === 1
      ? `项目评审刚确认了一条长期规则：${rule}。以后做相关任务时不要偏离。`
      : `把下面的开发习惯作为本项目的固定要求：${rule}。如果现有代码不符合，先说明再修改。`,
  assistant: `已记录这项项目约定：${rule}。后续遇到相关代码或评审任务时，我会以此为准。`,
}));

const engineeringComponents = [
  ["账户接口", "identity-team"],
  ["订单接口", "order-team"],
  ["库存服务", "supply-team"],
  ["支付服务", "payment-team"],
  ["通知服务", "messaging-team"],
  ["API 网关", "platform-team"],
  ["认证服务", "security-team"],
  ["搜索服务", "search-team"],
  ["推荐服务", "growth-team"],
  ["定价服务", "pricing-team"],
  ["优惠券服务", "promotion-team"],
  ["履约服务", "fulfillment-team"],
  ["物流服务", "logistics-team"],
  ["发票服务", "finance-team"],
  ["报表服务", "analytics-team"],
  ["审计服务", "security-team"],
  ["配置中心", "platform-team"],
  ["任务调度服务", "platform-team"],
  ["事件消费服务", "data-team"],
  ["运营后台", "admin-team"],
];

const engineeringFacts = engineeringComponents.flatMap(([component, owner], componentIndex) => [
  {
    user: `${component}由 ${owner} 负责。涉及公共接口或数据结构的改动，必须由该团队至少一名成员评审。`,
    assistant: `已记录 ${component} 的负责人和评审要求；后续相关改动会邀请 ${owner} 参与评审。`,
  },
  {
    user: `${component}的接口采用向后兼容策略。新增字段保持可选，废弃字段至少保留两个发布周期。`,
    assistant: `明白，${component}的接口变更会保留两个发布周期的兼容期，并避免让旧客户端因新增字段失效。`,
  },
  {
    user: `${component}的数据库变更分为扩展、迁移、收缩三步，收缩操作不能与应用功能发布在同一批执行。`,
    assistant: `已记录 ${component} 的三步迁移方式；发布方案会把不可逆的收缩操作单独安排。`,
  },
  {
    user: `${component}合并前必须通过单元测试、接口契约测试和一条失败路径测试，覆盖率数字本身不是放行条件。`,
    assistant: `后续审查 ${component} 时会核对三类实际测试，不会只依据覆盖率百分比判断。`,
  },
  {
    user: `${component}使用 ${componentIndex % 2 === 0 ? "10%→30%→100%" : "5%→25%→50%→100%"} 的灰度顺序，每阶段至少观察 ${10 + componentIndex} 分钟。`,
    assistant: `已记录 ${component} 的灰度比例和观察时长；指标异常时会停在当前阶段，不继续扩大范围。`,
  },
]);

const operatedServices = [
  "public-gateway", "account-api", "order-api", "inventory-worker", "payment-api",
  "notification-worker", "search-api", "recommendation-api", "pricing-api", "coupon-api",
  "fulfillment-worker", "logistics-sync", "invoice-worker", "report-api", "audit-consumer",
  "config-server", "job-scheduler", "event-consumer", "admin-api", "web-frontend",
];

const operationalFacts = operatedServices.flatMap((service, serviceIndex) => {
  const port = 8100 + serviceIndex;
  const replicas = 2 + (serviceIndex % 3);
  const latency = 180 + serviceIndex * 10;
  return [
    {
      user: `${service} 生产环境监听 ${port} 端口，部署采用滚动更新，maxUnavailable 固定为 0。`,
      assistant: `已记录 ${service} 的端口和滚动更新限制；发布时不会同时下线旧实例。`,
    },
    {
      user: `${service} 的就绪检查路径是 /ready，连续 3 次成功才接收流量；存活检查使用 /health。`,
      assistant: `后续检查 ${service} 时会区分 /ready 与 /health，不会用存活检查替代就绪检查。`,
    },
    {
      user: `${service} 常态副本数为 ${replicas}，工作日高峰期扩到 ${replicas + 2}，缩容前要确认队列已经清空。`,
      assistant: `已记录 ${service} 的常态和高峰副本数，缩容前会先检查待处理任务。`,
    },
    {
      user: `${service} 单实例 CPU request 为 ${250 + serviceIndex * 10}m，memory request 为 ${256 + (serviceIndex % 4) * 128}Mi，不能无依据提高 limit。`,
      assistant: `资源调整会以 ${service} 的监控数据为依据，并保留 request 与 limit 的变更记录。`,
    },
    {
      user: `${service} 的 P95 延迟目标是低于 ${latency}ms，5 分钟错误率超过 1% 就停止发布。`,
      assistant: `已记录 ${service} 的延迟目标和 1% 错误率停止条件，灰度期间会重点观察这两项。`,
    },
    {
      user: `${service} 告警先发到 ops-primary，持续 10 分钟仍未恢复时升级到对应服务负责人。`,
      assistant: `后续处理 ${service} 告警时会先通知 ops-primary，并按 10 分钟规则升级。`,
    },
    {
      user: `${service} 日志保留 14 天，默认不记录请求正文；排障临时提高日志级别最多保持 30 分钟。`,
      assistant: `已记录 ${service} 的日志保留和临时调级限制，排障结束后会及时恢复日志级别。`,
    },
    {
      user: `${service} 依赖的数据每天 02:00 UTC 备份，恢复演练安排在每月第一个周三。`,
      assistant: `已记录 ${service} 的备份和恢复演练时间；不能把“备份成功”直接当作“可恢复”。`,
    },
    {
      user: `${service} 回滚使用上一份已验证镜像和配置版本，数据库迁移必须在发布前确认是否可逆。`,
      assistant: `后续为 ${service} 制定回滚方案时会同时锁定镜像、配置和数据库兼容条件。`,
    },
    {
      user: `${service} 的计划维护窗口是周四 16:00–18:00 UTC，涉及中断的操作需提前 24 小时通知。`,
      assistant: `已记录 ${service} 的维护窗口和提前通知要求，计划外中断操作会先走紧急变更流程。`,
    },
  ];
});

if (codingFacts.length !== 50 || engineeringFacts.length !== 100 || operationalFacts.length !== 200) {
  throw new Error("Example fact counts do not match 50/100/200 rounds");
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeExample("coding-50-rounds.json", "example-coding-50-rounds", codingFacts, "2026-01-05T09:00:00.000Z"),
  writeExample("software-engineering-100-rounds.json", "example-software-engineering-100-rounds", engineeringFacts, "2026-02-02T09:00:00.000Z"),
  writeExample("operations-deployment-200-rounds.json", "example-operations-deployment-200-rounds", operationalFacts, "2026-03-02T09:00:00.000Z"),
]);

process.stdout.write("Generated memory examples: 50, 100, and 200 rounds.\n");
