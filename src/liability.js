// 判定规则：责任划分、押金预留/扣减、房东支出、改判冲正与账目汇总。
// 账目模型：ledger 是一组只增不改的流水，每条流水落在三个账户之一——
//   reserved  押金预留（判给租客但双方尚未确认，只冻结不扣钱）
//   deducted  押金扣减（双方确认后从押金真正扣掉）
//   expense   房东支出（判给房东的部分）
// 改判时先把该维修在各账户的净额原路退回（reversal 流水），再按新判定入账，
// 因此同一笔维修在任一时刻只按当前判定计一次，不会两边都算。

export const PARTIES = {
  pending: "待判定",
  landlord: "房东承担",
  tenant: "租客承担",
  shared: "双方分摊"
};

export const STAGES = {
  pending: "待判定",
  confirming: "待确认",
  settled: "已结清"
};

export const ACCOUNTS = {
  reserved: "押金预留",
  deducted: "押金扣减",
  expense: "房东支出"
};

export const ENTRY_KINDS = {
  judge: "判定入账",
  confirm: "确认扣减",
  reversal: "改判退回"
};

// 按责任方拆分费用，返回 { tenant, landlord }
export function splitCost(cost, party, tenantShare = 50) {
  const amount = Math.max(0, Number(cost) || 0);
  if (party === "tenant") return { tenant: amount, landlord: 0 };
  if (party === "landlord") return { tenant: 0, landlord: amount };
  if (party === "shared") {
    const share = clampShare(tenantShare);
    const tenant = Math.round((amount * share) / 100);
    return { tenant, landlord: amount - tenant };
  }
  return { tenant: 0, landlord: 0 };
}

export function clampShare(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.min(100, Math.max(0, Math.round(num)));
}

// 单笔维修在三个账户上的净额
export function netForRepair(ledger, repairId) {
  const net = { reserved: 0, deducted: 0, expense: 0 };
  ledger.forEach((entry) => {
    if (entry.repairId === repairId && net[entry.account] !== undefined) {
      net[entry.account] += entry.amount;
    }
  });
  return net;
}

// 列表分桶：待判定 / 待确认（押金已预留、等双方确认）/ 已结清
export function stageOf(repair, ledger) {
  if (!repair.liability || repair.liability.party === "pending") return "pending";
  return netForRepair(ledger, repair.id).reserved > 0 ? "confirming" : "settled";
}

// 全量汇总：三个账户余额 + 三个阶段的事项数
export function totals(repairs, ledger) {
  const money = { reserved: 0, deducted: 0, expense: 0 };
  ledger.forEach((entry) => {
    if (money[entry.account] !== undefined) money[entry.account] += entry.amount;
  });
  const count = { pending: 0, confirming: 0, settled: 0 };
  repairs.forEach((repair) => {
    count[stageOf(repair, ledger)] += 1;
  });
  return { ...money, ...count };
}

// —— 以下为状态变更操作，调用方（main.js）负责保存与重绘 ——

// 完工后首次判定：判给租客先入押金预留，判给房东直接计房东支出
export function judgeRepair(state, repairId, judgment) {
  const repair = findRepair(state, repairId);
  if (!repair || repair.status !== "done") return false; // 完工后才能判定
  if (repair.liability.party !== "pending") return false; // 已判定的走改判
  applyJudgment(state, repair, judgment, "judge", "判定");
  return true;
}

// 改判：先把原判定在各账户的净额退回，再按新结果重算
export function rejudgeRepair(state, repairId, judgment) {
  const repair = findRepair(state, repairId);
  if (!repair || repair.liability.party === "pending") return false;
  const before = describeSplit(repair);
  state.ledger.push(...reversalEntries(repair, state.ledger, judgment.reason));
  applyJudgment(state, repair, judgment, "rejudge", `改判（原${before}，已退回）`);
  return true;
}

// 双方确认：都确认后押金预留转为扣减；确认前可撤回
export function toggleConfirmation(state, repairId, role) {
  const repair = findRepair(state, repairId);
  if (!repair || (role !== "landlord" && role !== "tenant")) return false;
  if (stageOf(repair, state.ledger) !== "confirming") return false;
  const confirmations = repair.liability.confirmations;
  confirmations[role] = !confirmations[role];
  pushHistory(repair, "confirm", `${role === "landlord" ? "房东" : "租客"}${confirmations[role] ? "已确认" : "撤回确认"}`);
  if (confirmations.landlord && confirmations.tenant) {
    const entries = confirmationEntries(repair, state.ledger);
    state.ledger.push(...entries);
    const deducted = entries.find((entry) => entry.account === "deducted");
    pushHistory(repair, "settle", `双方确认，押金扣减 ¥${deducted ? deducted.amount : 0}，结清`);
  }
  return true;
}

// 删除事项：未结/已结的金额先退回，保持账目平衡
export function removeRepair(state, repairId) {
  const repair = findRepair(state, repairId);
  if (!repair) return false;
  state.ledger.push(...reversalEntries(repair, state.ledger, "事项删除"));
  state.repairs = state.repairs.filter((item) => item.id !== repairId);
  return true;
}

function applyJudgment(state, repair, judgment, action, label) {
  const party = PARTIES[judgment.party] && judgment.party !== "pending" ? judgment.party : "landlord";
  const tenantShare = party === "shared" ? clampShare(judgment.tenantShare) : party === "tenant" ? 100 : 0;
  repair.liability.party = party;
  repair.liability.tenantShare = tenantShare;
  repair.liability.siteNote = String(judgment.siteNote || "").trim();
  repair.liability.confirmations = { landlord: false, tenant: false }; // 新判定需重新双方确认
  state.ledger.push(...judgmentEntries(repair, party, tenantShare, repair.liability.siteNote));
  pushHistory(repair, action, `${label}：${describeSplit(repair)}。${repair.liability.siteNote || "无现场说明"}`);
}

function judgmentEntries(repair, party, tenantShare, siteNote) {
  const split = splitCost(repair.cost, party, tenantShare);
  const entries = [];
  if (split.tenant > 0) entries.push(makeEntry(repair, "judge", "reserved", split.tenant, siteNote));
  if (split.landlord > 0) entries.push(makeEntry(repair, "judge", "expense", split.landlord, siteNote));
  return entries;
}

function confirmationEntries(repair, ledger) {
  const reserved = netForRepair(ledger, repair.id).reserved;
  if (reserved <= 0) return [];
  return [
    makeEntry(repair, "confirm", "reserved", -reserved, "双方确认，预留解除"),
    makeEntry(repair, "confirm", "deducted", reserved, "双方确认，从押金扣减")
  ];
}

function reversalEntries(repair, ledger, reason) {
  const net = netForRepair(ledger, repair.id);
  const note = reason ? `退回：${reason}` : "退回原判定金额";
  return Object.entries(net)
    .filter(([, amount]) => amount !== 0)
    .map(([account, amount]) => makeEntry(repair, "reversal", account, -amount, note));
}

function makeEntry(repair, kind, account, amount, note) {
  return {
    id: crypto.randomUUID(),
    repairId: repair.id,
    repairTitle: `${repair.location}·${repair.title}`,
    at: new Date().toISOString(),
    kind,
    account,
    amount,
    note: note || ""
  };
}

function describeSplit(repair) {
  const split = splitCost(repair.cost, repair.liability.party, repair.liability.tenantShare);
  return `${PARTIES[repair.liability.party]}（房东 ¥${split.landlord} / 租客 ¥${split.tenant}）`;
}

function pushHistory(repair, action, text) {
  repair.liability.history.push({ at: new Date().toISOString(), action, text });
}

function findRepair(state, repairId) {
  return state.repairs.find((item) => item.id === repairId);
}
