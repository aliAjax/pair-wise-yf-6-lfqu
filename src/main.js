// 页面交互：渲染与事件绑定，判定规则见 liability.js，数据升级见 storage.js
import "./styles.css";
import {
  liabilities,
  buckets,
  ledgerLabels,
  tenantAmountOf,
  landlordAmountOf,
  bucketOf,
  summarize,
  judgeRepair,
  confirmRepair
} from "./liability.js";
import { loadState, saveState } from "./storage.js";

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

let state = loadState();
let editingJudgeId = null;
const app = document.querySelector("#app");

function render() {
  const summary = summarize(state);
  const repairs = filteredRepairs();

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">出租房维修责任账</p>
          <h1>维修责任账</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>待判定</span><strong>${summary.pending}</strong></div>
          <div class="stat"><span>待确认</span><strong>${summary.confirming}</strong></div>
          <div class="stat"><span>押金预留</span><strong>¥${summary.reserved}</strong></div>
          <div class="stat"><span>房东支出</span><strong>¥${summary.landlordExpense}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="side">
          <div class="panel">
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
          </div>

          <div class="panel deposit">
            <h2>押金账户</h2>
            <label>押金总额<input id="deposit-input" type="number" min="0" step="1" value="${summary.deposit}"></label>
            <div class="deposit-rows">
              <div><span>已预留（待确认）</span><strong>¥${summary.reserved}</strong></div>
              <div><span>已扣减（双方已确认）</span><strong>¥${summary.deducted}</strong></div>
              <div><span>剩余可用</span><strong>¥${summary.available}</strong></div>
            </div>
          </div>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(buckets).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前分类下没有维修事项</div>`}
          </div>
          <section class="panel ledger-panel">
            <h2>责任账流水</h2>
            ${renderLedger()}
          </section>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderRepair(repair) {
  const bucket = bucketOf(repair);
  const photo = repair.photo || repair.finishPhoto;
  return `
    <article class="repair">
      <div class="photo">${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
          ${renderLiabilityBadge(repair)}
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">费用 ¥${Number(repair.cost || 0)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        ${repair.liability && editingJudgeId !== repair.id ? renderJudgeResult(repair) : ""}
        ${renderJudgeArea(repair)}
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
          ${bucket === "confirming" ? `<button class="primary small" data-confirm="${repair.id}">双方确认扣减</button>` : ""}
          ${repair.liability && editingJudgeId !== repair.id ? `<button class="ghost" data-rejudge="${repair.id}">改判</button>` : ""}
          <button class="ghost" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderLiabilityBadge(repair) {
  if (!repair.liability) return `<span class="liability pending">待判定</span>`;
  const label = repair.liability === "shared" ? `双方分摊 ${repair.tenantPercent}%` : liabilities[repair.liability];
  return `<span class="liability ${repair.liability}">${label}</span>`;
}

function renderJudgeResult(repair) {
  const tenant = tenantAmountOf(repair);
  const landlord = landlordAmountOf(repair);
  const parts = [];
  if (tenant > 0) parts.push(`租客 ¥${tenant}`);
  if (landlord > 0) parts.push(`房东 ¥${landlord}`);
  const settleChip =
    repair.liability === "landlord"
      ? `<span class="chip">已计入房东支出</span>`
      : repair.confirmed
        ? `<span class="chip">双方已确认，押金已扣减</span>`
        : `<span class="chip">已在押金预留，待双方确认</span>`;
  return `
    <div class="judge-result">
      <div class="row">
        <span class="chip">分摊：${parts.join(" · ") || "—"}</span>
        ${settleChip}
      </div>
      ${repair.finishNote ? `<p class="finish-note">现场说明：${escapeHtml(repair.finishNote)}</p>` : ""}
      ${repair.finishPhoto ? `<a class="finish-photo" href="${escapeHtml(repair.finishPhoto)}" target="_blank" rel="noreferrer">查看完工照片</a>` : ""}
    </div>
  `;
}

function renderJudgeArea(repair) {
  if (editingJudgeId === repair.id) return renderJudgeForm(repair);
  if (repair.liability) return "";
  if (repair.status !== "done") return `<p class="hint">完工后根据现场说明和照片判定责任</p>`;
  return renderJudgeForm(repair);
}

function renderJudgeForm(repair) {
  const isRejudge = Boolean(repair.liability);
  return `
    <form class="judge-form" data-judge="${repair.id}">
      <p class="hint">${isRejudge ? "改判会先退回原金额，再按新结果重算" : "完工判定：根据现场说明和照片选择责任归属"}</p>
      <label>现场说明<textarea name="finishNote" placeholder="例如锁舌被外力别坏 / 管道自然老化">${escapeHtml(repair.finishNote || "")}</textarea></label>
      <label>完工照片链接<input name="finishPhoto" type="url" value="${escapeHtml(repair.finishPhoto || "")}" placeholder="可选，粘贴图片地址"></label>
      <div class="judge-row">
        <label>责任判定
          <select name="liability">
            ${Object.entries(liabilities).map(([value, label]) => `<option value="${value}" ${repair.liability === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>租客分摊 %<input name="tenantPercent" type="number" min="0" max="100" step="1" value="${repair.tenantPercent ?? 50}"></label>
      </div>
      <div class="actions">
        <button class="primary" type="submit">${isRejudge ? "退回重算" : "保存判定"}</button>
        ${isRejudge ? `<button class="ghost" type="button" data-cancel-judge>取消</button>` : ""}
      </div>
    </form>
  `;
}

function renderLedger() {
  if (!state.ledger.length) return `<div class="empty">还没有责任账记录</div>`;
  return `
    <ul class="ledger">
      ${state.ledger
        .slice(0, 30)
        .map(
          (entry) => `
        <li>
          <span class="ledger-type ${entry.type}">${ledgerLabels[entry.type] || entry.type}</span>
          <span class="ledger-title">${escapeHtml(entry.repairTitle)}</span>
          <span class="ledger-detail">${escapeHtml(entry.detail || "")}</span>
          <strong>¥${entry.amount}</strong>
          <time>${formatTime(entry.at)}</time>
        </li>`
        )
        .join("")}
    </ul>
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
      finishNote: "",
      finishPhoto: "",
      liability: null,
      tenantPercent: 50,
      confirmed: false,
      judgedAt: null,
      confirmedAt: null
    });
    saveState();
    render();
  });

  document.querySelector("#deposit-input").addEventListener("change", (event) => {
    state.deposit = Math.max(0, Number(event.target.value || 0));
    saveState();
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      repair.status = select.value;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-judge]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = state.repairs.find((item) => item.id === form.dataset.judge);
      const data = Object.fromEntries(new FormData(form));
      judgeRepair(state, repair, {
        liability: data.liability,
        tenantPercent: data.tenantPercent,
        finishNote: data.finishNote || "",
        finishPhoto: data.finishPhoto || ""
      });
      editingJudgeId = null;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.confirm);
      confirmRepair(state, repair);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-rejudge]").forEach((button) => {
    button.addEventListener("click", () => {
      editingJudgeId = button.dataset.rejudge;
      render();
    });
  });

  document.querySelectorAll("[data-cancel-judge]").forEach((button) => {
    button.addEventListener("click", () => {
      editingJudgeId = null;
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.repairs = state.repairs.filter((repair) => repair.id !== button.dataset.delete);
      saveState();
      render();
    });
  });
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => bucketOf(repair) === state.filter);
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
