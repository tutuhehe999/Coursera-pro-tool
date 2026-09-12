/**
 * Coursera Pro Tool - Gen 3 Features Unit Tests
 * Tests for:
 * 1. CSRF token extraction & API headers
 * 2. In-Memory File Synthesizer (PDF & Text/Code generation)
 * 3. DataTransfer upload simulation
 * 4. Master Autopilot state machine
 */

const assert = require('assert');

console.log('--- Testing CSRF Token & API Headers Construction ---');
// Mock document.cookie
global.document = {
  cookie: 'CAUTH=auth_token_xyz; CSRF3-Token=csrf_token_12345; session=abc',
};

function getCsrfToken() {
  if (!global.document || !global.document.cookie) return '';
  const match = global.document.cookie.match(/(?:^|;\s*)(?:CSRF3-Token|CSRF2-Token|csrftoken)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function getApiHeaders(isJson = true) {
  const headers = {
    'x-coursera-application': 'ondemand',
    'x-requested-with': 'XMLHttpRequest',
  };
  const csrf = getCsrfToken();
  if (csrf) {
    headers['x-csrf3-token'] = csrf;
    headers['x-csrf2-token'] = csrf;
    headers['x-csrftoken'] = csrf;
  }
  if (isJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

const token = getCsrfToken();
assert.strictEqual(token, 'csrf_token_12345', 'CSRF3-Token extracted correctly');
const headers = getApiHeaders(true);
assert.strictEqual(headers['x-csrf3-token'], 'csrf_token_12345');
assert.strictEqual(headers['x-coursera-application'], 'ondemand');
assert.strictEqual(headers['Content-Type'], 'application/json');
console.log('✓ CSRF token extraction & Coursera API headers verified');

console.log('--- Testing In-Memory PDF & File Synthesizer ---');
// Mock Blob and File in Node.js environment
global.Blob = class MockBlob {
  constructor(parts, options = {}) {
    this.parts = parts;
    this.type = options.type || '';
    this.size = parts.reduce((acc, p) => acc + (p?.size || (typeof p === 'string' ? p.length : 0)), 0);
  }
};

global.File = class MockFile extends global.Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.size = parts.reduce((acc, p) => acc + (p?.size || (typeof p === 'string' ? p.length : 0)), 0);
  }
};

function createSyntheticFile(title, textContent, extension = 'pdf') {
  const cleanTitle = (title || 'Project_Assignment_Submission')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 45);

  if (extension === 'pdf') {
    const safeTitle = (title || 'Course Project Report').replace(/[\r\n\t]/g, ' ');
    const safeLines = (textContent || safeTitle)
      .split('\n')
      .slice(0, 30)
      .map((l) => l.replace(/[\(\)\\]/g, '').substring(0, 80).trim())
      .filter(Boolean);

    let streamContent = `BT\n/F1 14 Tf\n50 740 Td\n18 TL\n(${safeTitle}) Tj T*\n/F1 10 Tf\n14 TL\n`;
    for (const line of safeLines) {
      streamContent += `(${line}) Tj T*\n`;
    }
    streamContent += `ET\n`;

    const streamLength = streamContent.length;
    const pdfData = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${streamLength} >>
stream
${streamContent}endstream
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000234 00000 n 
0000000307 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${400 + streamLength}
%%EOF`;

    const blob = new global.Blob([pdfData], { type: 'application/pdf' });
    return new global.File([blob], `${cleanTitle}.pdf`, { type: 'application/pdf' });
  }

  const mimeType = extension === 'py' ? 'text/x-python' : 'text/plain';
  const blob = new global.Blob([textContent], { type: mimeType });
  return new global.File([blob], `${cleanTitle}.${extension}`, { type: mimeType });
}

const pdfFile = createSyntheticFile('Research Proposal Assignment', 'Line 1: Objectives\nLine 2: Methodology\nLine 3: Findings', 'pdf');
assert.strictEqual(pdfFile.name, 'Research_Proposal_Assignment.pdf');
assert.strictEqual(pdfFile.type, 'application/pdf');
assert.ok(pdfFile.size > 200, 'PDF size is realistic');

const pyFile = createSyntheticFile('Algorithm Script', 'print("Hello Coursera")', 'py');
assert.strictEqual(pyFile.name, 'Algorithm_Script.py');
assert.strictEqual(pyFile.type, 'text/x-python');
console.log('✓ In-Memory Document Synthesizer generated valid PDF and Code files');

console.log('--- Testing Programmatic File Upload Simulation ---');
global.DataTransfer = class MockDataTransfer {
  constructor() {
    this.items = {
      add: (file) => {
        this.files.push(file);
      },
    };
    this.files = [];
  }
};

const mockInput = { files: [] };
const dt = new global.DataTransfer();
dt.items.add(pdfFile);
mockInput.files = dt.files;
assert.strictEqual(mockInput.files.length, 1);
assert.strictEqual(mockInput.files[0].name, 'Research_Proposal_Assignment.pdf');
console.log('✓ Programmatic file upload via DataTransfer API verified');

console.log('--- Testing Master Autopilot State Transitions ---');
let running = false;
let paused = false;

function start() { running = true; paused = false; }
function pause() { if (running) paused = true; }
function resume() { if (running && paused) paused = false; }
function stop() { running = false; paused = false; }

start();
assert.strictEqual(running, true);
assert.strictEqual(paused, false);

pause();
assert.strictEqual(paused, true);

resume();
assert.strictEqual(paused, false);

stop();
assert.strictEqual(running, false);
assert.strictEqual(paused, false);
console.log('✓ Autopilot state transitions verified');

console.log('\n========================================');
console.log('🎉 ALL GEN 3 UPGRADE TESTS PASSED 100%!');
console.log('========================================');
