# StreamTube — Plataforma de Compartilhamento de Vídeos

Projeto da disciplina **Desenvolvimento de Aplicações de IA** do MBA de Engenharia de Software com IA da [Full Cycle](https://fullcycle.com.br).

Este é um projeto greenfield desenvolvido para demonstrar como construir uma aplicação do zero utilizando IA de forma adequada no processo de desenvolvimento.

## Professor

<a href="https://github.com/argentinaluiz">
    <img src="https://avatars.githubusercontent.com/u/4926329?v=4?s=100" width="100px;" alt=""/>
    <br />
    <sub>
        <b>Luiz Carlos</b>
    </sub>
</a>

---

## Quadro Branco

- [Quadro Branco](./whiteboard.png)

---

## 🎨 Design System (Figma)

- [FC Tube.fig](./FC%20Tube.fig) — arquivo-fonte do **design system** do projeto no Figma.
- [FC Tube sem padrão.fig](./FC%20Tube%20sem%20padrao.fig) — arquivo-fonte puro, sem tokens, cores, tipografia e espaçamento.

Contém os fundamentos visuais do StreamTube — tokens (cores, tipografia, espaçamento, raios), componentes e as telas da plataforma. É a referência de design para a implementação do frontend: os componentes em `next-frontend/components/ui` (shadcn) e os tokens em `next-frontend/app/globals.css` derivam deste arquivo. Abra-o no Figma (`Arquivo → Importar`) para consultar especificações e estados visuais.

---

## 📋 Pré-requisitos

- Docker e Docker Compose
- Node.js v25+ (só para rodar os testes E2E do Playwright do frontend no host; o backend roda inteiro nos containers)
- npm

## 🏗️ Arquitetura

O projeto é um monorepo baseado em containers Docker. Cada subprojeto sobe sua própria stack via `docker compose`.

- **Frontend** (Next.js 16, App Router + React Server Components) — interface da plataforma. Segue o **modelo BFF**: o navegador nunca chama a API NestJS diretamente; todo tráfego passa por Route Handlers same-origin em `app/api/**`, que fazem proxy server-side para a API.
- **API** (NestJS 11) — regras de negócio, autenticação (JWT + refresh token rotation), envio de e-mails e acesso ao banco. No upload de vídeo, a API só assina as URLs; os bytes vão do cliente direto para o storage.
- **Database** (PostgreSQL 17) — usuários, canais, tokens de autenticação e vídeos.
- **Email Service** (Mailpit) — captura os e-mails transacionais (confirmação de conta e recuperação de senha) em uma UI local.
- **Video Worker** (FFmpeg) — container `video-worker`, com o mesmo código da API e entrada própria em `src/worker.ts`. Lê a duração e os metadados com o ffprobe, gera a thumbnail com o ffmpeg e atualiza o status do vídeo.
- **Object Storage** (MinIO, compatível com S3) — arquivos de vídeo e thumbnails.
- **Message Queue** (BullMQ + Redis) — fila `video-processing`, por onde a API manda o worker processar cada vídeo.

O diagrama de arquitetura completo (C4) está em `docs/diagrams/software-arch.mermaid`.

## 🚀 Como rodar

Os dois subprojetos têm stacks Docker **separadas**. Suba primeiro o backend, rode as migrations e depois o frontend.

### 1. Backend (NestJS + PostgreSQL + Mailpit + MinIO + Redis + worker)

```bash
cd nestjs-project

# Cria o .env a partir do modelo (apenas na primeira vez).
# O compose também lê esse arquivo: as credenciais do MinIO vêm de S3_ACCESS_KEY e S3_SECRET_KEY.
cp .env.example .env

# Sobe API, banco, Mailpit, MinIO, Redis e o video-worker
docker compose up -d

# Instala dependências (apenas na primeira vez)
docker compose exec nestjs-api npm install

# O worker já tenta iniciar no "up", antes de existir node_modules.
# Depois do npm install, reinicie e confira se ele está no ar:
docker compose restart video-worker
docker compose logs video-worker   # deve aparecer "Video worker started"
# O log ainda mostra antes o erro "Cannot find module" da primeira tentativa; pode ignorar.

# Cria o schema do banco (obrigatório — synchronize está desabilitado)
docker compose exec nestjs-api npm run migration:run

# Sobe o servidor de desenvolvimento em watch mode
docker compose exec -d nestjs-api npm run start:dev

# Confere se a API está no ar (espera 401, porque a rota exige login)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/auth/me
```

Com `-d`, a saída do `start:dev` não aparece em `docker compose logs nestjs-api`. Para ver o log da API, rode o mesmo comando sem `-d`, num terminal separado.

O bucket de vídeos (`S3_BUCKET`) é criado pela própria aplicação quando ela sobe, então não há passo manual no MinIO.

Serviços disponíveis:

| Serviço | URL / Porta |
|---------|-------------|
| API NestJS | http://localhost:3000 |
| PostgreSQL | `localhost:5432` (db/user/senha: `streamtube`) |
| Mailpit (UI de e-mails / SMTP) | http://localhost:8025 / `localhost:1025` |
| MinIO (API S3 / console) | http://localhost:9000 / http://localhost:9001 — login com `S3_ACCESS_KEY` e `S3_SECRET_KEY` do `.env` |
| Redis | `localhost:6379` |
| Swagger (opcional) | http://localhost:3000/api/docs — habilite com `SWAGGER_ENABLED=true` no `.env` e reinicie o `start:dev` |

### 2. Frontend (Next.js)

```bash
cd next-frontend

# Garanta que o .env.local existe (veja .env.example)
# API_URL aponta para o backend; SESSION_PASSWORD protege a sessão (iron-session)

docker compose up -d
docker compose exec next-frontend npm install        # apenas na primeira vez
docker compose exec -d next-frontend npm run dev
```

A aplicação ficará disponível em **http://localhost:3001**.

> As stacks são separadas, então o frontend acessa o backend via `host.docker.internal:3000` (configurado em `next-frontend/.env.local` e no `extra_hosts` do compose).

## 🧪 Testes

### Backend (Jest)

```bash
cd nestjs-project
docker compose exec nestjs-api npm test               # unitários + integração
docker compose exec nestjs-api npm run test:e2e       # end-to-end (HTTP via supertest)
docker compose exec nestjs-api npm run test:cov       # cobertura
docker compose exec nestjs-api npx tsc --noEmit       # checagem de tipos (deve sair com código 0)
docker compose exec nestjs-api npm run lint           # ESLint com --fix (corrige o que der e pode alterar arquivos)
```

O lint deve terminar com 0 erros. Os 23 warnings `no-unsafe-argument` nos testes de `src/auth` já existiam antes da Fase 03.

Sufixos: `*.spec.ts` (unitário), `*.integration-spec.ts` (integração com banco real), `*.e2e-spec.ts` (end-to-end). Os scripts `test` e `test:e2e` já rodam com `--runInBand`, uma suíte por vez, porque todas usam o mesmo banco.

Antes de rodar os testes, siga os passos da seção "Como rodar" até o `migration:run`; não é preciso subir o `start:dev`. Os testes de vídeo usam o MinIO, o Redis e o `video-worker` de verdade, então os três precisam estar no ar (`docker compose ps`). O e2e do fluxo completo espera o worker processar um vídeo de amostra (`test/fixtures/sample.mp4`).

> Os testes usam o mesmo banco `streamtube` do ambiente de desenvolvimento e apagam as tabelas entre um caso e outro. Rodar os testes apaga os dados que você criou usando a aplicação.

### Frontend (Vitest + Playwright)

```bash
cd next-frontend
docker compose exec next-frontend npm test            # unitários + integração (Vitest + MSW)
npx playwright test                                   # end-to-end (no host, com dev server em MSW_ENABLED=true)
```

Sufixos: `*.test.ts(x)` (unitário), `*.integration.test.ts(x)` (Route Handlers com MSW), `*.e2e-spec.ts` (Playwright). MSW intercepta as chamadas à API NestJS — os testes nunca batem no backend real.

## ✅ Funcionalidades implementadas

**Fase 01 — Configuração base** e **Fase 02 — Autenticação** estão concluídas (backend + frontend). **Fase 03 — Upload e processamento de vídeos** está concluída no backend; a interface de vídeo fica para as próximas fases.

### Autenticação (Fase 02)

Fluxo completo de **cadastro → confirmação por e-mail → login → recuperação de senha**, com canal criado automaticamente para cada usuário (a partir do prefixo do e-mail).

Endpoints da API (`nestjs-project`):

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /auth/register` | Cadastro de usuário (cria usuário + canal) |
| `GET /auth/confirm-email?token=` | Confirmação de conta via link do e-mail |
| `POST /auth/resend-confirmation` | Reenvio do e-mail de confirmação |
| `POST /auth/login` | Login (retorna access + refresh token) |
| `POST /auth/refresh` | Rotação de refresh token (com family + grace period) |
| `POST /auth/logout` | Revoga os refresh tokens da sessão |
| `POST /auth/forgot-password` | Solicita e-mail de recuperação de senha |
| `POST /auth/reset-password` | Redefine a senha via token |
| `GET /auth/me` | Dados do usuário autenticado (protegido por JWT) |

Telas e Route Handlers BFF (`next-frontend`):

- `/(auth)/signup`, `/(auth)/login`, `/(auth)/forgot-password` — formulários com React Hook Form + Zod e validação inline.
- `app/api/auth/{signup,login,logout,forgot-password}` — proxy same-origin para a API.

Segurança: senhas com **Argon2**, **JWT** com `JwtAuthGuard` global (opt-out via `@Public()`), **rotação de refresh token** com detecção de reuso, **rate limiting** (`ThrottlerGuard`) nos endpoints de auth, e sessão no navegador via **iron-session** (cookies HTTP-only).

### Vídeos (Fase 03)

O upload aceita arquivos de até 10GB e é feito em partes de 100MiB (multipart do S3). O cliente pede uma URL assinada para cada parte e envia a parte direto para o MinIO, sem passar pela API. Ao concluir, a API confere o tamanho do arquivo no storage e põe um job na fila. O worker então extrai duração e metadados, gera a thumbnail e marca o vídeo como pronto. O status segue `draft → processing → ready`, ou `error` quando o arquivo não é um vídeo válido ou o processamento falha nas 3 tentativas. Cada vídeo recebe um `publicId` único de 11 caracteres, usado nas rotas. Nesta fase, só o dono do canal acessa os próprios vídeos; quem não é o dono recebe `404`.

Endpoints da API (todos exigem JWT):

| Método & Rota | Descrição |
|---------------|-----------|
| `POST /videos` | Cria o vídeo como `draft` e devolve o plano de upload (tamanho e número de partes) |
| `POST /videos/:publicId/upload/parts` | Devolve as URLs assinadas das partes pedidas |
| `GET /videos/:publicId/upload/parts` | Lista as partes já enviadas (para retomar um upload) |
| `POST /videos/:publicId/upload/complete` | Conclui o upload e põe o vídeo na fila de processamento (`202`) |
| `GET /videos/:publicId` | Status, duração e metadados do vídeo |
| `GET /videos/:publicId/stream` | Redireciona (`302`) para uma URL assinada que aceita `Range` e responde `206` |
| `GET /videos/:publicId/download` | Redireciona (`302`) para uma URL assinada que baixa o arquivo como anexo |
| `GET /videos/:publicId/thumbnail` | Redireciona (`302`) para a thumbnail |

As decisões técnicas da fase estão em `docs/decisions/technical-decisions-phase-03-videos.md`, e o plano e o progresso em `docs/phases/phase-03-videos/`.

## 🛠️ Estrutura do Projeto

```
green-field-ia-project/
├── docs/
│   ├── project-plan.md                  # Planejamento geral do projeto
│   ├── phases/                          # Planos e implementação por fase
│   │   ├── phase-01-configuracao-base/
│   │   ├── phase-02-auth/               # Auth (backend)
│   │   ├── phase-02-auth-frontend/      # Auth (frontend)
│   │   └── phase-03-videos/             # Upload e processamento de vídeos
│   ├── decisions/                       # Decisões técnicas (por fase e por tarefa)
│   └── diagrams/
│       └── software-arch.mermaid        # Diagrama de arquitetura (C4)
├── nestjs-project/                      # Backend API (NestJS 11)
│   ├── src/
│   │   ├── auth/                        # Cadastro, login, JWT, refresh, reset de senha
│   │   ├── users/                       # Entidade e serviço de usuários
│   │   ├── channels/                    # Canal 1:1 por usuário (nickname do e-mail)
│   │   ├── mail/                        # Envio de e-mails (templates Handlebars)
│   │   ├── common/                      # Filtros, pipes e exceptions de domínio
│   │   ├── config/                      # Configs namespaced (Joi)
│   │   ├── database/                    # data-source, migrations e seeds
│   │   ├── videos/                      # Upload, status, streaming e download de vídeos
│   │   │   └── processing/              # Processor do worker (ffprobe/ffmpeg)
│   │   ├── storage/                     # Cliente S3 (MinIO) e URLs assinadas
│   │   ├── queue/                       # Fila BullMQ (video-processing)
│   │   └── worker.ts                    # Entrada do video-worker
│   ├── test/                            # Testes e2e e fixtures de vídeo
│   ├── specs/                           # Specs dos testes e2e de vídeo
│   ├── compose.yaml                     # Docker Compose (API, PostgreSQL, Mailpit, MinIO, Redis, video-worker)
│   ├── Dockerfile.dev
│   └── Dockerfile.worker                # Imagem do worker, com FFmpeg
├── next-frontend/                       # Frontend (Next.js 16, App Router)
│   ├── app/                             # Rotas, layouts, páginas e Route Handlers BFF
│   ├── components/                      # Componentes de auth, UI (shadcn) e ícones
│   ├── lib/                             # env, api (openapi-fetch), auth/session
│   ├── mocks/                           # MSW (handlers + server)
│   ├── tests/                           # E2E (Playwright)
│   ├── compose.yaml                     # Docker Compose (dev server)
│   └── Dockerfile.dev
├── CLAUDE.md                            # Instruções para IA
├── FC Tube.fig                          # Design system do projeto (Figma)
├── whiteboard.png                       # Quadro branco do projeto
└── README.md
```

## 📚 Fases do Projeto

| Fase | Descrição | Status |
|------|-----------|--------|
| **01** | Configuração Base do Projeto | ✅ Concluída |
| **02** | Cadastro, Login e Gerenciamento de Conta | ✅ Concluída |
| **03** | Upload e Processamento de Vídeos | ✅ Concluída (backend) |
| **04** | Gerenciamento de Vídeos e Canal | ⏳ Planejada |
| **05** | Página de Visualização do Vídeo | ⏳ Planejada |
| **06** | Interações Sociais (Likes, Comentários, Inscrições) | ⏳ Planejada |
| **07** | Página Inicial, Busca e Finalização | ⏳ Planejada |

Detalhes completos em `docs/project-plan.md`.

## 📖 Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, React Hook Form + Zod, iron-session, openapi-fetch |
| Backend | NestJS 11, TypeScript, TypeORM, JWT, Argon2, Mailer (Handlebars), AWS SDK v3 (S3), BullMQ, fluent-ffmpeg |
| Banco de Dados | PostgreSQL 17 |
| E-mail (dev) | Mailpit |
| Storage | MinIO (compatível com S3) |
| Fila | BullMQ + Redis |
| Processamento de vídeo | FFmpeg / ffprobe |
| Containerização | Docker, Docker Compose |
| Testes | Jest, Supertest (backend); Vitest, MSW, Playwright (frontend) |
| Qualidade | ESLint, Prettier |
</content>
