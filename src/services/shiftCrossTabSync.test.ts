import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShiftSyncMessage, subscribeShiftStateChanged } from './shiftCrossTabSync';

test('parseShiftSyncMessage validates well-formed shift sync payloads and rejects malformed input', () => {
  const valid = parseShiftSyncMessage({
    senderId: 'tab-remote',
    scopeKey: '["store-1","reg-1","user-1"]',
    timestamp: 1700000000000,
  });
  assert.deepEqual(valid, {
    senderId: 'tab-remote',
    scopeKey: '["store-1","reg-1","user-1"]',
    timestamp: 1700000000000,
  });

  assert.equal(parseShiftSyncMessage(null), null);
  assert.equal(parseShiftSyncMessage({ senderId: 123, scopeKey: null, timestamp: 1 }), null);
  assert.equal(parseShiftSyncMessage({ senderId: 'tab', scopeKey: 42, timestamp: 1 }), null);
});

test('subscribeShiftStateChanged receives cross-tab BroadcastChannel shift notifications', () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const listeners = new Set<(event: MessageEvent) => void>();

  class MockBroadcastChannel {
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.add(listener);
    }
    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.delete(listener);
    }
    postMessage(data: unknown) {
      listeners.forEach((listener) => listener({ data } as MessageEvent));
    }
    close() {}
  }

  globalThis.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
  try {
    const received: Array<string | null> = [];
    const unsubscribe = subscribeShiftStateChanged((scopeKey) => {
      received.push(scopeKey);
    });

    const remoteTab = new MockBroadcastChannel();
    remoteTab.postMessage({
      senderId: 'other-tab-id',
      scopeKey: '["store-1","reg-1","user-1"]',
      timestamp: Date.now(),
    });

    assert.deepEqual(received, ['["store-1","reg-1","user-1"]']);
    unsubscribe();
  } finally {
    globalThis.BroadcastChannel = originalBroadcastChannel;
  }
});
