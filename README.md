# What's Next?

### *See the Change Before You Build It.*

**WhatsNextAI** is an AI-powered software evolution platform that helps developers understand, evolve, and extend existing software systems. Instead of jumping directly into implementation, WhatsNextAI analyzes a GitHub repository, builds an interactive architectural model, proposes feature-driven architectural changes, visualizes their impact, and generates implementation plans before code is written.

**Live Demo:** https://whatsnextai.vercel.app 

---

## Features

* Repository ingestion from GitHub
* Interactive hierarchical architecture visualization
* AI-powered repository chat
* Natural language feature proposals
* Architecture change preview
* Difference graph highlighting added, modified, and removed components
* Mermaid architecture and ER diagram generation
* Implementation planning
* AI-assisted code generation through Groq
* FastAPI backend with React frontend

---

## How It Works

```text
GitHub Repository
        │
        ▼
Repository Analysis
        │
        ▼
Architecture
        │
        ▼
Feature Proposal
        │
        ▼
Architecture Evolution
        │
        ▼
Difference Visualization
        │
        ▼
Implementation Plan
        │
        ▼
AI Code Generation
```

---

## Tech Stack

### Frontend

* React
* D3.js
* Mermaid
* CSS

### Backend

* FastAPI
* SQLAlchemy
* SQLite
* NetworkX
* Groq API

---

## Project Structure

```text
WhatsNextAI
│
├── backend
│   ├── models
│   ├── routers
│   ├── services
│   ├── feature_proposer.py
│   ├── mutator.py
│   ├── main.py
│   └── requirements.txt
│
├── frontend
│   ├── public
│   ├── src
│   │   ├── components
│   │   ├── App.jsx
│   │   └── index.js
│   └── package.json
│
├── docker-compose.yml
├── README.md
└── LICENSE
```

---

## Installation

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm start
```

The frontend runs at:

```
http://localhost:3000
```

The backend runs at:

```
http://localhost:8000
```

---

## API Endpoints

| Method | Endpoint                      | Description                    |
| ------ | ----------------------------- | ------------------------------ |
| POST   | `/api/ingest`                 | Analyze a GitHub repository    |
| GET    | `/api/graph/{repo_id}`        | Retrieve architecture graph    |
| POST   | `/api/query`                  | Chat with the repository       |
| POST   | `/api/propose-feature`        | Generate architecture proposal |
| GET    | `/api/architecture/{repo_id}` | Mermaid architecture diagram   |
| GET    | `/health`                     | Health check                   |

---

## Future Roadmap

* Multi-language repository support
* Interactive semantic zoom (Folders → Files → Services → Functions)
* Pull request generation
* GitHub integration for automatic commits
* Architecture quality metrics
* Team collaboration
* Plugin ecosystem
* Multi-model AI support

---

## License

Licensed under the MIT License.

---

## Author

Developed by **Dirshak Patro**.
