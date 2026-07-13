"use strict";

const { KascovTools, SilvercAdapter } = require("..");

async function main() {
  const tools = new KascovTools();
  let compilerManifest = null;
  if (process.env.SILVERC_BIN) {
    const compiler = new SilvercAdapter({
      bin: process.env.SILVERC_BIN,
      expectedBinSha256: process.env.KASPA_COVENANT_MAINNET_SILVERC_SHA256
    });
    await compiler.healthCheck(tools);
    compilerManifest = compiler.profileManifest();
  }
  const profile = tools.escrowProgramProfile({ compilerManifest });
  console.log(JSON.stringify(profile, null, 2));
  if (profile.contractSourceLinked) {
    console.log(`\nKASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT=${profile.fingerprint}`);
  } else {
    console.error("\nThis generator-only profile cannot be approved for mainnet; configure SILVERC_BIN and its pinned SHA-256.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
