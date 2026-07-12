export interface NetworkConfig {
  id: string;
  kaspaNetworkId: string;
  label?: string;
  addressPrefix?: string;
  currencySymbol?: string;
  isTestnet?: boolean;
  restApi?: string;
  explorerApi?: string;
  kascovNetworkId?: "testnet-10" | "mainnet" | string;
  kascovExplorerBase?: string;
  kascovLiveDataUrl?: string;
  mode?: string;
  requiresMainnetConfirmation?: boolean;
}

export interface Player {
  seat: number;
  role: string;
  address: string;
  publicKey?: string;
}

export type KasAmount = string | number;

export interface Match {
  id: string;
  matchId?: string;
  roomId?: string;
  roundId?: string;
  game: string;
  stakeKas: KasAmount;
  players: Player[];
  claimPaths?: string[];
  [key: string]: unknown;
}

export interface GameAdapter<State = any, Room = any, Move = any> {
  name?: string;
  game?: string;
  createState?: (options?: Record<string, unknown>) => State;
  toMatch: (room: Room, state?: State) => Match;
  applyMove?: (match: Match, state: State, move: Move) => State;
  getWinnerAddress?: (match: Match, state: State) => string;
}

export interface CovenantProgramProfile {
  id: string;
  version: number;
  skeletonName: string;
  generator: string;
  generatorSha256: string;
  blake2bSha256: string;
  parameters: Array<{ name: string; kind: string; source: string }>;
  emitVerified: boolean;
  contractSourceLinked: boolean;
  sourceCompiler?: SilvercManifest;
  fingerprint: string;
  mainnetApproved?: boolean;
}

export interface EscrowIntent {
  id: string;
  matchId: string;
  roomId: string;
  roundId: string;
  game: string;
  network: string;
  status: string;
  stakeKas: number;
  totalLockedKas: number;
  stakeSompi: string;
  totalLockedSompi: string;
  programHex: string;
  programHash: string;
  programProfile?: CovenantProgramProfile;
  buyer?: Player;
  seller?: Player;
}

export interface DeployDraft {
  id: string;
  matchId: string;
  status: string;
  covenantId: string;
  programHex: string;
  unsignedTransactionSafeJson: string;
  signers: Array<{
    inputIndex: number;
    address: string;
    publicKey: string;
    role: string;
  }>;
  kasware: {
    method: string;
    preferredPayload: string;
    param: unknown;
  };
}

export interface JsonStoreState {
  escrows: unknown[];
  settlements: unknown[];
  updatedAt: string;
}

export declare const DEFAULT_NETWORKS: Record<"tn10" | "mainnet", NetworkConfig>;
export declare const ENV_NETWORK_KEY: "KASPA_COVENANT_NETWORK";
export declare const ENV_ALLOW_MAINNET_KEY: "KASPA_COVENANT_ALLOW_MAINNET";
export declare function normalizeNetworkId(value?: string): "tn10" | "mainnet" | string;
export declare function networkIdFrom(options?: { network?: NetworkConfig; networkId?: string }): string;
export declare function mainnetAllowed(options?: { allowMainnet?: boolean }): boolean;
export declare function isMainnetNetwork(network?: NetworkConfig): boolean;
export declare function kascovCliNetwork(network?: NetworkConfig): string;
export declare function kascovTraceCommand(covenantId?: string, network?: NetworkConfig): string;
export declare function resolveNetworkConfig(options?: {
  network?: NetworkConfig;
  networkId?: "tn10" | "mainnet" | string;
  allowMainnet?: boolean;
}): NetworkConfig;
export declare function networkSwitchConfig(options?: {
  network?: NetworkConfig;
  networkId?: "tn10" | "mainnet" | string;
  allowMainnet?: boolean;
}): {
  network: NetworkConfig;
  env: { network: string; allowMainnet: string };
  usage: { tn10: string; mainnet: string };
};

export declare class JsonStore {
  constructor(file?: string);
  state: JsonStoreState;
  load(): JsonStoreState;
  save(): void;
  listEscrows(): unknown[];
  listSettlements(): unknown[];
  upsertEscrow<T = unknown>(record: T & { id: string }): T;
  upsertSettlement<T = unknown>(record: T & { id: string }): T;
  findEscrow<T = unknown>(predicate: (record: T) => boolean): T | null;
  findSettlement<T = unknown>(predicate: (record: T) => boolean): T | null;
}

export declare class CovenantEscrowEngine {
  constructor(options?: Record<string, unknown>);
  escrowId(match: Match): string;
  createIntent(match: Match): EscrowIntent;
  buildPlayerFundedDeployDraft(match: Match): Promise<DeployDraft>;
  mergePlayerSignedTransactions(unsignedTransactionSafeJson: string, playerSignatures: unknown[], requiredSignatures: number, expectedSigners?: DeployDraft["signers"]): unknown;
  broadcastSignedCovenant(match: Match, safeTransactionJson: string | object, existingRecord?: object): Promise<unknown>;
  releaseSideForWinner(record: unknown, winnerAddress: string): "buyer" | "seller";
}

export declare class ProofBuilder {
  constructor(options?: Record<string, unknown>);
  covenantPlan(match: Match, winnerAddress?: string, gameState?: unknown): unknown;
  visibleSettlement(settlement: unknown, escrow?: unknown): unknown;
}

export declare class SettlementEngine {
  constructor(options: Record<string, unknown>);
  settleWinner(input: { match: Match; winnerAddress: string; reason?: string; gameState?: unknown; settlementId?: string }): Promise<unknown>;
}

export declare class KascovLabAdapter {
  constructor(options?: {
    bin?: string;
    env?: Record<string, string>;
    keyFile?: string;
    expectedBinSha256?: string;
    approvedNetworks?: string[];
  });
  binaryManifest(): { path: string; fileName: string; size: number; sha256: string };
  assertApprovedForNetwork(networkId: string): { path: string; fileName: string; size: number; sha256: string; network: string; approved: true };
  healthCheck(networkId: string, timeoutMs?: number): Promise<unknown>;
  settleEscrow(input: { programHex: string; releaseTo: "buyer" | "seller"; covenantId: string; timeoutMs?: number }): Promise<unknown>;
}

export declare const ESCROW_PROFILE_ID: "kascov-silverscript-escrow-skeleton-v1";
export declare const SOURCE_LINKED_ESCROW_PROFILE_ID: "official-silverscript-escrow-source-linked-v2";
export declare const ESCROW_SKELETON_NAME: "SilverScript · Escrow";
export declare class KascovTools {
  constructor(options?: { blake2bFile?: string; disasmFile?: string });
  blake2b256Hex(hex: string): string;
  escrowProgramProfile(options?: { compilerManifest?: SilvercManifest | null }): CovenantProgramProfile;
  verifyEscrowProgramProfile(expectedFingerprint: string, options?: { compilerManifest?: SilvercManifest | null }): CovenantProgramProfile;
  emitEscrowProgramHex(input: { arbiterHash: string; buyerPublicKey: string; sellerPublicKey: string }): string;
}

export interface SilvercManifest {
  compiler: "silverc";
  compilerVersion: string;
  compilerSha256: string;
  compilerFileName: string;
  compilerSize: number;
  upstreamCommit: string;
  sourceFileName: string;
  sourceSha256: string;
  contractSourceLinked: true;
}
export declare const SILVERC_COMPILER_VERSION: "0.1.0";
export declare const SILVERSCRIPT_UPSTREAM_COMMIT: "956868ea63a2af4176889f1331449b5f4f9e1df8";
export declare const SILVERSCRIPT_ESCROW_SOURCE_SHA256: "1b943812d68f674d36bf409d8118c38128ebf57d8098be995bab487b56b5a975";
export declare class SilvercAdapter {
  constructor(options?: {
    bin?: string;
    env?: Record<string, string>;
    sourceFile?: string;
    expectedBinSha256?: string;
  });
  profileManifest(): SilvercManifest;
  compileEscrow(input: { arbiterHash: string; buyerPublicKey: string; sellerPublicKey: string; timeoutMs?: number }): Promise<SilvercManifest & { contractName: string; programHex: string; programSha256: string }>;
  verifyEscrow(input: { arbiterHash: string; buyerPublicKey: string; sellerPublicKey: string }, expectedProgramHex: string): Promise<unknown>;
  healthCheck(kascovTools: KascovTools): Promise<SilvercManifest & { testVectorProgramSha256: string; ready: true }>;
}

export interface MainnetReadinessReport {
  mode: "mainnet-closed-test";
  ready: boolean;
  profile: CovenantProgramProfile;
  sourceCompiler: unknown;
  configuredFingerprint: string;
  maxStakeKas: number | null;
  runner: unknown;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  blockers: Array<{ id: string; ok: false; detail: string }>;
}
export declare function assessMainnetReadiness(options?: {
  env?: Record<string, string | undefined>;
  allowMainnet?: boolean;
  programProfileApproved?: boolean;
  programProfileFingerprint?: string;
  maxStakeKas?: KasAmount;
  silverc?: SilvercAdapter;
  silvercBin?: string;
  silvercSourceFile?: string;
  silvercSha256?: string;
  runnerApproved?: boolean;
  runner?: KascovLabAdapter;
  runnerBin?: string;
  runnerKeyFile?: string;
  runnerSha256?: string;
  kascovTools?: KascovTools;
}): Promise<MainnetReadinessReport>;

export declare class KaspaCovenantGameKit {
  constructor(options?: {
    network?: NetworkConfig;
    networkId?: "tn10" | "mainnet";
    allowMainnet?: boolean;
    store?: JsonStore;
    storeFile?: string;
    adapter?: GameAdapter;
    adapters?: GameAdapter[];
    arbiter?: {
      address?: string;
      publicKey?: string;
      arbiterHash?: string;
    };
    contractName?: string;
    contractFile?: string;
    contractSource?: string;
    kascovLab?: KascovLabAdapter | null;
    kascovLabBin?: string;
    kascovLabExpectedSha256?: string;
    kascovLabApprovedNetworks?: string[];
    silverc?: SilvercAdapter | null;
    silvercBin?: string;
    silvercExpectedSha256?: string;
    silvercSourceFile?: string;
    mainnetProgramProfileApproved?: boolean;
    mainnetProgramProfileFingerprint?: string;
    mainnetMaxStakeKas?: KasAmount;
    maxStakeSompi?: string | number | bigint;
    [key: string]: unknown;
  });
  registerAdapter(name: string, adapter: GameAdapter): GameAdapter;
  registerAdapter(adapter: GameAdapter): GameAdapter;
  getAdapter(game: string): GameAdapter;
  createState<State = unknown>(game: string, options?: Record<string, unknown>): State;
  toMatch(input: { game?: string; room?: unknown; state?: unknown; adapter?: GameAdapter; match?: Match } | Match): Match;
  createEscrowIntent(input: { game?: string; room?: unknown; state?: unknown; adapter?: GameAdapter; match?: Match } | Match): EscrowIntent;
  buildDeployDraft(input: { game?: string; room?: unknown; state?: unknown; adapter?: GameAdapter; match?: Match } | Match): Promise<DeployDraft>;
  mergePlayerSignatures(input: { draft: DeployDraft; signatures: unknown[] }): unknown;
  submitPlayerSignature(input: {
    match: Match;
    draft: DeployDraft;
    address: string;
    signerInputIndex: number;
    signResult?: unknown;
    signedTransactionSafeJson?: string;
    autoBroadcast?: boolean;
  }): Promise<unknown>;
  broadcastSignedCovenant(input: { match: Match; signedTransactionSafeJson: string | object; existingRecord?: object }): Promise<unknown>;
  createSettlementProof(input: { game?: string; room?: unknown; state?: unknown; adapter?: GameAdapter; match?: Match; winnerAddress?: string }): unknown;
  settleWinner(input: { game?: string; room?: unknown; state?: unknown; adapter?: GameAdapter; match?: Match; winnerAddress?: string; reason?: string; settlementId?: string }): Promise<unknown>;
  listEscrows(): unknown[];
  listSettlements(): unknown[];
}

export declare function normalizeMatch(match: Match): Match;
export declare const TRANSCRIPT_PROTOCOL: "kaspa-covenant-game-kit/transcript";
export declare const TRANSCRIPT_VERSION: 1;
export declare function canonicalValue<T = unknown>(value: T): T;
export declare function canonicalTranscript(match: Match, gameState?: unknown): unknown;
export declare function transcriptHash(match: Match, gameState?: unknown): string;
export declare function kasToSompi(amountKas: KasAmount): bigint;

export declare const adapters: {
  gomoku: GameAdapter;
};
