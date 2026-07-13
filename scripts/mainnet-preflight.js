"use strict";

const { assessMainnetReadiness } = require("../src/mainnet-readiness");

assessMainnetReadiness()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
