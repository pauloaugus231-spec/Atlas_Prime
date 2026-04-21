# Memory Policy

## Two memory layers

### Confirmed memory

Confirmed memory is what Atlas can actively rely on.

Examples:

- identity profile
- operational state
- learned preferences already confirmed
- personal memory items intentionally saved

### Candidate memory

Candidate memory is inferred but not yet trusted enough to behave like confirmed memory.

Examples:

- `prefiro respostas curtas`
- `sempre me lembre de levar casaco leve`
- `telegram é meu canal principal`
- `trabalho em dois empregos`

These items are persisted separately and reviewed before promotion.

## Promotion rule

A memory candidate can be promoted only when there is strong evidence.

Current accepted paths:

- explicit operator statement captured and later approved
- repeated low-risk pattern with enough confidence

## What must not happen

- external messages becoming personal memory silently
- weak inference becoming a permanent preference automatically
- behavioral guesses being presented as truth

## Approval outcomes

- approve => candidate becomes active and is promoted to learned preference or personal memory item
- dismiss => candidate becomes rejected
- snooze => candidate stays pending, with delayed review

## Natural usage

The operator should be able to create memory candidates by speaking normally.

Examples:

- `prefiro respostas diretas`
- `em plantão quero resposta curta`
- `sempre me lembre do casaco leve e do carregador`

The Atlas should detect these, queue them for review and only then absorb them into long-term memory.
