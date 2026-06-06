# secenv-cli

[![NPM Version](https://img.shields.io/npm/v/secenv-cli)](https://www.npmjs.com/package/secenv-cli)
[![Tests](https://img.shields.io/badge/tests-38%20passing-brightgreen)](#tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Zero-dependency CLI to manage environment secrets from a central private Git
repository. Generate `.env` files, resolve shared secrets across projects, and
sync to GitHub Actions — all from a single `secrets.json` source of truth.

No dependencies. Runs on Node.js 18+. Works offline after the initial clone.

---

## Why?

If you manage 100+ public GitHub repositories:

- **dotenvx / SOPS / git-crypt** encrypt per-repo — rotating a shared key means updating 100 repos
- **Doppler** limits the free tier to 10 projects
- **Infisical Cloud** limits the free tier to 3 projects
- **1Password** costs $36/year minimum
- **GitHub Secrets** has no local `.env` generation for AI agents

`secenv-cli` solves all of these with **$0 cost** and **zero infrastructure**.

---

## How It Works

```
┌──────────────────────────────────────────────┐
│  Private GitHub repo (e.g. your-user/secrets)│
│  └── secrets.json  ← single source of truth  │
└──────────────────┬───────────────────────────┘
                   │ git clone / pull
┌──────────────────▼───────────────────────────┐
│  secenv-cli                                   │
│  ├── reads .env.example from your project     │
│  ├── resolves shared references               │
│  ├── prompts for any missing secrets          │
│  ├── writes .env (gitignored)                 │
│  ├── --clean  removes deleted projects        │
│  ├── --delete removes a project               │
│  ├── --remove removes a shared key            │
│  └── --github syncs to GitHub Actions         │
└───────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Create a private secrets repository

Create a **private** GitHub repo (e.g., `secrets`) with a `secrets.json`:

```json
{
  "shared": {
    "OPENAI_API_KEY": "sk-proj-your-key-here",
    "CLOUDFLARE_API_TOKEN": "your-token-here"
  },
  "projects": {
    "my-app": {
      "OPENAI_API_KEY": "shared.OPENAI_API_KEY",
      "DATABASE_URL": "postgres://user:pass@host/db",
      "PORT": "3000"
    },
    "my-blog": {
      "CLOUDFLARE_API_TOKEN": "shared.CLOUDFLARE_API_TOKEN",
      "SITE_URL": "https://blog.example.com"
    }
  }
}
```

The included `secenv-secrets` template repo's `.gitignore` allows only
`secrets.json`, `.gitignore`, and `README.md` so you cannot accidentally
commit unrelated files.

### 2. Install secenv-cli

```bash
npm install -g secenv-cli
# or use npx without installing
npx -y secenv-cli --init git@github.com:YOUR_USER/secenv-secrets.git
```

This clones your private repo to `~/.secenv/secrets/`.

### 3. Generate `.env` in any project

In any project that has a `.env.example`:

```bash
npx -y secenv-cli
```

The CLI will:

1. Pull latest from your private secrets repo
2. Read `.env.example` to find needed keys
3. Look up values in `secrets.json`
4. Prompt for any missing secrets
5. Write `.env` to disk (which is gitignored — see below)

### 4. Sync to GitHub Actions

```bash
npx -y secenv-cli --github
```

This pushes all resolved secrets to GitHub Actions using
`gh secret set` via stdin (values never appear in shell history).

---

## Handle deleted projects

If you've deleted a project directory, clean up its entry in `secrets.json`:

```bash
# Dry-run: see what would be removed
npx -y secenv-cli --clean ~/code

# Actually remove
npx -y secenv-cli --clean ~/code --yes
```

Or remove a specific project / shared key:

```bash
npx -y secenv-cli --delete my-old-app
npx -y secenv-cli --remove DEPRECATED_API_KEY
```

Or list everything:

```bash
npx -y secenv-cli --list
```

---

## `.env.example` Format

Your project's `.env.example` lists the keys needed:

```env
# API Keys
OPENAI_API_KEY=
DATABASE_URL=
PORT=3000
```

Values in `.env.example` are ignored — only key names matter. The CLI uses
the keys to look up values in `secrets.json`.

---

## `secrets.json` Schema

```json
{
  "shared": {
    "KEY_NAME": "actual-secret-value"
  },
  "projects": {
    "project-name": {
      "KEY_NAME": "shared.KEY_NAME",
      "OTHER_KEY": "direct-value-here"
    }
  }
}
```

- **`shared`**: Secrets reused across multiple projects
- **`projects`**: Per-project configs. Use `"shared.KEY_NAME"` to reference shared secrets
- **Project name**: Matches the Git repo name (from `git remote` origin URL)

### Reference resolution rules

- A value of `"shared.OPENAI_API_KEY"` is resolved by looking up
  `secrets.json`'s top-level `shared.OPENAI_API_KEY`.
- A direct value is written as-is.
- Missing keys (project or shared) are reported and prompted for at runtime.

---

## Key Rotation

1. Edit `secrets.json` — change the shared key value
2. `git commit -am "rotate key" && git push`
3. Run `npx secenv-cli` in each project to regenerate `.env`
4. Run `npx secenv-cli --github` to update GitHub Actions

For programmatic rotation, use the [`secenv-mcp`](https://www.npmjs.com/package/secenv-mcp)
`rotate_secret` tool from your AI agent, which reports all affected projects
automatically.

---

## CLI Reference

```text
secenv                      Generate .env from .env.example
secenv --github             Also sync secrets to GitHub Actions
secenv --init <url>         Set up central secrets repo
secenv --list               List projects and shared keys
secenv --clean [dir]        Remove stale projects (dir = parent of repos)
secenv --delete <proj>      Delete a project entry
secenv --remove <key>       Remove a shared secret key
secenv --yes                Skip confirmation prompts (for --clean)
secenv --help               Show help
secenv --version            Show version
```

---

## Programmatic API

```javascript
const secenv = require('secenv-cli');

// Load and resolve secrets
secenv.syncCentralRepo();
const config = secenv.loadSecrets();
const repo = secenv.getRepoInfo();
const keys = secenv.parseEnvFile('.env.example');
const { resolved, missing, missingShared } = secenv.resolveEnv(
  keys, repo.name, config
);

// Write .env
secenv.writeEnvFile(resolved);

// Sync to GitHub
secenv.syncGitHubSecrets(resolved, repo.fullName);

// Add/rotate
secenv.addSecret(config, repo.name, 'API_KEY', 'val');
secenv.rotateSharedSecret(config, 'OPENAI_API_KEY', 'sk-new');
secenv.saveSecrets(config);
secenv.pushCentralRepo('rotate key');
```

The same API is used internally by [`secenv-mcp`](https://www.npmjs.com/package/secenv-mcp).

---

## Requirements

- **Node.js** >= 18
- **Git** (for cloning/pulling the private repo)
- **GitHub CLI** (`gh`) — only needed for `--github` flag

---

## Tests

38 tests across two suites:

```bash
npm test                  # all tests
npm run test:unit         # 29 unit tests
npm run test:integration  # 9 end-to-end tests (with a real local git remote)
```

The integration test creates a throwaway bare git repo as the "remote",
sets up a fake project with `.env.example`, runs the CLI, and verifies
`.env` generation, shared resolution, project cleanup, and rotation.

CI runs on Node 18, 20, 22 across Linux, macOS, and Windows —
see [`.github/workflows/test.yml`](.github/workflows/test.yml).

---

## Security

- Secrets are stored in a **private** GitHub repo
- `.env` files are generated locally and **never committed**
- `gh secret set` uses **stdin** — values never appear in
  process args or shell history
- The CLI **never logs secret values** — only key names

---

## Related Packages

- [`secenv-mcp`](https://www.npmjs.com/package/secenv-mcp) — MCP server
  exposing the same API to AI agents (Cursor, Claude Desktop, Windsurf, etc.)

---

## License

MIT
