'use strict';

const fs = require('fs');
const { SECRETS_FILE } = require('./config');

/**
 * Parse a .env-format file into a key-value object.
 * Handles comments, empty lines, quoted values, and
 * keys without values (schema-only entries).
 *
 * @param {string} filePath - Absolute path to .env file.
 * @returns {Object<string, string>}
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      // Key-only line (e.g., just "API_KEY")
      env[line] = '';
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Load and parse the central secrets.json file.
 *
 * @returns {{ shared: Object, projects: Object }}
 */
function loadSecrets() {
  if (!fs.existsSync(SECRETS_FILE)) {
    return { shared: {}, projects: {} };
  }

  try {
    const raw = fs.readFileSync(SECRETS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return {
      shared: data.shared || {},
      projects: data.projects || {},
    };
  } catch (err) {
    throw new Error(
      `Failed to parse secrets.json: ${err.message}`
    );
  }
}

/**
 * Save the secrets config back to secrets.json.
 *
 * @param {{ shared: Object, projects: Object }} config
 */
function saveSecrets(config) {
  const json = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(SECRETS_FILE, json, 'utf-8');
}

module.exports = {
  parseEnvFile,
  loadSecrets,
  saveSecrets,
};
