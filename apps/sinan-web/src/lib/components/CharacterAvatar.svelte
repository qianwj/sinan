<script lang="ts">
    import type { ActorRole, ActorState } from "sinan-core";

    /**
     * Full-body geometric character + role prop, drawn in front of
     * a desk surface (web-agent-office.md §D-05).
     *
     * Strict rules from D-05:
     *   - 96x96 SVG, geometric only, no facial features, no fingers
     *     (hands end in rounded sleeve cuffs), no shading, no 3D /
     *     perspective.
     *   - The body never animates; only the role prop and the
     *     surrounding status ring carry motion.
     *   - Every animation is gated on `motion-safe:` so it is silently
     *     dropped under `prefers-reduced-motion: reduce` (per §5.5 /
     *     §6.2 / §11.1). With motion off, the prop is still drawn in
     *     its state-appropriate "active" pose.
     *   - The character does NOT carry state semantics; the badge +
     *     stripe + text already do (§6.1). The character's only job is
     *     to make the office metaphor palpable (§3.1) and to give the
     *     prop a state-appropriate micro-cue.
     *
     * Composition (in a 96x96 viewport):
     *   - Head:        circle (cx=48, cy=20, r=11)
     *   - Neck:        small rect (y=29-37)
     *   - Shoulders + torso: trapezoid (y=36-78, shoulders at y=36-40)
     *   - Arms:        two paths from shoulder to desk surface
     *   - Desk:        horizontal band (y=78-96) covering lower body
     *   - Prop:        drawn on top of the desk
     *   - Status ring: r=46 around the whole figure, only painted for
     *                 some states
     *   - Corner badges: small !, lock, pause marks on the top-right
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
    viewBox="0 0 96 96"
    width="96"
    height="96"
    role="img"
    aria-label={title ?? ""}
    aria-hidden={title === undefined ? "true" : undefined}
    class="block"
    data-state={state.kind}
>
    <!-- Status ring behind the character (failed / quarantined / restarting) -->
    {#if isFailed || isQuarantined || isRestarting}
        <circle
            cx="48"
            cy="48"
            r="46"
            fill="none"
            stroke-width="2"
            class="{isFailed ? 'stroke-status-failed' : ''} {isQuarantined ? 'stroke-status-quarantined' : ''} {isRestarting ? 'stroke-status-restarting opacity-50' : ''} {(isFailed || isQuarantined) ? 'opacity-90' : ''} {isFailed || isQuarantined ? 'motion-safe:animate-[avatar-pulse_1.6s_ease-in-out_infinite]' : ''} {isRestarting ? 'motion-safe:animate-[avatar-spin_1.4s_linear_infinite]' : ''}"
            stroke-dasharray={isRestarting ? "6 6" : undefined}
        />
    {/if}

    <!--
        Character body — drawn before the desk so the desk covers the
        lower body and the prop sits on the desk surface in front of
        the character.
    -->
    <g class:inactive={isInactive}>
        <!-- Head -->
        <circle cx="48" cy="20" r="11" fill="currentColor" opacity="0.95" />
        <!-- Neck -->
        <rect x="44" y="29" width="8" height="9" fill="currentColor" opacity="0.85" />
        <!-- Shoulders + torso: rounded trapezoid -->
        <path
            d="M 20 40 Q 20 36 26 36 L 70 36 Q 76 36 76 40 L 72 80 L 24 80 Z"
            fill="currentColor"
            opacity="0.78"
        />
        <!-- Left arm -->
        <path
            d="M 20 40 L 12 80 Q 12 82 14 82 L 22 82 Q 24 82 24 80 L 28 44 Z"
            fill="currentColor"
            opacity="0.68"
        />
        <!-- Right arm -->
        <path
            d="M 76 40 L 84 80 Q 84 82 82 82 L 74 82 Q 72 82 72 80 L 68 44 Z"
            fill="currentColor"
            opacity="0.68"
        />
    </g>

    <!-- Desk surface band — covers the lower body so the character
         reads as "sitting at a desk" -->
    <rect x="2" y="78" width="92" height="18" fill="currentColor" opacity="0.12" />
    <line x1="2" y1="78" x2="94" y2="78" stroke="#0b1220" stroke-width="0.8" opacity="0.22" />

    <!-- Role prop on the desk -->
    {#if role === "product_manager"}
        <g>
            <rect x="20" y="80" width="48" height="14" rx="2" fill="#ffffff" stroke="currentColor" stroke-width="1.4" />
            <line x1="24" y1="84" x2="64" y2="84" stroke="currentColor" stroke-width="0.7" opacity="0.6" />
            <line x1="24" y1="87" x2="56" y2="87" stroke="currentColor" stroke-width="0.7" opacity="0.6" />
            <line x1="24" y1="90" x2="60" y2="90" stroke="currentColor" stroke-width="0.7" opacity="0.6" />
            <g
                transform="rotate(-20 74 88)"
                class={isRunning ? "motion-safe:animate-[pen-draw_2.4s_ease-in-out_infinite]" : ""}
            >
                <rect x="72" y="76" width="3" height="22" rx="1" fill="currentColor" />
                <polygon points="72,76 75,76 73.5,72" fill="#0b1220" />
            </g>
        </g>
    {:else if role === "designer"}
        <g>
            <rect x="16" y="80" width="56" height="14" rx="2" fill="#ffffff" stroke="currentColor" stroke-width="1.4" />
            <line x1="16" y1="84" x2="72" y2="84" stroke="currentColor" stroke-width="0.4" opacity="0.3" />
            <line x1="16" y1="90" x2="72" y2="90" stroke="currentColor" stroke-width="0.4" opacity="0.3" />
            {#if isRunning}
                <path
                    d="M 22 87 Q 30 82 38 87 T 54 87 T 66 87"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    class="motion-safe:animate-[stroke-draw_2.2s_ease-in-out_infinite_alternate]"
                />
            {:else}
                <path
                    d="M 22 87 Q 30 82 38 87 T 54 87"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    opacity="0.5"
                />
            {/if}
            <g transform="rotate(30 80 86)">
                <rect x="79" y="74" width="2.5" height="24" rx="1" fill="currentColor" />
            </g>
        </g>
    {:else if role === "development_engineer"}
        <g>
            <rect x="18" y="76" width="52" height="14" rx="1.5" fill="#0b1220" stroke="currentColor" stroke-width="1.2" />
            <line x1="22" y1="80" x2="32" y2="80" stroke="currentColor" stroke-width="0.8" opacity="0.7" />
            <line x1="22" y1="83" x2="44" y2="83" stroke="currentColor" stroke-width="0.8" opacity="0.7" />
            <line x1="22" y1="86" x2="38" y2="86" stroke="currentColor" stroke-width="0.8" opacity="0.7" />
            <line
                x1="40"
                y1="86"
                x2="40"
                y2="89"
                stroke="currentColor"
                stroke-width="1.2"
                class={isRunning ? "motion-safe:animate-[cursor-blink_1.1s_steps(2)_infinite]" : ""}
                opacity={isRunning ? 1 : isPaused ? 0.5 : 0.3}
            />
            <rect x="14" y="90" width="60" height="4" rx="1" fill="currentColor" opacity="0.85" />
            <line x1="22" y1="92" x2="66" y2="92" stroke="#ffffff" stroke-width="0.4" opacity="0.4" />
        </g>
    {:else if role === "qa_engineer"}
        <g>
            <rect x="16" y="80" width="40" height="14" rx="2" fill="#ffffff" stroke="currentColor" stroke-width="1.4" />
            <rect x="32" y="78" width="8" height="4" rx="1" fill="currentColor" />
            <line x1="20" y1="85" x2="52" y2="85" stroke="currentColor" stroke-width="0.7" opacity="0.6" />
            <line x1="20" y1="88" x2="48" y2="88" stroke="currentColor" stroke-width="0.7" opacity="0.6" />
            <line x1="20" y1="91" x2="50" y2="91" stroke="currentColor" stroke-width="0.7" opacity="0.6" />
            <g class={isRunning ? "motion-safe:animate-[magnifier-scan_1.8s_ease-in-out_infinite_alternate]" : ""}>
                <circle cx="66" cy="86" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
                <circle cx="66" cy="86" r="6" fill="currentColor" opacity="0.1" />
                <line x1="70" y1="90" x2="76" y2="94" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </g>
        </g>
    {:else if role === "devops_engineer"}
        <g>
            <g
                class={isRunning ? "motion-safe:animate-[wrench-tap_1.6s_ease-in-out_infinite]" : ""}
                transform-origin="40 86"
            >
                <circle cx="40" cy="86" r="6" fill="none" stroke="currentColor" stroke-width="1.8" />
                <circle cx="40" cy="86" r="2" fill="currentColor" />
                <line x1="40" y1="80" x2="40" y2="92" stroke="currentColor" stroke-width="1.4" />
                <line x1="34" y1="86" x2="46" y2="86" stroke="currentColor" stroke-width="1.4" />
            </g>
            {#if isRunning}
                <circle
                    cx="50"
                    cy="84"
                    r="1.4"
                    fill="currentColor"
                    class="motion-safe:animate-[spark_1.6s_ease-in-out_infinite]"
                />
            {/if}
            {#if showOffDutyProp || !isRunning}
                <g transform="translate(64 88)" opacity="0.75">
                    <circle cx="0" cy="0" r="5" fill="none" stroke="currentColor" stroke-width="1.2" />
                    <circle cx="0" cy="0" r="1.4" fill="currentColor" />
                    {#each [0, 45, 90, 135, 180, 225, 270, 315] as deg}
                        <rect
                            x="-0.7"
                            y="-7.5"
                            width="1.4"
                            height="2.4"
                            fill="currentColor"
                            transform="rotate({deg})"
                        />
                    {/each}
                </g>
            {/if}
        </g>
    {/if}

    <!-- Corner badges on the top-right of the desk zone -->

    {#if isPaused}
        <g transform="translate(82 16)">
            <circle r="7" fill="#0b1220" />
            <rect x="-2.4" y="-3" width="1.6" height="6" fill="#fef3c7" />
            <rect x="0.8" y="-3" width="1.6" height="6" fill="#fef3c7" />
        </g>
    {/if}

    {#if isQuarantined}
        <g transform="translate(82 16)">
            <circle r="7" fill="#7c3aed" />
            <rect x="-2.8" y="-1.2" width="5.6" height="3.6" rx="0.6" fill="#ffffff" />
            <path
                d="M -1.7 -1.2 V -2.9 a 1.7 1.7 0 0 1 3.4 0 V -1.2"
                fill="none"
                stroke="#ffffff"
                stroke-width="0.9"
            />
        </g>
    {/if}

    {#if isFailed}
        <g transform="translate(82 16)">
            <circle r="7" fill="#dc2626" />
            <rect x="-0.7" y="-3.5" width="1.4" height="4.6" fill="#ffffff" />
            <circle cx="0" cy="2.4" r="0.8" fill="#ffffff" />
        </g>
    {/if}
</svg>

<style>
    /* D-05: body never animates; only the prop and the status ring.
       All motion is consumed by motion-safe: class hooks, which
       silently disable under prefers-reduced-motion: reduce. */
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
            stroke-dasharray: 2 56;
            stroke-dashoffset: 0;
        }
        to {
            stroke-dasharray: 56 2;
            stroke-dashoffset: -58;
        }
    }

    @keyframes pen-draw {
        0% {
            transform: rotate(-20deg);
        }
        50% {
            transform: rotate(-12deg);
        }
        100% {
            transform: rotate(-20deg);
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
