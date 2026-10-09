const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const outputDir = path.join(projectDir, 'dist');
const frontendEntries = [
  'admin',
  'assets',
  'index.html',
  'login.html',
  'logo.png',
  'manifest.json'
];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const entry of frontendEntries) {
  fs.cpSync(path.join(projectDir, entry), path.join(outputDir, entry), {
    recursive: true
  });
}

console.log(`Frontend preparado em ${outputDir}`);
