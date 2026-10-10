// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NanoChain 迷你区块链核心合约
 * @notice 一条用智能合约实现的迷你区块链。
 *
 * 每个区块保存数据、前一个区块的哈希（链与链之间的连接）和一个 nonce。
 * 添加区块的人必须先在链下“挖矿”：找到一个 nonce，使得
 * keccak256(index, prevHash, miner, data, nonce) 以 `difficulty` 个
 * 十六进制的 0 开头。合约只负责校验工作量证明，这部分操作成本很低。
 *
 * 合约中不存在任何编辑区块的函数，已上链的数据无法被篡改。
 */
contract MiniBlockchain {
    struct Block {
        uint256 index;
        uint256 timestamp; // 打包该交易的以太坊区块时间戳
        string data; // 自由文本；界面使用 JSON {"de","para","valor"}
        bytes32 prevHash;
        uint256 nonce;
        bytes32 hash;
        address miner;
        uint8 difficulty; // 该区块被挖出时要求的难度
    }

    uint8 public constant MAX_DIFFICULTY = 6;
    uint256 public constant MAX_DATA_LENGTH = 1024;

    address public immutable owner;
    uint8 public difficulty;
    Block[] private chain;

    event BlockMined(
        uint256 indexed index,
        bytes32 hash,
        address indexed miner,
        uint256 nonce,
        string data
    );
    event DifficultyChanged(uint8 previous, uint8 current);

    modifier onlyOwner() {
        require(msg.sender == owner, unicode"只有合约所有者才能执行此操作");
        _;
    }

    constructor(uint8 initialDifficulty) {
        require(initialDifficulty <= MAX_DIFFICULTY, unicode"难度超过最大值");
        owner = msg.sender;
        difficulty = initialDifficulty;

        // 创世块：作为链的起点，不需要通过工作量证明校验。
        string memory genesisData = unicode"创世区块";
        bytes32 genesisHash = computeHash(0, bytes32(0), msg.sender, genesisData, 0);
        chain.push(Block(0, block.timestamp, genesisData, bytes32(0), 0, genesisHash, msg.sender, 0));
        emit BlockMined(0, genesisHash, msg.sender, 0, genesisData);
    }

    // ---------- 写入 ----------

    /// @notice 添加一个区块。`nonce` 必须是针对下一个索引挖出来的。
    function addBlock(string calldata data, uint256 nonce) external returns (bytes32) {
        require(bytes(data).length > 0, unicode"区块数据不能为空");
        require(bytes(data).length <= MAX_DATA_LENGTH, unicode"数据过大（最大 1024 字节）");

        uint256 index = chain.length;
        bytes32 prevHash = chain[index - 1].hash;
        bytes32 h = computeHash(index, prevHash, msg.sender, data, nonce);
        require(
            meetsDifficulty(h, difficulty),
            unicode"工作量证明无效：哈希值没有以足够数量的 0 开头"
        );

        chain.push(Block(index, block.timestamp, data, prevHash, nonce, h, msg.sender, difficulty));
        emit BlockMined(index, h, msg.sender, nonce, data);
        return h;
    }

    function setDifficulty(uint8 newDifficulty) external onlyOwner {
        require(newDifficulty <= MAX_DIFFICULTY, unicode"难度超过最大值");
        emit DifficultyChanged(difficulty, newDifficulty);
        difficulty = newDifficulty;
    }

    // ---------- 读取 ----------

    function totalBlocks() external view returns (uint256) {
        return chain.length;
    }

    function lastHash() external view returns (bytes32) {
        return chain[chain.length - 1].hash;
    }

    function getBlock(uint256 index) external view returns (Block memory) {
        require(index < chain.length, unicode"区块不存在");
        return chain[index];
    }

    function getChain() external view returns (Block[] memory) {
        return chain;
    }

    /// @notice 校验整条链的完整性：区块哈希、链节和工作量证明。
    /// @return valid 链是否完整；badIndex 第一个无效区块；reason 原因说明。
    function isValid() external view returns (bool valid, uint256 badIndex, string memory reason) {
        for (uint256 i = 1; i < chain.length; i++) {
            Block storage cur = chain[i];
            Block storage prev = chain[i - 1];
            if (cur.hash != computeHash(cur.index, cur.prevHash, cur.miner, cur.data, cur.nonce)) {
                return (false, i, unicode"区块内容与哈希不再匹配");
            }
            if (cur.prevHash != prev.hash) {
                return (false, i, unicode"与前一区块的链接已断裂");
            }
            if (!meetsDifficulty(cur.hash, cur.difficulty)) {
                return (false, i, unicode"缺少工作量证明");
            }
        }
        return (true, 0, unicode"链完整有效");
    }

    /// @notice 矿工地址参与哈希计算，这样就没有人能盗用别人挖出的 nonce。
    function computeHash(
        uint256 index,
        bytes32 prevHash,
        address miner,
        string memory data,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(index, prevHash, miner, data, nonce));
    }

    /// @notice 哈希是否以 `zeros` 个十六进制的 0 开头。
    function meetsDifficulty(bytes32 h, uint8 zeros) public pure returns (bool) {
        if (zeros == 0) return true;
        return uint256(h) >> (256 - 4 * uint256(zeros)) == 0;
    }
}
