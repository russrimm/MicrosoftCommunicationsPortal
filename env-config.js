'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

function readOptionalFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function sharedEnvPath(cwd) {
  const gitFile = path.join(cwd, '.git');
  const entry = fs.statSync(gitFile, { throwIfNoEntry: false });
  if (!entry || !entry.isFile()) return null;

  const match = /^gitdir:\s+(.+)$/.exec(fs.readFileSync(gitFile, 'utf8').trim());
  if (!match) throw new Error(`Invalid Git worktree metadata: ${gitFile}`);
  const gitDir = path.resolve(cwd, match[1].trim());
  const commonDirFile = path.join(gitDir, 'commondir');
  const commonDirValue = readOptionalFile(commonDirFile);
  // Submodules also use a .git file, but do not share worktree configuration.
  if (commonDirValue === null) return null;
  if (!commonDirValue.trim()) throw new Error(`Invalid Git common directory: ${commonDirFile}`);

  const commonDir = path.resolve(gitDir, commonDirValue.trim());
  // A bare repository has no primary checkout whose .env we can safely reuse.
  if (path.basename(commonDir) !== '.git') return null;
  return path.join(path.dirname(commonDir), '.env');
}

function loadEnvironment({ cwd = process.cwd(), env = process.env } = {}) {
  let envPath = path.resolve(cwd, '.env');
  let contents = readOptionalFile(envPath);
  if (contents === null) {
    envPath = sharedEnvPath(cwd);
    if (!envPath) return null;
    contents = readOptionalFile(envPath);
    if (contents === null) return null;
  }

  // Select one complete file, rather than mixing credentials from two tenants.
  // Existing process variables always take precedence, as with dotenv.config().
  dotenv.populate(env, dotenv.parse(contents));
  return envPath;
}

module.exports = { loadEnvironment };
