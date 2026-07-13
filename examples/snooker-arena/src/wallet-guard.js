const FROZEN_ESCROW_STATUSES = new Set([
  "building-lock-transaction",
  "awaiting-player-signatures",
  "confirming-lock-on-chain",
  "lock-confirmation-timeout",
  "locked-on-chain",
  "lock-broadcast-failed"
]);

export function roomWalletIdentityFrozen(room, seat) {
  const player = room?.players?.find((item) => item.seat === seat);
  return Boolean(
    player?.locked ||
    (player?.lockStatus && player.lockStatus !== "unsigned") ||
    room?.escrow?.covenantId ||
    room?.escrow?.lockTxid ||
    FROZEN_ESCROW_STATUSES.has(room?.escrow?.status)
  );
}

export function walletAccountDecision({ addressPrefix, boundAddress = "", nextAddress = "", identityFrozen = false } = {}) {
  const address = String(nextAddress || "").trim();
  if (!address) return { action: "disconnect", address: "" };
  if (!address.toLowerCase().startsWith(`${String(addressPrefix || "").toLowerCase()}:`)) {
    return { action: "wrong-network", address };
  }
  if (identityFrozen && boundAddress && address !== boundAddress) {
    return { action: "restore-bound-account", address, boundAddress };
  }
  return { action: "bind", address };
}
