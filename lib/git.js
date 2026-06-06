'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { CONFIG_DIR, SECRETS_DIR } = require('./config');

/**
 * Run a shell command, returning stdout or null on error.
 */
function runCmd(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch (_err) {
    return null;
  }
}

/**
 * Ensure the ~/.secenv directory exists.
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Clone the private secrets repo if not present,
 * otherwise pull latest changes.
 *
 * @param {string} [gitUrl] - Git URL to clone from
 *   (only used on first run).
 * @returns {{ cloned: boolean, pulled: boolean }}
 */
function syncCentralRepo(gitUrl) {
  ensureConfigDir();

  const url = gitUrl || process.env.SECENV_REPO_URL;
  const gitDir = path.join(SECRETS_DIR, '.git');

  if (!fs.existsSync(SECRETS_DIR)) {
    if (!url) {
      return { cloned: false, pulled: false, error: 'NO_REPO' };
    }
    try {
      execSync(`git clone "${url}" "${SECRETS_DIR}"`, {
        stdio: 'inherit',
      });
      return { cloned: true, pulled: false };
    } catch (err) {
      return {
        cloned: false,
        pulled: false,
        error: `Clone failed: ${err.message}`,
      };
    }
  }

  if (fs.existsSync(gitDir)) {
    try {
      execSync('git pull --ff-only', {
        cwd: SECRETS_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { cloned: false, pulled: true };
    } catch (_err) {
      // Offline or merge conflict — use cached copy
      return { cloned: false, pulled: false, warn: 'PULL_FAILED' };
    }
  }

  return { cloned: false, pulled: false };
}

/**
 * Commit and push changes to the central secrets repo.
 *
 * @param {string} message - Commit message.
 * @returns {boolean} True if pushed successfully.
 */
function pushCentralRepo(message) {
  const gitDir = path.join(SECRETS_DIR, '.git');
  if (!fs.existsSync(gitDir)) return false;

  try {
    execSync('git add secrets.json', { cwd: SECRETS_DIR });
    execSync(`git commit -m "${message}"`, {
      cwd: SECRETS_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    execSync('git push', {
      cwd: SECRETS_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Detect the current project's Git repo info.
 *
 * @param {string} [cwd] - Working directory.
 * @returns {{ owner?: string, name: string, fullName: string }}
 */
function getRepoInfo(cwd) {
  const dir = cwd || process.cwd();
  const fallbackName = path.basename(dir);
  const gitUrl = runCmd(
    'git config --get remote.origin.url',
    dir
  );

  if (!gitUrl) {
    return { name: fallbackName, fullName: fallbackName };
  }

  const match = gitUrl.match(
    /[:/]([^/]+)\/([^/]+?)(?:\.git)?$/
  );
  if (match) {
    return {
      owner: match[1],
      name: match[2],
      fullName: `${match[1]}/${match[2]}`,
    };
  }

  return { name: fallbackName, fullName: fallbackName };
}

module.exports = {
  runCmd,
  syncCentralRepo,
  pushCentralRepo,
  getRepoInfo,
};
