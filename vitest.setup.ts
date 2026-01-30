// Polyfill AbortSignal for older node environments if needed
if (typeof AbortSignal === 'undefined') {
  (global as any).AbortSignal = class AbortSignal {
    aborted = false;
    onabort = null;
    addEventListener() {}
    removeEventListener() {}
  };
}

// Suppress known jsdom errors
const originalConsoleError = console.error;
console.error = (...args) => {
  if (args[0] && args[0].includes && args[0].includes('Error: boom')) return;
  if (args[0] && args[0].includes && args[0].includes('Error: Worker exited unexpectedly')) return;
  originalConsoleError(...args);
};
