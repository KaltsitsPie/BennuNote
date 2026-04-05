# server/services/feishu_service.py
"""Feishu service — all operations via lark-cli subprocess."""
import json
import subprocess as sp

from services.larkcli import run, get_auth_status, LarkCliError


def auth_status() -> dict:
    return get_auth_status()


def list_wiki_spaces() -> dict:
    return run("wiki", "spaces", "list")


def list_wiki_nodes(space_id: str, parent_node_token: str = "") -> dict:
    params: dict = {"space_id": space_id}
    if parent_node_token:
        params["parent_node_token"] = parent_node_token
    return run("wiki", "nodes", "list", "--params", json.dumps(params))


def create_doc(markdown: str, title: str = "", wiki_node: str = "", folder_token: str = "") -> dict:
    args = ["docs", "+create", "--markdown", markdown]
    if title:
        args += ["--title", title]
    if wiki_node:
        args += ["--wiki-node", wiki_node]
    elif folder_token:
        args += ["--folder-token", folder_token]
    return run(*args)


def fetch_doc(doc: str) -> dict:
    return run("docs", "+fetch", "--doc", doc)


def update_doc(doc: str, mode: str, markdown: str = "", selection_by_title: str = "",
               selection_with_ellipsis: str = "", new_title: str = "") -> dict:
    args = ["docs", "+update", "--doc", doc, "--mode", mode]
    if markdown:
        args += ["--markdown", markdown]
    if selection_by_title:
        args += ["--selection-by-title", selection_by_title]
    if selection_with_ellipsis:
        args += ["--selection-with-ellipsis", selection_with_ellipsis]
    if new_title:
        args += ["--new-title", new_title]
    return run(*args)


def search_docs(query: str, page_size: int = 15, page_token: str = "") -> dict:
    args = ["docs", "+search", "--query", query]
    if page_size != 15:
        args += ["--page-size", str(page_size)]
    if page_token:
        args += ["--page-token", page_token]
    return run(*args)


def insert_media(doc: str, file_path: str, file_type: str = "image",
                 align: str = "center", caption: str = "") -> dict:
    args = ["docs", "+media-insert", "--doc", doc, "--file", file_path, "--type", file_type]
    if align != "center":
        args += ["--align", align]
    if caption:
        args += ["--caption", caption]
    return run(*args, timeout=120)


def update_whiteboard(whiteboard_token: str, dsl_content: str, overwrite: bool = False) -> dict:
    args = ["docs", "+whiteboard-update", "--whiteboard-token", whiteboard_token]
    if overwrite:
        args += ["--overwrite"]
    cmd = ["lark-cli", *args]
    result = sp.run(cmd, input=dsl_content, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise LarkCliError(result.stderr.strip() or "Whiteboard update failed")
    try:
        return json.loads(result.stdout)
    except Exception:
        return {"raw": result.stdout.strip()}
