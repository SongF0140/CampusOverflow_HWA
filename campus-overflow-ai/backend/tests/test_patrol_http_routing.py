"""完整应用、真实TCP与测试库：静态扫描路径不会被单段UUID路由截获。"""
import json
import socket
import threading
import time
from contextlib import contextmanager
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import uvicorn
from test_approval_requests import setup as setup  # noqa: F401
from test_patrol_workflow_roots import BASE
from test_patrol_workflow_roots import headers as headers  # noqa: F401

from app.main import app


@contextmanager
def live_app():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, log_level="error", access_log=False, lifespan="off")
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.02)
        assert server.started
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(3)
        assert not thread.is_alive()
        sock.close()


def test_full_scan_and_uuid_resource_routes_over_real_http(setup, headers):
    with live_app() as base:
        def request(path, body=None):
            req = Request(
                base + BASE + path,
                headers={**headers, "Content-Type": "application/json"},
                data=json.dumps(body).encode() if body is not None else None,
            )
            try:
                response = urlopen(req, timeout=3)
            except HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response)

        status, page = request("/scan/page")
        assert status == 200 and "items" in page["data"]
        assert request("/scan/page", {"revision": page["data"]["revision"]})[0] == 200
        status, root = request("", {"target_type": "question", "target_id": setup["question"].id})
        assert status == 200
        assert request("/" + root["data"]["task_id"])[0] == 200
        status, error = request("/scan")
        assert status == 400 and "task_id" in error["message"]
