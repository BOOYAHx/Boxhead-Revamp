import socketserver
import os
import hashlib
import time
import math
import random
import threading
import xml.etree.ElementTree as ET
from xml.dom import minidom
import datetime
import json
import sqlite3
import tempfile
import uuid
from contextlib import closing

DB_FILE = "users.db"

# username -> (md5_hash, account_id_string)
USER_DB = {}
USER_DB_LOCK = threading.RLock()
SESSIONS_LOCK = threading.RLock()
DEPLOYABLE_LOCK = threading.RLock()
CRATE_LOCK = threading.RLock()
MAX_MAP_CRATES = 199
CRATE_ID_WIDTH = 3
MAX_CRATES_PER_DEATH = 10  # Upper limit, not a guaranteed number of drops.
MAX_WARNING_MESSAGE_LENGTH = 240

# --- Game modes -------------------------------------------------------------
# The client sends the mode as the first character of the "02" create header
# and the server echoes it after the "C<id>" join packet for the joiner.
GAME_MODE_FFA = "A"
GAME_MODE_TDM = "B"
GAME_MODE_INFECTED = "C"
GAME_MODE_LAST_SURVIVOR = "D"
GAME_MODES = (GAME_MODE_FFA, GAME_MODE_TDM, GAME_MODE_INFECTED, GAME_MODE_LAST_SURVIVOR)
FFA_MAX_PLAYERS = 16
# Team Deathmatch: two teams (the client's BLUE_TEAM=2 and RED_TEAM=3 ids,
# shown to players as "Team A" and "Team B").
TEAM_NONE = 0
TEAM_A = 2
TEAM_B = 3
TDM_TEAMS = (TEAM_A, TEAM_B)
TEAM_SIZE = 8  # 8v8. Must match TeamBountyGame.TEAM_SIZE in the SWF.
ROOM_JOIN_ERROR = b"099\x00"  # Client shows "Game not found" and stays in the lobby.

# Add moderator account names here if you do not want to edit their `level`
# field in users.db. Names are case-insensitive. An account is a moderator
# when it appears here or has a database level greater than zero.
MODERATOR_USERNAMES = frozenset({
    # "your-account-name",
})

USERS = {}  # account_id -> dict(socket, username, slot, room)

###############################################################################
# Helpers
###############################################################################

def is_configured_moderator(username):
    return str(username).casefold() in MODERATOR_USERNAMES


def effective_user_level(username, data):
    """Return the client-visible level, including configured moderators."""
    try:
        database_level = max(0, int(data.get("level", "0")))
    except (TypeError, ValueError):
        database_level = 0
    if is_configured_moderator(username):
        database_level = max(1, database_level)
    # The login packet carries the level as ONE character; "10" would shift
    # every field after it. Any value above 0 means moderator anyway.
    return str(min(9, database_level))


def account_is_moderator(account_id):
    """Authorize moderator-only packets from trusted server account data."""
    user = USERS.get(account_id)
    if not user:
        return False

    username = user.get("username", "")
    if is_configured_moderator(username):
        return True

    with USER_DB_LOCK:
        data = USER_DB.get(username)
        if not data:
            return False
        try:
            return int(data.get("level", "0")) > 0
        except (TypeError, ValueError):
            return False

def log_player_ip(username, ip_address):
    """Appends a successful login to a dedicated IP log file."""
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] User: {username.ljust(15)} | IP: {ip_address}\n"
    
    try:
        with open("login_ips.log", "a", encoding="utf-8") as f:
            f.write(log_entry)
    except Exception as e:
        print(f"Failed to write IP log: {e}")

def update_most_wanted_xml():
    with LEADERBOARD_LOCK:
        _update_most_wanted_xml()


def _update_most_wanted_xml():
    """Generates the mostwanted.xml based on the current USER_DB in memory"""
    try:
        users_list = []
        with USER_DB_LOCK:
            snapshot = [(name, data.copy()) for name, data in USER_DB.items()]
        for uname, data in snapshot:
            users_list.append({
                "name": data.get("username", uname),
                "h_model": data.get("head_model", "0"),
                "h_color": data.get("head_color", "0"),
                "b_model": data.get("body_model", "0"),
                "b_color": data.get("body_color", "0"),
                "bounty": int(data.get("bounty", 0)),
                "kills": int(data.get("kills", 0)),
                "deaths": int(data.get("deaths", 0)),
                "wins": int(data.get("wins", 0)),
                "losses": int(data.get("losses", 0))
            })

        users_list.sort(key=lambda x: x['bounty'], reverse=True)
        top_users = users_list[:100]

        root = ET.Element("rsp")
        root.set("stat", "ok")
        users_node = ET.SubElement(root, "users")

        for u in top_users:
            user_node = ET.SubElement(users_node, "user")
            ET.SubElement(user_node, "name").text = u["name"]
            ET.SubElement(user_node, "bountyPoints").text = str(u["bounty"])
            ET.SubElement(user_node, "kills").text = str(u["kills"])
            ET.SubElement(user_node, "deaths").text = str(u["deaths"])
            ET.SubElement(user_node, "wins").text = str(u["wins"])
            ET.SubElement(user_node, "losses").text = str(u["losses"])
            
            head_node = ET.SubElement(user_node, "head")
            ET.SubElement(head_node, "color").text = str(int(u["h_color"]))
            ET.SubElement(head_node, "model").text = str(int(u["h_model"]))
            
            body_node = ET.SubElement(user_node, "body")
            ET.SubElement(body_node, "color").text = str(int(u["b_color"]))
            ET.SubElement(body_node, "model").text = str(int(u["b_model"]))

        xml_str = ET.tostring(root, encoding='utf-8')
        pretty_xml = minidom.parseString(xml_str).toprettyxml(indent="	")
        
        write_atomic_text("/var/www/html/mostwanted.xml", pretty_xml)
        
        print("Updated /var/www/html/mostwanted.xml")
            
    except Exception as e:
        print(f"[!] Error updating Most Wanted XML: {e}")

def create_bounty_string(crate_type, index, pos):
    """
    Creates a 14-character string for a single bounty item.
    [Type: 1char][Index: 3char][Pos: 10char]
    
    :param pos: A 10-character string (e.g., '0045001200')
    """
    # Type: 1 character (0=$250, 1=$500, 2=$1000)
    type_part = str(crate_type)[0]
    
    # Index: 3 characters; the map has 199 slots, numbered 000 to 198.
    if not 0 <= index < MAX_MAP_CRATES:
        raise ValueError("Crate index outside map capacity")
    index_part = f"{index:0{CRATE_ID_WIDTH}d}"
    
    # Pos: Use the 10-character string directly
    return f"{type_part}{index_part}{pos}"

def remember_walkable_position(user: dict, room_name: str, pos: str):
    """Keep a short trail of positions the player has actually occupied."""
    if len(pos) != 10 or not pos.isdigit():
        return

    if user.get("position_history_room") != room_name:
        user["position_history_room"] = room_name
        user["position_history"] = []

    history = user.setdefault("position_history", [])
    try:
        x, y = int(pos[:5]), int(pos[5:])
        if history:
            last_x, last_y = int(history[-1][:5]), int(history[-1][5:])
            # Movement packets arrive frequently; retain useful path samples.
            if (x - last_x) ** 2 + (y - last_y) ** 2 < 10 ** 2:
                return
        history.append(pos)
        del history[:-256]
    except (TypeError, ValueError):
        return

def room_is_infected(room) -> bool:
    return bool(room) and (room.get("mode") in (GAME_MODE_INFECTED, GAME_MODE_LAST_SURVIVOR)
                           or room.get("header", "")[:1] in ("C", "D")
                           or str(room.get("name", "")).upper().startswith("INFECTED"))


def room_is_tdm(room) -> bool:
    return bool(room) and room.get("mode") == GAME_MODE_TDM


def is_private_room(room) -> bool:
    """Client createRoom sends 02 + gameType + useCustom + isPrivate + name;maps."""
    header = room.get("header", "") if room else ""
    return len(header) >= 3 and header[2] == "1"


def room_is_unranked(room) -> bool:
    """Rounds in these rooms never change saved stats (anti stat-farming)."""
    return room_is_tdm(room) or room_is_infected(room) or is_private_room(room)


def room_name_key(name: str) -> str:
    """Loose form of a room name used for "Join Private": letters and digits only,
    upper-case. "OPETH'S GAME", "opeths game" and "OPETHS  GAME" all match."""
    return "".join(ch for ch in str(name).upper() if ch.isalnum())


def find_room_name(server, requested: str):
    """Return the real name of the room a player typed, or None.

    Private games are hidden from the list, so typing the name is the only way
    in. An exact name always wins; otherwise a name that matches ignoring case,
    spaces and punctuation is accepted (room creation keeps those unique).
    """
    if requested in server.rooms:
        return requested
    key = room_name_key(requested)
    if not key:
        return None
    matches = [name for name in list(server.rooms) if name != "_" and room_name_key(name) == key]
    return matches[0] if len(matches) == 1 else None


def room_capacity(room) -> int:
    return TEAM_SIZE * len(TDM_TEAMS) if room_is_tdm(room) else FFA_MAX_PLAYERS


def split_lives_settings(settings, mode):
    maps, separator, extra = settings.partition(';L')
    limit = int(extra) if separator and extra in ('0', '1', '2', '3', '4', '5') else 0
    return maps, limit if mode == GAME_MODE_TDM else 0


def life_limit(room):
    return int(room.get('lives', 0)) if room_is_tdm(room) else 0


def lives_left(room, account):
    limit = life_limit(room)
    if not limit:
        return 9  # Wire sentinel for unlimited lives.
    return room.setdefault('lives_left', {}).setdefault(account, limit)


def eliminated(room, account):
    return bool(life_limit(room)) and account is not None and lives_left(room, account) <= 0


def user_team(account_id) -> int:
    return USERS.get(account_id, {}).get("team", TEAM_NONE)


def team_count(room, team, exclude=None) -> int:
    return sum(1 for acc in list(room.get("players", ()))
               if acc != exclude and user_team(acc) == team)


def account_by_wire(room, wire):
    if not room:
        return None
    """Find the account in `room` whose 3-digit slot matches `wire`."""
    for acc in list(room.get("players", ())):
        info = USERS.get(acc)
        if info is not None and f"{int(info.get('slot', 0)):03d}" == wire:
            return acc
    return None


def same_team(room, account_a, account_b) -> bool:
    """True when two different players are on the same Team Deathmatch team."""
    if not room_is_tdm(room) or account_a is None or account_b is None or account_a == account_b:
        return False
    team = user_team(account_a)
    return team in TDM_TEAMS and team == user_team(account_b)


def md5_hash(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()

def normalize_room_name(name: str) -> str:
    # Remove NULL bytes, Padding (\x01), and surrounding whitespace
    # This fixes the "Unhandled: 03..." error
    return name.replace("\x00", "").replace("\x01", "").strip()

def fmt_name_20(username: str) -> str:
    """
    Flash client reads EXACTLY 20 chars for name and strips every leading '#'.

    Pad on the LEFT with '#' so the client ends up with the exact name.
    (Padding on the right with \x01 kept 15-odd invisible characters inside
    every name on the client, so name lookups such as /warn, /ban, /pm,
    /stats, /ignore and /friend always answered "User not found.")
    """
    return (username or "")[:20].rjust(20, "#")

class SlotAllocator:
    def __init__(self):
        self.free = set(range(1, 1000))
        self.used = {}  # account_id -> slot

    def allocate(self, account_id: str) -> int:
        slot = min(self.free)
        self.free.remove(slot)
        self.used[account_id] = slot
        return slot

    def release(self, account_id: str):
        slot = self.used.pop(account_id, None)
        if slot is not None:
            self.free.add(slot)

SLOTS = SlotAllocator()

def wire_id(account_id: str) -> str:
    return f"{USERS[account_id]['slot']:03d}"

###############################################################################
# User DB load/save
###############################################################################

# Included in the standalone server by build_round_results_server.py.
ROUND_LOCK_INIT = threading.Lock()
LEADERBOARD_LOCK = threading.RLock()
ROUND_SUMMARY_SECONDS = 30
ROUND_SAVE_RETRY_SECONDS = 2
USER_FIELDS = (
    'username', 'password_hash', 'account_id', 'level', 'gender',
    'head_model', 'head_color', 'body_model', 'body_color',
    'bounty', 'kills', 'deaths', 'wins', 'losses', 'wanted',
)


def write_atomic_text(path, text):
    """Replace a complete file; an interrupted write cannot truncate users.db."""
    path = os.path.abspath(path)
    parent = os.path.dirname(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + os.path.basename(path) + '.', dir=parent)
    try:
        if os.path.exists(path):
            os.chmod(temporary, os.stat(path).st_mode & 0o777)
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as stream:
            descriptor = None
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            directory = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if os.path.exists(temporary):
            os.unlink(temporary)


def serialize_users(users):
    rows = []
    for username, data in users.items():
        rows.append(';'.join(str(data.get(field, username if field == 'username' else
                                           '' if field == 'password_hash' else '0'))
                             for field in USER_FIELDS) + '\n')
    return ''.join(rows)


def open_round_store():
    """The ledger and a pending users.db export commit in one SQLite transaction."""
    connection = sqlite3.connect(DB_FILE + '.rounds.sqlite3', timeout=30)
    try:
        connection.execute('PRAGMA synchronous=FULL')
        connection.execute('CREATE TABLE IF NOT EXISTS round_results ('
                           'round_id TEXT PRIMARY KEY, awards TEXT NOT NULL, '
                           'results_json TEXT NOT NULL, committed_at REAL NOT NULL)')
        connection.execute('CREATE TABLE IF NOT EXISTS pending_export ('
                           'id INTEGER PRIMARY KEY CHECK(id=1), users_json TEXT NOT NULL)')
        connection.commit()
    except Exception:
        connection.close()
        raise
    return connection


def recover_pending_round_export():
    """Replay absolute totals, never increments, after a failed export or restart."""
    with USER_DB_LOCK:
        if not os.path.exists(DB_FILE + '.rounds.sqlite3'):
            return
        with closing(open_round_store()) as connection:
            row = connection.execute('SELECT users_json FROM pending_export WHERE id=1').fetchone()
            if row is None:
                return
            users = json.loads(row[0])
            write_atomic_text(DB_FILE, serialize_users(users))
            USER_DB.clear()
            USER_DB.update(users)
            with connection:
                connection.execute('DELETE FROM pending_export WHERE id=1')


def persist_users(users):
    """Caller holds USER_DB_LOCK and has recovered any pending round first."""
    write_atomic_text(DB_FILE, serialize_users(users))
    USER_DB.clear()
    USER_DB.update(users)


def calculate_round_awards(players):
    if not players:
        return '000' * 5, None
    winner = max(players, key=lambda p: p['score'])
    hunter = max(players, key=lambda p: p['bounty_points'])
    professor = max(players, key=lambda p: p['kills'] if not p['deaths'] else p['kills'] / p['deaths'])
    poacher = max(players, key=lambda p: (p['score'] - 10000) / p['kills'] if p['kills'] else 0)
    dummy = max(players, key=lambda p: p['deaths'])
    return ''.join(p['slot'] for p in (winner, hunter, professor, poacher, dummy)), winner['username']


def commit_round_results(round_id, players):
    """An already committed ID returns its original awards without adding stats."""
    with USER_DB_LOCK:
        recover_pending_round_export()
        with closing(open_round_store()) as connection:
            previous = connection.execute('SELECT awards FROM round_results WHERE round_id=?',
                                          (round_id,)).fetchone()
            if previous is not None:
                return previous[0]
            awards, winner = calculate_round_awards(players)
            users = {name: data.copy() for name, data in USER_DB.items()}
            for player in players:
                name = player['username']
                if name not in users:
                    raise ValueError('Round participant account is missing: ' + name)
                user = users[name]
                for total, increment in (('kills', 'kills'), ('deaths', 'deaths'), ('bounty', 'bounty_points')):
                    user[total] = str(int(user.get(total, 0)) + player[increment])
                outcome = 'wins' if name == winner else 'losses'
                user[outcome] = str(int(user.get(outcome, 0)) + 1)
            bounties = sorted((int(user.get('bounty', 0)) for user in users.values()), reverse=True)
            threshold = bounties[99] if len(bounties) >= 100 else 0
            for user in users.values():
                bounty = int(user.get('bounty', 0))
                user['wanted'] = '1' if bounty > 0 and bounty >= threshold else '0'
            # Memory and the legacy text file are published only after this commit.
            # A pending absolute snapshot makes the legacy export safe to retry.
            with connection:
                connection.execute('INSERT INTO round_results VALUES (?, ?, ?, ?)',
                                   (round_id, awards, json.dumps(players), time.time()))
                connection.execute('INSERT INTO pending_export VALUES (1, ?)', (json.dumps(users),))
        recover_pending_round_export()
        return awards


def room_round_lock(room):
    with ROUND_LOCK_INIT:
        if '_round_lock' not in room:
            room['_round_lock'] = threading.RLock()
        return room['_round_lock']


def ensure_round_state(room):
    # Caller holds the room's round lock.
    if room.get('round_start') is None:
        room['round_start'] = time.time()
    if 'round_id' not in room:
        room['round_id'] = uuid.uuid4().hex
    room.setdefault('round_state', 'active')


def round_remaining(room):
    with room_round_lock(room):
        ensure_round_state(room)
        if room['round_state'] == 'finishing':
            return ROUND_SUMMARY_SECONDS
        if room['round_state'] == 'ended':
            return max(0, math.ceil(room['round_results_until'] - time.time()))
        return max(0, math.ceil(room.get('round_length', 630) - (time.time() - room['round_start'])))


# Finish any durable pending export before loading accounts or accepting clients.
recover_pending_round_export()

next_id = 1
if os.path.exists(DB_FILE):
    max_id = 0
    with open(DB_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(";")
            
            # Map parts to names safely
            # Format: user;hash;id;level;gender;h_m;h_c;b_m;b_c;bounty;kills;deaths;wins;losses;wanted
            u_data = {
                "username": parts[0],
                "password_hash": parts[1] if len(parts) > 1 else "",
                "account_id": parts[2] if len(parts) > 2 else "0",
                "level": parts[3] if len(parts) > 3 else "0",
                "gender": parts[4] if len(parts) > 4 else "0",
                "head_model": parts[5] if len(parts) > 5 else "00",
                "head_color": parts[6] if len(parts) > 6 else "00",
                "body_model": parts[7] if len(parts) > 7 else "00",
                "body_color": parts[8] if len(parts) > 8 else "00",
                "bounty": parts[9] if len(parts) > 9 else "0",
                "kills": parts[10] if len(parts) > 10 else "0",
                "deaths": parts[11] if len(parts) > 11 else "0",
                "wins": parts[12] if len(parts) > 12 else "0",
                "losses": parts[13] if len(parts) > 13 else "0",
                "wanted": parts[14] if len(parts) > 14 else "0",
            }
            
            USER_DB[parts[0].casefold()] = u_data  # Store keys case-insensitively
            try:
                max_id = max(max_id, int(u_data["account_id"]))
            except ValueError:
                pass
    next_id = max_id + 1

def save_user(username: str, password: str) -> str:
    global next_id
    with USER_DB_LOCK:
        recover_pending_round_export()
        display_username = username
        username = username.casefold()
        if username in USER_DB:
            raise ValueError('Account already exists')
        acc_id = str(next_id)
        users = {name: data.copy() for name, data in USER_DB.items()}
        users[username] = {
            'username': display_username, 'password_hash': md5_hash(password), 'account_id': acc_id,
            'level': '0', 'gender': '0', 'head_model': '00', 'head_color': '00',
            'body_model': '00', 'body_color': '00', 'bounty': '0', 'kills': '0',
            'deaths': '0', 'wins': '0', 'losses': '0', 'wanted': '0',
        }
        persist_users(users)
        next_id += 1
        return acc_id


def save_all_users():
    with USER_DB_LOCK:
        recover_pending_round_export()
        persist_users({name: data.copy() for name, data in USER_DB.items()})
    update_most_wanted_xml()


###############################################################################
# Packet builders (MATCH AS3 EXPECTATIONS)
###############################################################################

def auth_packet(account_id: str) -> bytes:
    username = USERS[account_id]["username"]
    name20 = fmt_name_20(USERS[account_id].get("display_username", username))
    
    # Access by Key
    data = USER_DB[username] 
    
    level = effective_user_level(username, data)
    gender = data["gender"]
    head_model = data["head_model"]
    head_color = data["head_color"]
    body_model = data["body_model"]
    body_color = data["body_color"]
    
    stats5 = f"{data['kills']};{data['deaths']};{data['wins']};{data['losses']};{data['bounty']}"
    wanted = data["wanted"]

    payload = f"{name20}{level}{gender}{head_model}{head_color}{body_model}{body_color}{stats5}{wanted}"
    return f"A{wire_id(account_id)}{payload}\x00".encode("utf-8")

def lobby_user_packet(account_id: str) -> bytes:
    if USERS[account_id].get("room") != "_":
        return b""

    username = USERS[account_id]["username"]
    name20 = fmt_name_20(USERS[account_id].get("display_username", username))
    data = USER_DB[username]
    

    level = effective_user_level(username, data)
    stats6 = f"{data['kills']};{data['deaths']};{data['wins']};{data['losses']};{data['bounty']};{level}"
    wanted = data["wanted"]

    payload = f"{name20}{stats6}{wanted}"
    return f"U{wire_id(account_id)}{payload}\x00".encode("utf-8")


def game_user_packet(account_id: str) -> bytes:
    u = USERS[account_id]
    username = u["username"]
    name20 = fmt_name_20(u.get("display_username", username))
    data = USER_DB[username]
    
    # Get the live stats the server is already tracking
    stats = u.get("stats", {"score": 10000, "kills": 0, "deaths": 0, "bounty_points": 0})
    
    # 1. FIXED HEADER (Exactly 35 characters)
    weapon_2 = "00"
    hp_3 = f"{u.get('hp', 100):03d}"  # <-- Use live HP padded to 3 digits!
    
    # Graphics and Team (10 chars)
    gender_1 = str(data.get('gender', '1'))[:1]
    hm_2 = str(data.get('head_model', '0')).zfill(2)
    hc_2 = str(data.get('head_color', '0')).zfill(2)
    bm_2 = str(data.get('body_model', '0')).zfill(2)
    bc_2 = str(data.get('body_color', '0')).zfill(2)
    # Team Deathmatch players carry their team (2 = Team A, 3 = Team B);
    # FFA players keep the original "0".
    team_1 = str(u.get("team", TEAM_NONE))[:1]
    
    fixed_header = weapon_2 + hp_3 + name20 + gender_1 + hm_2 + hc_2 + bm_2 + bc_2 + team_1

    # 2. DELIMITED STATS (Exactly 4 semicolons required!)
    # <-- Use the live stats dictionary instead of hardcoded 0s!
    score = str(stats.get("score", 10000))
    kills = str(stats.get("kills", 0))
    deaths = str(stats.get("deaths", 0))
    bounty = str(stats.get("bounty_points", 0))
    
    stats_string = f"{score};{kills};{deaths};{bounty};"
    
    # 3. UPGRADES (Chunks of 3: 2 for weapon, 1 for flag). We can leave it blank.
    upgrades = ""
    
    # 4. WANTED BIT (Always the last character)
    wanted = str(data.get("wanted", "0"))

    # Combine all parts
    variable_data = stats_string + upgrades + wanted
    
    # Construct: U + WireID + FixedHeader + VariableData + Null
    payload = "U" + wire_id(account_id) + fixed_header + variable_data + "\x00"
    return payload.encode("utf-8")

def spawn_packet(account_id: str, x=200, y=200, direction=0, hp=100):
    # NOTE: opcode MUST be 1 char before the 3-char sender id
    # Using "1" here as a safe framing match; payload format may still need tuning.
    return f"1{wire_id(account_id)}{x};{y};{direction};{hp}\x00".encode("utf-8")

def spawn_player_packet(acc_id, x=200, y=200, direction=0, hp=100):
    return f"n{wire_id(acc_id)}{x},{y},{direction},{hp}\x00".encode("utf-8")



###############################################################################
# Room list / broadcast
###############################################################################

def build_room_list_bytes(server) -> bytes:
    out = "01"
    for room_name, room in list(server.rooms.items()):
        if room_name == "_":
            continue

        # Private games are never listed; players join them by typing the
        # exact name in "Join Private" (04/03 by name still work).
        if is_private_room(room):
            continue

        count = len(room["players"])

        # Hide full rooms (16 for FFA, 16 for 8v8 Team Deathmatch).
        if count >= room_capacity(room):
            continue
            
        out += f"{count:02d}{room_name};"
        
    out += "\x00"
    return out.encode("utf-8")

def broadcast_room_list_to_lobby(server):
    packet = build_room_list_bytes(server)
    for acc_id, u in USERS.items():
        if u.get("room") == "_":
            try:
                u["socket"].sendall(packet)
            except OSError:
                pass

###############################################################################
# Handler
###############################################################################

class FlashGameHandler(socketserver.BaseRequestHandler):
    def sync_lives(self, room, account=None, socket=None, restore_hp=False):
        if not room_is_tdm(room):
            return
        accounts = [account] if account is not None else list(room['players'])
        for target in accounts:
            user = USERS.get(target)
            if not user or target not in room['players']:
                continue
            suffix = f"H{max(0, min(100, user.get('hp', 100))):03d}" if restore_hp else ''
            payload = f"M{wire_id(target)}0v{life_limit(room)}{lives_left(room, target)}{suffix}\x00".encode('utf-8')
            peers = [socket] if socket is not None else [USERS[peer]['socket'] for peer in list(room['players']) if peer in USERS]
            for peer in peers:
                try:
                    peer.sendall(payload)
                except OSError:
                    pass

    def plant_item(self, room, weapon_id):
        """Confirm a placement with the deployable code understood by the SWF."""
        dep_code = {"07": "0", "08": "1", "17": "2", "19": "3"}.get(weapon_id)
        user = USERS.get(self.account_id, {})
        position = user.get("last_pos", "")
        if dep_code is None or len(position) != 10 or not position.isdigit():
            return
        if user.get("hp", 100) <= 0:
            return
        owner = wire_id(self.account_id)
        cell = position[:3] + position[5:8]
        with DEPLOYABLE_LOCK:
            deployables = room.setdefault("deployables", {})
            # A delayed/retried C4 placement must not leave orphaned charges.
            if dep_code == "2":
                for existing in deployables.values():
                    if existing[1:4] == owner and existing[4] == "2":
                        self.send((existing + "\x00").encode("utf-8"))
                        return
            if any(existing[7:13] == cell for existing in deployables.values()):
                return
            index = next((f"{i:02d}" for i in range(100) if f"{i:02d}" not in deployables), None)
            if index is None:
                return
            packet = f"n{owner}{dep_code}{index}{cell}"
            deployables[index] = packet
            room.setdefault("dep_health", {})[index] = {"0": 20, "1": 40, "2": 1, "3": 1}[dep_code]
            self.broadcast_to_room((packet + "\x00").encode("utf-8"))

    def damage_item(self, room, packet):
        if len(packet) < 8 or not packet[1:].isdigit():
            return
        index = packet[1:3]
        damage = int(packet[6:])
        if damage <= 0:
            return
        with DEPLOYABLE_LOCK:
            deployables = room.get("deployables", {})
            placed = deployables.get(index)
            if placed is None:
                return  # Already removed: do not emit a second explosion.
            dep_code = placed[4]
            if dep_code in ("2", "3"):
                # Mines and C4 report their own detonation from the owner's client.
                if placed[1:4] != wire_id(self.account_id) or packet[3:6] != placed[1:4]:
                    return
            health = room.setdefault("dep_health", {})
            default_hp = {"0": 20, "1": 40, "2": 1, "3": 1}.get(dep_code, 40)
            hp = max(0, health.get(index, default_hp) - damage)
            if hp == 0:
                del deployables[index]
                health.pop(index, None)
                # The short zero-HP form tells every client to explode this item,
                # attributing mines/C4 to their recorded owner.
                out = f"o{index}00\x00"
            else:
                health[index] = hp
                out = f"o{index}{hp:02d}\x00"
            self.broadcast_to_room(out.encode("utf-8"))
    def send(self, b: bytes):
        if isinstance(b, str):
            b = b.encode("utf-8")
        #print(f"[<] SEND len={len(b)} repr={repr(b)}")
        self.request.sendall(b)

    def send_private_lobby(self, packet: str):
        """
        Client sendPrivate(): "00" + targetID(3 digits) + "9" + encrypt(msg)
        Formerly restricted to lobby only. 
        NOW: Allowed in-game because Boxhead uses this for P2P state syncing.
        """
        # Must be at least: "00" + 3-digit id + "9x"
        if len(packet) < 6:
            return

        # --- DELETE OR COMMENT OUT THIS BLOCK ---
        # room_name = USERS[self.account_id].get("room")
        # if room_name != "_":
        #    return
        # ----------------------------------------

        target_wire = packet[2:5]
        payload = packet[5:]

        # Must be an encrypted "9..." payload (the client expects 9-prefixed messages)
        if not payload.startswith("9"):
            return

        # Find target account by slot/wire id
        target_acc = None
        for acc_id, u in USERS.items():
            if f"{u.get('slot', 0):03d}" == target_wire:
                target_acc = acc_id
                break

        if not target_acc:
            # Optional: Don't print this for every packet to reduce log spam
            # print(f"[PM] Target {target_wire} not online")
            return

        out = f"M{wire_id(self.account_id)}{payload}\x00".encode("utf-8")
        try:
            USERS[target_acc]["socket"].sendall(out)
            # Optional: Comment this out if logs get too spammy
            # print(f"[PM] {wire_id(self.account_id)} -> {target_wire}: {out!r}")
        except OSError:
            pass


    def relay_raw_to_room(self, room_name: str, raw_packet: str, include_self: bool = False):

        if not room_name or room_name not in self.server.rooms:
            return
        out = (raw_packet + "\x00").encode("utf-8")
        #print(f"[relay_raw] {wire_id(self.account_id)} -> room {room_name}: {raw_packet!r}")
        for peer_acc in self.server.rooms[room_name]["players"]:
            if not include_self and peer_acc == self.account_id:
                continue
            try:
                USERS[peer_acc]["socket"].sendall(out)
            except OSError:
                pass

    def relay_state_to_room(self, room_name, packet):
        if not room_name or room_name not in self.server.rooms:
            return
        
        sender_wire = wire_id(self.account_id)
        
        # Format the packet with Sender ID
        if packet.startswith("0l"):
            out_str = f"0l{sender_wire}{packet[2:]}"
        else:
            out_str = f"{packet[0]}{sender_wire}{packet[1:]}"
            
        out = out_str.encode("utf-8") + b"\x00"

        room = self.server.rooms[room_name]
        sent_count = 0
        
        for peer_acc in room["players"]:
             if peer_acc == self.account_id: continue
             if peer_acc in USERS:
                 try: 
                     USERS[peer_acc]["socket"].sendall(out)
                     sent_count += 1
                 except: pass
        
        # DEBUG PRINT
        # if sent_count > 0:
        #     #print(f"[RELAY] Relayed {out_str!r} to {sent_count} peers")
        # else:
        #     # If you see this, it means you are alone in the room or peers are diconnected
        #     pass


    def relay_chat9_to_room(self, room_name: str, packet: str, include_self: bool = False):
        """
        The client's sendMessage() sends: 9<encrypted>
        The receiver expects it wrapped as: M<senderID>9<encrypted>
        """
        if not room_name or room_name not in self.server.rooms:
            return
        out = f"M{wire_id(self.account_id)}{packet}\x00".encode("utf-8")
        for peer_acc in self.server.rooms[room_name]["players"]:
            if not include_self and peer_acc == self.account_id:
                continue
            try:
                USERS[peer_acc]["socket"].sendall(out)
            except OSError:
                pass

    def broadcast_to_room(self, message_bytes):
        """Sends bytes to everyone in the current user's room and logs it."""
        room_name = USERS.get(self.account_id, {}).get("room")
        if not room_name or room_name not in self.server.rooms:
            return
            
        players = self.server.rooms[room_name]["players"]
        for p_acc in list(players):
            if p_acc in USERS:
                try:
                    # Using sendall directly but adding a print so you can see it
                    USERS[p_acc]["socket"].sendall(message_bytes)
                except:
                    continue
        # This allows you to see the broadcast in your console logs
        #print(f"[BROADCAST] {repr(message_bytes)}")

    def leave_current_room(self, account_id: str):
        room_name = USERS.get(account_id, {}).get('room')
        room = self.server.rooms.get(room_name)
        if room is not None:
            with room_round_lock(room):
                return self._leave_current_room(account_id)
        return self._leave_current_room(account_id)

    def _leave_current_room(self, account_id: str):
        user = USERS.get(account_id)
        if not user:
            return

        room_name = user.get("room")
        if not room_name:
            return

        room = self.server.rooms.get(room_name)
        user["room"] = None

        if not room:
            return

        if account_id in room["players"]:
            room["players"].remove(account_id)

        # Clients remove a departing player's items; discard the matching server state.
        with DEPLOYABLE_LOCK:
            owner = wire_id(account_id)
            deployables = room.get("deployables", {})
            for index, placed in list(deployables.items()):
                if placed[1:4] == owner:
                    del deployables[index]
                    room.get("dep_health", {}).pop(index, None)

        # notify peers
        for peer_acc in list(room["players"]):
            peer = USERS.get(peer_acc)
            if not peer:
                continue
            try:
                peer["socket"].sendall(f"D{wire_id(account_id)}\x00".encode("utf-8"))
            except OSError:
                pass

        # cleanup empty non-lobby room
        if room_name != "_" and not room["players"]:
            #print(f"[x] Deleting empty room '{room_name}'")
            del self.server.rooms[room_name]
            broadcast_room_list_to_lobby(self.server)

    def remove_user(self, account_id: str):
        with SESSIONS_LOCK:
            user = USERS.get(account_id)
            if not user or user.get('socket') is not self.request or user.get('closing'):
                return
            user['closing'] = True
        # Keep the account reserved during room cleanup, without holding the
        # global session lock across room locks or socket/disk operations.
        try:
            self.leave_current_room(account_id)
        finally:
            try:
                self.request.close()
            except OSError:
                pass
            with SESSIONS_LOCK:
                if USERS.get(account_id) is user:
                    USERS.pop(account_id, None)
                    SLOTS.release(account_id)

    def _notify_round(self, room_name, room, payload):
        if self.server.rooms.get(room_name) is not room:
            return
        for account in list(room['players']):
            user = USERS.get(account)
            if user and user.get('room') == room_name:
                try:
                    user['socket'].sendall(payload.encode('utf-8'))
                except OSError:
                    pass

    def _start_next_round(self, room):
        # Called under the round lock, after the previous result was committed.
        room['round_id'] = uuid.uuid4().hex
        room['round_state'] = 'active'
        room['round_start'] = time.time()
        room['lives_left'] = {}
        for key in ('round_snapshot', 'round_awards', 'round_results_until',
                    'round_retry_at', 'round_save_in_progress'):
            room.pop(key, None)
        with CRATE_LOCK:
            room['crates'] = {}
        with DEPLOYABLE_LOCK:
            room['deployables'] = {}
            room['dep_health'] = {}
        for account in list(room['players']):
            user = USERS.get(account)
            if user is None:
                continue
            user['stats'] = {'score': 10000, 'kills': 0, 'deaths': 0, 'bounty_points': 0}
            user['hp'] = 100
            user['weapon'] = '00'
            for key in ('last_pos', 'last_state', 'position_history', 'position_history_room', 'claimed_deaths'):
                user.pop(key, None)

    def check_timer(self, room_name):
        if not room_name or room_name == '_':
            return
        room = self.server.rooms.get(room_name)
        if room is None:
            return
        start_next = False
        with room_round_lock(room):
            ensure_round_state(room)
            now = time.time()
            if room.get('round_save_in_progress'):
                return
            if room['round_state'] == 'ended':
                if now < room['round_results_until']:
                    return
                self._start_next_round(room)
                start_next = True
            else:
                if room['round_state'] == 'active':
                    play_seconds = max(0, room.get('round_length', 630) - ROUND_SUMMARY_SECONDS)
                    if now - room['round_start'] < play_seconds:
                        return
                    # Capture one immutable result before any disk or network I/O.
                    players = []
                    for account in sorted(room['players']):
                        info = USERS.get(account)
                        if info is not None and 'slot' in info:
                            stats = info.get('stats', {})
                            result = {key: int(stats.get(key, 10000 if key == 'score' else 0))
                                      for key in ('score', 'kills', 'deaths', 'bounty_points')}
                            result.update(slot=f"{int(info['slot']):03d}", username=info['username'])
                            players.append(result)
                    room['round_snapshot'] = players
                    room['round_state'] = 'finishing'
                if now < room.get('round_retry_at', 0):
                    return
                room['round_save_in_progress'] = True
                round_id = room['round_id']

        if start_next:
            self._notify_round(room_name, room, f"p{room.get('round_length', 630)}\x00")
            self.sync_lives(room)
            return
        try:
            awards = self.get_awards_and_save_db(room_name, room)
        except Exception as error:
            # Keep the same ID and frozen result; retry only after a short delay.
            with room_round_lock(room):
                room['round_save_in_progress'] = False
                room['round_retry_at'] = time.time() + ROUND_SAVE_RETRY_SECONDS
            print(f'[ROUND SAVE] {round_id} pending; will retry: {error}')
            return

        # Results have committed. Sending/UI/leaderboard failures cannot resubmit.
        try:
            self._notify_round(room_name, room, f'0r{awards}\x00p{ROUND_SUMMARY_SECONDS}\x00')
        finally:
            with room_round_lock(room):
                room['round_awards'] = awards
                room['round_state'] = 'ended'
                room['round_results_until'] = time.time() + ROUND_SUMMARY_SECONDS
                room['round_save_in_progress'] = False
        if room_is_unranked(room):
            kind = 'Team Deathmatch' if room_is_tdm(room) else 'Private'
            if room_is_tdm(room) and is_private_room(room):
                kind = 'Private Team Deathmatch'
            print(f'[ROUND END] {round_id} {kind} round finished; stats not saved')
            return
        print(f'[ROUND SAVE] {round_id} saved once for {len(room["round_snapshot"])} players')
        update_most_wanted_xml()

    def get_awards_and_save_db(self, room_name, room=None):
        if room is None:
            room = self.server.rooms.get(room_name)
        if room is None:
            return '000' * 5
        with room_round_lock(room):
            if 'round_snapshot' not in room:
                raise RuntimeError('Round has no frozen results')
            round_id = room['round_id']
            players = [player.copy() for player in room['round_snapshot']]
        if room_is_unranked(room):
            # Team Deathmatch and private rounds are unranked: the summary screen
            # still gets its awards, but kills/deaths/wins/losses/bounty are never saved.
            return calculate_round_awards(players)[0]
        return commit_round_results(round_id, players)

    def handle_packet(self, packet):
        if not packet:
            return
        user = USERS.get(getattr(self, 'account_id', None))
        if getattr(self, 'account_id', None) is not None and (
                not user or user.get('socket') is not self.request or user.get('closing')):
            return
        room_name = user.get('room') if user else None
        if room_name:
            self.check_timer(room_name)
        # A late damage/pickup packet cannot change a round being saved or shown.
        gameplay = packet.startswith(('1', '4', '6', '7', '8', 'o', '0k', '0l', '0m', '0q'))
        room = self.server.rooms.get(room_name) if room_name and room_name != '_' else None
        if gameplay and packet.startswith('0k') and room_is_tdm(room):
            # Team picks do not affect saved results, and dropping one during
            # the summary screen would leave the client on the wrong team.
            gameplay = False
        if room_is_infected(room) and packet.startswith(('4', '6', 'o')) and round_remaining(room) > 570:
            return  # Preparation: displayed timer is internal remaining minus 30.
        if room is not None and gameplay:
            with room_round_lock(room):
                ensure_round_state(room)
                if room['round_state'] != 'active' or USERS.get(self.account_id, {}).get('room') != room_name:
                    return
                return self._handle_packet(packet)
        return self._handle_packet(packet)

    def _handle_packet(self, packet: str):
        if not packet:
            return
        

        #print(f"[>] Received packet: {repr(packet)}")

        # POLICY FILE
        if packet == "<policy-file-request/>":
            policy = (
                '<?xml version="1.0"?>'
                '<cross-domain-policy>'
                '<allow-access-from domain="*" to-ports="6123"/>'
                '</cross-domain-policy>\x00'
            )
            self.send(policy.encode("utf-8"))
            return
        
        # ACCOUNT REGISTRATION REQUEST
        # Kept separate from login so an unknown username cannot be created by
        # merely pressing Login. The matching SWF sends this only from Submit
        # on the Create Account page.
        elif packet.startswith("0a"):
            if getattr(self, 'account_id', None) is not None:
                self.send(b"Z0Already logged in\x00")
                return
            creds = packet[2:]
            if ";" not in creds:
                self.send(b"Z0Bad registration format\x00")
                return

            submitted_username, password = creds.split(";", 1)
            allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,"
            if not (3 <= len(submitted_username) <= 20) or any(ch not in allowed for ch in submitted_username):
                self.send(b"Z0Invalid User Name (3-20 characters required)\x00")
                return
            if not (3 <= len(password) <= 20) or any(ch not in allowed for ch in password):
                self.send(b"Z0Invalid Password (3-20 characters required)\x00")
                return

            username = submitted_username.casefold()
            with USER_DB_LOCK:
                recover_pending_round_export()
                if username in USER_DB:
                    acc_id = None
                else:
                    acc_id = save_user(submitted_username, password)

            if acc_id is None:
                self.send(b"Z0Account already exists\x00")
            else:
                self.send(b"Z1\x00")
                print(f"[+] Created account '{submitted_username}'")
            return

        # AUTH REQUEST
        elif packet.startswith("09"):
            # A connection cannot replace its identity after logging in.
            if getattr(self, 'account_id', None) is not None:
                return
            creds = packet[2:]
            if ";" not in creds:
                self.send(b"10;0;Bad format\x00")
                return

            submitted_username, password = creds.split(";", 1)
            username = submitted_username.casefold()
            pwd_hash = md5_hash(password)

            self.send(b"00;1\x00")
            #print("[<] Sent delayed handshake")

            # Registration and lookup must be atomic: this server handles
            # clients on separate threads, so two case variants can otherwise
            # both observe a missing username and create separate records.
            with USER_DB_LOCK:
                recover_pending_round_export()
                existing_user = USER_DB.get(username)
                if existing_user is not None:
                    stored_hash = existing_user["password_hash"]
                    acc_id = existing_user["account_id"]
                    if pwd_hash != stored_hash:
                        acc_id = None
                        auth_error = "Incorrect password"
                    else:
                        auth_error = None
                else:
                    acc_id = None
                    auth_error = "Account does not exist"

                display_username = USER_DB[username].get("username", username) if acc_id is not None else username

            if acc_id is None:
                self.send(f"10;0;{auth_error}\x00".encode("utf-8"))
                return

            client_ip = self.client_address[0]
            banned_ips = []
            if os.path.exists("banlist.txt"):
                with open("banlist.txt", "r", encoding="utf-8") as stream:
                    banned_ips = [line.strip() for line in stream if line.strip()]
            if client_ip in banned_ips:
                self.send(b"10;0;Banned\x00")
                return

            with SESSIONS_LOCK:
                if acc_id in USERS:
                    error = b"10;0;Account already logged in\x00"
                elif not SLOTS.free:
                    error = b"10;0;Server full\x00"
                else:
                    error = None
                    USERS[acc_id] = {
                        "username": username, "display_username": display_username,
                        "socket": self.request, "room": None,
                        "slot": SLOTS.allocate(acc_id), "session_id": uuid.uuid4().hex,
                        "hp": 100, "score": 1000, "kills": 0,
                        "deaths": 0, "bounty_points": 0,
                    }
                    self.username = username
                    self.account_id = acc_id
            if error is not None:
                self.send(error)
                return
            login_ack = f"10;1;{acc_id};{display_username};{display_username};{pwd_hash};1\x00"
            self.send(login_ack.encode("utf-8"))
            log_player_ip(display_username, client_ip)

            self.send(auth_packet(acc_id))
            self.send(b"0p\x00")
            return

        # Everything below requires auth
        elif (not getattr(self, "account_id", None)
              or USERS.get(self.account_id, {}).get("socket") is not self.request):
            # ignore any pre-auth junk
            return

        # MODERATOR WARNING
        # Client packet: 0g + target wire ID (3 characters) + warning text.
        # The target client expects the private server packet: 0g + warning text.
        elif packet.startswith("0g"):
            if not account_is_moderator(self.account_id):
                print(f"[MOD WARN] Denied non-moderator warning from {self.username}")
                return

            if len(packet) < 6:
                return

            target_wire = packet[2:5]
            if not target_wire.isascii() or not target_wire.isdigit():
                return

            # Do not allow control characters to alter packet or chat display.
            message = "".join(char for char in packet[5:] if ord(char) >= 32)
            message = message.strip()[:MAX_WARNING_MESSAGE_LENGTH]
            if not message:
                return

            target_account_id = next(
                (account_id for account_id in tuple(USERS)
                 if wire_id(account_id) == target_wire),
                None,
            )
            target_user = USERS.get(target_account_id)
            if not target_user:
                return

            try:
                target_user["socket"].sendall(f"0g{message}\x00".encode("utf-8"))
                print(
                    f"[MOD WARN] {USERS[self.account_id]['display_username']} -> "
                    f"{target_user.get('display_username', target_user['username'])}: {message}"
                )
            except OSError:
                pass
            return

        # MODERATOR BAN (/ban)
        # Client packet: 0e + target id + ";" + minutes + ";" + message.
        # Bans are not implemented on this server yet. This handler only makes
        # sure the packet is NEVER relayed: the generic relay at the bottom used to
        # forward it to the whole lobby, and every client that receives "0e"
        # treats it as "you are banned" and signs out.
        elif packet.startswith("0e"):
            if account_is_moderator(self.account_id):
                print(f"[MOD BAN] {USERS[self.account_id]['display_username']} tried /ban "
                      f"({packet[2:80]!r}); bans are not enabled on this server")
            else:
                print(f"[MOD BAN] Denied non-moderator ban packet from {self.username}")
            return

        # JOIN ROOM
        elif packet.startswith("03"):
            requested_name = normalize_room_name(packet[2:])
            # "Join Private" sends whatever the player typed; resolve it to the real
            # room name (exact match first, then ignoring case/spaces/punctuation).
            room_name = find_room_name(self.server, requested_name) or requested_name

            # Validate the destination BEFORE leaving the current room. The client
            # treats any "C<own id>" as "joined the room I asked for", so silently
            # redirecting to the lobby would put it on a game screen it isn't in.
            # "099" makes the lobby show "Game not found" and stay usable.
            target_room = self.server.rooms.get(room_name)
            if target_room is None:
                print(f"[!] Missing room '{room_name}', rejecting join from {self.username}.")
                self.send(ROOM_JOIN_ERROR)
                return
            if room_name != "_" and len(target_room["players"]) >= room_capacity(target_room):
                print(f"[!] Room '{room_name}' is full! Rejecting join from {self.username}.")
                self.send(ROOM_JOIN_ERROR)
                return

            old_room = USERS[self.account_id].get("room")
            if old_room:
                # notify peers in old room BEFORE switching
                for peer_acc in list(self.server.rooms.get(old_room, {}).get("players", [])):
                    if peer_acc != self.account_id:
                        try:
                            USERS[peer_acc]["socket"].sendall(
                                f"D{wire_id(self.account_id)}\x00".encode("utf-8")
                            )
                        except OSError:
                            pass

            # now actually leave
            self.leave_current_room(self.account_id)

            if self.account_id in USERS:
                USERS[self.account_id]["stats"] = {
                    "score": 10000, 
                    "kills": 0, 
                    "deaths": 0, 
                    "bounty_points": 0
                }
                # Also reset temporary health/state if needed
                USERS[self.account_id]["hp"] = 100
                USERS[self.account_id]["last_state"] = None
                # Every room join starts without a team; TDM players pick one in-game.
                USERS[self.account_id]["team"] = TEAM_NONE
                #print(f"[*] Session reset for {self.username}. Score set to 10000.")

            #print(f"[=] User {wire_id(self.account_id)} joining room: {room_name}")

            if room_name not in self.server.rooms:
                # The room emptied and was deleted between validation and leaving.
                print(f"[!] Room '{room_name}' disappeared during join from {self.username}.")
                self.send(ROOM_JOIN_ERROR)
                return

            room = self.server.rooms[room_name]
            room["players"].add(self.account_id)
            USERS[self.account_id]["room"] = room_name
            if eliminated(room, self.account_id):
                USERS[self.account_id]["hp"] = 0

            # tell self it joined; game rooms append the mode ("A" FFA, "B" TDM),
            # which the patched client uses to pick the game type. Older clients
            # only read the first 3 id characters and ignore it.
            mode_suffix = "" if room_name == "_" else room.get("mode", GAME_MODE_FFA)
            self.send(f"C{wire_id(self.account_id)}{mode_suffix}\x00".encode("utf-8"))

            # IMPORTANT: send self game handshake
            self.send(game_user_packet(self.account_id))
            # Blasting "100" into the positional and state slots 
            self.send(f"M{wire_id(self.account_id)}6100\x00".encode("utf-8"))


            # sync peers
            for peer_acc in list(room["players"]):
                if peer_acc == self.account_id:
                    continue

                # tell self about peer
                self.send(f"C{wire_id(peer_acc)}\x00".encode("utf-8"))
                if room_name == "_" and USERS[peer_acc].get("room") == "_":
                    self.send(lobby_user_packet(peer_acc))

                # tell peer about self
                try:
                    peer_sock = USERS[peer_acc]["socket"]
                    if room_name == "_":
                        peer_sock.sendall(f"C{wire_id(self.account_id)}\x00".encode("utf-8"))
                        peer_sock.sendall(lobby_user_packet(self.account_id))
                except OSError:
                    pass


            # after lobby join, send room list
            if room_name == "_":
                self.send(build_room_list_bytes(self.server))
                #print("[<] Lobby join completed.")
                return

            # joining a game room -> send timer/settings/RGI
            if room.get("round_start") is None:
                room["round_start"] = time.time()

            remaining = round_remaining(room)

            # Send timer to the joiner (and also send to everyone, so both clients stay synced)
            for peer_acc in room["players"]:
                try:
                    USERS[peer_acc]["socket"].sendall(f"p{remaining}\x00".encode("utf-8"))
                except OSError:
                    pass

            # --- NATIVE CRATE SYNC ---
            # 's' is the opcode for existingPickupsString, NOT settings!
            with CRATE_LOCK:
                existing_crates_str = "".join(c["str"] for c in room.get("crates", {}).values())
                self.send(f"s{existing_crates_str}\x00".encode("utf-8"))
            
            self.send(f"R{wire_id(self.account_id)}\x00".encode("utf-8"))
            self.send(f"G{wire_id(self.account_id)}\x00".encode("utf-8"))
            self.send(f"I{wire_id(self.account_id)}\x00".encode("utf-8"))


            # AFTER all C packets
            for peer_acc in room["players"]:
                if peer_acc == self.account_id:
                    continue

                # send peer handshake to self
                self.send(game_user_packet(peer_acc))

                # send self handshake to peer
                # send self to existing peer (CREATE + HANDSHAKE)
                peer_sock = USERS[peer_acc]["socket"]
                peer_sock.sendall(f"C{wire_id(self.account_id)}\x00".encode("utf-8"))
                peer_sock.sendall(game_user_packet(self.account_id))

                # "Spawn" via last known real state packet (do NOT invent a semicolon payload)
                # 1) Send existing players' last_state to the joiner (so they appear immediately if they have moved once)
                for peer_acc in room["players"]:
                    if peer_acc == self.account_id:
                        continue
                    last = USERS.get(peer_acc, {}).get("last_state")
                    if last:
                        # last is like: "10575001250000" (no sender id inside it)
                        # relay_state_to_room injects sender, but here we want "from peer_acc -> self"
                        opcode = last[:1]
                        payload = last[1:]
                        self.send(f"{opcode}{wire_id(peer_acc)}{payload}\x00".encode("utf-8"))

                # 2) Send joiner’s last_state to everyone else (if they already emitted one)
                my_last = USERS.get(self.account_id, {}).get("last_state")
                if my_last:
                    opcode = my_last[:1]
                    payload = my_last[1:]
                    # encode() creates bytes
                    out = f"{opcode}{wire_id(self.account_id)}{payload}\x00".encode("utf-8")
                    for peer_acc in room["players"]:
                        if peer_acc == self.account_id:
                            continue
                        try:
                            # FIX 1: removed .encode("utf-8") because 'out' is already bytes
                            USERS[peer_acc]["socket"].sendall(out)
                        except OSError:
                            pass

                # --- SYNC EXISTING PLAYERS HEALTH & WEAPONS FOR JOINER ---
                for peer_acc in room["players"]:
                    if peer_acc == self.account_id:
                        continue
                    
                    # 1. Sync the exact live health bar (Opcode 8)
                    # Format: 8 + SystemAttacker(000) + Target(3) + HP(3)
                    live_hp = USERS[peer_acc].get("hp", 100)
                    health_sync = f"8000{wire_id(peer_acc)}{live_hp:03d}\x00"
                    self.send(health_sync.encode("utf-8"))
                    
                    # 2. Sync their currently equipped weapon (Opcode 0q)
                    # Format: M + Sender(3) + 0q + Weapon(2)
                    live_weapon = USERS[peer_acc].get("weapon", "00")
                    weapon_sync = f"M{wire_id(peer_acc)}0q{live_weapon}\x00"
                    self.send(weapon_sync.encode("utf-8"))

                # --- SPAWN JOINER FOR EXISTING PLAYERS ---
                # REMOVED: spawn = spawn_packet(self.account_id) <--- DELETE THIS LINE
                
                # --- SPAWN JOINER FOR EXISTING PLAYERS ---
                for peer_acc in room["players"]:
                    if peer_acc == self.account_id:
                        continue
                    
                    # Tell the existing peer that the joiner has spawned!
                    USERS[peer_acc]["socket"].sendall(
                        f"M{wire_id(self.account_id)}6100\x00".encode("utf-8")
                    )

        # === NEW: RELAY MOVEMENT & ACTIONS ===
        # === MOVEMENT (Types 1, 4) ===
        elif packet.startswith("1") or packet.startswith("4"):
            if self.account_id not in USERS: return
            
            # FIX: Force slot to be a string (e.g. 1 -> "1")
            slot = str(USERS[self.account_id]["slot"])
            
            current_room_name = USERS[self.account_id].get("room")
            if not current_room_name or current_room_name not in self.server.rooms:
                return

            room = self.server.rooms[current_room_name]
            room["players"].add(self.account_id)
            if packet.startswith("4") and eliminated(room, self.account_id):
                return

            raw = packet[1:] # Strip Type (e.g. "1")

            # Store last known position for deploying items
            if packet.startswith("1") and len(packet) >= 11:
                # Opcode 1 contains the 10-digit position right after the "1"
                USERS[self.account_id]["last_pos"] = packet[1:11]
                remember_walkable_position(USERS[self.account_id], current_room_name, packet[1:11])
            
            if len(raw) >= 10:
                # 1. READ 5 DIGITS (e.g., "05175")
                x_str = raw[0:5]
                y_str = raw[5:10]
                rest = raw[10:]
                
                try:
                    # 2. 5-Digit Precision Fix
                    val_x = int(x_str)
                    val_y = int(y_str)
                    
                    x_final = str(val_x).zfill(5)
                    y_final = str(val_y).zfill(5)

                    # 3. CONSTRUCT PAYLOAD
                    safe_slot = slot.zfill(3)
                    payload = "M" + safe_slot + packet[0] + x_final + y_final + rest
                        
                except ValueError:
                    # Fallback
                    payload = "M" + slot.zfill(3) + packet
            else:
                payload = "M" + slot.zfill(3) + packet

            # Plant barrels, barricades, C4 and mines using the client's wire codes.
            if packet.startswith("4"):
                self.plant_item(room, USERS[self.account_id].get("weapon", "00"))

            if packet.startswith("4"):
                    current_weapon = USERS[self.account_id].get("weapon", "00")
                    
                    # 00 = Pistol, 01 = Uzi (Check your logs if Uzi is different!)
                    if current_weapon in ["00", "01", "02", "03", "04", "05", "11", "13", "14", "15", "16", "20", "21"]:
                        last_pos = USERS[self.account_id].get("last_pos")
                        
                        if last_pos and len(last_pos) >= 10 and len(packet) >= 4:
                            # Grab player grid X/Y and firing angle
                            grid_x = int(last_pos[0:3])
                            grid_y = int(last_pos[5:8])
                            angle = int(packet[1:4])
                            
                            # Boxhead Flash angles: 0=Right, 90=Down, 180=Left, 270=Up
                            rad = math.radians(angle)
                            dx = math.cos(rad)
                            dy = math.sin(rad)
                            
                            hit_idx = None
                            
                            # Shoot an invisible ray up to 15 tiles outward
                            for step_half in range(1, 30):
                                step = step_half / 2.0
                                check_x = grid_x + int(dx * step)
                                check_y = grid_y + int(dy * step)
                                
                                # Check against all deployed barricades
                                if "deployables" in room:
                                    for uid, n_pack in list(room["deployables"].items()):
                                        # n_pack = 'n001103030066' (len 13)
                                        if len(n_pack) >= 13 and n_pack[4] not in ("2", "3"):
                                            dep_idx = n_pack[5:7]
                                            dep_x = int(n_pack[7:10])
                                            dep_y = int(n_pack[10:13])
                                            
                                            # If ray touches the barricade's grid cell
                                            if check_x == dep_x and check_y == dep_y:
                                                hit_idx = dep_idx
                                                break
                                if hit_idx:
                                    break

                            # TEAM DEATHMATCH: a teammate's barrel/barricade blocks the
                            # shot but takes no damage (matches the client's rule).
                            if hit_idx and room_is_tdm(room):
                                hit_pack = room.get("deployables", {}).get(hit_idx, "")
                                if same_team(room, account_by_wire(room, hit_pack[1:4]), self.account_id):
                                    hit_idx = None

                            # If we hit something, apply 10 damage!
                            # If we hit something, apply accurate weapon damage!
                            if hit_idx:
                                if "dep_health" not in room:
                                    room["dep_health"] = {}
                                current_hp = room["dep_health"].get(hit_idx, 40)
                                
                                # Map the weapon ID to its actual damage
                                # 00 = Pistol (7 dmg), 01 = Uzi (Change this to Uzi's true damage!)
                                weapon_damage = {"00": 7, "02": 5, "03": 6, "04": 8, "05": 3, "06": 55, "07": 35, "11": 45, "13": 9, "14": 10, "15": 25, "16": 50, "17": 40, "18": 75, "19": 30, "20": 55, "21": 60} 
                                
                                # Deduct the exact damage for the currently equipped weapon
                                applied_damage = weapon_damage.get(current_weapon, 7)
                                current_hp -= applied_damage
                                
                                room["dep_health"][hit_idx] = current_hp
                                
                                if current_hp <= 0:
                                    # Barricade destroyed by server physics!
                                    if "deployables" in room:
                                        room["deployables"].pop(hit_idx, None)
                                        room.get("dep_health", {}).pop(hit_idx, None)
                                            
                                    payload_bytes = (f"o{hit_idx}00\x00").encode("utf-8")
                                else:
                                    # Send safe health sync
                                    hp_str = str(current_hp).zfill(2)
                                    payload_bytes = (f"o{hit_idx}{hp_str}\x00").encode("utf-8")
                                    
                                # Broadcast the hit to EVERYONE
                                for peer_acc in list(room["players"]):
                                    if peer_acc in USERS:
                                        try: USERS[peer_acc]["socket"].sendall(payload_bytes)
                                        except OSError: pass

            # 4. BROADCAST SHOOTING/MOVEMENT TO PEERS
            # We skip the sender here so they don't get duplicate shooting sounds
            for peer_acc in list(room["players"]):
                if peer_acc == self.account_id: continue
                if peer_acc in USERS:
                    try: 
                        USERS[peer_acc]["socket"].sendall(payload.encode("utf-8") + b"\x00")
                    except OSError: 
                        pass

        # Deployable damage and owner-confirmed C4/mine detonations.
        elif packet.startswith("o"):
            room_name = USERS[self.account_id].get("room")
            room = self.server.rooms.get(room_name)
            if room and not eliminated(room, self.account_id):
                self.damage_item(room, packet)
            return
        
        # === 2. SHOOTING (Types 2, 3) ===
        elif packet.startswith("2") or packet.startswith("3"):
            # Retrieve room safely
            if self.account_id in USERS:
                current_room_name = USERS[self.account_id].get("room")
                if current_room_name and current_room_name in self.server.rooms:
                    room = self.server.rooms[current_room_name]
                    
                    # Just insert ID and forward
                    payload = packet[0] + self.account_id.zfill(3) + packet[1:]
                    
                    for peer_acc in list(room["players"]):
                        if peer_acc == self.account_id: continue
                        if peer_acc in USERS:
                            try: USERS[peer_acc]["socket"].sendall(payload.encode("utf-8") + b"\x00")
                            except: pass

        # ROOM LIST REQUEST
        elif packet == "01":
            self.send(build_room_list_bytes(self.server))
            return
        
        # === ROOM INFO REQUEST (04) ===
        elif packet.startswith("04"):
            # The game requests info using the name the player typed, which may
            # be a loose match for a private room (see find_room_name).
            room_name = find_room_name(self.server, normalize_room_name(packet[2:]))
            room = self.server.rooms.get(room_name) if room_name else None
            
            if not room or room_name == "_":
                return

            # Pull header saved during 02 (Fallback to "100" just in case)
            header = room.get("header", "100")
            gameType = header[0] if len(header) > 0 else "1"
            useCustom = header[1] if len(header) > 1 else "0"
            
            # The map ID is the first character in the settings_string (e.g. "D" from "DECBAGF")
            settings = room.get("settings_string", "")
            mapID = settings[0] if settings else "A"
            
            players = f"{len(room['players']):02d}"

            # Calculate time
            remaining = round_remaining(room)

            msg = f"04{gameType}{useCustom}{mapID}{players}{remaining}\x00"
            self.send(msg.encode("utf-8"))
            return

        # === CREATE ROOM (02) ===
        elif packet.startswith("02"):
            payload = packet[2:]
            if ";" not in payload:
                return

            header = payload[:3]  # gameType(1)/useCustom(1)/isPrivate(1)
            rest = payload[3:]
            room_part, settings = rest.split(";", 1)

            room_name = normalize_room_name(room_part)
            if not room_name or room_name.strip() == "":
               # print(f"[-] Blocked blank room creation attempt by {self.username}")
                # Send a harmless baseline response so the client doesn't freeze
                self.send(b"01\x00")
                return
            name_key = room_name_key(room_name)
            if (room_name == "_" or room_name in self.server.rooms or
                    (name_key and any(room_name_key(name) == name_key
                                      for name in list(self.server.rooms) if name != "_"))):
                # Never overwrite a live room: that let a public room take over a
                # private one (exposing its players) or turn a public room private.
                # Loose duplicates are refused too so "Join Private" stays unambiguous.
                # The client shows "Room name already in use" and stays in the lobby.
                print(f"[!] {self.username} tried to create '{room_name}', which already exists.")
                self.send(ROOM_JOIN_ERROR)
                return
            settings = settings.strip()

            # First header character is the game type: "A" = FFA, "B" = Team Deathmatch.
            mode = header[:1] if header[:1] in GAME_MODES else GAME_MODE_FFA
            settings, lives = split_lives_settings(settings, mode)

            self.leave_current_room(self.account_id)

            self.server.rooms[room_name] = {
                "name": room_name,
                "settings_string": settings,
                "header": header,  # FIX: Store the header so 04 can use it!
                "mode": mode,
                "lives": lives,
                "lives_left": {},
                "players": {self.account_id},
                "round_start": time.time(),
                "round_length": 630,
                "crates": {}
            }
            creator = USERS[self.account_id]
            creator["room"] = room_name
            # Fresh round state for the creator (joiners get the same reset in "03").
            creator["stats"] = {"score": 10000, "kills": 0, "deaths": 0, "bounty_points": 0}
            creator["hp"] = 100
            creator["last_state"] = None
            creator["team"] = TEAM_NONE

            print(f"[+] {self.username} created {'private ' if header[2:3] == '1' else ''}{'Team Deathmatch' if mode == GAME_MODE_TDM else 'FFA'} room '{room_name}'")

            # Tell creator it joined (with the room's game mode)
            self.send(f"C{wire_id(self.account_id)}{mode}\x00".encode("utf-8"))

            # Now initialize creator like a game-room joiner
            room = self.server.rooms[room_name]
            remaining = room["round_length"]
            self.send(f"p{remaining}\x00".encode("utf-8"))
            self.send(f"s{room['settings_string']}\x00".encode("utf-8"))
            self.send(f"R{wire_id(self.account_id)}\x00".encode("utf-8"))
            self.send(f"G{wire_id(self.account_id)}\x00".encode("utf-8"))
            self.send(f"I{wire_id(self.account_id)}\x00".encode("utf-8"))

            # Send creator's own game handshake
            self.send(game_user_packet(self.account_id))

            broadcast_room_list_to_lobby(self.server)
            return


        # PING ECHO
        elif packet.startswith("9?"):
            idx = packet[2:]
            msg = f"M{wire_id(self.account_id)}9?{idx}\x00"
            self.send(msg.encode("utf-8"))
            return

        #######################################################################
        # GAME / LOBBY TRAFFIC
        #######################################################################


        # Catches Move(1), Rotate(8), Shoot(4), and Loadout(0l)
        elif packet.startswith(("8")) or packet.startswith("0l"):
            # 1. Save state (moved from top of function)
            if packet.startswith("8"):
                    room = self.server.rooms.get(USERS[self.account_id].get("room"))
                    if eliminated(room, self.account_id):
                        self.sync_lives(room, self.account_id, self.request)
                        return
                    current_hp = USERS[self.account_id].get("hp", 100)
                    if current_hp <= 0:
                        USERS[self.account_id]["hp"] = 100
                        new_hp = 100
                        #self.broadcast_to_room(f"M{int(self.account_id):03d}6{new_hp:03d}\x00".encode("utf-8"))
                        self.broadcast_to_room(f"M{int(wire_id(self.account_id)):03d}6{new_hp:03d}\x00".encode("utf-8"))
                        #(f"[SYSTEM] Reset HP for {self.username} (Respawn via Opcode 8)")
            
            # 2. Relay (now guaranteed to run)
            room_name = USERS[self.account_id].get("room")
            if room_name:
                self.relay_state_to_room(room_name, packet)
            return
        
        # === 1. Damage / Kill Logic (Opcode 6) ===
        elif packet.startswith("6"):
            if len(packet) < 8: return
            
            # 1. Parse Attacker, Weapon, and Damage from incoming packet (e.g., '60010007')
            raw_attacker = packet[1:4]  # Extracts '001'
            raw_weapon = packet[4:6]    # Extracts '00'
            try:
                damage = int(packet[6:])
                if damage <= 0:
                    return
            except:
                return

            target_acc = self.account_id
            if not target_acc or target_acc not in USERS:
                return

            # TEAM DEATHMATCH: no friendly fire. The patched client already
            # ignores teammate hits; this keeps server HP authoritative anyway.
            damage_room = self.server.rooms.get(USERS[target_acc].get("room"))
            if eliminated(damage_room, target_acc) or eliminated(damage_room, account_by_wire(damage_room, raw_attacker)):
                self.sync_lives(damage_room, target_acc, self.request, restore_hp=True)
                return
            if room_is_tdm(damage_room) and same_team(
                    damage_room, account_by_wire(damage_room, raw_attacker), target_acc):
                return

            # GUARD: Stop if already dead to prevent infinite loop
            current_hp = USERS[target_acc].get("hp", 100)
            if current_hp <= 0:
                return

            new_hp = max(0, current_hp - damage)
            USERS[target_acc]["hp"] = new_hp
            
            # 2. Correctly retrieve the slot for the target
            # Use USERS[target_acc]['slot'] instead of self.slot
            target_slot_val = USERS[target_acc].get("slot", 0)
            
            # 3. Format IDs to exact widths (3 for Target/Killer, 2 for Weapon)
            target_wire = f"{int(target_slot_val):03d}"
            attacker_wire = f"{int(raw_attacker):03d}"
            weapon_wire = f"{int(raw_weapon):02d}"

            if new_hp > 0:
                # Normal damage update
                self.broadcast_to_room(f"M{target_wire}6{new_hp:03d}\x00".encode("utf-8"))
            else:
                # --- 1. KILL & DEATH TRACKING ---
                target_info = USERS.get(target_acc)
                target_info.setdefault("stats", {"score": 10000, "kills": 0, "deaths": 0, "bounty_points": 0})
                target_info["stats"]["deaths"] += 1
                if life_limit(damage_room):
                    damage_room.setdefault("lives_left", {})[target_acc] = max(0, lives_left(damage_room, target_acc) - 1)
                
                room_name = target_info.get("room")
                
                # Find the attacker by their slot ID to give them the kill
                attacker_acc = None
                for a_id, a_info in USERS.items():
                    if a_info.get("room") == room_name and str(a_info.get("slot", "")) == str(int(raw_attacker)):
                        attacker_acc = a_id
                        break
                        
                if attacker_acc:
                    a_info = USERS[attacker_acc]
                    a_info.setdefault("stats", {"score": 10000, "kills": 0, "deaths": 0, "bounty_points": 0})
                    a_info["stats"]["kills"] += 1

                # --- 2. KILL BROADCAST & CRATE SPAWN ---
                attacker_wire = f"{int(raw_attacker):03d}"
                weapon_wire = f"{int(raw_weapon):02d}"
                dead_pos = target_info.get("last_pos", "0050000500")
                
                # Calculate 10% of score, rounded up to the nearest $250.
                # Integer arithmetic keeps the rounding exact for large scores.
                target_score = target_info.get("stats", {}).get("score", 10000)
                bounty_value = ((max(0, int(target_score)) + 2499) // 2500) * 250
                
                # Drop only the crates funded by the rounded 10% bounty, up to
                # ten crates ($10,000 base value before client wallet bonuses).
                # Do not add extra crates just to reach the limit.
                crates_to_spawn = []
                while bounty_value >= 1000 and len(crates_to_spawn) < MAX_CRATES_PER_DEATH:
                    crates_to_spawn.append(2)
                    bounty_value -= 1000
                while bounty_value >= 500 and len(crates_to_spawn) < MAX_CRATES_PER_DEATH:
                    crates_to_spawn.append(1)
                    bounty_value -= 500
                while bounty_value >= 250 and len(crates_to_spawn) < MAX_CRATES_PER_DEATH:
                    crates_to_spawn.append(0)
                    bounty_value -= 250

                # # Generate 9 distinct tile offsets (Center + 8 adjacent)
                # TILE_SIZE = 100 # If the crates barely separate visually, change this to 500
                # grid_offsets = [(dx * TILE_SIZE, dy * TILE_SIZE) for dx in [-1, 0, 1] for dy in [-1, 0, 1]]
                # random.shuffle(grid_offsets)

                # --- NEW: CALCULATE BOUNTY POINTS (BP) BASED ON RANK ---
                death_bp = 0
                death_id = f"{target_acc}_{int(time.time() * 1000)}" # Unique ID for this specific death event
                
                with CRATE_LOCK:
                    bounty_str = ""
                    if room_name and room_name in self.server.rooms:
                        room = self.server.rooms[room_name]
                        room.setdefault("crates", {})
                    
                        # 1. Determine the victim's rank to calculate BP worth
                        players_in_room = list(room["players"])
                        num_players = len(players_in_room)
                    
                        # Sort by score descending to find rank
                        players_in_room.sort(key=lambda acc: USERS.get(acc, {}).get("stats", {}).get("score", 10000), reverse=True)
                        try:
                            victim_rank = players_in_room.index(target_acc) + 1 # 1st = 1, 2nd = 2, etc.
                        except ValueError:
                            victim_rank = num_players # Fallback

                        # 2. Assign BP based on room size and victim's rank
                        if num_players >= 16:
                            if victim_rank == 1: death_bp = 6
                            elif victim_rank == 2: death_bp = 5
                            elif victim_rank == 3: death_bp = 4
                            else: death_bp = 3
                        elif 8 <= num_players <= 15:
                            if victim_rank == 1: death_bp = 4
                            elif victim_rank == 2: death_bp = 3
                            #elif victim_rank == 3: death_bp = 1
                            else: death_bp = 2
                        elif 5 <= num_players <= 7:
                            if victim_rank == 1: death_bp = 2
                            #elif victim_rank == 2: death_bp = 1
                            else: death_bp = 1
                    
                        # Safely extract X and Y from the 10-character position string
                        try:
                            base_x = int(dead_pos[0:5])
                            base_y = int(dead_pos[5:10])
                        except ValueError:
                            base_x, base_y = 500, 500
                    
                        # The server has no copy of the map's wall geometry. Use
                        # positions the victim actually traversed near their death
                        # point instead of blindly offsetting into adjacent tiles.
                        # The death position itself is the guaranteed fallback.
                        blocked_cells = set()
                        for dep_packet in list(room.get("deployables", {}).values()):
                            if len(dep_packet) >= 13 and dep_packet[4] not in ("2", "3"):
                                try:
                                    blocked_cells.add((int(dep_packet[7:10]), int(dep_packet[10:13])))
                                except ValueError:
                                    continue

                        base_cell = (base_x // 100, base_y // 100)
                        placement_positions = [] if base_cell in blocked_cells else [(base_x, base_y)]

                        nearby_walkable = []
                        walkable_sources = [target_info]
                        for player_acc in room.get("players", set()):
                            player_info = USERS.get(player_acc)
                            if (player_info and player_info is not target_info
                                    and player_info.get("room") == room_name):
                                walkable_sources.append(player_info)

                        for source in walkable_sources:
                            history = (list(source.get("position_history", []))
                                       if source.get("position_history_room") == room_name else [])
                            if source.get("last_pos") and source.get("room") == room_name:
                                history.append(source["last_pos"])
                            for known_pos in history:
                                try:
                                    known_x, known_y = int(known_pos[:5]), int(known_pos[5:10])
                                except (TypeError, ValueError):
                                    continue
                                distance_sq = (known_x - base_x) ** 2 + (known_y - base_y) ** 2
                                cell = (int(known_pos[:3]), int(known_pos[5:8]))
                                if (distance_sq <= 200 ** 2 and distance_sq > 0
                                        and cell not in blocked_cells):
                                    nearby_walkable.append((known_x, known_y))

                        # Select points for the actual crate count across nearby
                        # room-player trails. Farthest-point selection avoids
                        # clustering crates around the death tile.
                        nearby_walkable = list(dict.fromkeys(nearby_walkable))
                        candidate_count = len(nearby_walkable)
                        if not placement_positions and nearby_walkable:
                            first_point = min(
                                nearby_walkable,
                                key=lambda point: (point[0] - base_x) ** 2 + (point[1] - base_y) ** 2,
                            )
                            placement_positions.append(first_point)
                            nearby_walkable.remove(first_point)
                        while nearby_walkable and len(placement_positions) < len(crates_to_spawn):
                            known_x, known_y = max(
                                nearby_walkable,
                                key=lambda point: min(
                                    (point[0] - placed_x) ** 2 + (point[1] - placed_y) ** 2
                                    for placed_x, placed_y in placement_positions
                                ),
                            )
                            placement_positions.append((known_x, known_y))
                            nearby_walkable.remove((known_x, known_y))

                        if not placement_positions:
                            # Last resort for malformed history or a barricade on
                            # the death tile: retain the original drop position.
                            placement_positions.append((base_x, base_y))

                        drop_positions = [
                            placement_positions[min(i, len(placement_positions) - 1)]
                            for i in range(len(crates_to_spawn))
                        ]
                        print(
                            f"[CRATE DEBUG] radius=200 candidates={candidate_count} unique="
                            f"{len(set(drop_positions))}/{len(drop_positions)} "
                            f"positions={drop_positions}"
                        )
                    
                        # Assign an available index and offset for each crate
                        for i, c_type in enumerate(crates_to_spawn):
                            crate_index = -1
                            # Find a free crate slot between 000 and 198.
                            for j in range(MAX_MAP_CRATES):
                                idx_str = f"{j:0{CRATE_ID_WIDTH}d}"
                                if idx_str not in room["crates"]:
                                    crate_index = j
                                    break
                        
                            # --- NEW: CRATE LIMIT REACHED (Overwrite Oldest) ---
                            if crate_index == -1 and room["crates"]:
                                # Find the crate index with the oldest timestamp
                                oldest_idx_str = min(room["crates"], key=lambda k: room["crates"][k].get("timestamp", 0))
                                crate_index = int(oldest_idx_str)
                            
                                # Pop it out of the dictionary so we can overwrite it cleanly
                                room["crates"].pop(oldest_idx_str)
                                # print(f"[*] Crate limit reached. Overwriting oldest crate: {oldest_idx_str}")
                            # ---------------------------------------------------
                        
                            if crate_index != -1:
                                idx_str = f"{crate_index:0{CRATE_ID_WIDTH}d}"
                            
                                # # Pick a distinct tile if possible, otherwise stack randomly
                                # if i < len(grid_offsets):
                                #     dx, dy = grid_offsets[i]
                                # else:
                                #     dx, dy = random.choice(grid_offsets)
                                
                                # # Apply the offset and clamp values between 0 and 99999
                                # new_x = max(0, min(99999, base_x + dx))
                                # new_y = max(0, min(99999, base_y + dy))

                                # Each crate gets a different known-walkable point
                                # whenever the victim's recent path provides one.
                                new_x, new_y = drop_positions[i]
                                spread_pos = f"{new_x:05d}{new_y:05d}" # Must be exactly 10 chars
                            
                                crate_str = create_bounty_string(c_type, crate_index, spread_pos)
                            
                                # Claim the index in the DB AND save the BP/Death ID/Timestamp
                                room["crates"][idx_str] = {
                                    "type": c_type,
                                    "str": crate_str,
                                    "bp": death_bp,           
                                    "death_id": death_id,     
                                    "timestamp": time.time()  # <-- NEW: Track when it spawned
                                }
                            
                                bounty_str += crate_str
                
                    kill_out = f"M{target_wire}7{attacker_wire}{weapon_wire}{bounty_str}"
                    self.broadcast_to_room((kill_out + "\x00").encode("utf-8"))
                self.sync_lives(damage_room, target_acc)
                
                # ... (Keep your existing RESPAWN LOGIC Opcodes 6 and 8 below this) ...

        # --- PLAYER DEATH / DESPAWN ---
        elif packet.startswith("7"):
            room_name = USERS[self.account_id].get("room")
            if room_name:
                self.relay_state_to_room(room_name, packet)
            return

        # --- 3. HANDLE CRATE PICKUP & SCORE ---
        # --- 3. HANDLE CRATE PICKUP & SCORE ---
        elif packet.startswith("0m"):
            payload = packet[2:]
            if (len(payload) != CRATE_ID_WIDTH or not payload.isascii()
                    or not payload.isdigit() or int(payload) >= MAX_MAP_CRATES):
                return
            crate_index = payload
            
            user_info = USERS.get(self.account_id)
            if not user_info: return
            
            room_name = user_info.get("room")
            if room_name and room_name in self.server.rooms:
                room = self.server.rooms[room_name]
                
                with CRATE_LOCK:
                    # 1. Check if the crate actually exists, and FREE the index using .pop()
                    if "crates" in room and crate_index in room["crates"]:
                        crate_data = room["crates"].pop(crate_index)
                        crate_type = crate_data["type"]
                    
                        # Extract BP and Death ID from the popped crate
                        crate_bp = crate_data.get("bp", 0)
                        death_id = crate_data.get("death_id")
                    
                        points = {0: 250, 1: 500, 2: 1000}.get(crate_type, 250)
                    
                        # 2. Add Stats
                        user_info.setdefault("stats", {"score": 10000, "kills": 0, "deaths": 0, "bounty_points": 0})
                        user_info["stats"]["score"] += points
                    
                        # 3. Handle Bounty Points (Only 1 time per specific death event per user)
                        bounty_awarded = 0
                        if death_id and crate_bp > 0:
                            claimed_deaths = user_info.setdefault("claimed_deaths", set())
                            if death_id not in claimed_deaths:
                                # User hasn't claimed BP for this death yet!
                                bounty_awarded = crate_bp
                                user_info["stats"]["bounty_points"] += bounty_awarded
                            
                                # Remember this death so they don't get BP for the other crates in the pile
                                claimed_deaths.add(death_id) 
                    
                        # 4. Broadcast removal to clients (param3 = bounty points)
                        slot_str = f"{int(user_info['slot']):03d}"
                        out_packet = f"0m{slot_str}{crate_index}{bounty_awarded}"
                        self.relay_raw_to_room(room_name, out_packet, include_self=True)

        # Server-owned life state. Client packets can only request a sync.
        elif packet.startswith("0v"):
            self.sync_lives(self.server.rooms.get(USERS[self.account_id].get("room")), socket=self.request)
            return

        # --- RESET HP ON RESPAWN (0k) ---
        elif packet.startswith("0k") and room_is_tdm(self.server.rooms.get(USERS[self.account_id].get("room"))):
            # TEAM DEATHMATCH: "0k<team>" picks a team (2 = Team A, 3 = Team B).
            # The client also sends its current team after every map load, which
            # doubles as the "map loaded" signal for deployable sync.
            room_name = USERS[self.account_id]["room"]
            room = self.server.rooms[room_name]
            try:
                requested = int(packet[2:3])
            except ValueError:
                return
            if requested not in (TEAM_NONE,) + TDM_TEAMS:
                return

            user = USERS[self.account_id]
            current = user.get("team", TEAM_NONE)
            # A TDM team is locked for this room membership. Joining
            # again resets team to TEAM_NONE and allows a fresh pick.
            # Infected conversions must still be allowed.
            team = current if current in TDM_TEAMS and not room_is_infected(room) else requested
            if team in TDM_TEAMS and team != current and team_count(room, team, exclude=self.account_id) >= TEAM_SIZE:
                if current in TDM_TEAMS:
                    team = current  # Switch refused: stay on the current team.
                else:
                    # First pick on a full team: use the other team. Room capacity
                    # (TEAM_SIZE * 2) guarantees it still has a free place.
                    other = TEAM_B if requested == TEAM_A else TEAM_A
                    team = other if team_count(room, other, exclude=self.account_id) < TEAM_SIZE else TEAM_NONE
            if requested == TEAM_NONE:
                team = current  # Map-load sync never drops a chosen team.
            user["team"] = team
            if team != current:
                print(f"[TEAM] {self.username} -> team {team} in '{room_name}'")

            # Tell everyone, including the sender, which team was actually applied.
            self.relay_raw_to_room(room_name, f"M{wire_id(self.account_id)}0k{team}", include_self=True)

            self.sync_lives(room, self.account_id)
            self.sync_lives(room, socket=self.request)

            # Same deployable sync the FFA "0k1" ready packet gets.
            with DEPLOYABLE_LOCK:
                for dep_packet in list(room.get("deployables", {}).values()):
                    self.send((dep_packet + "\x00").encode("utf-8"))

        elif packet.startswith("0k"):
            room_name = USERS[self.account_id].get("room")
            if packet == "0k1":
                if self.account_id in USERS:
                    USERS[self.account_id]["hp"] = 100
                    #print(f"[SYSTEM] Reset HP for {self.username} (Respawn)")

            # === NEW: SEND ALL BARRICADES TO THE PLAYER LOADING IN ===
                room_name = USERS[self.account_id].get("room")
                if room_name and room_name in self.server.rooms:
                    room = self.server.rooms[room_name]
                    if "deployables" in room:
                        for dep_packet in list(room["deployables"].values()):
                            self.send((dep_packet + "\x00").encode("utf-8"))

            if room_name:
                self.relay_raw_to_room(room_name, packet, include_self=False)

        # --- WEAPON SWITCH (0q) ---
        elif packet.startswith("0q"):
            user_info = USERS.get(self.account_id)
            if not user_info: return
            
            # Save the active weapon for late joiners!
            user_info["weapon"] = packet[2:4]
            
            room_name = user_info.get("room")
            if room_name and room_name in self.server.rooms:
                slot_str = f"{int(user_info['slot']):03d}"
                out_packet = f"M{slot_str}{packet}"
                self.relay_raw_to_room(room_name, out_packet, include_self=False)



        # --- CHAT / ENCRYPTED "9..." (NOT ping) ---
        # Client sends: 9<encrypted>
        # Peer must receive: M<ID>9<encrypted>
        elif packet.startswith("9") and not packet.startswith("9?"):
            room_name = USERS[self.account_id].get("room")
            if room_name:
                self.relay_chat9_to_room(room_name, packet, include_self=True)
            return

        # === CUSTOMIZATION (0d) ===
        elif packet.startswith("0d"):
            # Ensure the user is authenticated
            if not getattr(self, "username", None) or self.username not in USER_DB:
                return
            
            cat = packet[2:3]   # Category (0=Head, 1=Body, 2=Gender)
            data = packet[3:]   # The values
            
            with USER_DB_LOCK:
                recover_pending_round_export()
                users = {name: value.copy() for name, value in USER_DB.items()}
                db_user = users[self.username]
                changed = False
                if cat == "0" and len(data) >= 4:
                    db_user["head_model"], db_user["head_color"] = data[0:2], data[2:4]
                    changed = True
                elif cat == "1" and len(data) >= 4:
                    db_user["body_model"], db_user["body_color"] = data[0:2], data[2:4]
                    changed = True
                elif cat == "2" and len(data) >= 1:
                    db_user["gender"] = data[0:1]
                    changed = True
                if changed:
                    persist_users(users)
            if changed:
                update_most_wanted_xml()
                #print(f"[*] Saved customization for {self.username}: {packet}")
                
                # If they are currently in a game room, you might need to broadcast 
                # their new look to other players so they update visually in real-time.
                current_room_name = USERS[self.account_id].get("room")
                if current_room_name and current_room_name != "_":
                    # Generate an updated game U packet for myself and send it to peers
                    my_update = game_user_packet(self.account_id)
                    for peer_acc in self.server.rooms[current_room_name]["players"]:
                        if peer_acc != self.account_id:
                            try:
                                USERS[peer_acc]["socket"].sendall(my_update)
                            except OSError:
                                pass

        # --- round time request ---
        elif packet == "p":
            room_name = USERS[self.account_id].get("room")
            if room_name and room_name in self.server.rooms:
                room = self.server.rooms[room_name]
                remaining = round_remaining(room)

                # IMPORTANT: send timer to the requester AND broadcast it
                # so both clients stay synced.
                self.send(f"p{remaining}\x00".encode("utf-8"))
                self.relay_raw_to_room(room_name, f"p{remaining}", include_self=False)
            return
        
        elif packet.startswith("00"):
            try:
                # Format: 00 + TargetID(3) + Payload
                if len(packet) < 5: return

                target_wire = packet[2:5]
                payload = packet[5:]

                # Relay as "M" packet to target
                # Client sends "00", Receiver expects "M"
                for acc, u in USERS.items():
                    if wire_id(acc) == target_wire:
                        sender_wire = wire_id(self.account_id)
                        out = f"M{sender_wire}{payload}\x00".encode("utf-8")
                        u["socket"].sendall(out)
                        # print(f"[P2P] Relayed {sender_wire}->{target_wire}") # Uncomment to verify
                        break
            except Exception as e:
                print(f"P2P Error: {e}")


        else:
            print(f"[?] Unhandled: {repr(packet)}")

            room_name = USERS[self.account_id].get("room")
            if room_name and room_name in self.server.rooms:
                room = self.server.rooms[room_name]
                
                # Relay the raw, unknown packet to everyone else in the room
                payload_bytes = (packet + "\x00").encode("utf-8")
                for peer_acc in list(room["players"]):
                    if peer_acc != self.account_id and peer_acc in USERS:
                        try:
                            USERS[peer_acc]["socket"].sendall(payload_bytes)
                        except OSError:
                            pass



    def handle(self):
        self.username = None
        self.account_id = None

        #print(f"[+] Connected: {self.client_address}")

        buf = ""
        try:
            while True:
                data = self.request.recv(4096)
                if not data:
                    break

                # Append new data to buffer
                chunk = data.decode("utf-8", errors="ignore")
                buf += chunk

                # Process ALL complete packets in the buffer
                while "\x00" in buf:
                    # split ONLY on the first null terminator
                    packet, buf = buf.split("\x00", 1)
                    
                    if not packet:
                        continue
                        
                    # Clean and handle the packet
                    try:
                        self.handle_packet(packet)
                    except Exception as e:
                        print(f"Error handling packet {packet!r}: {e}")

        except Exception as e:
            print(f"Connection error: {e}")
        finally:
            if self.account_id and self.account_id in USERS:
                self.remove_user(self.account_id)

###############################################################################
# Server
###############################################################################

class ThreadedTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

with ThreadedTCPServer(("0.0.0.0", 6123), FlashGameHandler) as server:
    server.rooms = {
        "_": {"name": "_", "players": set(), "settings_string": "", "round_start": None, "round_length": 630, "crates": {}}
    }
    print("[*] Listening on port 6123...")
    server.serve_forever()
