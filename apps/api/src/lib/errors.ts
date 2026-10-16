import { ForbiddenError } from "@voicedesk/core";
import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Sign in required");
/** Used for both "doesn't exist" and "not a member" so tenant ids can't be probed. */
export const notFound = () => new HttpError(404, "NOT_FOUND", "Not found");

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: "VALIDATION_FAILED",
        message: "Request validation failed",
        issues: error.validation,
      });
    }
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send({ error: "VALIDATION_FAILED", message: "Invalid input", issues: error.issues });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ForbiddenError) {
      return reply.status(403).send({ error: "FORBIDDEN", message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply
        .status(status)
        .send({ error: "REQUEST_ERROR", message: (error as Error).message });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong" });
  });
}
