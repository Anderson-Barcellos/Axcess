# Plano de Orquestração Multi‑Modelo via MCP para Codex/Claude

> **Objetivo**: entregar um servidor **MCP** leve, rodando por **stdio**, que expõe a tool `delegate.run` para o **Claude Code CLI / Codex** atuar como orquestrador. O roteador decide entre os modelos declarados em `conf/models.json` — hoje com aliases apontando para `openai:gpt-4o-mini`, `openai:gpt-4o`, `anthropic:claude-3-5-sonnet` e `google:gemini-1.5-pro` — aplicando heurísticas de idioma, janelas de tokens e custos definidos em `conf/policies.json`, com fallback automático e logs estruturados.

---

## 1) Escopo

**Inclui**: servidor MCP (Node/TS), roteador declarativo, provider OpenAI ativo, suporte para aliases/configs Anthropic e Google (via configuração), ferramenta `delegate.run`, cálculo de custo/tokens por chamada, telemetria básica em stdout e integração com Claude/Codex.

**Não inclui (fase futura)**: providers alternativos já implementados, tools adicionais (`delegate.diff`, `delegate.tests`, etc.), persistência de sessões, dashboards ou autenticação multiusuário.

**Definição de pronto**: `delegate.run` respondendo via stdio com roteamento completo (`forceModel`, caps e heurísticas), métricas de uso/custo retornadas no metadata MCP e README alinhado à configuração real.

---

## 2) Arquitetura (visão rápida)

```mermaid
flowchart TB
  C[Claude Code / Codex (MCP Client)] -->|tools/call (stdio)| S[Orquestrador MCP]
  subgraph S[Servidor MCP]
    R[Router de Modelos] --> P1[Provider OpenAI]
    R --> P2[(Providers adicionais)]
    T1[tool: delegate.run]
  end
  C -->|tools/list| S
  P1 --> S --> C
```

**Componentes**

* **Router**: consome `conf/models.json` + `conf/policies.json`, resolve alias/modelo, ajusta `max_output_tokens`, temperatura e gera `rationale` + fallback chain.
* **Providers**: OpenAI implementado (SDK `openai`, Responses API); módulos para Anthropic/Google plugam no mesmo contrato `ProviderHandler`.
* **delegate.run**: converte a requisição MCP em chamadas aos providers, calcula custo/tokens, aplica caps e registra tentativas.
* **Telemetry**: logs estruturados (`[axcess] ...`) indicando rota escolhida, fallback, erros e métricas de custo.

---

## 3) Contratos & Configuração

### 3.1 Modelos (`conf/models.json`)

`conf/models.json` define aliases e metadados dos modelos. Snapshot atual:

```json
{
  "aliases": {
    "chat-default": "openai:gpt-4o-mini",
    "chat-premium": "openai:gpt-4o",
    "reasoning": "anthropic:claude-3-5-sonnet",
    "long-context": "google:gemini-1.5-pro"
  },
  "models": {
    "openai:gpt-4o-mini": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "max_output_tokens": 4096,
      "temperature": 0.7,
      "cap": { "default": 2048, "hard": 4096 },
      "pricing": { "currency": "USD", "input": 0.000003, "output": 0.000009 }
    },
    "openai:gpt-4o": {
      "provider": "openai",
      "model": "gpt-4o",
      "max_output_tokens": 4096,
      "temperature": 0.65,
      "cap": { "default": 3072, "hard": 4096 },
      "pricing": { "currency": "USD", "input": 0.00001, "output": 0.00003 }
    },
    "anthropic:claude-3-5-sonnet": {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet",
      "max_output_tokens": 4096,
      "temperature": 0.6,
      "cap": { "default": 2048, "hard": 4096 },
      "pricing": { "currency": "USD", "input": 0.000008, "output": 0.000024 }
    },
    "google:gemini-1.5-pro": {
      "provider": "google",
      "model": "gemini-1.5-pro",
      "max_output_tokens": 8192,
      "temperature": 0.7,
      "cap": { "default": 4096, "hard": 8192 },
      "pricing": { "currency": "USD", "input": 0.0000075, "output": 0.0000225 }
    }
  }
}
```

O cálculo de custo usa os campos `pricing.input`/`pricing.output` multiplicados pelos tokens reportados (ou estimados). Se o provider informar apenas `totalTokens`, todo o valor vira input com output zerado.

### 3.2 Políticas (`conf/policies.json`)

`conf/policies.json` guia o roteamento:

* `routing.defaultAlias`: fallback geral (`chat-default`).
* `routing.languageHeuristics`: PT força `chat-premium` e temperatura 0.6; EN mantém `chat-default` a 0.7; ES usa 0.65.
* `routing.tokenBuckets`: buckets por tamanho de prompt definem alias (até 1200 tokens usa `chat-default`; 1200-2800 vai pra `chat-premium`; acima disso cai no `long-context`).
* `routing.fallbacks`: ordem de tentativas caso ocorra erro.
* `caps`: teto padrão (2048) com overrides por tier (`trial`, `pro`, `enterprise`).
* `temperatures`: default 0.7 + perfis `code` (0.25) e `creative` (0.9).

O roteador combina heurísticas de idioma, domínio (`metadata.domain`), tier (`metadata.tier`) e caps adicionais (`caps.maxOutputTokens`). O rationale retornado na resposta detalha cada decisão tomada.

### 3.3 Variáveis de ambiente (`.env`)

```
# Providers (obrigatório para o handler correspondente)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...   # requerido quando o provider Anthropic estiver habilitado
GOOGLE_API_KEY=ya29....        # requerido quando o provider Gemini estiver habilitado

# Logging / custos (opcional, consumido pelos módulos de telemetria)
ORCH_LOG_LEVEL=info            # debug|info|warn|error (default: info)
ORCH_COST_ALERT_USD=2.00       # alerta por chamada que ultrapassar esse custo total
ORCH_USAGE_EXPORT=./logs.csv   # caminho para export de uso quando habilitado
```

Sem `OPENAI_API_KEY`, o provider ativo falha na inicialização. As chaves de Anthropic/Google podem ficar prontas para quando os handlers forem adicionados. As flags `ORCH_*` serão lidas pelos módulos de telemetria/custos nas próximas tasks — manter default deixa o logger atual somente em stdout.

### 3.4 Tool principal — `delegate.run`

**Assinatura MCP (`tools/list`)**

```json
{
  "name": "delegate.run",
  "description": "Roteia prompts para os modelos configurados e retorna a resposta.",
  "input_schema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "Prompt a ser encaminhado para o roteador."
      },
      "forceModel": {
        "type": "string",
        "description": "Alias ou modelId para bypass do roteador."
      },
      "metadata": {
        "type": "object",
        "properties": {
          "language": { "type": "string" },
          "tier": { "type": "string" },
          "domain": {
            "type": "string",
            "enum": ["code", "creative", "default"]
          },
          "temperature": { "type": "number" }
        },
        "additionalProperties": false
      },
      "caps": {
        "type": "object",
        "properties": {
          "maxOutputTokens": { "type": "number" }
        },
        "additionalProperties": false
      }
    },
    "required": ["prompt"],
    "additionalProperties": false
  }
}
```

**Resposta padrão (`tools/call`)**

```json
{
  "content": [
    {
      "type": "text",
      "text": "... output gerado pelo modelo ..."
    }
  ],
  "metadata": {
    "decision": { "provider": "openai", "model": "gpt-4o-mini", "alias": "chat-default" },
    "parameters": { "max_output_tokens": 2048, "temperature": 0.7 },
    "rationale": ["..."],
    "usage": {
      "estimated_input_tokens": 256,
      "input_tokens": 220,
      "output_tokens": 180,
      "total_tokens": 400
    },
    "cost": { "currency": "USD", "input": 0.00066, "output": 0.00162, "total": 0.00228 },
    "meta": {
      "fallback_used": false,
      "attempts": [
        {
          "alias": "chat-default",
          "provider": "openai",
          "model": "gpt-4o-mini",
          "success": true
        }
      ]
    }
  }
}
```

---

## 4) Fluxo de execução (delegate.run)

1. Cliente MCP envia `prompt` + metadados opcionais.
2. `router.ts` estima tokens, aplica heurísticas de idioma/domínio, caps de tier e caps da requisição, resolve alias/modelo e monta fallback chain.
3. `delegate.ts` tenta o modelo principal; em caso de erro, percorre fallback list registrando cada tentativa.
4. O provider retorna texto + contadores (`usage`). O delegado normaliza, calcula custo (`pricing` x tokens), agrega rationale e devolve via MCP.

---

## 5) Telemetria & custos

* Logs em stdout com prefixo `[axcess]` detalham rotas, sucesso/falha e custos.
* `meta.attempts` registra cada tentativa, útil para dashboards futuros.
* Quando os flags `ORCH_COST_ALERT_USD`/`ORCH_USAGE_EXPORT` estiverem habilitados, o módulo de telemetria exportará CSV e emitirá avisos (placeholder preparado no roadmap).

---

## 6) Roadmap por fases

**Fase M0 – Skeleton (entregue)**

* Loop stdio MCP mínimo (`tools/list`/`tools/call`) em Node 20+/TS.
* Provider OpenAI (`openai` SDK) com Responses API e coleta de `usage`.
* Roteador lendo `models.json` + `policies.json` com rationale detalhada.

**Fase M1 – Providers adicionais**

* Implementar handlers Anthropic/Google lendo `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`.
* Normalizar responses para o contrato `ProviderResponse`.

**Fase M2 – Tools complementares**

* `delegate.diff` gerando patch unificado.
* `delegate.tests` orchestrando frameworks configuráveis.

**Fase M3 – Telemetria avançada**

* Consumo real das flags `ORCH_*` (nível de log, alerta de custo, export CSV).
* Retry exponencial com jitter e métricas de latência.

**Fase M4 – Integrações opcionais**

* `retrieve.search` (Cipher/Qdrant) para contexto adicional.
* Estratégias de consenso multi-modelo.

---

## 7) Tarefas (Checklist para o Codex)

_A preencher conforme backlog evoluir._

---

## 8) Exemplos de chamada (lado do cliente)

**Prompt padrão com heurística automática**

```json
{
  "name": "delegate.run",
  "arguments": {
    "prompt": "Escreve um resumo em português sobre MCP routers.",
    "metadata": {
      "domain": "default"
    }
  }
}
```

**Forçando modelo Anthropic com cap customizado**

```json
{
  "name": "delegate.run",
  "arguments": {
    "prompt": "Break down this legal argument and propose counterpoints.",
    "forceModel": "reasoning",
    "metadata": {
      "language": "en",
      "tier": "enterprise",
      "domain": "creative"
    },
    "caps": {
      "maxOutputTokens": 2048
    }
  }
}
```

---

## 9) Boas práticas de prompt (agente)

* Dê **instruções de saída** claras: *only code*, *only patch*, *only markdown*.
* Defina **limites** (linhas, tokens, tempo) e peça para **cortar** quando ultrapassar.
* Para `patch`, exija cabeçalhos `diff --git a/... b/...` e contexto `@@`.
* Para `tests`, use **semente fixa** e evite dependências externas.

---

## 10) Riscos & mitigações

* **Timeouts/limites**: definir timeouts por provider e fallback imediato.
* **Explosão de tokens**: truncar entradas grandes; preferir `chat-default`/`chat-premium` quando possível.
* **Qualidade inconsistente**: logs comparativos por tarefa e sticky-routing por linguagem.
* **Custos**: tetos por tarefa e alerta por chamada (via `ORCH_COST_ALERT_USD`).

---

## 11) Como rodar (dev)

```
# instalar deps
pnpm install

# gerar build (dist/)
pnpm build

# rodar o servidor MCP (stdio)
pnpm start

# modo dev sem build prévia (ts-node)
pnpm ts-node src/index.ts
```

No cliente (Claude Code / Codex CLI), registra em `mcpServers` apontando para `pnpm start` (ou `node dist/index.js`) e injeta `OPENAI_API_KEY` nas variáveis de ambiente. Quando os providers de Anthropic/Google estiverem plugados, basta adicionar as chaves correspondentes.

---

## 12) Anexo: System prompts (rascunho)

**`code_generate` (system)**

```
You are a documentation agent. Produce concise Markdown docs with a clear title and sections. No HTML. Keep it short.
```
