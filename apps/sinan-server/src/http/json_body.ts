import type { IncomingMessage } from "node:http";
import { HttpError } from "./error_mapper.js";

/**
 * Maximum request body size for JSON endpoints. 1 MiB is generous for a
 * single-user local server; raises `413 payload-too-large` past that.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Reads the request body and parses it as JSON.
 *
 * - Empty body → empty object (so handlers can call `Schema.parse({})`).
 * - Body exceeding the cap → throws `413 payload-too-large`.
 * - Body present but not parseable → throws `400 invalid-input`.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of req) {
        const buffer = chunk as Buffer;
        total += buffer.length;
        if (total > MAX_BODY_BYTES) {
            throw new HttpError(
                413,
                "payload-too-large",
                `Request body exceeds ${MAX_BODY_BYTES} bytes`,
            );
        }
        chunks.push(buffer);
    }

    const text = Buffer.concat(chunks).toString("utf-8");
    if (text.length === 0) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, "invalid-input", "Request body is not valid JSON");
    }
}
