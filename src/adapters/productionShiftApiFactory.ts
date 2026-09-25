import { createProductionShiftApi } from './productionShiftApi';
import type { IShiftApi } from './types';

export const createShiftApi = (token:string): IShiftApi => createProductionShiftApi(token);
