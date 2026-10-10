require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // 内置本地测试网络：10 个账户，每个有 10,000 个测试 ETH（默认是 20 个）
    hardhat: { accounts: { count: 10 } },
    // 通过 `npx hardhat node` 启动的本地网络（chainId 31337）
    localhost: { url: "http://127.0.0.1:8545" },
  },
};
