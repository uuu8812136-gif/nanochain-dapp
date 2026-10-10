/**
 * 一条命令完成全部启动：启动 Hardhat 本地区块链、部署合约、
 * 启动网页界面并打开浏览器。按 Ctrl+C 关闭全部服务。
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { start: startFrontend } = require("../server");

const ROOT = path.join(__dirname, "..");
const RPC_URL = "http://127.0.0.1:8545";
const FRONTEND_URL = "http://localhost:3000";

async function rpcReady() {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill("SIGINT");
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  let node = null;
  if (await rpcReady()) {
    console.log("Hardhat 网络已在运行：" + RPC_URL);
  } else {
    console.log("正在启动 Hardhat 本地区块链（日志见 hardhat-node.log）…");
    const log = fs.openSync(path.join(ROOT, "hardhat-node.log"), "w");
    node = spawn("npx hardhat node", { cwd: ROOT, shell: true, stdio: ["ignore", log, log] });
    if (!(await waitFor(rpcReady, 60000))) {
      stop(node);
      throw new Error("Hardhat 网络在 60 秒内没有响应，请查看 hardhat-node.log。");
    }
  }

  const shutdown = () => {
    stop(node);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("正在部署合约…");
  const deploy = spawnSync("npx hardhat run scripts/deploy.js --network localhost", {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
  });
  if (deploy.status !== 0) {
    stop(node);
    throw new Error("合约部署失败。");
  }

  await startFrontend(3000);
  openBrowser(FRONTEND_URL);
  console.log("\n全部就绪。请保持本窗口运行；按 Ctrl+C 可关闭区块链与网页界面。");
}

main().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
