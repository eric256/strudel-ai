#!/usr/bin/env bash
# Creates the GitHub repository and pushes this project (code + tags) to it.
# Usage: scripts/publish-to-github.sh [repo-name] [--public|--private]
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-strudel-ai}"
VISIBILITY="${2:---public}"

command -v gh >/dev/null || { echo "Please install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login

OWNER="$(gh api user -q .login)"
echo "Publishing as github.com/$OWNER/$NAME ($VISIBILITY)"

# fill in the owner/repo placeholders in README badges and package.json
if grep -q "OWNER/strudel-ai" README.md package.json docker-compose.yml 2>/dev/null; then
  sed -i.bak "s#OWNER/strudel-ai#$OWNER/$NAME#g" README.md package.json docker-compose.yml
  rm -f README.md.bak package.json.bak docker-compose.yml.bak
  git add README.md package.json docker-compose.yml
  git commit -m "Point links at github.com/$OWNER/$NAME"
fi

gh repo create "$NAME" "$VISIBILITY" --source . --remote origin --push \
  --description "Strudel live-coding with an AI co-pilot: chat, hum-to-melody, song blocks, set lists and an autonomous AI radio station (llama.cpp / OpenWebUI)"
git push origin --tags
gh repo edit "$OWNER/$NAME" --add-topic strudel --add-topic live-coding --add-topic music --add-topic llm --add-topic llama-cpp --add-topic openwebui --add-topic docker >/dev/null || true

echo
echo "Done: https://github.com/$OWNER/$NAME"
echo "The 'Publish image' workflow will build ghcr.io/$OWNER/$NAME — see the Actions tab."
