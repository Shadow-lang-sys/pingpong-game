# =============================================================
#  NEON PONG — server.py
#  Backend Python Flask + PostgreSQL (Render miễn phí)
#
#  Cài đặt local:
#    pip install flask flask-cors psycopg2-binary
#
#  Biến môi trường cần thiết trên Render:
#    DATABASE_URL  = postgresql://... (tự động từ Render Postgres)
#    NEONPONG_SECRET = chuỗi bí mật bất kỳ
# =============================================================

import os
import time
import hashlib
import secrets
from functools import wraps
from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS
import psycopg2
import psycopg2.extras

# ──────────────────────────────────────────────────────────────
#  CẤU HÌNH
# ──────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.environ.get("DATABASE_URL", "")
SECRET_KEY   = os.environ.get("NEONPONG_SECRET", "neon-pong-super-secret-2025")

# Render đôi khi trả về "postgres://" — psycopg2 cần "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app, supports_credentials=True)
app.config["SECRET_KEY"] = SECRET_KEY

# ──────────────────────────────────────────────────────────────
#  DATABASE HELPERS (PostgreSQL)
# ──────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = psycopg2.connect(
            DATABASE_URL,
            cursor_factory=psycopg2.extras.RealDictCursor
        )
        g.db.autocommit = False
    return g.db

@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db:
        if error:
            db.rollback()
        db.close()

def query(sql, params=(), one=False, commit=False):
    sql  = sql.replace("?", "%s")
    conn = get_db()
    cur  = conn.cursor()
    cur.execute(sql, params)
    if commit:
        conn.commit()
    try:
        rows = cur.fetchall()
        if one:
            return rows[0] if rows else None
        return rows
    except psycopg2.ProgrammingError:
        return None

def query_one(sql, params=()):
    return query(sql, params, one=True)

# ──────────────────────────────────────────────────────────────
#  SCHEMA — tạo bảng nếu chưa có
# ──────────────────────────────────────────────────────────────

def init_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    cur  = conn.cursor()
    statements = [
        """CREATE TABLE IF NOT EXISTS users (
            id              SERIAL PRIMARY KEY,
            username        TEXT    UNIQUE NOT NULL,
            password_hash   TEXT    NOT NULL,
            coins           INTEGER NOT NULL DEFAULT 100,
            wins            INTEGER NOT NULL DEFAULT 0,
            losses          INTEGER NOT NULL DEFAULT 0,
            high_streak     INTEGER NOT NULL DEFAULT 0,
            games_played    INTEGER NOT NULL DEFAULT 0,
            equipped_ball   TEXT    NOT NULL DEFAULT 'default',
            equipped_paddle TEXT    NOT NULL DEFAULT 'default',
            last_daily      BIGINT  NOT NULL DEFAULT 0,
            daily_streak    INTEGER NOT NULL DEFAULT 0,
            created_at      BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
        )""",
        """CREATE TABLE IF NOT EXISTS owned_balls (
            user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            skin_id  TEXT    NOT NULL,
            PRIMARY KEY (user_id, skin_id)
        )""",
        """CREATE TABLE IF NOT EXISTS owned_paddles (
            user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            skin_id  TEXT    NOT NULL,
            PRIMARY KEY (user_id, skin_id)
        )""",
        """CREATE TABLE IF NOT EXISTS powers (
            user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            power_id  TEXT    NOT NULL,
            qty       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, power_id)
        )""",
        """CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT    PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
            expires_at BIGINT  NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS match_history (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            result      TEXT    NOT NULL CHECK(result IN ('win','loss')),
            score_mine  INTEGER NOT NULL,
            score_opp   INTEGER NOT NULL,
            combo       INTEGER NOT NULL DEFAULT 0,
            mode        TEXT    NOT NULL DEFAULT 'ai',
            played_at   BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
        )""",
        """CREATE TABLE IF NOT EXISTS friendships (
            id         SERIAL PRIMARY KEY,
            from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status     TEXT    NOT NULL DEFAULT 'pending'
                               CHECK(status IN ('pending','accepted')),
            created_at BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
            UNIQUE (from_id, to_id)
        )""",
        """CREATE TABLE IF NOT EXISTS messages (
            id         SERIAL PRIMARY KEY,
            from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content    TEXT    NOT NULL,
            is_read    BOOLEAN NOT NULL DEFAULT FALSE,
            created_at BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
        )""",
    ]
    for stmt in statements:
        cur.execute(stmt)
    conn.commit()
    cur.close()
    conn.close()
    print("[DB] PostgreSQL schema sẵn sàng ✅")

# ──────────────────────────────────────────────────────────────
#  BẢO MẬT
# ──────────────────────────────────────────────────────────────
SESSION_TTL = 7 * 24 * 3600

def hash_password(password: str) -> str:
    salt = "neonpong_salt_2025"
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()

def generate_token() -> str:
    return secrets.token_urlsafe(32)

def create_session(user_id: int) -> str:
    token      = generate_token()
    expires_at = int(time.time()) + SESSION_TTL
    query("INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
          (token, user_id, expires_at), commit=True)
    query("DELETE FROM sessions WHERE expires_at < %s", (int(time.time()),), commit=True)
    return token

def get_user_by_token(token: str):
    if not token:
        return None
    rows = query(
        """SELECT u.* FROM users u
           JOIN sessions s ON s.user_id = u.id
           WHERE s.token = %s AND s.expires_at > %s""",
        (token, int(time.time()))
    )
    return rows[0] if rows else None

def require_auth(f):
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
#  HELPER — build profile
# ──────────────────────────────────────────────────────────────

def build_user_profile(user_row) -> dict:
    uid = user_row["id"]
    balls   = [r["skin_id"] for r in (query("SELECT skin_id FROM owned_balls WHERE user_id=%s", (uid,)) or [])]
    paddles = [r["skin_id"] for r in (query("SELECT skin_id FROM owned_paddles WHERE user_id=%s", (uid,)) or [])]
    pw_rows = query("SELECT power_id, qty FROM powers WHERE user_id=%s AND qty > 0", (uid,)) or []
    powers  = {r["power_id"]: r["qty"] for r in pw_rows}
    if "default" not in balls:   balls.insert(0, "default")
    if "default" not in paddles: paddles.insert(0, "default")
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
        "powers":          powers,
    }

# ──────────────────────────────────────────────────────────────
#  ROUTES — FILE TĨNH
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
    data     = request.get_json(silent=True) or {}
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
    existing = query_one("SELECT id FROM users WHERE username=%s", (username,))
    if existing:
        return jsonify({"error": "Tên đăng nhập đã tồn tại"}), 409
    pw_hash = hash_password(password)
    query("INSERT INTO users (username, password_hash) VALUES (%s, %s)", (username, pw_hash), commit=True)
    user = query_one("SELECT * FROM users WHERE username=%s", (username,))
    query("INSERT INTO owned_balls   (user_id, skin_id) VALUES (%s, 'default') ON CONFLICT DO NOTHING", (user["id"],), commit=True)
    query("INSERT INTO owned_paddles (user_id, skin_id) VALUES (%s, 'default') ON CONFLICT DO NOTHING", (user["id"],), commit=True)
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
    user = query_one("SELECT * FROM users WHERE username=%s", (username,))
    if not user or user["password_hash"] != hash_password(password):
        return jsonify({"error": "Sai tên đăng nhập hoặc mật khẩu"}), 401
    token   = create_session(user["id"])
    profile = build_user_profile(user)
    return jsonify({"token": token, "user": profile})

@app.route("/api/logout", methods=["POST"])
@require_auth
def api_logout():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    query("DELETE FROM sessions WHERE token=%s", (token,), commit=True)
    return jsonify({"ok": True})

@app.route("/api/me", methods=["GET"])
@require_auth
def api_me():
    profile = build_user_profile(g.current_user)
    return jsonify({"user": profile})

# ──────────────────────────────────────────────────────────────
#  API — GAME RESULT
# ──────────────────────────────────────────────────────────────

@app.route("/api/game/result", methods=["POST"])
@require_auth
def api_game_result():
    data       = request.get_json(silent=True) or {}
    result     = data.get("result")
    score_mine = int(data.get("score_mine", 0))
    score_opp  = int(data.get("score_opp",  0))
    combo      = int(data.get("combo", 0))
    mode       = data.get("mode", "ai")
    if result not in ("win", "loss"):
        return jsonify({"error": "result phải là 'win' hoặc 'loss'"}), 400
    uid = g.current_user["id"]
    coins_earned = 0
    if result == "win":
        coins_earned = 50
        query("""UPDATE users SET wins=wins+1, games_played=games_played+1,
                   coins=coins+%s, high_streak=GREATEST(high_streak,%s) WHERE id=%s""",
              (coins_earned, combo, uid), commit=True)
    else:
        query("""UPDATE users SET losses=losses+1, games_played=games_played+1,
                   high_streak=GREATEST(high_streak,%s) WHERE id=%s""",
              (combo, uid), commit=True)
    query("INSERT INTO match_history (user_id,result,score_mine,score_opp,combo,mode) VALUES (%s,%s,%s,%s,%s,%s)",
          (uid, result, score_mine, score_opp, combo, mode), commit=True)
    user    = query_one("SELECT * FROM users WHERE id=%s", (uid,))
    profile = build_user_profile(user)
    return jsonify({"coins_earned": coins_earned, "user": profile})

# ──────────────────────────────────────────────────────────────
#  API — COINS
# ──────────────────────────────────────────────────────────────

@app.route("/api/coins/add", methods=["POST"])
@require_auth
def api_coins_add():
    amount = int((request.get_json(silent=True) or {}).get("amount", 0))
    if amount <= 0 or amount > 100:
        return jsonify({"error": "Số xu không hợp lệ"}), 400
    uid = g.current_user["id"]
    query("UPDATE users SET coins=coins+%s WHERE id=%s", (amount, uid), commit=True)
    user = query_one("SELECT coins FROM users WHERE id=%s", (uid,))
    return jsonify({"coins": user["coins"]})

# ──────────────────────────────────────────────────────────────
#  API — SHOP
# ──────────────────────────────────────────────────────────────

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
    if query_one("SELECT 1 FROM owned_balls WHERE user_id=%s AND skin_id=%s", (uid, skin_id)):
        return jsonify({"error": "Bạn đã sở hữu skin này"}), 409
    user = query_one("SELECT coins FROM users WHERE id=%s", (uid,))
    if user["coins"] < price:
        return jsonify({"error": "Không đủ xu"}), 402
    query("UPDATE users SET coins=coins-%s WHERE id=%s", (price, uid), commit=True)
    query("INSERT INTO owned_balls (user_id, skin_id) VALUES (%s,%s)", (uid, skin_id), commit=True)
    query("UPDATE users SET equipped_ball=%s WHERE id=%s", (skin_id, uid), commit=True)
    return jsonify({"user": build_user_profile(query_one("SELECT * FROM users WHERE id=%s", (uid,)))})

@app.route("/api/shop/equip/ball", methods=["POST"])
@require_auth
def api_equip_ball():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    uid     = g.current_user["id"]
    if not query_one("SELECT 1 FROM owned_balls WHERE user_id=%s AND skin_id=%s", (uid, skin_id)):
        return jsonify({"error": "Bạn chưa sở hữu skin này"}), 403
    query("UPDATE users SET equipped_ball=%s WHERE id=%s", (skin_id, uid), commit=True)
    return jsonify({"equipped_ball": skin_id})

@app.route("/api/shop/buy/paddle", methods=["POST"])
@require_auth
def api_buy_paddle():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    if skin_id not in PADDLE_PRICES:
        return jsonify({"error": "Skin không tồn tại"}), 404
    uid   = g.current_user["id"]
    price = PADDLE_PRICES[skin_id]
    if query_one("SELECT 1 FROM owned_paddles WHERE user_id=%s AND skin_id=%s", (uid, skin_id)):
        return jsonify({"error": "Bạn đã sở hữu skin này"}), 409
    user = query_one("SELECT coins FROM users WHERE id=%s", (uid,))
    if user["coins"] < price:
        return jsonify({"error": "Không đủ xu"}), 402
    query("UPDATE users SET coins=coins-%s WHERE id=%s", (price, uid), commit=True)
    query("INSERT INTO owned_paddles (user_id, skin_id) VALUES (%s,%s)", (uid, skin_id), commit=True)
    query("UPDATE users SET equipped_paddle=%s WHERE id=%s", (skin_id, uid), commit=True)
    return jsonify({"user": build_user_profile(query_one("SELECT * FROM users WHERE id=%s", (uid,)))})

@app.route("/api/shop/equip/paddle", methods=["POST"])
@require_auth
def api_equip_paddle():
    skin_id = (request.get_json(silent=True) or {}).get("skin_id", "")
    uid     = g.current_user["id"]
    if not query_one("SELECT 1 FROM owned_paddles WHERE user_id=%s AND skin_id=%s", (uid, skin_id)):
        return jsonify({"error": "Bạn chưa sở hữu skin này"}), 403
    query("UPDATE users SET equipped_paddle=%s WHERE id=%s", (skin_id, uid), commit=True)
    return jsonify({"equipped_paddle": skin_id})

@app.route("/api/shop/buy/power", methods=["POST"])
@require_auth
def api_buy_power():
    power_id = (request.get_json(silent=True) or {}).get("power_id", "")
    if power_id not in POWER_PRICES:
        return jsonify({"error": "Vật phẩm không tồn tại"}), 404
    uid   = g.current_user["id"]
    price = POWER_PRICES[power_id]
    user  = query_one("SELECT coins FROM users WHERE id=%s", (uid,))
    if user["coins"] < price:
        return jsonify({"error": "Không đủ xu"}), 402
    query("UPDATE users SET coins=coins-%s WHERE id=%s", (price, uid), commit=True)
    query("""INSERT INTO powers (user_id, power_id, qty) VALUES (%s,%s,1)
             ON CONFLICT (user_id, power_id) DO UPDATE SET qty=powers.qty+1""",
          (uid, power_id), commit=True)
    return jsonify({"user": build_user_profile(query_one("SELECT * FROM users WHERE id=%s", (uid,)))})

@app.route("/api/shop/use/power", methods=["POST"])
@require_auth
def api_use_power():
    power_id = (request.get_json(silent=True) or {}).get("power_id", "")
    uid      = g.current_user["id"]
    row      = query_one("SELECT qty FROM powers WHERE user_id=%s AND power_id=%s", (uid, power_id))
    if not row or row["qty"] <= 0:
        return jsonify({"error": "Không có vật phẩm này"}), 400
    query("UPDATE powers SET qty=qty-1 WHERE user_id=%s AND power_id=%s", (uid, power_id), commit=True)
    return jsonify({"user": build_user_profile(query_one("SELECT * FROM users WHERE id=%s", (uid,)))})

# ──────────────────────────────────────────────────────────────
#  API — DAILY REWARD
# ──────────────────────────────────────────────────────────────

@app.route("/api/daily", methods=["POST"])
@require_auth
def api_daily():
    uid  = g.current_user["id"]
    user = query_one("SELECT * FROM users WHERE id=%s", (uid,))
    now  = int(time.time())
    if now - (user["last_daily"] or 0) < 86400:
        remain = 86400 - (now - user["last_daily"])
        h = remain // 3600; m = (remain % 3600) // 60
        return jsonify({"error": f"Đã nhận hôm nay. Còn {h}h {m}m"}), 429
    streak = (user["daily_streak"] or 0) + 1
    bonus  = 30 + streak * 5
    query("UPDATE users SET coins=coins+%s, last_daily=%s, daily_streak=%s WHERE id=%s",
          (bonus, now, streak, uid), commit=True)
    user    = query_one("SELECT * FROM users WHERE id=%s", (uid,))
    return jsonify({"bonus": bonus, "streak": streak, "user": build_user_profile(user)})

# ──────────────────────────────────────────────────────────────
#  API — LEADERBOARD
# ──────────────────────────────────────────────────────────────

@app.route("/api/leaderboard", methods=["GET"])
def api_leaderboard():
    rows = query("SELECT username,wins,losses,coins,high_streak,games_played FROM users ORDER BY wins DESC LIMIT 20") or []
    return jsonify({"leaderboard": [dict(r) for r in rows]})

# ──────────────────────────────────────────────────────────────
#  API — FRIENDS
# ──────────────────────────────────────────────────────────────

def mini_profile(row):
    return {"username": row["username"], "wins": row["wins"],
            "coins": row["coins"], "high_streak": row["high_streak"],
            "games_played": row["games_played"]}

@app.route("/api/friends", methods=["GET"])
@require_auth
def api_friends():
    uid = g.current_user["id"]
    friends_rows = query("""
        SELECT u.username, u.wins, u.coins, u.high_streak, u.games_played
        FROM friendships f
        JOIN users u ON (CASE WHEN f.from_id=%s THEN f.to_id ELSE f.from_id END = u.id)
        WHERE (f.from_id=%s OR f.to_id=%s) AND f.status='accepted'
    """, (uid, uid, uid)) or []
    sent_rows = query("""
        SELECT u.username, u.wins FROM friendships f JOIN users u ON f.to_id=u.id
        WHERE f.from_id=%s AND f.status='pending'
    """, (uid,)) or []
    recv_rows = query("""
        SELECT u.username, u.wins FROM friendships f JOIN users u ON f.from_id=u.id
        WHERE f.to_id=%s AND f.status='pending'
    """, (uid,)) or []
    return jsonify({
        "friends":  [mini_profile(r) for r in friends_rows],
        "sent":     [{"username": r["username"], "wins": r["wins"]} for r in sent_rows],
        "received": [{"username": r["username"], "wins": r["wins"]} for r in recv_rows],
    })

@app.route("/api/friends/request", methods=["POST"])
@require_auth
def api_friend_request():
    to_username = (request.get_json(silent=True) or {}).get("to_username", "").strip()
    uid         = g.current_user["id"]
    if not to_username or to_username == g.current_user["username"]:
        return jsonify({"error": "Không hợp lệ"}), 400
    target = query_one("SELECT id FROM users WHERE username=%s", (to_username,))
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid      = target["id"]
    existing = query_one("""SELECT status FROM friendships
        WHERE (from_id=%s AND to_id=%s) OR (from_id=%s AND to_id=%s)""", (uid, tid, tid, uid))
    if existing:
        return jsonify({"error": "Lời mời hoặc kết bạn đã tồn tại"}), 409
    query("INSERT INTO friendships (from_id, to_id) VALUES (%s,%s)", (uid, tid), commit=True)
    return jsonify({"ok": True})

@app.route("/api/friends/respond", methods=["POST"])
@require_auth
def api_friend_respond():
    data          = request.get_json(silent=True) or {}
    from_username = data.get("from_username", "").strip()
    accept        = bool(data.get("accept", False))
    uid           = g.current_user["id"]
    sender = query_one("SELECT id FROM users WHERE username=%s", (from_username,))
    if not sender:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    frow = query_one("SELECT id FROM friendships WHERE from_id=%s AND to_id=%s AND status='pending'",
                     (sender["id"], uid))
    if not frow:
        return jsonify({"error": "Không tìm thấy lời mời"}), 404
    if accept:
        query("UPDATE friendships SET status='accepted' WHERE id=%s", (frow["id"],), commit=True)
    else:
        query("DELETE FROM friendships WHERE id=%s", (frow["id"],), commit=True)
    return jsonify({"ok": True, "accepted": accept})

@app.route("/api/friends/remove", methods=["POST"])
@require_auth
def api_friend_remove():
    username = (request.get_json(silent=True) or {}).get("username", "").strip()
    uid      = g.current_user["id"]
    target   = query_one("SELECT id FROM users WHERE username=%s", (username,))
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid = target["id"]
    query("DELETE FROM friendships WHERE (from_id=%s AND to_id=%s) OR (from_id=%s AND to_id=%s)",
          (uid, tid, tid, uid), commit=True)
    return jsonify({"ok": True})

# ──────────────────────────────────────────────────────────────
#  API — PROFILE & SEARCH
# ──────────────────────────────────────────────────────────────

@app.route("/api/profile/<username>", methods=["GET"])
@require_auth
def api_profile(username):
    row = query_one("SELECT * FROM users WHERE username=%s", (username,))
    if not row:
        return jsonify({"error": "Không tìm thấy người dùng"}), 404
    return jsonify({"profile": {
        "username": row["username"], "wins": row["wins"], "losses": row["losses"],
        "coins": row["coins"], "high_streak": row["high_streak"],
        "games_played": row["games_played"], "created_at": row["created_at"],
    }})

@app.route("/api/users/search", methods=["GET"])
@require_auth
def api_users_search():
    q   = request.args.get("q", "").strip()
    uid = g.current_user["id"]
    if not q or len(q) < 2:
        return jsonify({"users": []})
    rows = query("SELECT username, wins, coins FROM users WHERE username ILIKE %s AND id!=%s LIMIT 10",
                 (f"%{q}%", uid)) or []
    return jsonify({"users": [dict(r) for r in rows]})

# ──────────────────────────────────────────────────────────────
#  API — CHAT
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
        return jsonify({"error": f"Tối đa {MAX_MSG_LEN} ký tự"}), 400
    target = query_one("SELECT id FROM users WHERE username=%s", (to_user,))
    if not target:
        return jsonify({"error": "Người dùng không tồn tại"}), 404
    tid = target["id"]
    if tid == uid:
        return jsonify({"error": "Không thể nhắn tin cho chính mình"}), 400
    friends = query_one("""SELECT 1 FROM friendships
        WHERE ((from_id=%s AND to_id=%s) OR (from_id=%s AND to_id=%s)) AND status='accepted'""",
        (uid, tid, tid, uid))
    if not friends:
        return jsonify({"error": "Chỉ có thể nhắn tin với bạn bè"}), 403
    query("INSERT INTO messages (from_id, to_id, content) VALUES (%s,%s,%s)",
          (uid, tid, content), commit=True)
    return jsonify({"ok": True, "created_at": int(time.time())})

@app.route("/api/chat/history/<username>", methods=["GET"])
@require_auth
def api_chat_history(username):
    uid    = g.current_user["id"]
    target = query_one("SELECT id FROM users WHERE username=%s", (username,))
    if not target:
        return jsonify({"error": "Không tìm thấy"}), 404
    tid  = target["id"]
    rows = query("""
        SELECT m.id, m.content, m.created_at, m.is_read,
               uf.username AS from_username
        FROM messages m
        JOIN users uf ON m.from_id = uf.id
        WHERE (m.from_id=%s AND m.to_id=%s) OR (m.from_id=%s AND m.to_id=%s)
        ORDER BY m.created_at ASC LIMIT 50
    """, (uid, tid, tid, uid)) or []
    query("UPDATE messages SET is_read=TRUE WHERE from_id=%s AND to_id=%s AND is_read=FALSE",
          (tid, uid), commit=True)
    messages = [{"id": r["id"], "from": r["from_username"],
                 "content": r["content"], "created_at": r["created_at"],
                 "is_read": r["is_read"]} for r in rows]
    return jsonify({"messages": messages})

@app.route("/api/chat/unread", methods=["GET"])
@require_auth
def api_chat_unread():
    uid  = g.current_user["id"]
    rows = query("""SELECT u.username, COUNT(*) as cnt FROM messages m
                    JOIN users u ON m.from_id=u.id
                    WHERE m.to_id=%s AND m.is_read=FALSE GROUP BY m.from_id, u.username""",
                 (uid,)) or []
    unread = {r["username"]: r["cnt"] for r in rows}
    return jsonify({"unread": unread, "total": sum(unread.values())})

@app.route("/api/chat/conversations", methods=["GET"])
@require_auth
def api_chat_conversations():
    uid  = g.current_user["id"]
    rows = query("""
        SELECT u.username, u.wins,
            (SELECT content FROM messages
             WHERE (from_id=u.id AND to_id=%s) OR (from_id=%s AND to_id=u.id)
             ORDER BY created_at DESC LIMIT 1) AS last_msg,
            (SELECT created_at FROM messages
             WHERE (from_id=u.id AND to_id=%s) OR (from_id=%s AND to_id=u.id)
             ORDER BY created_at DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*) FROM messages
             WHERE from_id=u.id AND to_id=%s AND is_read=FALSE) AS unread
        FROM friendships f
        JOIN users u ON (CASE WHEN f.from_id=%s THEN f.to_id ELSE f.from_id END = u.id)
        WHERE (f.from_id=%s OR f.to_id=%s) AND f.status='accepted'
        ORDER BY last_at DESC NULLS LAST
    """, (uid, uid, uid, uid, uid, uid, uid, uid)) or []
    convos = [{"username": r["username"], "wins": r["wins"],
               "last_msg": r["last_msg"] or "", "last_at": r["last_at"] or 0,
               "unread": r["unread"] or 0} for r in rows]
    return jsonify({"conversations": convos})

# ──────────────────────────────────────────────────────────────
#  API — MATCH HISTORY & HEALTH
# ──────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
@require_auth
def api_history():
    uid  = g.current_user["id"]
    rows = query("""SELECT result,score_mine,score_opp,combo,mode,played_at
                    FROM match_history WHERE user_id=%s ORDER BY played_at DESC LIMIT 20""",
                 (uid,)) or []
    return jsonify({"history": [dict(r) for r in rows]})

@app.route("/api/ping", methods=["GET"])
def api_ping():
    return jsonify({"status": "ok", "time": int(time.time())})

# ──────────────────────────────────────────────────────────────
#  KHỞI ĐỘNG
# ──────────────────────────────────────────────────────────────

init_db()

if __name__ == "__main__":
    print("=" * 55)
    print("  NEON PONG SERVER  —  http://localhost:5000")
    print("  Nhấn Ctrl+C để dừng")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=True)
