// 数据升级：沿用原存储键读取旧版本地数据，补齐责任账字段后继续能读
import { judgeRepair } from "./liability.js";

const STORAGE_KEY = "zfl-14-repairs";
const STATE_VERSION = 1;
const FILTERS = ["all", "pending", "confirming", "settled"];

export function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return migrate(JSON.parse(saved));
    } catch {
      // 数据损坏时退回初始数据
    }
  }
  return seedState();
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function blankRepair(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    location: "",
    title: "",
    priority: "medium",
    cost: 0,
    status: "todo",
    photo: "",
    note: "",
    finishNote: "",
    finishPhoto: "",
    liability: null,
    tenantPercent: 50,
    confirmed: false,
    judgedAt: null,
    confirmedAt: null,
    ...overrides
  };
}

function migrate(raw) {
  return {
    version: STATE_VERSION,
    // 旧版按处理状态过滤（todo/doing/done），升级后按责任账分类，统一回退到全部
    filter: FILTERS.includes(raw.filter) ? raw.filter : "all",
    deposit: Number(raw.deposit ?? 3000),
    repairs: Array.isArray(raw.repairs) ? raw.repairs.map(migrateRepair) : [],
    ledger: Array.isArray(raw.ledger) ? raw.ledger : []
  };
}

function migrateRepair(repair) {
  // 旧事项只缺责任账字段，位置、费用、状态、照片、备注原样保留
  return blankRepair({
    id: repair.id || crypto.randomUUID(),
    location: repair.location || "",
    title: repair.title || "",
    priority: repair.priority || "medium",
    cost: Number(repair.cost || 0),
    status: repair.status || "todo",
    photo: repair.photo || "",
    note: repair.note || "",
    finishNote: repair.finishNote || "",
    finishPhoto: repair.finishPhoto || "",
    liability: repair.liability ?? null,
    tenantPercent: repair.tenantPercent ?? 50,
    confirmed: Boolean(repair.confirmed),
    judgedAt: repair.judgedAt || null,
    confirmedAt: repair.confirmedAt || null
  });
}

function seedState() {
  const state = {
    version: STATE_VERSION,
    filter: "all",
    deposit: 3000,
    repairs: [
      blankRepair({
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        note: "先检查软管接口"
      }),
      blankRepair({
        location: "卫生间",
        title: "门锁松动无法反锁",
        priority: "medium",
        cost: 180,
        status: "done"
      }),
      blankRepair({
        location: "客厅",
        title: "吸顶灯老化不亮",
        priority: "low",
        cost: 320,
        status: "done"
      })
    ],
    ledger: []
  };
  // 用判定规则生成示例账目，保证流水与汇总一致
  judgeRepair(state, state.repairs[1], { liability: "tenant", finishNote: "锁舌被外力别坏，属使用不当" });
  judgeRepair(state, state.repairs[2], { liability: "landlord", finishNote: "灯具自然老化，属正常损耗" });
  return state;
}
