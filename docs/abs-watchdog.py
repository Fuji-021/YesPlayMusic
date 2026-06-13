#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ABS 下载卡死兜底 watchdog —— 通用双模式（飞牛 NAS），零第三方依赖，仅 Python 标准库。

背景：Audiobookshelf 播客下载单线程逐集、无硬超时。某集源(如喜马拉雅 CDN)出现
"连上但不吐数据"的半开连接 → 请求无限挂起、既不成功也不失败 → 跳过/重试不触发 →
唯一下载槽被僵尸请求占死 → 整队瘫痪(实测卡 9.9 小时)。应用层关不掉，故外部兜底：
定时探测 → 判卡死 → 重启 ABS 容器 → 重新入队(已下集自动跳过、幂等)。

两种部署，二选一：

【A. Docker 容器常驻（推荐，飞牛面板可管）】见同目录 docker-compose.watchdog.yml：
  - 不用自建镜像，直接用官方 python:slim
  - 重启 ABS 走挂载的 /var/run/docker.sock（容器内无需 docker 命令）
  - 配置全走环境变量，INTERVAL_SECONDS>0 时脚本内置循环常驻

【B. 宿主 cron 单次（备选）】
  - 把本文件放 NAS，如 /vol1/1000/PodPlayer/abs-watchdog.py
  - token 写文件：echo '你的token' > /vol1/1000/PodPlayer/watchdog/abs.token && chmod 600 它
  - 设 INTERVAL_SECONDS=0（默认就是单次），cron 每 20 分钟：
      */20 * * * * ABS_TOKEN=$(cat /vol1/.../abs.token) /usr/bin/python3 /vol1/.../abs-watchdog.py
  - 宿主有 docker 命令时也可，本脚本统一用 docker.sock API，无需 docker CLI

⚠️ 安全：挂载 docker.sock = 给该容器宿主 root 等价权限（用于重启 ABS）。个人自用 NAS
   可接受；token 放挂载目录的 600 文件或环境变量，不写进脚本、不进 git。
"""

import os
import sys
import json
import time
import socket
import http.client
import urllib.request
from datetime import datetime


def env(k, d=None):
    v = os.environ.get(k)
    return v if v not in (None, "") else d


# ========== 配置（容器走环境变量；宿主可改这里的默认值） ==========
ABS_BASE = env("ABS_BASE", "http://192.168.2.108:13378/audiobookshelf")   # 容器内用宿主局域网 IP；宿主本地可用 127.0.0.1
LIBRARY_ID = env("LIBRARY_ID", "c4379a59-72a4-4b8f-8f89-5170602f8469")
CONTAINER = env("ABS_CONTAINER", "audiobookshelf")     # ABS 容器名，先用 `docker ps` 核实
DOCKER_SOCK = env("DOCKER_SOCK", "/var/run/docker.sock")
STALL_MINUTES = float(env("STALL_MINUTES", "30"))      # currentDownload 存活超此分钟数 → 判卡死
INTERVAL_SECONDS = int(env("INTERVAL_SECONDS", "0"))   # >0=内置循环常驻(容器)；0=跑一次即退出(cron)
MAX_RESTARTS_PER_DAY = int(env("MAX_RESTARTS_PER_DAY", "4"))   # 防重启风暴
KEEP_PER_PODCAST = int(env("KEEP_PER_PODCAST", "100"))
TOKEN_FILE = env("TOKEN_FILE", "/config/abs.token")
STATE_FILE = env("STATE_FILE", "/config/watchdog.state.json")
LOG_FILE = env("LOG_FILE", "/config/watchdog.log")
# ================================================================


def log(msg):
    line = "[%s] %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def get_token():
    t = env("ABS_TOKEN")
    if t:
        return t
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return None


def api(path, token, method="GET", body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(ABS_BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8", "replace")
        try:
            return r.status, json.loads(raw)
        except Exception:
            return r.status, raw


def docker_restart_via_socket(name):
    """走 /var/run/docker.sock 调 Docker Engine API 重启容器，不依赖 docker CLI。204=成功。"""
    class UDSConnection(http.client.HTTPConnection):
        def connect(self):
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(120)
            s.connect(DOCKER_SOCK)
            self.sock = s
    conn = UDSConnection("localhost", timeout=120)
    conn.request("POST", "/v1.41/containers/%s/restart?t=10" % name)
    resp = conn.getresponse()
    resp.read()
    conn.close()
    return resp.status


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(s):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(s, f)
    except Exception:
        pass


def restarts_today(state):
    today = datetime.now().strftime("%Y-%m-%d")
    return state.get("restarts", {}).get(today, 0)


def bump_restart(state):
    today = datetime.now().strftime("%Y-%m-%d")
    cnt = state.get("restarts", {}).get(today, 0) + 1
    state["restarts"] = {today: cnt}   # 只留今天，自动清旧
    save_state(state)
    return cnt


def wait_healthy(max_wait=180):
    waited = 0
    while waited < max_wait:
        time.sleep(5)
        waited += 5
        try:
            with urllib.request.urlopen(ABS_BASE + "/healthcheck", timeout=5) as r:
                if r.status == 200:
                    return waited
        except Exception:
            continue
    return None


def requeue_all(token):
    try:
        _, items = api("/api/libraries/%s/items?limit=300" % LIBRARY_ID, token)
        arr = (items.get("results") or items.get("items") or []) if isinstance(items, dict) else []
    except Exception as e:
        log("取节目列表失败: %s" % e)
        return 0
    done = 0
    for it in arr:
        iid = it.get("id")
        if not iid:
            continue
        try:
            api("/api/items/%s/media" % iid, token, method="PATCH",
                body={"lastEpisodeCheck": 1, "autoDownloadEpisodes": True, "maxEpisodesToKeep": KEEP_PER_PODCAST})
            api("/api/podcasts/%s/checknew?limit=%d" % (iid, KEEP_PER_PODCAST), token)
            done += 1
            time.sleep(0.5)
        except Exception as e:
            title = (it.get("media", {}).get("metadata", {}) or {}).get("title", "?")
            log("  入队失败 %s: %s" % (title, e))
    return done


def run_once():
    token = get_token()
    if not token:
        log("无 token（设 ABS_TOKEN 环境变量或 %s 文件）。" % TOKEN_FILE)
        return
    try:
        _, dl = api("/api/libraries/%s/episode-downloads" % LIBRARY_ID, token)
    except Exception as e:
        log("查询下载队列失败（ABS 可能正在启动，下轮再试）: %s" % e)
        return
    cur = dl.get("currentDownload") if isinstance(dl, dict) else None
    qlen = len(dl.get("queue", [])) if isinstance(dl, dict) else 0
    if not cur:
        log("OK：无当前下载（队列 %d）。空闲或已下完。" % qlen)
        return
    age_min = (time.time() * 1000 - cur.get("createdAt", time.time() * 1000)) / 60000.0
    pod = cur.get("podcastTitle", "?")
    title = cur.get("episodeDisplayTitle", "?")
    if age_min < STALL_MINUTES:
        log("OK：正在下「%s / %s」age=%.0fmin 队列 %d（阈值 %dmin 内）" % (pod, title, age_min, qlen, STALL_MINUTES))
        return

    log("⚠️ 卡死判定：「%s / %s」已 %.0f 分钟未完成、队列 %d 堵塞。" % (pod, title, age_min, qlen))
    state = load_state()
    if restarts_today(state) >= MAX_RESTARTS_PER_DAY:
        log("⛔ 今日自动重启已达上限 %d 次 → 疑似源/网络持续异常，停手等人工。" % MAX_RESTARTS_PER_DAY)
        return
    log("→ 通过 docker.sock 重启容器 %s ..." % CONTAINER)
    try:
        st = docker_restart_via_socket(CONTAINER)
        if st not in (204, 304):
            log("docker restart 返回异常状态 %s（确认容器名/挂载 docker.sock）" % st)
            return
    except Exception as e:
        log("docker restart 失败（确认已挂载 %s）: %s" % (DOCKER_SOCK, e))
        return
    cnt = bump_restart(state)
    waited = wait_healthy()
    if waited is None:
        log("等待 ABS 恢复超时(180s)，本轮不入队，下轮再补。")
        return
    log("ABS 已恢复（%ds）。重新入队 ..." % waited)
    time.sleep(5)
    done = requeue_all(token)
    log("✅ 重启+重新入队完成：处理 %d 档。今日已自动重启 %d 次。" % (done, cnt))


def main():
    if INTERVAL_SECONDS > 0:
        log("watchdog 循环模式启动：每 %ds 探测一次（ABS_BASE=%s 容器=%s 阈值=%dmin）" %
            (INTERVAL_SECONDS, ABS_BASE, CONTAINER, STALL_MINUTES))
        while True:
            try:
                run_once()
            except Exception as e:
                log("本轮异常（已捕获，继续循环）: %s" % e)
            time.sleep(INTERVAL_SECONDS)
    else:
        run_once()


if __name__ == "__main__":
    main()
