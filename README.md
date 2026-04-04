# Agente AI Local

Agente pessoal de IA local, controlado por Telegram, com core modular em Node.js + TypeScript, plugins dinamicos e Ollama rodando no host do Mac.

Esta base usa o repositorio real do Moltbot/OpenClaw como referencia arquitetural, mas foi reduzida para uma V1 menor, mais segura e focada no caso de uso local com Telegram.

## Status atual

As fases entregues até agora incluem:

- core modular em TypeScript
- loader dinamico de plugins
- tool calling com Ollama local
- integracao com Telegram via polling
- memoria operacional local com SQLite
- modo executivo/growth com ranking, foco diario e relatorio
- escrita segura de arquivos no workspace
- integracao de email com leitura IMAP, triagem operacional e envio SMTP controlado
- orquestrador inicial de domínios com policy engine por risco e autonomia
- pacote inicial de secretario operacional com Google Calendar, Tasks e Contacts em modo leitura
- workspace isolado
- leitura apenas de diretorios autorizados
- plugins de base, growth e email com confirmacao explicita de envio

## Estrutura do projeto

```text
/Users/user/Documents/agente_ai
  /app
    /src
      /config
      /core
      /integrations
        /telegram
      /plugins
      /types
      /utils
    /scripts
  /scripts
  /docs
  /upstream
    /openclaw
  Dockerfile
  docker-compose.yml
  .env
  .env.example
  README.md
```

## Relacao com Moltbot / OpenClaw

Repositorio upstream preservado em:

- [openclaw](/Users/user/Documents/agente_ai/upstream/openclaw)

Nesta V1 foram reaproveitados os conceitos centrais do upstream:

- separacao entre core, integracoes e plugins
- discovery dinamico de plugins
- integracao com Telegram como canal principal
- Ollama como provider local

Foi removido da V1 para reduzir superficie e risco:

- gateway websocket completo
- multicanais alem de Telegram
- browser, canvas, voice e automacoes sensiveis
- memoria vetorial dependente de OpenAI

## Requisitos

No Mac:

- Apple Silicon
- Docker Desktop instalado e rodando
- Ollama instalado no host
- um modelo baixado no Ollama
- bot do Telegram criado com BotFather

Validacoes uteis:

```bash
docker version
docker compose version
curl http://localhost:11434/api/tags
ollama list
```

## Pastas do host

A estrutura atual usa estes mounts:

- workspace com escrita: [Agente_Workspace](/Users/user/Agente_Workspace)
- plugins externos com escrita: [Agente_Plugins](/Users/user/Agente_Plugins)
- logs com escrita: [Agente_Logs](/Users/user/Agente_Logs)
- projetos autorizados somente leitura: [Agente_Autorizados](/Users/user/Agente_Autorizados)

Dentro de `Agente_Autorizados`, o agente ja considera estes roots por dominio:

- `Dev`: codigo, repositorios, SaaS e automacoes
- `Social`: materiais da area social e contexto sensivel
- `Conteudo`: roteiros, posts, ativos e calendario editorial
- `Financeiro`: receita, relatorios e controles financeiros
- `Admin`: documentos operacionais e administrativos

Esses caminhos sao configurados no `.env`.

## Configuracao

Copie o arquivo de exemplo:

```bash
cd /Users/user/Documents/agente_ai
cp .env.example .env
```

Valores principais do `.env`:

```dotenv
HOST_AGENT_WORKSPACE=/Users/SEU_USUARIO/Agente_Workspace
HOST_AGENT_PLUGINS=/Users/SEU_USUARIO/Agente_Plugins
HOST_AGENT_LOGS=/Users/SEU_USUARIO/Agente_Logs
HOST_AUTHORIZED_PROJECTS_DIR=/Users/SEU_USUARIO/Agente_Autorizados
HOST_USER_DOCUMENTS_DIR=/Users/SEU_USUARIO/Documents

OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_TIMEOUT_SECONDS=60

TELEGRAM_BOT_TOKEN=seu_token
TELEGRAM_ALLOWED_USER_IDS=seu_user_id
TELEGRAM_POLL_TIMEOUT_SECONDS=30

EMAIL_ENABLED=false
EMAIL_IMAP_HOST=
EMAIL_IMAP_PORT=993
EMAIL_IMAP_SECURE=true
EMAIL_IMAP_USERNAME=
EMAIL_IMAP_PASSWORD=
EMAIL_IMAP_MAILBOX=INBOX
EMAIL_LOOKBACK_HOURS=72
EMAIL_MAX_MESSAGES=10
EMAIL_MAX_SOURCE_BYTES=200000
EMAIL_MAX_TEXT_CHARS=12000
EMAIL_WRITE_ENABLED=false
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=465
EMAIL_SMTP_SECURE=true
EMAIL_SMTP_USERNAME=
EMAIL_SMTP_PASSWORD=
EMAIL_FROM_NAME=
EMAIL_FROM_ADDRESS=
EMAIL_REPLY_ALLOWED_SENDERS=
EMAIL_REPLY_ALLOWED_DOMAINS=

GOOGLE_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/oauth2callback
GOOGLE_OAUTH_PORT=8787
GOOGLE_CREDENTIALS_PATH=/workspace/.agent-state/google-oauth-client.json
GOOGLE_TOKEN_PATH=/workspace/.agent-state/google-oauth-token.json
GOOGLE_CALENDAR_ID=primary
GOOGLE_DEFAULT_TIMEZONE=America/Sao_Paulo
GOOGLE_MAX_EVENTS=10
GOOGLE_MAX_TASKS=15
GOOGLE_MAX_CONTACTS=10
```

Observacoes:

- `OLLAMA_BASE_URL` deve apontar para `http://host.docker.internal:11434`, sem `/v1`
- `HOST_AUTHORIZED_PROJECTS_DIR` pode ser uma pasta com varios projetos ou um projeto especifico montado em modo somente leitura
- `HOST_USER_DOCUMENTS_DIR` monta o seu `/Users/.../Documents` dentro do container para que os symlinks de `Agente_Autorizados` resolvam corretamente
- `TELEGRAM_ALLOWED_USER_IDS` aceita mais de um id separado por virgula
- a integracao de email nasce desativada
- leitura usa IMAP
- envio usa SMTP separado e continua bloqueado ate `EMAIL_WRITE_ENABLED=true`
- o envio de resposta exige confirmacao explicita do usuario no Telegram
- replies podem ser limitados por allowlist de remetentes e dominios

## Preparar diretorios do host

```bash
cd /Users/user/Documents/agente_ai
./scripts/setup-host-dirs.sh .env
./scripts/configure-authorized-roots.sh /Users/user/Agente_Autorizados
```

O segundo script monta os atalhos por dominio dentro de:

- [MAPEAMENTO.md](/Users/user/Agente_Autorizados/MAPEAMENTO.md)

## Baixar modelo no Ollama

Modelo atual recomendado para esta V1:

```bash
ollama pull qwen2.5-coder:3b
```

Ele foi escolhido por equilibrio entre:

- velocidade
- consumo de memoria
- suporte razoavel a ferramentas

## Subir o agente

```bash
cd /Users/user/Documents/agente_ai
docker compose up --build -d
```

Ver logs:

```bash
docker compose logs -f agent
```

Se alterar `.env`, recrie o container:

```bash
docker compose up -d --force-recreate agent
```

## Como testar no Telegram

1. Abra o bot no Telegram.
2. Envie `/start`.
3. Envie uma mensagem simples.
4. Se quiser limpar o contexto curto do chat, envie `/reset`.

Exemplos:

```text
Oi, use a ferramenta ping e me diga o resultado
```

```text
Liste os arquivos do workspace.
```

```text
Leia o arquivo exemplo.txt no workspace e resuma o conteudo.
```

## Comandos uteis de operacao

Como `node_modules` foi instalado dentro do container Linux, rode os comandos do app via Docker:

```bash
docker compose exec agent npm run core:doctor
docker compose exec agent npm run core:plugins
docker compose exec agent npm run core:memory
docker compose exec agent npm run core:chat -- --prompt "Sua mensagem"
```

O que cada comando faz:

- `core:doctor`: valida configuracao, modelos do Ollama e roots legiveis
- `core:plugins`: lista plugins carregados
- `core:memory`: lista os itens atuais da memoria operacional
- `core:chat`: testa o core sem passar pelo Telegram

## Plugins atuais

Plugins built-in em:

- [plugins](/Users/user/Documents/agente_ai/app/src/plugins)

Plugins externos carregados de:

- [Agente_Plugins](/Users/user/Agente_Plugins)

Plugins atuais:

- `ping`: valida o sistema de plugins
- `list_authorized_files`: lista arquivos dentro de `workspace` ou `authorized_projects`
- `read_text_file`: le arquivo texto dentro de roots autorizadas
- `mirror_project_to_workspace`: cria uma copia utilizavel de um projeto autorizado dentro do `workspace`
- `save_memory_item`: grava objetivos, iniciativas, tarefas, oportunidades e notas
- `list_memory_items`: lista itens salvos na memoria operacional
- `update_memory_item`: atualiza status, prioridade e campos de um item
- `get_memory_summary`: retorna um resumo curto do backlog salvo
- `rank_growth_items`: ranqueia o backlog por impacto de negocio
- `get_daily_focus`: devolve o foco diario priorizado
- `write_workspace_file`: grava arquivos de texto e markdown no workspace
- `export_growth_report`: gera relatorio operacional no workspace
- `email_inbox_status`: mostra o estado da integracao de email
- `list_recent_emails`: lista emails recentes em modo leitura
- `read_email_message`: le um email por UID em modo leitura
- `send_email_reply`: envia resposta controlada a um email lido anteriormente; nao fica exposto ao modelo e so e acionado pela confirmacao explicita no Telegram
- `send_email_message`: envia um email simples para destinatarios explicitos em fluxo controlado
- `triage_inbox`: classifica emails recentes por categoria e prioridade

## Memoria operacional

Banco local atual:

- `/Users/user/Agente_Workspace/.agent-state/operational-memory.sqlite`

Uso pretendido:

- objetivos atuais
- iniciativas em andamento
- tarefas priorizadas
- oportunidades de monetizacao
- notas duraveis de contexto

Exemplos de mensagens no Telegram:

```text
Registre na memoria um objetivo ativo de alta prioridade: lançar um produto digital até dezembro.
```

```text
Liste minhas tarefas e oportunidades salvas.
```

```text
Atualize o item 3 da memoria para status done.
```

## Modo executivo / growth

Esta camada usa memoria operacional com score de negocio para priorizar:

- potencial de caixa
- valor de ativo
- reducao de trabalho manual
- capacidade de vender e escalar
- autoridade e distribuicao
- esforco
- confianca

Exemplos de mensagens no Telegram:

```text
Registre uma iniciativa para vender um produto digital com alto potencial de caixa e baixo esforco.
```

```text
Com base na memoria, me diga meu foco diario e as 3 frentes com maior retorno.
```

```text
Gere um relatorio de growth e salve no workspace.
```

Artefato gerado pela V2:

- [Agente_Workspace](/Users/user/Agente_Workspace)

## Email controlado

A V3 agora suporta leitura e envio controlado de email:

- desativada por padrao
- leitura via IMAP
- triagem automatica por categoria e prioridade
- busca natural por remetente ou categoria, sem depender de UID
- envio via SMTP separado
- sem automacao ativa por padrao
- envio so acontece com confirmacao explicita
- exige configuracao explicita

Plugins de email:

- `email_inbox_status`
- `list_recent_emails`
- `read_email_message`
- `send_email_reply`

Exemplo de ativacao futura no `.env`:

```dotenv
EMAIL_ENABLED=true
EMAIL_IMAP_HOST=imap.seuprovedor.com
EMAIL_IMAP_PORT=993
EMAIL_IMAP_SECURE=true
EMAIL_IMAP_USERNAME=voce@dominio.com
EMAIL_IMAP_PASSWORD=sua_senha_ou_app_password
EMAIL_IMAP_MAILBOX=INBOX
EMAIL_WRITE_ENABLED=true
EMAIL_SMTP_HOST=smtp.seuprovedor.com
EMAIL_SMTP_PORT=465
EMAIL_SMTP_SECURE=true
EMAIL_SMTP_USERNAME=voce@dominio.com
EMAIL_SMTP_PASSWORD=sua_senha_ou_app_password
EMAIL_FROM_NAME=Seu Nome
EMAIL_FROM_ADDRESS=voce@dominio.com
EMAIL_REPLY_ALLOWED_SENDERS=lead@empresa.com,cliente@empresa.com
EMAIL_REPLY_ALLOWED_DOMAINS=empresa.com
```

Exemplos de uso:

```text
Use a ferramenta email_inbox_status e me diga se a integracao esta pronta.
```

```text
Liste meus emails recentes nao lidos.
```

```text
Leia o email UID 123 e me entregue um resumo com prioridade e proxima acao.
```

```text
Tem email do linkedin?
```

```text
Me traga o ultimo email da Renner.
```

```text
Me traga o ultimo email social.
```

```text
Me traga o ultimo email promocional.
```

```text
Leia o ultimo email do linkedin e redija uma resposta afirmativa, formal, mas nao envie ainda.
```

```text
Leia o email UID 123, considere o contexto profissional dev e redija uma resposta elegante dizendo que sim, quero conversar, mas nao envie ainda.
```

```text
sim, quero
```

```text
Leia o email UID 123 e use exatamente este texto: Olá, obrigado pelo contato. Não tenho interesse neste momento. Não envie ainda.
```

```text
Faça a triagem do meu inbox não lido por categoria e prioridade.
```

```text
Deixe esse rascunho mais formal.
```

Fluxo no Telegram:

- o agente le o email
- gera um rascunho estruturado com `EMAIL_REPLY_DRAFT`
- guarda esse rascunho no contexto curto do chat
- voce pode refinar o rascunho com novas instrucoes sem repetir o UID
- quando voce responde `sim, quero`, o Telegram envia a resposta usando `send_email_reply`
- se responder `cancelar rascunho`, o rascunho pendente e descartado

## Secretario operacional com Google

O pacote inicial de secretario operacional usa:

- Google Calendar
- Google Tasks
- Google Contacts (People API)

Estado atual:

- leitura e organizacao: implementadas
- alteracao de agenda real: ainda nao ativada
- escrita de tarefas ou contatos: ainda nao ativada

Plugins novos:

- `google_workspace_status`
- `list_calendar_events`
- `list_google_tasks`
- `search_google_contacts`
- `daily_operational_brief`

Como configurar:

1. Ative no Google Cloud:
   - Calendar API
   - Tasks API
   - People API
2. Crie credenciais OAuth 2.0.
3. Para a V1 local, use um redirect URI como:
   - `http://127.0.0.1:8787/oauth2callback`
4. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`, ou salve o JSON do OAuth client em:
   - [google-oauth-client.json](/Users/user/Agente_Workspace/.agent-state/google-oauth-client.json)
5. Recrie o container:

```bash
docker compose up -d --force-recreate agent
```

6. Rode a autenticacao:

```bash
docker compose exec agent npm run google:auth
```

Se quiser gerar o JSON de credenciais a partir do `.env` do host:

```bash
./scripts/google/export-client-json-from-env.sh
```

Se quiser copiar um `client_secret.json` baixado do Google Cloud:

```bash
./scripts/google/install-client-json.sh /caminho/para/client_secret.json
```

7. Abra a URL impressa no navegador do Mac e conclua o consentimento.
8. O token sera salvo em:
   - [google-oauth-token.json](/Users/user/Agente_Workspace/.agent-state/google-oauth-token.json)

Exemplos de uso:

```text
Me dê meu brief diário.
```

```text
Liste meus próximos compromissos.
```

```text
Liste minhas tarefas do Google.
```

```text
Procure o contato Maria Silva.
```

Comportamento:

- o `brief diário` cruza agenda, tarefas e foco salvo na memória operacional
- a integração nasce em modo leitura
- qualquer automação real de calendário ou tarefas entra depois, com confirmação explícita

## CRM local e placar de receita

O pacote inicial de growth e receita usa SQLite local em:

- [growth-ops.sqlite](/Users/user/Agente_Workspace/.agent-state/growth-ops.sqlite)

Plugins novos:

- `save_lead`
- `list_leads`
- `update_lead_stage`
- `save_revenue_entry`
- `monthly_revenue_scoreboard`

Exemplos de uso:

```text
Me dê meu placar mensal de receita.
```

```text
Cadastre um lead chamado Maria, da empresa Altiva, com potencial mensal de 1500 reais.
```

```text
Liste meus leads em proposta.
```

```text
Registre uma receita recebida de 900 reais no canal consultoria.
```

Comportamento:

- o placar mensal separa `projetado`, `ganho/fechado`, `recebido` e `pipeline aberto`
- leads ficam organizados por estágio e follow-up
- esta base prepara o agente para atuar como analista de negocios e growth com dados persistentes

Smoke test local de email:

```bash
cd /Users/user/Documents/agente_ai/app
npm run email:smoke
```

## Como adicionar um plugin novo

O loader descobre automaticamente arquivos com nome:

- `*.plugin.ts`
- `*.plugin.js`
- `*.plugin.mjs`
- `*.plugin.cjs`

Pode colocar o arquivo em:

- [Agente_Plugins](/Users/user/Agente_Plugins)

Exemplo minimo de plugin externo:

```ts
export default {
  kind: "tool",
  name: "hello_tool",
  description: "Returns a simple greeting.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name to greet.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  execute(parameters) {
    return {
      ok: true,
      message: `Hello, ${parameters.name}`,
    };
  },
};
```

Salve como:

- `/Users/user/Agente_Plugins/hello_tool.plugin.ts`

Depois recrie o container:

```bash
cd /Users/user/Documents/agente_ai
docker compose up -d --force-recreate agent
```

E valide:

```bash
docker compose exec agent npm run core:plugins
```

## Contrato de plugin

Interface principal em:

- [plugin.ts](/Users/user/Documents/agente_ai/app/src/types/plugin.ts)

Campos principais:

- `name`
- `description`
- `parameters`
- `execute()`

## Politica de acesso a arquivos

Implementada em:

- [file-access-policy.ts](/Users/user/Documents/agente_ai/app/src/core/file-access-policy.ts)

Roots legiveis:

- `workspace`
- `authorized_projects`
- `authorized_dev`
- `authorized_social`
- `authorized_content`
- `authorized_finance`
- `authorized_admin`

Regras da V1:

- escrita somente em `workspace`
- leitura somente em `workspace` e nos roots autorizados
- acesso fora dessas roots e bloqueado
- `authorized_projects` sobe em modo somente leitura no Docker
- os atalhos reais de `Dev`, `Social` e `Conteudo` dependem do mount de `HOST_USER_DOCUMENTS_DIR`

Uso prático por domínio:

- `authorized_dev`: projetos, código, SaaS e automações
- `authorized_social`: materiais da área social e contexto sensível
- `authorized_content`: roteiros, posts, calendário editorial e ativos
- `authorized_finance`: receita, relatórios e controles financeiros
- `authorized_admin`: documentos operacionais e administrativos

## Dev Full Stack

Capacidades entregues:

- `scan_project`
- `project_git_status`

Exemplos de uso:

```text
Analise o projeto no workspace.
```

```text
Analise o projeto na pasta api dentro de authorized_dev.
```

```text
Use a ferramenta project_git_status no root authorized_dev.
```

Comportamento:

- leitura e análise de estrutura de projeto: liberadas
- resumo de `package.json`, scripts e dependências: liberado
- `git status` seguro: liberado
- `npm/pnpm/yarn build|test` em roots somente leitura: bloqueados por política
- para build/test, copie ou espelhe o projeto para `workspace` antes de executar
- execução destrutiva ou deploy: ainda não implementados

## Safe Exec auditavel

Implementado em:

- [safe-exec.ts](/Users/user/Documents/agente_ai/app/src/core/safe-exec.ts)

Politica atual:

- comandos permitidos por allowlist
- auditoria em JSONL em:
  - [safe-exec-audit.jsonl](/Users/user/Agente_Logs/safe-exec-audit.jsonl)
- `git status`, `git branch --show-current` e `git diff --stat`: permitidos em roots autorizadas
- `npm`, `pnpm` e `yarn`: permitidos apenas no `workspace`, porque exigem escrita
- comandos de instalacao tambem entram na allowlist:
  - `npm ci`
  - `npm install`
  - `pnpm install`
  - `yarn install`

Exemplos:

```text
Rode git branch na pasta Abordagem dentro de authorized_dev.
```

```text
Espelhe o projeto na pasta agente_ai/app para o workspace.
```

```text
Rode npm ci na pasta mirrors/authorized_dev/app dentro de workspace.
```

```text
Rode npm run build na pasta meu-projeto dentro de workspace.
```

## Social Media

Capacidades entregues:

- `save_content_item`
- `list_content_items`
- `update_content_item`
- `export_content_calendar`

Banco local:

- [content-ops.sqlite](/Users/user/Agente_Workspace/.agent-state/content-ops.sqlite)

Exemplos de uso:

```text
Me dê meu calendário editorial.
```

```text
Salve um item de conteúdo para Instagram em formato post, com pilar autoridade.
```

```text
Exporte meu calendário de conteúdo para reports/calendario-editorial.md.
```

Comportamento:

- conteúdo fica persistido localmente
- exportação gera markdown no `workspace`
- publicação externa continua fora do escopo automático

## Assistente Social

Capacidades entregues:

- `save_case_note`
- `list_case_notes`
- `draft_social_message`

Banco local:

- [social-assistant.sqlite](/Users/user/Agente_Workspace/.agent-state/social-assistant.sqlite)

Exemplos de uso:

```text
Liste minhas notas sociais.
```

```text
Salve uma nota social restrita sobre um atendimento.
```

```text
Redija uma mensagem formal de follow-up da área social, sem enviar.
```

Comportamento:

- notas sensíveis ficam locais e separadas
- rascunhos são gerados para revisão humana
- envio automático continua bloqueado

## Fluxo interno da V1

1. Telegram recebe mensagem
2. adapter do Telegram normaliza a entrada
3. core monta o prompt do agente
4. Ollama responde diretamente ou chama ferramenta
5. registry executa o plugin
6. core consolida a resposta final
7. Telegram envia a resposta ao usuario

Arquivos principais desse fluxo:

- [telegram-service.ts](/Users/user/Documents/agente_ai/app/src/integrations/telegram/telegram-service.ts)
- [agent-core.ts](/Users/user/Documents/agente_ai/app/src/core/agent-core.ts)
- [plugin-registry.ts](/Users/user/Documents/agente_ai/app/src/core/plugin-registry.ts)
- [ollama-client.ts](/Users/user/Documents/agente_ai/app/src/core/ollama-client.ts)

## Troubleshooting

### O bot nao responde no Telegram

Verifique:

```bash
docker compose logs -f agent
```

Checar:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- conectividade de rede do container
- se o bot subiu com `Telegram bot ready`

### O Ollama nao responde

No host:

```bash
curl http://localhost:11434/api/tags
ollama list
```

Se necessario:

```bash
brew services restart ollama
```

### O workspace aparece vazio

Isso significa que a pasta montada em `HOST_AGENT_WORKSPACE` esta vazia. Coloque arquivos em:

- [Agente_Workspace](/Users/user/Agente_Workspace)

### Projeto autorizado abre, mas o agente nao consegue ler arquivos

Verifique:

- se `HOST_USER_DOCUMENTS_DIR` aponta para o `Documents` real do Mac
- se os atalhos em [MAPEAMENTO.md](/Users/user/Agente_Autorizados/MAPEAMENTO.md) existem
- se o container foi recriado depois de mudar o `.env`

Recrie:

```bash
docker compose up -d --force-recreate agent
```

### Google aparece como enabled mas not configured

Isso significa que o container nao recebeu um OAuth client valido.

Use um destes caminhos:

```bash
./scripts/google/export-client-json-from-env.sh
```

ou

```bash
./scripts/google/install-client-json.sh /caminho/para/client_secret.json
```

Depois:

```bash
docker compose up -d --force-recreate agent
docker compose exec agent npm run google:auth
```

### `npm run build` falha em root autorizada

Isso e esperado.

As roots autorizadas do Mac sobem em modo somente leitura. Builds e testes que escrevem em `dist`, cache ou artefatos temporarios devem rodar em `workspace`.

O `safe_exec` agora bloqueia isso explicitamente e registra o evento no audit log.

## Omnichannel

Scaffold entregue:

- [docker-compose.omnichannel.yml](/Users/user/Documents/agente_ai/docker-compose.omnichannel.yml)
- [.env.omnichannel.example](/Users/user/Documents/agente_ai/.env.omnichannel.example)
- [evolution-api](/Users/user/Documents/agente_ai/upstream/evolution-api)

Stack prevista:

- Chatwoot
- Evolution API
- Postgres
- Redis

Objetivo:

- centralizar canais sensiveis fora do core
- manter o agente como orquestrador, triador e gerador de rascunhos
- ativar WhatsApp e canais sociais por sidecar, nao por acoplamento direto no core

### Erro de `esbuild` no host

Nao rode `npm run ...` direto em `/Users/user/Documents/agente_ai/app` no host com o `node_modules` do container.

Use:

```bash
docker compose exec agent npm run core:doctor
```

## Proximos passos naturais

Depois da V3 entregue, as proximas evolucoes mais diretas sao:

- leitura e analise de projetos autorizados
- comandos shell allowlist para build, teste e automacao controlada
- provider hibrido com OpenAI opcional e Ollama como fallback
- templates de vendas, conteudo e prospeccao
- integracoes futuras com multiplos canais, somente apos validacao de seguranca
Roadmap atual de domínios:

- [domain-roadmap.md](/Users/user/Documents/agente_ai/docs/domain-roadmap.md)
- [sensitive-integrations-roadmap.md](/Users/user/Documents/agente_ai/docs/sensitive-integrations-roadmap.md)
