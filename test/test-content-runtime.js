/**
 * Test executing content.js in a simulated browser DOM environment
 */

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  location: { href: "https://www.coursera.org/learn/test-course", pathname: "/learn/test-course", hash: "" },
};
global.document = {
  readyState: "complete",
  location: global.window.location,
  body: {
    appendChild: () => {},
    contains: () => false,
  },
  documentElement: {
    appendChild: () => {},
  },
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    setAttribute: () => {},
    getAttribute: () => null,
    style: {
      setProperty: () => {},
    },
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    },
    appendChild: () => {},
    addEventListener: () => {},
    remove: () => {},
  }),
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  cookie: "CAUTH=test; CSRF3-Token=test",
};
global.location = global.document.location;
global.chrome = {
  runtime: {
    getURL: (p) => p,
    sendMessage: () => Promise.resolve(),
  },
  storage: {
    local: {
      get: (k, cb) => (cb ? cb({}) : Promise.resolve({})),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
  },
};
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
};
global.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
};
global.MutationObserver = class {
  observe() {}
};

try {
  require('../content.js');
  console.log('✅ SUCCESS: content.js parsed and initialized with 0 runtime errors!');
  process.exit(0);
} catch (e) {
  console.error('❌ RUNTIME ERROR in content.js:', e);
  process.exit(1);
}
