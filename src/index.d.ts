export interface NetworkConfig {
  id: string;
  kaspaNetworkId: string;
  label?: string;
  addressPrefix?: string;
  currencySymbol?: string;
  isTestnet?: boolean;
  restApi?: string;
  explorerApi?: string;
  kascovExplorerBase?: string;
  mode?: string;
  requiresMainnetConfirmation?: boolean;
}

export interface Player {
  seat: number;
  role: string;
  address: string;
  publicKey?: string;
}

export interface Match {
  id: string;
  matchId?: string;
  roomId?: string;
  roundId?: string;
  game: string;
  stakeKas: number;
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
  programHex: string;
  programHash: string;
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
  mergePlayerSignedTransactions(unsignedTransactionSafeJson: string, playerSignatures: unknown[], requiredSignatures: number): unknown;
  broadcastSignedCovenant(match: Match, safeTransactionJson: string | object, existingRecord?: object): Promise<unknown>;
  releaseSideForWinner(record: unknown, winnerAddress: string, fallback?: "buyer" | "seller"): "buyer" | "seller";
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
  constructor(options?: { bin?: string; env?: Record<string, string> });
  settleEscrow(input: { programHex: string; releaseTo: "buyer" | "seller"; covenantId: string; timeoutMs?: number }): Promise<unknown>;
}

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
export declare function transcriptHash(match: Match, gameState?: unknown): string;

export declare const adapters: {
  gomoku: GameAdapter;
};
