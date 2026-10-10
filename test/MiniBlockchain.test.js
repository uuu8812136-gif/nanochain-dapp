const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const createPoW = require("../frontend/pow.js");

const pow = createPoW(ethers);
const DIFFICULTY = 3;

describe("MiniBlockchain", function () {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const contract = await ethers.deployContract("MiniBlockchain", [DIFFICULTY]);
    return { contract, owner, alice, bob };
  }

  async function mineFor(contract, signer, data) {
    const index = await contract.totalBlocks();
    const prevHash = await contract.lastHash();
    const difficulty = await contract.difficulty();
    return pow.mine({ index, prevHash, miner: signer.address, data, difficulty });
  }

  it("创建创世块", async function () {
    const { contract, owner } = await loadFixture(deploy);
    expect(await contract.totalBlocks()).to.equal(1n);
    const genesis = await contract.getBlock(0);
    expect(genesis.data).to.equal("创世区块");
    expect(genesis.prevHash).to.equal(ethers.ZeroHash);
    expect(await contract.owner()).to.equal(owner.address);
  });

  it("JavaScript 与合约计算出的哈希完全一致", async function () {
    const { contract, alice } = await loadFixture(deploy);
    const args = [5n, ethers.id("x"), alice.address, '{"valor":50}', 123n];
    expect(pow.computeHash(...args)).to.equal(await contract.computeHash(...args));
  });

  it("接受带有效工作量证明的区块并将其链接到链上", async function () {
    const { contract, alice } = await loadFixture(deploy);
    const data = JSON.stringify({ de: "Alice", para: "Bob", valor: 50 });
    const prevHash = await contract.lastHash();
    const { nonce, hash } = await mineFor(contract, alice, data);

    await expect(contract.connect(alice).addBlock(data, nonce))
      .to.emit(contract, "BlockMined")
      .withArgs(1n, hash, alice.address, nonce, data);

    const block = await contract.getBlock(1);
    expect(block.prevHash).to.equal(prevHash);
    expect(block.hash).to.equal(hash);
    expect(block.miner).to.equal(alice.address);
    expect(hash.slice(2, 2 + DIFFICULTY)).to.equal("0".repeat(DIFFICULTY));
    const [valid, , reason] = await contract.isValid();
    expect(valid).to.equal(true);
    expect(reason).to.equal("链完整有效");
  });

  it("拒绝没有工作量证明的区块", async function () {
    const { contract, alice } = await loadFixture(deploy);
    const data = "未挖矿的区块数据";
    const index = await contract.totalBlocks();
    const prevHash = await contract.lastHash();
    // 寻找一个不满足难度要求的 nonce
    let nonce = 0;
    while (pow.meetsDifficulty(pow.computeHash(index, prevHash, alice.address, data, nonce), DIFFICULTY)) nonce++;
    await expect(contract.connect(alice).addBlock(data, nonce)).to.be.revertedWith(
      "工作量证明无效：哈希值没有以足够数量的 0 开头"
    );
  });

  it("一个账户挖出的 nonce 对另一个账户无效", async function () {
    const { contract, alice, bob } = await loadFixture(deploy);
    const data = "盗用 nonce";
    const { nonce } = await mineFor(contract, alice, data);
    // Bob 的哈希也恰好满足难度的概率为 16^3 分之一；测试直接按真实结果判断
    const index = await contract.totalBlocks();
    const bobHash = pow.computeHash(index, await contract.lastHash(), bob.address, data, nonce);
    if (!pow.meetsDifficulty(bobHash, DIFFICULTY)) {
      await expect(contract.connect(bob).addBlock(data, nonce)).to.be.reverted;
    }
  });

  it("拒绝空数据", async function () {
    const { contract, alice } = await loadFixture(deploy);
    await expect(contract.connect(alice).addBlock("", 0)).to.be.revertedWith(
      "区块数据不能为空"
    );
  });

  it("只有所有者可以调整难度，且不能超过最大值", async function () {
    const { contract, owner, alice } = await loadFixture(deploy);
    await expect(contract.connect(alice).setDifficulty(1)).to.be.revertedWith(
      "只有合约所有者才能执行此操作"
    );
    await expect(contract.connect(owner).setDifficulty(7)).to.be.revertedWith("难度超过最大值");
    await expect(contract.connect(owner).setDifficulty(2))
      .to.emit(contract, "DifficultyChanged")
      .withArgs(DIFFICULTY, 2);
    expect(await contract.difficulty()).to.equal(2n);
  });

  it("每个区块保存当时的难度，调整难度后旧区块仍然有效", async function () {
    const { contract, owner, alice } = await loadFixture(deploy);
    const first = await mineFor(contract, alice, "a");
    await contract.connect(alice).addBlock("a", first.nonce);
    await contract.connect(owner).setDifficulty(4);
    const second = await mineFor(contract, alice, "b");
    await contract.connect(alice).addBlock("b", second.nonce);

    expect((await contract.getBlock(1)).difficulty).to.equal(3n);
    expect((await contract.getBlock(2)).difficulty).to.equal(4n);
    expect((await contract.getChain()).length).to.equal(3);
    expect((await contract.isValid())[0]).to.equal(true);
  });
});
