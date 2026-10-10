# NanoChain 迷你区块链 DApp

一个运行在 **Hardhat 本地区块链**上的去中心化应用（DApp）：用 Solidity 智能合约实现一条迷你区块链，配一个可交互的中文 Web 界面，能完整演示**哈希串联、工作量证明（PoW）挖矿、链完整性校验和防篡改**。

## 项目能做什么

- 每个区块保存交易数据、前一个区块的哈希、nonce 和矿工地址，区块首尾相连形成链条；
- 在浏览器端完成工作量证明挖矿（寻找满足前导零个数的 nonce），再把交易发送给合约；
- 合约只做校验：PoW 不合法、数据为空、越权操作等交易一律回滚（revert）；
- 页面实时显示区块总数、挖矿难度、链完整性校验结果和最新哈希；
- 提供「模拟篡改」功能：只改页面上的数据并重算哈希，可以直观看到哈希失配、PoW 失效、与下一区块的链节断裂——而链上数据毫发无损；
- 支持两种连接方式：**Hardhat 本地直连**（无需钱包，10 个预置测试账户）和 **MetaMask** 钱包连接。

## 技术栈

| 层 | 技术 |
|---|---|
| 智能合约 | Solidity ^0.8.28（Hardhat 编译，keccak256、PoW 校验、事件、权限修饰器） |
| 本地区块链 | Hardhat（chainId 31337，预置 10 个测试账户，每个 10,000 测试 ETH） |
| 前端 | 原生 HTML / CSS / JavaScript + ethers.js v6（无框架，零构建） |
| 测试 | Mocha + Chai（8 个用例，覆盖正常流程与所有回滚分支） |
| 其他 | Node.js 内置 http 模块写的极简静态服务器，无需任何额外后端 |

## 如何运行

前置要求：[Node.js](https://nodejs.org) 18 或更高版本。

**Windows 最简单的方式：** 双击 **`启动.bat`**。第一次运行会自动安装依赖，随后自动完成：

1. 在 `http://127.0.0.1:8545` 启动 Hardhat 本地区块链（chainId 31337）；
2. 部署合约并写入两笔示例交易（Alice → Bob：50，Bob → Carol：20）；
3. 自动打开浏览器访问 `http://localhost:3000`。

保持窗口开启即可使用；关闭窗口或按 Ctrl+C 停止全部服务。

**任意系统用命令行：**

```bash
npm install
npm start
```

也可以分三步，在不同终端中分别执行：

```bash
npx hardhat node                                      # 1. 启动本地区块链
npx hardhat run scripts/deploy.js --network localhost # 2. 部署合约
node server.js                                        # 3. 启动前端界面
```

**运行合约自动化测试：**

```bash
npm test
```

## 界面功能一览

| 区域 | 功能 | 对应合约方法 |
|---|---|---|
| 连接方式（右上角） | **Hardhat 本地**直连节点、无需钱包；**MetaMask** 通过钱包连接并自动切换到 Hardhat 网络 | — |
| 当前账户（顶部） | 切换用哪个测试账户签名，并显示余额 | — |
| 状态面板 | 区块总数、难度、链完整性（来自 `isValid()`）、最新哈希，出块后自动刷新 | `totalBlocks`、`difficulty`、`isValid`、`getChain`（读） |
| 区块链条 | 区块横向排列，通过「前一区块哈希」连接；悬停暂停滚动 | `getChain`（读） |
| 发起新交易 | 浏览器先挖矿（实时进度条、尝试次数、算力、nonce），再发送上链 | `addBlock`（写） |
| 交易记录 | 每笔交易经历：挖矿 → 签名 → 等待打包 → 已确认 / 失败，含交易哈希、区块号、gas | — |
| 「不挖矿直接发送」 | 用 nonce 0 直接发送，观察合约因 PoW 无效而回滚 | `addBlock`（revert） |
| 难度调整 | 只有合约所有者（#0 账户）可以调用，其他账户的按钮禁用 | `setDifficulty`（仅所有者） |
| 模拟篡改 | 仅修改页面数据并用 `computeHash()` 重算哈希，展示哈希失配、PoW 缺失、链节断裂；链完整性仍为「完整有效」 | `computeHash`（pure） |

### 使用 MetaMask（可选）

1. 在 MetaMask 中选择「添加账户 → 导入账户」，粘贴 `hardhat-node.log` 顶部 **Account #0**（合约所有者）的私钥。这些是 Hardhat 公开的测试私钥，**切勿在真实网络中使用**；
2. 点击界面上的 **MetaMask**，按提示添加或切换到「Hardhat Local」网络（chainId 31337）；
3. 如果重启 Hardhat 后 MetaMask 报 nonce 错误，在「设置 → 高级 → 清除活动标签页数据」中重置即可。

## 从 Python 演示版到 Solidity 合约

`python-demo/blockchain_demo.py` 是纯 Python 的教学版迷你区块链（仅用标准库，`python python-demo/blockchain_demo.py` 即可运行），智能合约是它的链上版本：

| Python 版本 | Solidity 版本 |
|---|---|
| `Block.compute_hash()`，SHA-256 | `computeHash()`，对 `(index, prevHash, miner, data, nonce)` 做 keccak256 |
| `Block.mine()` 寻找 nonce | 由**前端**挖矿（`frontend/pow.js`），合约只用 `meetsDifficulty()` 校验 |
| `Blockchain.add_block()` | `addBlock(data, nonce)`，拒绝没有合法 PoW 的区块 |
| `Blockchain.is_valid()` | `isValid()`，同样三项校验并返回中文原因 |
| Python 版可以直接改链上某笔交易的金额 | **不可能**：合约中没有编辑区块的函数，数据上链即不可改 |

几个关键设计决策：

- **矿工地址参与哈希计算**：防止某账户把别人挖出的 nonce 拿来冒充自己的工作量；
- **时间戳不参与哈希**：矿工无法预知交易被打包进哪个以太坊区块，时间直接取自 `block.timestamp`；
- **每个区块保存当时的难度**：调整全局难度不会让历史区块失效。

## 目录结构

```
contracts/MiniBlockchain.sol    智能合约
scripts/deploy.js               部署脚本 + 示例区块 + 生成 frontend/contract.json
scripts/start.js                一条命令启动区块链、部署和前端
test/MiniBlockchain.test.js     8 个自动化测试（Mocha + Chai）
frontend/index.html, style.css  Web 界面
frontend/app.js                 连接（ethers v6）、读取、写入与交易状态管理
frontend/pow.js                 工作量证明挖矿（浏览器和部署脚本共用）
server.js                       前端静态服务器（零第三方依赖）
python-demo/blockchain_demo.py  Python 教学版迷你区块链
启动.bat                         Windows 一键启动
```

## 常见问题

- **显示「网络未启动」**：Hardhat 区块链没有运行，双击 `启动.bat` 或执行 `npm start`。
- **显示「未找到合约」**：本地区块链被重启后状态会清空（数据只在内存中），重新部署一次并刷新页面即可，`启动.bat` 会自动完成部署。
- **3000 或 8545 端口被占用**：关闭其他正在运行本项目的窗口。

## 许可

MIT，详见 [LICENSE](LICENSE)。
