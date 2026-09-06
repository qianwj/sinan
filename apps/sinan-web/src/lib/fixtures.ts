import type {
    ActorConfig,
    ActorId,
    ActorView,
    ActorRole,
    ResourceLimits,
    RestartPolicy,
    TaskId,
    Timestamp,
} from "sinan-core";

/**
 * Mock actor projections served by the Vite mock plugin at `/api/actors`.
 * The shape is the wire format that `sinan-server` will return for
 * `GET /api/actors` once it is wired up — the web components consume
 * this directly without translation.
 *
 * The set covers every `ActorStateKind` from the runtime's state
 * machine so the office renders the full visual vocabulary on first
 * load:
 *
 *   ready × 2, running × 1, paused × 1, failed × 1,
 *   restarting × 1, quarantined × 1, terminated × 1
 *
 * The running actor carries a `taskId`. Its one-line goal comes from
 * the task module (out of scope for the prototype) — the card
 * currently surfaces only the taskId until that module is wired in.
 */
export const officeFixtures: readonly ActorView[] = [
    {
        id: "actor-pm",
        config: fixtureConfig({
            id: "actor-pm",
            name: "Avery",
            role: "product_manager",
            workspace: "/work/sinan/roadmap",
            policy: { kind: "always", backoffMs: 2_000, jitter: true },
            lastEventAt: ts(0),
        }),
        state: { kind: "ready" },
        lastEventAt: ts(0),
    },
    {
        id: "actor-designer",
        config: fixtureConfig({
            id: "actor-designer",
            name: "Iris",
            role: "designer",
            workspace: "/work/sinan/office",
            policy: { kind: "on-failure", maxRetries: 3, backoffMs: 1_000, jitter: true },
            lastEventAt: ts(5_000),
        }),
        state: { kind: "ready" },
        lastEventAt: ts(5_000),
    },
    {
        id: "actor-dev",
        config: fixtureConfig({
            id: "actor-dev",
            name: "Kojo",
            role: "development_engineer",
            workspace: "/work/sinan/api",
            policy: { kind: "on-failure", maxRetries: 1, backoffMs: 5_000, jitter: false },
            lastEventAt: ts(10_000),
        }),
        state: {
            kind: "running",
            taskId: "task-1",
            leaseId: "lease-1",
        },
        lastEventAt: ts(10_000),
    },
    {
        id: "actor-qa",
        config: fixtureConfig({
            id: "actor-qa",
            name: "Mira",
            role: "qa_engineer",
            workspace: "/work/sinan/test",
            policy: { kind: "never" },
            lastEventAt: ts(15_000),
        }),
        state: {
            kind: "paused",
            reason: "waiting on bug fix",
            since: ts(15_000),
        },
        lastEventAt: ts(15_000),
    },
    {
        id: "actor-devops",
        config: fixtureConfig({
            id: "actor-devops",
            name: "Ren",
            role: "devops_engineer",
            workspace: "/work/sinan/ci",
            policy: { kind: "on-failure", maxRetries: 2, backoffMs: 1_500, jitter: true },
            lastEventAt: ts(20_000),
        }),
        state: {
            kind: "failed",
            error: {
                category: "transient",
                message: "compose pull failed",
                diagnostic: null,
            },
            since: ts(20_000),
        },
        lastEventAt: ts(20_000),
    },
    {
        id: "actor-restarting",
        config: fixtureConfig({
            id: "actor-restarting",
            name: "Sage",
            role: "development_engineer",
            workspace: "/work/sinan/worker",
            policy: { kind: "on-failure", maxRetries: 3, backoffMs: 1_000, jitter: true },
            lastEventAt: ts(25_000),
        }),
        state: { kind: "restarting", fromCheckpoint: null },
        lastEventAt: ts(25_000),
    },
    {
        id: "actor-quarantined",
        config: fixtureConfig({
            id: "actor-quarantined",
            name: "Theo",
            role: "development_engineer",
            workspace: "/work/sinan/legacy",
            policy: { kind: "never" },
            lastEventAt: ts(30_000),
        }),
        state: {
            kind: "quarantined",
            reason: "repeated lease failures; needs review",
            since: ts(30_000),
        },
        lastEventAt: ts(30_000),
    },
    {
        id: "actor-done",
        config: fixtureConfig({
            id: "actor-done",
            name: "Vera",
            role: "designer",
            workspace: "/work/sinan/branding",
            policy: { kind: "never" },
            lastEventAt: ts(35_000),
        }),
        state: { kind: "terminated", clean: true, at: ts(35_000) },
        lastEventAt: ts(35_000),
    },
];

interface FixtureOverrides {
    id: ActorId;
    name: string;
    role: ActorRole;
    workspace: string;
    policy: RestartPolicy;
    lastEventAt: Timestamp;
}

const DEFAULT_LIMITS: ResourceLimits = {
    maxWallClockMs: 3_600_000,
    maxConcurrentTasks: 1,
    maxMemoryMb: null,
    maxTokensPerHour: null,
};

function fixtureConfig(o: FixtureOverrides): ActorConfig {
    return {
        id: o.id,
        name: o.name,
        role: o.role,
        workspace: o.workspace,
        sessionFile: `~/.sinan/actors/${o.id}/session.jsonl`,
        tools: [],
        promptTemplateRef: "default",
        limits: DEFAULT_LIMITS,
        policy: o.policy,
        createdAt: o.lastEventAt - 60_000,
    };
}

/** Anchors the fixture timestamps in the recent past relative to "now"
 *  so the `last event` meta is never "0s ago" or "1970" on first load. */
function ts(offsetMs: number): Timestamp {
    return Date.now() - 60_000 + offsetMs;
}

/** Convenience: a few well-known task ids the fixtures reference. */
export type FixtureTaskId = TaskId;
