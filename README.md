# 🦀 Gravity Claw

A self-learning personal AI agent that runs locally on your machine. Built with TypeScript, powered by OpenAI & Gemini, and controllable via Discord.

**Gravity Claw teaches itself new skills.** When it doesn't know how to do something, it researches the answer with its browser, writes a step-by-step guide for itself, and remembers it forever.

---

## ✨ Features

### 🧠 Self-Learning Skills Engine
- Ask Gravity Claw to do anything — if it doesn't know how, it will **research it with its browser**, write a `SKILL.md` guide, and execute it immediately.
- Skills are stored as plain Markdown files in your Obsidian vault. You can read, edit, or delete them anytime.
- On every reboot, skills are automatically loaded into the agent's brain.

### 🌐 Native Browser (Playwright)
- Full headless Chrome running natively on your machine via Playwright.
- Navigate, click, type, screenshot, and scrape any website.
- No Docker overhead, no Chromium crashes.

### 🐳 Sandboxed Code Execution
- Run Python/bash scripts inside an isolated Docker container.
- Only `/sandbox` is accessible. No network. 256MB RAM limit. 1 CPU core.
- Process Excel files, CSVs, PDFs — anything Python can handle.

### 📧 Gmail Integration (Native IMAP)
- Search your inbox by sender, subject, or date.
- Read full email content.
- Uses your existing Gmail App Password — no OAuth setup required.

### 📁 Obsidian Vault Integration
- Your agent's personality lives in `SOUL.md` inside your Obsidian vault.
- Edit `SOUL.md` to change how the agent behaves — no code changes needed.
- Skills are organized in `skills/<name>/SKILL.md` directories.

### 💾 Persistent Memory (SQLite + FTS5)
- Save and search memories across conversations.
- Full-text search powered by SQLite FTS5.

### 🔒 Security-First Architecture
- **All file operations** run inside Docker containers with restricted volume mounts.
- **Code execution** is sandboxed with no network, memory limits, and CPU limits.
- **No host terminal access** — the agent cannot run commands on your machine.
- **Discord ID whitelist** — only your Discord account can interact with the agent.
- **No API keys in code** — all secrets stored in `.env`, never committed to git.

---

## 🏗️ Architecture

```
Discord (User)
    │
    ▼
┌──────────┐     ┌──────────────┐     ┌─────────────────┐
│  bot.ts  │────▶│   agent.ts   │────▶│  OpenAI / Gemini │
│ Discord  │     │  Agent Loop  │     │    LLM APIs      │
│ Gateway  │     │  (15 iter)   │     └─────────────────┘
└──────────┘     └──────┬───────┘
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
        ┌──────────┐ ┌──────┐ ┌──────────┐
        │ browser  │ │ exec │ │filesystem│
        │Playwright│ │Docker│ │Docker MCP│
        │ (native) │ │sandbox│ │(/sandbox)│
        └──────────┘ └──────┘ └──────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **Docker** (for sandboxed execution and filesystem tools)
- **Discord Bot** (create one at [Discord Developer Portal](https://discord.com/developers))
- **OpenAI API Key** (primary LLM)
- **Gemini API Key** (fallback LLM)
- **Gmail App Password** (optional, for email features)

### Installation

```bash
# Clone the repo
git clone https://github.com/orionishere/Abhi_GravityClaw.git
cd Abhi_GravityClaw

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Pull the Docker sandbox image
docker pull python:3.12-slim

# Copy and fill in your environment variables
cp .env.example .env
# Edit .env with your API keys
```

### Configuration

Create a `.env` file with the following:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_USER_ID=your_discord_user_id
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
GMAIL_USER=your_gmail@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
```

### Obsidian Vault Setup

Create an Obsidian vault for Gravity Claw's brain:

```bash
mkdir -p /path/to/your/vault/skills
```

Update the `OBSIDIAN_ROOT` path in `src/agent.ts` and the volume mount in `src/mcp.ts` to point to your vault.

### Run

```bash
npm run dev
```

---

## 🧩 Skills System

Skills are Markdown files that teach the agent how to do specific tasks. They live in your Obsidian vault at `skills/<name>/SKILL.md`.

### Example Skill

```markdown
---
name: check-weather
description: Check current weather for any city using wttr.in
---

# Check Weather

1. Call `browser_navigate({ url: "https://wttr.in/CITY?format=3" })`
2. Read the response — it contains a one-line weather summary.
3. Report the result to the user.
```

### How the Agent Learns

1. You ask something the agent doesn't know how to do.
2. It tells you: *"I don't know how yet. Let me research it..."*
3. It browses the web to find a free, no-API-key method.
4. It writes a `SKILL.md` file to your Obsidian vault.
5. It follows its own guide immediately to answer you.
6. On the next restart, the skill is permanently loaded.

---

## 🛠️ Available Tools

| Tool | Type | Description |
|------|------|-------------|
| `browser_navigate` | Native | Visit a URL, return page text |
| `browser_get_text` | Native | Get current page text |
| `browser_screenshot` | Native | Save a screenshot to `/sandbox` |
| `browser_click` | Native | Click a CSS selector |
| `browser_type` | Native | Type into a form field |
| `exec` | Docker | Run bash/Python in sandbox |
| `gmail_search` | Native | Search Gmail by sender/subject/date |
| `gmail_read` | Native | Read an email by UID |
| `save_memory` | Native | Save a note to memory |
| `search_memories` | Native | Full-text search memories |
| `get_current_time` | Native | Get current date/time |
| `mcp__filesystem-mcp__*` | Docker MCP | 14 filesystem tools for `/sandbox` and `/obsidian` |

---

## 📁 Project Structure

```
GravityClaw/
├── src/
│   ├── index.ts          # Entry point
│   ├── bot.ts            # Discord bot gateway
│   ├── agent.ts          # Agent loop + dynamic prompt loader
│   ├── mcp.ts            # MCP bridge (Docker tool servers)
│   ├── config.ts         # Environment variable loader
│   ├── db.ts             # SQLite + FTS5 memory
│   ├── heartbeat.ts      # Proactive scheduling
│   ├── voice.ts          # Voice features (optional)
│   └── tools/
│       ├── index.ts      # Tool registry + router
│       ├── browser.ts    # Playwright browser tools
│       ├── exec.ts       # Sandboxed Docker execution
│       ├── gmail.ts      # Native IMAP Gmail tools
│       ├── getCurrentTime.ts
│       ├── saveMemory.ts
│       └── searchMemories.ts
├── data/
│   ├── skills.json       # MCP server definitions
│   ├── memory.db         # SQLite memory database
│   └── sandbox/          # Docker sandbox mount point
├── .env                  # API keys (never committed)
├── .env.example          # Template for .env
├── package.json
└── tsconfig.json
```

---

## 🔒 Security Model

Gravity Claw follows a **stricter security model than OpenClaw**:

| Layer | Protection |
|-------|-----------|
| **Discord** | Only your Discord ID can interact with the bot |
| **Filesystem** | Docker MCP with restricted volume mounts (`/sandbox`, `/obsidian` only) |
| **Code Execution** | Docker container, no network, 256MB RAM, 1 CPU |
| **Browser** | Headless mode, no access to host files |
| **Secrets** | `.env` file only, never in code, never committed |
| **Agent Loop** | 15-iteration safety limit prevents runaway loops |

---

## 📄 License

MIT

---

*Vibe Coded with ❤️ by Abhijeet — inspired by [OpenClaw](https://github.com/openclaw/openclaw), secured by design.*
