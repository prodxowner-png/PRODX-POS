import type { Express, NextFunction, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { SqlQueryExecutor } from '../db/transaction';
import { AuditValidationError, createAuditReadService } from '../audit/audit-service';

export const registerAuditRoute = (app: Express, db: SqlQueryExecutor): void => {
  const service = createAuditReadService(db);
  app.get('/api/v1/audit/logs', requirePermission('audit.read'), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      const rawLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined;
      response.json(await service.getLogs(context.principal.storeId, rawLimit));
    } catch (error) {
      if (error instanceof AuditValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      next(error);
    }
  });

  app.post('/api/v1/audit/logs', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const requestedStoreId = typeof body.storeId === 'string' && body.storeId.trim() ? body.storeId.trim() : context.principal.storeId;
      if (requestedStoreId !== context.principal.storeId) {
        response.status(403).json({ error: { code: 'STORE_SCOPE_MISMATCH', message: 'Audit log storeId must match authenticated store scope.', requestId: request.id } });
        return;
      }
      const entry = await service.recordEvent({
        organizationId: context.principal.organizationId,
        storeId: context.principal.storeId,
        userId: context.principal.userId,
        userName: typeof body.userName === 'string' ? body.userName : undefined,
        userRole: typeof body.userRole === 'string' ? body.userRole : undefined,
        registerId: typeof body.registerId === 'string' ? body.registerId : undefined,
        action: typeof body.action === 'string' ? body.action : '',
        severity: typeof body.severity === 'string' ? body.severity : 'info',
        details: body.details,
      });
      response.status(201).json(entry);
    } catch (error) {
      if (error instanceof AuditValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      next(error);
    }
  });
  app.post('/api/v1/audit/diagnostics', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const events = body.events;
      if (!Array.isArray(events) || events.length < 1 || events.length > 100) {
        response.status(400).json({ error: { code: 'DIAGNOSTIC_BATCH_INVALID', message: 'Diagnostic batches must contain 1 to 100 events.', requestId: request.id } });
        return;
      }
      const validCategories = new Set(['printer', 'scanner', 'drawer', 'edc', 'display', 'scale', 'system', 'network']);
      const validLevels = new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL']);
      const normalized = events.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const item = raw as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const category = typeof item.category === 'string' ? item.category : '';
        const level = typeof item.level === 'string' ? item.level : '';
        const event = typeof item.event === 'string' ? item.event.trim() : '';
        const message = typeof item.message === 'string' ? item.message.trim() : '';
        if (!id || id.length > 120 || !validCategories.has(category) || !validLevels.has(level) || !event || event.length > 100 || !message || message.length > 500) return null;
        return { item, id, category, level, event, message };
      });
      if (normalized.some((item) => item === null)) {
        response.status(400).json({ error: { code: 'DIAGNOSTIC_EVENT_INVALID', message: 'Every diagnostic event must have a valid id, category, level, event name, and message.', requestId: request.id } });
        return;
      }
      const batchId = typeof body.batchId === 'string' ? body.batchId.slice(0, 120) : '';
      for (const event of normalized) {
        if (!event) continue;
        const safeEvent = event.event.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        const action = `DIAGNOSTIC_${event.category.toUpperCase()}_${safeEvent}`.slice(0, 120);
        const severity = event.level === 'WARN' ? 'warn' : event.level === 'ERROR' || event.level === 'CRITICAL' ? 'critical' : 'info';
        const details = {
          eventId: event.id,
          batchId,
          category: event.category,
          level: event.level,
          event: event.event,
          message: event.message,
          deviceName: typeof event.item.deviceName === 'string' ? event.item.deviceName.slice(0, 160) : undefined,
          peripheralId: typeof event.item.peripheralId === 'string' ? event.item.peripheralId.slice(0, 128) : undefined,
          port: typeof event.item.port === 'string' ? event.item.port.slice(0, 64) : undefined,
          interfaceType: typeof event.item.interfaceType === 'string' ? event.item.interfaceType.slice(0, 64) : undefined,
          orgId: typeof event.item.orgId === 'string' ? event.item.orgId.slice(0, 128) : undefined,
          branchId: typeof event.item.branchId === 'string' ? event.item.branchId.slice(0, 128) : undefined,
          terminalId: typeof event.item.terminalId === 'string' ? event.item.terminalId.slice(0, 128) : undefined,
          metadata: event.item.metadata && typeof event.item.metadata === 'object' && !Array.isArray(event.item.metadata) ? event.item.metadata : {},
          timestamp: typeof event.item.timestamp === 'number' && Number.isFinite(event.item.timestamp) ? event.item.timestamp : Date.now(),
          flushedAt: typeof event.item.flushedAt === 'number' && Number.isFinite(event.item.flushedAt) ? event.item.flushedAt : Date.now(),
        };
        await service.recordEvent({
          organizationId: context.principal.organizationId,
          storeId: context.principal.storeId,
          userId: context.principal.userId,
          registerId: typeof event.item.terminalId === 'string' ? event.item.terminalId : undefined,
          action,
          severity,
          details,
          sourceEventKey: `${context.principal.userId}:${event.id}`,
        });
      }
      response.status(202).json({ accepted: normalized.length, batchId: batchId || undefined });
    } catch (error) {
      if (error instanceof AuditValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      next(error);
    }
  });

};
