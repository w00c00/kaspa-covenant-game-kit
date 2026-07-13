"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { nowIso } = require("./utils");

const LOCK_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));
const WRITE_LOCK_TIMEOUT_MS = 5_000;
const STALE_WRITE_LOCK_MS = 30_000;

class JsonStore {
  constructor(file) {
    this.file = file;
    this.state = {
      escrows: [],
      settlements: [],
      updatedAt: ""
    };
    if (file) this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.state.escrows = parsed.escrows || parsed.covenantEscrows || [];
      this.state.settlements = parsed.settlements || parsed.gameSettlements || [];
      this.state.updatedAt = parsed.updatedAt || "";
    } catch (error) {
      if (error.code === "ENOENT") return this.state;
      const wrapped = new Error(`Unable to load covenant store ${this.file}: ${error.message || error}`);
      wrapped.code = "STORE_LOAD_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
    return this.state;
  }

  _saveUnlocked() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.updatedAt = nowIso();
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(this.state, null, 2));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.file);
      const directoryDescriptor = fs.openSync(path.dirname(this.file), "r");
      try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    } catch (error) {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(temporary); } catch {}
      const wrapped = new Error(`Unable to save covenant store ${this.file}: ${error.message || error}`);
      wrapped.code = "STORE_SAVE_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }

  _acquireWriteLock() {
    const lockFile = `${this.file}.lock`;
    const deadline = Date.now() + WRITE_LOCK_TIMEOUT_MS;
    while (true) {
      try {
        const descriptor = fs.openSync(lockFile, "wx", 0o600);
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }));
        return { descriptor, lockFile, inode: fs.fstatSync(descriptor).ino };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
          if (lockAge > STALE_WRITE_LOCK_MS) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch (inspectionError) {
          if (inspectionError.code === "ENOENT") continue;
          throw inspectionError;
        }
        if (Date.now() >= deadline) {
          const timeout = new Error(`Timed out waiting for covenant store lock ${lockFile}`);
          timeout.code = "STORE_LOCK_TIMEOUT";
          throw timeout;
        }
        Atomics.wait(LOCK_WAIT_ARRAY, 0, 0, 10);
      }
    }
  }

  _releaseWriteLock(lock) {
    try { fs.closeSync(lock.descriptor); } catch {}
    try {
      if (fs.statSync(lock.lockFile).ino === lock.inode) fs.unlinkSync(lock.lockFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  _withWriteLock(mutator) {
    if (!this.file) {
      const result = mutator();
      this._saveUnlocked();
      return result;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = this._acquireWriteLock();
    try {
      this.load();
      const result = mutator();
      this._saveUnlocked();
      return result;
    } finally {
      this._releaseWriteLock(lock);
    }
  }

  _refresh() {
    if (this.file) this.load();
  }

  save() {
    if (!this.file) return;
    const snapshot = structuredClone(this.state);
    this._withWriteLock(() => {
      this.state = snapshot;
    });
  }

  listEscrows() {
    this._refresh();
    return this.state.escrows.slice();
  }

  listSettlements() {
    this._refresh();
    return this.state.settlements.slice();
  }

  upsertEscrow(record) {
    return this._withWriteLock(() => {
      const index = this.state.escrows.findIndex((item) => item.id === record.id);
      const stamped = {
        ...record,
        updatedAt: nowIso()
      };
      if (index >= 0) {
        this.state.escrows[index] = { ...this.state.escrows[index], ...stamped };
      } else {
        this.state.escrows.unshift({ ...stamped, createdAt: nowIso() });
      }
      return this.state.escrows.find((item) => item.id === record.id);
    });
  }

  upsertSettlement(record) {
    return this._withWriteLock(() => this._upsertSettlementUnlocked(record));
  }

  _upsertSettlementUnlocked(record) {
    const index = this.state.settlements.findIndex((item) => item.id === record.id);
    const stamped = {
      ...record,
      updatedAt: nowIso()
    };
    if (index >= 0) {
      this.state.settlements[index] = { ...this.state.settlements[index], ...stamped };
    } else {
      this.state.settlements.unshift({ ...stamped, createdAt: nowIso() });
    }
    return this.state.settlements.find((item) => item.id === record.id);
  }

  createSettlementIfAbsent(record) {
    return this._withWriteLock(() => {
      const existing = this.state.settlements.find((item) => item.id === record.id);
      return existing || this._upsertSettlementUnlocked(record);
    });
  }

  acquireSettlementLease(settlementId, options = {}) {
    const ownerId = String(options.ownerId || "").trim();
    if (!ownerId) throw new Error("Settlement lease ownerId is required");
    const ttlMs = Math.max(1_000, Number(options.ttlMs) || 300_000);
    return this._withWriteLock(() => {
      const settlement = this.state.settlements.find((item) => item.id === settlementId);
      if (!settlement) return null;
      const now = Date.now();
      const existing = settlement.executionLease;
      if (existing && Date.parse(existing.expiresAt || "") > now && existing.ownerId !== ownerId) return null;
      const lease = {
        ownerId,
        token: crypto.randomUUID(),
        acquiredAt: nowIso(),
        expiresAt: new Date(now + ttlMs).toISOString()
      };
      settlement.executionLease = lease;
      settlement.updatedAt = nowIso();
      return { ...lease };
    });
  }

  releaseSettlementLease(settlementId, token) {
    return this._withWriteLock(() => {
      const settlement = this.state.settlements.find((item) => item.id === settlementId);
      if (!settlement?.executionLease || settlement.executionLease.token !== token) return false;
      delete settlement.executionLease;
      settlement.updatedAt = nowIso();
      return true;
    });
  }

  findEscrow(predicate) {
    this._refresh();
    return this.state.escrows.find(predicate) || null;
  }

  findSettlement(predicate) {
    this._refresh();
    return this.state.settlements.find(predicate) || null;
  }
}

module.exports = {
  JsonStore
};
