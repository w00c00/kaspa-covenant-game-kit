"use strict";

const { CovenantIndexer, CovenantReader } = require("./covenant-interfaces");
const { resolveNetworkConfig } = require("./network");
const { isHex32 } = require("./utils");

function assertHexId(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!isHex32(normalized)) throw new Error(`${label} must be 32-byte hex`);
  return normalized;
}

class KascovHttpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "KascovHttpError";
    this.status = Number(options.status || 0);
    this.url = options.url || "";
    this.payload = options.payload;
  }
}

class KascovIndexerAdapter extends CovenantIndexer {
  constructor(options = {}) {
    super();
    this.network = options.network?.kaspaNetworkId ? options.network : resolveNetworkConfig(options);
    this.networkId = this.network.kascovNetworkId || this.network.kaspaNetworkId;
    this.baseUrl = String(options.baseUrl || this.network.kascovApiBase || "https://kascov.io").replace(/\/$/, "");
    this.fetch = options.fetch || globalThis.fetch;
    this.pollIntervalMs = Math.max(500, Number(options.pollIntervalMs || 3_000));
    if (typeof this.fetch !== "function") throw new Error("KascovIndexerAdapter requires fetch");
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...(options.headers || {}) },
      signal: options.signal
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) {
      throw new KascovHttpError(payload?.error || payload?.message || `Kascov HTTP ${response.status}`, {
        status: response.status,
        url,
        payload
      });
    }
    return payload;
  }

  getLive(options = {}) {
    return this.request(`/data/${encodeURIComponent(this.networkId)}-live.json`, options);
  }

  getCovenant(covenantId, options = {}) {
    const id = assertHexId(covenantId, "covenantId");
    return this.request(`/data/${encodeURIComponent(this.networkId)}/c/${id}.json`, options);
  }

  getTransaction(txid, options = {}) {
    const id = assertHexId(txid, "txid");
    return this.request(`/data/${encodeURIComponent(this.networkId)}/tx/${id}.json`, options);
  }

  getEvents(options = {}) {
    const params = new URLSearchParams();
    if (options.afterDaa !== undefined) params.set("after_daa", String(options.afterDaa));
    if (options.afterSeq !== undefined) params.set("after_seq", String(options.afterSeq));
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.size ? `?${params}` : "";
    return this.request(`/data/${encodeURIComponent(this.networkId)}/events${query}`, options);
  }

  async observeSettlement({ covenantId, txid, signal } = {}) {
    const covenant = await this.getCovenant(covenantId, { signal });
    const normalizedTxid = txid ? assertHexId(txid, "txid") : "";
    const events = Array.isArray(covenant.events) ? covenant.events : [];
    const event = normalizedTxid ? events.find((item) => item.txid === normalizedTxid) || null : events.at(-1) || null;
    return {
      source: "kascov",
      network: covenant.network || this.networkId,
      observed: normalizedTxid ? Boolean(event) : true,
      covenantId: covenant.covenant_id || covenantId,
      txid: normalizedTxid,
      event,
      status: covenant.status || "unknown",
      liveUtxos: Number(covenant.live_utxos || 0),
      lastActivityDaa: Number(covenant.last_activity_daa || 0),
      generatedAtMs: Number(covenant.generated_at_ms || 0)
    };
  }

  watchCovenant(covenantId, options = {}) {
    const id = assertHexId(covenantId, "covenantId");
    const controller = new AbortController();
    const intervalMs = Math.max(500, Number(options.intervalMs || this.pollIntervalMs));
    let stopped = false;
    let timer = null;
    let fingerprint = "";

    const poll = async () => {
      if (stopped) return;
      try {
        const value = await this.getCovenant(id, { signal: controller.signal });
        const next = `${value.last_activity_daa || ""}:${value.event_count || ""}:${value.status || ""}`;
        if (next !== fingerprint) {
          fingerprint = next;
          options.onChange?.(value);
        }
      } catch (error) {
        if (!stopped && error.name !== "AbortError") options.onError?.(error);
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, intervalMs);
          timer.unref?.();
        }
      }
    };

    if (options.immediate === false) timer = setTimeout(poll, intervalMs);
    else void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }
}

class KascovCovenantReader extends CovenantReader {
  constructor(options = {}) {
    super();
    this.indexer = options.indexer || new KascovIndexerAdapter(options);
  }

  async readCovenant(descriptor, options = {}) {
    const expectedId = assertHexId(descriptor?.covenantId, "descriptor.covenantId");
    const observed = await this.indexer.getCovenant(expectedId, options);
    if (observed.covenant_id !== expectedId) throw new Error("Kascov returned a different covenant identity");
    return { descriptor, observed, verifiedIdentity: true };
  }

  readTransaction(txid, options = {}) {
    return this.indexer.getTransaction(txid, options);
  }
}

module.exports = {
  KascovCovenantReader,
  KascovHttpError,
  KascovIndexerAdapter,
  assertHexId
};
