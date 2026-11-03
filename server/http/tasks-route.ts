import crypto from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { requirePermission } from './createApp';
import type { SqlQueryExecutor } from '../db/transaction';

type TaskRow = Record<string, unknown> & {
  id: string;
  user_id: string;
  title: string;
  description: string;
  completed: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const toTask = (row: TaskRow) => ({
  id: row.id,
  ownerId: row.user_id,
  title: row.title,
  description: row.description,
  completed: row.completed,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});
const sendError = (response: Response, request: Request, status: number, code: string, message: string) =>
  response.status(status).json({ error: { code, message, requestId: request.id } });

export const registerTasksRoute = (app: Express, db: SqlQueryExecutor): void => {
  app.get('/api/v1/tasks', requirePermission('dashboard.read'), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) { sendError(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.'); return; }
      const result = await db.query<TaskRow>(
        `SELECT id, user_id, title, description, completed, created_at, updated_at
           FROM public.prodx_tasks
          WHERE organization_id = $1 AND store_id = $2 AND user_id = $3
          ORDER BY created_at DESC, id`,
        [context.principal.organizationId, context.principal.storeId, context.principal.userId],
      );
      response.json(result.rows.map(toTask));
    } catch (error) { next(error); }
  });

  app.post('/api/v1/tasks', requirePermission('dashboard.read'), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) { sendError(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.'); return; }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID();
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description : '';
      if (!uuidPattern.test(id)) { sendError(response, request, 400, 'TASK_ID_INVALID', 'Task id must be a UUID.'); return; }
      if (!title || title.length > 200) { sendError(response, request, 400, 'TASK_TITLE_INVALID', 'Task title must contain 1 to 200 characters.'); return; }
      if (description.length > 1000) { sendError(response, request, 400, 'TASK_DESCRIPTION_INVALID', 'Task description cannot exceed 1000 characters.'); return; }
      await db.query(
        `INSERT INTO public.prodx_tasks (id, organization_id, store_id, user_id, title, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, context.principal.organizationId, context.principal.storeId, context.principal.userId, title, description],
      );
      const result = await db.query<TaskRow>(
        `SELECT id, user_id, title, description, completed, created_at, updated_at
           FROM public.prodx_tasks
          WHERE id = $1 AND organization_id = $2 AND store_id = $3 AND user_id = $4
          LIMIT 1`,
        [id, context.principal.organizationId, context.principal.storeId, context.principal.userId],
      );
      const row = result.rows[0];
      if (!row) { sendError(response, request, 409, 'TASK_ID_CONFLICT', 'Task id already exists outside this user scope.'); return; }
      response.status(201).json(toTask(row));
    } catch (error) { next(error); }
  });

  app.patch('/api/v1/tasks/:taskId', requirePermission('dashboard.read'), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) { sendError(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.'); return; }
      if (!uuidPattern.test(request.params.taskId)) { sendError(response, request, 400, 'TASK_ID_INVALID', 'Task id must be a UUID.'); return; }
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.completed !== 'boolean') { sendError(response, request, 400, 'TASK_COMPLETION_INVALID', 'completed must be a boolean.'); return; }
      const result = await db.query<TaskRow>(
        `UPDATE public.prodx_tasks SET completed = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND organization_id = $3 AND store_id = $4 AND user_id = $5
          RETURNING id, user_id, title, description, completed, created_at, updated_at`,
        [body.completed, request.params.taskId, context.principal.organizationId, context.principal.storeId, context.principal.userId],
      );
      if (!result.rows[0]) { sendError(response, request, 404, 'TASK_NOT_FOUND', 'Task was not found in the authenticated user scope.'); return; }
      response.json(toTask(result.rows[0]));
    } catch (error) { next(error); }
  });

  app.delete('/api/v1/tasks/:taskId', requirePermission('dashboard.read'), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = request.prodxContext;
      if (!context) { sendError(response, request, 500, 'REQUEST_CONTEXT_MISSING', 'Request context is required.'); return; }
      if (!uuidPattern.test(request.params.taskId)) { sendError(response, request, 400, 'TASK_ID_INVALID', 'Task id must be a UUID.'); return; }
      const result = await db.query(
        `DELETE FROM public.prodx_tasks
          WHERE id = $1 AND organization_id = $2 AND store_id = $3 AND user_id = $4
          RETURNING id`,
        [request.params.taskId, context.principal.organizationId, context.principal.storeId, context.principal.userId],
      );
      if (!result.rows[0]) { sendError(response, request, 404, 'TASK_NOT_FOUND', 'Task was not found in the authenticated user scope.'); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });
};
