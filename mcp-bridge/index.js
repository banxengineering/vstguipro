#!/usr/bin/env node
// vstgui-mcp: lets Claude Code or Codex drive VST GUI Pro in Figma.
//
// Speaks MCP over stdio to the agent, and runs a WebSocket server on
// localhost that the plugin connects out to when the user turns on Agent
// mode (Figma plugins can't be called from outside). Each tool call becomes
// one agent-* request; the plugin's reply carries the same id.
//
// stdout belongs to MCP: log with console.error only.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.VSTGUI_MCP_PORT) || 7417;
// The agent-* message shapes this bridge speaks; the plugin reports its own
// in agent-hello (code.js AGENT_PROTOCOL)
const PROTOCOL = 2;
const TIMEOUT_MS = 30000;
const STRIP_TIMEOUT_MS = 120000;
const log = (...a) => console.error('[vstgui-mcp]', ...a);

// ===== Plugin link =====
let plugin = null;      // the connected plugin's socket
let hello = null;       // its agent-hello reply: { pro, version, protocol, controls }
let mismatch = null;    // why the connected plugin can't be used, if it can't
let listenError = null; // why the server isn't listening, if it isn't
let seq = 0;
const pending = new Map(); // id -> { resolve, reject, timer, arm, onFile }

// Figma's plugin iframe has a null origin. Web pages send their own, so a
// site open in the browser can't connect and pose as the plugin.
// VSTGUI_MCP_ANY_ORIGIN=1 lets scripted tests connect from Node.
const ANY_ORIGIN = process.env.VSTGUI_MCP_ANY_ORIGIN === '1';
// A busy port is retried, so once the other session lets go this one takes
// over without a restart
const RETRY_MS = 3000;
function listen() {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: PORT,
    verifyClient: ({ origin }) => {
      if (ANY_ORIGIN || origin === 'null') return true;
      log(`refused a connection from ${origin || 'a client with no origin'}: only the VST GUI Pro plugin may connect`);
      return false;
    }
  });
  wss.on('listening', () => {
    listenError = null;
    log(`waiting for VST GUI Pro on ws://localhost:${PORT}`);
  });
  wss.on('error', e => {
    const busy = e.code === 'EADDRINUSE';
    const why = busy
      ? `Port ${PORT} is in use by another Claude Code or Codex session running vstgui-mcp. Only one session can drive VST GUI Pro at a time: close the other one. This session retries every few seconds and connects by itself once the port is free.`
      : `The bridge couldn't listen on port ${PORT}: ${e.message}`;
    if (why !== listenError) log(why);
    listenError = why;
    if (busy) {
      wss.close();
      setTimeout(listen, RETRY_MS);
    }
  });
  wss.on('connection', onConnection);
}
listen();

const DISCONNECTED = 'VST GUI Pro disconnected before it answered. Check the plugin is still open in Figma with Agent mode on.';
const BUSY_CODE = 4001; // ui.html shows this as "another window is connected"

// Forget the plugin and fail everything still waiting on it
function dropPlugin(why) {
  const sock = plugin;
  plugin = null;
  hello = null;
  mismatch = null;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(why));
    pending.delete(id);
  }
  if (sock) sock.terminate();
}

function adopt(sock) {
  if (sock.readyState !== sock.OPEN) return;
  plugin = sock;
  hello = null;
  mismatch = null;
  log('VST GUI Pro connected');
  sock.on('message', data => {
    let m;
    try { m = JSON.parse(String(data)); } catch (e) { return; }
    const p = m && pending.get(m.id);
    if (!p) return;
    // A long build reporting progress: still alive, keep waiting
    if (m.progress) { p.arm(); return; }
    // One file of an export, ahead of the final reply
    if (m.file) {
      p.arm();
      if (p.onFile) p.onFile(m);
      return;
    }
    pending.delete(m.id);
    clearTimeout(p.timer);
    p.resolve(m);
  });
  sock.on('close', () => {
    if (plugin !== sock) return;
    log('VST GUI Pro disconnected');
    dropPlugin(DISCONNECTED);
  });
  request('agent-hello').then(checkHello).catch(() => {});
}

// Remembers the plugin's hello, and whether it speaks our protocol
function checkHello(r) {
  hello = r;
  const theirs = Number(r && r.protocol) || 1;
  mismatch = theirs === PROTOCOL ? null
    : theirs < PROTOCOL
      ? `VST GUI Pro ${r.version || ''} in Figma is older than this bridge (agent protocol ${theirs}, the bridge needs ${PROTOCOL}). Update the plugin, then reopen it.`
      : `VST GUI Pro ${r.version || ''} in Figma is newer than this bridge (agent protocol ${theirs}, the bridge speaks ${PROTOCOL}). Update vstgui-mcp, then restart your agent session.`;
  if (mismatch) log(mismatch);
  return r;
}

function onConnection(sock) {
  if (!plugin) { adopt(sock); return; }
  // A plugin is already linked. Keep it while it still answers a ping, so a
  // second plugin window can't take over mid-session; replace it only if it
  // has gone quiet (e.g. Figma closed without a clean disconnect).
  const old = plugin;
  let alive = false;
  old.once('pong', () => { alive = true; });
  try { old.ping(); } catch (e) { /* already gone */ }
  setTimeout(() => {
    if (alive && plugin === old) {
      log('refused a second VST GUI Pro window: one is already connected');
      sock.close(BUSY_CODE, 'Another VST GUI Pro window is connected');
      return;
    }
    if (plugin === old) {
      log('the connected VST GUI Pro stopped answering; switching to the new one');
      dropPlugin(DISCONNECTED);
    }
    adopt(sock);
  }, 1500);
}

const NOT_CONNECTED = 'VST GUI Pro isn\'t connected. Open the plugin in Figma (desktop app) and click "Agent" in its header so the dot turns green.';

function request(type, payload = {}, timeoutMs = TIMEOUT_MS, onFile = null) {
  if (listenError) return Promise.reject(new Error(listenError));
  if (!plugin || plugin.readyState !== plugin.OPEN) return Promise.reject(new Error(NOT_CONNECTED));
  if (mismatch && type !== 'agent-hello') return Promise.reject(new Error(mismatch));
  const id = 'r' + (++seq);
  // JSON drops undefined fields, so the plugin only sees what was given
  const msg = JSON.stringify({ ...payload, id, type });
  return new Promise((resolve, reject) => {
    const p = { resolve, reject, timer: null, onFile };
    // Each progress report restarts the clock, so a long strip build only
    // times out if the plugin goes quiet
    p.arm = () => {
      clearTimeout(p.timer);
      p.timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`VST GUI Pro went quiet for ${Math.round(timeoutMs / 1000)} s without answering. Figma may be busy, or the plugin was closed.`));
      }, timeoutMs);
    };
    p.arm();
    pending.set(id, p);
    plugin.send(msg);
  });
}

// ===== MCP =====
const fail = text => ({ content: [{ type: 'text', text }], isError: true });

// Plugin reply -> MCP result: the PNG as an image the agent can see, the rest as JSON
function result(r) {
  if (!r.ok) return fail(r.message || r.error || 'VST GUI Pro refused the request.');
  const { png, ok, id, req, ...info } = r;
  const content = [{ type: 'text', text: JSON.stringify(info, null, 1) }];
  if (png) content.push({ type: 'image', data: png, mimeType: 'image/png' });
  return { content };
}

async function call(type, payload, timeoutMs) {
  try {
    return result(await request(type, payload, timeoutMs));
  } catch (e) {
    return fail(e.message);
  }
}

// ===== Export files =====
// export_ui's files arrive one message at a time ({ file: true, dir, path,
// data (base64) | text }) and are written under <folder>/<dir>/.
const EXPORT_ROOT = process.env.VSTGUI_EXPORT_DIR || path.join(process.cwd(), 'vstgui-export');

function exportWriter(folder) {
  const root = path.resolve(process.cwd(), folder || EXPORT_ROOT);
  const w = { dir: null, written: [], errors: [] };
  w.write = m => {
    try {
      if (!w.dir) {
        w.dir = path.join(root, String(m.dir || 'panel').replace(/[^a-z0-9-]+/gi, '-') || 'panel');
        clearOldExport(w.dir);
      }
      const target = path.resolve(w.dir, String(m.path || ''));
      if (!target.startsWith(w.dir + path.sep)) throw new Error(`refused to write outside the export folder: ${m.path}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof m.data === 'string' ? Buffer.from(m.data, 'base64') : String(m.text ?? ''));
      w.written.push(target);
    } catch (e) {
      w.errors.push(`${m.path}: ${e.message}`);
      log('export write failed:', m.path, e.message);
    }
  };
  return w;
}

// A re-export replaces the files the last one wrote (listed in its
// layout.json), so renamed controls don't leave stale strips behind.
// Nothing else in the folder is touched.
function clearOldExport(dir) {
  let old;
  try { old = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8')); } catch (e) { return; }
  if (!old || !String(old.generator || '').startsWith('VST GUI Pro')) return;
  const files = new Set(['layout.json']);
  if (old.panel && old.panel.background) files.add(old.panel.background);
  (old.controls || []).forEach(c => { if (c.file) files.add(c.file); });
  for (const f of files) {
    const t = path.resolve(dir, f);
    if (!t.startsWith(dir + path.sep)) continue;
    try { fs.unlinkSync(t); } catch (e) { /* already gone */ }
  }
}

// What the agent can do, in the user's words. The `help` tool and prompt
// return it; keep it in step with the tools below.
const HELP = `VST GUI Pro agent mode: what it can do

Build
- A whole plugin UI from a sketch, screenshot or description: the panel (background art) at your window size, every control placed on it, and text labels.
- Controls: knobs, sliders, buttons (on/off), meters (bar or VU needle) and wheels (pitch or mod).
- Or one control on its own, matched to a reference image.

Change
- Anything after the build, in plain words: "make the knob red", "move the meters 10 px left", "add a Mix knob", "darker panel".
- Or send an updated screenshot or a marked-up sketch: only what differs is changed.
- In a later session too: the agent can read the panel back from Figma.
- Change controls through the agent or the plugin's studios, not by painting them in Figma: each control's strip is rebuilt from its spec on export, so hand edits to a control are lost. Hand edits to the panel art and labels do end up in the export.

Export (only when you say so)
- background@2x.png (controls hidden, labels baked in), one PNG strip per distinct control, and layout.json with every control's position, size and frame count, for JUCE, HISE or your own code.
- Default frames: knob 128, slider 128, meter 48, wheel 128, button 2. Figma can't export an image longer than 32,768 px, so a big knob is saved at 1x, or with the most frames that fit; the file name shows the frame count.

Can't do yet
- Free shapes (boxes, lines), readout or display boxes, and icon buttons other than power. Draw these in Figma on the panel and they are baked into the background; live text such as a dB readout belongs in your plugin code anyway.

Watching
- Keep Figma visible: while the agent builds, the plugin shrinks to a small bar so you can watch the canvas. Click Expand to get the full window back.`;

const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const server = new McpServer({ name: 'vstgui', version: VERSION }, {
  instructions: [
    'Drives VST GUI Pro, a Figma plugin that builds audio-plugin GUIs from JSON specs: knobs, sliders, buttons, meters (bar or VU) and wheels (pitch or mod), on a panel (the plugin background), and exports them as PNG strips plus a layout file. If the user asks what this can do, or for help, call the help tool and pass its answer on.',
    'Before building from a reference or idea: get_status; if not connected, tell the user to open VST GUI Pro in Figma desktop and click Agent. Then ask at most 5 short questions, only ones that change the result: window size; ambiguities (stereo meter or two mono); what the tools can\'t draw (say so now, and what you\'ll do instead); export folder. When you summarize, say if a strip would pass 32,768 px even at 1x: export saves it with the most frames that fit. Skip what the prompt answers.',
    'When you start building, tell the user once to switch to Figma: the plugin shrinks to a bar so they can watch the canvas. Post one short line per step. Images cost tokens: check the whole panel with get_layout rather than snapshotting each control, and send scale 1 when detail doesn\'t matter.',
    'Matching one control to a reference: 1) get_spec_schema for its type to learn every field, its default, range and allowed values. 2) build_control with your best first spec; it returns a PNG and nodeId. 3) Compare the PNG to the reference, then update_control with that nodeId and a full revised spec. Repeat until it matches.',
    'Building a whole UI from a reference: 1) get_spec_schema("panel") and build_panel at the reference\'s size in px (the plugin window). 2) place_control for every control, x and y being its top-left in panel px. A control\'s size is in its spec (knob `size`; slider `length`/`thickness`; button `width`/`height`; meters and wheels: see their schema). Name each control after what it does ("Cutoff", "Bypass"): names become file names. 3) set_label for text that isn\'t part of the panel art. 4) get_layout: compare its PNG to the reference, fix every warning, line rows up with arrange, restyle or resize with update_control. Repeat until it matches.',
    'Then stop: tell the user what you couldn\'t match and what export_ui would write (files, frames, 1x/2x), and ask for changes or export. Never call export_ui until the user asks. For a new screenshot or marked-up sketch, change only what differs. In a new session, get_layout and read_selection_spec read a panel back.',
    'Strips are rebuilt from each control\'s spec, so hand edits to a control in Figma are lost on update and export; hand edits to panel art, labels and shapes drawn on the panel are exported. Say so if the user edits in Figma.',
    'Colors are #RRGGBB. Values outside the limits are clamped and unknown enum values fall back to the default; the reply\'s `spec` shows what was actually used. Knob spec lengths are in units where the knob body is 100 wide; `size` is the frame width in px.',
    'value is 0 to 1: a knob\'s position (0 = 7:30, 0.5 = 12 o\'clock, 1 = 4:30), a slider\'s or wheel\'s position, a meter\'s level, a button off (0) or on (1). Match it to the reference.',
    'If the spec can\'t express something in the reference, say what is missing rather than faking it.'
  ].join('\n')
});

server.registerTool('help', {
  description: 'What VST GUI Pro agent mode can do, in plain words for the user: build, change, export, limits. Call it when the user asks for help or what this can do, and pass the answer on.',
  inputSchema: {}
}, async () => ({ content: [{ type: 'text', text: HELP }] }));

// Prompts show as slash commands in clients that support them (Claude Code:
// /mcp__vstgui__help). Clients that don't just use the tools.
const say = text => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });
server.registerPrompt('help', {
  title: 'VST GUI Pro: help',
  description: 'What agent mode can do'
}, () => say('Call the vstgui help tool and tell me what it says, briefly, then ask what I\'d like to build.'));
server.registerPrompt('build', {
  title: 'VST GUI Pro: build a UI',
  description: 'Turn a sketch, screenshot or idea into a plugin UI in Figma',
  argsSchema: { idea: z.string().optional().describe('What to build, e.g. "a gain plugin, clean black and white"') }
}, a => say(`I want a plugin UI built in Figma with VST GUI Pro${a.idea ? ': ' + a.idea : ''}. If I attach an image, it's the reference. Check the plugin is connected, ask me your questions first, then build it and show me the result. Don't export until I say so.`));
server.registerPrompt('export', {
  title: 'VST GUI Pro: export',
  description: 'Write the current panel to disk'
}, () => say('Export the current VST GUI Pro panel now with export_ui. Tell me the folder, the files, and anything that couldn\'t be exported.'));

const CONTROLS = ['knob', 'slider', 'button', 'meter', 'wheel'];
const control = z.enum(CONTROLS).default('knob').describe('Control type');
const spec = z.record(z.string(), z.any()).describe('Spec. Partial is fine: missing fields take the defaults from get_spec_schema.');
const value = z.number().min(0).max(1).optional().describe('Position or level, 0 to 1 (button: 0 off, 1 on)');
const scale = z.number().min(0.5).max(4).optional().describe('PNG scale, default 2');
const nodeId = z.string().optional().describe('Figma node id from an earlier call. Defaults to the current selection.');
const panelId = z.string().optional().describe('The panel\'s id from build_panel. Defaults to the panel the selection is in.');
const px = z.number().describe('Panel px from the panel\'s top-left');
const name = z.string().optional().describe('What the control does, e.g. "Cutoff". Used for file names on export.');

server.registerTool('get_status', {
  description: 'Whether VST GUI Pro is connected, its version, and whether the user has a PRO license (Agent mode needs one).',
  inputSchema: {}
}, async () => {
  if (listenError) return fail(listenError);
  if (!plugin) return { content: [{ type: 'text', text: NOT_CONNECTED }] };
  try { checkHello(await request('agent-hello')); } catch (e) { return fail(e.message); }
  if (mismatch) return fail(mismatch);
  return { content: [{ type: 'text', text: JSON.stringify({ connected: true, pro: hello.pro, version: hello.version, protocol: hello.protocol, controls: hello.controls }) }] };
});

server.registerTool('get_spec_schema', {
  description: 'Every spec field for a control type or the panel: `base` holds the defaults (and shows the structure), `limits` the [min, max] of numeric fields by dotted path, `enums` the allowed strings by dotted path. Call this before building.',
  inputSchema: { control: z.enum([...CONTROLS, 'panel']).default('knob').describe('Control type, or panel') }
}, async a => call('agent-schema', { control: a.control }));

server.registerTool('build_control', {
  description: 'Builds one control on its own on the canvas (not on a panel) at the viewport center, and returns its PNG, nodeId and the normalized spec. For a full UI use place_control instead.',
  inputSchema: { control, spec, value, scale }
}, async a => call('agent-build', a));

server.registerTool('update_control', {
  description: 'Changes a control: a new spec or value rebuilds it in place (the nodeId changes: use the one returned; send the full spec, omitted fields go back to defaults). x/y move it and name renames it, without a rebuild. Returns its box, PNG and spec.',
  inputSchema: { nodeId, spec: spec.optional(), value, x: px.optional(), y: px.optional(), name, scale }
}, async a => call('agent-update', a));

server.registerTool('build_panel', {
  description: 'Builds a panel, the plugin\'s background art, at the viewport center. Its `width` and `height` in the spec are the plugin window in px. Returns panelId, size and PNG.',
  inputSchema: { spec, scale }
}, async a => call('agent-panel-build', a, STRIP_TIMEOUT_MS));

server.registerTool('update_panel', {
  description: 'Redraws a panel\'s art with a new full spec. Every control and label on it stays where it is.',
  inputSchema: { panelId, spec, scale }
}, async a => call('agent-panel-update', a, STRIP_TIMEOUT_MS));

server.registerTool('place_control', {
  description: 'Builds one control on a panel with its top-left at x, y (panel px; omit both to center it). Returns nodeId, box, normalized spec and the control\'s PNG.',
  inputSchema: { panelId, control, spec, x: px.optional(), y: px.optional(), value, name, scale }
}, async a => call('agent-place', a));

server.registerTool('arrange', {
  description: 'Moves several controls or labels on a panel in one call, for lining up rows and columns. Returns each new box.',
  inputSchema: {
    panelId,
    items: z.array(z.object({ nodeId: z.string(), x: px.optional(), y: px.optional() })).min(1)
  }
}, async a => call('agent-arrange', a));

server.registerTool('remove_control', {
  description: 'Deletes a control or label made by VST GUI Pro.',
  inputSchema: { nodeId: z.string() }
}, async a => call('agent-remove', a));

server.registerTool('set_label', {
  description: 'Adds a text label to a panel, or changes one (pass its nodeId). Labels are baked into the background on export. Without width, x is the label\'s left edge, center or right edge, following align; with width, the text wraps in a box that starts at x.',
  inputSchema: {
    panelId,
    nodeId: z.string().optional().describe('An existing label to change'),
    text: z.string().optional(),
    x: px.optional(),
    y: px.optional(),
    size: z.number().min(4).max(200).optional().describe('Font size in px, default 11'),
    color: z.string().optional().describe('#RRGGBB'),
    weight: z.enum(['regular', 'medium', 'semibold', 'bold']).optional(),
    font: z.string().optional().describe('Font family, default Inter. Falls back to Inter if Figma doesn\'t have it.'),
    align: z.enum(['left', 'center', 'right']).optional(),
    width: z.number().min(0).optional().describe('Wrap width in px; 0 for no wrapping'),
    tracking: z.number().min(-20).max(100).optional().describe('Letter spacing in %'),
    opacity: z.number().min(0).max(100).optional()
  }
}, async a => call('agent-label', a));

server.registerTool('get_layout', {
  description: 'Everything on a panel: each control\'s nodeId, type, name, box and value, each label, and warnings (overlaps, past the edge, half pixels, strips placed by mistake), plus a PNG of the whole panel. Use it to check the layout against the reference.',
  inputSchema: { panelId, scale }
}, async a => call('agent-layout', a));

server.registerTool('export_ui', {
  description: 'Only when the user asks to export: they usually want changes first. Exports the whole UI to disk: background(@2x).png (the panel with its controls hidden, labels baked in), one strip PNG per distinct control in knobs/, sliders/, buttons/, meters/ and wheels/ (identical controls share one file), and layout.json with every control\'s box, frames and file. A re-export replaces the files of the last one. Can take a few minutes.',
  inputSchema: {
    panelId,
    folder: z.string().optional().describe('Where to write; a subfolder per panel is made inside. Default: vstgui-export in the current project (or VSTGUI_EXPORT_DIR)'),
    scale: z.union([z.literal(1), z.literal(2)]).optional().describe('2 (default) writes @2x files'),
    frames: z.object({
      knob: z.number().int().min(2).max(256),
      slider: z.number().int().min(2).max(256),
      meter: z.number().int().min(2).max(256),
      wheel: z.number().int().min(2).max(256)
    }).partial().optional().describe('Frames per strip by type. Defaults: knob 128, slider 128, meter 48, wheel 128; buttons are always 2'),
    maxLength: z.number().int().min(0).optional().describe('A strip longer than this in px at 2x is written at 1x instead. Default 16384; 0 for Figma\'s own limit of 32768, which always applies')
  }
}, async a => {
  const { folder, ...payload } = a;
  const out = exportWriter(folder);
  try {
    const r = await request('agent-export', payload, STRIP_TIMEOUT_MS, m => out.write(m));
    if (!r.ok) return result(r);
    return result({ ...r, folder: out.dir, written: out.written.length, writeErrors: out.errors });
  } catch (e) {
    return fail(e.message + (out.written.length ? ` (${out.written.length} files were written to ${out.dir} before that)` : ''));
  }
});

server.registerTool('snapshot', {
  description: 'PNG of a node on the canvas (default: the selection). Large nodes are scaled down to fit 2048 px.',
  inputSchema: { nodeId, scale }
}, async a => call('agent-snapshot', a));

server.registerTool('read_selection_spec', {
  description: 'The spec stored on a control VST GUI Pro built (default: the selection), for example one the user made in a studio.',
  inputSchema: { nodeId }
}, async a => call('agent-read-selection', a));

server.registerTool('build_strip', {
  description: 'Builds the full animation strip (sprite sheet) for a spec, ready to export from Figma. Do this once the single control looks right. Returns the nodeId and size, not a PNG.',
  inputSchema: {
    control,
    spec,
    frames: z.number().int().min(2).max(256).optional().describe('Frame count. Default: knob 128, slider 128, meter 48, wheel 128; buttons are always 2'),
    axis: z.enum(['v', 'h']).default('v').describe('v stacks frames vertically, h side by side'),
    gap: z.number().int().min(0).max(64).default(0).describe('Pixels between frames')
  }
}, async a => call('agent-strip', a, STRIP_TIMEOUT_MS));

await server.connect(new StdioServerTransport());
log('MCP server ready');
