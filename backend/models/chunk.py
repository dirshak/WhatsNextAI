"""
Database models — SQLite-backed via SQLAlchemy ORM.

Migrated from PostgreSQL + pgvector:
- UUID columns replaced with String (SQLite has no native UUID type)
- Vector(1024) column replaced with Text (stores JSON-serialised float list or None)
- PostgreSQL HNSW index removed (no pgvector on SQLite)
"""
import uuid

from sqlalchemy import Column, String, Text, Integer, JSON
from database import Base


class CodeChunk(Base):
    __tablename__ = "code_chunks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    repo_id = Column(String, nullable=False, index=True)
    file_path = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    start_line = Column(Integer)
    end_line = Column(Integer)
    # Embeddings stored as JSON text; None when embeddings are disabled.
    embedding = Column(Text, nullable=True)


class FileSymbol(Base):
    __tablename__ = "file_symbols"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    repo_id = Column(String, nullable=False, index=True)
    file_path = Column(String, nullable=False)
    functions = Column(JSON, default=list)
    classes = Column(JSON, default=list)
    imports = Column(JSON, default=list)
    top_level_docstring = Column(Text, nullable=True)


class FileDependency(Base):
    """Stores one edge of the dependency graph: source file imports target."""
    __tablename__ = "file_dependencies"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    repo_id = Column(String, nullable=False, index=True)
    source = Column(String, nullable=False)
    target = Column(String, nullable=False)


class CallEdge(Base):
    """Precomputed function-to-function call graph edges (computed once at ingest time)."""
    __tablename__ = "call_edges"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    repo_id = Column(String, nullable=False, index=True)
    caller_id = Column(String, nullable=False)   # e.g. "fn::filename.py::func_name"
    callee_id = Column(String, nullable=False)   # e.g. "fn::filename.py::func_name"
