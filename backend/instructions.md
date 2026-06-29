# GraphForgeAI – Development Instructions

## Objective

You are working on **GraphForgeAI**, a project forked from **Codebase-Understanding-Assistant**.

This is **not** another AI code assistant.

The goal is to transform the existing project into an **AI Architecture Evolution Platform** that allows developers to understand a GitHub repository, propose new features, visualize architectural changes, regenerate diagrams, and generate an implementation plan.

The existing repository should be treated as a stable production application.

Your responsibility is to **extend it**, not rewrite it.

---

# Phase 0 – Mandatory Infrastructure Migration

Complete this phase before implementing any new functionality.

---

## 0.1 Replace Jina AI with Groq

The project currently contains Jina AI integration.

Remove all runtime dependencies on Jina AI.

The root `.env` already contains:

```env
GROQ_API_KEY=<my_key>
```

Create a single reusable Groq client named:

```python
X
```

Example:

```python
from groq import Groq
import os

X = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)
```

Use this shared client everywhere.

Search the repository and replace every Jina integration including:

* embedding generation
* reranking
* semantic search
* repository indexing
* helper utilities
* API wrappers
* configuration
* environment variables

Remove obsolete Jina code.

Never hardcode API keys.

Always load them from `.env`.

---

## 0.2 Replace PostgreSQL with SQLite

The project currently uses PostgreSQL.

Completely migrate the backend to SQLite.

Requirements:

* replace PostgreSQL connection with SQLite
* update SQLAlchemy configuration
* migrate ORM models if necessary
* remove PostgreSQL-only SQL
* remove pgvector dependencies
* preserve the application's behavior
* keep the ORM layer intact whenever possible

The new database should be

```text
sqlite:///graphforge.db
```

If PostgreSQL-specific vector functionality cannot be directly migrated, replace it with the simplest local implementation while preserving existing APIs.

No hosted database should remain.

---

# Existing Project

The existing application already provides:

* GitHub repository ingestion
* Repository cloning
* Code parsing
* AST analysis
* Dependency graph generation
* React Flow visualization
* Mermaid architecture diagrams
* FastAPI backend
* Authentication
* Rate limiting
* Repository chat
* Natural language querying

All of this functionality must continue working exactly as before.

---

# GraphForgeAI Vision

GraphForgeAI is an AI Architecture Evolution platform.

Instead of simply answering questions about a repository, it should allow users to evolve software architecture using natural language.

Example:

```
Add OAuth2 Login

↓

Analyze current architecture

↓

Generate architecture mutation

↓

Update graph

↓

Update architecture diagram

↓

Generate ER diagram

↓

Produce implementation plan
```

---

# New Backend Components

## feature_proposer.py

Purpose:

Accept:

* current architecture graph
* repository metadata
* user feature request

Uses the shared Groq client **X**.

Returns:

```json
{
  "add_nodes": [],
  "add_edges": [],
  "modify_nodes": [],
  "rationale": "",
  "implementation_plan": []
}
```

This module is responsible only for reasoning.

It does **not** modify the graph.

---

## mutator.py

Purpose:

Safely apply the mutation returned by feature_proposer.

Outputs:

* updated NetworkX graph
* updated React Flow graph
* updated Mermaid architecture diagram
* updated Mermaid ER diagram
* graph diff metadata

The original graph must never be modified in place.

---

# Backend Integration

Inspect the repository and identify:

* graph generation pipeline
* Mermaid generation
* React Flow serialization
* Groq integrations
* repository parser
* API routing
* service layer

Reuse existing logic whenever possible.

Avoid duplicate implementations.

---

# New API Endpoint

Implement

```
POST /api/propose-feature
```

Input

```json
{
    "repo_id": "...",
    "feature": "Add OAuth2 login"
}
```

Pipeline

```
Current Graph
        ↓
FeatureProposer
        ↓
Mutation JSON
        ↓
GraphMutator
        ↓
Updated Graph
        ↓
React Flow
Mermaid
ER Diagram
Implementation Plan
```

Response

```json
{
    "graph": {},
    "react_flow": {},
    "architecture_mermaid": "",
    "er_mermaid": "",
    "implementation_plan": [],
    "rationale": ""
}
```

---

# Frontend

Locate the existing React Flow page.

Do not redesign it.

Extend it.

Add:

Feature Request Panel

```
---------------------------------

Feature Request

[ Textbox ]

[ Propose ]

---------------------------------
```

When the user presses **Propose**

The frontend should

* call `/api/propose-feature`
* animate newly created nodes
* animate new edges
* update Mermaid architecture diagram
* regenerate ER diagram
* display implementation plan
* display reasoning

Do not remove any existing UI.

---

# Preservation Rules (Mandatory)

The existing project is production code.

Treat it as read-only unless integration requires modification.

## NEVER

* Delete files
* Delete features
* Delete endpoints
* Delete services
* Remove existing UI
* Rewrite architecture
* Break compatibility
* Rename modules unnecessarily
* Replace existing implementations
* Perform unrelated refactoring

## ALWAYS

Prefer

* new services
* new routes
* new utilities
* new React components
* adapters
* wrappers
* extension modules

instead of changing existing code.

If an existing file must be modified

* make the smallest possible change
* preserve all existing logic
* explain why the change is necessary

If deleting or significantly modifying existing code appears necessary

STOP

Explain why.

Wait for approval.

---

# Implementation Workflow

## Phase 1

Inspect the repository.

Produce an implementation plan including:

* repository architecture
* current request flow
* Jina usage
* PostgreSQL usage
* files to modify
* files to create
* migration strategy
* integration strategy

Do not write code yet.

Wait for approval.

---

## Phase 2

Implement infrastructure migration.

* Jina → Groq
* PostgreSQL → SQLite

Verify application still runs.

---

## Phase 3

Implement backend.

* feature_proposer.py
* mutator.py
* API endpoint
* service integration

Verify tests.

---

## Phase 4

Implement frontend.

* Feature Request panel
* graph animation
* Mermaid regeneration
* implementation plan
* graph diff highlighting

Verify frontend.

---

## Phase 5

Final verification.

Confirm that:

* Existing repository analysis still works.
* Repository chat still works.
* GitHub ingestion still works.
* Graph generation still works.
* Mermaid diagrams still work.
* Authentication still works.
* Rate limiting still works.
* SQLite is fully operational.
* Groq is used everywhere.
* No Jina runtime dependency remains.

Finally, provide:

1. A list of every modified file.
2. A list of every new file.
3. A summary of architectural changes.
4. Verification that no original functionality was removed.
