#!/bin/sh
# Run the online game as a service on a Linux server (Ubuntu, Debian...), once:
#
#     sh tools/install_service.sh
#
# Afterwards tools/host.py (the website, the game server and the bridge) starts
# with the server, starts again if it stops, and keeps running without PuTTY
# open. Updating is then just:   boxhead-update   (a git pull; host.py applies it)
# Other commands:   boxhead-log (watch it, Ctrl+C to leave)   boxhead-restart   boxhead-stop
set -e
if [ "$(id -u)" != 0 ]; then
  echo "Run it as root (or with sudo)." >&2
  exit 1
fi
DIR=$(cd "$(dirname "$0")/.." && pwd)
PYTHON=$(command -v python3)

# Stop a copy started by hand (in tmux) first: it holds the ports.
tmux kill-session -t boxhead 2>/dev/null || true
pkill -f "$DIR/tools/host.py" 2>/dev/null || true
pkill -f "tools/host[.]py" 2>/dev/null || true
pkill -f "bbh-server-hunter-fix_2[.]py" 2>/dev/null || true
pkill -f "BBHServer[.]py" 2>/dev/null || true
pkill -f "tools/serve[.]py" 2>/dev/null || true
sleep 1

# The bridge's add-on (websockets), next to it.
if ! "$PYTHON" -c "import sys; sys.path.insert(0, '$DIR/.python-packages'); import websockets" 2>/dev/null; then
  echo "Installing the bridge's websockets add-on ..."
  "$PYTHON" -m pip install --quiet --break-system-packages --target "$DIR/.python-packages" websockets
fi

cat > /etc/systemd/system/boxhead.service <<UNIT
[Unit]
Description=Boxhead online game (website, game server, bridge)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$PYTHON $DIR/tools/host.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now boxhead
systemctl restart boxhead

# Short commands for later, as real commands (they work in every window at once).
for name in update log restart stop; do rm -f "/usr/local/bin/boxhead-$name"; done
printf '#!/bin/sh\ncd "%s" && git pull\n' "$DIR" > /usr/local/bin/boxhead-update
printf '#!/bin/sh\nexec journalctl -u boxhead -f -n 50\n' > /usr/local/bin/boxhead-log
printf '#!/bin/sh\nexec systemctl restart boxhead\n' > /usr/local/bin/boxhead-restart
printf '#!/bin/sh\nexec systemctl stop boxhead\n' > /usr/local/bin/boxhead-stop
chmod +x /usr/local/bin/boxhead-update /usr/local/bin/boxhead-log /usr/local/bin/boxhead-restart /usr/local/bin/boxhead-stop
# Earlier versions added these as aliases in .bashrc: remove them.
sed -i '/# boxhead commands$/d' /root/.bashrc 2>/dev/null || true

echo
echo "Done. The game now runs by itself, and starts again after a reboot."
echo "  boxhead-update    get the latest version (it is applied by itself)"
echo "  boxhead-log       watch what it is doing (Ctrl+C to leave; the game keeps running)"
echo "  boxhead-restart   restart everything"
echo "  boxhead-stop      stop it (boxhead-restart starts it again)"
