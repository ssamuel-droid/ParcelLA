import { existsSync } from 'node:fs';

const requiredFiles = [
  'public/index.html',
  'public/app.js',
  'public/landing.css',
  'public/assets/parcella-dashboard.png',
];

const missing = requiredFiles.filter((file) => !existsSync(file));

if (missing.length) {
  console.error(`Missing static deploy files: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Static public deploy ready: ${requiredFiles.join(', ')}`);
