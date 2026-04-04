# Auto-Deploy da `main` para EC2

O fluxo de producao atual faz deploy do `atlas-core` na EC2 sempre que houver push na branch `main`.

Se os secrets obrigatorios ainda nao estiverem cadastrados, o workflow fica `skipped` e nao tenta publicar nada.

## O que o workflow faz

1. faz checkout do repositorio no GitHub Actions
2. abre conexao SSH com a EC2
3. sincroniza os arquivos do repositorio para `/srv/atlas/app`
4. preserva `.env.production` e o estado local da instancia
5. executa `scripts/deploy-ec2.sh`
6. aguarda o container `atlas-core` ficar `healthy`

## Secrets necessarios no GitHub

Cadastre estes secrets em:

- `Settings -> Secrets and variables -> Actions`

Obrigatorios:

- `AWS_EC2_HOST`
- `AWS_EC2_SSH_KEY`

Opcionais:

- `AWS_EC2_PORT` (default: `22`)
- `AWS_EC2_USER` (default: `ubuntu`)
- `AWS_EC2_DEPLOY_PATH` (default: `/srv/atlas/app`)

## Valores para o ambiente atual

Para a instancia atual:

- `AWS_EC2_HOST`: IP publico da EC2
- `AWS_EC2_USER`: `ubuntu`
- `AWS_EC2_DEPLOY_PATH`: `/srv/atlas/app`
- `AWS_EC2_PORT`: `22`

## Conteudo do secret `AWS_EC2_SSH_KEY`

Cole o conteudo completo da chave privada usada para acessar a EC2.

Exemplo de formato:

```text
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

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

## Ajustes no servidor

O servidor precisa manter estes arquivos/diretorios fora do Git:

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
- deploy manual para producao via `workflow_dispatch`
- notificacao no Telegram em caso de falha
