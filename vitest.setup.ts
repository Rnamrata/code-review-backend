import { afterEach, beforeEach } from 'vitest';

// Some tests load a fresh copy of the app, and so of the logger, again and again. Every logger adds
// listeners to `process`, and Node warns about a leak once there are more than ten. The listeners a
// test added are removed again after it, so no test leaves anything behind.
const EVENTS = ['uncaughtException', 'unhandledRejection'] as const;
let baseline: Record<string, Function[]> | undefined;

beforeEach(() => {
  // Taken once the test file has been imported, so its own listeners count as the starting point.
  baseline ??= Object.fromEntries(EVENTS.map((event) => [event, process.listeners(event)]));
});

afterEach(() => {
  for (const event of EVENTS) {
    for (const listener of process.listeners(event)) {
      if (!baseline![event].includes(listener)) process.removeListener(event, listener);
    }
  }
});
