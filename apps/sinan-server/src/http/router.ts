import type { IncomingMessage, ServerResponse } from "node:http";
import { ErrorMapper, HttpError } from "./error_mapper.js";

/** Path-parameter bag extracted from the matched route pattern. */
export type RouteParams = Readonly<Record<string, string>>;

/** A single route handler. May throw; the Router converts thrown values via the ErrorMapper. */
export type RouteHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    params: RouteParams,
) => Promise<void> | void;

export interface RouteDefinition {
    readonly method: string;
    readonly pattern: string;
    readonly handler: RouteHandler;
}

interface CompiledRoute {
    readonly method: string;
    readonly regex: RegExp;
    readonly keys: readonly string[];
    readonly handler: RouteHandler;
}

/**
 * Method+path dispatcher with a single error-mapping layer at the boundary.
 *
 * Patterns use `:name` to capture path parameters (e.g. `/api/actors/:id`).
 * The router compiles each pattern to a regex once at construction time.
 */
export class Router {
    private readonly routes: readonly CompiledRoute[];

    public constructor(routes: readonly RouteDefinition[], errorMapper: ErrorMapper) {
        this.routes = routes.map(compileRoute);
        this.errorMapper = errorMapper;
    }

    private readonly errorMapper: ErrorMapper;

    public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const pathname = parsePathname(req);
            const route = this.match(req.method ?? "GET", pathname);
            if (route === null) {
                await this.errorMapper.handle(
                    res,
                    new HttpError(404, "not-found", `No route for ${req.method ?? "?"} ${pathname}`),
                );
                return;
            }
            const params = extractParams(route, pathname);
            await route.handler(req, res, params);
        } catch (error) {
            await this.errorMapper.handle(res, error);
        }
    }

    private match(method: string, pathname: string): CompiledRoute | null {
        for (const route of this.routes) {
            if (route.method !== method) continue;
            if (route.regex.test(pathname)) {
                return route;
            }
        }
        return null;
    }
}

function parsePathname(req: IncomingMessage): string {
    const rawUrl = req.url ?? "/";
    // `host` is required by HTTP/1.1; fall back to localhost for malformed requests.
    const host = req.headers.host ?? "localhost";
    try {
        return new URL(rawUrl, `http://${host}`).pathname;
    } catch {
        return "/";
    }
}

function compileRoute(definition: RouteDefinition): CompiledRoute {
    const keys: string[] = [];
    const regexSource = "^" + definition.pattern.replace(/:[a-zA-Z]+/g, (match) => {
        keys.push(match.slice(1));
        return "([^/]+)";
    }) + "$";
    return {
        method: definition.method,
        regex: new RegExp(regexSource),
        keys,
        handler: definition.handler,
    };
}

function extractParams(route: CompiledRoute, pathname: string): RouteParams {
    const match = pathname.match(route.regex);
    if (match === null) {
        return {};
    }
    const params: Record<string, string> = {};
    for (let i = 0; i < route.keys.length; i++) {
        const key = route.keys[i];
        const value = match[i + 1];
        if (key !== undefined && value !== undefined) {
            params[key] = value;
        }
    }
    return params;
}
