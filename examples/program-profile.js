"use strict";

const { KascovTools } = require("..");

const profile = new KascovTools().escrowProgramProfile();
console.log(JSON.stringify(profile, null, 2));
console.log(`\nKASPA_COVENANT_MAINNET_PROGRAM_FINGERPRINT=${profile.fingerprint}`);
