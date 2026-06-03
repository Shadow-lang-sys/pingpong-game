# =============================================================
#  NEON PONG — server.py
#  Backend Python Flask + SQLite
#
#  Cài đặt:
#    pip install flask flask-cors
#
#  Chạy:
#    python server.py
#
#  Server chạy tại: http://localhost:5000
#  Frontend mở file index.html — đảm bảo cùng origin hoặc
#  Flask đã bật CORS (đã cấu hình bên dưới).
# =============================================================

import os
import time
import hashlib
import secrets
import sqlite3
import json
from functools import wraps
from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS

# ──────────────────────────────────────────────────────────────
#  CẤU HÌNH
# ──────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, "neonpong.db")
SECRET_KEY = os.environ.get("NEONPONG_SECRET", "neon-pong-super-secret-2025")

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app, supports_credentials=True)
app.config["SECRET_KEY"] = SECRET_KEY

# ──────────────────────────────────────────────────────────────
#  DATABASE HELPERS
# ──────────────────────────────────────────────────────────────

def get_db():
    """Lấy kết nối SQLite từ Flask g (per-request)."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row   # truy cập cột bằng tên
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db:
        db.close()


def query(sql, params=(), one=False, commit=False):
    """Tiện ích thực thi SQL."""
    conn = get_db()
    cur  = conn.execute(sql, params)
    if commit:
        conn.commit()
    if one:
        return cur.fetchone()
    return cur.fetchall()


# ──────────────────────────────────────────────────────────────
#  KHỞI TẠO SCHEMA
# ──────────────────────────────────────────────────────────────

SCHEMA = """
-- Bảng tài khoản người dùng
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    UNIQUE NOT NULL,
    password_hash   TEXT    NOT NULL,
    coins           INTEGER NOT NULL DEFAULT 100,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    high_streak     INTEGER NOT NULL DEFAULT 0,
    games_played    INTEGER NOT NULL DEFAULT 0,
    equipped_ball   TEXT    NOT NULL DEFAULT 'default',
    equipped_paddle TEXT    NOT NULL DEFAULT 'default',
    last_daily      INTEGER NOT NULL DEFAULT 0,
    daily_streak    INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Skin bóng / thanh đỡ đã sở hữu
CREATE TABLE IF NOT EXISTS owned_balls (
    user_id  INTEGER NOT NULL,
    skin_id  TEXT    NOT NULL,
    PRIMARY KEY (user_id, skin_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS owned_paddles (
    user_id  INTEGER NOT NULL,
    skin_id  TEXT    NOT NULL,
    PRIMARY KEY (user_id, skin_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Vật phẩm trong kho
CREATE TABLE IF NOT EXISTS powers (
    user_id   INTEGER NOT NULL,
    power_id  TEXT    NOT NULL,
    qty       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, power_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Phiên đăng nhập (token-based)
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Lịch sử trận đấu
CREATE TABLE IF NOT EXISTS match_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    result      TEXT    NOT NULL CHECK(result IN ('win','loss')),
    score_mine  INTEGER NOT NULL,
    score_opp   INTEGER NOT NULL,
    combo       INTEGER NOT NULL DEFAULT 0,
    mode        TEXT    NOT NULL DEFAULT 'ai',
    played_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bạn bè
-- status: 'pending' (chờ xác nhận) | 'accepted' (đã kết bạn)
CREATE TABLE IF NOT EXISTS friendships (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     INTEGER NOT NULL,
    to_id       INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','accepted')),
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE (from_id, to_id),
    FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE
);
-- Tin nhắn riêng giữa 2 người dùng
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     INTEGER NOT NULL,
    to_id       INTEGER NOT NULL,
    content     TEXT    NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE
);
"""

def init_db():
    """Tạo schema nếu chưa có."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA)
        # Thêm skin mặc định nếu chưa có (migration-safe)
        conn.commit()
    print(f"[DB] Database sẵn sàng tại {DB_PATH}")


# ──────────────────────────────────────────────────────────────
#  BẢO MẬT — Mật khẩu & Token
# ──────────────────────────────────────────────────────────────
SESSION_TTL = 7 * 24 * 3600   # 7 ngày

def hash_password(password: str) -> str:
    """SHA-256 + salt cố định. Production nên dùng bcrypt."""
    salt = "neonpong_salt_2025"
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(user_id: int) -> str:
    token      = generate_token()
    expires_at = int(time.time()) + SESSION_TTL
    query(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, expires_at), commit=True
    )
    # Dọn session hết hạn
    query("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),), commit=True)
    return token


def get_user_by_token(token: str):
    """Trả về Row user nếu token hợp lệ, ngược lại None."""
    if not token:
        return None
    row = query(
        """SELECT u.* FROM users u
           JOIN sessions s ON s.user_id = u.id
           WHERE s.token = ? AND s.expires_at > ?""",
        (token, int(time.time())), one=True
    )
    return row


def require_auth(f):
    """Decorator: yêu cầu token hợp lệ trong header Authorization."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        user  = get_user_by_token(token)
        if not user:
            return jsonify({"error": "Chưa đăng nhập hoặc phiên hết hạn"}), 401
        g.current_user = user
        return f(*args, **kwargs)
    return decorated


# ──────────────────────────────────────────────────────────────
#  HELPER — Lấy dữ liệu đầy đủ của user
# ──────────────────────────────────────────────────────────────

def build_user_profile(user_row) -> dict:
    uid = user_row["id"]

    balls = [r["skin_id"] for r in query(
        "SELECT skin_id FROM owned_balls WHERE user_id=?", (uid,))]
    paddles = [r["skin_id"] for r in query(
        "SELECT skin_id FROM owned_paddles WHERE user_id=?", (uid,))]
    powers_rows = query(
        "SELECT power_id, qty FROM powers WHERE user_id=? AND qty > 0", (uid,))
    powers_dict = {r["power_id"]: r["qty"] for r in powers_rows}

    # Đảm bảo luôn có 'default'
    if "default" not in balls:    balls.insert(0, "default")
    if "default" not in paddles:  paddles.insert(0, "default")

    return {
        "id":              uid,
        "username":        user_row["username"],
        "coins":           user_row["coins"],
        "wins":            user_row["wins"],
        "losses":          user_row["losses"],
        "high_streak":     user_row["high_streak"],
        "games_played":    user_row["games_played"],
        "equipped_ball":   user_row["equipped_ball"],
        "equipped_paddle": user_row["equipped_paddle"],
        "last_daily":      user_row["last_daily"],
        "daily_streak":    user_row["daily_streak"],
        "owned_balls":     balls,
        "owned_paddles":   paddles,
        "powers":          powers_dict,
    }


# ──────────────────────────────────────────────────────────────
#  ROUTES — PHỤC VỤ FILE TĨNH
# ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


# ──────────────────────────────────────────────────────────────
#  API — AUTH
# ──────────────────────────────────────────────────────────────

@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    confirm  = data.get("confirm")  or ""

    if not username or not password:
        return jsonify({"error": "Thiếu thông tin"}), 400
    if len(username) < 3:
        return jsonify({"error": "Tên đăng nhập phải có ít nhất 3 ký tự"}), 400
    if len(password) < 4:
        return jsonify({"error": "Mật khẩu phải có ít nhất 4 ký tự"}), 400
    if confirm and password != confirm:
        return jsonify({"error": "Mật khẩu không khớp"}), 400

    existing = query("SELECT id FROM users WHERE username=?", (username,), one=True)
    if existing:
        return jsonify({"error": "Tên đăng nhập đã tồn tại"}), 409

    pw_hash = hash_password(password)
    query(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, pw_hash), commit=True
    )
    user = query("SELECT * FROM users WHERE username=?", (username,), one=True)

    # Thêm skin default
    query("INSERT OR IGNORE INTO owned_balls   (user_id, skin_id) VALUES (?, 'default')", (user["id"],), commit=True)
    query("INSERT OR IGNORE INTO owned_paddles (user_id, skin_id) VALUES (?, 'default')", (user["id"],), commit=True)

    token   = create_session(user["id"])
    profile = build_user_profile(user)
    return jsonify({"token": token, "user": profile}), 201


@app.route("/api/login", methods=["POST"])
def api_login():
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Thiếu thông tin"}), 400

    user = query("SELECT * FROM users WHERE username=?", (username,), one=True)
    if not user or user["password_hash"] != hash_password(password):
        return jsonify({"error": "Sai tên đăng nhập hoặc mật khẩu"}), 401

    token   = create_session(user["id"])
    profile = build_user_profile(user)
    return jsonify({"token": token, "user": profile})


@app.route("/api/logout", methods=["POST"])
@require_auth
def api_logout():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    query("DELETE FROM sessions WHERE token=?", (token,), commit=True)
    return jsonify({"ok": True})


@app.route("/api/me", methods=["GET"])
@require_auth
def api_me():
    """Kiểm tra session còn hợp lệ không và lấy profile."""
    profile = build_user_profile(g.current_user)
    return jsonify({"user": profile})


# ──────────────────────────────────────────────────────────────
#  API — GAME RESULT  (ghi điểm sau trận)
# ──────────────────────────────────────────────────────────────

@app.route("/api/game/result", methods=["POST"])
@require_auth
def api_game_result():
    data       = request.get_json(silent=True) or {}
    result     = data.get("result")      # "win" | "loss"
    score_mine = int(data.get("score_mine", 0))
    score_opp  = int(data.get("score_opp",  0))
    combo      = int(data.get("combo", 0))
    mode       = data.get("mode", "ai")

    if result not in ("win", "loss"):
        return jsonify({"error": "result phải là 'win' hoặc 'loss'"}), 400

    uid       = g.current_user["id"]
    coins_earned = 0

    if result == "win":
        coins_earned = 50
        query("""UPDATE users SET
                   wins         = wins + 1,
                   games_played = games_played + 1,
                   coins        = coins + ?,
                   high_streak  = MAX(high_streak, ?)
                 WHERE id = ?""",
              (coins_earned, combo, uid), commit=True)
    else:
        query("""UPDATE users SET
                   losses       = losses + 1,
                   games_played = games_played + 1,
                   high_streak  = MAX(high_streak, ?)
                 WHERE id = ?""",
              (combo, uid), commit=True)

    # Ghi lịch sử
    query("""INSERT INTO match_history (user_id, result, score_mine, score_opp, combo, mode)
             VALUES (?, ?, ?, ?, ?, ?)""",
          (uid, result, score_mine, score_opp, combo, mode), commit=True)

    user    = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    profile = build_user_profile(user)
    return jsonify({"coins_earned": coins_earned, "user": profile})


# ──────────────────────────────────────────────────────────────
#  API — COINS (cộng xu khi đỡ bóng / combo)
# ──────────────────────────────────────────────────────────────

@app.route("/api/coins/add", methods=["POST"])
@require_auth
def api_coins_add():
    data   = request.get_json(silent=True) or {}
    amount = int(data.get("amount", 0))
    if amount <= 0 or amount > 100:
        return jsonify({"error": "Số xu không hợp lệ"}), 400
    uid = g.current_user["id"]
    query("UPDATE users SET coins = coins + ? WHERE id = ?", (amount, uid), commit=True)
    user = query("SELECT coins FROM users WHERE id=?", (uid,), one=True)
    return jsonify({"coins": user["coins"]})


# ──────────────────────────────────────────────────────────────
#  API — SHOP (mua skin, trang bị)
# ──────────────────────────────────────────────────────────────

# Giá cố định (mirror từ frontend — server là nguồn sự thật)
BALL_PRICES   = {"default":0,"fire":100,"neon":150,"plasma":250,"star":300,"void":500}
PADDLE_PRICES = {"default":0,"cyan":80,"hot":120,"gold":200,"matrix":180}
POWER_PRICES  = {"big_paddle":50,"slow_ball":60,"fast_serve":40}


@app.route("/api/shop/buy/ball", methods=["POST"])
@require_auth
def api_buy_ball():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    if skin_id not in BALL_PRICES:
        return jsonify({"error": "Skin không tồn tại"}), 404
    uid   = g.current_user["id"]
    price = BALL_PRICES[skin_id]

    # Kiểm tra đã sở hữu chưa
    owned = query("SELECT 1 FROM owned_balls WHERE user_id=? AND skin_id=?", (uid, skin_id), one=True)
    if owned:
        return jsonify({"error": "Bạn đã sở hữu skin này"}), 409

    user = query("SELECT coins FROM users WHERE id=?", (uid,), one=True)
    if user["coins"] < price:
        return jsonify({"error": "Không đủ xu"}), 402

    query("UPDATE users SET coins = coins - ? WHERE id = ?", (price, uid), commit=True)
    query("INSERT INTO owned_balls (user_id, skin_id) VALUES (?, ?)", (uid, skin_id), commit=True)
    # Tự động trang bị
    query("UPDATE users SET equipped_ball = ? WHERE id = ?", (skin_id, uid), commit=True)

    user    = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    profile = build_user_profile(user)
    return jsonify({"user": profile})


@app.route("/api/shop/equip/ball", methods=["POST"])
@require_auth
def api_equip_ball():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    uid     = g.current_user["id"]
    owned   = query("SELECT 1 FROM owned_balls WHERE user_id=? AND skin_id=?", (uid, skin_id), one=True)
    if not owned:
        return jsonify({"error": "Bạn chưa sở hữu skin này"}), 403
    query("UPDATE users SET equipped_ball = ? WHERE id = ?", (skin_id, uid), commit=True)
    return jsonify({"equipped_ball": skin_id})


@app.route("/api/shop/buy/paddle", methods=["POST"])
@require_auth
def api_buy_paddle():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    if skin_id not in PADDLE_PRICES:
        return jsonify({"error": "Skin không tồn tại"}), 404
    uid   = g.current_user["id"]
    price = PADDLE_PRICES[skin_id]

    owned = query("SELECT 1 FROM owned_paddles WHERE user_id=? AND skin_id=?", (uid, skin_id), one=True)
    if owned:
        return jsonify({"error": "Bạn đã sở hữu skin này"}), 409

    user = query("SELECT coins FROM users WHERE id=?", (uid,), one=True)
    if user["coins"] < price:
        return jsonify({"error": "Không đủ xu"}), 402

    query("UPDATE users SET coins = coins - ? WHERE id = ?", (price, uid), commit=True)
    query("INSERT INTO owned_paddles (user_id, skin_id) VALUES (?, ?)", (uid, skin_id), commit=True)
    query("UPDATE users SET equipped_paddle = ? WHERE id = ?", (skin_id, uid), commit=True)

    user    = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    profile = build_user_profile(user)
    return jsonify({"user": profile})


@app.route("/api/shop/equip/paddle", methods=["POST"])
@require_auth
def api_equip_paddle():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    uid     = g.current_user["id"]
    owned   = query("SELECT 1 FROM owned_paddles WHERE user_id=? AND skin_id=?", (uid, skin_id), one=True)
    if not owned:
        return jsonify({"error": "Bạn chưa sở hữu skin này"}), 403
    query("UPDATE users SET equipped_paddle = ? WHERE id = ?", (skin_id, uid), commit=True)
    return jsonify({"equipped_paddle": skin_id})


@app.route("/api/shop/buy/power", methods=["POST"])
@require_auth
def api_buy_power():
    power_id = (request.get_json(silent=True) or {}).get("power_id", "")
    if power_id not in POWER_PRICES:
        return jsonify({"error": "Vật phẩm không tồn tại"}), 404
    uid   = g.current_user["id"]
    price = POWER_PRICES[power_id]

    user = query("SELECT coins FROM users WHERE id=?", (uid,), one=True)
    if user["coins"] < price:
        return jsonify({"error": "Không đủ xu"}), 402

    query("UPDATE users SET coins = coins - ? WHERE id = ?", (price, uid), commit=True)
    query("""INSERT INTO powers (user_id, power_id, qty) VALUES (?, ?, 1)
             ON CONFLICT(user_id, power_id) DO UPDATE SET qty = qty + 1""",
          (uid, power_id), commit=True)

    user    = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    profile = build_user_profile(user)
    return jsonify({"user": profile})


@app.route("/api/shop/use/power", methods=["POST"])
@require_auth
def api_use_power():
    power_id = (request.get_json(silent=True) or {}).get("power_id", "")
    uid      = g.current_user["id"]
    row      = query("SELECT qty FROM powers WHERE user_id=? AND power_id=?", (uid, power_id), one=True)
    if not row or row["qty"] <= 0:
        return jsonify({"error": "Không có vật phẩm này"}), 400
    query("UPDATE powers SET qty = qty - 1 WHERE user_id=? AND power_id=?", (uid, power_id), commit=True)
    user    = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    profile = build_user_profile(user)
    return jsonify({"user": profile})


# ──────────────────────────────────────────────────────────────
#  API — DAILY REWARD
# ──────────────────────────────────────────────────────────────

ONE_DAY = 86400   # giây

@app.route("/api/daily", methods=["POST"])
@require_auth
def api_daily():
    uid  = g.current_user["id"]
    user = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    now  = int(time.time())

    if now - user["last_daily"] < ONE_DAY:
        remain = ONE_DAY - (now - user["last_daily"])
        h = remain // 3600
        m = (remain % 3600) // 60
        return jsonify({"error": f"Đã nhận hôm nay. Còn {h}h {m}m"}), 429

    streak = (user["daily_streak"] or 0) + 1
    bonus  = 30 + streak * 5

    query("""UPDATE users SET
               coins        = coins + ?,
               last_daily   = ?,
               daily_streak = ?
             WHERE id = ?""",
          (bonus, now, streak, uid), commit=True)

    user    = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    profile = build_user_profile(user)
    return jsonify({"bonus": bonus, "streak": streak, "user": profile})


# ──────────────────────────────────────────────────────────────
#  API — LEADERBOARD
# ──────────────────────────────────────────────────────────────

@app.route("/api/leaderboard", methods=["GET"])
def api_leaderboard():
    rows = query("""SELECT username, wins, losses, coins, high_streak, games_played
                    FROM users ORDER BY wins DESC LIMIT 20""")
    board = [dict(r) for r in rows]
    return jsonify({"leaderboard": board})


# ──────────────────────────────────────────────────────────────
#  API — MATCH HISTORY
# ──────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
@require_auth
def api_history():
    uid  = g.current_user["id"]
    rows = query("""SELECT result, score_mine, score_opp, combo, mode, played_at
                    FROM match_history WHERE user_id=?
                    ORDER BY played_at DESC LIMIT 20""", (uid,))
    history = [dict(r) for r in rows]
    return jsonify({"history": history})


# ──────────────────────────────────────────────────────────────
#  API — FRIENDS
# ──────────────────────────────────────────────────────────────

def mini_profile(row) -> dict:
    """Profile tóm gọn để trả về trong danh sách bạn bè."""
    return {
        "username":    row["username"],
        "wins":        row["wins"],
        "coins":       row["coins"],
        "high_streak": row["high_streak"],
        "games_played":row["games_played"],
    }


@app.route("/api/friends", methods=["GET"])
@require_auth
def api_friends():
    uid = g.current_user["id"]

    # Danh sách bạn đã accepted (cả hai chiều)
    rows = query("""
        SELECT u.username, u.wins, u.coins, u.high_streak, u.games_played
        FROM friendships f
        JOIN users u ON (
            CASE WHEN f.from_id = ? THEN f.to_id ELSE f.from_id END = u.id
        )
        WHERE (f.from_id = ? OR f.to_id = ?) AND f.status = 'accepted'
    """, (uid, uid, uid))
    friends = [mini_profile(r) for r in rows]

    # Lời mời tôi đã GỬI đi, đang pending
    sent_rows = query("""
        SELECT u.username, u.wins FROM friendships f
        JOIN users u ON f.to_id = u.id
        WHERE f.from_id = ? AND f.status = 'pending'
    """, (uid,))
    sent = [{"username": r["username"], "wins": r["wins"]} for r in sent_rows]

    # Lời mời tôi NHẬN được, đang pending
    recv_rows = query("""
        SELECT u.username, u.wins FROM friendships f
        JOIN users u ON f.from_id = u.id
        WHERE f.to_id = ? AND f.status = 'pending'
    """, (uid,))
    received = [{"username": r["username"], "wins": r["wins"]} for r in recv_rows]

    return jsonify({"friends": friends, "sent": sent, "received": received})


@app.route("/api/friends/request", methods=["POST"])
@require_auth
def api_friend_request():
    to_username = (request.get_json(silent=True) or {}).get("to_username", "").strip()
    uid         = g.current_user["id"]

    if not to_username:
        return jsonify({"error": "Thiếu username"}), 400
    if to_username == g.current_user["username"]:
        return jsonify({"error": "Không thể kết bạn với chính mình"}), 400

    target = query("SELECT id FROM users WHERE username=?", (to_username,), one=True)
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid = target["id"]

    # Kiểm tra đã có quan hệ chưa
    existing = query("""
        SELECT status FROM friendships
        WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)
    """, (uid, tid, tid, uid), one=True)

    if existing:
        if existing["status"] == "accepted":
            return jsonify({"error": "Đã là bạn bè rồi"}), 409
        return jsonify({"error": "Lời mời đã tồn tại"}), 409

    query("INSERT INTO friendships (from_id, to_id) VALUES (?, ?)", (uid, tid), commit=True)
    return jsonify({"ok": True})


@app.route("/api/friends/respond", methods=["POST"])
@require_auth
def api_friend_respond():
    data          = request.get_json(silent=True) or {}
    from_username = data.get("from_username", "").strip()
    accept        = bool(data.get("accept", False))
    uid           = g.current_user["id"]

    sender = query("SELECT id FROM users WHERE username=?", (from_username,), one=True)
    if not sender:
        return jsonify({"error": "Người dùng không tồn tại"}), 404

    frow = query("""SELECT id FROM friendships WHERE from_id=? AND to_id=? AND status='pending'""",
                 (sender["id"], uid), one=True)
    if not frow:
        return jsonify({"error": "Không tìm thấy lời mời"}), 404

    if accept:
        query("UPDATE friendships SET status='accepted' WHERE id=?", (frow["id"],), commit=True)
    else:
        query("DELETE FROM friendships WHERE id=?", (frow["id"],), commit=True)

    return jsonify({"ok": True, "accepted": accept})


@app.route("/api/friends/remove", methods=["POST"])
@require_auth
def api_friend_remove():
    username = (request.get_json(silent=True) or {}).get("username", "").strip()
    uid      = g.current_user["id"]

    target = query("SELECT id FROM users WHERE username=?", (username,), one=True)
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid = target["id"]

    query("""DELETE FROM friendships
             WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)""",
          (uid, tid, tid, uid), commit=True)
    return jsonify({"ok": True})


# ──────────────────────────────────────────────────────────────
#  API — USER PROFILE & SEARCH
# ──────────────────────────────────────────────────────────────

@app.route("/api/profile/<username>", methods=["GET"])
@require_auth
def api_profile(username):
    row = query("SELECT * FROM users WHERE username=?", (username,), one=True)
    if not row:
        return jsonify({"error": "Không tìm thấy người dùng"}), 404
    return jsonify({"profile": {
        "username":    row["username"],
        "wins":        row["wins"],
        "losses":      row["losses"],
        "coins":       row["coins"],
        "high_streak": row["high_streak"],
        "games_played":row["games_played"],
        "created_at":  row["created_at"],
    }})


@app.route("/api/users/search", methods=["GET"])
@require_auth
def api_users_search():
    q   = request.args.get("q", "").strip()
    uid = g.current_user["id"]
    if not q or len(q) < 2:
        return jsonify({"users": []})
    rows = query("""
        SELECT username, wins, coins FROM users
        WHERE username LIKE ? AND id != ?
        LIMIT 10
    """, (f"%{q}%", uid))
    return jsonify({"users": [dict(r) for r in rows]})

# ──────────────────────────────────────────────────────────────
#  API — CHAT (Direct Message)
# ──────────────────────────────────────────────────────────────

MAX_MSG_LEN = 300

@app.route("/api/chat/send", methods=["POST"])
@require_auth
def api_chat_send():
    data    = request.get_json(silent=True) or {}
    to_user = (data.get("to_username") or "").strip()
    content = (data.get("content")     or "").strip()
    uid     = g.current_user["id"]

    if not to_user or not content:
        return jsonify({"error": "Thiếu thông tin"}), 400
    if len(content) > MAX_MSG_LEN:
        return jsonify({"error": f"Tin nhắn tối đa {MAX_MSG_LEN} ký tự"}), 400

    target = query("SELECT id FROM users WHERE username=?", (to_user,), one=True)
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid = target["id"]

    if tid == uid:
        return jsonify({"error": "Không thể nhắn tin cho chính mình"}), 400

    # Kiểm tra 2 người có phải bạn bè không
    friends = query("""
        SELECT 1 FROM friendships
        WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))
          AND status='accepted'
    """, (uid, tid, tid, uid), one=True)
    if not friends:
        return jsonify({"error": "Chỉ có thể nhắn tin với bạn bè"}), 403

    query("INSERT INTO messages (from_id, to_id, content) VALUES (?,?,?)",
          (uid, tid, content), commit=True)

    msg_id = query("SELECT last_insert_rowid() as id", one=True)["id"]
    return jsonify({"ok": True, "msg_id": msg_id, "created_at": int(time.time())})


@app.route("/api/chat/history/<username>", methods=["GET"])
@require_auth
def api_chat_history(username):
    uid    = g.current_user["id"]
    target = query("SELECT id FROM users WHERE username=?", (username,), one=True)
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid = target["id"]

    # Lấy 50 tin nhắn gần nhất giữa 2 người
    rows = query("""
        SELECT m.id, m.content, m.created_at, m.is_read,
               uf.username AS from_username,
               ut.username AS to_username
        FROM messages m
        JOIN users uf ON m.from_id = uf.id
        JOIN users ut ON m.to_id   = ut.id
        WHERE (m.from_id=? AND m.to_id=?) OR (m.from_id=? AND m.to_id=?)
        ORDER BY m.created_at ASC
        LIMIT 50
    """, (uid, tid, tid, uid))

    # Đánh dấu đã đọc các tin nhắn của đối phương gửi cho mình
    query("UPDATE messages SET is_read=1 WHERE from_id=? AND to_id=? AND is_read=0",
          (tid, uid), commit=True)

    messages = [{
        "id":           r["id"],
        "from":         r["from_username"],
        "content":      r["content"],
        "created_at":   r["created_at"],
        "is_read":      bool(r["is_read"]),
    } for r in rows]

    return jsonify({"messages": messages})


@app.route("/api/chat/unread", methods=["GET"])
@require_auth
def api_chat_unread():
    """Trả về số tin nhắn chưa đọc theo từng người gửi."""
    uid  = g.current_user["id"]
    rows = query("""
        SELECT u.username, COUNT(*) as cnt
        FROM messages m
        JOIN users u ON m.from_id = u.id
        WHERE m.to_id=? AND m.is_read=0
        GROUP BY m.from_id
    """, (uid,))
    unread = {r["username"]: r["cnt"] for r in rows}
    total  = sum(unread.values())
    return jsonify({"unread": unread, "total": total})


@app.route("/api/chat/conversations", methods=["GET"])
@require_auth
def api_chat_conversations():
    """Danh sách hội thoại: mỗi người bạn bè + tin nhắn mới nhất + số chưa đọc."""
    uid = g.current_user["id"]
    rows = query("""
        SELECT
            u.username,
            u.wins,
            (SELECT content FROM messages
             WHERE (from_id=u.id AND to_id=?) OR (from_id=? AND to_id=u.id)
             ORDER BY created_at DESC LIMIT 1) AS last_msg,
            (SELECT created_at FROM messages
             WHERE (from_id=u.id AND to_id=?) OR (from_id=? AND to_id=u.id)
             ORDER BY created_at DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*) FROM messages
             WHERE from_id=u.id AND to_id=? AND is_read=0) AS unread
        FROM friendships f
        JOIN users u ON (
            CASE WHEN f.from_id=? THEN f.to_id ELSE f.from_id END = u.id
        )
        WHERE (f.from_id=? OR f.to_id=?) AND f.status='accepted'
        ORDER BY last_at DESC NULLS LAST
    """, (uid, uid, uid, uid, uid, uid, uid, uid))

    convos = [{
        "username": r["username"],
        "wins":     r["wins"],
        "last_msg": r["last_msg"] or "",
        "last_at":  r["last_at"]  or 0,
        "unread":   r["unread"]   or 0,
    } for r in rows]
    return jsonify({"conversations": convos})
def api_admin_users():
    secret = request.args.get("secret", "")
    if secret != SECRET_KEY:
        return jsonify({"error": "Forbidden"}), 403
    rows = query("SELECT id, username, coins, wins, losses, games_played FROM users ORDER BY id")
    return jsonify({"users": [dict(r) for r in rows]})


# ──────────────────────────────────────────────────────────────
#  HEALTH CHECK
# ──────────────────────────────────────────────────────────────

@app.route("/api/ping", methods=["GET"])
def api_ping():
    return jsonify({"status": "ok", "time": int(time.time())})


# ──────────────────────────────────────────────────────────────
#  KHỞI ĐỘNG
# ──────────────────────────────────────────────────────────────

# Chạy init_db() ngay khi module được load
# (gunicorn import module này nên init_db chạy trước mọi request)
init_db()

if __name__ == "__main__":
    print("=" * 55)
    print("  NEON PONG SERVER  —  http://localhost:5000")
    print("  Nhấn Ctrl+C để dừng")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=True)
