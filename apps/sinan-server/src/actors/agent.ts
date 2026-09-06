import {
    createAgentSession,
    SessionManager,
    type AgentSession,
} from "@earendil-works/pi-coding-agent";

/** Options used when creating a persistent agent session for an actor. */
export interface CreateAgentSessionOptions {
    workspace: string;
    /** Stable Pi session path. The factory must open it in persistent mode. */
    sessionFile: string;
    tools: readonly string[];
}

/** Factory boundary between actor lifecycle management and a concrete agent SDK. */
export interface AgentSessionFactory<TAgent extends object = object> {
    create(options: CreateAgentSessionOptions): Promise<TAgent>;
}

/**
 * Default adapter for the pi-coding-agent SDK.
 *
 * `SessionManager.open` enables JSONL persistence and restores an existing
 * session. Pi intentionally delays materializing an empty session file until
 * the first session entry is written.
 */
export class PiAgentSessionFactory implements AgentSessionFactory<AgentSession> {
    public async create(options: CreateAgentSessionOptions): Promise<AgentSession> {
        const {session} = await createAgentSession({
            cwd: options.workspace,
            tools: [...options.tools],
            sessionManager: SessionManager.open(
                options.sessionFile,
                undefined,
                options.workspace,
            ),
        });
        return session;
    }
}
