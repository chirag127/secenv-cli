'use strict';

const { syncCentralRepo, pushCentralRepo, getRepoInfo } =
  require('./git');
const { parseEnvFile, loadSecrets, saveSecrets } =
  require('./parser');
const { resolveEnv, addSecret, rotateSharedSecret } =
  require('./resolver');
const { writeEnvFile } = require('./writer');
const { isGhAvailable, syncGitHubSecrets } =
  require('./github-sync');
const { SECRETS_DIR, SECRETS_FILE } = require('./config');

/**
 * Public programmatic API for secenv-cli.
 * Used by secenv-mcp and any other consumer.
 *
 * All functions are synchronous or return plain values
 * (no readline prompts). The CLI layer handles prompts.
 */
module.exports = {
  // Git operations
  syncCentralRepo,
  pushCentralRepo,
  getRepoInfo,

  // Parsing
  parseEnvFile,
  loadSecrets,
  saveSecrets,

  // Resolution
  resolveEnv,
  addSecret,
  rotateSharedSecret,

  // Writing
  writeEnvFile,

  // GitHub Actions
  isGhAvailable,
  syncGitHubSecrets,

  // Config paths (useful for consumers)
  paths: {
    SECRETS_DIR,
    SECRETS_FILE,
  },
};
