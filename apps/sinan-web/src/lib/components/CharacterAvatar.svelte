<script lang="ts">
    import type { ActorRole, ActorState } from "sinan-core";

    /**
     * Minimalist geometric avatar + role prop (web-agent-office.md §D-05).
     *
     * Strict rules from D-05:
     *   - 64x64 SVG, geometric only, no facial features, no fingers,
     *     no shading, no 3D / perspective.
     *   - The avatar itself never animates; only the role prop and
     *     the surrounding status ring carry motion.
     *   - Every animation is gated on `motion-safe:` so it is silently
     *     dropped under `prefers-reduced-motion: reduce` (per §5.5 /
     *     §6.2 / §11.1). With motion off, the prop is still drawn in
     *     its state-appropriate "active" pose.
     *   - The avatar does NOT carry state semantics; the badge + stripe
     *     + text already do (§6.1). The avatar's only job is to make
     *     the office metaphor palpable (§3.1) and to give the prop a
     *     state-appropriate micro-cue.
     *
     * Composition (top → bottom):
     *   - Head:        circle (cx=32, cy=20, r=10)
     *   - Shoulders:   small rounded shape (y≈30–36), just a hint
     *   - Desk:        subtle line at y=42 separating the avatar from
     *                  the prop zone (y=44–58)
     *   - Status ring: r=30 around the avatar, only painted for some states
     */
    let {
        role,
        state,
        title,
    }: {
        role: ActorRole;
        state: ActorState;
        title?: string;
    } = $props();

    const isRunning = $derived(state.kind === "running");
    const isQuarantined = $derived(state.kind === "quarantined");
    const isFailed = $derived(state.kind === "failed");
    const isPaused = $derived(state.kind === "paused");
    const isRestarting = $derived(state.kind === "restarting");
    const isTerminated = $derived(state.kind === "terminated");
    const isInactive = $derived(isTerminated);
    const showOffDutyProp = $derived(isPaused || isTerminated);
</script>

<svg
    viewBox="0 0 64 64"
    width="64"
    height="64"
    role="img"
    aria-label={title ?? ""}
    aria-hidden={title === undefined ? "true" : undefined}
    class="block"
    data-state={state.kind}
>
    <!-- Status ring behind the avatar (failed / quarantined / restarting) -->
    {#if isFailed || isQuarantined || isRestarting}
        <circle
            cx="32"
            cy="32"
            r="30"
            fill="none"
            stroke-width="2"
            class="{isFailed ? 'stroke-status-failed' : ''} {isQuarantined ? 'stroke-status-quarantined' : ''} {isRestarting ? 'stroke-status-restarting opacity-50' : ''} {(isFailed || isQuarantined) ? 'opacity-90' : ''} {isFailed || isQuarantined ? 'motion-safe:animate-[avatar-pulse_1.6s_ease-in-out_infinite]' : ''} {isRestarting ? 'motion-safe:animate-[avatar-spin_1.4s_linear_infinite]' : ''}"
            stroke-dasharray={isRestarting ? "6 6" : undefined}
        />
    {/if}

    <!-- Desk surface line (subtle) — separates the avatar from the prop -->
    <line
        x1="6"
        y1="42"
        x2="58"
        y2="42"
        stroke="#0b1220"
        stroke-width="0.6"
        opacity="0.18"
    />

    <!-- Avatar: head + small shoulder hint, in the role color via currentColor -->
    <g class:inactive={isInactive}>
        <circle cx="32" cy="20" r="10" fill="currentColor" opacity="0.95" />
        <path
            d="M 16 38 Q 16 30 32 30 Q 48 30 48 38 Z"
            fill="currentColor"
            opacity="0.7"
        />
    </g>

    <!-- Role prop on the "desk" (y=44–58) -->
    {#if role === "product_manager"}
        <!-- Notebook + pen -->
        <g>
            <rect x="10" y="44" width="32" height="16" rx="2" fill="#ffffff" stroke="currentColor" stroke-width="1.4" />
            <line x1="14" y1="48" x2="38" y2="48" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <line x1="14" y1="51" x2="32" y2="51" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <line x1="14" y1="54" x2="36" y2="54" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <line x1="14" y1="57" x2="28" y2="57" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <g
                transform="rotate(-22 48 54)"
                class={isRunning ? "motion-safe:animate-[pen-draw_2.4s_ease-in-out_infinite]" : ""}
            >
                <rect x="46" y="44" width="3" height="18" rx="1" fill="currentColor" />
                <polygon points="46,44 49,44 47.5,40" fill="#0b1220" />
            </g>
        </g>
    {:else if role === "designer"}
        <!-- Tablet + stylus + paint dot -->
        <g>
            <rect x="10" y="44" width="34" height="16" rx="2" fill="#ffffff" stroke="currentColor" stroke-width="1.4" />
            <line x1="10" y1="48" x2="44" y2="48" stroke="currentColor" stroke-width="0.5" opacity="0.3" />
            <line x1="10" y1="56" x2="44" y2="56" stroke="currentColor" stroke-width="0.5" opacity="0.3" />
            {#if isRunning}
                <path
                    d="M 14 52 Q 20 48 26 52 T 38 52"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    class="motion-safe:animate-[stroke-draw_2.2s_ease-in-out_infinite_alternate]"
                />
            {:else}
                <path
                    d="M 14 52 Q 20 48 26 52 T 38 52"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    opacity="0.5"
                />
            {/if}
            <g transform="rotate(35 50 50)">
                <rect x="49" y="40" width="2.5" height="20" rx="1" fill="currentColor" />
            </g>
        </g>
    {:else if role === "development_engineer"}
        <!-- Laptop with code lines + blinking cursor -->
        <g>
            <rect x="10" y="44" width="32" height="14" rx="1.5" fill="#0b1220" stroke="currentColor" stroke-width="1.2" />
            <line x1="13" y1="48" x2="20" y2="48" stroke="currentColor" stroke-width="0.8" opacity="0.7" />
            <line x1="13" y1="51" x2="28" y2="51" stroke="currentColor" stroke-width="0.8" opacity="0.7" />
            <line x1="13" y1="54" x2="22" y2="54" stroke="currentColor" stroke-width="0.8" opacity="0.7" />
            <line
                x1="24"
                y1="54"
                x2="24"
                y2="57"
                stroke="currentColor"
                stroke-width="1.2"
                class={isRunning ? "motion-safe:animate-[cursor-blink_1.1s_steps(2)_infinite]" : ""}
                opacity={isRunning ? 1 : isPaused ? 0.5 : 0.3}
            />
            <rect x="8" y="58" width="36" height="3" rx="1" fill="currentColor" opacity="0.85" />
        </g>
    {:else if role === "qa_engineer"}
        <!-- Clipboard + magnifier (the magnifier "scans" while running) -->
        <g>
            <rect x="10" y="44" width="24" height="16" rx="2" fill="#ffffff" stroke="currentColor" stroke-width="1.4" />
            <rect x="19" y="42" width="6" height="4" rx="1" fill="currentColor" />
            <line x1="14" y1="50" x2="30" y2="50" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <line x1="14" y1="53" x2="28" y2="53" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <line x1="14" y1="56" x2="30" y2="56" stroke="currentColor" stroke-width="0.8" opacity="0.6" />
            <g class={isRunning ? "motion-safe:animate-[magnifier-scan_1.8s_ease-in-out_infinite_alternate]" : ""}>
                <circle cx="44" cy="50" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
                <circle cx="44" cy="50" r="6" fill="currentColor" opacity="0.1" />
                <line x1="48" y1="54" x2="53" y2="59" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </g>
        </g>
    {:else if role === "devops_engineer"}
        <!-- Wrench + small gear -->
        <g>
            <g
                class={isRunning ? "motion-safe:animate-[wrench-tap_1.6s_ease-in-out_infinite]" : ""}
                transform-origin="22 52"
            >
                <circle cx="22" cy="52" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
                <circle cx="22" cy="52" r="2" fill="currentColor" />
                <line x1="22" y1="46" x2="22" y2="58" stroke="currentColor" stroke-width="1.4" />
                <line x1="16" y1="52" x2="28" y2="52" stroke="currentColor" stroke-width="1.4" />
            </g>
            {#if isRunning}
                <circle
                    cx="32"
                    cy="50"
                    r="1.2"
                    fill="currentColor"
                    class="motion-safe:animate-[spark_1.6s_ease-in-out_infinite]"
                />
            {/if}
            {#if showOffDutyProp || !isRunning}
                <g transform="translate(44 54)" opacity="0.7">
                    <circle cx="0" cy="0" r="4" fill="none" stroke="currentColor" stroke-width="1.2" />
                    <circle cx="0" cy="0" r="1.2" fill="currentColor" />
                    {#each [0, 45, 90, 135, 180, 225, 270, 315] as deg}
                        <rect
                            x="-0.6"
                            y="-6"
                            width="1.2"
                            height="2"
                            fill="currentColor"
                            transform="rotate({deg})"
                        />
                    {/each}
                </g>
            {/if}
        </g>
    {/if}

    <!-- Off-duty indicator: pause sign (only for paused) -->
    {#if isPaused}
        <g transform="translate(50 16)">
            <circle r="6" fill="#0b1220" />
            <rect x="-2" y="-2.5" width="1.4" height="5" fill="#fef3c7" />
            <rect x="0.6" y="-2.5" width="1.4" height="5" fill="#fef3c7" />
        </g>
    {/if}

    <!-- Quarantine lock badge -->
    {#if isQuarantined}
        <g transform="translate(50 16)">
            <circle r="6" fill="#7c3aed" />
            <rect x="-2.4" y="-1" width="4.8" height="3.2" rx="0.6" fill="#ffffff" />
            <path
                d="M -1.5 -1 V -2.5 a 1.5 1.5 0 0 1 3 0 V -1"
                fill="none"
                stroke="#ffffff"
                stroke-width="0.9"
            />
        </g>
    {/if}

    <!-- Failed: small ! mark -->
    {#if isFailed}
        <g transform="translate(50 16)">
            <circle r="6" fill="#dc2626" />
            <rect x="-0.6" y="-3" width="1.2" height="4" fill="#ffffff" />
            <circle cx="0" cy="2" r="0.7" fill="#ffffff" />
        </g>
    {/if}
</svg>

<style>
    /* D-05: avatar itself never animates; only the prop and the
       status ring. All motion below is consumed by `motion-safe:`
       class hooks, which silently disable under
       `prefers-reduced-motion: reduce`. */
    @keyframes avatar-pulse {
        0%, 100% {
            transform: scale(1);
            opacity: 0.9;
        }
        50% {
            transform: scale(1.04);
            opacity: 0.5;
        }
    }

    @keyframes avatar-spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    @keyframes cursor-blink {
        0%, 49% {
            opacity: 1;
        }
        50%, 100% {
            opacity: 0;
        }
    }

    @keyframes stroke-draw {
        from {
            stroke-dasharray: 2 32;
            stroke-dashoffset: 0;
        }
        to {
            stroke-dasharray: 32 2;
            stroke-dashoffset: -34;
        }
    }

    @keyframes pen-draw {
        0% {
            transform: rotate(-22deg);
        }
        50% {
            transform: rotate(-15deg);
        }
        100% {
            transform: rotate(-22deg);
        }
    }

    @keyframes magnifier-scan {
        from {
            transform: translateX(-2px);
        }
        to {
            transform: translateX(2px);
        }
    }

    @keyframes wrench-tap {
        0%, 100% {
            transform: rotate(0deg);
        }
        50% {
            transform: rotate(-10deg);
        }
    }

    @keyframes spark {
        0%, 70% {
            opacity: 0;
            transform: scale(0.6);
        }
        80% {
            opacity: 1;
            transform: scale(1.2);
        }
        100% {
            opacity: 0;
            transform: scale(0.6);
        }
    }

    .inactive {
        filter: grayscale(0.85) opacity(0.7);
    }

    @media (prefers-reduced-motion: reduce) {
        svg[data-state] * {
            animation: none !important;
        }
    }
</style>
