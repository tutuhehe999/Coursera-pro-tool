/**
 * Coursera Pro Tool - Build Script
 * Concatenates all modules into a single content script
 * Run: node build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'dist');

// Files to concat (order matters - utils first, then modules, then UI, then main)
const files = [
  'utils/dom.js',
  'utils/metadata.js',
  'utils/ai.js',
  'utils/coursera-api.js',
  'ui/panel.js',
  'modules/bypass.js',
  'modules/quiz.js',
  'modules/discussion.js',
  'modules/review.js',
  'modules/grading.js',
  'modules/assignment.js',
  'modules/autopilot.js',
  'content/main.js',
];

// Create dist directory
if (!fs.existsSync(OUTPUT)) {
  fs.mkdirSync(OUTPUT, { recursive: true });
}

let bundled = '/* Coursera Pro Tool - Bundled Content Script */\n(function() {\n"use strict";\n\n';

for (const file of files) {
  const filePath = path.join(ROOT, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Remove import/export statements (both single-line and multi-line)
  content = content.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?\s*/g, '');
  content = content.replace(/import\s+[\s\S]*?from\s*['"][^'"]+['"];?\s*/g, '');
  content = content.replace(/import\s+['"][^'"]+['"];?\s*/g, '');
  content = content.replace(/^import\s+.*$/gm, '');
  content = content.replace(/^export\s+(async\s+)?function\s+/gm, '$1function ');
  content = content.replace(/^export\s+(const|let|var|class)\s+/gm, '$1 ');
  content = content.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
  content = content.replace(/^export\s+default\s+/gm, '');

  bundled += `\n// ====== ${file} ======\n${content}\n`;
}

bundled += '\n})();\n';

// Write bundled content script to dist and root
fs.writeFileSync(path.join(OUTPUT, 'content.js'), bundled);
fs.writeFileSync(path.join(ROOT, 'content.js'), bundled);

// Copy other files to dist
const copyFiles = [
  ['manifest.json', 'manifest.json'],
  ['background/service-worker.js', 'background/service-worker.js'],
  ['inject/script.js', 'inject/script.js'],
  ['ui/styles.css', 'ui/styles.css'],
  ['popup/popup.html', 'popup/popup.html'],
  ['popup/popup.js', 'popup/popup.js'],
  ['popup/popup.css', 'popup/popup.css'],
  ['welcome/welcome.html', 'welcome/welcome.html'],
  ['icons/icon-16.png', 'icons/icon-16.png'],
  ['icons/icon-48.png', 'icons/icon-48.png'],
  ['icons/icon-128.png', 'icons/icon-128.png'],
  ['icons/cyber-orb.png', 'icons/cyber-orb.png'],
];

for (const [src, dest] of copyFiles) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(OUTPUT, dest);
  const destDir = path.dirname(destPath);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
  }
}

// Update both manifests to point to bundled content script
for (const dir of [ROOT, OUTPUT]) {
  const mPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(mPath)) {
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    manifest.content_scripts[0].js = ['content.js'];
    manifest.content_scripts[0].css = ['ui/styles.css'];
    fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  }
}

console.log('✅ Build complete! Both root and dist/ are ready to load.');

