import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Router } from "./router.js";

/**
 * Process-level HTTP server.
 *
 * Host is fixed to `127.0.0.1` (single-user local-first boundary per
 * `docs/architecture.md` §11); only the port is user-configurable. The
 * `start()` log line emits the actual bound port so callers using
 * `port: 0` for ephemeral binding still get a useful address.
 */
export class HttpServer implements Disposable {
    private static readonly HOST = "127.0.0.1";
    private static readonly DEFAULT_PORT = 7070;

    private server: Server | undefined;
    private readonly configuredPort: number;

    public constructor(
        private readonly router: Router,
        port?: number,
    ) {
        this.configuredPort = port ?? HttpServer.resolvePort();
    }

    public async start(): Promise<void> {
        if (this.server !== undefined) {
            throw new Error("HttpServer is already started");
        }
        return new Promise<void>((resolve, reject) => {
            const server = createServer((req, res) => {
                this.handle(req, res).catch((cause) => {
                    // handle() should never throw — errorMapper swallows everything.
                    // This branch is a defensive backstop.
                    console.error("HttpServer.handle escaped error mapping:", cause);
                    this.writeFinalFallback(res);
                });
            });
            const onError = (cause: Error): void => {
                server.removeListener("listening", onListening);
                reject(cause);
            };
            const onListening = (): void => {
                server.removeListener("error", onError);
                this.server = server;
                const address = server.address();
                const boundPort = address !== null && typeof address === "object"
                    ? address.port
                    : this.configuredPort;
                // eslint-disable-next-line no-console
                console.log(`http server listening on http://${HttpServer.HOST}:${boundPort}`);
                resolve();
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(this.configuredPort, HttpServer.HOST);
        });
    }

    public async stop(): Promise<void> {
        const server = this.server;
        if (server === undefined) return;
        this.server = undefined;
        await new Promise<void>((resolve, reject) => {
            server.close((cause) => {
                if (cause === undefined) {
                    resolve();
                } else {
                    reject(cause);
                }
            });
        });
    }

    /**
     * Returns the actual bound port. When the constructor was called with
     * `port: 0` the OS assigned an ephemeral port; reading it back requires
     * a getter so tests and tools can address the running server.
     */
    public get port(): number {
        if (this.server === undefined) {
            throw new Error("HttpServer is not started");
        }
        const address = this.server.address();
        if (address === null || typeof address !== "object") {
            throw new Error("HttpServer is not bound to a port");
        }
        return address.port;
    }

    public [Symbol.dispose](): void {
        void this.stop();
    }

    /**
     * Reads `SINAN_HTTP_PORT` from the environment, falling back to the
     * default port when the variable is unset or unparseable. Accepts an
     * env argument so tests can substitute a fixed object without
     * manipulating `process.env`.
     */
    private static resolvePort(env: NodeJS.ProcessEnv = process.env): number {
        return HttpServer.parseHttpPort(env.SINAN_HTTP_PORT) ?? HttpServer.DEFAULT_PORT;
    }

    /**
     * Parses a string port value. Returns `undefined` on empty input or
     * any invalid value (non-integer, negative, or > 65535), letting the
     * caller fall back to a default without throwing.
     */
    private static parseHttpPort(raw: string | undefined): number | undefined {
        if (raw === undefined || raw.length === 0) {
            return undefined;
        }
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
            return undefined;
        }
        return parsed;
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        await this.router.handle(req, res);
    }

    private writeFinalFallback(res: ServerResponse): void {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: "internal-error", message: "Internal server error", details: null }));
    }
}
