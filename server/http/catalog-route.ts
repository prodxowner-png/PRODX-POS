import type { Express, Request, Response } from 'express';
import { requirePermission } from './createApp';
import type { SqlQueryExecutor } from '../db/transaction';
import { createCatalogReadService, CatalogValidationError } from '../catalog/catalog-service';

export const registerCatalogRoute = (
  app: Express,
  db: SqlQueryExecutor,
  permission = 'catalog:read',
): void => {
  const service = createCatalogReadService(db);

  app.get('/api/v1/catalog/categories', requirePermission(permission), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      response.json(await service.getCategories(context.principal.storeId));
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      throw error;
    }
  });

  app.get('/api/v1/catalog/products', requirePermission(permission), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      response.json(await service.getProducts(
        context.principal.storeId,
        typeof request.query.categoryId === 'string' ? request.query.categoryId : undefined,
        typeof request.query.search === 'string' ? request.query.search : undefined,
      ));
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      throw error;
    }
  });

  app.get('/api/v1/catalog/products/barcode/:barcode', requirePermission(permission), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      const product = await service.getProductByBarcode(context.principal.storeId, request.params.barcode);
      if (!product) {
        response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.', requestId: request.id } });
        return;
      }
      response.json(product);
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      throw error;
    }
  });

  app.get('/api/v1/catalog/inventory-ledger', requirePermission('inventory:read'), async (request: Request, response: Response) => {
    try {
      const context = request.prodxContext;
      if (!context) {
        response.status(500).json({ error: { code: 'REQUEST_CONTEXT_MISSING', message: 'Request context is required.', requestId: request.id } });
        return;
      }
      response.json(await service.getInventoryLedger(
        context.principal.storeId,
        typeof request.query.productId === 'string' ? request.query.productId : undefined,
      ));
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message, requestId: request.id } });
        return;
      }
      throw error;
    }
  });
};
