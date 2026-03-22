---
name: check-weather
description: Check current weather for any city using wttr.in
model_tier: local
allowed_tools: [browser_navigate, browser_get_text]
max_tool_calls: 2
---

# Check Weather

1. Call `browser_navigate({ url: "https://wttr.in/CITY?format=3" })`
2. Read the response — it contains a one-line weather summary.
3. Report the result to the user.
