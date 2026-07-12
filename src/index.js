"use strict";

const constants = require("./constants");
const utils = require("./utils");
const transcript = require("./transcript");
const adapter = require("./adapter");
const network = require("./network");
const mainnetReadiness = require("./mainnet-readiness");
const { CovenantEscrowEngine } = require("./escrow-engine");
const { JsonStore } = require("./json-store");
const { KascovLabAdapter, parseKascovLabDeploy, parseKascovLabSettle } = require("./kascov-lab-adapter");
const { KascovTools } = require("./kascov-tools");
const { KaspaCovenantGameKit } = require("./sdk");
const { ProofBuilder } = require("./proof-builder");
const { SettlementEngine } = require("./settlement-engine");
const gomokuAdapter = require("./adapters/gomoku");

module.exports = {
  ...constants,
  ...utils,
  ...transcript,
  ...adapter,
  ...network,
  ...mainnetReadiness,
  KaspaCovenantGameKit,
  CovenantEscrowEngine,
  JsonStore,
  KascovLabAdapter,
  KascovTools,
  ProofBuilder,
  SettlementEngine,
  adapters: {
    gomoku: gomokuAdapter
  },
  parseKascovLabDeploy,
  parseKascovLabSettle
};
