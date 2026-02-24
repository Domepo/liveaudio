set -e
printf "=== tailscale serve help ===\n"
tailscale serve --help | sed -n '1,160p'
printf "\n=== tailscale funnel help ===\n"
tailscale funnel --help | sed -n '1,160p'
