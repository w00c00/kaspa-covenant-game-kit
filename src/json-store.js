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
    } catch {
      this.state.escrows = [];
      this.state.settlements = [];
    }
    return this.state;
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.updatedAt = nowIso();
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
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
