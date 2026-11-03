import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import { infrastructureAiService } from '../services/infrastructureAiService';
import { firmwareRegistryService } from '../services/firmwareRegistryService';
import { performEndToEndHealthCheck } from '../services/systemHealthCheckService';
import { requirePermission } from './createApp';
import { GoogleGenAI } from '@google/genai';

export function registerPublicInfrastructureRoutes(app: Express, pool?: Pool) {
  // End-to-end ping of the production PostgreSQL database and the optional legacy Firestore dependency.
  app.get('/api/v1/infrastructure/system-health-check', async (req: Request, res: Response) => {
    try {
      const requestId = (req.headers['x-request-id'] as string) || req.id || `req-${Date.now()}`;
      const result = await performEndToEndHealthCheck(pool, requestId);
      res.status(result.statusCode).json({
        success: result.statusCode === 200 || result.statusCode === 207,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        statusCode: 500,
        status: 'DOWN',
        error: error.message || 'System health check execution failed',
      });
    }
  });

  app.post('/api/v1/infrastructure/system-health-check', async (req: Request, res: Response) => {
    try {
      const requestId = (req.headers['x-request-id'] as string) || req.id || `req-${Date.now()}`;
      const result = await performEndToEndHealthCheck(pool, requestId);
      res.status(result.statusCode).json({
        success: result.statusCode === 200 || result.statusCode === 207,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        statusCode: 500,
        status: 'DOWN',
        error: error.message || 'System health check execution failed',
      });
    }
  });

  // High-precision real-time latency ping with performance.now() timestamps
  app.get('/api/v1/infrastructure/latency-ping', async (req: Request, res: Response) => {
    const serverReceiveTime = performance.now();
    const clientSentTimestamp = req.query.clientTime ? Number(req.query.clientTime) : undefined;

    // PostgreSQL query ping with server-side performance.now()
    let sqlQueryDurationMs = 0;
    let sqlSuccess = false;
    let sqlError: string | undefined;

    const sqlQueryStart = performance.now();
    if (pool) {
      try {
        await pool.query('SELECT 1 AS ping');
        sqlQueryDurationMs = Number((performance.now() - sqlQueryStart).toFixed(2));
        sqlSuccess = true;
      } catch (err: any) {
        sqlQueryDurationMs = Number((performance.now() - sqlQueryStart).toFixed(2));
        sqlError = err?.message || 'PostgreSQL query failed';
      }
    } else {
      sqlError = 'PostgreSQL pool not available';
    }

    // Firebase/Firestore has been retired. Do not make network calls to the old provider.
    const firestoreDurationMs = 0;
    const firestoreSuccess = false;

    const serverProcessTimeMs = Number((performance.now() - serverReceiveTime).toFixed(2));

    res.json({
      success: sqlSuccess,
      serverReceiveTimestamp: serverReceiveTime,
      serverTimestampIso: new Date().toISOString(),
      clientSentTimestamp,
      serverProcessTimeMs,
      cloudSql: {
        success: sqlSuccess,
        queryDurationMs: sqlQueryDurationMs,
        error: sqlError,
        engine: 'PostgreSQL (Supabase session pooler)',
        region: 'ap-southeast-1',
        projectId: 'wcyqyiewbzpmrekoljfw',
      },
      firestoreBackend: {
        success: firestoreSuccess,
        probeDurationMs: firestoreDurationMs,
        databaseId: 'retired',
        region: 'retired',
        disabled: true,
      },
    });
  });
}

export function registerInfrastructureRoutes(app: Express, pool?: Pool) {
  registerPublicInfrastructureRoutes(app, pool);

  // Enforce RBAC permission 'settings.manage' on all hardware/firmware/infrastructure management routes
  // (excluding public system-health-check and latency-ping probes)
  const enforceInfraRbac = requirePermission('settings.manage');
  app.use('/api/v1/infrastructure', (req, res, next) => {
    if (req.path === '/system-health-check' || req.path === '/latency-ping') {
      next();
      return;
    }
    void enforceInfraRbac(req, res, next);
  });

  // Get system infrastructure health
  app.get('/api/v1/infrastructure/health', (_req: Request, res: Response) => {
    try {
      const health = infrastructureAiService.getSystemHealth();
      res.json({ success: true, data: health });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch infrastructure health' });
    }
  });

  // Trigger Antigravity AI autonomous self-heal
  app.post('/api/v1/infrastructure/self-heal', async (_req: Request, res: Response) => {
    try {
      const result = await infrastructureAiService.runAntigravitySelfHeal();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Self-heal execution failed' });
    }
  });

  // Get connected Plug & Play devices
  app.get('/api/v1/infrastructure/devices', (_req: Request, res: Response) => {
    try {
      const devices = infrastructureAiService.getDevices();
      res.json({ success: true, data: devices });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch devices' });
    }
  });

  // Scan Plug & Play devices
  app.post('/api/v1/infrastructure/devices/scan', async (_req: Request, res: Response) => {
    try {
      const result = await infrastructureAiService.scanPlugAndPlayDevices();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Device scan failed' });
    }
  });

  // Auto-update device driver
  app.post('/api/v1/infrastructure/devices/update-driver', async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.body;
      if (!deviceId) {
        return res.status(400).json({ success: false, error: 'deviceId is required' });
      }
      const result = await infrastructureAiService.updateDeviceDriver(deviceId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Driver update failed' });
    }
  });

  // Get automated firmware/security advisory alerts
  app.get('/api/v1/infrastructure/firmware-alerts', (_req: Request, res: Response) => {
    try {
      const alerts = firmwareRegistryService.getAlerts();
      res.json({ success: true, data: alerts });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch firmware alerts' });
    }
  });

  // Check hardware signatures against remote registry
  app.post('/api/v1/infrastructure/firmware-check', (_req: Request, res: Response) => {
    try {
      const devices = infrastructureAiService.getDevices();
      const alerts = firmwareRegistryService.checkHardwareSignatures(devices);
      res.json({ success: true, data: alerts });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Firmware check failed' });
    }
  });

  // Bulk firmware check across all connected peripherals
  app.post('/api/v1/infrastructure/firmware-check/bulk', async (_req: Request, res: Response) => {
    try {
      const result = await infrastructureAiService.runBulkFirmwareCheck();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Bulk firmware check failed' });
    }
  });

  // Staged firmware update routine for outdated peripherals
  app.post('/api/v1/infrastructure/firmware-update/staged', async (req: Request, res: Response) => {
    try {
      const { peripheralId } = req.body || {};
      const result = await infrastructureAiService.applyStagedFirmwareUpdate(peripheralId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Staged firmware update routine failed' });
    }
  });

  // Remote power cycle / reboot peripheral
  app.post('/api/v1/infrastructure/hardware-peripherals/reboot', (req: Request, res: Response) => {
    try {
      const { peripheralId } = req.body || {};
      if (!peripheralId) {
        return res.status(400).json({ success: false, error: 'peripheralId is required' });
      }
      const result = infrastructureAiService.rebootPeripheral(peripheralId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Remote reboot failed' });
    }
  });

  // Get device profiles for store roles
  app.get('/api/v1/infrastructure/device-profiles', (_req: Request, res: Response) => {
    try {
      const result = infrastructureAiService.getDeviceProfiles();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch device profiles' });
    }
  });

  // Apply device profile configuration
  app.post('/api/v1/infrastructure/device-profiles/apply', (req: Request, res: Response) => {
    try {
      const { profileId } = req.body || {};
      if (!profileId) {
        return res.status(400).json({ success: false, error: 'profileId is required' });
      }
      const result = infrastructureAiService.applyDeviceProfile(profileId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to apply device profile' });
    }
  });

  // Automated reconnect / handshake recovery for offline peripheral
  app.post('/api/v1/infrastructure/hardware-peripherals/reconnect', (req: Request, res: Response) => {
    try {
      const { peripheralId } = req.body || {};
      if (!peripheralId) {
        return res.status(400).json({ success: false, error: 'peripheralId is required' });
      }
      const result = infrastructureAiService.reconnectPeripheral(peripheralId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Automated reconnect failed' });
    }
  });

  // Bulk reboot selected peripherals simultaneously
  app.post('/api/v1/infrastructure/hardware-peripherals/bulk-reboot', (req: Request, res: Response) => {
    try {
      const { peripheralIds } = req.body || {};
      if (!Array.isArray(peripheralIds) || peripheralIds.length === 0) {
        return res.status(400).json({ success: false, error: 'peripheralIds array is required' });
      }
      const result = infrastructureAiService.bulkRebootPeripherals(peripheralIds);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Bulk remote reboot failed' });
    }
  });

  // Toggle maintenance mode for a peripheral
  app.post('/api/v1/infrastructure/hardware-peripherals/maintenance-mode', (req: Request, res: Response) => {
    try {
      const { peripheralId, enabled } = req.body || {};
      if (!peripheralId) {
        return res.status(400).json({ success: false, error: 'peripheralId is required' });
      }
      const result = infrastructureAiService.toggleMaintenanceMode(peripheralId, !!enabled);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to toggle maintenance mode' });
    }
  });

  // Apply critical firmware / security patch
  app.post('/api/v1/infrastructure/apply-patch', (req: Request, res: Response) => {
    try {
      const { alertId } = req.body;
      if (!alertId) {
        return res.status(400).json({ success: false, error: 'alertId is required' });
      }
      const result = firmwareRegistryService.applySecurityPatch(alertId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Security patch application failed' });
    }
  });

  // Get discovered USB / Bluetooth peripherals
  app.get('/api/v1/infrastructure/peripheral-discovery', (_req: Request, res: Response) => {
    try {
      const peripherals = infrastructureAiService.getDiscoveredPeripherals();
      res.json({ success: true, data: peripherals });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch discovered peripherals' });
    }
  });

  // Scan USB and Bluetooth ports for new POS peripherals
  app.post('/api/v1/infrastructure/peripheral-discovery/scan', async (_req: Request, res: Response) => {
    try {
      const result = await infrastructureAiService.scanAndDiscoverPeripherals();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'USB/Bluetooth peripheral port scan failed' });
    }
  });

  // Auto-configure peripheral
  app.post('/api/v1/infrastructure/peripheral-autoconfig', async (req: Request, res: Response) => {
    try {
      const { peripheralId } = req.body;
      if (!peripheralId) {
        return res.status(400).json({ success: false, error: 'peripheralId is required' });
      }
      const result = await infrastructureAiService.autoConfigurePeripheral(peripheralId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Auto-configuration failed' });
    }
  });

  // Get real-time status of all detected hardware peripherals (printers, scanners, drawers)
  app.get('/api/v1/infrastructure/hardware-peripherals', (_req: Request, res: Response) => {
    try {
      const peripherals = infrastructureAiService.getHardwarePeripherals();
      res.json({ success: true, data: peripherals });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch hardware peripherals' });
    }
  });

  // Update physical location tags for a peripheral
  app.post('/api/v1/infrastructure/hardware-peripherals/tags', (req: Request, res: Response) => {
    try {
      const { peripheralId, tags } = req.body || {};
      if (!peripheralId || !Array.isArray(tags)) {
        return res.status(400).json({ success: false, error: 'peripheralId and tags array are required' });
      }
      const updated = infrastructureAiService.updatePeripheralTags(peripheralId, tags);
      res.json({ success: true, data: updated, peripherals: infrastructureAiService.getHardwarePeripherals() });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to update peripheral tags' });
    }
  });

  // Rename peripheral label
  app.post('/api/v1/infrastructure/hardware-peripherals/rename', (req: Request, res: Response) => {
    try {
      const { peripheralId, name } = req.body || {};
      if (!peripheralId || !name) {
        return res.status(400).json({ success: false, error: 'peripheralId and name are required' });
      }
      const updated = infrastructureAiService.updatePeripheralName(peripheralId, name);
      res.json({ success: true, data: updated, peripherals: infrastructureAiService.getHardwarePeripherals() });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to rename peripheral' });
    }
  });

  // Toggle Power Save (Eco Sleep) mode for a peripheral
  app.post('/api/v1/infrastructure/hardware-peripherals/powersave', (req: Request, res: Response) => {
    try {
      const { peripheralId, enabled } = req.body || {};
      if (!peripheralId || typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'peripheralId and boolean enabled parameter are required' });
      }
      const updated = infrastructureAiService.togglePowerSaveMode(peripheralId, enabled);
      res.json({ success: true, data: updated, peripherals: infrastructureAiService.getHardwarePeripherals() });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to toggle power save mode' });
    }
  });

  // Antigravity AI on-demand peripheral & driver health audit
  app.post('/api/v1/infrastructure/hardware-peripherals/audit', async (req: Request, res: Response) => {
    try {
      const { peripheralId } = req.body || {};
      const result = await infrastructureAiService.runPeripheralHealthAudit(peripheralId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Hardware peripheral audit failed' });
    }
  });

  // Simulated hardware connection handshake diagnostics
  app.post('/api/v1/infrastructure/hardware-peripherals/diagnostics-handshake', async (req: Request, res: Response) => {
    try {
      const { peripheralId, simulateFailure } = req.body || {};
      if (!peripheralId) {
        return res.status(400).json({ success: false, error: 'peripheralId is required for diagnostics handshake' });
      }
      const result = await infrastructureAiService.runConnectionHandshake(peripheralId, simulateFailure);
      if (!result.success) {
        return res.status(502).json(result);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Diagnostics handshake failed' });
    }
  });

  // Run comprehensive hardware test suite for printers, scanners, and cash drawers
  app.post('/api/v1/infrastructure/hardware-test-suite/run', async (req: Request, res: Response) => {
    try {
      const { category, simulateFaultDeviceId, simulateFaultAll } = req.body || {};
      const suiteSummary = await infrastructureAiService.runHardwareTestSuite({
        category,
        simulateFaultDeviceId,
        simulateFaultAll,
      });
      res.json({ success: true, data: suiteSummary });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Hardware test suite run failed' });
    }
  });

  // Get latest hardware test suite results
  app.get('/api/v1/infrastructure/hardware-test-suite/latest', async (_req: Request, res: Response) => {
    try {
      let suite = infrastructureAiService.getLatestTestSuiteSummary();
      if (!suite) {
        suite = await infrastructureAiService.runHardwareTestSuite();
      }
      res.json({ success: true, data: suite });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch test suite results' });
    }
  });

  // Test a single hardware device on-demand
  app.post('/api/v1/infrastructure/hardware-test-suite/device', async (req: Request, res: Response) => {
    try {
      const { deviceId, simulateFault } = req.body || {};
      if (!deviceId) {
        return res.status(400).json({ success: false, error: 'deviceId is required' });
      }
      const suite = await infrastructureAiService.runHardwareTestSuite({
        simulateFaultDeviceId: simulateFault ? deviceId : undefined,
      });
      const deviceResult = suite.results.find((r) => r.peripheralId === deviceId);
      res.json({ success: true, data: deviceResult, suiteSummary: suite });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Single hardware device test failed' });
    }
  });

  // Gemini Frontend AI Assistant Endpoint
  app.post('/api/v1/ai/frontend-assistant', async (req: Request, res: Response) => {
    try {
      const { prompt, history } = req.body;
      if (!prompt) {
        return res.status(400).json({ success: false, error: 'prompt is required' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        // Fallback intelligent POS assistant response if API key is not set
        return res.json({
          success: true,
          response: `ยินดีต้อนรับครับ! ในฐานะ Gemini AI Assistant ประจำ PRODX-POS ผมพร้อมช่วยเหลือคุณในการใช้งานระบบ POS, การจัดการสต็อก, การชำระเงิน หรือการตรวจสอบอุปกรณ์ครับ (หมายเหตุ: กรุณาตั้งค่า GEMINI_API_KEY เพื่อเปิดใช้งานความสามารถเต็มรูปแบบ)`,
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const interaction = await ai.interactions.create({
        model: 'gemini-3.8-flash',
        system_instruction: 'You are the intelligent frontend AI assistant for PRODX-POS, a professional Point of Sale system. Assist cashiers and store managers in polite, professional Thai language regarding POS operations, sales, refunds, inventory, and hardware.',
        input: prompt,
      });

      const responseText = interaction.output_text || 'ขออภัยครับ ไม่สามารถประมวลผลคำตอบได้ในขณะนี้';
      res.json({ success: true, response: responseText });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'AI Assistant request failed' });
    }
  });
}
