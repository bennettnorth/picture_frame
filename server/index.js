import { networkInterfaces } from 'node:os';
import { loadConfig } from './config.js';
import { createApp, createSources } from './app.js';
import { demoSources } from './demo.js';

const config = loadConfig();
const demo = process.env.DEMO === '1';
if (demo) console.log('Demo mode: showing sample data');
createApp(config, demo ? demoSources(config.timezone) : createSources(config)).listen(config.port, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`Dashboard running:`);
  console.log(`  http://localhost:${config.port}`);
  for (const ip of ips) console.log(`  http://${ip}:${config.port}   <- point the frame here`);
});
