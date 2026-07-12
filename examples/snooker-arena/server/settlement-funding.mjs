const SOMPI_PER_KAS = 100_000_000n;

// The reviewed runner requires a fee UTXO strictly larger than
// 1,500,000 sompi network fee + 100,000 sompi safety/change reserve.
export const MINIMUM_SETTLEMENT_UTXO_SOMPI = 1_600_001n;

function sompiToKas(value) {
  return Number(value) / Number(SOMPI_PER_KAS);
}

function plainUtxoAmount(item) {
  const entry = item?.utxoEntry || item?.utxo_entry || {};
  const covenantId = entry.covenantId ?? entry.covenant_id ?? null;
  if (covenantId) return 0n;
  try {
    return BigInt(entry.amount ?? item?.amount ?? 0);
  } catch {
    return 0n;
  }
}

export class SettlementFundingMonitor {
  constructor(options = {}) {
    this.address = String(options.address || "");
    this.restApi = String(options.restApi || "").replace(/\/$/, "");
    this.fetch = options.fetch || globalThis.fetch;
    this.cacheMs = Math.max(1_000, Number(options.cacheMs) || 15_000);
    this.minimumUtxoSompi = BigInt(options.minimumUtxoSompi || MINIMUM_SETTLEMENT_UTXO_SOMPI);
    this.cached = null;
    this.pending = null;
  }

  async status(options = {}) {
    const now = Date.now();
    if (!options.force && this.cached && now - this.cached.checkedAtMs < this.cacheMs) return this.publicStatus(this.cached);
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }

  async refresh() {
    const checkedAtMs = Date.now();
    try {
      if (!this.address || !this.restApi || typeof this.fetch !== "function") throw new Error("Funding monitor is not configured");
      const response = await this.fetch(`${this.restApi}/addresses/${this.address}/utxos`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`Kaspa REST returned HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("Kaspa REST returned an invalid UTXO response");
      const amounts = payload.map(plainUtxoAmount);
      const totalSompi = amounts.reduce((sum, amount) => sum + amount, 0n);
      const largestUtxoSompi = amounts.reduce((largest, amount) => amount > largest ? amount : largest, 0n);
      this.cached = {
        ready: largestUtxoSompi >= this.minimumUtxoSompi,
        code: largestUtxoSompi >= this.minimumUtxoSompi ? "READY" : "VERIFIER_FUNDING_REQUIRED",
        totalSompi,
        largestUtxoSompi,
        checkedAtMs
      };
    } catch {
      this.cached = {
        ready: false,
        code: "VERIFIER_BALANCE_UNAVAILABLE",
        totalSompi: 0n,
        largestUtxoSompi: 0n,
        checkedAtMs
      };
    }
    return this.publicStatus(this.cached);
  }

  publicStatus(status = this.cached) {
    const value = status || {
      ready: false,
      code: "VERIFIER_BALANCE_NOT_CHECKED",
      totalSompi: 0n,
      largestUtxoSompi: 0n,
      checkedAtMs: 0
    };
    return {
      ready: value.ready,
      code: value.code,
      address: this.address,
      balanceKas: sompiToKas(value.totalSompi),
      largestUtxoKas: sompiToKas(value.largestUtxoSompi),
      minimumUtxoKas: sompiToKas(this.minimumUtxoSompi),
      checkedAt: value.checkedAtMs ? new Date(value.checkedAtMs).toISOString() : ""
    };
  }
}
