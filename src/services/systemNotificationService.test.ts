import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePeripheralAlertState,
  systemNotificationService,
} from './systemNotificationService';
import type { HardwarePeripheralStatus } from '../types/hardware';

function createMockPeripheral(
  overrides: Partial<HardwarePeripheralStatus> = {},
): HardwarePeripheralStatus {
  return {
    id: 'periph-printer-01',
    name: 'Epson TM-T88VI Receipt Printer',
    category: 'printer',
    model: 'TM-T88VI',
    serialNumber: 'EPS-886-001',
    port: 'USB001',
    firmwareVersion: 'v4.12',
    driverVersion: 'v3.2.0',
    latestDriverVersion: 'v3.2.0',
    connectivity: {
      state: 'online',
      interface: 'USB',
      latencyMs: 3,
      lastPingTimestamp: new Date().toISOString(),
    },
    battery: {
      levelPercent: null,
      isCharging: false,
      powerSource: 'ac_mains',
    },
    driverHealth: {
      status: 'healthy',
      integrityVerifiedByAntigravity: true,
      lastAuditTimestamp: new Date().toISOString(),
      driverSignStatus: 'whql_certified',
      diagnostics: 'All ESC/POS buffers nominal',
    },
    predictiveAnalysis: {
      reliabilityScore: 99,
      estimatedTimeToFailureDays: null,
      maintenanceRecommended: false,
      analysisInsight: 'Healthy',
    },
    lastActivity: new Date().toISOString(),
    telemetryData: {
      operationsCountToday: 128,
      errorCountToday: 0,
      historicalErrorCount: 0,
    },
    tags: ['Counter 1'],
    ...overrides,
  };
}

test('SystemNotificationService — resolves online, offline, error, and maintenance states accurately', () => {
  const healthy = createMockPeripheral();
  assert.equal(resolvePeripheralAlertState(healthy, 'idle'), 'online');

  const disconnected = createMockPeripheral({
    connectivity: {
      ...healthy.connectivity,
      state: 'disconnected',
    },
  });
  assert.equal(resolvePeripheralAlertState(disconnected, 'idle'), 'offline');

  const erroredPulse = createMockPeripheral();
  assert.equal(resolvePeripheralAlertState(erroredPulse, 'error'), 'error');

  const maintenance = createMockPeripheral({
    isMaintenanceMode: true,
    connectivity: {
      ...healthy.connectivity,
      state: 'disconnected',
    },
  });
  assert.equal(resolvePeripheralAlertState(maintenance, 'error'), 'maintenance');
});

test('SystemNotificationService — emits toast notification when peripheral transitions from Online to Offline or Error', () => {
  systemNotificationService.resetState();

  const receivedCounts: number[] = [];
  const unsubscribe = systemNotificationService.subscribe((payload) => {
    receivedCounts.push(payload.notifications.length);
  });

  const printer = createMockPeripheral({ id: 'printer-1', name: 'Epson Main Printer' });
  const scanner = createMockPeripheral({
    id: 'scanner-1',
    name: 'Zebra 2D Scanner',
    category: 'scanner',
    port: 'USB002',
  });

  // 1. Initial healthy baseline -> 0 notifications
  const initialTriggered = systemNotificationService.evaluatePeripherals([printer, scanner]);
  assert.equal(initialTriggered.length, 0);
  assert.equal(systemNotificationService.getNotifications().length, 0);

  // 2. Scanner transitions to 'Offline' (disconnected)
  const offlineScanner: HardwarePeripheralStatus = {
    ...scanner,
    connectivity: {
      ...scanner.connectivity,
      state: 'disconnected',
    },
  };
  const offlineTriggered = systemNotificationService.evaluatePeripherals([printer, offlineScanner]);
  assert.equal(offlineTriggered.length, 1);
  assert.equal(offlineTriggered[0].status, 'offline');
  assert.equal(offlineTriggered[0].peripheralId, 'scanner-1');
  assert.equal(systemNotificationService.getNotifications().length, 1);

  // 3. Re-evaluating same state does NOT emit duplicate notifications
  const duplicateCheck = systemNotificationService.evaluatePeripherals([printer, offlineScanner]);
  assert.equal(duplicateCheck.length, 0);
  assert.equal(systemNotificationService.getNotifications().length, 1);

  // 4. Printer transitions to 'Error' (degraded driver / error count > 0)
  const errorPrinter: HardwarePeripheralStatus = {
    ...printer,
    driverHealth: {
      ...printer.driverHealth,
      status: 'degraded',
    },
    telemetryData: {
      ...printer.telemetryData,
      errorCountToday: 1,
    },
  };
  const errorTriggered = systemNotificationService.evaluatePeripherals([
    errorPrinter,
    offlineScanner,
  ]);
  assert.equal(errorTriggered.length, 1);
  assert.equal(errorTriggered[0].status, 'error');
  assert.equal(errorTriggered[0].peripheralId, 'printer-1');
  assert.equal(systemNotificationService.getNotifications().length, 2);

  // 5. Scanner recovers back to 'Online' -> replaces offline toast with recovered toast
  const recoveredTriggered = systemNotificationService.evaluatePeripherals([
    errorPrinter,
    scanner,
  ]);
  assert.equal(recoveredTriggered.length, 1);
  assert.equal(recoveredTriggered[0].status, 'recovered');
  assert.equal(recoveredTriggered[0].peripheralId, 'scanner-1');

  // 6. Dismiss all notifications
  systemNotificationService.clearAllNotifications();
  assert.equal(systemNotificationService.getNotifications().length, 0);
  assert.equal(systemNotificationService.getHistory().length, 3);

  unsubscribe();
  assert.ok(receivedCounts.length > 0);
});
