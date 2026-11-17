#!/usr/bin/env python3
# kinbot のツールを、コネクタを使わずに呼ぶための小さなプログラム（Claude のスキル用・2026-11-18）
#   使い方：
#     python3 kinbot.py tools <kinbot|kincall|kinxs>
#     python3 kinbot.py call  <kinbot|kincall|kinxs> <ツール名> '<JSON>'
#   合言葉（token）と kinbot の場所（base）は、スキルのフォルダの config.json にある。
import json, os, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATHS = [os.path.join(HERE, "..", "config.json"), os.path.join(HERE, "config.json")]
PATHS = {"kinbot": "/mcp", "kincall": "/kincall/mcp", "kinxs": "/kinxs/mcp"}


def load_cfg():
    for p in CFG_PATHS:
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    sys.exit("config.json が見つかりません。kinbot の設定からスキルをダウンロードし直してください。")


def rpc(server, method, params=None):
    cfg = load_cfg()
    if server not in PATHS:
        sys.exit(f"つなぎ先は kinbot / kincall / kinxs のどれかです（{server}）")
    url = cfg["base"].rstrip("/") + PATHS[server]
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "content-type": "application/json", "accept": "application/json",
        "authorization": "Bearer " + cfg["token"], "user-agent": "kinbot-skill/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")[:300]
        if e.code == 401:
            sys.exit("認証に失敗しました。合言葉の期限切れか、無効にされています。kinbot の設定 → 連携 → Claude から、スキルをダウンロードし直してください。")
        sys.exit(f"kinbot からエラーが返りました（{e.code}）：{txt}")
    except urllib.error.URLError as e:
        sys.exit(f"kinbot に接続できません（{e.reason}）。組織の管理者に、Claude のコード実行の通信許可へ {cfg['base']} のドメインを足してもらってください。")
    if isinstance(data, dict) and data.get("error"):
        sys.exit("エラー：" + str(data["error"].get("message", data["error"])))
    return (data or {}).get("result", {})


def main():
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == "tools":
        for t in rpc(a[1], "tools/list").get("tools", []):
            props = ((t.get("inputSchema") or {}).get("properties") or {})
            req = set(((t.get("inputSchema") or {}).get("required") or []))
            args = ", ".join(f"{k}{'*' if k in req else ''}" for k in props)
            print(f"■ {t.get('name')}（{args}）\n  {str(t.get('description', '')).strip()[:400]}\n")
        return
    if len(a) >= 3 and a[0] == "call":
        try:
            args = json.loads(a[3]) if len(a) >= 4 and a[3].strip() else {}
        except json.JSONDecodeError as e:
            sys.exit(f"入れる値が JSON になっていません：{e}")
        res = rpc(a[1], "tools/call", {"name": a[2], "arguments": args})
        for c in res.get("content", []):
            if c.get("type") == "text":
                print(c.get("text", ""))
            else:
                print(json.dumps(c, ensure_ascii=False))
        if res.get("isError"):
            sys.exit(1)
        return
    print(__doc__ or "", "使い方：\n  python3 kinbot.py tools <kinbot|kincall|kinxs>\n  python3 kinbot.py call <kinbot|kincall|kinxs> <ツール名> '<JSON>'")


if __name__ == "__main__":
    main()
