import type { BunRequest } from "bun";
import { Conflict, Invalid, NotFound } from "../core/errors.ts";
import type { RoomService } from "../core/rooms.ts";

const statusFor = (error: unknown): number => {
  if (error instanceof Invalid) return 400;
  if (error instanceof NotFound) return 404;
  if (error instanceof Conflict) return 409;
  return 500;
};

const body = async <T>(req: Request): Promise<T> => (await req.json()) as T;

export const guard =
  <R extends Request>(handler: (req: R) => Response | Promise<Response>) =>
  async (req: R): Promise<Response> => {
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
      POST: guard(async (req: BunRequest<"/api/rooms">) =>
        Response.json(deps.rooms.create(await body(req)), { status: 201 }),
      ),
    },
    "/api/rooms/:id": {
      GET: guard((req: BunRequest<"/api/rooms/:id">) => Response.json(deps.rooms.get(req.params.id))),
    },
  };
}
