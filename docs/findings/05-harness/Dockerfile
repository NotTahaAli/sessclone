# Claude Code in a throwaway container, for ticket 05's container-kill run.
#
# Auth is by CLAUDE_CODE_OAUTH_TOKEN at RUN time, never baked in. Note what is
# deliberately NOT here: no volume mounted at ~/.claude. The docs' devcontainer
# recipe mounts one so a sign-in survives a rebuild, and that is exactly wrong
# for this spike — transcripts live under ~/.claude/projects, so a volume there
# would let them survive the very container death being measured.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /work
COPY post.sh settings.json ./
RUN chmod +x post.sh && mkdir -p /work/project

ENV CLAUDE_CONFIG_DIR=/root/.claude
CMD ["bash"]
