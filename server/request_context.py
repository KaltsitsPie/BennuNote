import contextvars
import logging

_req_id: contextvars.ContextVar[str] = contextvars.ContextVar('req_id', default='-')


def set_req_id(req_id: str) -> None:
    _req_id.set(req_id)


def get_req_id() -> str:
    return _req_id.get()


class ReqIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.req_id = _req_id.get()  # type: ignore[attr-defined]
        return True
