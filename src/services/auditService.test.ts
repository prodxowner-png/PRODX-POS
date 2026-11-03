import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BufferedAuditDiagnosticService,
  DiagnosticLogDocument,
} from './auditService';

test('AuditService — buffers diagnostic log events locally below threshold without premature API calls', () => {
  const uploadedBatches: Array<{ batchId: string; docs: DiagnosticLogDocument[] }> = [];
  const service = new BufferedAuditDiagnosticService({
    batchSizeThreshold: 5,
    autoFlushEnabled: false,
  });

  service.setCustomBatchUploader(async (docs, batchId) => {
    uploadedBatches.push({ batchId, docs });
  });

  service.logDiagnosticEvent({
    peripheralId: 'printer-01',
    deviceName: 'Epson TM-T88VI',
    category: 'printer',
    level: 'INFO',
    event: 'IO_WRITE',
    message: 'Receipt header printed',
    port: 'USB001',
  });

  service.logDiagnosticEvent({
    peripheralId: 'scanner-01',
    deviceName: 'Zebra DS9308',
    category: 'scanner',
    level: 'DEBUG',
    event: 'DECODE_EAN13',
    message: 'Barcode scanned',
    port: 'USB002',
  });

  const stats = service.getStats();
  assert.equal(stats.bufferedCount, 2);
  assert.equal(stats.totalQueuedCount, 2);
  assert.equal(stats.totalUploadedCount, 0);
  assert.equal(uploadedBatches.length, 0);
});

test('AuditService — coalesces high-traffic burst into a single batch upload and calculates API calls saved', async () => {
  const uploadedBatches: Array<{ batchId: string; docs: DiagnosticLogDocument[] }> = [];
  const service = new BufferedAuditDiagnosticService({
    batchSizeThreshold: 20,
    maxBatchSize: 100,
    autoFlushEnabled: false,
  });

  service.setCustomBatchUploader(async (docs, batchId) => {
    uploadedBatches.push({ batchId, docs });
  });

  // Simulate 25 high-traffic diagnostic events
  service.simulateHighTrafficBurst(25);

  // Wait for async auto-flush triggered by reaching batchSizeThreshold
  await new Promise((resolve) => setTimeout(resolve, 25));

  const stats = service.getStats();
  assert.equal(stats.bufferedCount, 0);
  assert.equal(stats.totalQueuedCount, 25);
  assert.equal(stats.totalUploadedCount, 25);
  assert.equal(stats.batchesCommittedCount, 1);
  assert.equal(stats.apiCallsSavedCount, 24);
  assert.equal(uploadedBatches.length, 1);
  assert.equal(uploadedBatches[0].docs.length, 25);
});

test('AuditService — retains events in local buffer on upload failure and succeeds on subsequent retry flush', async () => {
  let shouldFail = true;
  const uploadedBatches: DiagnosticLogDocument[][] = [];

  const service = new BufferedAuditDiagnosticService({
    batchSizeThreshold: 50,
    autoFlushEnabled: false,
  });

  service.setCustomBatchUploader(async (docs) => {
    if (shouldFail) {
      throw new Error('Simulated diagnostic API timeout');
    }
    uploadedBatches.push(docs);
  });

  service.logDiagnosticEvent({
    category: 'edc',
    level: 'ERROR',
    event: 'GATEWAY_TIMEOUT',
    message: 'Payment terminal TLS handshake timeout',
  });
  service.logDiagnosticEvent({
    category: 'printer',
    level: 'WARN',
    event: 'PAPER_LOW',
    message: 'Near-end paper sensor triggered',
  });

  // 1. First flush fails -> buffer must retain all 2 items with retryCount = 1
  const failedResult = await service.flush();
  assert.ok(failedResult.error?.includes('Simulated diagnostic API timeout'));
  assert.equal(service.getStats().bufferedCount, 2);
  assert.equal(service.getStats().failedFlushCount, 1);
  assert.equal(service.getStats().bufferItems[0].retryCount, 1);

  // 2. Network recovers -> second flush commits batch and empties buffer
  shouldFail = false;
  const successResult = await service.flush();
  assert.equal(successResult.error, null);
  assert.equal(successResult.uploadedCount, 2);
  assert.equal(service.getStats().bufferedCount, 0);
  assert.equal(service.getStats().totalUploadedCount, 2);
  assert.equal(uploadedBatches.length, 1);
});

test('AuditService — evicts TRACE/DEBUG logs first when local buffer reaches max capacity while preserving ERROR/CRITICAL logs', () => {
  const service = new BufferedAuditDiagnosticService({
    batchSizeThreshold: 100,
    maxLocalBufferSize: 3,
    autoFlushEnabled: false,
  });

  service.logDiagnosticEvent({
    category: 'system',
    level: 'TRACE',
    event: 'HEARTBEAT_1',
    message: 'Low priority trace 1',
  });
  service.logDiagnosticEvent({
    category: 'printer',
    level: 'CRITICAL',
    event: 'PRINTER_OVERHEAT',
    message: 'Critical thermal fault',
  });
  service.logDiagnosticEvent({
    category: 'scanner',
    level: 'DEBUG',
    event: 'SCAN_DEBUG',
    message: 'Low priority debug',
  });
  service.logDiagnosticEvent({
    category: 'drawer',
    level: 'ERROR',
    event: 'DRAWER_JAM',
    message: 'High priority drawer error',
  });

  const stats = service.getStats();
  assert.equal(stats.bufferedCount, 3);
  const events = stats.bufferItems.map((i) => i.event);
  assert.ok(events.includes('PRINTER_OVERHEAT'));
  assert.ok(events.includes('DRAWER_JAM'));
  assert.ok(!events.includes('HEARTBEAT_1'));
});
