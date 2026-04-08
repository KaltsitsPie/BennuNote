"""Tests for legacy_write_feishu summary handling."""
import pytest
from unittest.mock import patch, MagicMock


# --- helpers ---

def _make_update_result(doc_url: str = "https://www.feishu.cn/wiki/TOKEN123"):
    return {"data": {"doc_url": doc_url, "doc_id": "DOC123"}}

def _make_create_result(doc_url: str = "https://www.feishu.cn/wiki/TOKEN123", doc_id: str = "DOC123"):
    return {"data": {"doc_url": doc_url, "doc_id": doc_id}}

def _make_chunk_result(succeeded: int = 1, failed: int = 0, total: int = 1):
    return {"succeeded": succeeded, "failed": failed, "total": total, "errors": []}


# --- append_summary_only path ---

def test_append_summary_only_calls_update_doc_with_summary_markdown():
    """append_summary_only=True with a docToken should call update_doc once with ## 摘要."""
    from services.feishu_service import legacy_write_feishu

    with patch("services.feishu_service.update_doc", return_value=_make_update_result()) as mock_update, \
         patch("services.feishu_service.create_doc") as mock_create, \
         patch("services.feishu_service._append_chunks_with_retry") as mock_chunks:

        result = legacy_write_feishu(
            text="", title="My Video", items=[], target_doc_token="TOKEN123",
            video_info={}, wiki_node="",
            summary="这是摘要内容。", append_summary_only=True,
        )

    mock_create.assert_not_called()
    mock_chunks.assert_not_called()
    mock_update.assert_called_once()
    call_kwargs = mock_update.call_args
    markdown_arg = call_kwargs.kwargs.get("markdown") or (call_kwargs.args[2] if len(call_kwargs.args) > 2 else "")
    assert "## 摘要" in markdown_arg
    assert "这是摘要内容。" in markdown_arg
    assert result["doc_url"] != ""


def test_append_summary_only_without_doc_token_falls_through_to_create():
    """append_summary_only=True but no docToken: falls through to normal create."""
    from services.feishu_service import legacy_write_feishu

    with patch("services.feishu_service.update_doc") as mock_update, \
         patch("services.feishu_service.create_doc", return_value=_make_create_result()) as mock_create, \
         patch("services.feishu_service._append_chunks_with_retry", return_value=_make_chunk_result()), \
         patch("services.feishu_service._download_and_insert_cover", return_value=""):

        result = legacy_write_feishu(
            text="", title="My Video", items=[], target_doc_token="",
            video_info={}, wiki_node="",
            summary="摘要", append_summary_only=True,
        )

    mock_create.assert_called_once()
    assert result["doc_url"] != ""


# --- summary in normal create flow ---

def test_normal_create_with_summary_appends_summary_chunk():
    """When summary is provided and append_summary_only=False, summary is included as a chunk."""
    from services.feishu_service import legacy_write_feishu

    captured_chunks = []

    def fake_append_chunks(doc_id, chunks):
        captured_chunks.extend(chunks)
        return _make_chunk_result(total=len(chunks), succeeded=len(chunks))

    with patch("services.feishu_service.create_doc", return_value=_make_create_result()), \
         patch("services.feishu_service._append_chunks_with_retry", side_effect=fake_append_chunks), \
         patch("services.feishu_service._download_and_insert_cover", return_value=""), \
         patch("services.feishu_service._ensure_root_link"):

        legacy_write_feishu(
            text="", title="My Video",
            items=[{"from": 0, "to": 5, "content": "Hello"}],
            target_doc_token="", video_info={}, wiki_node="",
            summary="这是摘要。", append_summary_only=False,
        )

    all_chunk_text = "\n".join(captured_chunks)
    assert "## 摘要" in all_chunk_text
    assert "这是摘要。" in all_chunk_text


def test_normal_create_without_summary_has_no_summary_section():
    """When summary is empty, no ## 摘要 section is added."""
    from services.feishu_service import legacy_write_feishu

    captured_chunks = []

    def fake_append_chunks(doc_id, chunks):
        captured_chunks.extend(chunks)
        return _make_chunk_result(total=len(chunks), succeeded=len(chunks))

    with patch("services.feishu_service.create_doc", return_value=_make_create_result()), \
         patch("services.feishu_service._append_chunks_with_retry", side_effect=fake_append_chunks), \
         patch("services.feishu_service._download_and_insert_cover", return_value=""), \
         patch("services.feishu_service._ensure_root_link"):

        legacy_write_feishu(
            text="", title="My Video",
            items=[{"from": 0, "to": 5, "content": "Hello"}],
            target_doc_token="", video_info={}, wiki_node="",
            summary="", append_summary_only=False,
        )

    all_chunk_text = "\n".join(captured_chunks)
    assert "## 摘要" not in all_chunk_text
