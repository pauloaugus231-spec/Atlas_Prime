# Roadmap de Integracoes Sensiveis e Pesquisa Web

## Objetivo

Expandir o agente para operar como:

- secretario operacional
- analista de negocios e growth
- social media
- operador dev full stack
- apoio de contexto social e academico

Sem perder controle sobre:

- credenciais
- contas pessoais
- canais sensiveis
- rastreabilidade

## Capacidade de pesquisa web

### O que o agente precisara fazer

- pesquisar tendencias e validacoes de mercado
- comparar concorrentes
- buscar documentacao tecnica oficial
- levantar sinais de demanda e monetizacao
- coletar referencias para estudos, TCC e documentos

### Arquitetura recomendada

- `research adapters`
  - busca web
  - fetch de paginas
  - leitura estruturada de HTML
  - extracao de sinais e fontes
- `research memory`
  - salvar consultas, fontes e resumos
- `source policy`
  - diferenciar fontes oficiais, midia, forum e opiniao

### Regra operacional

- respostas de pesquisa devem citar fontes
- pesquisas de mercado devem marcar data da coleta
- estudos e comparativos devem separar fato de inferencia

## Multiplas contas de email

### Necessidade

Hoje o agente opera com uma conta. A proxima fase deve suportar varias contas, por exemplo:

- pessoal
- profissional dev
- profissional social
- comercial
- conteudo

### Desenho recomendado

- `email accounts registry`
  - nome logico da conta
  - IMAP
  - SMTP
  - regras de allowlist
  - assinatura e tom padrao
- `account routing`
  - identificar em qual conta agir
  - separar inbox, drafts, follow-ups e labels
- `approval policy`
  - leitura livre
  - rascunho por conta
  - envio so com confirmacao

## Dois WhatsApps e omnichannel

### Desenho recomendado

- Chatwoot como inbox central
- Evolution API como sidecar de WhatsApp
- agente como cerebro de:
  - triagem
  - prioridade
  - rascunho
  - follow-up
  - resumo operacional

### Regra inicial

- zero auto-resposta ampla
- leitura e triagem primeiro
- depois rascunho com aprovacao
- auto-envio apenas para mensagens de baixo risco e templates curtos

## Automacao autenticada em sites

### Casos futuros

- GESUAS
- sistemas administrativos
- portais de trabalho
- paineis de SaaS

### Desenho recomendado

- `browser sidecar`
  - Playwright em container isolado
- `credential vault`
  - credenciais fora do codigo
  - segredo por sistema e por conta
- `task approval`
  - navegar e ler: permitido com menor risco
  - alterar cadastro ou evoluir atendimento: sempre com confirmacao
- `audit trail`
  - cada acao deve registrar:
    - sistema
    - usuario operador
    - data e hora
    - resumo da alteracao

### Regra forte

Para sistemas sensiveis como GESUAS:

- sem automacao cega
- sem envio silencioso
- sempre com contexto do caso
- sempre com revisao humana nas primeiras fases

## Matriz de risco

### Baixo risco

- pesquisa web
- leitura de email
- leitura de agenda
- classificacao de inbox
- drafts
- analise de projeto

### Medio risco

- enviar email
- responder lead
- mover tarefa
- publicar conteudo
- executar build/test em copia de workspace

### Alto risco

- WhatsApp pessoal
- sistemas com login real
- alteracoes em agenda de terceiros
- atualizacao de atendimento social
- qualquer acao financeira

## Proxima ordem recomendada

1. multi-email por contas nomeadas
2. Chatwoot local
3. Evolution API com leitura e triagem
4. pesquisa web com fontes
5. browser sidecar com Playwright e aprovacao
