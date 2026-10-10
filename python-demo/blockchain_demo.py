"""
迷你区块链演示：哈希、篡改检测与工作量证明。
运行方式：python blockchain_demo.py（Python 3.8+，仅使用标准库）
"""
import hashlib
import json
import time


# ---------- 演示 1：区块及其哈希 ----------
class Block:
    def __init__(self, index, data, prev_hash, difficulty=0):
        self.index = index
        self.timestamp = time.time()
        self.data = data              # 任意可被 JSON 序列化的数据
        self.prev_hash = prev_hash    # 组成链条的连接
        self.nonce = 0                # 矿工在 PoW 中不断变换的数字
        self.hash = self.mine(difficulty) if difficulty else self.compute_hash()

    def compute_hash(self):
        """对所有字段做 SHA-256：改动一个字节就会得到完全不同的哈希。"""
        payload = json.dumps(
            [self.index, self.timestamp, self.data, self.prev_hash, self.nonce],
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    # ---------- 演示 3：工作量证明（PoW） ----------
    def mine(self, difficulty):
        """不断尝试 nonce，直到哈希以 `difficulty` 个 0 开头。"""
        target = "0" * difficulty
        while True:
            h = self.compute_hash()
            if h.startswith(target):
                return h
            self.nonce += 1


class Blockchain:
    def __init__(self, difficulty=3):
        self.difficulty = difficulty
        self.chain = [Block(0, "创世区块", "0" * 64, difficulty)]

    def add_block(self, data):
        prev = self.chain[-1]
        self.chain.append(Block(len(self.chain), data, prev.hash, self.difficulty))

    # ---------- 演示 2：完整性校验 ----------
    def is_valid(self):
        """校验每个区块的哈希、链节以及工作量证明。"""
        for i in range(1, len(self.chain)):
            cur, prev = self.chain[i], self.chain[i - 1]
            if cur.hash != cur.compute_hash():
                return False, f"区块 {i}：区块内容与哈希不再匹配"
            if cur.prev_hash != prev.hash:
                return False, f"区块 {i}：与区块 {i-1} 之间的链接已断裂"
            if not cur.hash.startswith("0" * self.difficulty):
                return False, f"区块 {i}：缺少工作量证明"
        return True, "链完整有效"


if __name__ == "__main__":
    # 演示 1：构建一条链
    bc = Blockchain(difficulty=4)
    t0 = time.time()
    bc.add_block({"de": "Alice", "para": "Bob", "valor": 50})
    bc.add_block({"de": "Bob", "para": "Carol", "valor": 20})
    print(f"挖出 2 个区块，耗时 {time.time() - t0:.2f} 秒（难度 4）")
    for b in bc.chain:
        print(f"#{b.index} nonce={b.nonce:<7} hash={b.hash[:16]}... 前一区块={b.prev_hash[:16]}...")
    print(bc.is_valid()[1], "\n")

    # 演示 2：篡改历史记录
    print("篡改演示：把 Alice 的付款金额从 50 改成 5000……")
    bc.chain[1].data["valor"] = 5000
    print(bc.is_valid()[1], "\n")

    # 攻击者修正哈希：但它不再满足工作量证明
    bc.chain[1].hash = bc.chain[1].compute_hash()
    print("攻击者重新计算了区块 1 的哈希（但没有重新做工作量证明）……")
    print(bc.is_valid()[1])

    # 演示 3：工作量证明的成本随难度增长
    print("\n工作量证明成本：")
    for d in range(1, 6):
        t = time.time()
        blk = Block(1, "demo", "0" * 64, d)
        print(f"  难度 {d}：尝试 {blk.nonce:>8} 次，耗时 {time.time() - t:.3f} 秒")
