# Routing Migration

## Objetivo
Migrar o Atlas de roteamento por gatilho lexical para roteamento por intenção principal, contexto da conversa e entidade alvo.

## Estado atual
O fluxo legado ainda depende de duas características que geram colisão entre serviços:

1. `DirectRouteRunner` resolve no primeiro handler que retornar resposta.
2. Diversos serviços e helpers ainda decidem elegibilidade por `includes(...)` no texto cru.

## Congelamento arquitetural
Enquanto esta migração estiver em andamento:

- nenhum detector lexical novo pode entrar como decisão primária de rota;
- detectores existentes só podem ser reutilizados como `legacy hints`;
- toda nova rota precisa declarar intenção, objeto e operação na camada de roteamento nova;
- mudanças de comportamento em rotas ambíguas devem entrar com eval dedicada.

## Pontos legados auditados
### Alta prioridade
- `app/src/core/generic-prompt-helpers.ts`
- `app/src/core/conversation-interpreter.ts`
- `app/src/core/operational-context-direct-service.ts`
- `app/src/core/content-generation-direct-service.ts`
- `app/src/core/agent-direct-route-handlers.ts`
- `app/src/core/direct-route-runner.ts`
- `app/src/core/agent-direct-route-service.ts`

### Sinais ambíguos já identificados
- `resumo`
- `briefing`
- `agenda`
- `manda`
- `ajusta`
- `muda`
- `lista`
- `esse`
- `essa`
- `na abordagem`

## Classificação de risco dos gatilhos legados
### `safe`
Sinais com objeto e ação suficientemente restritos para permanecerem como compatibilidade temporária.

### `ambiguous`
Sinais que podem apontar para mais de um domínio sem objeto explícito.
Exemplos: `resumo`, `agenda`, `manda`.

### `legacy`
Heurísticas aceitas provisoriamente apenas para não quebrar comportamento existente, mas que precisam sair da decisão principal.

### `dangerous`
Heurísticas que podem disparar escrita, envio ou compartilhamento no domínio errado.

## Estratégia de migração
1. Introduzir `TurnFrame`.
2. Introduzir seleção ranqueada com manifestos de rota.
3. Auditar divergência em `shadow mode`.
4. Migrar primeiro briefing, perfil operacional, command center e conexões.
5. Só depois migrar agenda, email, conteúdo e follow-ups implícitos.

## Critério de pronto da migração
- `resumo` isolado não aciona serviço errado;
- ajuste de briefing não disputa com leitura de briefing;
- criação de evento não cai em leitura de agenda;
- serviços passam a receber intenção estruturada como entrada primária;
- o runner deixa de depender de ordem fixa para as rotas migradas.
