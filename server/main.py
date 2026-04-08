import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from routers import health, transcript, feishu, summarize
from request_context import ReqIdFilter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s [%(req_id)s]: %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger().handlers[0].addFilter(ReqIdFilter())

app = FastAPI(title="BennuNote Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(transcript.router)
app.include_router(feishu.router)
app.include_router(summarize.router)

# Legacy root-level /write_feishu for backward compat during migration
from routers.feishu import LegacyWriteFeishuRequest
from services.feishu_service import legacy_write_feishu
from services.larkcli import LarkCliError

@app.post("/write_feishu")
def root_write_feishu(req: LegacyWriteFeishuRequest):
    try:
        return legacy_write_feishu(
            text=req.text, title=req.title, items=req.items or [],
            target_doc_token=req.target_doc_token or '',
            video_info=req.video_info or {}, wiki_node=req.wiki_node or '',
            summary=req.summary or '',
            append_summary_only=req.append_summary_only,
        )
    except LarkCliError as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=2185)

