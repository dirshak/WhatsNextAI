import os
from groq import Groq, AsyncGroq
from dotenv import load_dotenv

load_dotenv()

# Shared sync Groq client (for blocking/script contexts)
X = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Shared async Groq client (for FastAPI async endpoints)
groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
