#!/usr/bin/env node

'use strict';

const path = require('path');
const readline = require('readline');
const {
  syncCentralRepo,
  pushCentralRepo,
  getRepoInfo,
  parseEnvFile,
  loadSecrets,
  saveSecrets,
  resolveEnv,
  addSecret,
  writeEnvFile,
  isGhAvailable,
  syncGitHubSecrets,
} = require('../lib');

const { ENV_EXAMPLE_FILE, SHARED_PREFIX } =
  require('../lib/config');

const PKG = require('../package.json');

// ── Colors ─────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function log(msg) {
  console.error(msg);
}

function success(msg) {
  log(`${c.green}✔${c.reset} ${msg}`);
}

function warn(msg) {
  log(`${c.yellow}⚠${c.reset} ${msg}`);
}

function error(msg) {
  log(`${c.red}✖${c.reset} ${msg}`);
}

function info(msg) {
  log(`${c.cyan}ℹ${c.reset} ${msg}`);
}

// ── Readline helper ────────────────────────────────
function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

function ask(rl, query) {
  return new Promise((resolve) =>
    rl.question(query, resolve)
  );
}

// ── CLI ────────────────────────────────────────────
const HELP = `
${c.bold}secenv${c.reset} — Centralized secrets manager
${c.dim}v${PKG.version}${c.reset}

${c.bold}Usage:${c.reset}
  secenv                    Generate .env from .env.example
  secenv --github           Also sync secrets to GitHub Actions
  secenv --init <url>       Set up central secrets repo
  secenv --clean [dir]      Remove stale projects (dir = parent of repos)
  secenv --delete <proj>    Delete a project entry
  secenv --remove <key>     Remove a shared secret key
  secenv --list             List projects and shared keys
  secenv --help             Show this help
  secenv --version          Show version

${c.bold}How it works:${c.reset}
  1. Reads .env.example in the current directory
  2. Pulls secrets from ~/.secenv/secrets/secrets.json
  3. Resolves shared references (e.g., shared.OPENAI_API_KEY)
  4. Prompts for any missing secrets
  5. Writes .env (gitignored, never committed)
  6. Optionally syncs to GitHub Actions secrets

${c.bold}Central secrets repo:${c.reset}
  On first run, secenv clones your private repo to
  ~/.secenv/secrets/. Run ${c.cyan}secenv --init <git-url>${c.reset}
  to set up manually.
`;

async function main() {
  const args = process.argv.slice(2);

  // ── Flags ─────────────────────────────────
  if (args.includes('--help') || args.includes('-h')) {
    log(HELP);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    log(PKG.version);
    process.exit(0);
  }

  const isGithubSync =
    args.includes('--github') || args.includes('-g');

  const initIdx = args.indexOf('--init');
  const initUrl =
    initIdx !== -1 ? args[initIdx + 1] : null;

  const isList = args.includes('--list') || args.includes('-l');

  const cleanIdx = args.indexOf('--clean');
  const cleanDir = cleanIdx !== -1
    ? args[cleanIdx + 1] || process.cwd()
    : null;
  const assumeYes = args.includes('--yes') || args.includes('-y');

  const delIdx = args.indexOf('--delete');
  const deleteProj = delIdx !== -1 ? args[delIdx + 1] : null;

  const rmIdx = args.indexOf('--remove');
  const removeKey = rmIdx !== -1 ? args[rmIdx + 1] : null;

  const rl = createRL();

  try {
    // ── Step 0: Handle non-generate flags ──
    if (isList || deleteProj || removeKey || cleanDir) {
      info('Syncing central secrets repository...');
      const s = syncCentralRepo();
      if (s.error === 'NO_REPO') {
        error('No central repo. Run: secenv --init <url>');
        rl.close();
        process.exit(1);
      }
      const cfg = loadSecrets();

      if (isList) {
        const projs = Object.keys(cfg.projects);
        const shared = Object.keys(cfg.shared);
        log('');
        info(`Projects (${projs.length}):`);
        if (projs.length === 0) {
          log('  (none)');
        } else {
          for (const p of projs) {
            log(`  • ${p} (${Object.keys(cfg.projects[p]).length} keys)`);
          }
        }
        log('');
        info(`Shared keys (${shared.length}):`);
        if (shared.length === 0) {
          log('  (none)');
        } else {
          for (const k of shared) {
            log(`  • ${k}`);
          }
        }
        rl.close();
        process.exit(0);
      }

      if (deleteProj) {
        if (!cfg.projects[deleteProj]) {
          error(`Project "${deleteProj}" not found.`);
          rl.close();
          process.exit(1);
        }
        delete cfg.projects[deleteProj];
        saveSecrets(cfg);
        const pushed = pushCentralRepo(`delete: ${deleteProj}`);
        success(`Removed project "${deleteProj}".`);
        if (pushed) success('Pushed to central repo.');
        else warn('Saved locally (push failed).');
        rl.close();
        process.exit(0);
      }

      if (removeKey) {
        if (!(removeKey in cfg.shared)) {
          error(`Shared key "${removeKey}" not found.`);
          rl.close();
          process.exit(1);
        }
        delete cfg.shared[removeKey];
        saveSecrets(cfg);
        const pushed = pushCentralRepo(
          `remove: shared key ${removeKey}`
        );
        success(`Removed shared key "${removeKey}".`);
        if (pushed) success('Pushed to central repo.');
        else warn('Saved locally (push failed).');
        rl.close();
        process.exit(0);
      }

      if (cleanDir) {
        const fs = require('fs');
        if (!fs.existsSync(cleanDir)) {
          error(`Directory "${cleanDir}" does not exist.`);
          rl.close();
          process.exit(1);
        }
        const projs = Object.keys(cfg.projects);
        const stale = [];
        for (const p of projs) {
          const pp = require('path').join(cleanDir, p);
          if (!fs.existsSync(pp)) stale.push(p);
        }
        if (stale.length === 0) {
          success(`No stale projects. All ${projs.length} `
            + `projects exist under ${cleanDir}.`);
          rl.close();
          process.exit(0);
        }
        warn(`Found ${stale.length} stale project(s):`);
        for (const s of stale) log(`  • ${s}`);

        let proceed = assumeYes;
        if (!proceed) {
          const answer = (await ask(
            rl,
            `${c.yellow}?${c.reset} Remove them? [y/N]: `
          )).trim().toLowerCase();
          proceed = answer === 'y' || answer === 'yes';
        }

        if (proceed) {
          for (const s of stale) delete cfg.projects[s];
          saveSecrets(cfg);
          const pushed = pushCentralRepo(
            `clean: removed ${stale.length} stale project(s)`
          );
          success(`Removed ${stale.length} stale project(s).`);
          if (pushed) success('Pushed to central repo.');
          else warn('Saved locally (push failed).');
        } else {
          info('Cancelled. No changes made.');
        }
        rl.close();
        process.exit(0);
      }
    }

    // ── Step 1: Sync central repo ───────────
    info('Syncing central secrets repository...');

    let gitUrl = initUrl;
    if (!gitUrl) {
      const result = syncCentralRepo();
      if (result.error === 'NO_REPO') {
        gitUrl = await ask(
          rl,
          `${c.cyan}?${c.reset} Git URL of your private ` +
            'secrets repository: '
        );
        if (!gitUrl || !gitUrl.trim()) {
          error('Git URL is required. Run: secenv --init <url>');
          process.exit(1);
        }
        const cloneResult = syncCentralRepo(gitUrl.trim());
        if (cloneResult.error) {
          error(cloneResult.error);
          process.exit(1);
        }
        success('Cloned central secrets repository.');
      } else if (result.warn === 'PULL_FAILED') {
        warn('Could not pull latest. Using cached secrets.');
      } else if (result.pulled) {
        success('Pulled latest secrets.');
      }
    } else {
      const result = syncCentralRepo(gitUrl.trim());
      if (result.error) {
        error(result.error);
        process.exit(1);
      }
      success('Central secrets repository ready.');
    }

    // ── Step 2: Load secrets config ─────────
    const secretsConfig = loadSecrets();
    const repo = getRepoInfo();

    info(`Project: ${c.bold}${repo.name}${c.reset}`);

    // ── Step 3: Read .env.example ───────────
    const examplePath = path.join(
      process.cwd(),
      ENV_EXAMPLE_FILE
    );
    const neededKeys = parseEnvFile(examplePath);

    if (Object.keys(neededKeys).length === 0) {
      warn(
        'No keys found in .env.example. ' +
          'Create one with your env var names.'
      );
      rl.close();
      process.exit(0);
    }

    info(
      `Found ${Object.keys(neededKeys).length} keys ` +
        'in .env.example'
    );

    // ── Step 4: Resolve secrets ─────────────
    let { resolved, missing, missingShared } = resolveEnv(
      neededKeys,
      repo.name,
      secretsConfig
    );

    let modified = false;

    // Prompt for missing project secrets
    for (const key of missing) {
      const val = await ask(
        rl,
        `${c.yellow}?${c.reset} Value for ` +
          `${c.bold}${key}${c.reset} ` +
          `${c.dim}(or "shared.KEY" to link)${c.reset}: `
      );

      const trimmed = (val || '').trim();
      addSecret(secretsConfig, repo.name, key, trimmed);
      modified = true;

      // Resolve if it's a shared ref
      if (trimmed.startsWith(SHARED_PREFIX)) {
        const sharedKey = trimmed.slice(
          SHARED_PREFIX.length
        );
        if (secretsConfig.shared[sharedKey] === undefined) {
          const sv = await ask(
            rl,
            `${c.yellow}?${c.reset} Value for shared ` +
              `secret ${c.bold}${sharedKey}${c.reset}: `
          );
          secretsConfig.shared[sharedKey] = (sv || '').trim();
        }
        resolved[key] = secretsConfig.shared[sharedKey];
      } else {
        resolved[key] = trimmed;
      }
    }

    // Prompt for missing shared secrets
    for (const sharedKey of missingShared) {
      const val = await ask(
        rl,
        `${c.yellow}?${c.reset} Value for shared ` +
          `secret ${c.bold}${sharedKey}${c.reset}: `
      );
      secretsConfig.shared[sharedKey] = (val || '').trim();
      modified = true;

      // Re-resolve keys that referenced this shared
      for (const k of Object.keys(neededKeys)) {
        const projVal =
          secretsConfig.projects[repo.name]?.[k];
        if (projVal === `${SHARED_PREFIX}${sharedKey}`) {
          resolved[k] = secretsConfig.shared[sharedKey];
        }
      }
    }

    // ── Step 5: Write .env ──────────────────
    const envPath = writeEnvFile(resolved);
    success(`Generated ${envPath}`);

    // ── Step 6: Save & push if modified ─────
    if (modified) {
      saveSecrets(secretsConfig);
      info('Pushing updates to central secrets repo...');
      const pushed = pushCentralRepo(
        `sync: update secrets for ${repo.name}`
      );
      if (pushed) {
        success('Pushed to central secrets repository.');
      } else {
        warn('Could not push. Saved locally.');
      }
    }

    // ── Step 7: GitHub Actions sync ─────────
    if (isGithubSync) {
      log('');
      info(
        `Syncing to GitHub Actions: ` +
          `${c.bold}${repo.fullName}${c.reset}`
      );

      if (!isGhAvailable()) {
        error(
          'GitHub CLI (gh) not found. ' +
            'Install: https://cli.github.com'
        );
        rl.close();
        process.exit(1);
      }

      const result = syncGitHubSecrets(
        resolved,
        repo.fullName
      );

      if (result.success) {
        success(
          `Synced ${result.count} secrets ` +
            'to GitHub Actions.'
        );
      } else {
        error(result.error);
      }
    }

    rl.close();
  } catch (err) {
    error(`Unexpected error: ${err.message}`);
    rl.close();
    process.exit(1);
  }
}

main();
