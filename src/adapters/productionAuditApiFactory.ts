import { createProductionAuditApi } from './productionAuditApi';

export const createAuditApi = (token: string) => createProductionAuditApi(token);
