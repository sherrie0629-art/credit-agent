// Thin RPC wrappers — 真实逻辑在 ./subgraph.server 与 ./preflight.server。
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { OBJECT_TYPE_IDS, type ObjectTypeId } from "./objects";
import { ACTION_TYPE_IDS, type ActionTypeId } from "./actions";

const subgraphInput = z.object({
  rootType: z.enum(OBJECT_TYPE_IDS as [string, ...string[]]),
  rootId: z.string().min(1).max(200),
  depth: z.number().int().min(1).max(3).optional(),
});

export const fetchSubgraphFn = createServerFn({ method: "GET" })
  .inputValidator((d) => subgraphInput.parse(d))
  .handler(async ({ data }) => {
    const { getSubgraph } = await import("./subgraph.server");
    return getSubgraph({ rootType: data.rootType as ObjectTypeId, rootId: data.rootId, depth: data.depth });
  });

export const fetchSubgraphTextFn = createServerFn({ method: "GET" })
  .inputValidator((d) => subgraphInput.parse(d))
  .handler(async ({ data }) => {
    const { getSubgraph } = await import("./subgraph.server");
    const { serializeSubgraph } = await import("./serialize");
    const sg = await getSubgraph({
      rootType: data.rootType as ObjectTypeId,
      rootId: data.rootId,
      depth: data.depth,
    });
    return { text: serializeSubgraph(sg), nodes: sg.nodes.length, edges: sg.edges.length };
  });

export const checkActionFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        actionType: z.enum(ACTION_TYPE_IDS as [string, ...string[]]),
        params: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { ontologyPreflight } = await import("./preflight.server");
    return ontologyPreflight({
      actionType: data.actionType as ActionTypeId,
      params: data.params,
      automated: true,
    });
  });
