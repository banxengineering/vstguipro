# vstgui-mcp

Lets Claude Code or Codex drive VST GUI Pro in Figma. Agent mode is a PRO feature.

## Setup (dev)

You need Node 18 or newer (`node --version`). In every example below, swap in the full path to `index.js` on your own machine. Use forward slashes, even on Windows.

### 1. Install the bridge's dependencies

```
cd mcp-bridge
npm install
```

### 2. Register the server with your agent

Pick the option that matches how you run your agent.

**A. Claude Code, any setup (recommended).** Put a `.mcp.json` file in the root of the project you open in Claude Code:

```json
{
  "mcpServers": {
    "vstgui": {
      "command": "node",
      "args": ["C:/01 DEV/Figma/VST Gui Pro 0.1.2/mcp-bridge/index.js"]
    }
  }
}
```

This works in the VS Code extension, the desktop app and the terminal CLI. It doesn't need the `claude` command. This repo already includes one.

**B. Claude Code CLI.** This only works if the `claude` command runs in your terminal (that is, `claude --version` prints a version). Type this exactly as shown:

```
claude mcp add vstgui -- node "C:/01 DEV/Figma/VST Gui Pro 0.1.2/mcp-bridge/index.js"
```

This registers it for the current project only. Add `--scope user` before `vstgui` to make it available in every project.

**C. Codex.** Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.vstgui]
command = "node"
args = ["C:/01 DEV/Figma/VST Gui Pro 0.1.2/mcp-bridge/index.js"]
```

### 3. Load it and connect

1. Restart your agent session. In VS Code, reload the Claude Code panel.
2. Claude Code asks once whether to trust the project's `vstgui` server. Approve it.
3. Type `/mcp`. `vstgui` should show as connected.
4. Open VST GUI Pro in the Figma desktop app (Plugins → Development) and click **Agent** in its header. The dot turns green once the agent session is running.

## Troubleshooting

| You see | Fix |
|---|---|
| `Run : The term 'Run' is not recognized` | Some instructions say "Run `claude mcp add ...`". Type only the part in the code block, starting at `claude`. |
| `claude : The term 'claude' is not recognized` | The Claude Code CLI isn't installed in your terminal. The VS Code extension and desktop app use their own built-in copy, so this is normal. Use option A (`.mcp.json`). |
| `vstgui` doesn't appear in `/mcp` | Restart the session. Then make sure the `.mcp.json` file is in the root of the folder Claude Code has open, and that its JSON is valid. |
| `vstgui` shows as failed | Run `node "<path>/mcp-bridge/index.js"` yourself to see the error. The usual causes are a wrong path, `npm install` not run yet, or Node older than 18. |
| `Cannot find module '@modelcontextprotocol/sdk'` | Run `npm install` inside `mcp-bridge`. |
| "Port 7417 is in use" | Another agent session already has the bridge open. Close it: this one retries every 3 s and takes over by itself. Or set `VSTGUI_MCP_PORT` (and update the plugin manifest to match). |
| Plugin dot keeps pulsing amber | The plugin can't reach the bridge. Make sure the agent session is running with `vstgui` connected in `/mcp`. Then turn Agent mode off and on again in the plugin. |
| Plugin dot is amber and steady | Another VST GUI Pro window (another Figma file, say) is already connected. Only one window at a time can be driven: turn Agent off in the other one. |
| Bridge log says `refused a connection from https://...` | Something other than the plugin, such as a web page, tried to connect. The bridge only accepts the Figma plugin, so you can ignore it. |

## Tools

Ask your agent "vstgui help" for a plain-words list of what it can do. In Claude Code the bridge's prompts also show in the slash menu: `/mcp__vstgui__help`, `/mcp__vstgui__build` and `/mcp__vstgui__export`. Codex and other clients use the tools directly.

The agent asks a few questions before it builds, then stops after the build so you can ask for changes. It only exports when you say so. While it builds, the plugin shrinks to a small bar so you can watch the canvas; **Expand** brings the full window back.

| Tool | What it does |
|---|---|
| `help` | What agent mode can do, for the user |
| `get_status` | Connected? Plugin version, protocol, PRO state |
| `get_spec_schema` | Defaults, limits and allowed values for a control's spec, or the panel's |
| `build_control` | Builds one control on its own, returns PNG + nodeId + normalized spec |
| `build_strip` | The full animation strip for one control |
| `update_control` | Restyles, resizes, moves or renames a control |
| `snapshot` | PNG of a node or the selection |
| `read_selection_spec` | Spec stored on a control the plugin built |
| `build_panel` | The plugin background at the window's size |
| `update_panel` | New panel art; controls and labels stay put |
| `place_control` | A control on a panel at x, y |
| `arrange` | Moves several controls or labels at once |
| `remove_control` | Deletes a control or label |
| `set_label` | Adds or edits text on a panel |
| `get_layout` | Every control's box, warnings, and a PNG of the panel |
| `export_ui` | Writes the whole UI to disk (see below) |

Controls: knob, slider, button, meter (bar or VU), wheel (pitch or mod).

## What export_ui writes

```
vstgui-export/<panel>/
  background@2x.png        the panel with its controls hidden; labels baked in
  knobs/cutoff_128f@2x.png one strip per distinct control (identical ones share a file)
  sliders/  buttons/  meters/  wheels/
  layout.json              every control's x, y, w, h, value, frames and file
```

`vstgui-export` is made in the folder your agent session runs in. Pass `folder` to the tool, or set `VSTGUI_EXPORT_DIR`, to put it elsewhere. Exporting again replaces the files the last export wrote (the ones listed in its `layout.json`) and leaves anything else in the folder alone.

Strips stack frames top to bottom, frame 0 at the minimum (a button: off, then on). Default frames: knob 128, slider 128, meter 48, wheel 128, button 2. A strip longer than 16,384 px at 2x is written at 1x instead, and its file name has no `@2x`; `maxLength` changes the limit (0 for none). Figma can't export past 32,768 px whatever `maxLength` says, so a strip longer than that even at 1x (a 260 px knob at 128 frames, say) is rebuilt with the most frames that fit and listed in `fallbacks`. Its file name and `layout.json` carry the real frame count.

## How it connects

The bridge speaks MCP over stdio and listens on `ws://127.0.0.1:7417` (set `VSTGUI_MCP_PORT` to change it; the plugin's manifest must list the same port). Figma plugins can't accept connections, so the plugin connects out to the bridge. One agent session at a time can hold the port.

The bridge only accepts connections with a `null` origin, which is what Figma's plugin iframe sends, so a web page open in your browser can't connect and pose as the plugin. Once a plugin window is connected, a second one is turned away while the first still answers. For scripted tests from Node, set `VSTGUI_MCP_ANY_ORIGIN=1`.

Long strip builds send progress as they go. A request only times out if the plugin goes quiet for 30 s (120 s for `build_strip`, `build_panel`, `update_panel` and `export_ui`), not after a fixed total time.
