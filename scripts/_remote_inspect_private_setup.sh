set -e
echo '=== tailscale ==='
which tailscale || true
tailscale version || true
tailscale ip -4 || true
tailscale serve status || true
echo '=== docker ==='
docker --version || true
docker compose version || true
echo '=== ss ==='
ss -tulpen | head -n 60 || true
