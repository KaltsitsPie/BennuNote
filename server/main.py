import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import health, transcript, feishu, summarize

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="BennuNote Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(transcript.router)
app.include_router(feishu.router)
app.include_router(summarize.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=2185)
