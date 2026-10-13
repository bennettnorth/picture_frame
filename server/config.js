import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Values like "$GCAL_FAMILY_ICS" are read from the environment so secrets stay out of config.json.
function resolveEnv(value) {
  if (typeof value === 'string' && value.startsWith('$')) {
    return process.env[value.slice(1)] || '';
  }
  if (Array.isArray(value)) return value.map(resolveEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnv(v)]));
  }
  return value;
}

export function loadConfig(file = process.env.CONFIG || path.join(root, 'config.json')) {
  const envFile = path.join(root, '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

  if (!existsSync(file)) throw new Error(`Config file ${file} not found`);
  const config = resolveEnv(JSON.parse(readFileSync(file, 'utf8')));
  config.port = Number(process.env.PORT || config.port || 8080);
  config.timezone = config.timezone || 'America/New_York';
  // When set, /api/dashboard requires ?key=<value>, so a public URL doesn't expose your calendar.
  config.accessKey = process.env.DASHBOARD_KEY || '';
  return config;
}

export const ROOT = root;
