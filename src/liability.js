// 判定规则：责任归属、金额分摊、状态归类与责任账流水

export const liabilities = {
  landlord: "房东承担",
  tenant: "租客承担",
  shared: "双方分摊"
};

export const buckets = {
  all: "全部",
  pending: "待判定",
  confirming: "待确认",
  settled: "已结清"
};

export const ledgerLabels = {
  reserve: "押金预留",
  release: "预留退回",
  deduct: "押金扣减",
  refund: "扣减退回",
  "landlord-expense": "房东支出",
  "expense-reversal": "支出冲回"
};

// 租客应承担的金额：租客承担=全额，双方分摊=按租客比例
export function tenantAmountOf(repair) {
  const cost = Number(repair.cost || 0);
  if (repair.liability === "tenant") return cost;
  if (repair.liability === "shared") return Math.round((cost * Number(repair.tenantPercent || 0)) / 100);
  return 0;
}

// 房东应承担的金额：判定后费用减去租客部分
export function landlordAmountOf(repair) {
  if (!repair.liability) return 0;
  return Number(repair.cost || 0) - tenantAmountOf(repair);
}

// 列表归类：未判定→待判定；判给房东→直接结清；判给租客/分摊→确认后才结清
export function bucketOf(repair) {
  if (!repair.liability) return "pending";
  if (repair.liability === "landlord") return "settled";
  return repair.confirmed ? "settled" : "confirming";
}

// 汇总由当前判定结果推导，同一笔维修只按最新判定记一次，不会两边都算
export function summarize(state) {
  const summary = {
    pending: 0,
    confirming: 0,
    settled: 0,
    reserved: 0,
    deducted: 0,
    landlordExpense: 0
  };
  state.repairs.forEach((repair) => {
    summary[bucketOf(repair)] += 1;
    const tenant = tenantAmountOf(repair);
    if (tenant > 0) {
      if (repair.confirmed) summary.deducted += tenant;
      else summary.reserved += tenant;
    }
    summary.landlordExpense += landlordAmountOf(repair);
  });
  summary.deposit = Number(state.deposit || 0);
  summary.available = summary.deposit - summary.deducted - summary.reserved;
  return summary;
}

function pushLedger(state, repair, type, amount, detail) {
  if (!amount) return;
  state.ledger.unshift({
    id: crypto.randomUUID(),
    repairId: repair.id,
    repairTitle: `${repair.location}·${repair.title}`,
    type,
    amount,
    detail,
    at: new Date().toISOString()
  });
}

// 判定/改判：已有判定时先把原金额退回（预留退回/扣减退回/支出冲回），再按新结果重算
export function judgeRepair(state, repair, { liability, tenantPercent, finishNote, finishPhoto }) {
  if (repair.liability) {
    const prevTenant = tenantAmountOf(repair);
    const prevLandlord = landlordAmountOf(repair);
    if (prevTenant > 0) {
      pushLedger(state, repair, repair.confirmed ? "refund" : "release", prevTenant, "改判退回原租客金额");
    }
    if (prevLandlord > 0) {
      pushLedger(state, repair, "expense-reversal", prevLandlord, "改判冲回原房东支出");
    }
  }

  repair.liability = liability;
  repair.tenantPercent = liability === "shared" ? clampPercent(tenantPercent) : liability === "tenant" ? 100 : 0;
  repair.confirmed = false;
  repair.judgedAt = new Date().toISOString();
  repair.confirmedAt = null;
  if (finishNote !== undefined) repair.finishNote = String(finishNote).trim();
  if (finishPhoto !== undefined) repair.finishPhoto = String(finishPhoto).trim();

  const tenant = tenantAmountOf(repair);
  const landlord = landlordAmountOf(repair);
  if (tenant > 0) pushLedger(state, repair, "reserve", tenant, "判定后先在押金中预留，待双方确认");
  if (landlord > 0) pushLedger(state, repair, "landlord-expense", landlord, "判定后计入房东支出");
}

// 双方确认：判给租客或分摊的费用才从押金里扣减
export function confirmRepair(state, repair) {
  if (!repair.liability || repair.liability === "landlord" || repair.confirmed) return;
  repair.confirmed = true;
  repair.confirmedAt = new Date().toISOString();
  pushLedger(state, repair, "deduct", tenantAmountOf(repair), "双方确认，预留转为扣减");
}

function clampPercent(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 50;
  return Math.min(100, Math.max(0, Math.round(num)));
}
