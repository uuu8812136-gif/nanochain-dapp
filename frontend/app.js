"use strict";

const HARDHAT_RPC = "http://127.0.0.1:8545";
const HARDHAT_CHAIN_ID = 31337;
const pow = createPoW(ethers);
const $ = (id) => document.getElementById(id);

const state = {
  config: null, // frontend/contract.json，由部署脚本写入
  mode: null, // "rpc" | "metamask"
  provider: null,
  rpcSigners: null,
  accounts: [],
  signer: null,
  contract: null,
  chain: [],
  difficulty: 0,
  owner: null,
  validReason: "",
  txs: [],
  miningAbort: null,
  editing: null, // 当前打开了篡改编辑器的区块索引
  tamper: null, // { index, data, newHash, powOk }
  refreshing: false,
  refreshAgain: false,
};

const STATUS = {
  mining: ["挖矿中", "info"],
  signing: ["等待签名", "warn"],
  pending: ["等待打包", "warn"],
  confirmed: ["已确认", "ok"],
  failed: ["失败", "bad"],
  cancelled: ["已取消", "bad"],
};

// ---------- 工具函数 ----------

const short = (h, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : "-");
const fmtInt = (n) => Number(n).toLocaleString("zh-CN");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function hashHtml(hash) {
  const zeros = hash.slice(2).match(/^0*/)[0].length;
  return `0x<span class="zeros">${hash.slice(2, 2 + zeros)}</span>${hash.slice(2 + zeros)}`;
}

function formatData(data) {
  try {
    const d = JSON.parse(data);
    if (d && typeof d === "object" && "de" in d && "para" in d) return `${d.de} → ${d.para}：${d.valor}`;
  } catch {
    /* 自由文本 */
  }
  return data;
}

function accountLabel(address) {
  const i = state.accounts.findIndex((a) => a.toLowerCase() === address.toLowerCase());
  const owner = state.owner && address.toLowerCase() === state.owner.toLowerCase() ? "（所有者）" : "";
  return i >= 0 && state.mode === "rpc" ? `账户 #${i} · ${short(address, 4)}${owner}` : `${short(address, 4)}${owner}`;
}

function friendlyError(err) {
  // ACTION_REJECTED 来自 ethers；4001 直接来自钱包（EIP-1193）
  if (err && (err.code === "ACTION_REJECTED" || err.code === 4001)) return "你在钱包中拒绝了该请求。";
  if (err && err.code === -32002) return "MetaMask 中已有一个待处理的请求，请点击扩展图标查看。";
  return (
    (err && (err.reason || err.shortMessage || (err.info && err.info.error && err.info.error.message) || err.message)) ||
    String(err)
  );
}

function showBanner(kind, html) {
  const banner = $("banner");
  if (!kind) {
    banner.hidden = true;
    return;
  }
  banner.className = `banner ${kind}`;
  banner.innerHTML = html;
  banner.hidden = false;
}

function setBadge(text, kind = "") {
  const badge = $("netBadge");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function setEnabled(enabled) {
  for (const id of ["btnSend", "btnRefresh", "accountSelect"]) $(id).disabled = !enabled;
  if (state.mode === "metamask") $("accountSelect").disabled = true;
  if (!enabled) $("btnDifficulty").disabled = true;
}

// ---------- 连接 ----------

async function rpcAlive() {
  try {
    const res = await fetch(HARDHAT_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function disconnect() {
  if (state.provider) {
    await state.provider.removeAllListeners();
    state.provider.destroy();
  }
  Object.assign(state, { provider: null, rpcSigners: null, accounts: [], signer: null, contract: null });
  setEnabled(false);
}

function setMode(mode) {
  state.mode = mode;
  $("btnRpc").classList.toggle("active", mode === "rpc");
  $("btnMetaMask").classList.toggle("active", mode === "metamask");
}

/** 直连 Hardhat 节点，直接使用节点提供的 10 个测试账户。 */
async function connectRpc() {
  await disconnect();
  setMode("rpc");
  setBadge("连接中…");
  if (!(await rpcAlive())) {
    setBadge("网络未启动", "bad");
    showBanner(
      "error",
      "无法连接到 <code>http://127.0.0.1:8545</code> 上的 Hardhat 本地区块链。" +
        "请先运行 <code>启动.bat</code>（或执行 <code>npm start</code>）启动项目，然后点击 <b>Hardhat 本地</b>。"
    );
    return;
  }
  const provider = new ethers.JsonRpcProvider(HARDHAT_RPC, HARDHAT_CHAIN_ID, {
    staticNetwork: true,
    pollingInterval: 1000,
  });
  state.provider = provider;
  state.rpcSigners = await provider.listAccounts();
  state.accounts = state.rpcSigners.map((s) => s.address);
  state.signer = state.rpcSigners[0];
  provider.on("block", () => refresh());
  await onSignerReady();
}

/** 通过 MetaMask 钱包连接（账户在 MetaMask 中选择）。 */
async function connectMetaMask() {
  if (!window.ethereum) {
    showBanner(
      "warn",
      '当前浏览器未检测到 MetaMask。请先安装扩展（<a href="https://metamask.io" target="_blank" rel="noopener">metamask.io</a>），' +
        "或直接使用 <b>Hardhat 本地</b> 按钮，无需钱包即可体验。"
    );
    return;
  }
  await disconnect();
  setMode("metamask");
  setBadge("等待 MetaMask 响应…", "warn");
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureHardhatNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    state.provider = provider;
    state.signer = await provider.getSigner();
    state.accounts = [state.signer.address];
    provider.on("block", () => refresh());
    await onSignerReady();
  } catch (err) {
    setBadge("未连接");
    showBanner("error", "MetaMask：" + escapeHtml(friendlyError(err)));
  }
}

async function ensureHardhatNetwork() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) === HARDHAT_CHAIN_ID) return;
  const hexId = "0x" + HARDHAT_CHAIN_ID.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    const code = err.code || (err.data && err.data.originalError && err.data.originalError.code);
    if (code !== 4902) throw err; // 4902 = 钱包中尚未添加该网络
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: "Hardhat Local",
          rpcUrls: [HARDHAT_RPC],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  }
}

async function onSignerReady() {
  const { address, abi } = state.config;
  $("contractAddr").textContent = address;
  if ((await state.provider.getCode(address)) === "0x") {
    setBadge("未找到合约", "bad");
    showBanner(
      "error",
      `当前网络的 <code>${address}</code> 地址上没有合约。Hardhat 网络是否被重启过？` +
        "请重新部署合约（执行 <code>npm run deploy</code>，或关闭后重新打开 <code>启动.bat</code>），然后刷新页面。"
    );
    return;
  }
  state.contract = new ethers.Contract(address, abi, state.signer);
  showBanner(null);
  setBadge(state.mode === "rpc" ? "Hardhat 本地 · chainId 31337" : "MetaMask · chainId 31337", "ok");
  setEnabled(true);
  await refresh();
}

async function selectAccount(index) {
  state.signer = state.rpcSigners[index];
  state.contract = state.contract.connect(state.signer);
  await refresh();
}

// ---------- 读取合约状态 ----------

async function refresh() {
  if (!state.contract) return;
  if (state.refreshing) {
    state.refreshAgain = true; // 不丢失在一次读取进行中发起的刷新请求
    return;
  }
  state.refreshing = true;
  state.refreshAgain = false;
  try {
    const c = state.contract;
    const me = await state.signer.getAddress();
    const [chain, difficulty, owner, validity, balance, blockNumber] = await Promise.all([
      c.getChain(),
      c.difficulty(),
      c.owner(),
      c.isValid(),
      state.provider.getBalance(me),
      state.provider.getBlockNumber(),
    ]);
    const before = state.chain.length;
    state.chain = chain.map((b) => ({
      index: Number(b.index),
      timestamp: Number(b.timestamp),
      data: b.data,
      prevHash: b.prevHash,
      nonce: b.nonce,
      hash: b.hash,
      miner: b.miner,
      difficulty: Number(b.difficulty),
    }));
    if (before > 0 && state.chain.length > before) state.newFrom = before;
    state.difficulty = Number(difficulty);
    state.owner = owner;
    state.validReason = validity.reason;

    renderAccounts(me);
    $("balance").textContent = `${Number(ethers.formatEther(balance)).toLocaleString("zh-CN", { maximumFractionDigits: 4 })} ETH`;
    $("ethBlock").textContent = fmtInt(blockNumber);
    renderStats(validity, me);
    // 只有链发生变化时才重绘：保留新区块动画和当前展开的内容
    const chainKey = [state.mode, state.owner, ...state.chain.map((b) => b.hash)].join("|");
    if (chainKey !== state.chainKey) {
      state.chainKey = chainKey;
      renderChain();
      renderTamperReport();
    }
  } catch (err) {
    showBanner("error", "读取合约状态失败：" + escapeHtml(friendlyError(err)));
  } finally {
    state.refreshing = false;
    if (state.refreshAgain) refresh();
  }
}

function renderAccounts(me) {
  const select = $("accountSelect");
  const isOwner = me.toLowerCase() === state.owner.toLowerCase();
  if (state.mode === "rpc") {
    const current = state.accounts.indexOf(me);
    select.innerHTML = state.accounts.map((a, i) => `<option value="${i}">${escapeHtml(accountLabel(a))}</option>`).join("");
    select.value = String(current);
    $("accountHint").textContent = "Hardhat 提供的测试账户（每个账户有 10,000 个测试 ETH，无真实价值）。可切换账户查看每个区块由谁挖出。";
  } else {
    select.innerHTML = `<option>${escapeHtml(me)}${isOwner ? "（所有者）" : ""}</option>`;
    $("accountHint").textContent = "如需切换账户，请在 MetaMask 中操作。";
  }
}

/** 写入文本，并在数值变化时让卡片短暂高亮。 */
function setStat(id, text) {
  const el = $(id);
  if (el.textContent === String(text)) return;
  const changed = el.textContent !== "-";
  el.textContent = text;
  if (changed) {
    const card = el.closest(".stat");
    card.classList.remove("flash");
    void card.offsetWidth; // 重新触发动画
    card.classList.add("flash");
  }
}

function renderStats(validity, me) {
  const d = state.difficulty;
  setStat("statTotal", fmtInt(state.chain.length));
  setStat("statDifficulty", d);
  $("statDifficultyHint").textContent = `${"0".repeat(d) || "无"} 个前导零 · 每块约需 ${fmtInt(16 ** d)} 次尝试`;
  const valid = $("statValid");
  valid.textContent = validity.valid ? "完整有效 ✓" : "已被篡改 ✗";
  valid.className = `stat-value ${validity.valid ? "ok" : "bad"}`;
  const reason = validity.valid ? validity.reason : `区块 #${validity.badIndex}：${validity.reason}`;
  $("statValidReason").innerHTML = `${escapeHtml(reason)} · 来自 <code>isValid()</code>`;
  $("statLastHash").innerHTML = hashHtml(state.chain[state.chain.length - 1].hash);

  const isOwner = me.toLowerCase() === state.owner.toLowerCase();
  const input = $("fDifficulty");
  if (document.activeElement !== input) input.value = d;
  $("btnDifficulty").disabled = !isOwner;
  $("diffHint").textContent = isOwner
    ? "当前账户是合约所有者，可以调整难度。"
    : `当前账户不是合约所有者（${short(state.owner, 4)}），调整难度的交易将被合约拒绝。`;
}

// 两个区块之间的链节图标
const LINK_ICON =
  '<svg viewBox="0 0 32 20" aria-hidden="true"><rect x="2" y="5" width="16" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="14" y="5" width="16" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';

/** 短哈希，前导零高亮：0x0000ab12…9fc3 */
function shortHashHtml(hash, n = 10) {
  const head = hash.slice(2, 2 + n);
  const zeros = head.match(/^0*/)[0].length;
  return `0x<span class="zeros">${head.slice(0, zeros)}</span>${head.slice(zeros)}…${hash.slice(-4)}`;
}

function renderChain() {
  const list = $("chain");
  const t = state.tamper;
  const newFrom = state.newFrom;
  state.newFrom = null; // 新区块动画只播放一次
  list.innerHTML = "";
  state.chain.forEach((block, i) => {
    if (i > 0) {
      const link = document.createElement("li");
      const broken = t && t.index === i - 1 && t.newHash !== block.prevHash;
      link.className = "link" + (broken ? " broken" : "");
      link.setAttribute(
        "aria-label",
        broken
          ? `链节断裂：区块 ${i} 的 prevHash 与区块 ${i - 1} 重新计算出的哈希不一致`
          : `链节：区块 ${i} 的 prevHash 等于区块 ${i - 1} 的哈希`
      );
      link.innerHTML = `${LINK_ICON}<code>${broken ? "✗ 已断裂" : short(block.prevHash, 4)}</code>`;
      list.appendChild(link);
    }
    const card = blockCard(block);
    if (newFrom != null && i >= newFrom) card.classList.add("is-new");
    list.appendChild(card);
  });

  state.loopWidth = 0;
  const looping = marqueeAllowed();
  list.classList.toggle("marquee", looping);
  if (looping) addLoopCopies(list);
  if (newFrom != null) {
    // 展示新区块：暂停滚动几秒并定位到它
    marquee.holdUntil = performance.now() + 5000;
    showBlock(state.chain.length - 1);
  }
}

// ---------- 区块链条的无限滚动 ----------

const SPEED = 0.035; // 像素/毫秒（约 35 px/s）
const narrowScreen = matchMedia("(max-width: 700px)");
const marquee = { pos: 0, last: 0, hovering: false, focused: false, dragging: false, holdUntil: 0 };

/** 只在水平布局且没有打开篡改模拟时滚动。 */
function marqueeAllowed() {
  return !narrowScreen.matches && state.editing == null && !state.tamper;
}

/**
 * 为了让循环看起来无限，在一条链之后加一个"循环开始"标记并复制整条链。
 * 复制品仅用于视觉展示：对屏幕阅读器隐藏且不参与 Tab 顺序。
 */
function addLoopCopies(list) {
  const originals = [...list.children];
  const gap = document.createElement("li");
  gap.className = "loop-gap";
  gap.setAttribute("aria-hidden", "true");
  gap.innerHTML = "<span>↺ 循环开始</span>";
  list.appendChild(gap);
  const setWidth = gap.offsetLeft + gap.offsetWidth - originals[0].offsetLeft;
  if (!(setWidth > 0)) {
    gap.remove(); // 页面还没有布局尺寸（标签页隐藏）：下次绘制时重试
    return;
  }
  const copies = Math.ceil(list.clientWidth / setWidth) + 1;
  for (let c = 0; c < copies; c++) {
    for (const el of [...originals, gap]) {
      const copy = el.cloneNode(true);
      copy.classList.add("clone");
      copy.classList.remove("is-new");
      copy.setAttribute("aria-hidden", "true");
      copy.querySelectorAll("button, summary").forEach((f) => f.setAttribute("tabindex", "-1"));
      list.appendChild(copy);
    }
  }
  state.loopWidth = setWidth;
}

function marqueeRunning() {
  return (
    state.loopWidth > 0 &&
    !marquee.hovering &&
    !marquee.focused &&
    !marquee.dragging &&
    !document.hidden &&
    performance.now() > marquee.holdUntil
  );
}

function tick(now) {
  const list = $("chain");
  const dt = marquee.last ? Math.min(now - marquee.last, 100) : 0;
  marquee.last = now;
  if (marqueeRunning()) {
    // scrollLeft 按整数像素取整；真实位置保存在 marquee.pos
    marquee.pos += dt * SPEED;
    if (marquee.pos >= state.loopWidth) marquee.pos -= state.loopWidth;
    list.scrollLeft = marquee.pos;
  }
  requestAnimationFrame(tick);
}

function setupMarquee() {
  const list = $("chain");
  list.addEventListener("pointerenter", () => (marquee.hovering = true));
  list.addEventListener("pointerleave", () => (marquee.hovering = false));
  list.addEventListener("pointerdown", () => (marquee.dragging = true));
  addEventListener("pointerup", () => (marquee.dragging = false));
  list.addEventListener("focusin", () => (marquee.focused = true));
  list.addEventListener("focusout", () => (marquee.focused = false));
  // 手动滚动（鼠标滚轮、滚动条）：从用户停留的位置继续滚动
  list.addEventListener("scroll", () => {
    if (Math.abs(list.scrollLeft - marquee.pos) > 2) marquee.pos = list.scrollLeft;
  });
  const relayout = () => {
    if (state.chain.length) renderChain();
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && marqueeAllowed() && !state.loopWidth && state.chain.length) renderChain();
  });
  narrowScreen.addEventListener("change", relayout);
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 250);
  });
  requestAnimationFrame(tick);
}

function blockCard(b) {
  const t = state.tamper;
  const editingThis = t && t.index === b.index;
  const tampered = editingThis && t.newHash !== b.hash;
  const linkBroken = t && t.index === b.index - 1 && t.newHash !== b.prevHash;
  const data = editingThis ? t.data : b.data;

  const li = document.createElement("li");
  li.className = "block" + (b.index === 0 ? " genesis" : "") + (tampered || linkBroken ? " broken" : "");
  li.setAttribute("aria-label", `区块 ${b.index}${tampered ? "，模拟中被篡改" : linkBroken ? "，模拟中链节断裂" : ""}`);
  li.innerHTML = `
    <div class="block-head">
      <span class="block-num">#${b.index}</span>
      ${b.index === 0 ? '<span class="block-tag">创世块</span>' : `<span class="block-tag">难度 ${b.difficulty}</span>`}
    </div>
    <div class="block-data">${escapeHtml(formatData(data))}</div>
    <dl class="hash-rows">
      <div><dt>哈希</dt><dd><code>${shortHashHtml(b.hash)}</code></dd></div>
      ${editingThis ? `<div class="recalc"><dt>重算哈希</dt><dd><code>${shortHashHtml(t.newHash)}</code></dd></div>` : ""}
      <div><dt>前一区块</dt><dd><code>${shortHashHtml(b.prevHash)}</code></dd></div>
    </dl>
    <div class="block-meta"><span>nonce ${fmtInt(b.nonce)}</span><span>${escapeHtml(accountLabel(b.miner))}</span></div>
    <details>
      <summary>详情</summary>
      <dl class="block-fields">
        <dt>哈希</dt><dd><code>${hashHtml(b.hash)}</code></dd>
        <dt>prevHash</dt><dd><code>${hashHtml(b.prevHash)}</code></dd>
        <dt>时间</dt><dd>${new Date(b.timestamp * 1000).toLocaleString("zh-CN")}</dd>
        <dt>数据</dt><dd><code>${escapeHtml(data)}</code></dd>
      </dl>
    </details>
    ${b.index > 0 && state.editing !== b.index ? `<div class="block-actions"><button type="button" class="small" data-action="edit" data-index="${b.index}">模拟篡改</button></div>` : ""}`;

  if (state.editing === b.index) {
    const editor = document.createElement("div");
    editor.className = "tamper-edit";
    editor.innerHTML = `
      <label for="tamperInput">篡改后的数据（仅页面显示，不上链）</label>
      <textarea id="tamperInput" rows="2"></textarea>
      <div class="actions">
        <button type="button" class="primary small" data-action="recalc" data-index="${b.index}">重新计算哈希</button>
        <button type="button" class="small" data-action="undo">撤销</button>
      </div>`;
    editor.querySelector("textarea").value = data;
    li.appendChild(editor);
  }
  return li;
}

// ---------- 篡改模拟（仅改动页面本地数据，链上不受影响） ----------

async function simulateTamper(index, newData) {
  const b = state.chain[index];
  // 直接调用合约自身的纯函数 computeHash()
  const newHash = await state.contract.computeHash(b.index, b.prevHash, b.miner, newData, b.nonce);
  state.tamper = { index, data: newData, newHash, powOk: pow.meetsDifficulty(newHash, b.difficulty) };
  renderChain();
  renderTamperReport();
  // 报告显示在链条顶部，滚动到该处以免被忽略
  $("tamperReport").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** 把链条滚动到指定区块并使其可见。 */
function showBlock(index) {
  const card = [...$("chain").querySelectorAll(".block:not(.clone)")].at(index);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function renderTamperReport() {
  const box = $("tamperReport");
  const t = state.tamper;
  if (!t || !state.chain[t.index]) {
    box.hidden = true;
    return;
  }
  const b = state.chain[t.index];
  const next = state.chain[t.index + 1];
  const items = [];
  if (t.newHash === b.hash) {
    items.push("新数据与原始数据完全相同，哈希没有变化。");
  } else {
    items.push(
      `<b>区块 #${b.index}：内容与已保存的哈希不再匹配。</b>链上保存的哈希：<code>${short(b.hash, 8)}</code>，用 <code>computeHash()</code> 重新计算：<code>${short(t.newHash, 8)}</code>。`
    );
    items.push(
      t.powOk
        ? "巧合的是，新哈希仍然满足前导零要求。"
        : `即使攻击者同时替换链上保存的哈希，<b>工作量证明也会失效</b>：新哈希不再以 ${b.difficulty} 个 0 开头，他必须重新挖矿（约需 ${fmtInt(16 ** b.difficulty)} 次尝试）。`
    );
    items.push(
      next
        ? `<b>区块 #${next.index} 与区块 #${b.index} 之间的链节断裂</b>，并且之后所有区块都必须重新挖矿。`
        : "这是最后一个区块，但任何新区块都会指向原来的哈希。"
    );
  }
  box.innerHTML = `
    <strong>区块 #${b.index} 篡改模拟报告</strong>
    <ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    <div class="ok-line">真实区块链上没有任何变化：isValid() 仍返回“${escapeHtml(state.validReason)}”。合约中根本不存在编辑区块的函数。</div>
    <div class="actions">
      <button type="button" class="small" data-action="show" data-index="${b.index}">查看区块 #${b.index}</button>
      <button type="button" class="small" data-action="undo">撤销模拟</button>
    </div>`;
  box.hidden = false;
}

// ---------- 写入合约 ----------

// 每笔交易展示的阶段；status 决定当前处于哪一步
const STEPS = ["挖矿", "签名", "等待打包", "已确认"];
const STEP_OF = { mining: 0, signing: 1, pending: 2, confirmed: 3 };

function addTx(title, { mines = true, skipLabel = "跳过挖矿" } = {}) {
  const entry = { id: Date.now() + Math.random(), title, status: "signing", step: 1, mines, skipLabel, fresh: true, time: new Date() };
  state.txs.push(entry);
  renderTxs();
  return entry;
}

function updateTx(entry, patch) {
  const previous = entry.status;
  Object.assign(entry, patch);
  if (entry.status in STEP_OF) entry.step = STEP_OF[entry.status];
  renderTxs();
  if (entry.status !== previous) notifyTx(entry);
}

function notifyTx(tx) {
  if (tx.status === "signing" && state.mode === "metamask") toast("warn", "请在 MetaMask 中确认", tx.title);
  if (tx.status === "pending") toast("info", "交易已发送", `${tx.title} · 等待被打包进区块`);
  if (tx.status === "confirmed") toast("ok", "交易已确认", `${tx.title} · 以太坊区块 ${fmtInt(tx.block)}`);
  if (tx.status === "failed") toast("bad", "交易失败", tx.error || tx.title);
  if (tx.status === "cancelled") toast("bad", "挖矿已取消", tx.title);
}

function stepsHtml(tx) {
  return `<ol class="steps" aria-label="交易阶段">${STEPS.map((name, i) => {
    let cls = "";
    if (i === 0 && !tx.mines) cls = "";
    else if (tx.status === "confirmed" || i < tx.step) cls = "done";
    else if (i === tx.step) cls = tx.status === "failed" || tx.status === "cancelled" ? "fail" : "current";
    const label = i === 0 && !tx.mines ? tx.skipLabel : name;
    return `<li class="${cls}">${label}</li>`;
  }).join("")}</ol>`;
}

function renderTxs() {
  $("txEmpty").hidden = state.txs.length > 0;
  $("txList").innerHTML = state.txs
    .slice()
    .reverse()
    .map((tx) => {
      const [label, kind] = STATUS[tx.status];
      const meta = [`${tx.time.toLocaleTimeString("zh-CN")}`];
      if (tx.detail) meta.push(escapeHtml(tx.detail));
      if (tx.hash) meta.push(`交易哈希：<code>${short(tx.hash, 10)}</code>`);
      if (tx.block != null) meta.push(`已打包进以太坊区块 ${fmtInt(tx.block)} · 消耗 gas ${fmtInt(tx.gas)}`);
      const html = `<li class="tx${tx.fresh ? " is-new" : ""}">
        <div class="tx-head"><span class="tx-title">${escapeHtml(tx.title)}</span><span class="badge ${kind}">${label}</span></div>
        ${stepsHtml(tx)}
        <div class="tx-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>
        ${tx.error ? `<div class="tx-error">${escapeHtml(tx.error)}</div>` : ""}
      </li>`;
      tx.fresh = false;
      return html;
    })
    .join("");
}

/** 屏幕角落的浮动通知，会自动消失。 */
function toast(kind, title, message) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  const box = $("toasts");
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  }, kind === "bad" ? 7000 : 4500);
}

/** 发送交易并跟踪状态（签名 → 等待打包 → 已确认/失败），同步更新界面。 */
async function sendTx(entry, send) {
  updateTx(entry, { status: "signing" });
  const tx = await send();
  updateTx(entry, { status: "pending", hash: tx.hash });
  const receipt = await tx.wait();
  updateTx(entry, {
    status: receipt.status === 1 ? "confirmed" : "failed",
    block: receipt.blockNumber,
    gas: receipt.gasUsed,
  });
  await refresh();
}

async function onSubmitBlock(event) {
  event.preventDefault();
  const payload = { de: $("fDe").value.trim(), para: $("fPara").value.trim(), valor: Number($("fValor").value) };
  const data = JSON.stringify(payload);
  const skipPow = $("fSkipPow").checked;
  const entry = addTx(`新增区块：${payload.de} → ${payload.para}：${payload.valor}`, { mines: !skipPow });
  $("btnSend").disabled = true;

  try {
    const miner = await state.signer.getAddress();
    const [index, prevHash, difficulty] = await Promise.all([
      state.contract.totalBlocks(),
      state.contract.lastHash(),
      state.contract.difficulty(),
    ]);
    let nonce = 0;
    if (skipPow) {
      updateTx(entry, { detail: "未挖矿：nonce 为 0" });
    } else {
      updateTx(entry, { status: "mining", detail: `正在寻找以 ${difficulty} 个 0 开头的哈希…` });
      const mined = await mineWithUi({ index, prevHash, miner, data, difficulty: Number(difficulty) });
      nonce = mined.nonce;
      updateTx(entry, {
        detail: `挖矿成功：nonce ${fmtInt(mined.nonce)}，共尝试 ${fmtInt(mined.tries)} 次（耗时 ${(mined.ms / 1000).toFixed(2)} 秒）`,
      });
    }
    await sendTx(entry, () => state.contract.addBlock(data, nonce));
  } catch (err) {
    const cancelled = err.message === "挖矿已取消";
    updateTx(entry, { status: cancelled ? "cancelled" : "failed", error: friendlyError(err) });
  } finally {
    $("btnSend").disabled = !state.contract;
    $("btnCancel").hidden = true;
  }
}

async function mineWithUi(params) {
  const box = $("miningBox");
  box.hidden = false;
  box.classList.remove("done");
  $("miningTitle").textContent = `正在挖区块 #${params.index}（难度 ${params.difficulty}）…`;
  $("miningNonce").textContent = "-";
  $("miningHash").textContent = "";
  $("miningBar").style.width = "0%";
  $("btnCancel").hidden = false;
  state.miningAbort = new AbortController();
  // 平均需要 16^d 次尝试；进度条按"已找到的概率"(1 - e^(-t/期望值))显示
  const expected = 16 ** params.difficulty;

  const mined = await pow.mine({
    ...params,
    signal: state.miningAbort.signal,
    onProgress: ({ tries, ms }) => {
      $("miningTries").textContent = `${fmtInt(tries)} / 约 ${fmtInt(expected)}`;
      $("miningRate").textContent = ms ? `${fmtInt(Math.round((tries / ms) * 1000))} 哈希/秒` : "-";
      $("miningBar").style.width = `${Math.round((1 - Math.exp(-tries / expected)) * 100)}%`;
    },
  }).catch((err) => {
    box.hidden = true;
    throw err;
  });

  box.classList.add("done");
  $("miningBar").style.width = "100%";
  $("miningTitle").textContent = "区块挖矿成功！";
  $("miningTries").textContent = fmtInt(mined.tries);
  $("miningRate").textContent = mined.ms ? `${fmtInt(Math.round((mined.tries / mined.ms) * 1000))} 哈希/秒` : "-";
  $("miningNonce").textContent = fmtInt(mined.nonce);
  $("miningHash").innerHTML = hashHtml(mined.hash);
  return mined;
}

async function onSubmitDifficulty(event) {
  event.preventDefault();
  const value = Number($("fDifficulty").value);
  const entry = addTx(`setDifficulty(${value})`, { mines: false, skipLabel: "无需挖矿" });
  try {
    await sendTx(entry, () => state.contract.setDifficulty(value));
  } catch (err) {
    updateTx(entry, { status: "failed", error: friendlyError(err) });
  }
}

// ---------- 初始化 ----------

function onChainClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === "edit") {
    state.editing = index;
    if (state.tamper && state.tamper.index !== index) state.tamper = null;
    renderChain(); // 不滚动：模拟打开时链条静止
    renderTamperReport();
    showBlock(index);
    $("tamperInput").focus({ preventScroll: true });
  } else if (button.dataset.action === "recalc") {
    simulateTamper(index, $("tamperInput").value).catch((err) =>
      showBanner("error", "模拟出错：" + escapeHtml(friendlyError(err)))
    );
  } else if (button.dataset.action === "show") {
    showBlock(index);
  } else if (button.dataset.action === "undo") {
    state.editing = null;
    state.tamper = null;
    renderChain();
    renderTamperReport();
  }
}

async function init() {
  $("btnRpc").addEventListener("click", connectRpc);
  $("btnMetaMask").addEventListener("click", connectMetaMask);
  $("btnRefresh").addEventListener("click", refresh);
  $("accountSelect").addEventListener("change", (e) => selectAccount(Number(e.target.value)));
  $("txForm").addEventListener("submit", onSubmitBlock);
  $("diffForm").addEventListener("submit", onSubmitDifficulty);
  $("btnCancel").addEventListener("click", () => state.miningAbort && state.miningAbort.abort());
  $("chain").addEventListener("click", onChainClick);
  $("tamperReport").addEventListener("click", onChainClick); // 报告中的"查看区块"和"撤销模拟"按钮
  setupMarquee();

  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", () => state.mode === "metamask" && connectMetaMask());
    window.ethereum.on("chainChanged", () => state.mode === "metamask" && connectMetaMask());
  }

  try {
    const res = await fetch("contract.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    state.config = await res.json();
  } catch {
    setBadge("缺少合约", "bad");
    showBanner(
      "error",
      "未找到 <code>contract.json</code> 文件：合约尚未部署。请运行 <code>启动.bat</code>（或执行 <code>npm start</code>）。"
    );
    return;
  }
  // 默认通过 Hardhat 本地连接，除非用户已经选择了 MetaMask
  if (!state.mode) await connectRpc();
}

init();
