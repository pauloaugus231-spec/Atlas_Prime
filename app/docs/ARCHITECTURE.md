# Architecture

## Current shape

The Atlas runtime is split into three layers:

1. conversational core
2. execution and approvals
3. autonomy subsystem

`AgentCore` remains the conversational host. It resolves intent, delegates to direct services, calls reasoning and returns the response. It is not the place for new autonomy rules.

## Core contracts

- `AgentCore` does not decide proactive autonomy by itself.
- `RequestOrchestrator` owns request finishing concerns such as structured replies, draft extraction and lightweight capture hooks.
- `ApprovalEngine` is the only gate for actions that require confirmation.
- `CapabilityActionService` executes; it does not decide policy.
- `AutonomyLoop` observes, assesses and queues suggestions; it does not talk directly to the user.
- `AutonomyDirectService` is the natural-language review surface for autonomy.

## Autonomy subsystem

The autonomy subsystem lives under `src/core/autonomy` and follows this flow:

`observation -> assessment -> suggestion -> approval -> action -> audit -> learning`

### Main modules

- `observation-store.ts`: persisted raw operational observations
- `suggestion-store.ts`: persisted proactive inbox
- `autonomy-audit-store.ts`: immutable operational trail for autonomy decisions
- `feedback-store.ts`: user reactions such as accepted, dismissed and snoozed
- `autonomy-loop.ts`: deterministic queue builder
- `autonomy-policy.ts`: thresholds, quiet hours and repeated-dismissal controls
- `autonomy-direct-service.ts`: natural-language review surface
- `autonomy-action-service.ts`: bridges approved suggestions into capabilities

## Human interaction model

Natural language and audio are the primary surface.

Examples:

- `o que eu preciso revisar?`
- `aprova a 2`
- `ignora a 1`
- `adia a 3 para amanhã às 9h`
- `revisão da semana`

Slash commands are only aliases. The operator should not need technical phrasing to use the system.

## Memory and commitments

Autonomy now has two sidecar pipelines:

- commitments: promises and returns detected from normal conversation or monitored inbound messages
- memory candidates: explicit long-lived preferences, routines and rules detected from operator language

Neither becomes active memory automatically. Both enter review first.
