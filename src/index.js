"use strict";

const constants = require("./constants");
const utils = require("./utils");
const transcript = require("./transcript");
const adapter = require("./adapter");
const network = require("./network");
const mainnetReadiness = require("./mainnet-readiness");
const abi = require("./abi");
const covenantInterfaces = require("./covenant-interfaces");
const { CovenantEscrowEngine } = require("./escrow-engine");
const { JsonStore } = require("./json-store");
const { KascovLabAdapter, parseKascovLabDeploy, parseKascovLabSettle, parseSettlementJournal } = require("./kascov-lab-adapter");
const kascovTools = require("./kascov-tools");
const silverc = require("./silverc-adapter");
const { KaspaCovenantGameKit } = require("./sdk");
const { ProofBuilder } = require("./proof-builder");
const { SettlementEngine } = require("./settlement-engine");
const { KascovCovenantReader, KascovHttpError, KascovIndexerAdapter } = require("./kascov-indexer");
const gomokuAdapter = require("./adapters/gomoku");

module.exports = {
  ...constants,
  ...utils,
  ...transcript,
  ...adapter,
  ...network,
  ...mainnetReadiness,
  ...abi,
  ...covenantInterfaces,
  ...kascovTools,
  ...silverc,
  KaspaCovenantGameKit,
  CovenantEscrowEngine,
  JsonStore,
  KascovLabAdapter,
  ProofBuilder,
  SettlementEngine,
  KascovCovenantReader,
  KascovHttpError,
  KascovIndexerAdapter,
  adapters: {
    gomoku: gomokuAdapter
  },
  parseKascovLabDeploy,
  parseKascovLabSettle,
  parseSettlementJournal
};
