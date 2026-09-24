import "./styles.css";
import {
  PARTIES,
  STAGES,
  ACCOUNTS,
  ENTRY_KINDS,
  stageOf,
  totals,
  netForRepair,
  judgeRepair,
  rejudgeRepair,
  toggleConfirmation,
  removeRepair
} from "./liability.js";
import { loadState, saveState, freshLiability } from "./migration.js";

const statuses = {
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const state = loadState();
const ui = { rejudgeFor: null }; // 当前展开改判表单的事项
const app = document.querySelector("#app");

function render() {
  const summary = totals(state.repairs, state.ledger);
  const groups = { pending: [], confirming: [], settled: [] };
  state.repairs.forEach((repair) => groups[stageOf(repair, state.ledger)].push(repair));

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">出租房维修 · 责任账</p>
          <h1>维修责任判定台</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>待判定</span><strong>${summary.pending}</strong></div>
          <div class="stat"><span>待确认</span><strong>${summary.confirming}</strong></div>
          <div class="stat"><span>已结清</span><strong>${summary.settled}</strong></div>
          <div class="stat"><span>押金预留中</span><strong>¥${summary.reserved}</strong></div>
          <div class="stat"><span>押金已扣减</span><strong>¥${summary.deducted}</strong></div>
          <div class="stat"><span>房东支出</span><strong>¥${summary.expense}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="panel">
          <h2>新增报修（先记待判定）</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>维修费用<input name="cost" type="number" min="0" step="1" value="0"></label>
            <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
        </aside>

        <section class="boards">
          ${renderBoard("pending", groups.pending)}
          ${renderBoard("confirming", groups.confirming)}
          ${renderBoard("settled", groups.settled)}
        </section>
      </section>

      ${renderLedger()}
    </main>
  `;

  bindEvents();
}

function renderBoard(stage, repairs) {
  return `
    <section class="board">
      <h2 class="board-title">${STAGES[stage]}<span class="count">${repairs.length}</span></h2>
      <div class="repairs">
        ${repairs.length ? repairs.map((repair) => renderRepair(repair, stage)).join("") : `<div class="empty">暂无${STAGES[stage]}的事项</div>`}
      </div>
    </section>
  `;
}

function renderRepair(repair, stage) {
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">费用 ¥${Number(repair.cost || 0)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        ${renderStageBody(repair, stage)}
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
          <button class="ghost" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderStageBody(repair, stage) {
  if (stage === "pending") {
    if (repair.status !== "done") {
      return `<p class="hint">报修已登记为待判定，完工（处理状态改为「已完成」）后，根据现场说明和照片判定责任。</p>`;
    }
    return renderJudgeForm("judge", repair);
  }

  const net = netForRepair(state.ledger, repair.id);
  const moneyRow = `
    <div class="row">
      ${net.reserved > 0 ? `<span class="chip money">租客 ¥${net.reserved} · 押金预留中</span>` : ""}
      ${net.deducted > 0 ? `<span class="chip money">租客 ¥${net.deducted} · 押金已扣减</span>` : ""}
      ${net.expense > 0 ? `<span class="chip money">房东 ¥${net.expense} · 计入房东支出</span>` : ""}
    </div>
    <p class="hint">现场说明：${escapeHtml(repair.liability.siteNote || "—")}</p>
  `;

  if (stage === "confirming") {
    const confirmations = repair.liability.confirmations;
    return `
      ${moneyRow}
      <div class="actions">
        <button class="confirm ${confirmations.landlord ? "on" : ""}" data-confirm="landlord" data-id="${repair.id}">${confirmations.landlord ? "✓ 房东已确认" : "房东确认"}</button>
        <button class="confirm ${confirmations.tenant ? "on" : ""}" data-confirm="tenant" data-id="${repair.id}">${confirmations.tenant ? "✓ 租客已确认" : "租客确认"}</button>
        <button class="ghost" data-rejudge-open="${repair.id}">改判</button>
      </div>
      <p class="hint">费用已在押金中预留，双方确认后才真正扣减。</p>
      ${ui.rejudgeFor === repair.id ? renderJudgeForm("rejudge", repair) : ""}
      ${renderHistory(repair)}
    `;
  }

  return `
    ${moneyRow}
    <div class="actions">
      <button class="ghost" data-rejudge-open="${repair.id}">改判</button>
    </div>
    ${ui.rejudgeFor === repair.id ? renderJudgeForm("rejudge", repair) : ""}
    ${renderHistory(repair)}
  `;
}

function renderJudgeForm(mode, repair) {
  const isRejudge = mode === "rejudge";
  return `
    <form class="judge-form" data-${isRejudge ? "rejudge" : "judge"}="${repair.id}">
      <div class="judge-grid">
        <label>责任方
          <select name="party">
            ${["landlord", "tenant", "shared"].map((value) => `<option value="${value}" ${repair.liability.party === value ? "selected" : ""}>${PARTIES[value]}</option>`).join("")}
          </select>
        </label>
        <label>租客分摊 %（分摊时生效）
          <input name="tenantShare" type="number" min="0" max="100" step="1" value="${repair.liability.tenantShare}">
        </label>
      </div>
      <label>现场说明<textarea name="siteNote" required placeholder="损坏原因与责任依据，可对照照片核对">${escapeHtml(repair.liability.siteNote || "")}</textarea></label>
      ${isRejudge ? `<label>改判原因<input name="reason" required placeholder="原金额将先退回，再按新结果重算"></label>` : ""}
      <div class="actions">
        <button class="primary" type="submit">${isRejudge ? "改判重算" : "判定入账"}</button>
        ${isRejudge ? `<button class="ghost" type="button" data-rejudge-cancel>取消</button>` : ""}
      </div>
    </form>
  `;
}

function renderHistory(repair) {
  const history = repair.liability.history;
  if (!history.length) return "";
  return `
    <ul class="history">
      ${history.map((item) => `<li><time>${formatTime(item.at)}</time>${escapeHtml(item.text)}</li>`).join("")}
    </ul>
  `;
}

function renderLedger() {
  const entries = state.ledger.slice().reverse();
  return `
    <section class="panel ledger-panel">
      <h2>责任账流水（可复核）</h2>
      ${
        entries.length
          ? `<ul class="ledger">
              ${entries
                .map(
                  (entry) => `
                <li>
                  <span class="tag ${entry.kind}">${ENTRY_KINDS[entry.kind] || entry.kind}</span>
                  <span class="ledger-title">${escapeHtml(entry.repairTitle)}</span>
                  <span class="ledger-amount ${entry.amount >= 0 ? "in" : "out"}">${ACCOUNTS[entry.account] || entry.account} ${entry.amount >= 0 ? "+" : "−"}¥${Math.abs(entry.amount)}</span>
                  <span class="ledger-note">${escapeHtml(entry.note || "")}</span>
                  <time>${formatTime(entry.at)}</time>
                </li>`
                )
                .join("")}
            </ul>`
          : `<div class="empty">还没有账目，事项完工判定后自动生成</div>`
      }
    </section>
  `;
}

function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.repairs.unshift({
      id: crypto.randomUUID(),
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      status: data.status,
      photo: data.photo.trim(),
      note: data.note.trim(),
      liability: freshLiability()
    });
    persist();
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      if (!repair) return;
      repair.status = select.value;
      persist();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      removeRepair(state, button.dataset.delete);
      persist();
    });
  });

  document.querySelectorAll("[data-judge]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      judgeRepair(state, form.dataset.judge, readJudgment(form));
      persist();
    });
  });

  document.querySelectorAll("[data-rejudge]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (rejudgeRepair(state, form.dataset.rejudge, readJudgment(form))) ui.rejudgeFor = null;
      persist();
    });
  });

  document.querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleConfirmation(state, button.dataset.id, button.dataset.confirm);
      persist();
    });
  });

  document.querySelectorAll("[data-rejudge-open]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.rejudgeFor = ui.rejudgeFor === button.dataset.rejudgeOpen ? null : button.dataset.rejudgeOpen;
      render();
    });
  });

  document.querySelectorAll("[data-rejudge-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.rejudgeFor = null;
      render();
    });
  });
}

function readJudgment(form) {
  const data = Object.fromEntries(new FormData(form));
  return {
    party: data.party,
    tenantShare: Number(data.tenantShare),
    siteNote: String(data.siteNote || "").trim(),
    reason: String(data.reason || "").trim()
  };
}

function persist() {
  saveState(state);
  render();
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
