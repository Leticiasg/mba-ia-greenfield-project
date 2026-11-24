---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-24T09:01:29-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-24T09:01:29-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-24T09:00:29-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-22T23:52:32-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver video upload of up to 10GB straight to S3-compatible object storage (pre-registering the video as a draft when the upload starts), automatic background processing by a dedicated worker that extracts duration and metadata and generates a thumbnail from a video frame, a unique short URL per video, and streaming and download of the processed video — with object storage, queue and worker running in Docker Compose.

---

## Step Implementations

### SI-03.1 — Infra: Dependências e namespaces de configuração

**Description:** Instala as bibliotecas fixadas no `library-refs.md` e cria os namespaces `storage`, `queue` e `video` com validação Joi, base de configuração para storage, fila e worker.

**Technical actions:**

1. Instalar em `nestjs-project`: `bullmq@^6.7.10`, `@nestjs/bullmq@^12.0.2`, `@aws-sdk/client-s3@^3.1176.0`, `@aws-sdk/s3-request-presigner@^3.1176.0`, `fluent-ffmpeg@2.1.3` (versão exata — pacote descontinuado) e, como devDependency, `@types/fluent-ffmpeg@^2.1.28` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-06`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `S3_ENDPOINT` (default `http://minio:9000`), `S3_PUBLIC_ENDPOINT` (default `http://localhost:9000`), `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY` e `S3_SECRET_KEY` (obrigatórias, sem default), `S3_BUCKET` (default `streamtube`); quando `NODE_ENV=test`, `publicEndpoint` passa a ser igual a `endpoint` (per `phase-03-videos/TD-10` revisão 2026-11-24 — "Test environment")
3. Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com `REDIS_HOST` (default `redis`) e `REDIS_PORT` (default `6379`) (per `phase-03-videos/TD-01`); e `src/config/video.config.ts` — `registerAs('video', ...)` com `VIDEO_MAX_SIZE_BYTES` (default `10737418240`), `VIDEO_UPLOAD_PART_SIZE_BYTES` (default `104857600`, mínimo `5242880`), `VIDEO_UPLOAD_URL_TTL_SECONDS` (default `900`) e `VIDEO_PLAYBACK_URL_TTL_SECONDS` (default `900`) (per `phase-03-videos/TD-03`, `phase-03-videos/TD-14`)
4. Atualizar `src/config/env.validation.ts` com as novas variáveis (convenção namespaced + Joi herdada de `phase-01-configuracao-base/TD-02` e `TD-03`) e `.env.example` com as chaves e valores compatíveis com o Compose (hosts = nomes de serviço)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: `S3_ACCESS_KEY`/`S3_SECRET_KEY` obrigatórias; defaults de `video`/`queue`; `VIDEO_UPLOAD_PART_SIZE_BYTES` < 5 MiB rejeitado | `src/config/env.validation.integration-spec.ts` |
| `storageConfig` | Unit: `publicEndpoint` igual a `endpoint` quando `NODE_ENV=test`; distinto nos demais ambientes | `src/config/storage.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A aplicação sobe sem erros com as novas variáveis definidas — o e2e existente `GET /` continua retornando `200`
- Subir a aplicação sem `S3_ACCESS_KEY` gera erro de validação Joi no bootstrap e a aplicação não inicia
- `npx tsc --noEmit` passa com as novas dependências instaladas

---

### SI-03.2 — Infra: MinIO e Redis no Docker Compose

**Description:** Adiciona o object storage (MinIO) e o broker da fila (Redis) ao `compose.yaml`, com imagens fixadas por digest e healthchecks, para que a API e o worker os alcancem pelo nome do serviço.

**Technical actions:**

1. Adicionar o serviço `minio` em `nestjs-project/compose.yaml` — imagem `cgr.dev/chainguard/minio@sha256:f2e56aceb4d38ad9b05c901270946e2353b19f86ba4396f25cf75b15b455b38c` (per `phase-03-videos/TD-11`), credenciais vindas de `S3_ACCESS_KEY`/`S3_SECRET_KEY`, portas `9000` (S3) e `9001` (console), volume nomeado para os dados e healthcheck; confirmar entrypoint, comando e usuário da imagem no primeiro pull, antes de fixar o `command` (pendência registrada na TD-11)
2. Adicionar o serviço `redis` — imagem `redis:8.2-alpine@sha256:da23c2478319ceb4903857d77a2fd7aa5137d9e9d4c8165dafbacedac6403e95` com `redis-server --maxmemory-policy noeviction`, porta `6379` e healthcheck `redis-cli ping` (per `phase-03-videos/TD-01` revisão 2026-11-24)
3. Fazer `nestjs-api` depender de `minio` e `redis` com `condition: service_healthy`, mantendo os nomes de serviço como hosts (regra de rede Docker do `CLAUDE.md`)

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1 — as credenciais e chaves de `.env.example` precisam existir antes dos serviços

**Acceptance criteria:**

- `docker compose ps` mostra `minio` e `redis` como `healthy`
- `docker compose exec redis redis-cli CONFIG GET maxmemory-policy` retorna `noeviction`
- De dentro do container `nestjs-api`, `curl http://minio:9000/minio/health/live` retorna `200`

---

### SI-03.3 — StorageModule: clientes S3 interno/público e operações de objeto

**Description:** Encapsula todo acesso ao object storage num módulo próprio, com um cliente para chamadas internas e outro só para assinar URLs entregues a clientes HTTP, base para upload, worker e entrega.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` com dois providers `S3Client` (`forcePathStyle: true`): `S3_INTERNAL_CLIENT` (endpoint `storage.endpoint`) e `S3_PUBLIC_CLIENT` (endpoint `storage.publicEndpoint`), lidos do namespace `storage` via `ConfigType` (per `phase-03-videos/TD-10`; convenção herdada `phase-01-configuracao-base/TD-03`)
2. Criar `src/storage/storage.service.ts` — `onModuleInit` garante o bucket `S3_BUCKET` de forma idempotente (`HeadBucket` → `CreateBucket` só se ausente) (per `phase-03-videos/TD-09`); operações com o cliente interno: `createMultipartUpload`, `listParts`, `completeMultipartUpload`, `headObject`, `deleteObject`, `putObject`
3. Implementar a assinatura por consumidor: `presignUploadPart(key, uploadId, partNumber)` e `presignGetObject(key, { consumer: 'public', disposition? })` usam o cliente público; `presignGetObject(key, { consumer: 'internal' })` usa o cliente interno (per `phase-03-videos/TD-10` revisão 2026-11-24 — "Signing client per consumer"); TTLs vêm do namespace `video`
4. Traduzir as falhas do `CompleteMultipartUpload` (`InvalidPart`, `InvalidPartOrder`, `NoSuchUpload`) em um erro tipado do módulo, consumido pelo módulo de vídeos para emitir `UPLOAD_INCOMPLETE`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real): multipart completo — create, `PUT` em URL pré-assinada, list, complete, head; complete com ETag errado lança o erro tipado | `src/storage/storage.service.integration-spec.ts` |
| `StorageService` | Integration (MinIO real): URL de `GetObject` pública com `Range: bytes=0-9` responde `206` com 10 bytes; `disposition` gera `Content-Disposition: attachment` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação do módulo com `ConfigModule` e os dois clientes | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 (namespaces `storage`/`video`), SI-03.2 (MinIO no Compose)

**Acceptance criteria:**

- Ao iniciar a aplicação com o bucket inexistente, o bucket `S3_BUCKET` é criado; reiniciar não gera erro
- Um objeto enviado em partes pelas URLs pré-assinadas fica disponível no bucket após `completeMultipartUpload`, com `ContentLength` igual à soma das partes
- Uma requisição com `Range` à URL pública de leitura retorna `206 Partial Content` e o cabeçalho `Content-Range`
- Em `NODE_ENV=test`, URLs públicas e internas usam o mesmo host (`minio:9000`)

---

### SI-03.4 — Entidade Video, migration e identificador público

**Description:** Cria a tabela `videos` ligada ao canal, com status do ciclo de upload/processamento e o identificador curto da URL única.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com as colunas, enum `videos_status_enum` (`draft`, `processing`, `ready`, `error`) e relação many-to-one com `Channel` exatamente como no Data Model (per `phase-03-videos/TD-12`, `phase-03-videos/TD-13`, `phase-03-videos/TD-06` revisão 2026-11-24); adicionar o lado one-to-many `videos` em `src/channels/entities/channel.entity.ts`
2. Gerar `src/database/migrations/<timestamp>-CreateVideos.ts` — cria o enum, a tabela, FK `channel_id → channels.id`, índice único em `public_id` e índice em `channel_id`; `down` remove tabela e enum (rules `typeorm-migrations`)
3. Criar `src/videos/public-id.util.ts` — `generatePublicId()` retorna 11 caracteres base64url a partir de `randomBytes(8)` de `node:crypto` (per `phase-03-videos/TD-13`)
4. Registrar `Video` no `data-source.ts` e no helper de testes `src/test/create-test-data-source.ts`, e incluir `videos` na limpeza de `cleanAllTables`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: `public_id` único; `status` default `draft`; FK inválida para `channel_id` rejeitada; `metadata` JSONB aceita `null` | `src/videos/entities/video.entity.integration-spec.ts` |
| `CreateVideos` migration | Integration: `migration:run` cria `videos` e o enum; `revert` remove ambos | `src/database/migrations.integration-spec.ts` |
| `generatePublicId` | Unit: sempre 11 caracteres de `[A-Za-z0-9_-]`; chamadas sucessivas diferem | `src/videos/public-id.util.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Após `npm run migration:run`, a tabela `videos` existe com as colunas e índices do Data Model
- Inserir dois vídeos com o mesmo `public_id` falha por violação de unicidade
- Inserir um vídeo sem `status` grava `draft`
- `npm run migration:revert` remove a tabela `videos` e o tipo `videos_status_enum`

---

### SI-03.5 — Endpoint POST /videos (iniciar upload e pré-cadastrar rascunho)

**Route:** POST /videos
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated (cria o vídeo no canal do próprio usuário)

**Description:** Inicia o upload criando o vídeo em `draft` e o multipart upload no storage, e devolve o plano de partes — a API nunca recebe os bytes do arquivo.

**Technical actions:**

1. Adicionar `findByUserId(userId)` em `ChannelsService` — a busca do canal do dono pertence ao módulo de canais (responsabilidade única)
2. Criar `src/videos/dto/create-video.dto.ts` (`filename`, `fileSize`, `contentType`, `title` conforme API Contracts e Validation Rules) e as exceções de domínio do módulo em `src/videos/videos.exceptions.ts` (`VIDEO_NOT_FOUND`, `FILE_TOO_LARGE`, `INVALID_VIDEO_STATUS`, `INVALID_PART_NUMBER`, `UPLOAD_INCOMPLETE`, `UPLOAD_SIZE_MISMATCH`, `VIDEO_NOT_READY`), estendendo `DomainException` (envelope herdado de `phase-02-auth/TD-07`)
3. Criar `VideosService.initUpload` — valida `fileSize` ≤ `VIDEO_MAX_SIZE_BYTES` (`FILE_TOO_LARGE`), resolve `title` (padrão: `filename` sem extensão), calcula `part_size_bytes`/`part_count`, cria o multipart em `videos/{id}/original` e grava o vídeo `draft` com `upload_id`; gera `public_id` e regera em violação de unicidade (até 3 tentativas) (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03` revisão 2026-11-24, `phase-03-videos/TD-13`)
4. Criar `VideosController` com `POST /videos` (`@CurrentUser`, resposta `201` conforme API Contracts, decoradores `@ApiOperation`/`@ApiResponse` com o envelope de erro — per `openapi-docs-nestjs/TD-01` revisão 2026-05-12) e `VideosModule` importando `TypeOrmModule.forFeature([Video])`, `ChannelsModule` e `StorageModule`, registrado no `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.initUpload` | Unit: título padrão sem extensão; `FILE_TOO_LARGE`; cálculo de `partCount`; nova tentativa de `public_id` em colisão (repo e storage mockados) | `src/videos/videos.service.spec.ts` |
| `VideosService.initUpload` | Integration (Postgres + MinIO reais): vídeo `draft` persistido no canal do usuário com `upload_id` de um multipart existente | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário; `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |
| `VideosModule` | Unit: compilação do módulo | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.3 (StorageService), SI-03.4 (entidade Video)

**Acceptance criteria:**

- `POST /videos` com `filename`, `fileSize` e `contentType` válidos retorna `201` com `publicId` de 11 caracteres, `status: "draft"`, `partSize` e `partCount`
- Sem `title`, o vídeo criado recebe como título o `filename` sem extensão
- `POST /videos` com `fileSize` acima de `VIDEO_MAX_SIZE_BYTES` retorna `400` com `error: "FILE_TOO_LARGE"` e nenhum vídeo é gravado
- `POST /videos` com `contentType: "application/pdf"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` sem token retorna `401`
- O vídeo criado pertence ao canal do usuário autenticado e tem um multipart upload aberto em `videos/{id}/original`

---

### SI-03.6 — Endpoints de partes: URLs sob demanda e listagem para retomada

**Route:** POST /videos/:publicId/upload/parts, GET /videos/:publicId/upload/parts
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner

**Description:** Entrega URLs pré-assinadas de curta duração para as partes pedidas e lista as partes já armazenadas, permitindo retomar um upload interrompido.

**Technical actions:**

1. Criar `src/videos/dto/request-part-urls.dto.ts` (`partNumbers`: 1–100 inteiros únicos ≥ 1)
2. Criar `VideosService.findOwnedByPublicId(publicId, userId)` — `publicId` malformado, inexistente ou de outro canal → `VIDEO_NOT_FOUND` (per `phase-03-videos/TD-15`); reutilizado por todos os endpoints com `:publicId`
3. Criar `VideosService.issuePartUrls` — exige `status = 'draft'` (`INVALID_VIDEO_STATUS`), rejeita números > `part_count` (`INVALID_PART_NUMBER`) e devolve `{ parts: [{ partNumber, url }], expiresAt }` com `StorageService.presignUploadPart` (cliente público, TTL `VIDEO_UPLOAD_URL_TTL_SECONDS`) (per `phase-03-videos/TD-03`, `phase-03-videos/TD-10` revisão 2026-11-24)
4. Criar `VideosService.listUploadedParts` — exige `draft` e devolve `{ parts: [{ partNumber, eTag, size }] }` ordenado por `partNumber` via `StorageService.listParts` (per `phase-03-videos/TD-02`)
5. Adicionar ao `VideosController` `POST /videos/:publicId/upload/parts` (`200`) e `GET /videos/:publicId/upload/parts` (`200`), com decoradores OpenAPI conforme API Contracts

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.issuePartUrls` / `listUploadedParts` | Unit: `INVALID_VIDEO_STATUS` fora de `draft`; `INVALID_PART_NUMBER` acima de `partCount`; `VIDEO_NOT_FOUND` para vídeo de outro canal | `src/videos/videos.service.spec.ts` |
| `VideosService.issuePartUrls` / `listUploadedParts` | Integration (Postgres + MinIO reais): `PUT` na URL devolvida grava a parte; a listagem passa a mostrá-la com `eTag` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — exige o vídeo `draft` com `upload_id`

**Acceptance criteria:**

- `POST /videos/:publicId/upload/parts` com `partNumbers: [1, 2]` de um vídeo `draft` do usuário retorna `200` com duas URLs e `expiresAt`
- Um `PUT` com os bytes da parte na URL devolvida é aceito pelo storage e retorna um cabeçalho `ETag`
- `GET /videos/:publicId/upload/parts` após enviar a parte 1 retorna `200` com `parts` contendo `partNumber: 1` e o mesmo `eTag`
- `POST /videos/:publicId/upload/parts` com um número maior que `partCount` retorna `400` com `error: "INVALID_PART_NUMBER"`
- `POST /videos/:publicId/upload/parts` para um vídeo de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.7 — Endpoint de conclusão do upload e publicação na fila

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner

**Description:** Conclui o multipart, confere o tamanho real do objeto, move o vídeo para `processing` e publica o job de processamento na mesma requisição.

**Technical actions:**

1. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` com `connection: { host, port }` do namespace `queue` (chave `connection:`, não `redis:` — ver `library-refs.md`) e `BullModule.registerQueue({ name: 'video-processing', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false } })` conforme Events/Messages (per `phase-03-videos/TD-01`)
2. Criar `src/videos/dto/complete-upload.dto.ts` (`parts`: array não vazio de `{ partNumber, eTag }`)
3. Criar `VideosService.completeUpload` — exige `draft`; ordena `parts` por `partNumber` e chama `completeMultipartUpload` (erro tipado → `UPLOAD_INCOMPLETE`); `headObject` compara `ContentLength` com `size_bytes` e o teto — divergência apaga o objeto, transiciona `draft → error` com `error_reason = 'UPLOAD_SIZE_MISMATCH'` e lança `UPLOAD_SIZE_MISMATCH` (per `phase-03-videos/TD-03`)
4. No caminho feliz, transição condicional `draft → processing` (limpa `upload_id`) e `queue.add('video.process', { videoId }, { jobId: videoId })` via `@InjectQueue('video-processing')` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-12`)
5. Adicionar ao `VideosController` `POST /videos/:publicId/upload/complete` com `202` e decoradores OpenAPI conforme API Contracts

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: `INVALID_VIDEO_STATUS` fora de `draft`; `UPLOAD_INCOMPLETE` no erro tipado do storage; `UPLOAD_SIZE_MISMATCH` apaga o objeto e marca `error` | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (Postgres + MinIO + Redis reais): após upload real das partes, status vira `processing` e o job `video.process` existe na fila com `jobId` igual ao id do vídeo | `src/videos/videos.service.integration-spec.ts` |
| `QueueModule` | Unit: compilação do módulo com a fila `video-processing` registrada | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.6 — o cliente precisa das URLs de partes para chegar à conclusão

**Acceptance criteria:**

- `POST /videos/:publicId/upload/complete` com todas as partes e `eTag`s corretos retorna `202` com `status: "processing"`, e o vídeo fica `processing` no banco
- A conclusão bem-sucedida adiciona um job `video.process` com payload `{ "videoId": "<id>" }` e `jobId` igual ao id do vídeo na fila `video-processing`
- Repetir a conclusão do mesmo vídeo retorna `409` com `error: "INVALID_VIDEO_STATUS"` e não cria um segundo job
- Concluir com um `eTag` errado retorna `400` com `error: "UPLOAD_INCOMPLETE"` e o vídeo continua `draft`
- Concluir um upload cujo tamanho real difere de `fileSize` retorna `400` com `error: "UPLOAD_SIZE_MISMATCH"`, o objeto é removido do bucket e o vídeo fica `error`

---

### SI-03.8 — Infra: container video-worker com FFmpeg

**Description:** Cria o processo separado do worker (mesmo código, outro entrypoint, sem servidor HTTP) e o serviço `video-worker` no Compose, com FFmpeg instalado e recarga automática.

**Technical actions:**

1. Criar `nestjs-project/Dockerfile.worker` a partir da mesma base `node:25.6.0-slim` do `Dockerfile.dev`, instalando `ffmpeg` (inclui `ffprobe`) via `apt` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`)
2. Criar `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` com `enableShutdownHooks()` — e `src/worker.module.ts` importando `ConfigModule` (mesmo schema Joi), `TypeOrmModule.forRootAsync` (fábrica `databaseConfig` herdada de `phase-01-configuracao-base/TD-04`), `StorageModule` e `QueueModule`, sem módulos HTTP (per `phase-03-videos/TD-05`)
3. Adicionar o serviço `video-worker` em `compose.yaml` — build com `Dockerfile.worker`, mesmo volume do código, `command: node --watch -r ts-node/register -r tsconfig-paths/register src/worker.ts` (sem compilar, nada gravado em `dist/`), `depends_on` `db`, `redis` e `minio` saudáveis (per `phase-03-videos/TD-16` revisão 2026-11-24)
4. Adicionar o script `start:worker:dev` em `package.json` com o mesmo comando, para uso manual fora do Compose

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Unit: compilação do módulo sem módulos HTTP | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.2 (Redis e MinIO no Compose), SI-03.7 (`QueueModule`)

**Acceptance criteria:**

- `docker compose up -d` sobe `video-worker` junto com a stack, e `docker compose ps` o mostra em execução
- `docker compose exec video-worker ffprobe -version` imprime a versão do FFmpeg
- Alterar um arquivo em `src/` faz o processo do worker reiniciar sozinho (visível em `docker compose logs video-worker`)
- O container `nestjs-api` continua sem FFmpeg e a API sobe normalmente

---

### SI-03.9 — VideoProcessor: metadados, thumbnail e status

**Description:** Consome o job `video.process` no worker, extrai duração e metadados com ffprobe, gera a thumbnail a partir de um frame e leva o vídeo a `ready` ou `error` de forma idempotente.

**Technical actions:**

1. Criar `src/videos/processing/media-probe.service.ts` — envolve `fluent-ffmpeg` em Promises: `probe(url)` devolve `durationSeconds`, as 8 chaves de `metadata` e se há stream de vídeo; `extractFrame(url, seconds, outPath)` grava um JPEG (nome terminado em `.jpg` — `screenshots()` usa PNG por padrão, ver `library-refs.md`) (per `phase-03-videos/TD-06` e revisão 2026-11-24, `phase-03-videos/TD-08`)
2. Criar `src/videos/processing/video.processor.ts` — `@Processor('video-processing')` estendendo `WorkerHost`, executando os passos 1–6 de Events/Messages: ignora vídeo fora de `processing`; URL de leitura assinada com o cliente **interno** (per `phase-03-videos/TD-07`, `phase-03-videos/TD-10` revisão 2026-11-24); sem stream de vídeo → `UnrecoverableError('INVALID_MEDIA')`; frame em 10% da duração limitado a `[0, duração − ε]`; `PutObject` em `thumbnails/{id}.jpg`; transição condicional `processing → ready` com `duration_seconds`, `metadata` e `thumbnail_key`
3. Tratar `@OnWorkerEvent('failed')` — quando o erro é `UnrecoverableError` ou `attemptsMade >= attempts`, transição condicional `processing → error` com `error_reason` `INVALID_MEDIA` ou `PROCESSING_FAILED` (per `phase-03-videos/TD-12`)
4. Registrar `MediaProbeService` e `VideoProcessor` num `VideoProcessingModule` (com `TypeOrmModule.forFeature([Video])` e `StorageModule`) importado apenas pelo `WorkerModule` — a API não carrega o consumidor (per `phase-03-videos/TD-05`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Unit: vídeo fora de `processing` não é alterado; sem stream de vídeo lança `UnrecoverableError`; caminho feliz grava `ready`, `metadata`, `thumbnail_key` e chama `putObject` em `thumbnails/{id}.jpg`; seek em 10% limitado à duração (repo, storage e probe mockados) | `src/videos/processing/video.processor.spec.ts` |
| `VideoProcessor` failed handler | Unit: `error_reason` `INVALID_MEDIA` para `UnrecoverableError`; `PROCESSING_FAILED` só quando as tentativas acabam; sem efeito antes da última tentativa | `src/videos/processing/video.processor.spec.ts` |
| `MediaProbeService` | Unit: mapeia a saída do ffprobe para `durationSeconds` e as 8 chaves (`null` quando não há áudio) e detecta ausência de stream de vídeo (`fluent-ffmpeg` mockado) | `src/videos/processing/media-probe.service.spec.ts` |
| `VideoProcessingModule` | Unit: compilação do módulo | `src/videos/processing/video-processing.module.spec.ts` |

A execução real de ffprobe/ffmpeg é coberta pelo e2e do SI-03.11 através do container `video-worker`: os testes rodam no container `nestjs-api`, que não tem FFmpeg (per `phase-03-videos/TD-16`).

**Dependencies:** SI-03.7 (job publicado), SI-03.8 (worker com FFmpeg)

**Acceptance criteria:**

- Um vídeo válido concluído chega a `ready` no banco com `duration_seconds` preenchido e `metadata` com as 8 chaves
- Após o processamento existe o objeto `thumbnails/{id}.jpg` no bucket, em formato JPEG
- Um arquivo que não é vídeo chega a `error` com `error_reason = 'INVALID_MEDIA'` sem novas tentativas
- Entregar de novo o job de um vídeo já `ready` não altera o registro nem a thumbnail
- Uma falha transitória que persiste nas 3 tentativas deixa o vídeo `error` com `error_reason = 'PROCESSING_FAILED'`

---

### SI-03.10 — Endpoints de status, streaming, download e thumbnail

**Route:** GET /videos/:publicId, GET /videos/:publicId/stream, GET /videos/:publicId/download, GET /videos/:publicId/thumbnail
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner

**Description:** Expõe o status do vídeo e redireciona streaming, download e thumbnail para URLs pré-assinadas de curta duração, deixando o `Range`/`206` a cargo do storage.

**Technical actions:**

1. Criar `VideosService.getOwnedVideo` — devolve `publicId`, `title`, `status`, `errorReason`, `durationSeconds`, `metadata`, `createdAt` conforme API Contracts
2. Criar `VideosService.getPlaybackUrl(publicId, userId, kind)` com `kind` `'stream' | 'download' | 'thumbnail'` — exige `status = 'ready'` (`VIDEO_NOT_READY`); assina com o cliente **público** e TTL `VIDEO_PLAYBACK_URL_TTL_SECONDS`; `download` usa `ResponseContentDisposition: attachment; filename="{original_filename}"`; `thumbnail` assina `thumbnail_key` (per `phase-03-videos/TD-14`, `phase-03-videos/TD-10` revisão 2026-11-24)
3. Adicionar ao `VideosController` `GET /videos/:publicId` (`200`) e `GET /videos/:publicId/stream|download|thumbnail` respondendo `302` com `Location` via `@Redirect()` + retorno `{ url }`, com decoradores OpenAPI conforme API Contracts

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getPlaybackUrl` | Unit: `VIDEO_NOT_READY` para `draft`/`processing`/`error`; `download` inclui o `Content-Disposition` com o nome original; `thumbnail` usa `thumbnail_key` (storage mockado) | `src/videos/videos.service.spec.ts` |
| `VideosService.getPlaybackUrl` | Integration (Postgres + MinIO reais): com um vídeo `ready` semeado, a URL de stream responde `206` a `Range: bytes=0-99` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6 (`findOwnedByPublicId` e controller do módulo), SI-03.3 (assinatura por consumidor)

**Acceptance criteria:**

- `GET /videos/:publicId` do dono retorna `200` com `status` e, para vídeo `ready`, `durationSeconds` e `metadata` preenchidos
- `GET /videos/:publicId/stream` de um vídeo `ready` retorna `302`, e seguir o `Location` com `Range: bytes=0-99` retorna `206` com `Content-Range` e 100 bytes
- `GET /videos/:publicId/download` de um vídeo `ready` retorna `302` para uma URL que responde com `Content-Disposition: attachment` e o nome original do arquivo
- `GET /videos/:publicId/stream` de um vídeo em `processing` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/:publicId` de um vídeo de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`; sem token retorna `401`

---

### SI-03.11 — Fluxo completo upload → processamento → streaming

**Route:** POST /videos → POST /videos/:publicId/upload/parts → POST /videos/:publicId/upload/complete → GET /videos/:publicId → GET /videos/:publicId/stream
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner

**Description:** Prova o fluxo ponta a ponta com a infraestrutura real do Compose (API, MinIO, Redis e o container `video-worker`) e atualiza o contrato OpenAPI exportado.

**Technical actions:**

1. Gerar fixtures pequenas em `nestjs-project/test/fixtures/`: `sample.mp4` (2 s, gerado uma vez com `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=25 -pix_fmt yuv420p` dentro do `video-worker`) e `not-a-video.mp4` (bytes de texto), ambas commitadas (conferir que o `.gitignore` não as esconde)
2. Criar em `test/helpers/` um utilitário de e2e que faz o upload em partes pelas URLs devolvidas e um utilitário de espera que consulta `GET /videos/:publicId` até o status sair de `processing` ou estourar um tempo limite (per `phase-03-videos/TD-16` — e2e usa o worker real, com espera limitada)
3. Regenerar `openapi.json` com `npm run openapi:export` para incluir os endpoints de vídeo (per `openapi-docs-nestjs/TD-02`)

**Tests:** _(empty — cenários e2e autorados por /plan-test-specs no spec referenciado em **Test Specs**)_

**Dependencies:** SI-03.9 (worker processando), SI-03.10 (endpoints de leitura)

**Acceptance criteria:**

- Com a stack do Compose no ar, o upload de `sample.mp4` termina com o vídeo `ready`, thumbnail disponível em `GET /videos/:publicId/thumbnail` e `206` no streaming com `Range`
- O upload de `not-a-video.mp4` termina com o vídeo `error` e `errorReason: "INVALID_MEDIA"`
- A API não recebe os bytes do vídeo em nenhum momento do fluxo — só as URLs pré-assinadas tocam o storage
- `openapi.json` contém os 8 endpoints de vídeo com as respostas de erro documentadas

---

### SI-03.12 — Documentação de IA: CLAUDE.md com a seção de vídeos

**Description:** Atualiza os dois `CLAUDE.md` (raiz e `nestjs-project/`) para refletir o estado real do código após a fase: módulo de vídeos, endpoints, fila/worker e storage.

**Technical actions:**

1. Atualizar o `CLAUDE.md` da raiz — trocar "Message Queue (TBD)" por BullMQ + Redis e descrever o container `video-worker` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`)
2. Atualizar `nestjs-project/CLAUDE.md` — serviços `minio`, `redis` e `video-worker` com seus checks de prontidão, variáveis novas (sem valores), como iniciar e acompanhar o worker, e a regra de assinatura interna/pública das URLs (per `phase-03-videos/TD-10` revisões 2026-11-24)
3. Conferir item a item que todo arquivo, comando, serviço e endpoint citado existe no código

**Tests:** _(empty — documentação; conferência manual contra o código na action 3)_

**Dependencies:** SI-03.11 — a documentação descreve o estado final

**Acceptance criteria:**

- Nenhum dos dois `CLAUDE.md` menciona a fila como "TBD"
- Todo comando listado na seção de vídeos roda com sucesso no ambiente Docker
- Todo arquivo e endpoint citado na seção de vídeos existe no repositório

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Internal id; used in object keys (per `phase-03-videos/TD-09`), never exposed in routes |
| public_id | varchar(11) | unique, not null | Random base64url short id from 8 bytes of `node:crypto`; the video's unique URL identifier (per `phase-03-videos/TD-13`) |
| channel_id | uuid | FK → channels.id, not null | Owner channel (channel ↔ user is 1:1) |
| title | varchar(255) | not null | Optional at init; defaults to the original filename without extension (per `phase-03-videos/TD-03` revision 2026-11-24) |
| original_filename | varchar(255) | not null | User filename kept only as metadata; never used in object keys (per `phase-03-videos/TD-09`) |
| content_type | varchar(100) | not null | Declared at init; must start with `video/` (per `phase-03-videos/TD-03` revision 2026-11-24) |
| size_bytes | bigint | not null | Declared `fileSize`; re-checked against the stored object at complete (per `phase-03-videos/TD-03`) |
| status | enum `videos_status_enum` | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'error'` | Upload/processing lifecycle only — Phase 04 publication stays in a separate column (per `phase-03-videos/TD-12`) |
| error_reason | text | nullable | Set when `status = 'error'` (per `phase-03-videos/TD-12`) |
| video_key | varchar(1024) | not null | `videos/{id}/original` (per `phase-03-videos/TD-09`) |
| thumbnail_key | varchar(1024) | nullable | `thumbnails/{id}.jpg`, set when processing succeeds (per `phase-03-videos/TD-09`) |
| upload_id | varchar(1024) | nullable | S3 multipart `UploadId` while `status = 'draft'`; cleared after completion (per `phase-03-videos/TD-02`) |
| part_size_bytes | integer | not null | Server-defined part size used for this upload (per `phase-03-videos/TD-03`) |
| part_count | integer | not null | `ceil(size_bytes / part_size_bytes)`; ≤ 10,000 (per `phase-03-videos/TD-03`) |
| duration_seconds | numeric(12,3) | nullable | Set by the worker (per `phase-03-videos/TD-06` revision 2026-11-24) |
| metadata | jsonb | nullable | Fixed keys `width`, `height`, `videoCodec`, `audioCodec`, `formatName`, `bitRate`, `frameRate`, `sizeBytes` — any may be `null` (per `phase-03-videos/TD-06` revision 2026-11-24) |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one via `channel_id`); Channel → Video (one-to-many)
**Indexes:** `(public_id)` — unique, `(channel_id)` — FK lookup
**Status transitions** (conditional updates — `UPDATE … WHERE id = ? AND status = <expected>`, so duplicate deliveries are no-ops; per `phase-03-videos/TD-12`):

| From | To | Actor | Trigger |
|------|----|-------|---------|
| — | `draft` | API | `POST /videos` (upload init) |
| `draft` | `processing` | API | `POST /videos/:publicId/upload/complete` succeeds |
| `draft` | `error` | API | Completed object size does not match the declared size (`UPLOAD_SIZE_MISMATCH`) |
| `processing` | `ready` | Worker | ffprobe + thumbnail succeeded |
| `processing` | `error` | Worker | Invalid media (immediately) or retries exhausted |

**Storage objects** (one private bucket `S3_BUCKET`, per `phase-03-videos/TD-09`):

| Key | Written by | Content |
|-----|-----------|---------|
| `videos/{id}/original` | Client, via presigned multipart parts | Uploaded video |
| `thumbnails/{id}.jpg` | Worker (`PutObject`, overwritten on re-run) | Thumbnail JPEG |

---

### API Contracts

All endpoints below require `Authorization: Bearer <access_token>` (global JWT guard, inherited `phase-02-auth/TD-02`) and are restricted to the owner of the video's channel; a video owned by another channel is reported as `404 VIDEO_NOT_FOUND` so its existence is not revealed (per `phase-03-videos/TD-15`). Field names `fileSize`, `contentType` and `title` are verbatim from `phase-03-videos/TD-03` (revision 2026-11-24); the remaining request/response fields of this module follow the same camelCase. Every endpoint carries explicit `@ApiOperation` / `@ApiResponse` decorators including the error envelope (per inherited `openapi-docs-nestjs/TD-01` revision 2026-05-12).

#### POST /videos (SI-03.5)

Starts the upload: pre-registers the video as `draft`, creates the S3 multipart upload and returns the upload plan (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- filename: string, required — original filename, 1–255 characters
- fileSize: integer, required — ≥ 1; must not exceed `VIDEO_MAX_SIZE_BYTES` (10GB cap)
- contentType: string, required — must start with `video/`
- title: string, optional — 1–255 characters; defaults to `filename` without its extension

**Response 201:**
- publicId: string — 11-character unique id; the video URL is `/videos/{publicId}`
- title: string
- status: string — `"draft"`
- partSize: integer — bytes per part (last part may be smaller)
- partCount: integer — total parts the client must upload (1-based part numbers)

**Error responses:**
- 400 FILE_TOO_LARGE: when `fileSize` exceeds `VIDEO_MAX_SIZE_BYTES`
- 400 VALIDATION_ERROR: when the body fails validation (missing fields, `fileSize` < 1, `contentType` not starting with `video/`)
- 401: when the access token is missing or invalid

---

#### POST /videos/:publicId/upload/parts (SI-03.6)

Issues short-lived presigned `UploadPart` URLs on demand, signed with the public storage client (per `phase-03-videos/TD-03`, `phase-03-videos/TD-10` revision 2026-11-24 — "Signing client per consumer").

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- partNumbers: integer[], required — 1–100 distinct values, each between 1 and the video's `partCount`

**Response 200:**
- parts: array of `{ partNumber: integer, url: string }` — the client `PUT`s the raw bytes of that part to `url` and keeps the `ETag` response header
- expiresAt: string (ISO-8601) — URLs expire after `VIDEO_UPLOAD_URL_TTL_SECONDS`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 409 INVALID_VIDEO_STATUS: when the video is not in `draft`
- 400 INVALID_PART_NUMBER: when a part number is greater than the video's `partCount`
- 400 VALIDATION_ERROR: when `partNumbers` is missing, empty, has more than 100 items, duplicates or values < 1
- 401: when the access token is missing or invalid

---

#### GET /videos/:publicId/upload/parts (SI-03.6)

Lists the parts already stored for the in-progress upload (S3 `ListParts`), so a client can resume after a dropped connection (per `phase-03-videos/TD-02`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- parts: array of `{ partNumber: integer, eTag: string, size: integer }` — ordered by `partNumber`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 409 INVALID_VIDEO_STATUS: when the video is not in `draft`
- 401: when the access token is missing or invalid

---

#### POST /videos/:publicId/upload/complete (SI-03.7)

Completes the multipart upload, re-checks the stored size with `HeadObject`, moves the video to `processing` and enqueues the processing job in the same request (per `phase-03-videos/TD-03`, `phase-03-videos/TD-04`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array, required — one entry per uploaded part, `{ partNumber: integer (1–10000), eTag: string (non-empty) }`; sorted by `partNumber` before calling `CompleteMultipartUpload`

**Response 202:**
- publicId: string
- status: string — `"processing"`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 409 INVALID_VIDEO_STATUS: when the video is not in `draft`
- 400 UPLOAD_INCOMPLETE: when storage rejects the part list (missing part, wrong `eTag`, invalid order)
- 400 UPLOAD_SIZE_MISMATCH: when the stored object size differs from `fileSize` or exceeds `VIDEO_MAX_SIZE_BYTES` — the object is deleted and the video moves to `error`
- 400 VALIDATION_ERROR: when `parts` is missing, empty or malformed
- 401: when the access token is missing or invalid

---

#### GET /videos/:publicId (SI-03.10)

Returns the video and its processing status.

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- publicId: string
- title: string
- status: string — `"draft"` | `"processing"` | `"ready"` | `"error"`
- errorReason: string | null
- durationSeconds: number | null
- metadata: object | null — `{ width, height, videoCodec, audioCodec, formatName, bitRate, frameRate, sizeBytes }` (values may be `null`)
- createdAt: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 401: when the access token is missing or invalid

---

#### GET /videos/:publicId/stream (SI-03.10)

Redirects to a short-lived presigned `GetObject` URL for the original video; storage answers `Range` requests with `206 Partial Content` (per `phase-03-videos/TD-14`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: presigned URL signed with the public storage client, valid for `VIDEO_PLAYBACK_URL_TTL_SECONDS`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 409 VIDEO_NOT_READY: when the video status is not `ready`
- 401: when the access token is missing or invalid

---

#### GET /videos/:publicId/download (SI-03.10)

Same as `/stream`, but the presigned URL carries `ResponseContentDisposition: attachment; filename="{original_filename}"` so the browser saves the file (per `phase-03-videos/TD-14`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: presigned URL (public storage client) with `response-content-disposition=attachment`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 409 VIDEO_NOT_READY: when the video status is not `ready`
- 401: when the access token is missing or invalid

---

#### GET /videos/:publicId/thumbnail (SI-03.10)

Redirects to a short-lived presigned URL for `thumbnails/{id}.jpg` (per `phase-03-videos/TD-09`, `phase-03-videos/TD-14`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: presigned URL (public storage client)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another channel
- 409 VIDEO_NOT_READY: when the video status is not `ready`
- 401: when the access token is missing or invalid

---

#### Validation Rules — Videos

| Field | Rule | Error message |
|-------|------|---------------|
| filename | Required string, 1–255 characters | filename must be shorter than or equal to 255 characters |
| fileSize | Required integer, ≥ 1 (cap enforced by the service as `FILE_TOO_LARGE`) | fileSize must not be less than 1 |
| contentType | Required, must match `^video/` | contentType must be a video MIME type |
| title | Optional string, 1–255 characters | title must be shorter than or equal to 255 characters |
| partNumbers | Required array, 1–100 unique integers ≥ 1 | partNumbers must contain between 1 and 100 unique integers |
| parts | Required non-empty array of `{ partNumber: 1–10000, eTag: non-empty string }` | parts must be a non-empty array |
| publicId (path) | 11 characters of `[A-Za-z0-9_-]`; anything else → `404 VIDEO_NOT_FOUND` | — |

---

### Authorization Matrix

Phase 03 is owner-only: every video is unpublished in this phase; Phase 04 opens streaming/download according to visibility (per `phase-03-videos/TD-15`). "Authenticated" means a valid access token whose user does **not** own the video's channel.

| Endpoint | Anonymous | Authenticated | Owner | Notes |
|----------|-----------|---------------|-------|-------|
| POST /videos | ✗ (401) | ✓ | ✓ | Creates a draft in the caller's own channel |
| POST /videos/:publicId/upload/parts | ✗ (401) | ✗ (404) | ✓ | |
| GET /videos/:publicId/upload/parts | ✗ (401) | ✗ (404) | ✓ | |
| POST /videos/:publicId/upload/complete | ✗ (401) | ✗ (404) | ✓ | |
| GET /videos/:publicId | ✗ (401) | ✗ (404) | ✓ | Status view |
| GET /videos/:publicId/stream | ✗ (401) | ✗ (404) | ✓ | Only when `status = 'ready'` |
| GET /videos/:publicId/download | ✗ (401) | ✗ (404) | ✓ | Only when `status = 'ready'` |
| GET /videos/:publicId/thumbnail | ✗ (401) | ✗ (404) | ✓ | Only when `status = 'ready'` |

Presigned URLs returned by these endpoints are bearer capabilities until they expire; access is checked every time a URL is issued (per `phase-03-videos/TD-14`).

---

### Error Catalog

Error response format inherited from Phase 02 (`phase-02-auth/TD-07`): `{ statusCode: number, error: string, message: string }`, where `error` carries the domain code below and validation failures use `"VALIDATION_ERROR"` with `message` as an array.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Unknown `publicId`, malformed `publicId`, or video owned by another channel |
| FILE_TOO_LARGE | 400 | File exceeds the maximum allowed size | `POST /videos` with `fileSize` > `VIDEO_MAX_SIZE_BYTES` |
| INVALID_VIDEO_STATUS | 409 | Operation not allowed in the current video status | Part URLs, part listing or completion requested for a video that is not `draft` |
| INVALID_PART_NUMBER | 400 | Part number out of range | `POST /videos/:publicId/upload/parts` with a part number > the video's `partCount` |
| UPLOAD_INCOMPLETE | 400 | Upload parts are missing or invalid | `CompleteMultipartUpload` rejected by storage (missing part, wrong ETag, invalid order) |
| UPLOAD_SIZE_MISMATCH | 400 | Uploaded file size does not match the declared size | After completion, `HeadObject` `ContentLength` ≠ `fileSize` or > `VIDEO_MAX_SIZE_BYTES`; object deleted, video → `error` |
| VIDEO_NOT_READY | 409 | Video is not ready | `stream`, `download` or `thumbnail` requested while `status ≠ 'ready'` |

**Worker error reasons** (persisted in `videos.error_reason`, never returned as HTTP errors; per `phase-03-videos/TD-12`):

| Reason | Set when |
|--------|----------|
| `INVALID_MEDIA` | ffprobe fails to parse the input or finds no video stream — thrown as `UnrecoverableError`, no retries |
| `PROCESSING_FAILED` | Transient errors (storage/network/ffmpeg) persisted through every retry attempt |
| `UPLOAD_SIZE_MISMATCH` | Set by the API at completion (see table above) |

---

### Events/Messages

#### video.process (queue `video-processing`)

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:** `jobId` = `videoId` (adding the same job twice is ignored — BullMQ `jobId` de-duplication, per `phase-03-videos/TD-01`); `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`; `removeOnComplete: true`, `removeOnFail: false` (failed jobs stay inspectable — BullMQ has no native dead-letter queue, per `phase-03-videos/TD-01`).
**Producer:** `VideosService.completeUpload` in the API, after the `draft → processing` transition (per `phase-03-videos/TD-04`).
**Consumer:** `VideoProcessor` (`@Processor('video-processing')`, `WorkerHost`) in the `video-worker` container, booted by `src/worker.ts` via `NestFactory.createApplicationContext` (per `phase-03-videos/TD-05`; started with `node --watch` + `ts-node`, per `phase-03-videos/TD-16` revision 2026-11-24).
**Trigger:** a successful `POST /videos/:publicId/upload/complete`.
**Processing steps** (per `phase-03-videos/TD-06`, `TD-07`, `TD-08`, `TD-09`, `TD-12`):
1. Load the video by `videoId`; if it is not in `processing`, return without changes (idempotent re-delivery).
2. Presign a `GetObject` URL for `video_key` with the **internal** storage client (per `phase-03-videos/TD-10` revision 2026-11-24 — "Signing client per consumer") and pass it to `fluent-ffmpeg` `ffprobe`.
3. No video stream or unparseable input → throw `UnrecoverableError` (`INVALID_MEDIA`).
4. Extract `duration_seconds` and the `metadata` keys from the ffprobe result.
5. Seek to 10% of the duration (clamped to `[0, duration − ε]`) and write one frame as JPEG (`.jpg` output filename — `screenshots()` defaults to PNG, per `library-refs.md`), then `PutObject` to `thumbnails/{id}.jpg`.
6. Conditional update `processing → ready` with `duration_seconds`, `metadata`, `thumbnail_key`.
**Failure handling:** on the worker `failed` event, when the error is `UnrecoverableError` or `attemptsMade >= attempts`, conditional update `processing → error` with the matching `error_reason` (per `phase-03-videos/TD-12`).
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-01`); idempotency comes from conditional status transitions plus the deterministic thumbnail key (per `phase-03-videos/TD-12`, `phase-03-videos/TD-09`).

---

## Dependency Map

```
SI-03.1 (root)
├── SI-03.2 — depends on SI-03.1 (credentials and env keys before the Compose services)
│   ├── SI-03.3 — depends on SI-03.1, SI-03.2 (storage config + MinIO running)
│   │   └── SI-03.5 — depends on SI-03.3, SI-03.4 (StorageService + Video entity)
│   │       └── SI-03.6 — depends on SI-03.5 (draft video with upload_id)
│   │           ├── SI-03.7 — depends on SI-03.6 (part URLs before completion)
│   │           │   ├── SI-03.8 — depends on SI-03.2, SI-03.7 (Redis/MinIO + QueueModule)
│   │           │   │   └── SI-03.9 — depends on SI-03.7, SI-03.8 (job published + worker with FFmpeg)
│   │           │   │       └── SI-03.11 — depends on SI-03.9, SI-03.10 (full pipeline e2e)
│   │           │   │           └── SI-03.12 — depends on SI-03.11 (docs describe the final state)
│   │           └── SI-03.10 — depends on SI-03.6, SI-03.3 (findOwnedByPublicId + per-consumer signing)
SI-03.4 (root, independent — entity + migration)
```

---

## Deliverables

- [ ] SI-03.1 — Infra: Dependências e namespaces de configuração
- [ ] SI-03.2 — Infra: MinIO e Redis no Docker Compose
- [ ] SI-03.3 — StorageModule: clientes S3 interno/público e operações de objeto
- [ ] SI-03.4 — Entidade Video, migration e identificador público
- [ ] SI-03.5 — Endpoint POST /videos (iniciar upload e pré-cadastrar rascunho)
- [ ] SI-03.6 — Endpoints de partes: URLs sob demanda e listagem para retomada
- [ ] SI-03.7 — Endpoint de conclusão do upload e publicação na fila
- [ ] SI-03.8 — Infra: container video-worker com FFmpeg
- [ ] SI-03.9 — VideoProcessor: metadados, thumbnail e status
- [ ] SI-03.10 — Endpoints de status, streaming, download e thumbnail
- [ ] SI-03.11 — Fluxo completo upload → processamento → streaming
- [ ] SI-03.12 — Documentação de IA: CLAUDE.md com a seção de vídeos

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`) — with `minio`, `redis` and `video-worker` running
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
