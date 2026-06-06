# secenv-cli

Zero-dependency CLI to manage environment secrets from a central private Git repository.

Generate `.env` files, resolve shared secrets across projects, and sync to GitHub Actions — all from a single `secrets.json` source of truth.

## Why?

If you manage 100+ public GitHub repositories:

- **dotenvx/SOPS/git-crypt** encrypt per-repo — rotating a shared key means updating 100 repos
- **Doppler** limits free tier to 10 projects
- **Infisical Cloud** limits free tier to 3 projects
- **GitHub Secrets** has no local `.env` generation for AI agents

`secenv-cli` solves all of these with **$0 cost** and **zero infrastructure**.

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
│  └── optionally syncs to GitHub Actions       │
└───────────────────────────────────────────────┘
```

## Quick Start

### 1. Create a Private Secrets Repository

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

### 2. Set Up secenv

```bash
npx secenv-cli --init git@github.com:YOUR_USER/secrets.git
```

This clones your private repo to `~/.secenv/secrets/`.

### 3. Generate `.env` in Any Project

In any project that has a `.env.example`:

```bash
npx secenv-cli
```

The CLI will:
1. Pull latest from your private secrets repo
2. Read `.env.example` to find needed keys
3. Look up values in `secrets.json`
4. Prompt for any missing secrets
5. Write `.env` to disk

### 4. Sync to GitHub Actions

```bash
npx secenv-cli --github
```

This pushes all resolved secrets to GitHub Actions
using `gh secret set` via stdin (values never appear
in shell history).

## `.env.example` Format

Your project's `.env.example` lists the keys needed:

```env
# API Keys
OPENAI_API_KEY=
DATABASE_URL=
PORT=3000
```

Values in `.env.example` are ignored — only key names matter.

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
- **Project name**: Matches the Git repo name (from `git remote`)

## Key Rotation

1. Edit `secrets.json` — change the shared key value
2. `git commit -am "rotate key" && git push`
3. Run `npx secenv-cli` in each project to regenerate `.env`
4. Run `npx secenv-cli --github` to update GitHub Actions

## CLI Flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |
| `--github`, `-g` | Sync secrets to GitHub Actions |
| `--init <url>` | Clone your private secrets repo |

## Programmatic API

```javascript
const secenv = require('secenv-cli');

// Load and resolve secrets
secenv.syncCentralRepo();
const config = secenv.loadSecrets();
const repo = secenv.getRepoInfo();
const keys = secenv.parseEnvFile('.env.example');
const { resolved } = secenv.resolveEnv(
  keys, repo.name, config
);

// Write .env
secenv.writeEnvFile(resolved);

// Sync to GitHub
secenv.syncGitHubSecrets(resolved, repo.fullName);
```

## Requirements

- **Node.js** >= 18
- **Git** (for cloning/pulling the private repo)
- **GitHub CLI** (`gh`) — only needed for `--github` flag

## Security

- Secrets are stored in a **private** GitHub repo
- `.env` files are generated locally and **never committed**
- `gh secret set` uses **stdin** — values never appear in
  process args or shell history
- The CLI **never logs secret values** — only key names

## License

MIT
