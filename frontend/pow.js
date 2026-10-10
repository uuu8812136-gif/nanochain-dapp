/**
 * 与 MiniBlockchain.sol 完全一致的工作量证明实现。
 * 同时供前端界面（浏览器）和部署脚本（Node）使用。
 * 接收 ethers v6 库作为参数：createPoW(ethers)。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createPoW = factory;
})(typeof self !== "undefined" ? self : this, function createPoW(ethers) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  // 与合约中 abi.encode(index, prevHash, miner, data, nonce) 的参数顺序一致
  const TYPES = ["uint256", "bytes32", "address", "string", "uint256"];
  // abi.encode 的头部：5 个 32 字节的字；nonce 是第 5 个（偏移量 128）
  const NONCE_OFFSET = 128;

  function computeHash(index, prevHash, miner, data, nonce) {
    return ethers.keccak256(coder.encode(TYPES, [index, prevHash, miner, data, nonce]));
  }

  function meetsDifficulty(hash, difficulty) {
    return hash.startsWith("0".repeat(Number(difficulty)), 2);
  }

  // 只在一个字的最后 8 个字节中写入 nonce（足够支持到 2^53）
  function writeNonce(bytes, nonce) {
    let n = nonce;
    for (let i = NONCE_OFFSET + 31; i >= NONCE_OFFSET + 24; i--) {
      bytes[i] = n % 256;
      n = Math.floor(n / 256);
    }
  }

  /**
   * 寻找使哈希以 `difficulty` 个 0 开头的 nonce。
   * 数据只编码一次，每次尝试只替换 nonce 对应的字节。
   */
  async function mine({ index, prevHash, miner, data, difficulty, batchSize = 4000, onProgress, signal }) {
    const bytes = ethers.getBytes(coder.encode(TYPES, [index, prevHash, miner, data, 0]));
    const target = "0".repeat(Number(difficulty));
    const started = Date.now();
    let nonce = 0;
    for (;;) {
      for (let i = 0; i < batchSize; i++, nonce++) {
        writeNonce(bytes, nonce);
        const hash = ethers.keccak256(bytes);
        if (hash.startsWith(target, 2)) {
          return { nonce, hash, tries: nonce + 1, ms: Date.now() - started };
        }
      }
      if (signal && signal.aborted) throw new Error("挖矿已取消");
      if (onProgress) onProgress({ tries: nonce, ms: Date.now() - started });
      await new Promise((resolve) => setTimeout(resolve, 0)); // 把控制权交还给界面，避免页面卡死
    }
  }

  return { computeHash, meetsDifficulty, mine };
});
