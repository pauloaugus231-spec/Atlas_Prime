# Autonomy Policy

## Baseline rule

Autonomy starts in `pull` mode.

The Atlas may queue suggestions, include the most relevant ones in the morning brief and answer review prompts naturally. It should not become a noisy push engine.

## Suggestion lifecycle

1. observation recorded
2. assessment scored
3. suggestion queued
4. user reviews naturally
5. suggestion is approved, dismissed, snoozed, executed or fails
6. audit and feedback are persisted

## Capability governance

A suggestion does not execute anything by itself.

- read-only and low-risk actions may execute directly when allowed by capability policy
- write, send, schedule, publish or externally sensitive actions must pass capability governance and, when required, approval
- every sensitive action must leave an audit trail

## Safety controls

### Quiet hours

Quiet hours default to `22:00 -> 07:00` in local runtime time.

These hours are already available for future push controls and should be respected by any future notifier.

### Repeated dismissals

If the same suggestion is dismissed repeatedly inside the configured window, the autonomy loop should stop insisting on it.

Current default:

- 3 dismissals inside 7 days => mute requeue

### Snooze pressure reduction

Suggestions snoozed repeatedly lose priority instead of reappearing at the top forever.

## Review surface

The autonomy review surface must stay concise and natural.

Preferred examples:

- `o que eu preciso revisar?`
- `por que a 1?`
- `aprova a 2`
- `revisão da semana`

Avoid exposing implementation jargon to normal users.
