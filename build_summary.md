<project_metadata>

Project Name: Gravity Claw (OpenClaw Clone)

Tech Stack: TypeScript, Node.js, discord.js, OpenAI API, Gemini API, ElevenLabs API, better-sqlite3, node-cron, Model Context Protocol (MCP) SDK, Docker, Puppeteer.

Antigravity Agents Used: Antigravity
</project_metadata>

<research_and_attribution>

Reference Links: N/A (Architecture derived via iterative user prompting and standard MCP documentation rather than direct scraping of the OpenClaw GitHub repository)

Architectural Deviations:
- **Transport Security**: This clone uses Docker container sandboxing (`node:18`) inside the `StdioClientTransport` to physically isolate external MCP tool execution (filesystem, browsing, email), rather than executing raw shell scripts directly on the host machine.
- **LLM Routing**: Implements a hot-swappable fallback mechanism (OpenAI -> Gemini) directly within the primary agent loop rather than relying on a complex external router.
- **Memory Implementation**: Uses a local `better-sqlite3` database utilizing FTS5 for full-text contextual search rather than relying on an external vector database.
- **Integration Layer**: Relies purely on Discord for messaging communication and whitelisting rather than a multi-platform gateway (WhatsApp/Slack/etc).
</research_and_attribution>

<system_architecture>

Core Modules:
- **Gateway (bot.ts)**: Handles Discord message ingestion, voice attachment processing (STT/TTS), and strict user ID whitelisting.
- **LLM Handler (agent.ts)**: Maintains the core agentic reasoning loop, maintains conversational context, and routes semantic intent to the appropriate tool execution pipelines.
- **MCP Bridge (mcp.ts)**: Manages connections to external Model Context Protocol servers (Filesystem, Gmail, Puppeteer) utilizing explicit Docker configurations for secure environment isolation.
- **Memory Management (db.ts & src/tools)**: Interfaces with SQLite to persist and query contextual episodic memory.
- **Engine (index.ts & heartbeat.ts)**: Bootstraps the application state, connects the database/servers, and schedules proactive executions.

Execution Flow:
1. User sends a message or voice note to the Discord bot.
2. `bot.ts` authenticates the User ID against the hardcoded whitelist. If a voice attachment is present, `voice.ts` transcribes it via Whisper.
3. The semantic text passes to `agent.ts`, which enters a stateful LLM reasoning loop.
4. If a tool execution is required to answer the prompt, `agent.ts` parses the corresponding JSON-RPC call.
5. Internal native tools (e.g., `saveMemory`, `get_current_time`) are executed contextually via `tools/index.ts`.
6. External capability tools (e.g., browsing, email, filesystem) are proxied directly through `mcp.ts` to their respective Dockerized MCP server instances via standard IO.
7. The tool result is fed back into the LLM context. The LLM generates the final textual response.
8. If voice settings are enabled, the text is synthesized into audio via ElevenLabs and sent back alongside the Discord text message.

State Management: Contextual state is maintained locally using a `better-sqlite3` database configured with FTS5. The agent explicitly uses the schema-defined `save_memory` and `search_memories` tools during its reasoning loop to store and retrieve long-term state based on semantic relevance, independent of the short-term chat window.
</system_architecture>

<codebase_topology>

Directory Structure:
```text
GravityClaw/
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── data/
│   ├── memory.db
│   └── sandbox/
└── src/
    ├── agent.ts
    ├── bot.ts
    ├── config.ts
    ├── db.ts
    ├── heartbeat.ts
    ├── index.ts
    ├── mcp.ts
    ├── voice.ts
    └── tools/
        ├── index.ts
        ├── saveMemory.ts
        └── searchMemories.ts
```

Critical Execution Files:
1. **src/agent.ts**: Contains the primary agentic reasoning loop, tool parsing logic, and LLM fallback routing infrastructure.
2. **src/mcp.ts**: Establishes the vital Model Context Protocol communication bridges and Docker-sandboxed tool isolation for external capabilities.
3. **src/index.ts**: The main bootloader that initializes the database topology, boots the MCP servers, and starts the Discord gateway listeners.
</codebase_topology>

<deployment_requirements>

Environment Variables:
- `DISCORD_BOT_TOKEN`
- `DISCORD_USER_ID`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `TWITTER_BEARER_TOKEN`

Init Commands:
1. `npm install`
2. `npm run dev`
</deployment_requirements>
