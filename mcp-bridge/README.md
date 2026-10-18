# vstgui-mcp

Lets **Claude Code** or **Codex** build audio plugin GUIs in Figma with **VST GUI Pro**: paste a sketch or screenshot, get the panel, knobs, sliders, buttons, meters and wheels, then export the background, control strips and `layout.json`.

Needs VST GUI Pro with PRO, the Figma desktop app and Node.js 18+.

## Install

Paste this into Claude Code or Codex:

> Install vstgui-mcp from https://www.npmjs.com/package/vstgui-mcp

### Steps for the agent doing the install

1. Check `node --version` is 18 or newer. If not, stop and tell the user to install Node.js from nodejs.org.
2. **Claude Code:** add this server to `.mcp.json` in the project root. If the file exists, merge it into `mcpServers` and keep what's there.
   ```json
   { "mcpServers": { "vstgui": { "command": "npx", "args": ["-y", "vstgui-mcp"] } } }
   ```
   On Windows use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "vstgui-mcp"]`.
   **Codex:** add this to `~/.codex/config.toml`:
   ```toml
   [mcp_servers.vstgui]
   command = "npx"
   args = ["-y", "vstgui-mcp"]
   ```
3. Tell the user, briefly:
   - Restart the agent (in VS Code, reload the window) and approve the `vstgui` server when asked.
   - In Figma desktop, open VST GUI Pro and click **Agent**. The dot turns green when connected.
   - Then try: "Using vstgui, build this plugin from my sketch."

## Privacy

Runs on your computer and listens only on `localhost:7417`. Only the Figma plugin can connect. One agent session at a time can drive VST GUI Pro.
