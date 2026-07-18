"use strict";

class CovenantReader {
  async readCovenant(_descriptor) {
    throw new Error("CovenantReader.readCovenant is not implemented");
  }

  async readTransaction(_txid) {
    throw new Error("CovenantReader.readTransaction is not implemented");
  }
}

class CovenantWriter {
  async buildDeployDraft(_match) {
    throw new Error("CovenantWriter.buildDeployDraft is not implemented");
  }

  async broadcastDeploy(_match, _signedTransaction, _existingRecord) {
    throw new Error("CovenantWriter.broadcastDeploy is not implemented");
  }
}

class CovenantIndexer {
  async getCovenant(_covenantId) {
    throw new Error("CovenantIndexer.getCovenant is not implemented");
  }

  async getTransaction(_txid) {
    throw new Error("CovenantIndexer.getTransaction is not implemented");
  }

  watchCovenant(_covenantId, _options) {
    throw new Error("CovenantIndexer.watchCovenant is not implemented");
  }
}

function assertMethod(value, method, label) {
  if (!value || typeof value[method] !== "function") throw new TypeError(`${label} requires ${method}()`);
  return value;
}

function assertCovenantReader(value) {
  assertMethod(value, "readCovenant", "CovenantReader");
  return assertMethod(value, "readTransaction", "CovenantReader");
}

function assertCovenantWriter(value) {
  assertMethod(value, "buildDeployDraft", "CovenantWriter");
  return assertMethod(value, "broadcastDeploy", "CovenantWriter");
}

function assertCovenantIndexer(value) {
  assertMethod(value, "getCovenant", "CovenantIndexer");
  return assertMethod(value, "getTransaction", "CovenantIndexer");
}

module.exports = {
  CovenantIndexer,
  CovenantReader,
  CovenantWriter,
  assertCovenantIndexer,
  assertCovenantReader,
  assertCovenantWriter
};
