import { z } from "zod";
import type { App, Deps } from "../app.ts";
import { staffOrKiosk } from "../auth/actor.ts";
import { assetSummaryInclude, normalizeCode, toSummary } from "../lib/assets.ts";

/**
 * One lookup for anything printed on a label: asset tag, legacy barcode, RFID EPC, kit or room code.
 * Mobile clients resolve from their local index first and only call this on a miss.
 */
export default function scanRoutes(app: App, { db }: Deps) {
  app.get(
    "/scan/:code",
    {
      preHandler: staffOrKiosk("lookup", "VIEWER"),
      schema: { tags: ["scan"], params: z.object({ code: z.string().min(1).max(512) }) },
    },
    async (req, reply) => {
      const organizationId = req.actor!.organizationId;
      const code = normalizeCode(req.params.code);

      const asset = await db.asset.findFirst({
        where: { organizationId, retiredAt: null, OR: [{ assetTag: code }, { barcode: code }, { rfidEpc: code }] },
        include: assetSummaryInclude,
      });
      if (asset) return { type: "asset" as const, asset: toSummary(asset) };

      const kit = await db.kit.findFirst({
        where: { organizationId, qrCode: code },
        include: { items: { include: { asset: { include: assetSummaryInclude } } } },
      });
      if (kit) {
        return {
          type: "kit" as const,
          kit: { id: kit.id, name: kit.name },
          assets: kit.items.map((i) => toSummary(i.asset)),
        };
      }

      const room = await db.room.findFirst({
        where: { organizationId, qrCode: code },
        select: { id: true, name: true, campus: { select: { id: true, name: true } } },
      });
      if (room) return { type: "room" as const, room };

      return reply.status(404).send({ type: "unknown" as const, code });
    },
  );
}
