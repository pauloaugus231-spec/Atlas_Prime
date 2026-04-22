# Release Gate — Atlas Personal OS

## Objetivo

Impedir regressões silenciosas nas áreas mais sensíveis do Atlas antes de cada deploy.

## Regras mínimas

1. Nenhuma ação externa com `risk >= medium` sem aprovação explícita.
2. Toda sugestão proativa deve ter evidência, origem e motivo.
3. Toda ação com efeito relevante deve ter audit trail.
4. Toda memória aprendida deve ter fonte, confiança e status de revisão.
5. Sugestões ignoradas devem perder prioridade futura.
6. Conteúdo externo nunca vira comando só porque apareceu em email, WhatsApp, web ou anexo.
7. O briefing precisa continuar útil e legível, sem virar painel barulhento.
8. O WhatsApp monitorado não responde sozinho.
9. O email não envia sem confirmação explícita.
10. Evals críticas devem passar antes do deploy.

## Gate atual

O gate executa uma suíte agregada com foco em:

- request orchestration
- autonomy loop
- autonomy audit
- commitment extraction
- memory candidates
- briefing profiles
- external reasoning bypass
- human model
- account linking foundation
- destination registry e privacy/sharing
- command center
- life domains core
- mission system
- research desk
- knowledge graph incremental
- fluxo e2e crítico

## Política operacional

Se o gate falhar:

- não há release
- não há deploy
- a regressão deve ser corrigida antes de seguir com novas fases
