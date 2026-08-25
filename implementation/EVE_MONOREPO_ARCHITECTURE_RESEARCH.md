# Eve multi-agent monorepo architecture

**Research date:** 2026-08-23  
**Decision:** use a pnpm workspace with one lockfile, independently deployable Eve agent packages, an Eve extension package for shared agent capabilities, ordinary TypeScript packages for contracts and client composition, and an optional orchestrator Eve agent.

## Executive answer

Yes, this is a supported and sensible topology.

The recommended shape is:

```text
aiengineer/
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── agents/
│   ├── ingestion/             # Eve app; Vercel project 1
│   ├── pre-research/          # Eve app; Vercel project 2
│   ├── retrieval/             # Eve app; Vercel project 3
│   ├── app-factory/           # Eve app; Vercel project 4
│   └── orchestrator/          # optional Eve app; Vercel project 5
└── packages/
    ├── contracts/             # schemas, IDs, DTOs; no Eve runtime behavior
    ├── eve-clients/           # configured Client factory for all deployments
    ├── shared-core/           # deterministic, framework-neutral TypeScript
    └── shared-eve-extension/  # tools, skills, hooks, instructions, subagents
```

This does **not** mean four independent physical copies of every dependency during local development. pnpm uses a content-addressed store and links packages into each workspace. Each package still has a logical `node_modules` view so Node resolution remains correct, but package contents are not copied four times.

Separate Vercel projects still produce separate deployment artifacts and have separate install/build caches. Runtime dependencies cannot be shared across independently deployed projects. The efficiency gains are therefore:

- one dependency graph and lockfile;
- one local content-addressed package store;
- workspace links for internal packages;
- automatic Vercel skipping of unaffected projects when the workspace graph is explicit;
- filtered installs/builds and optional Turborepo caching;
- no copied shared source or manually synchronized client code.

## The important Eve findings

The repository currently contains `eve@0.37.0` in `research_ingestion_systems_agent` and `eve@0.38.3` in `research_starter_pre_research_agent`. The npm `latest` tag was `0.44.3` on the research date. Do not start remote composition while versions differ.

### 1. An Eve app is one root agent

Eve discovers one root agent from an app root and the `agent/` filesystem below it. Each independently deployable agent should therefore remain its own package/app root, with its own `package.json`, `agent/`, `.env.local`, build output, and Vercel project.

Local subagents are not equivalent to separately deployed agents. They belong to the root agent's compiled graph and deployment.

### 2. Eve extensions are the native shared-capability mechanism

The installed `eve@0.38.3` documentation explicitly supports extensions published to npm **or kept private in a monorepo workspace**. An extension can contribute:

- tools;
- skills and their assets;
- hooks;
- instruction fragments;
- connections;
- channels;
- schedules;
- subagents.

Each agent declares the extension with `workspace:*` and mounts it under `agent/extensions/<namespace>.ts`. Nothing is copied into the consumer. The mount namespace prevents naming collisions—for example, `shared/tools/search.ts` becomes `shared__search`.

Use an extension only for capabilities that Eve must discover. Put normal schemas, database helpers, algorithms, and client wrappers in ordinary TypeScript packages.

Production nuance: `eve dev` can build and watch a source-backed workspace extension automatically. `eve build` expects the extension distribution to exist, so the workspace build must build the extension before its consuming agents.

### 3. `eve/client` is the deterministic composition API

`Client` from `eve/client` binds one host plus its authentication/header policy. One process can own any number of clients and each client can own many durable sessions.

This is the right interface for a controller that decides exactly which agent to call, passes structured input, requests an `outputSchema`, records session IDs, runs calls concurrently, resumes sessions, or applies business-level retries.

The special package should export a **factory**, not global pre-created clients. A factory keeps environment lookup and rotating Vercel OIDC token acquisition at runtime and is easy to override in tests.

```ts
// packages/eve-clients/src/index.ts
import { getVercelOidcToken } from "@vercel/oidc";
import { Client } from "eve/client";

export type AgentHosts = {
  ingestion: string;
  preResearch: string;
  retrieval: string;
  appFactory: string;
};

function remoteClient(host: string): Client {
  return new Client({
    host: host.replace(/\/$/, ""),
    auth: {
      vercelOidc: {
        token: () => getVercelOidcToken({
          expirationBufferMs: 5 * 60 * 1000,
        }),
      },
    },
    redirect: "error",
  });
}

export function createEveClients(hosts: AgentHosts) {
  return {
    ingestion: remoteClient(hosts.ingestion),
    preResearch: remoteClient(hosts.preResearch),
    retrieval: remoteClient(hosts.retrieval),
    appFactory: remoteClient(hosts.appFactory),
  } as const;
}
```

The existing `createPipelineClient()` in `controller/pre-research-pipeline.ts` already uses the correct OIDC and redirect pattern. It can eventually consume this package instead of owning a one-agent variant.

### 4. `defineRemoteAgent` is the agentic composition API

If a fifth Eve agent should let its model choose, fan out to, or converse through the other deployments, expose each deployment under `agent/subagents/` with `defineRemoteAgent`:

```ts
// agents/orchestrator/agent/subagents/ingestion/agent.ts
import { defineRemoteAgent } from "eve";
import { vercelOidc } from "eve/agents/auth";
import { ingestionResultSchema } from "@aiengineer/contracts";

export default defineRemoteAgent({
  url: () => process.env.INGESTION_AGENT_URL!,
  description: "Identifies and ingests source material for a research run.",
  auth: vercelOidc(),
  outputSchema: ingestionResultSchema,
});
```

Eve starts a task-mode session on the remote deployment, parks the parent durably, and resumes it when the remote sends the terminal callback. This is more than a thin `Client` wrapper.

Important constraints:

- The remote receives the delegated task, not the parent's full conversation history. Send all required context.
- Use structured output schemas for machine-to-machine boundaries.
- Use runtime URL functions for deployment environment variables; literal strings are frozen at compile time.
- Both deployments must run the same Eve version for agent messaging.
- Use `vercelOidc()` for deployment-to-deployment transport trust.
- If the remote must act as the end user, set `forwardPrincipal: true` and explicitly configure the receiver's `trustedForwarders`. Principal metadata is forwarded; credentials are not.
- Remote traces stay in the remote deployment, so propagate business correlation IDs in task input and logs.

### 5. A composed-client package and an orchestrator agent are complementary

Use only `packages/eve-clients` when orchestration is deterministic application code. This avoids paying for an extra model turn and avoids creating a fifth deployment with no user-facing agent responsibility.

Add `agents/orchestrator` only when at least one of these is true:

- users need to talk to one entry-point agent;
- the model should choose specialists dynamically;
- orchestration needs agent instructions, tools, approvals, or a durable conversation;
- a parent Eve session should park while remote child agents work.

Inside an orchestrator, use both surfaces deliberately:

- `defineRemoteAgent` for model-driven delegation;
- `@aiengineer/eve-clients` inside trusted tools/controllers for exact pipelines.

Do not hide deterministic phase transitions inside prompts. The pre-research controller's current pattern—trusted TypeScript owns phase transitions and uses `eve/client` to create sessions—is the stronger pattern for governed workflows.

## Workspace configuration

### Root workspace

Use one root `pnpm-workspace.yaml`:

```yaml
packages:
  - "agents/*"
  - "packages/*"

catalog:
  eve: 0.38.3
  ai: ^7.0.58
  zod: 4.4.3

minimumReleaseAgeExclude:
  - "@ai-sdk/*"
  - "@vercel/*"
  - ai
  - eve
```

The exact Eve version above is the least-disruptive initial alignment because it is already running in the larger pre-research agent. Treat this as a migration baseline, not a recommendation to stay behind latest. After the monorepo is stable, upgrade every agent and the extension together to a tested exact version such as the then-current release.

In each agent:

```json
{
  "name": "@aiengineer/agent-ingestion",
  "private": true,
  "dependencies": {
    "@aiengineer/contracts": "workspace:*",
    "@aiengineer/eve-clients": "workspace:*",
    "@aiengineer/shared-eve-extension": "workspace:*",
    "eve": "catalog:",
    "ai": "catalog:",
    "zod": "catalog:"
  },
  "engines": { "node": "24.x" }
}
```

Pin an exact Vercel-supported pnpm version in the root `package.json` `packageManager` field and use Corepack in local/CI environments. At the research date, Vercel's documented supported range ended at pnpm 10, while this machine has pnpm 11.15.1. Use an approved pnpm 10 release until Vercel documents pnpm 11 support.

The `workspace:*` protocol is important: pnpm refuses to fall back to a registry package if the local package is absent or has the wrong workspace relationship. That makes a broken monorepo graph fail during installation rather than silently using stale published code.

### Shared Eve extension

Scaffold with Eve, then keep the result private:

```text
packages/shared-eve-extension/
├── package.json
└── extension/
    ├── extension.ts
    ├── instructions.md
    ├── tools/
    ├── skills/
    ├── hooks/
    └── lib/
```

The package should have:

- `eve` as an exact `devDependency` used to build the extension;
- `eve: "*"` as a `peerDependency` supplied by each consumer;
- no regular `eve` dependency;
- `build: "eve extension build"`;
- `prepare: "eve extension build"`;
- runtime SDKs in regular `dependencies`.

Mount it independently in every agent:

```ts
// agent/extensions/shared.ts
export { default } from "@aiengineer/shared-eve-extension";
```

### Build order

The production build graph must be:

```text
contracts/shared-core → eve-clients/shared-eve-extension → selected Eve agent
```

pnpm recursive filtered builds can follow the declared dependency graph. Turborepo is useful once build times justify remote caching, but it is not required for correctness. Start with pnpm alone; add `turbo.json` only after measuring repeated CI builds.

## Vercel topology

Create one Vercel project per independently deployed Eve app, all connected to the same Git repository:

| Vercel project | Root directory | Build output |
| --- | --- | --- |
| ingestion agent | `agents/ingestion` | that agent's `.vercel/output` |
| pre-research agent | `agents/pre-research` | that agent's `.vercel/output` |
| retrieval agent | `agents/retrieval` | that agent's `.vercel/output` |
| app-factory agent | `agents/app-factory` | that agent's `.vercel/output` |
| orchestrator, if needed | `agents/orchestrator` | that agent's `.vercel/output` |

For each project:

1. Set the corresponding root directory.
2. Keep the root workspace lockfile and explicit internal dependencies.
3. Build workspace dependencies before `eve build` for the selected app.
4. Configure that deployment's own secrets and route auth.
5. Give the orchestrator the four agent URLs.
6. Allow Vercel OIDC on receiving Eve channels.
7. Verify `/eve/v1/health` and one real structured turn.

Vercel's monorepo deployment skipping relies on standard workspace declarations, unique package names, one root lockfile, and explicit internal dependencies. A change to `@aiengineer/contracts` should redeploy its dependent agents; a change isolated to one agent should not redeploy all four.

Filtered installs are optional. Vercel documents `pnpm install --filter <project>...`, where the ellipsis includes workspace dependencies. Use it only after the unfiltered frozen-lockfile build is reliable; correctness is worth more than shaving the first minute prematurely.

### Single-project alternative

Eve's `withEve()` Next.js integration can mount multiple named agents in one Vercel project under `/eve/agents/<name>/eve/v1/*`. This is attractive when all agents share one release cadence, auth boundary, environment, and scaling unit.

It is not the default recommendation here because the request describes several full agents and composition across them. Separate projects provide cleaner failure isolation, independent deployment, independent secrets, and explicit service boundaries. Consider the single-project mode only if operational simplicity matters more than that isolation.

## npm, pnpm, and Bun

| Choice | Fit | Recommendation |
| --- | --- | --- |
| pnpm workspace | Content-addressed store, strict workspace protocol, filters, strong Vercel monorepo support, already used by one agent | **Use this** |
| npm workspaces | Simple and supported by Vercel, but typically more hoisting/copying and weaker workspace ergonomics | Acceptable, not best for this repository |
| Bun workspaces as package manager | Fast installs; supports workspaces, filters, catalogs, and isolated installs | Interesting later experiment |
| Bun as Eve runtime | Eve declares Node.js 24+ and produces a Node/Nitro service | **Do not use without explicit Eve support and full durability tests** |

Bun does not remove the independent-deployment boundary. Its global virtual store is off by default, and Vercel still builds separate projects. Changing package manager now would also combine two migrations—monorepo conversion and runtime tooling change—making failures harder to isolate.

The practical choice is pnpm for installation/workspaces and Node.js 24 for Eve execution.

## Migration plan for this repository

The current `C:\Users\Pinda\Proyectos\aiengineer` parent is not itself a Git repository. `research_ingestion_systems_agent`, `research_starter_pre_research_agent`, `app_factory_agent`, and `aiengineerapp` currently have their own `.git` directories. A Vercel monorepo requires one connected Git repository, so repository consolidation is a prerequisite, not just adding workspace files. Decide whether to preserve each history with `git subtree`/history rewriting or start the parent repository from the current snapshots; do not casually delete the nested `.git` directories.

Avoid moving directories in the first pass. A root workspace can initially include the current names:

```yaml
packages:
  - "research_ingestion_systems_agent"
  - "research_starter_pre_research_agent"
  - "research_retrieval_layer"
  - "app_factory_agent"
  - "packages/*"
```

Then migrate safely:

1. Create/consolidate one parent Git repository while deliberately preserving or archiving the existing repository histories.
2. Add a private root `package.json`, root `pnpm-workspace.yaml`, and one root lockfile.
3. Give every package a unique scoped name.
4. Align all Eve apps and the extension on exactly `eve@0.38.3`; run each existing test/typecheck/build suite.
5. Convert the npm-managed pre-research agent to the root pnpm lock without changing application code.
6. Extract contracts and deterministic helpers only where at least two consumers exist.
7. Extract the OIDC client factory and replace the existing local client helper behind tests.
8. Scaffold and mount the shared Eve extension for genuinely model-visible shared capabilities.
9. Link each existing agent directory to a separate Vercel project and verify unaffected-project skipping.
10. Add the orchestrator agent only if model-driven routing is required.
11. Once stable, optionally move directories under `agents/` and upgrade all Eve consumers together to the current release.

### Migration gates

- One root lockfile; no nested `package-lock.json` or `pnpm-lock.yaml` remains.
- `pnpm install --frozen-lockfile` succeeds from the workspace root.
- Every agent passes `typecheck`, tests/evals where present, and `eve build` from a clean checkout.
- Every extension consumer discovers its mounted namespace in `eve info`.
- All remote agents report the same Eve version.
- Each Vercel project rebuilds when a declared shared dependency changes.
- A change isolated to one agent skips unaffected Vercel projects.
- OIDC-authenticated `Client.health()` and one structured session succeed for every deployment.
- A remote-agent smoke test proves callback resume and cancellation.

## Risks and guardrails

- **Version skew:** exact-pin Eve centrally and upgrade atomically. This is the largest framework-specific risk.
- **Over-sharing:** contracts and deterministic code are safe to share; prompts/tools should be shared only when behavior truly must be identical.
- **Hidden dependencies:** every workspace dependency must appear in the consumer's `package.json`; do not rely on hoisting.
- **Build ordering:** production Eve builds need built extension output.
- **Auth confusion:** deployment OIDC authenticates the caller service; end-user identity forwarding is a separate explicit decision.
- **Long-running remote children:** the installed docs note that a parked remote child can outlive parent shutdown. Set session limits and implement operational cleanup where that matters.
- **Preview framework:** Eve documents itself as preview. Keep contracts between agents narrow, versioned, and schema-validated.

## Final recommendation

Adopt pnpm workspaces now, retain independent Eve/Vercel projects, and create these packages first:

1. `@aiengineer/contracts`
2. `@aiengineer/eve-clients`
3. `@aiengineer/shared-eve-extension`

Do not create a fifth Eve deployment merely to hold `Client` objects. Create it only when there is an actual conversational/model-driven orchestration role. This gives the repository efficient local installs and shared code without collapsing the operational isolation of the four agents.

## Sources

Version-specific behavior was taken first from the bundled docs for the installed `eve@0.38.3`, especially:

- `node_modules/eve/docs/extensions.md`
- `node_modules/eve/docs/guides/client/overview.mdx`
- `node_modules/eve/docs/guides/remote-agents.md`
- `node_modules/eve/docs/guides/deployment/vercel.mdx`
- `node_modules/eve/docs/guides/frontend/nextjs.mdx`

External primary references:

- [Eve getting started](https://eve.dev/docs/getting-started)
- [Eve authentication](https://eve.dev/docs/guides/auth-and-route-protection)
- [Eve subagents](https://eve.dev/docs/subagents)
- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [Vercel package managers](https://vercel.com/docs/package-managers)
- [pnpm workspaces and `workspace:` protocol](https://pnpm.io/workspaces)
- [Bun workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun isolated installs](https://bun.sh/docs/pm/isolated-installs)
- [Bun global virtual store](https://bun.sh/docs/pm/global-store)
