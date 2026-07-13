"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sha256Hex } = require("./utils");

function resolveExecutable(bin, env = process.env) {
  const candidate = String(bin || "");
  if (path.isAbsolute(candidate) || candidate.includes(path.sep)) return fs.realpathSync(candidate);
  const searchPath = String(env?.PATH || process.env.PATH || "");
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    const executable = path.join(directory, candidate);
    try {
      fs.accessSync(executable, fs.constants.X_OK);
      return fs.realpathSync(executable);
    } catch {
      // Continue through PATH until an executable is found.
    }
  }
  const error = new Error(`Executable was not found: ${candidate}`);
  error.code = "EXECUTABLE_NOT_FOUND";
  throw error;
}

function executableManifest(bin, env = process.env) {
  const resolved = resolveExecutable(bin, env);
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Executable must be a regular file");
  return {
    path: resolved,
    fileName: path.basename(resolved),
    size: stat.size,
    sha256: sha256Hex(fs.readFileSync(resolved))
  };
}

module.exports = { executableManifest, resolveExecutable };
