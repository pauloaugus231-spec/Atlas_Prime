# Roadmap de Domínios do Agente

## Objetivo

Evoluir o agente para operar com um orquestrador central e cinco domínios especializados:

- assistente social
- secretário operacional
- social media
- dev full stack
- analista de negócios/growth

## Princípio estrutural

- o orquestrador decide o domínio principal de cada pedido
- cada domínio opera com guardrails próprios
- integrações sensíveis nascem em leitura ou rascunho antes de automação ativa
- toda ação externa relevante exige política explícita de aprovação

## Estado atual

Já entregue:

- core modular
- Telegram
- memória operacional local
- leitura e triagem de email
- rascunho e envio controlado de email
- triagem de inbox por categoria
- busca natural de email por remetente ou categoria
- roteamento inicial de domínio
- policy engine inicial por risco e autonomia
- secretário operacional em modo leitura com Google pronto para OAuth
- CRM local com leads, receita e placar mensal
- roots autorizados por domínio no Mac
- social media local com calendário de conteúdo persistente
- assistente social local com notas sensíveis e rascunhos
- dev full stack com scan seguro de projeto e resumo de git

## Fase 1: Orquestrador e Política

Objetivo:

- detectar domínio principal e domínios secundários
- definir risco, autonomia e guardrails por pedido
- injetar o contexto no core e nos plugins

Status:

- implementado no core

Arquivos-base:

- [orchestration.ts](/Users/user/Documents/agente_ai/app/src/core/orchestration.ts)
- [orchestration.ts types](/Users/user/Documents/agente_ai/app/src/types/orchestration.ts)

## Fase 2: Secretário Operacional

Objetivo:

- organizar rotina pessoal e profissional
- consolidar agenda, tarefas, follow-ups e contatos

Integrações:

- Google Calendar API
- Google Tasks API
- Google People API

Plugins previstos:

- `list_today_agenda`
- `schedule_event`
- `reschedule_event`
- `list_followups`
- `create_followup`
- `daily_brief`
- `weekly_review`
- `contact_lookup`

Política:

- leitura de agenda: permitida
- criação ou alteração de compromisso real: confirmação obrigatória

Status:

- leitura pronta, aguardando OAuth do Google

## Fase 3: Analista de Negócios / Growth

Objetivo:

- aumentar receita mensal
- estruturar pipeline comercial, oportunidades e experimentos

Plugins previstos:

- `save_lead`
- `list_leads`
- `update_lead_stage`
- `save_opportunity`
- `rank_opportunities`
- `estimate_roi`
- `track_experiment_result`
- `monthly_revenue_scoreboard`

Métrica central:

- receita fechada
- receita em pipeline
- gap até meta do mês
- ações de maior impacto

Status:

- base local implementada com leads e scoreboard mensal

## Fase 4: Dev Full Stack

Objetivo:

- transformar o agente em operador técnico real para SaaS, scripts e produtos

Plugins previstos:

- `scan_project`
- `summarize_codebase`
- `safe_exec`
- `git_status`
- `run_tests`
- `build_project`
- `deploy_preview`
- `backlog_from_codebase`

Política:

- leitura e análise: liberadas
- execução em projeto: confirmação obrigatória
- deploy real: confirmação obrigatória

Status:

- `scan_project` e `project_git_status` implementados
- `safe_exec` e execuções com efeito ainda não implementados

## Fase 5: Social Media

Objetivo:

- transformar ideias em ativos de distribuição
- produzir e organizar conteúdo para geração de autoridade e receita

Plugins previstos:

- `generate_content_ideas`
- `build_content_calendar`
- `write_post_draft`
- `write_short_script`
- `repurpose_content`
- `save_content_asset`
- `track_content_results`

Integrações:

- YouTube Data API
- plataformas business via Chatwoot ou APIs oficiais

Política:

- rascunho: liberado
- publicação: confirmação obrigatória

Status:

- store local de conteúdo implementado
- calendário exportável em markdown implementado
- publicação externa ainda não implementada

## Fase 6: Assistente Social

Objetivo:

- apoiar demandas da área social com alto cuidado e separação de contexto

Plugins previstos:

- `save_case_note`
- `list_case_notes`
- `draft_social_message`
- `study_summary`
- `formal_document_outline`

Política:

- sempre tratar como contexto sensível
- sem autoenvio
- sem automação irrestrita
- preferência por rascunho e revisão

Status:

- notas locais e rascunhos formais implementados
- integrações externas continuam bloqueadas por padrão

## Fase 7: Omnichannel e Secretaria Ativa

Objetivo:

- consolidar canais e monitoramento operacional

Sidecars e integrações candidatas:

- Chatwoot
- WhatsApp Cloud API
- Evolution API como sidecar, não como core
- Gmail API

Fluxo recomendado:

- canal recebe evento
- agente classifica
- decide se arquiva, cria tarefa, gera rascunho ou pede aprovação

## Regras de autonomia

### Baixo risco

- leitura
- triagem
- priorização
- geração de relatório
- criação de rascunho

### Médio risco

- escrever em workspace
- criar tarefa
- preparar resposta
- preparar proposta
- sugerir ação de agenda

### Alto risco

- enviar mensagem externa
- publicar conteúdo
- alterar compromisso real
- executar ação técnica com impacto

### Crítico

- automação sensível sem revisão
- comunicação da área social
- qualquer ação financeira ou pessoal irreversível

## Próxima ordem recomendada

1. Concluir OAuth do Google e validar agenda, tarefas e contatos reais
2. Definir quais pastas reais do Mac entram em `Dev`, `Social`, `Conteudo`, `Financeiro` e `Admin`
3. Adicionar `safe_exec` com allowlist curta e auditável
4. Expandir social media para geração de briefs e roteiros
5. Avançar omnichannel via Chatwoot e WhatsApp com humano no loop
