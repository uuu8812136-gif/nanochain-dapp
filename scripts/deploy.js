/**
 * 在本地网络上部署 NanoChain 合约，写入两笔示例交易，
 * 并把（地址 + ABI）写入 frontend/contract.json 供前端界面使用。
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const createPoW = require("../frontend/pow.js");

const DIFFICULTY = 4;

async function main() {
  const { ethers } = hre;
  const pow = createPoW(ethers);
  const [owner, alice, bob] = await ethers.getSigners();

  const contract = await ethers.deployContract("MiniBlockchain", [DIFFICULTY]);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`NanoChain 合约已部署到 ${address}（所有者：${owner.address}）`);

  // 两个示例区块
  const seed = [
    [alice, { de: "Alice", para: "Bob", valor: 50 }],
    [bob, { de: "Bob", para: "Carol", valor: 20 }],
  ];
  for (const [signer, payload] of seed) {
    const data = JSON.stringify(payload);
    const index = await contract.totalBlocks();
    const prevHash = await contract.lastHash();
    const mined = await pow.mine({ index, prevHash, miner: signer.address, data, difficulty: DIFFICULTY });
    await (await contract.connect(signer).addBlock(data, mined.nonce)).wait();
    console.log(`  区块 #${index} 挖矿成功：nonce=${mined.nonce}（尝试 ${mined.tries} 次，耗时 ${mined.ms} 毫秒）`);
  }

  const [valid, , reason] = await contract.isValid();
  console.log(`  isValid()：${valid}（${reason}）`);

  const artifact = await hre.artifacts.readArtifact("MiniBlockchain");
  const { chainId } = await ethers.provider.getNetwork();
  const config = { address, chainId: Number(chainId), abi: artifact.abi, deployedAt: new Date().toISOString() };
  const out = path.join(__dirname, "..", "frontend", "contract.json");
  fs.writeFileSync(out, JSON.stringify(config, null, 2));
  console.log(`  前端合约配置已写入 ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
