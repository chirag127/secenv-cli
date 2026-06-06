'use strict';

const path = require('path');
const os = require('os');

/**
 * Resolve the user's home directory cross-platform.
 * Prefers USERPROFILE on Windows, HOME on Unix.
 */
function getHomeDir() {
  return (
    process.env.USERPROFILE ||
    process.env.HOME ||
    os.homedir()
  );
}

const HOME_DIR = getHomeDir();
const CONFIG_DIR = path.join(HOME_DIR, '.secenv');
const SECRETS_DIR = path.join(CONFIG_DIR, 'secrets');
const SECRETS_FILE = path.join(SECRETS_DIR, 'secrets.json');

const ENV_EXAMPLE_FILE = '.env.example';
const ENV_FILE = '.env';
const SHARED_PREFIX = 'shared.';

module.exports = {
  HOME_DIR,
  CONFIG_DIR,
  SECRETS_DIR,
  SECRETS_FILE,
  ENV_EXAMPLE_FILE,
  ENV_FILE,
  SHARED_PREFIX,
};
