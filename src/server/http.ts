import { Conflict, Invalid, NotFound } from "../core/errors.ts";
import type { RoomService } from "../core/rooms.ts";

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;

const statusFor = (error: unknown): number => {
  if (error instanceof Invalid) return 400;
  if (error instanceof NotFound) return 404;
  if (error instanceof Conflict) return 409;
  return 500;
};

export const guard =
  (handler: Handler): Handler =>
  async (req) => {
    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      return Response.json({ error: message }, { status: statusFor(error) });
    }
  };

export function roomRoutes(deps: { rooms: RoomService }) {
  return {
    "/api/rooms": {
      GET: guard(() => Response.json(deps.rooms.list())),
      POST: guard(async (req) =>
        Response.json(deps.rooms.create(await req.json()), { status: 201 }),
      ),
    },
    "/api/rooms/:id": {
      GET: guard((req) => Response.json(deps.rooms.get(req.params.id))),
    },
  };
}
