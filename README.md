# Gravity Claw

A self-learning personal AI agent that runs 24/7 on your VPS. Built with TypeScript, powered by a multi-provider LLM routing engine (Anthropic Claude, OpenAI, Gemini, Ollama), and controllable via Discord.

Gravity Claw teaches itself new skills, browses the web, runs a nightly research cycle, tracks costs, and manages itself — all from your Discord DMs.

---

## Features

### Multi-Provider LLM Routing
- **Primary:** Anthropic Claude (Opus, Sonnet, Haiku)
- **Fallback 1:** OpenAI (GPT-4o, o4-mini, GPT-4o-mini)
- **Fallback 2:** Google Gemini (Pro, Flash)
- **Local/Free:** Ollama (Llama 3.1 8B)
- Automatic provider selection with parallel health checks and 15-day caching
- Four task tiers: `analysis` (Opus), `code` (Sonnet), `light` (Sonnet), `heartbeat` (Haiku/free)

### Self-Learning Skills Engine
- Ask Gravity Claw to do anything — if it doesn't know how, it **researches it with its browser**, writes a `SKILL.md` guide, and executes it immediately.
- Skills are stored as Markdown files in your Obsidian vault. Readable, editable, deletable.
- On every reboot, skills are loaded into the agent's system prompt.

### Dream Cycle (Nightly Intelligence System)
- **4-phase autonomous research loop** running at 10:30 PM daily: SCAN, REFLECT, RESEARCH, PROPOSE
- Scans configurable sources (Reddit, HN, GitHub Trending, arXiv, Twitter/X) for findings relevant to your goals
- Reflects on goal progress using memory, observations, and past proposals
- Deep-researches the most relevant findings via browser
- Generates prioritized, actionable proposals injected into the agent's system prompt
- Followed by a **Nightly Review** at 11:00 PM: day scoring, tomorrow's priorities, durable lesson extraction
- Append-only `meta-notes.md` and `tacit-knowledge.md` for self-improving research quality

### Preconscious Observation System
- Background observation task scans recent memories and vault changes
- Generates urgency-flagged observations injected into the system prompt before every response
- Auto-expires observations older than 7 days

### Sub-Agent Delegation
- The agent can delegate complex sub-tasks to a child agent with a 5-iteration cap
- Synchronous execution — the parent waits for the result before continuing

### Native Browser (Playwright)
- Full headless Chromium running natively via Playwright
- Navigate, click, type, screenshot, and scrape any website
- Stealth configuration for sites that block headless browsers

### Sandboxed Code Execution
- Run Python/bash scripts inside an isolated Docker container
- No network access, 256MB RAM limit, 1 CPU core
- Process Excel, CSV, PDF — anything Python can handle

### Gmail Integration (Native IMAP)
- Search your inbox by sender, subject, or date
- Read full email content
- Uses Gmail App Password — no OAuth setup required

### Twitter/X Integration
- Fetch your stats, mentions, and trending topics
- Deep search with multi-query support
- Draft tweet threads with per-message Discord delivery via `[THREAD]` protocol

### Cron Scheduling
- Schedule recurring tasks via Discord that persist across restarts
- Stored in your Obsidian vault as JSON

### Cost Tracking & Usage Reports
- Per-call token counting and cost estimation across all providers
- Usage report tool accessible via Discord
- Ollama savings tracking (free local calls vs. paid API equivalents)

### Obsidian Vault Integration
- Agent personality lives in `SOUL.md` — edit behavior without touching code
- Skills, observations, dream logs, reviews, goals, and tacit knowledge all stored as Markdown
- Full-text searchable via SQLite FTS5

### Goal & Research Management (via Discord)
- `manage_goals` — add, remove, update, list goal pillars scored nightly
- `manage_research` — add/remove topics and sources, toggle the dream cycle on/off

### Security
- Discord ID whitelist — only your account can interact
- Docker-sandboxed code execution with no network
- Browser in headless mode with no host file access
- All secrets in `.env`, never committed
- 25-iteration agent loop safety limit (5 for Ollama)

---

## Architecture

```
Discord (User)
    |
    v
+---------+     +------------+     +---------------------------+
| bot.ts  |---->| agent.ts   |---->| Anthropic / OpenAI /      |
| Discord |     | Agent Loop |     | Gemini / Ollama           |
| Gateway |     | (25 iter)  |     | (auto-routed by tier)     |
+---------+     +-----+------+     +---------------------------+
                      |
          +-----------+-----------+------ ... ------+
          v           v           v                  v
    +---------+ +----------+ +---------+    +---------------+
    | browser | |   exec   | | twitter |    | dreamCycle.ts |
    |Playwright| |  Docker  | |  X API  |    | 4-phase nightly|
    | (native)| | sandbox  | |         |    | research loop  |
    +---------+ +----------+ +---------+    +---------------+
```

---

## Quick Start

### Prerequisites
- **Node.js** 18+
- **Docker** (for sandboxed execution)
- **Discord Bot** ([Discord Developer Portal](https://discord.com/developers))
- **Anthropic API Key** (primary LLM — optional, falls back to OpenAI)
- **OpenAI API Key** (fallback 1)
- **Gemini API Key** (fallback 2)
- **Gmail App Password** (optional, for email features)
- **Twitter Bearer Token** (optional, for X features)

### Installation

```bash
git clone https://github.com/orionishere/Abhi_GravityClaw.git
cd Abhi_GravityClaw

npm install

npx playwright install chromium

docker pull python:3.12-slim

cp .env.example .env
# Edit .env with your API keys
```

### Configuration

Create a `.env` file:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_USER_ID=your_discord_user_id
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
OBSIDIAN_PATH=/path/to/your/obsidian/vault
DATA_PATH=./data
GMAIL_USER=your_gmail@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
TWITTER_BEARER_TOKEN=your_twitter_bearer_token
```

### Run

```bash
# Development
npm run dev

# Production (PM2)
pm2 start dist/index.js --name gravity-claw
```

---

## Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Visit a URL, return page text |
| `browser_get_text` | Get current page text |
| `browser_screenshot` | Screenshot to sandbox |
| `browser_click` | Click a CSS selector |
| `browser_type` | Type into a form field |
| `exec` | Run bash/Python in Docker sandbox |
| `gmail_search` | Search Gmail by sender/subject/date |
| `gmail_read` | Read an email by UID |
| `save_memory` | Save a note to persistent memory |
| `search_memories` | Full-text search memories |
| `search_history` | Search conversation history |
| `get_current_time` | Get current date/time |
| `delegate` | Delegate a sub-task to a child agent |
| `github_create_and_push` | Create/push files to GitHub |
| `schedule_cron` | Schedule a recurring task |
| `cancel_cron` | Cancel a scheduled task |
| `list_crons` | List all active cron jobs |
| `learn_skill` | Research and learn a new skill |
| `twitter_get_my_stats` | Fetch your X/Twitter stats |
| `twitter_get_mentions` | Fetch recent mentions |
| `twitter_get_trending` | Get trending topics |
| `twitter_search_deep` | Deep search X/Twitter |
| `twitter_draft_thread` | Draft a tweet thread |
| `manage_goals` | Add/remove/update/list goal pillars |
| `manage_research` | Manage dream cycle topics and sources |
| `get_usage_report` | View cost and usage breakdown |

---

## Project Structure

```
Abhi_GravityClaw/
├── src/
│   ├── index.ts            # Entry point — boot sequence
│   ├── bot.ts              # Discord gateway + message splitting
│   ├── agent.ts            # Agent loop, routing, system prompt
│   ├── modelSelector.ts    # Multi-provider auto-selection
│   ├── config.ts           # Environment variable loader
│   ├── db.ts               # SQLite + FTS5 memory
│   ├── heartbeat.ts        # Proactive scheduling + cron triggers
│   ├── observe.ts          # Preconscious observation system
│   ├── dreamCycle.ts       # 4-phase nightly intelligence loop
│   ├── nightlyReview.ts    # Day scoring + tacit knowledge
│   ├── history.ts          # Conversation history + compaction
│   ├── costs.ts            # Token usage + cost tracking
│   ├── tracker.ts          # Execution analytics + skill recommendations
│   ├── mcp.ts              # MCP bridge (external tool servers)
│   ├── ollama.ts           # Local LLM integration
│   ├── voice.ts            # Voice features (optional)
│   ├── fileUtils.ts        # Shared file helpers
│   ├── utils.ts            # Pure utility functions
│   ├── types/
│   │   └── dream.ts        # Shared dream cycle types
│   └── tools/
│       ├── index.ts         # Tool registry + router
│       ├── browser.ts       # Playwright browser tools
│       ├── exec.ts          # Docker sandboxed execution
│       ├── gmail.ts         # Native IMAP Gmail
│       ├── twitter.ts       # X/Twitter API tools
│       ├── cron.ts          # Persistent cron scheduling
│       ├── delegate.ts      # Sub-agent delegation
│       ├── github.ts        # GitHub push tools
│       ├── learnSkill.ts    # Self-learning engine
│       ├── manageGoals.ts   # Goal pillar management
│       ├── manageResearch.ts # Dream cycle config management
│       ├── report.ts        # Usage/cost reports
│       ├── saveMemory.ts    # Memory persistence
│       ├── searchMemories.ts # Memory search
│       ├── searchHistory.ts  # History search
│       └── getCurrentTime.ts
├── data/
│   ├── dream_config.json   # Dream cycle research config
│   ├── memory.db           # SQLite database
│   └── sandbox/            # Docker sandbox mount
├── GravityClaw/            # Obsidian vault root
│   ├── SOUL.md             # Agent personality
│   ├── goals.md            # Goal pillars (scored nightly)
│   └── skills/             # Learned skill guides
├── .env                    # API keys (never committed)
├── package.json
└── tsconfig.json
```

---

## License

MIT

---

*Vibe Coded by Abhijeet — inspired by [OpenClaw](https://github.com/openclaw/openclaw), secured by design.*
