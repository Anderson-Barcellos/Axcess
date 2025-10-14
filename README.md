# Plano de Orquestração Multi‑Modelo via MCP para Codex/Claude

> **Objetivo**: construir um servidor **MCP** enxuto que rode por **stdio** e exponha uma tool `delegate.run` (e irmãs) para o **Claude Code CLI** (ou Codex) agir como **orquestrador**, delegando tarefas dinamicamente a modelos **OpenAI** com tuas chaves: `gpt-5-codex`, `gpt-5-mini`, `gpt-5-chat` e `gpt-5`. O roteador escolhe o modelo com base em **tipo de tarefa**, **tamanho/complexidade**, **criticidade** e **custo**, com **fallback** e **logs de uso**.

---

## 1) Escopo

**Inclui**: servidor MCP stdio (Node/TS), roteador de modelos declarativo, provider OpenAI, tools principais (`delegate.run`, `delegate.diff`, `delegate.tests`, `delegate.docs`), políticas de custo/tokens, logs/telemetria básica, configuração para Claude/Claude Code.

**Não inclui (agendado Fase 2+)**: consenso multi‑modelo paralelo, retriever vetorial externo (Cipher/Qdrant), UI própria, persistência de sessões, autorização multiusuário.

**Definição de Pronto do MVP**: `delegate.run` atendendo 4 tipos de tarefa, roteamento funcionando com `forceModel` opcional, métricas de uso por chamada, integração com Claude Code via `mcpServers` e README de uso.

---

## 2) Arquitetura (visão rápida)

```mermaid
flowchart TB
  C[Claude Code / Codex (MCP Client)] -->|tools/call (stdio)| S[Orquestrador MCP]
  subgraph S[Servidor MCP]
    R[Router de Modelos] --> P[Provider OpenAI]
    T1[tool: delegate.run]
    T2[tool: delegate.diff]
    T3[tool: delegate.tests]
    T4[tool: delegate.docs]
  end
  C -->|tools/list| S
  P --> S --> C
```

**Componentes**

* **Router**: lê `conf/models.json` e `conf/policies.json`, decide modelo, `max_output_tokens`, temperatura e `rationale`.
* **Provider OpenAI**: SDK `openai`, usando **Responses API**; normaliza `output_text` e `usage`.
* **Tools**: transformam a intenção do cliente em chamadas ao provider; `delegate.diff` retorna **patch unificado** para aplicação direta.
* **Telemetry**: console logs estruturados + arquivo CSV opcional.

---

## 3) Contratos & Configuração

### 3.1 Variáveis de ambiente (`.env`)

```
OPENAI_API_KEY=sk-...
ORCH_LOG_LEVEL=info
ORCH_MAX_INPUT_TOKENS=32000
ORCH_COST_ALERT_USD=2.00     # alerta por chamada
```

### 3.2 Modelos e políticas (`conf/*.json`)

`conf/models.json`

```json
{
  "aliases": {
    "codex": "gpt-5-codex",
    "mini":  "gpt-5-mini",
    "chat":  "gpt-5-chat",
    "full":  "gpt-5"
  },
  "routing": {
    "code_generate": ["codex", "mini", "full"],
    "refactor":      ["codex", "full", "mini"],
    "tests":         ["mini",  "codex", "full"],
    "docs":          ["chat",  "mini",  "full"],
    "deep_reasoning": ["full", "codex"]
  }
}
```

`conf/policies.json`

```json
{
  "defaults": { "max_output_tokens": 2048, "temperature": 0.2 },
  "overrides": {
    "docs": { "temperature": 0.7 },
    "deep_reasoning": { "max_output_tokens": 4096 }
  },
  "caps": {
    "mini": { "max_input": 12000 },
    "chat": { "max_input": 12000 }
  }
}
```

### 3.3 Tool principal — `delegate.run`

**Assinatura (MCP)**

```json
{
  "name": "delegate.run",
  "description": "Roteia e executa tarefas em subagentes OpenAI",
  "input_schema": {
    "type": "object",
    "properties": {
      "task": {"type":"string", "enum":["code_generate","refactor","tests","docs","deep_reasoning"]},
      "input": {"type":"string"},
      "language": {"type":"string"},
      "safetyCritical": {"type":"boolean"},
      "forceModel": {"type":"string", "description":"Opcional: substitui roteador (ex.: gpt-5-codex)"},
      "return": {"type":"string", "enum":["code","patch","text"], "default":"code"}
    },
    "required": ["task","input"]
  }
}
```

**Saída**

```json
{
  "result": "...",
  "meta": {
    "model": "gpt-5-codex",
    "rationale": "task=refactor size=5800 safety=true => gpt-5-codex",
    "usage": {"input": 1234, "output": 456},
    "cost_usd": 0.0123
  }
}
```

### 3.4 Config do cliente (Claude Code/Claude Desktop)

`mcpServers` (exemplo)

```json
{
  "mcpServers": {
    "orquestrador-anders": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {"OPENAI_API_KEY": "${OPENAI_API_KEY}"}
    }
  }
}
```

---

## 4) Estratégia de Roteamento

1. **Classificar tarefa**: o cliente informa `task`; fallback para `docs` se não reconhecido.
2. **Estimar tokens**: `approxTokens = ceil(chars/3)`; respeitar `caps` por modelo.
3. **Heurísticas**:

   * `safetyCritical=true` força `codex`/`full`.
   * `approxTokens > caps.mini.max_input` pula `mini`/`chat`.
   * `language` ∈ {"c","cpp","rust"} tende a `codex`.
4. **Fallback**: tentar em ordem do `routing` (timeout 45–60s); se falhar, próximo modelo.
5. **Controls**: `forceModel` sobrescreve; `return` ajusta prompt de saída (patch vs code).

**Prompt base por tipo** (trechos de system prompt)

* `code_generate`: "Return only runnable code. Add minimal comments. Avoid explanations."
* `refactor`: "Return a unified diff patch. Do not include prose."
* `tests`: "Create unit tests with deterministic seeds."
* `docs`: "Return concise documentation in Markdown."
* `deep_reasoning`: "Think stepwise but output only the final artifact."

---

## 5) Telemetria, Custos e Orçamentos

* **Logs**: JSON por linha com `ts`, `task`, `decision`, `usage`, `latency_ms`, `cost_usd`.
* **CSV opcional**: `./logs/usage.csv` para planilhas.
* **Alertas**: se `cost_usd > ORCH_COST_ALERT_USD`, avisar no `meta`.
* **Token diet**: truncar input acima de `ORCH_MAX_INPUT_TOKENS`, preferindo janelas de contexto recentes.

---

## 6) Roadmap por Fases

**Fase M0 – Skeleton (0.5d)**

* Node 20+, TS, `openai` SDK, CLI build (`tsup`/`esbuild`).
* Loop stdio MCP mínimo: `tools/list` e `tools/call`.

**Fase M1 – Roteador/Provider (1d)**

* `router.ts` + `policies.json` + `models.json`.
* `providers/openai.ts` com Responses API e coleta de `usage`.
* Tool `delegate.run` (retorno `code|text`).

**Fase M2 – Patch e Tests (1d)**

* Tool `delegate.diff` (formato `git diff --unified`).
* Tool `delegate.tests` (estrutura por framework; Jest/PyTest parametrizável).

**Fase M3 – Controles de custo (0.5d)**

* Estimativa de custo por chamada; alerta/abort ao exceder teto.
* `forceModel`, `safetyCritical` e truncamento por prioridade.

**Fase M4 – Qualidade & DX (1d)**

* Prompts refinados por tarefa; templates por linguagem.
* Métricas de latência; retry exponencial; timeouts distintos por modelo.

**Fase M5 – Integrações opcionais (2d+)**

* `retrieve.search` (Cipher/Qdrant) para contexto fino.
* Modo "consenso": 2 modelos em paralelo + comparador simples.

---

## 7) Tarefas (Checklist para o Codex)

*

---

## 8) Exemplos de Chamada (lado do cliente)

**Gerar código**

```json
{
  "name": "delegate.run",
  "arguments": {
    "task": "code_generate",
    "language": "python",
    "input": "Write a FastAPI endpoint that streams Server-Sent Events for progress updates.",
    "return": "code"
  }
}
```

**Refatorar com patch**

```json
{
  "name": "delegate.run",
  "arguments": {
    "task": "refactor",
    "language": "typescript",
    "input": "Refactor this file to remove side effects and add DI... <file contents>",
    "return": "patch",
    "safetyCritical": true
  }
}
```

---

## 9) Boas Práticas de Prompt (agente)

* Dê **instruções de saída** claras: *only code*, *only patch*, *only markdown*.
* Defina **limites** (linhas, tokens, tempo) e peça para **cortar** quando ultrapassar.
* Para `patch`, exigir cabeçalhos `diff --git a/... b/...` e contexto `@@`.
* Para `tests`, exigir **semente fixa** e **sem dependências externas**.

---

## 10) Riscos & Mitigações

* **Timeouts/limites**: estabelecer timeouts e fallback imediato para próximo modelo.
* **Explosão de tokens**: truncar entradas e preferir janelas recentes; usar mini/chat quando possível.
* **Qualidade inconsistente**: logs comparativos por tarefa; sticky‑routing por linguagem.
* **Custos**: tetos por tarefa e alerta por chamada.

---

## 11) Como rodar (dev)

```
# instalar deps
pnpm i

# build
pnpm build

# executar servidor MCP por stdio
node dist/index.js
```

Configura no cliente `mcpServers` apontando para `node dist/index.js` e injeta `OPENAI_API_KEY` no `env`.

---

## 12) Anexo: System Prompts (rascunho)

**`code_generate`**** (system)**

```
You are a code-generation agent. Return ONLY runnable code. Use idiomatic patterns. Keep comments minimal. No prose or explanations.
```

**`refactor`**** (system)**

```
You are a refactoring agent. Return ONLY a unified diff patch (git format). Do not include explanations. Preserve behavior unless explicitly asked.
```

**`tests`**** (system)**

```
You are a test-generation agent. Produce deterministic unit tests with fixed seeds. Avoid network or randomness. Return ONLY code.
```

**`docs`**** (system)**

```
You are a documentation agent. Produce concise Markdown docs with a clear title and sections. No HTML. Keep it short.
```

---
