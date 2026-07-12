import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const kaspa = require("@kluster/kaspa-wasm");
const SOMPI_PER_KAS = 100_000_000n;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export class FaucetService {
  constructor({ dataDir, networkId = "testnet-10", restApi = "https://api-tn10.kaspa.org" }) {
    this.networkId = networkId;
    this.restApi = restApi.replace(/\/$/, "");
    this.walletFile = path.join(dataDir, "faucet-wallet.json");
    this.claimsFile = path.join(dataDir, "faucet-claims.json");
    this.wallet = this.ensureWallet();
  }

  ensureWallet() {
    const existing = readJson(this.walletFile, null);
    if (existing?.privateKey && existing?.address) return existing;
    const keypair = kaspa.Keypair.random();
    const wallet = {
      networkId: this.networkId,
      address: keypair.toAddress(this.networkId).toString(),
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      createdAt: new Date().toISOString()
    };
    writeJson(this.walletFile, wallet);
    return wallet;
  }

  publicInfo() {
    return {
      address: this.wallet.address,
      networkId: this.networkId,
      maxPerClaim: 200,
      maxPerDay: 2000
    };
  }

  claims() {
    return readJson(this.claimsFile, { claims: [] });
  }

  dailyClaimed(address) {
    const day = utcDay();
    return this.claims().claims
      .filter((claim) => claim.address === address && claim.day === day && claim.status !== "failed")
      .reduce((sum, claim) => sum + Number(claim.amountKas || 0), 0);
  }

  validateClaim(address, amountKas) {
    if (!kaspa.Address.validate(address) || !address.startsWith("kaspatest:")) throw new Error("请输入有效的 TN10 kaspatest 地址");
    const amount = Number(amountKas);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 200) throw new Error("单次领取数量必须在 1–200 TKAS 之间");
    const claimed = this.dailyClaimed(address);
    if (claimed + amount > 2000) throw new Error(`该地址今日已领取 ${claimed} TKAS，每日上限为 2000 TKAS`);
    return amount;
  }

  async fetchUtxos() {
    const response = await fetch(`${this.restApi}/addresses/${encodeURIComponent(this.wallet.address)}/utxos`);
    if (!response.ok) throw new Error(`TN10 UTXO 查询失败：HTTP ${response.status}`);
    const items = await response.json();
    return items.map((item) => ({
      address: this.wallet.address,
      outpoint: {
        transactionId: item.outpoint?.transactionId || item.transactionId,
        index: Number(item.outpoint?.index ?? item.index ?? 0)
      },
      amount: BigInt(item.utxoEntry?.amount || item.amount || 0),
      scriptPublicKey: {
        version: Number(item.utxoEntry?.scriptPublicKey?.version || item.scriptPublicKey?.version || 0),
        script: item.utxoEntry?.scriptPublicKey?.scriptPublicKey || item.utxoEntry?.scriptPublicKey?.script || item.scriptPublicKey?.scriptPublicKey || item.scriptPublicKey?.script
      },
      blockDaaScore: BigInt(item.utxoEntry?.blockDaaScore || item.blockDaaScore || 0),
      isCoinbase: Boolean(item.utxoEntry?.isCoinbase || item.isCoinbase)
    })).filter((item) => item.outpoint.transactionId && item.scriptPublicKey.script && !item.isCoinbase);
  }

  async balanceKas() {
    const utxos = await this.fetchUtxos();
    const sompi = utxos.reduce((sum, item) => sum + item.amount, 0n);
    return Number(sompi) / Number(SOMPI_PER_KAS);
  }

  async send(address, amountKas) {
    const utxos = await this.fetchUtxos();
    const amount = BigInt(Math.round(amountKas * Number(SOMPI_PER_KAS)));
    const balance = utxos.reduce((sum, item) => sum + item.amount, 0n);
    if (balance < amount + 10_000n) throw new Error("测试币水龙头余额不足，请稍后再试");
    const { transactions } = await kaspa.createTransactions({
      outputs: [{ address, amount }],
      changeAddress: this.wallet.address,
      priorityFee: 0n,
      entries: utxos,
      networkId: this.networkId
    });
    const privateKey = new kaspa.PrivateKey(this.wallet.privateKey);
    const rpc = new kaspa.RpcClient({ resolver: new kaspa.Resolver(), networkId: this.networkId });
    await rpc.connect();
    const txids = [];
    try {
      for (const pending of transactions) {
        pending.sign([privateKey], true);
        txids.push(await pending.submit(rpc));
      }
    } finally {
      try { await rpc.disconnect?.(); } catch {}
      try { await rpc.stop?.(); } catch {}
    }
    return txids;
  }

  async claim(address, requestedAmount = 200) {
    const amountKas = this.validateClaim(address, requestedAmount);
    const store = this.claims();
    const claim = {
      id: `FAUCET-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      address,
      amountKas,
      day: utcDay(),
      status: "sending",
      createdAt: new Date().toISOString(),
      txids: []
    };
    store.claims.push(claim);
    writeJson(this.claimsFile, store);
    try {
      claim.txids = await this.send(address, amountKas);
      claim.status = "sent";
      claim.sentAt = new Date().toISOString();
      writeJson(this.claimsFile, store);
      return claim;
    } catch (error) {
      claim.status = "failed";
      claim.error = error.message || String(error);
      writeJson(this.claimsFile, store);
      throw error;
    }
  }
}
