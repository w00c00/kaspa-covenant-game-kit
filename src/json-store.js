"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { nowIso } = require("./utils");

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

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.updatedAt = nowIso();
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch {}
      const wrapped = new Error(`Unable to save covenant store ${this.file}: ${error.message || error}`);
      wrapped.code = "STORE_SAVE_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }

  listEscrows() {
    return this.state.escrows.slice();
  }

  listSettlements() {
    return this.state.settlements.slice();
  }

  upsertEscrow(record) {
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
    this.save();
    return this.state.escrows.find((item) => item.id === record.id);
  }

  upsertSettlement(record) {
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
    this.save();
    return this.state.settlements.find((item) => item.id === record.id);
  }

  findEscrow(predicate) {
    return this.state.escrows.find(predicate) || null;
  }

  findSettlement(predicate) {
    return this.state.settlements.find(predicate) || null;
  }
}

module.exports = {
  JsonStore
};
