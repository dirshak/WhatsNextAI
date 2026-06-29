from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from routers import ingest, query, propose
from dotenv import load_dotenv
from auth import require_api_key
from rate_limit import limiter
import logging
import os

load_dotenv()

log_level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(level=log_level)

from database import engine, Base
import models.chunk

Base.metadata.create_all(bind=engine)

app = FastAPI(title="GraphForgeAI – AI Architecture Evolution Platform")

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

allowed_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3001",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router, prefix="/api", dependencies=[Depends(require_api_key)])
app.include_router(query.router, prefix="/api", dependencies=[Depends(require_api_key)])
app.include_router(propose.router, prefix="/api", dependencies=[Depends(require_api_key)])


@app.get("/health")
def health():
    return {"status": "ok"}
