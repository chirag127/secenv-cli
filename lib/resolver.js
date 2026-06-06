'use strict';

const { SHARED_PREFIX } = require('./config');

/**
 * Resolve a set of needed keys against the secrets config.
 * Returns { resolved, missing } where missing lists keys
 * that could not be resolved.
 *
 * @param {Object<string,string>} neededKeys
 *   Keys from .env.example.
 * @param {string} projectName
 *   The project identifier in secrets.json.
 * @param {{ shared: Object, projects: Object }} secretsConfig
 * @returns {{
 *   resolved: Object<string,string>,
 *   missing: string[],
 *   missingShared: string[]
 * }}
 */
function resolveEnv(neededKeys, projectName, secretsConfig) {
  const projectSecrets =
    secretsConfig.projects[projectName] || {};
  const resolved = {};
  const missing = [];
  const missingShared = [];

  for (const key of Object.keys(neededKeys)) {
    let rawValue = projectSecrets[key];

    if (rawValue === undefined || rawValue === null) {
      missing.push(key);
      continue;
    }

    // Resolve shared references: "shared.SOME_KEY"
    if (
      typeof rawValue === 'string' &&
      rawValue.startsWith(SHARED_PREFIX)
    ) {
      const sharedKey = rawValue.slice(SHARED_PREFIX.length);
      const sharedValue = secretsConfig.shared[sharedKey];

      if (sharedValue === undefined || sharedValue === null) {
        missingShared.push(sharedKey);
        continue;
      }

      resolved[key] = sharedValue;
    } else {
      resolved[key] = rawValue;
    }
  }

  return { resolved, missing, missingShared };
}

/**
 * Add or update a secret in the config.
 *
 * @param {{ shared: Object, projects: Object }} config
 * @param {string} project - Project name.
 * @param {string} key - Secret key.
 * @param {string} value - Value or "shared.KEY" reference.
 * @returns {{ shared: Object, projects: Object }}
 */
function addSecret(config, project, key, value) {
  if (!config.projects[project]) {
    config.projects[project] = {};
  }
  config.projects[project][key] = value;
  return config;
}

/**
 * Rotate a shared secret across all projects.
 *
 * @param {{ shared: Object, projects: Object }} config
 * @param {string} sharedKey
 * @param {string} newValue
 * @returns {{ shared: Object, projects: Object, affected: string[] }}
 */
function rotateSharedSecret(config, sharedKey, newValue) {
  config.shared[sharedKey] = newValue;

  // Find all projects referencing this shared key
  const affected = [];
  const ref = `${SHARED_PREFIX}${sharedKey}`;
  for (const [proj, secrets] of Object.entries(
    config.projects
  )) {
    for (const val of Object.values(secrets)) {
      if (val === ref) {
        affected.push(proj);
        break;
      }
    }
  }

  return { ...config, affected };
}

module.exports = {
  resolveEnv,
  addSecret,
  rotateSharedSecret,
};
