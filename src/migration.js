// 数据升级：读取 localStorage 中的旧版数据，补全责任账结构。
// v1（旧版）：{ filter, repairs: [{ location, title, priority, cost, status, photo, note }] }
// v2（当前）：repairs 每项增加 liability（责任判定），顶层增加 ledger（责任账流水）。
// 旧事项升级后责任为「待判定」，原有位置、费用、状态、照片、备注原样保留。

import { PARTIES } from "./liability.js";

export const STORAGE_KEY = "zfl-14-repairs";
export const STATE_VERSION = 2;

export function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return seedState();
    return upgrade(JSON.parse(saved));
  } catch (error) {
    console.warn("本地数据读取失败，已重置为初始数据", error);
    return seedState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function freshLiability() {
  return {
    party: "pending",
    tenantShare: 50,
    siteNote: "",
    confirmations: { landlord: false, tenant: false },
    history: []
  };
}

function upgrade(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: STATE_VERSION,
    filter: source.filter || "all",
    repairs: Array.isArray(source.repairs) ? source.repairs.map(upgradeRepair) : [],
    ledger: Array.isArray(source.ledger) ? source.ledger.map(upgradeEntry).filter(Boolean) : []
  };
}

function upgradeRepair(repair) {
  const item = repair && typeof repair === "object" ? repair : {};
  return {
    id: item.id || crypto.randomUUID(),
    location: item.location || "未填写位置",
    title: item.title || "未描述问题",
    priority: item.priority || "medium",
    cost: Math.max(0, Number(item.cost) || 0),
    status: item.status || "todo",
    photo: item.photo || "",
    note: item.note || "",
    liability: upgradeLiability(item.liability)
  };
}

function upgradeLiability(value) {
  const base = freshLiability();
  if (!value || typeof value !== "object") return base;
  const confirmations = value.confirmations && typeof value.confirmations === "object" ? value.confirmations : {};
  return {
    party: PARTIES[value.party] ? value.party : "pending",
    tenantShare: Number.isFinite(Number(value.tenantShare)) ? Number(value.tenantShare) : base.tenantShare,
    siteNote: typeof value.siteNote === "string" ? value.siteNote : "",
    confirmations: { landlord: Boolean(confirmations.landlord), tenant: Boolean(confirmations.tenant) },
    history: Array.isArray(value.history) ? value.history : []
  };
}

function upgradeEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.repairId || !entry.account) return null;
  return {
    id: entry.id || crypto.randomUUID(),
    repairId: entry.repairId,
    repairTitle: entry.repairTitle || "历史事项",
    at: entry.at || new Date().toISOString(),
    kind: entry.kind || "judge",
    account: entry.account,
    amount: Number(entry.amount) || 0,
    note: entry.note || ""
  };
}

function seedState() {
  return {
    version: STATE_VERSION,
    filter: "all",
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        liability: freshLiability()
      }
    ],
    ledger: []
  };
}
