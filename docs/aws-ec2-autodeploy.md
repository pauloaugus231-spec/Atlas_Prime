# Auto-Deploy da `main` para EC2

O fluxo de producao atual faz deploy do `atlas-core` na EC2 sempre que houver push na branch `main`.

Ele roda em um runner hospedado pelo GitHub e acessa a EC2 por SSH. Isso evita depender do runner interno da instancia quando ele estiver offline.

## O que o workflow faz

1. faz checkout do repositorio no runner do GitHub
2. valida a conexao SSH e `/srv/atlas/app/.env.production`
3. sincroniza os arquivos do repositorio para `/srv/atlas/app`
4. preserva `.env.production` e o estado local da instancia
5. executa `scripts/deploy-ec2.sh` remotamente
6. aguarda o container `atlas-core` ficar `healthy`

## Secrets no GitHub

O workflow usa estes secrets:

- `AWS_EC2_HOST`
- `AWS_EC2_SSH_KEY`
- `AWS_EC2_PORT`
- `AWS_EC2_USER`
- `AWS_EC2_DEPLOY_PATH`

## Notificacao no Telegram

O deploy usa um segundo workflow dedicado:

- [deploy-telegram-notify.yml](/Users/user/Documents/agente_ai/.github/workflows/deploy-telegram-notify.yml)

Esse workflow roda quando `Deploy EC2` termina e usa os secrets do GitHub:

- `DEPLOY_NOTIFY_TELEGRAM_BOT_TOKEN`
- `DEPLOY_NOTIFY_TELEGRAM_CHAT_ID`

Quando esses secrets existem, ele envia uma mensagem com:

- status do deploy
- branch
- commit curto
- link direto do run

## O que nao e sincronizado

O workflow exclui do `rsync`:

- `.git/`
- `.github/`
- `.env`
- `.env.production`
- `.env.omnichannel`
- `app/node_modules/`
- `app/dist/`
- `app/workspace/.agent-state/`
- `upstream/`

Isso evita sobrescrever segredos, build local e estado operacional.

## Ajustes necessarios no servidor

O servidor precisa manter SSH ativo e estes arquivos/diretorios fora do Git:

- `/srv/atlas/app/.env.production`
- `/srv/atlas/state/workspace/.agent-state`
- `/srv/atlas/state/plugins`
- `/srv/atlas/logs`

## Comportamento de falha

Se o container nao ficar `healthy` dentro do timeout:

- o job falha
- os ultimos logs do servico `agent` aparecem no GitHub Actions

## Proximo passo recomendado

Depois de validar 2 ou 3 deploys automaticos com sucesso, vale adicionar:

- branch de homologacao
- notificacao no Telegram em caso de falha
