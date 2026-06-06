'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { runCmd } = require('./git');

/**
 * Check if the GitHub CLI (gh) is available.
 *
 * @returns {boolean}
 */
function isGhAvailable() {
  return runCmd('gh --version') !== null;
}

/**
 * Sync resolved secrets to GitHub Actions secrets
 * for the current repository using `gh secret set`.
 *
 * Uses --env-file when a .env file path is provided,
 * or sets individual secrets otherwise.
 *
 * @param {Object<string,string>} envVars
 * @param {string} [repoFullName] - "owner/repo" format.
 * @param {string} [cwd] - Working directory.
 * @returns {{ success: boolean, count: number, error?: string }}
 */
function syncGitHubSecrets(envVars, repoFullName, cwd) {
  const dir = cwd || process.cwd();

  if (!isGhAvailable()) {
    return {
      success: false,
      count: 0,
      error: 'GitHub CLI (gh) is not installed or not in PATH.',
    };
  }

  const repoFlag = repoFullName
    ? ` --repo "${repoFullName}"`
    : '';

  let count = 0;

  try {
    for (const [key, val] of Object.entries(envVars)) {
      // Use stdin pipe to avoid exposing values in
      // process args or shell history
      execSync(
        `gh secret set ${key}${repoFlag}`,
        {
          cwd: dir,
          input: val,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      count++;
    }

    return { success: true, count };
  } catch (err) {
    return {
      success: false,
      count,
      error: `Failed after ${count} secrets: ${err.message}`,
    };
  }
}

module.exports = { isGhAvailable, syncGitHubSecrets };
