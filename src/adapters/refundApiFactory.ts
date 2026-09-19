import { orderApi as mockOrderApi } from "./mockAdapter";
import { createProductionRefundApi } from "./productionRefundApi";
import type { Money } from "../domain/money";
import type { RefundItemRestock } from "./types";

type MockRefundApi = {
  mode: "mock";
  refundOrder: (
    storeId: string,
    orderId: string,
    refundAmount: Money,
    reason: string,
    refundMethod: "cash" | "card" | "qr_digital",
    restockItems: boolean,
    authorizedByUserId: string,
    authorizedByName: string,
    itemsToRestock?: readonly RefundItemRestock[],
  ) => ReturnType<typeof mockOrderApi.refundOrder>;
};

type ProductionRefundApi = ReturnType<typeof createProductionRefundApi> & {
  mode: "production";
};

export function createRefundApi(
  token: string,
): MockRefundApi | ProductionRefundApi {
  if (import.meta.env.DEV) {
    return {
      mode: "mock",
      refundOrder: mockOrderApi.refundOrder.bind(mockOrderApi),
    };
  }
  return {
    mode: "production",
    ...createProductionRefundApi(token),
  };
}
