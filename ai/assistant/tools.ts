import type { AIToolDefinition } from "../core/types";

export const assistantToolContracts: readonly AIToolDefinition[] = [
  {
    name: "catalog.search",
    description: "Search products available to the current store/user.",
    authoritative: true,
    allowedActors: ["assistant"],
    allowedModes: ["online", "hybrid", "offline"],
    execute: async () => {
      throw new Error("Wire catalog.search to the authoritative PRODX catalog service");
    },
  },
  {
    name: "cart.get",
    description: "Read the current cart and authoritative totals.",
    authoritative: true,
    allowedActors: ["assistant"],
    allowedModes: ["online", "hybrid", "offline"],
    execute: async () => {
      throw new Error("Wire cart.get to the authoritative PRODX cart service");
    },
  },
];
