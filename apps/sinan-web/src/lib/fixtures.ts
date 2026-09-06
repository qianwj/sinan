import type { ActorView, ActorConfig, RestartPolicy, ActorId, Timestamp } from "sinan-core";

/**
 * Mock actor projections served by the Vite mock plugin at `/api/actors`.
 * The shape is the wire format that `sinan-server` will return for
 * `GET /api/actors` once it is wired up — the web components consume
 * this directly without translation.
 *
 * The set covers every state kind from the §3.2 union, so the office
 * renders the full visual vocabulary on first load:
 *   ready × 2, running × 1, paused × 1, failed × 1,
 *   quarantined × 1, restarting × 1, terminated × 1
 */
export const officeFixtures: ActorView[] = [
    {
        id: "actor-pm",
        config: fixtureConfig({
            id: "actor-pm",
            name: "Avery",
            role: "product_manager",
            workspace: "/work/sinan/roadmap",
            policy: { kind: "always", backoffMs: 2_000, jitter: true },
            lastEventAt: 1_716_300_000_000,
        }),
        state: { kind: "ready" },
        lastEventAt: 1_716_300_000_000,
    },
    {
        id: "actor-designer",
        config: fixtureConfig({
            id: "actor-designer",
            name: "Iris",
            role: "designer",
            workspace: "/work/sinan/office",
            policy: { kind: "on-failure", maxRetries: 3, backoffMs: 1_000, jitter: true },
            lastEventAt: 1_716_300_005_000,
        }),
        state: { kind: "ready" },
        lastEventAt: 1_716_300_005_000,
    },
    {
        id: "actor-dev",
        config: fixtureConfig({
            id: "actor-dev",
            name: "Kojo",
            role: "development_engineer",
            workspace: "/work/sinan/api",
            policy: { kind: "on-failure", maxRetries: 1, backoffMs: 5_000, jitter: false },
            lastEventAt: 1_716_300_010_000,
        }),
        state: {
            kind: "running",
            taskId: "task-1",
            leaseId: "lease-1",
        },
        lastEventAt: 1_716_300_010_000,
    },
    {
        id: "actor-qa",
        config: fixtureConfig({
            id: "actor-qa",
            name: "Mira",
            role: "qa_engineer",
            workspace: "/work/sinan/test",
            policy: { kind: "never" },
            lastEventAt: 1_716_300_015_000,
        }),
        state: {
            kind: "paused",
            reason: "waiting on bug fix",
            since: 1_716_300_015_000,
        },
        lastEventAt: 1_716_300_015_000,
    },
    {
        id: "actor-devops",
        config: fixtureConfig({
            id: "actor-devops",
            name: "Ren",
            role: "devops_engineer",
            workspace: "/work/sinan/ci",
            policy: { kind: "on-failure", maxRetries: 2, backoffMs: 1_500, jitter: true },
            lastEventAt: 1_716_300_020_000,
        }),
        state: {
            kind: "failed",
            error: { category: "transient", message: "compose pull failed", diagnostic: null },
            since: 1_716_300_020_000,
        },
        lastEventAt: 1_716_300_020_000,
    },
    {
        id: "actor-restarting",
        config: fixtureConfig({
            id: "actor-restarting",
            name: "Sage",
            role: "development_engineer",
            workspace: "/work/sinan/worker",
            policy: { kind: "on-failure", maxRetries: 3, backoffMs: 1_000, jitter: true },
            lastEventAt: 1_716_300_025_000,
        }),
        state: { kind: "restarting", fromCheckpoint: null },
        lastEventAt: 1_716_300_025_000,
    },
    {
        id: "actor-quarantined",
        config: fixtureConfig({
            id: "actor-quarantined",
            name: "Theo",
            role: "development_engineer",
            workspace: "/work/sinan/legacy",
            policy: { kind: "never" },
            lastEventAt: 1_716_300_030_000,
        }),
        state: {
            kind: "quarantined",
            reason: "repeated lease failures; needs review",
            since: 1_716_300_030_000,
        },
        lastEventAt: 1_716_300_030_000,
    },
    {
        id: "actor-done",
        config: fixtureConfig({
            id: "actor-done",
            name: "Vera",
            role: "designer",
            workspace: "/work/sinan/branding",
            policy: { kind: "never" },
            lastEventAt: 1_716_300_035_000,
        }),
        state: { kind: "terminated", clean: true, at: 1_716_300_035_000 },
        lastEventAt: 1_716_300_035_000,
    },
];

interface FixtureOverrides {
    id: ActorId;
    name: string;
    role: ActorConfig["role"];
    workspace: string;
    policy: RestartPolicy;
    lastEventAt: Timestamp;
}

function fixtureConfig(o: FixtureOverrides): ActorConfig {
    return {
        id: o.id,
        name: o.name,
        role: o.role,
        workspace: o.workspace,
        sessionFile: `~/.sinan/actors/${o.id}/session.jsonl`,
        tools: [],
        promptTemplateRef: "default",
        limits: {
            maxWallClockMs: 3_600_000,
            maxConcurrentTasks: 1,
            maxMemoryMb: null,
            maxTokensPerHour: null,
        },
        policy: o.policy,
        createdAt: o.lastEventAt - 60_000,
    };
}
