"use strict";

// Version constants
const VERSION = "2.2.0";
const BUILD_DATE = "10-11-2026";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Window size: user-resizable via the grip in the UI, remembered between runs
const UI_SIZE_DEFAULT = { width: 900, height: 540 };
const UI_SIZE_MIN = { width: 360, height: 400 };
const UI_SIZE_KEY = 'ui_size_v2'; // v2: landscape layout, ignore sizes saved for the old portrait one
const UI_SIZE_MAX = { width: 1600, height: 1400 };

function clampUiSize(size) {
    const w = Math.round(Number(size && size.width) || UI_SIZE_DEFAULT.width);
    const h = Math.round(Number(size && size.height) || UI_SIZE_DEFAULT.height);
    return {
        width: Math.max(UI_SIZE_MIN.width, Math.min(UI_SIZE_MAX.width, w)),
        height: Math.max(UI_SIZE_MIN.height, Math.min(UI_SIZE_MAX.height, h))
    };
}

figma.showUI(__html__, { width: UI_SIZE_DEFAULT.width, height: UI_SIZE_DEFAULT.height, themeColors: true });
// BYOC walkthrough tips: on until the user turns them off
figma.clientStorage.getAsync('byoc_tips').then(on => {
    figma.ui.postMessage({ type: 'byoc-prefs', tips: on !== false });
}).catch(() => {});
// Studio strips export @2x unless the user turned it off
figma.clientStorage.getAsync('export_2x').then(on => {
    figma.ui.postMessage({ type: 'export-prefs', x2: on !== false });
}).catch(() => {});
// The header's ? pulses until the user first opens the tips
figma.clientStorage.getAsync('help_seen').then(seen => {
    figma.ui.postMessage({ type: 'help-prefs', seen: seen === true });
}).catch(() => {});
// What's new: the UI shows a one-time card when it has notes for VERSION
// and this user hasn't seen them yet
figma.clientStorage.getAsync('whats_new_seen').then(seen => {
    figma.ui.postMessage({ type: 'whats-new', version: VERSION, seen: typeof seen === 'string' ? seen : '' });
}).catch(() => {});
figma.clientStorage.getAsync(UI_SIZE_KEY).then(saved => {
    if (saved) {
        const size = clampUiSize(saved);
        figma.ui.resize(size.width, size.height);
    }
}).catch(e => console.error('Error restoring window size:', e));

// Send Figma user ID to UI for license validation

// FIXED: Added null checks and defensive programming (compatible with Figma's JS runtime)
const isLoggedIn = !!(figma.currentUser && figma.currentUser.id && figma.currentUser.name !== 'Anonymous');

// Generate a unique identifier for tracking
let uniqueUserId = 'anonymous';
try {
    if (figma.currentUser && figma.currentUser.id) {
        // Use the actual Figma user ID if available
        uniqueUserId = figma.currentUser.id;
    } else if (figma.currentUser && figma.currentUser.name && figma.currentUser.name !== 'Anonymous') {
        // Use name + session ID for partially logged users
        uniqueUserId = `temp_${figma.currentUser.name}_${figma.currentUser.sessionId || 'no-session'}`;
    } else {
        // Generate a device-based ID for anonymous users
        uniqueUserId = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} catch (e) {
    console.error('Error generating user ID:', e);
    uniqueUserId = `fallback_${Date.now()}`;
}

const userInfo = {
    type: 'figma-user-id',
    userId: figma.currentUser && figma.currentUser.id ? figma.currentUser.id : null,
    userName: figma.currentUser && figma.currentUser.name ? figma.currentUser.name : 'Anonymous',
    sessionId: figma.currentUser && figma.currentUser.sessionId ? figma.currentUser.sessionId : null,
    uniqueUserId: uniqueUserId, // This will always have a value for tracking
    isLoggedIn: isLoggedIn,
    userType: isLoggedIn ? 'logged_in' : (figma.currentUser && figma.currentUser.name !== 'Anonymous' ? 'partial' : 'anonymous')
};
// FIXED: Wrapped in try-catch to prevent messaging errors
try {
    figma.ui.postMessage(userInfo);
    
    // Send version info to UI
    figma.ui.postMessage({
        type: 'version-info',
        version: VERSION,
        buildDate: BUILD_DATE
    });
} catch (e) {
    console.error('Error posting initial messages:', e);
}

// ===== License =====
// The PRO state lives here, not in the UI: code.js asks the license server
// itself and only saves a key the server accepted. If the server can't be
// reached, a result it gave in the last 30 days still counts, so paying users
// keep PRO through outages and offline sessions.
const LICENSE_URL = 'https://dev-banxengineering.pythonanywhere.com/vstguipro/validate';
const LICENSE_PRODUCT_ID = '6Q31v';
const LICENSE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const LICENSE_TIMEOUT_MS = 10000;
let proUnlocked = false;
let licenseState = { licenseKey: null, licenseValid: false, licenseTimestamp: null, source: 'none' };

// Asks the server about a key. answer is true/false when the server gives a
// clear answer, null when it can't be reached or replies with an error.
function checkLicenseKey(key) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield Promise.race([
                fetch(LICENSE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        license_key: key,
                        product_id: LICENSE_PRODUCT_ID,
                        figma_user_id: userInfo.userId,
                        unique_user_id: uniqueUserId,
                        user_name: userInfo.userName,
                        session_id: userInfo.sessionId,
                        user_type: userInfo.userType,
                        is_logged_in: isLoggedIn
                    })
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('License server timed out')), LICENSE_TIMEOUT_MS))
            ]);
            if (res.status >= 500) return { answer: null, message: `License server error (${res.status})` };
            const data = yield res.json();
            if (!data || typeof data.success !== 'boolean') return { answer: null, message: 'Unexpected reply from the license server' };
            return { answer: data.success, message: data.message || '' };
        } catch (e) {
            return { answer: null, message: String(e && e.message || e) };
        }
    });
}

function clearStoredLicense() {
    return __awaiter(this, void 0, void 0, function* () {
        yield figma.clientStorage.deleteAsync('license_key');
        yield figma.clientStorage.deleteAsync('license_valid');
        yield figma.clientStorage.deleteAsync('license_timestamp');
    });
}

// Checks the saved key once at launch
function loadLicense() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const key = yield figma.clientStorage.getAsync('license_key');
            if (typeof key !== 'string' || !key) {
                proUnlocked = false;
                licenseState = { licenseKey: null, licenseValid: false, licenseTimestamp: null, source: 'none' };
                return;
            }
            const check = yield checkLicenseKey(key);
            if (check.answer === true) {
                const now = Date.now();
                yield figma.clientStorage.setAsync('license_valid', true);
                yield figma.clientStorage.setAsync('license_timestamp', now);
                proUnlocked = true;
                licenseState = { licenseKey: key, licenseValid: true, licenseTimestamp: now, source: 'server' };
            } else if (check.answer === false) {
                yield clearStoredLicense();
                proUnlocked = false;
                licenseState = { licenseKey: null, licenseValid: false, licenseTimestamp: null, source: 'server' };
            } else {
                // No answer: fall back to the last result the server gave
                const valid = yield figma.clientStorage.getAsync('license_valid');
                const ts = yield figma.clientStorage.getAsync('license_timestamp');
                const age = typeof ts === 'number' ? Date.now() - ts : Infinity;
                proUnlocked = valid === true && age >= 0 && age < LICENSE_GRACE_MS;
                licenseState = { licenseKey: key, licenseValid: proUnlocked, licenseTimestamp: typeof ts === 'number' ? ts : null, source: 'saved' };
                console.warn('License server unavailable, using saved result:', check.message);
            }
        } catch (e) {
            console.error('Error loading license:', e);
        }
    });
}
const proReady = loadLicense();

// Studio messages whose spec may be a PRO design
const PRO_SPEC_MESSAGES = new Set([
    'create-knob-spec', 'update-knob-spec', 'create-slider-spec', 'update-slider-spec',
    'create-button-spec', 'update-button-spec', 'create-meter-spec', 'update-meter-spec',
    'create-wheel-spec', 'update-wheel-spec', 'create-panel-spec', 'update-panel-spec', 'export-strip'
]);
// My designs: saving, deleting and importing are PRO
const DESIGN_MESSAGES = new Set(['designs-save', 'designs-delete', 'designs-import']);

// True (and tells the UI to show the PRO dialog) when msg asks for PRO work
// without a license
function proBlocked(msg) {
    if (proUnlocked) return false;
    let name = '';
    let feature = false;
    if (msg.type === 'create-gallery-panel') name = 'This layout template';
    else if (DESIGN_MESSAGES.has(msg.type)) { name = 'Saving designs'; feature = true; }
    else if (PRO_SPEC_MESSAGES.has(msg.type) && msg.spec && msg.spec.tier === 'pro') name = msg.spec.name || 'This design';
    else return false;
    if (msg.type === 'export-strip') figma.ui.postMessage({ type: 'export-strip-status', id: msg.id, phase: 'cancelled' });
    figma.ui.postMessage({ type: 'pro-required', name, feature });
    return true;
}

// ===== My designs =====
// Studio designs the user saved, kept in their Figma plugin storage so they
// show up in every file, and exported/imported as JSON files. Every spec is
// cleaned by its studio's normalizer on the way in, like a placed control.
const DESIGNS_KEY = 'saved_designs';
const DESIGNS_MAX = 500;
const DESIGNS_MAX_CHARS = 4000000; // clientStorage allows about 5 MB per user
const DESIGN_NORMALIZERS = {
    knob: normalizeKnobSpec, slider: normalizeSliderSpec, button: normalizeButtonSpec,
    meter: normalizeMeterSpec, wheel: normalizeWheelSpec, panel: normalizePanelSpec
};

function loadDesigns() {
    return __awaiter(this, void 0, void 0, function* () {
        const list = yield figma.clientStorage.getAsync(DESIGNS_KEY);
        return Array.isArray(list)
            ? list.filter(d => d && typeof d.id === 'string' && DESIGN_NORMALIZERS[d.kind] && d.spec && typeof d.spec === 'object')
            : [];
    });
}

function storeDesigns(list) {
    return __awaiter(this, void 0, void 0, function* () {
        if (list.length > DESIGNS_MAX || JSON.stringify(list).length > DESIGNS_MAX_CHARS) {
            throw new Error('My designs is full. Delete or export some designs first.');
        }
        yield figma.clientStorage.setAsync(DESIGNS_KEY, list);
    });
}

// The list the UI shows; empty and locked without PRO
function postDesigns() {
    return __awaiter(this, void 0, void 0, function* () {
        yield proReady;
        const designs = proUnlocked ? yield loadDesigns() : [];
        figma.ui.postMessage({ type: 'designs-data', locked: !proUnlocked, designs });
    });
}

const newDesignId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Designs from an imported file: our export ({ designs: [...] }), a bare
// list, or a single { kind, spec }
function designsFromFile(data) {
    const items = Array.isArray(data) ? data
        : data && Array.isArray(data.designs) ? data.designs
        : data && typeof data === 'object' ? [data]
        : [];
    const out = [];
    let invalid = 0;
    items.forEach(d => {
        const normalize = d && DESIGN_NORMALIZERS[d.kind];
        if (!normalize || !d.spec || typeof d.spec !== 'object') { invalid++; return; }
        out.push({ kind: d.kind, spec: normalize(d.spec) });
    });
    return { designs: out, invalid };
}

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
// CRITICAL FIX: Added error boundary around the entire message handler
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Validate message object
        if (!msg || typeof msg !== 'object' || !msg.type) {
            console.error('Invalid message received:', msg);
            return;
        }
        if (PRO_SPEC_MESSAGES.has(msg.type) || DESIGN_MESSAGES.has(msg.type) || msg.type === 'create-gallery-panel') {
            yield proReady;
            if (proBlocked(msg)) return;
        }

        if (msg.type === 'resize' && msg.size) {
        const size = clampUiSize(msg.size);
        figma.ui.resize(size.width, size.height);
        if (msg.persist) yield figma.clientStorage.setAsync(UI_SIZE_KEY, size);
    }
    else if (msg.type === 'create-knob-spec') {
        // Knob studio: one knob at the stage's value, or the full strip
        try {
            const spec = normalizeKnobSpec(msg.spec);
            const font = yield knobLabelFont(spec);
            const node = msg.animate
                ? createSpecKnobStrip(spec, msg.frames, msg.gap, msg.axis, font)
                : createSpecKnob(spec, msg.value, font);
            applyExportScale(node, msg.x2);
            placeAtViewportCenter(node);
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(msg.animate
                ? `${spec.name} strip: ${node.children.length} frames, ${Math.round(node.width)}×${Math.round(node.height)} px`
                : `${spec.name} knob added, ${Math.round(node.width)} px`);
        } catch (e) {
            console.error('Error creating studio knob:', e);
            figma.notify('Could not build the knob. Please try again.');
        }
    }
    else if (msg.type === 'update-knob-spec') {
        // Rebuild the selected studio knob or strip with the studio's settings
        try {
            const target = figma.currentPage.selection[0];
            const kind = target ? target.getPluginData('knobKind') : '';
            if (!kind) {
                figma.notify('Select a knob or strip made in the studio first.');
                return;
            }
            const spec = normalizeKnobSpec(msg.spec);
            const font = yield knobLabelFont(spec);
            const fresh = kind === 'strip'
                ? createSpecKnobStrip(spec, msg.frames, msg.gap, msg.axis, font)
                : createSpecKnob(spec, msg.value, font);
            applyExportScale(fresh, msg.x2);
            replaceNode(target, fresh);
            figma.currentPage.selection = [fresh];
            figma.notify(`Updated ${kind === 'strip' ? 'strip' : 'knob'}: ${spec.name}`);
        } catch (e) {
            console.error('Error updating studio knob:', e);
            figma.notify('Could not update the selection. Please try again.');
        }
    }
    else if (msg.type === 'create-slider-spec') {
        // Slider studio: one slider at the stage's value, or the full strip
        try {
            const spec = normalizeSliderSpec(msg.spec);
            const node = msg.animate
                ? createSpecSliderStrip(spec, msg.frames, msg.gap, msg.axis)
                : createSpecSlider(spec, msg.value);
            applyExportScale(node, msg.x2);
            placeAtViewportCenter(node);
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(msg.animate
                ? `${spec.name} strip: ${node.children.length} frames, ${Math.round(node.width)}×${Math.round(node.height)} px`
                : `${spec.name} slider added, ${Math.round(node.width)}×${Math.round(node.height)} px`);
        } catch (e) {
            console.error('Error creating studio slider:', e);
            figma.notify('Could not build the slider. Please try again.');
        }
    }
    else if (msg.type === 'update-slider-spec') {
        try {
            const target = figma.currentPage.selection[0];
            const kind = target ? target.getPluginData('sliderKind') : '';
            if (!kind) {
                figma.notify('Select a slider or strip made in the studio first.');
                return;
            }
            const spec = normalizeSliderSpec(msg.spec);
            const fresh = kind === 'strip'
                ? createSpecSliderStrip(spec, msg.frames, msg.gap, msg.axis)
                : createSpecSlider(spec, msg.value);
            applyExportScale(fresh, msg.x2);
            replaceNode(target, fresh);
            figma.currentPage.selection = [fresh];
            figma.notify(`Updated ${kind === 'strip' ? 'strip' : 'slider'}: ${spec.name}`);
        } catch (e) {
            console.error('Error updating studio slider:', e);
            figma.notify('Could not update the selection. Please try again.');
        }
    }
    else if (msg.type === 'create-button-spec') {
        // Button studio: one button in the stage's state, or the off/on strip
        try {
            const spec = normalizeButtonSpec(msg.spec);
            const node = msg.animate
                ? yield createSpecButtonStrip(spec, msg.gap, msg.axis)
                : yield createSpecButton(spec, msg.value);
            applyExportScale(node, msg.x2);
            placeAtViewportCenter(node);
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(msg.animate
                ? `${spec.name} strip: off and on, ${Math.round(node.width)}×${Math.round(node.height)} px`
                : `${spec.name} button added, ${Math.round(node.width)}×${Math.round(node.height)} px`);
        } catch (e) {
            console.error('Error creating studio button:', e);
            figma.notify('Could not build the button. Please try again.');
        }
    }
    else if (msg.type === 'update-button-spec') {
        try {
            const target = figma.currentPage.selection[0];
            const kind = target ? target.getPluginData('buttonKind') : '';
            if (!kind) {
                figma.notify('Select a button or strip made in the studio first.');
                return;
            }
            const spec = normalizeButtonSpec(msg.spec);
            const fresh = kind === 'strip'
                ? yield createSpecButtonStrip(spec, msg.gap, msg.axis)
                : yield createSpecButton(spec, msg.value);
            applyExportScale(fresh, msg.x2);
            replaceNode(target, fresh);
            figma.currentPage.selection = [fresh];
            figma.notify(`Updated ${kind === 'strip' ? 'strip' : 'button'}: ${spec.name}`);
        } catch (e) {
            console.error('Error updating studio button:', e);
            figma.notify('Could not update the selection. Please try again.');
        }
    }
    else if (msg.type === 'create-meter-spec') {
        // Meter studio: one meter at the stage's level, or the full strip
        try {
            const spec = normalizeMeterSpec(msg.spec);
            const fonts = yield meterFonts(spec);
            const node = msg.animate
                ? createSpecMeterStrip(spec, msg.frames, msg.gap, msg.axis, fonts)
                : createSpecMeter(spec, msg.value, fonts);
            applyExportScale(node, msg.x2);
            placeAtViewportCenter(node);
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(msg.animate
                ? `${spec.name} strip: ${node.children.length} frames, ${Math.round(node.width)}×${Math.round(node.height)} px`
                : `${spec.name} meter added, ${Math.round(node.width)}×${Math.round(node.height)} px`);
        } catch (e) {
            console.error('Error creating studio meter:', e);
            figma.notify('Could not build the meter. Please try again.');
        }
    }
    else if (msg.type === 'update-meter-spec') {
        try {
            const target = figma.currentPage.selection[0];
            const kind = target ? target.getPluginData('meterKind') : '';
            if (!kind) {
                figma.notify('Select a meter or strip made in the studio first.');
                return;
            }
            const spec = normalizeMeterSpec(msg.spec);
            const fonts = yield meterFonts(spec);
            const fresh = kind === 'strip'
                ? createSpecMeterStrip(spec, msg.frames, msg.gap, msg.axis, fonts)
                : createSpecMeter(spec, msg.value, fonts);
            applyExportScale(fresh, msg.x2);
            replaceNode(target, fresh);
            figma.currentPage.selection = [fresh];
            figma.notify(`Updated ${kind === 'strip' ? 'strip' : 'meter'}: ${spec.name}`);
        } catch (e) {
            console.error('Error updating studio meter:', e);
            figma.notify('Could not update the selection. Please try again.');
        }
    }
    else if (msg.type === 'create-wheel-spec') {
        // Wheel studio: one wheel at the stage's value, or the full strip
        try {
            const spec = normalizeWheelSpec(msg.spec);
            const node = msg.animate
                ? createSpecWheelStrip(spec, msg.frames, msg.gap, msg.axis)
                : createSpecWheel(spec, msg.value);
            applyExportScale(node, msg.x2);
            placeAtViewportCenter(node);
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(msg.animate
                ? `${spec.name} strip: ${node.children.length} frames, ${Math.round(node.width)}×${Math.round(node.height)} px`
                : `${spec.name} ${wheelTitle(spec).toLowerCase()} added, ${Math.round(node.width)}×${Math.round(node.height)} px`);
        } catch (e) {
            console.error('Error creating studio wheel:', e);
            figma.notify('Could not build the wheel. Please try again.');
        }
    }
    else if (msg.type === 'update-wheel-spec') {
        try {
            const target = figma.currentPage.selection[0];
            const kind = target ? target.getPluginData('wheelKind') : '';
            if (!kind) {
                figma.notify('Select a wheel or strip made in the studio first.');
                return;
            }
            const spec = normalizeWheelSpec(msg.spec);
            const fresh = kind === 'strip'
                ? createSpecWheelStrip(spec, msg.frames, msg.gap, msg.axis)
                : createSpecWheel(spec, msg.value);
            applyExportScale(fresh, msg.x2);
            replaceNode(target, fresh);
            figma.currentPage.selection = [fresh];
            figma.notify(`Updated ${kind === 'strip' ? 'strip' : 'wheel'}: ${spec.name}`);
        } catch (e) {
            console.error('Error updating studio wheel:', e);
            figma.notify('Could not update the selection. Please try again.');
        }
    }
    else if (msg.type === 'create-panel-spec') {
        // Panel studio: a frame with the art locked at the back
        try {
            const spec = normalizePanelSpec(msg.spec);
            const node = yield createSpecPanel(spec);
            placeAtViewportCenter(node);
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(`${spec.name} panel added, ${Math.round(node.width)}×${Math.round(node.height)} px. Place your controls inside it.`);
        } catch (e) {
            console.error('Error creating studio panel:', e);
            figma.notify('Could not build the panel. Please try again.');
        }
    }
    else if (msg.type === 'update-panel-spec') {
        try {
            let target = figma.currentPage.selection[0];
            if (target && target.getPluginData('panelArt') === '1') target = target.parent;
            if (!target || !target.getPluginData('panelKind')) {
                figma.notify('Select a panel made in the studio first.');
                return;
            }
            const spec = normalizePanelSpec(msg.spec);
            yield updateSpecPanel(target, spec);
            figma.currentPage.selection = [target];
            figma.notify(`Updated panel: ${spec.name}. Your controls were kept.`);
        } catch (e) {
            console.error('Error updating studio panel:', e);
            figma.notify('Could not update the selection. Please try again.');
        }
    }
    else if (msg.type === 'create-byoc-strip' || msg.type === 'update-byoc-strip') {
        // BYOC: a strip from the user's own images
        try {
            const update = msg.type === 'update-byoc-strip';
            const target = update ? figma.currentPage.selection[0] : null;
            if (update && (!target || !target.getPluginData('byocKind'))) {
                figma.notify('Select a strip made in BYOC first.');
                return;
            }
            const spec = normalizeByocSpec(msg.spec);
            const hashes = {};
            Object.keys(msg.images || {}).forEach(role => {
                if (msg.images[role]) hashes[role] = figma.createImage(msg.images[role]).hash;
            });
            const node = createByocStrip(spec, msg.frames, msg.gap, msg.axis, hashes);
            if (update) {
                replaceNode(target, node);
            } else {
                placeAtViewportCenter(node);
                figma.viewport.scrollAndZoomIntoView([node]);
            }
            figma.currentPage.selection = [node];
            figma.notify(`${update ? 'Updated' : 'Added'} ${node.name}: ${node.children.length} frames, ${Math.round(node.width)}×${Math.round(node.height)} px`);
        } catch (e) {
            console.error('Error building BYOC strip:', e);
            figma.notify('Could not build the strip. Please try again.');
        }
    }
    else if (msg.type === 'byoc-load') {
        // Send the selected BYOC strip's settings and images back to the UI
        try {
            const node = figma.currentPage.selection[0];
            if (!node || !node.getPluginData('byocKind')) {
                figma.notify('Select a strip made in BYOC first.');
                return;
            }
            const images = yield byocImageBytes(node);
            figma.ui.postMessage({ type: 'byoc-loaded', spec: node.getPluginData('byocSpec'), strip: node.getPluginData('byocStrip'), images });
        } catch (e) {
            console.error('Error loading BYOC strip:', e);
            figma.notify('Could not load that strip.');
        }
    }
    else if (msg.type === 'byoc-tips') {
        yield figma.clientStorage.setAsync('byoc_tips', !!msg.on);
    }
    else if (msg.type === 'export-2x') {
        yield figma.clientStorage.setAsync('export_2x', !!msg.on);
    }
    else if (msg.type === 'help-seen') {
        yield figma.clientStorage.setAsync('help_seen', true);
    }
    else if (msg.type === 'whats-new-seen') {
        yield figma.clientStorage.setAsync('whats_new_seen', VERSION);
    }
    else if (msg.type === 'export-strip') {
        // Not awaited: Cancel messages must get through while it runs
        exportStudioStrip(msg);
    }
    else if (msg.type === 'export-strip-cancel') {
        if (stripExportJob && stripExportJob.id === msg.id) stripExportJob.cancel = true;
    }
    else if (msg.type === 'duplicate-knob') {
        // FIXED: Added try-catch around knob duplication
        try {
            const frames = msg.frames || 5; // Default to 5 if not provided
            const gapPixels = (typeof msg.gapPixels === 'number' && isFinite(msg.gapPixels)) ? Math.max(0, Math.round(msg.gapPixels)) : 0;
            const selected = figma.currentPage.selection[0];
            const specJson = figma.currentPage.selection.length === 1 && selected.getPluginData('knobKind') === 'knob'
                ? selected.getPluginData('knobSpec') : '';
            if (specJson) {
                // Studio knobs rebuild each frame from their spec, next to the knob
                const spec = normalizeKnobSpec(JSON.parse(specJson));
                const strip = createSpecKnobStrip(spec, frames, gapPixels, msg.axis, yield knobLabelFont(spec));
                strip.x = Math.round(selected.absoluteTransform[0][2] + selected.width + 40);
                strip.y = Math.round(selected.absoluteTransform[1][2]);
                figma.currentPage.selection = [strip];
                figma.viewport.scrollAndZoomIntoView([strip]);
            } else {
                duplicateKnob(frames, gapPixels);
            }
        } catch (e) {
            console.error('Error duplicating knob:', e);
            figma.notify('Error duplicating knob. Please try again.');
        }
    }
    else if (msg.type === 'create-gallery-panel') {
        // FIXED: Added try-catch around panel creation (most critical for WASM errors)
        try {
            let panel;
            switch (msg.panelType) {
                case 'Panel1':
                    panel = createInst3C1Panel();
                    break;
                case 'Panel2':
                    panel = createInst3C2Panel();
                    break;
                case 'Panel3':
                    panel = createInst3C3Panel();
                    break;
                case 'Panel4':
                    panel = createInstKeys1Panel();
                    break;
                case 'Panel5':
                    panel = createInstKeys2Panel();
                    break;
                case 'Panel6':
                    panel = createInstKeys3Panel();
                    break;
                case 'Panel7':
                    panel = createDrumMachine1Panel();
                    break;
                case 'Panel8':
                    panel = createDrumMachine2Panel();
                    break;
                case 'Panel9':
                    panel = createEffects1Panel();
                    break;
                case 'Panel10':
                    panel = createEffects2Panel();
                    break;
                case 'Panel11':
                    panel = createEffects3Panel();
                    break;
                case 'Panel12':
                    panel = createEffects4Panel();
                    break;
                case 'Panel13':
                    panel = createEffects5Panel();
                    break;
                case 'Panel14':
                    panel = createEffects6Panel();
                    break;
                case 'Panel15':
                    panel = createEffects7Panel();
                    break;
                default:
                    console.warn('Unknown panel type:', msg.panelType);
                    return;
            }
            
            if (panel) {
                figma.currentPage.appendChild(panel);
                figma.currentPage.selection = [panel];
                figma.viewport.scrollAndZoomIntoView([panel]);
            }
        } catch (e) {
            console.error('Error creating gallery panel:', e);
            figma.notify('Error creating panel. Please try again.');
        }
    }
    else if (msg.type === 'preview-selection-strip') {
        try {
            const result = yield exportStripPreview();
            figma.ui.postMessage(Object.assign({ type: 'strip-preview' }, result));
        } catch (e) {
            console.error('Error exporting strip preview:', e);
            figma.ui.postMessage({ type: 'strip-preview', ok: false, error: 'Preview export failed: ' + (e && e.message ? e.message : e) });
        }
    }
    else if (msg.type === 'export-vellum-xml') {
        try {
            const result = yield exportVellumLayout({
                pluginType: msg.pluginType || 'auto',
                includeBgColor: !!msg.includeBgColor
            });
            figma.ui.postMessage(Object.assign({ type: 'vellum-export-result' }, result));
            if (result.ok) figma.notify(`Vellum layout ready: ${result.layout.widgets.length} widgets, ${result.layout.guides.length} guides`);
        } catch (e) {
            console.error('Error exporting Vellum layout:', e);
            figma.ui.postMessage({ type: 'vellum-export-result', ok: false, error: 'Export failed: ' + (e && e.message ? e.message : e) });
        }
    }
    else if (msg.type === 'get-license-data') {
        // The UI shows whatever the launch check found (see loadLicense)
        yield proReady;
        figma.ui.postMessage(Object.assign({ type: 'license-data' }, licenseState));
    }
    else if (msg.type === 'verify-license') {
        // A key typed into the license dialog: saved only if the server accepts it
        const key = typeof msg.licenseKey === 'string' ? msg.licenseKey.trim() : '';
        const check = key ? yield checkLicenseKey(key) : { answer: false, message: 'Please enter a license key.' };
        if (check.answer === true) {
            const now = Date.now();
            yield figma.clientStorage.setAsync('license_key', key);
            yield figma.clientStorage.setAsync('license_valid', true);
            yield figma.clientStorage.setAsync('license_timestamp', now);
            proUnlocked = true;
            licenseState = { licenseKey: key, licenseValid: true, licenseTimestamp: now, source: 'server' };
        }
        figma.ui.postMessage({
            type: 'license-verify-result',
            id: msg.id,
            valid: check.answer === true,
            message: check.answer === null
                ? "Couldn't reach the license server. Please check your internet connection and try again."
                : check.message
        });
        if (check.answer === true) yield postDesigns();
    }
    else if (msg.type === 'clear-license') {
        try {
            yield clearStoredLicense();
        } catch (error) {
            console.error('Error clearing license data:', error);
        }
        proUnlocked = false;
        licenseState = { licenseKey: null, licenseValid: false, licenseTimestamp: null, source: 'none' };
        yield postDesigns();
    }
    else if (msg.type === 'designs-list') {
        yield postDesigns();
    }
    else if (msg.type === 'designs-save') {
        // Updates the saved design `id` if there is one, else adds a new one
        try {
            const normalize = DESIGN_NORMALIZERS[msg.kind];
            if (!normalize) throw new Error('This studio can\'t save designs.');
            const spec = normalize(msg.spec);
            const list = yield loadDesigns();
            const at = msg.id ? list.findIndex(d => d.id === msg.id && d.kind === msg.kind) : -1;
            const design = { id: at >= 0 ? list[at].id : newDesignId(), kind: msg.kind, spec, savedAt: Date.now() };
            if (at >= 0) list[at] = design;
            else list.push(design);
            yield storeDesigns(list);
            figma.ui.postMessage({ type: 'designs-saved', from: msg.from, id: design.id, name: spec.name, updated: at >= 0 });
            yield postDesigns();
        } catch (e) {
            figma.ui.postMessage({ type: 'designs-error', from: msg.from, message: String(e && e.message || e) });
        }
    }
    else if (msg.type === 'designs-delete') {
        try {
            const list = yield loadDesigns();
            yield storeDesigns(list.filter(d => d.id !== msg.id));
            yield postDesigns();
        } catch (e) {
            figma.ui.postMessage({ type: 'designs-error', from: msg.from, message: String(e && e.message || e) });
        }
    }
    else if (msg.type === 'designs-import') {
        // Skips designs already saved with the very same settings
        try {
            const found = designsFromFile(msg.data);
            const list = yield loadDesigns();
            const have = new Set(list.map(d => d.kind + JSON.stringify(d.spec)));
            const kinds = {};
            let added = 0;
            let skipped = 0;
            found.designs.forEach(d => {
                const sig = d.kind + JSON.stringify(d.spec);
                if (have.has(sig)) { skipped++; return; }
                have.add(sig);
                list.push({ id: newDesignId(), kind: d.kind, spec: d.spec, savedAt: Date.now() });
                kinds[d.kind] = (kinds[d.kind] || 0) + 1;
                added++;
            });
            if (added) yield storeDesigns(list);
            figma.ui.postMessage({ type: 'designs-import-result', from: msg.from, added, skipped, invalid: found.invalid, kinds });
            yield postDesigns();
        } catch (e) {
            figma.ui.postMessage({ type: 'designs-error', from: msg.from, message: String(e && e.message || e) });
        }
    }
    } catch (outerError) {
        console.error('Critical error in message handler:', outerError);
        figma.notify('An unexpected error occurred. Please check the console.');
    }
});
// //KNOB SPRITE ANIMATION
// The point a legacy knob turns about, in its container's coordinates: the
// center of its fixed ring (or its body) when it has one, else of
// rotate_knob. These parts are unrotated, so x/y plus half the size is
// their true center, whatever the indicator does to the bounds.
function knobPivot(knob) {
    const names = ['fixed_dial_ring', 'fixed_dial', 'overlay_arc', 'rotate_knob_body', 'rotate_knob'];
    for (const name of names) {
        const n = knob.findOne(node => node.name === name);
        if (n) return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
    }
    return null;
}

// Turns `node` clockwise by `deg` about point p (container coordinates)
function rotateAbout(node, deg, p) {
    const t = deg * Math.PI / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const m = node.relativeTransform;
    const tx = m[0][2] - p.x;
    const ty = m[1][2] - p.y;
    node.relativeTransform = [
        [c * m[0][0] - s * m[1][0], c * m[0][1] - s * m[1][1], p.x + c * tx - s * ty],
        [s * m[0][0] + c * m[1][0], s * m[0][1] + c * m[1][1], p.y + s * tx + c * ty]
    ];
}

function duplicateKnob(frames, gapPixels = 0) {
    frames = Math.max(2, Math.min(128, frames));
    const selection = figma.currentPage.selection;
    if (!(selection.length === 1 && selection[0].type === 'GROUP')) {
        figma.notify("Please select a knob group to animate.");
        return;
    }
    const knob = selection[0];
    if (!knob.findOne(node => node.name === "rotate_knob")) {
        figma.notify("Could not find rotate_knob in selection.");
        return;
    }

    // Square frames that fit the whole knob, stacked down from the original
    const frameSize = Math.max(Math.round(knob.width), Math.round(knob.height));
    const spacing = frameSize + gapPixels;
    const startX = Math.round(knob.x);
    const startY = Math.round(knob.y);
    // Knobs remember the value they were generated at; rotate relative to it
    // so frame 0 is always the 7:30 minimum. Legacy knobs start at minimum.
    const baseValue = parseFloat(knob.getPluginData('knobValue')) || 0;

    // Every frame turns about the same pivot and keeps every part's offset
    // from it. (Re-centering the turned part by its bounds made the knob
    // wobble: an indicator reaching past the body changes those bounds.)
    // The offset is rounded once, so parts stay as pixel-aligned as the
    // original and identical from frame to frame.
    const pivot = knobPivot(knob);
    const dx = Math.round(frameSize / 2 - pivot.x);
    const dy = Math.round(frameSize / 2 - pivot.y);
    const flattenedFrames = [];

    for (let i = 0; i < frames; i++) {
        const value = i / (frames - 1);
        const duplicate = knob.clone();

        const turned = duplicate.findOne(node => node.name === "rotate_knob");
        rotateAbout(turned, (value - baseValue) * 270, pivot);

        const overlay = duplicate.findOne(node => node.name === "overlay_arc");
        if (overlay && overlay.arcData) {
            const maxRange = parseFloat(overlay.getPluginData('maxRange')) || 270;
            overlay.arcData = {
                startingAngle: overlay.arcData.startingAngle,
                endingAngle: overlay.arcData.startingAngle + value * maxRange * Math.PI / 180,
                innerRadius: overlay.arcData.innerRadius
            };
        }

        // Flatten the turned part in place; everything else stays live
        const holder = turned.parent;
        const flat = figma.flatten([turned], holder, holder.children.indexOf(turned));
        flat.name = "rotate_knob_flattened";

        // A frame, not a group: resizing a group scales its contents
        const frame = figma.createFrame();
        frame.name = "knob_frame_" + i;
        frame.resize(frameSize, frameSize);
        frame.fills = [];
        frame.clipsContent = false;
        frame.x = startX;
        frame.y = Math.round(startY + i * spacing);
        duplicate.children.slice().forEach(node => {
            const m = node.relativeTransform;
            frame.appendChild(node);
            node.relativeTransform = [[m[0][0], m[0][1], m[0][2] + dx], [m[1][0], m[1][1], m[1][2] + dy]];
        });
        if (!duplicate.removed) duplicate.remove();

        flattenedFrames.push(frame);
    }

    // Group all frames
    const spriteGroup = figma.group(flattenedFrames, figma.currentPage);
    spriteGroup.name = "knob_sprite";

    figma.currentPage.selection = [spriteGroup];
    figma.viewport.scrollAndZoomIntoView([spriteGroup]);
}

////////////////////////////////////////////////////////////////////////////
// Knob spec: the knob studio's model. The UI draws it on a canvas and sends
// it here to build the same knob as Figma layers. Lengths are in units where
// the knob body is 100 wide; `size` is the finished frame's width in px (the
// Vellum widget size), and the knob scales to fit it. Keep knobSpecLayout()
// and the builders in step with KnobCore in ui.html.
////////////////////////////////////////////////////////////////////////////
// ===== KnobShapes: the knob spec and its geometry =====
// Shared word for word by ui.html (KnobCore) and code.js (knobBuild*), so
// the studio and the Figma build draw the same outlines. Edit both copies
// together. Outlines are point lists in units: the body is 100 wide,
// centered on 0, 0, with y pointing down.
const KnobShapes = (() => {
  const START = 135;  // 7:30, clockwise from 3 o'clock
  const SWEEP = 270;
  const SEG = 144;    // points per full circle

  const BASE = {
    name: 'Custom', tier: 'free', source: '', size: 110, endless: false,
    body: { on: true, shape: 'circle', teeth: 36, depth: 3, tip: 72, fill: 'linear', c1: '#5E5E66', c2: '#2E2E34', angle: 90, sheen: 0, brush: 0, grain: 0, edge: 0, edgeColor: '#000000', shadow: 0, shadowAlpha: 40, shadowDist: 35, shadowAngle: 90 },
    cap: { on: false, shape: 'circle', teeth: 8, depth: 4, size: 70, fill: 'linear', c1: '#4A4A52', c2: '#2A2A30', angle: 270, bevel: 0, bevelC1: '#F2F2F2', bevelC2: '#6E6E74', brush: 0, grain: 0, edge: 0, edgeColor: '#000000', shadow: 0, grooves: 0, grooveColor: '#FFFFFF' },
    bar: { on: false, shape: 'bar', length: 100, width: 30, offset: 0, round: 4, fill: 'linear', c1: '#4A4A50', c2: '#1E1E22', angle: 90, inset: 0, edge: 0, edgeColor: '#000000', shadow: 0 },
    pointer: { shape: 'line', color: '#FFFFFF', width: 5, length: 18, inset: 6, round: true, glow: 0, edge: 0, edgeColor: '#000000' },
    ring: { style: 'arc', width: 6, gap: 5, count: 21, round: false, track: true, trackColor: '#3A3A42', value: true, valueColor: '#8A5CF6', opacity: 100, glow: 0, bipolar: false, single: false, over: false },
    ticks: { on: false, count: 11, color: '#8C8898', length: 7, width: 1.5, gap: 4, major: 0, majorLength: 11, labels: 'none', labelSize: 9, labelColor: '#C8C6D0' },
    depth: { on: false, tilt: 26, persp: 35, height: 22, flare: 0, cone: false, c1: '#7A7A82', c2: '#141416', shine: 0, rim: 25, grooves: 0, slots: 0, slotWidth: 14, slotDepth: 3, band: 0, bandInset: 1.5, capHeight: 0, capTaper: 0, dome: false, capC1: '#7A7A82', capC2: '#141416', capShine: 0, capRim: 30, capGrooves: 0, barHeight: 0, barC1: '#6A6A70', barC2: '#141416', barShine: 0, cast: 100 },
    print: { scale: 'none', from1: false, mark: 'start', color: '#F2F2F2', size: 8, radius: 42, ticks: 0, at: 30, index: false, indexColor: '#1A1917', label: '', labelColor: '#141414', labelSize: 7, stripe: false, stripeColor: '#E8322A', stripeWidth: 5 }
  };

  const LIMITS = {
    'size': [16, 512],
    'body.teeth': [3, 72], 'body.depth': [0, 15], 'body.tip': [52, 95],
    'body.angle': [0, 360], 'body.sheen': [0, 100], 'body.brush': [0, 100], 'body.grain': [0, 100],
    'body.edge': [0, 10], 'body.shadow': [0, 30], 'body.shadowAlpha': [0, 100], 'body.shadowDist': [0, 150], 'body.shadowAngle': [0, 360],
    'cap.teeth': [3, 48], 'cap.depth': [0, 15], 'cap.size': [10, 98], 'cap.angle': [0, 360], 'cap.bevel': [0, 20], 'cap.brush': [0, 100], 'cap.grain': [0, 100],
    'cap.edge': [0, 10], 'cap.shadow': [0, 30], 'cap.grooves': [0, 8],
    'bar.length': [4, 140], 'bar.width': [2, 80], 'bar.offset': [-40, 40], 'bar.round': [0, 40], 'bar.angle': [0, 360],
    'bar.inset': [0, 20], 'bar.edge': [0, 10], 'bar.shadow': [0, 30],
    'pointer.width': [1, 30], 'pointer.length': [2, 60], 'pointer.inset': [-25, 45], 'pointer.glow': [0, 20], 'pointer.edge': [0, 5],
    'ring.width': [1, 40], 'ring.gap': [-30, 40], 'ring.count': [3, 64], 'ring.opacity': [0, 100], 'ring.glow': [0, 20],
    'ticks.count': [2, 61], 'ticks.length': [1, 30], 'ticks.width': [0, 10], 'ticks.gap': [0, 60],
    'ticks.major': [0, 10], 'ticks.majorLength': [1, 30], 'ticks.labelSize': [4, 24],
    'depth.tilt': [-60, 60], 'depth.persp': [0, 100], 'depth.height': [0, 80], 'depth.flare': [0, 40], 'depth.shine': [0, 100], 'depth.rim': [0, 100],
    'depth.grooves': [0, 12], 'depth.slots': [0, 36], 'depth.slotWidth': [2, 50], 'depth.slotDepth': [0, 8], 'depth.band': [0, 60], 'depth.bandInset': [0, 6],
    'depth.capHeight': [0, 60], 'depth.capTaper': [0, 60], 'depth.capShine': [0, 100], 'depth.capRim': [0, 100], 'depth.capGrooves': [0, 12],
    'depth.barHeight': [0, 40], 'depth.barShine': [0, 100], 'depth.cast': [0, 200],
    'print.size': [3, 20], 'print.radius': [10, 60], 'print.ticks': [0, 8], 'print.at': [5, 95], 'print.labelSize': [3, 24], 'print.stripeWidth': [1, 15]
  };

  const FILLS = ['solid', 'linear', 'radial', 'conic', 'brushed'];
  const ENUMS = {
    'body.shape': ['circle', 'knurl', 'fluted', 'polygon', 'teardrop'],
    'body.fill': FILLS,
    'cap.shape': ['circle', 'knurl', 'fluted', 'polygon', 'gear'],
    'cap.fill': FILLS,
    'bar.shape': ['bar', 'arrow', 'chicken', 'wedge'],
    'bar.fill': FILLS,
    'pointer.shape': ['dot', 'line', 'triangle', 'notch', 'led', 'none'],
    'ring.style': ['arc', 'dots'],
    'ticks.labels': ['none', 'minmax', 'numbers'],
    'print.scale': ['none', 'face', 'wall'],
    'print.mark': ['start', 'top']
  };

  // Brushed metal: [position, share of the light color] around the turn,
  // two bright streaks across the face
  const BRUSH_STOPS = [[0, 0.15], [0.1, 0.05], [0.22, 0.2], [0.3, 0.55], [0.375, 1], [0.45, 0.5], [0.55, 0.1],
    [0.65, 0.2], [0.8, 0.6], [0.875, 1], [0.94, 0.45], [1, 0.15]];
  // Texture strengths at 100%: ring and speck opacity, ring line width in units
  const TEX = { brushLight: 0.16, brushDark: 0.2, brushWidth: 0.35, grainLight: 0.22, grainDark: 0.32 };

  const r3 = n => Math.round(n * 1000) / 1000;
  const rad = d => d * Math.PI / 180;
  const frac = x => x - Math.floor(x);
  const turn = (x, y, deg) => {
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    return [r3(x * c - y * s), r3(x * s + y * c)];
  };
  // Endless knobs (encoders) turn all the way round from 12 o'clock and
  // loop, so v = 1 is v = 0 again
  const startDeg = s => (s.endless ? 270 : START);
  const sweepDeg = s => (s.endless ? 360 : SWEEP);
  const pointerDeg = (s, v) => startDeg(s) + sweepDeg(s) * v;
  // Endless knobs draw only LED-dot rings: an arc that never fills
  // reads as a meter, so it's left out
  const ringShown = s => (s.ring.track || s.ring.value) && !(s.endless && s.ring.style === 'arc');
  // Scale labels mean nothing on an endless knob, so it never shows them
  const labelsOn = s => s.ticks.on && s.ticks.labels !== 'none' && !s.endless;
  // Circles look the same at any angle and stay put; everything with ridges
  // or corners turns with the value. Only the outline turns: the node itself
  // doesn't rotate, so its gradient light and drop shadow stay put.
  const turns = shape => shape !== 'circle';

  // Outline traced from a radius function r(u), u = 0..1 around the turn
  function radial(rf, n, rot) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      const r = rf(i / n);
      out.push(turn(r * Math.cos(a), r * Math.sin(a), rot));
    }
    return out;
  }

  // Points from angle a0 to a1 (degrees, inclusive) around cx, cy
  function arc(cx, cy, r, a0, a1, n) {
    if (r <= 0) return [[r3(cx), r3(cy)]];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = rad(a0 + (a1 - a0) * i / n);
      out.push([r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))]);
    }
    return out;
  }

  const circle = (r, n) => radial(() => r, n || SEG, 0);

  // A round part's outline: R units out, with an edge profile
  function outline(shape, R, teeth, depth, tip, rot) {
    const n = Math.max(3, Math.round(teeth));
    const d = Math.max(0, Math.min(depth, R * 0.5));
    if (shape === 'knurl') {
      // Round notches cut into the rim
      const w = 0.45;
      return radial(u => {
        const x = Math.abs(frac(u * n) - 0.5);
        return x < w / 2 ? R - d * Math.sqrt(1 - Math.pow(2 * x / w, 2)) : R;
      }, Math.max(SEG, n * 16), rot);
    }
    if (shape === 'fluted') return radial(u => R - d * (0.5 - 0.5 * Math.cos(2 * Math.PI * u * n)), Math.max(SEG, n * 12), rot);
    if (shape === 'gear') {
      // Flat-bottomed notches with short ramps
      const w = 0.4;
      const ramp = 0.06;
      return radial(u => {
        const x = Math.abs(frac(u * n) - 0.5);
        return R - d * Math.max(0, Math.min(1, (w / 2 + ramp - x) / ramp));
      }, Math.max(SEG, n * 24), rot);
    }
    if (shape === 'polygon') {
      // A flat side faces the pointer
      const out = [];
      for (let i = 0; i < n; i++) out.push(turn(R, 0, rot + 180 / n + 360 * i / n));
      return out;
    }
    if (shape === 'teardrop') {
      // Circle drawn out to a point along the pointer
      const T = Math.max(R * 1.02, tip);
      const b = Math.acos(R / T) * 180 / Math.PI;
      const out = [turn(T, 0, rot)];
      for (let j = 0; j <= SEG; j++) {
        const a = rad(b + (360 - 2 * b) * j / SEG);
        out.push(turn(R * Math.cos(a), R * Math.sin(a), rot));
      }
      return out;
    }
    return circle(R);
  }

  // How far out a round texture can reach without crossing the edge
  function innerRadius(shape, R, teeth, depth) {
    if (shape === 'polygon') return R * Math.cos(Math.PI / Math.max(3, Math.round(teeth)));
    if (shape === 'knurl' || shape === 'fluted' || shape === 'gear') return R - Math.max(0, Math.min(depth, R * 0.5));
    return R;
  }

  function body(s, v) {
    const b = s.body;
    return outline(b.shape, 50, b.teeth, b.depth, b.tip, turns(b.shape) ? pointerDeg(s, v) : 0);
  }

  // The cap's radius less `inset` (its bevel), teeth scaled to match
  function capRadius(s, inset) {
    return Math.max(0.5, s.cap.size / 2 - (inset || 0));
  }
  function cap(s, v, inset) {
    const c = s.cap;
    const R = capRadius(s, inset);
    return outline(c.shape, R, c.teeth, c.depth * R / (c.size / 2), 0, turns(c.shape) ? pointerDeg(s, v) : 0);
  }
  function capInner(s, inset) {
    const c = s.cap;
    const R = capRadius(s, inset);
    return innerRadius(c.shape, R, c.teeth, c.depth * R / (c.size / 2));
  }

  // The bar across the knob, pointing along the pointer. `inset` shrinks
  // it on every side for the raised face.
  function bar(s, v, inset) {
    const b = s.bar;
    inset = inset || 0;
    const len = Math.max(0.5, b.length - 2 * inset);
    const h = Math.max(0.25, b.width / 2 - inset);
    const x0 = b.offset - len / 2;
    const x1 = b.offset + len / 2;
    let P;
    if (b.shape === 'arrow') {
      const tip = Math.min(h * 0.9, len / 2);
      const r = Math.max(0, Math.min(b.round - inset, h, (len - tip) / 2));
      P = arc(x0 + r, h - r, r, 90, 180, 6).concat(arc(x0 + r, -h + r, r, 180, 270, 6), [[r3(x1 - tip), r3(-h)], [r3(x1), 0], [r3(x1 - tip), r3(h)]]);
    } else if (b.shape === 'chicken') {
      // Round at the back, tapering to a narrow nose
      const hf = Math.max(0.25, h * 0.3);
      const back = Math.min(x0 + h, x1 - hf);
      P = arc(back, 0, h, 90, 270, 18).concat(arc(x1 - hf, 0, hf, -90, 90, 8));
    } else if (b.shape === 'wedge') {
      const hb = h * 0.3;
      P = [[r3(x0), r3(-hb)], [r3(x1), r3(-h)], [r3(x1), r3(h)], [r3(x0), r3(hb)]];
    } else {
      const r = Math.max(0, Math.min(b.round - inset, h, len / 2));
      P = arc(x1 - r, -h + r, r, -90, 0, 6).concat(arc(x1 - r, h - r, r, 0, 90, 6), arc(x0 + r, h - r, r, 90, 180, 6), arc(x0 + r, -h + r, r, 180, 270, 6));
    }
    const deg = pointerDeg(s, v);
    return P.map(p => turn(p[0], p[1], deg));
  }

  const maxRadius = pts => pts.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1])), 0);

  function bounds(polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polys.forEach(P => P.forEach(p => {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Seeded so every frame and both sides get the same texture
  function rng(seed) {
    return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  }

  // Machined rings for brushed metal, split into light and dark lines
  function brush(R) {
    const next = rng(97);
    const n = Math.max(6, Math.round(R * 0.9));
    const out = { light: [], dark: [] };
    for (let i = 0; i < n; i++) {
      const j = next();
      const r = R * (0.04 + 0.94 * (i + j) / n);
      (next() < 0.5 ? out.light : out.dark).push(circle(r, 96));
    }
    return out;
  }

  // Fine specks for stone and matte plastic, turned by `deg` with the knob
  function grain(R, deg) {
    const next = rng(131);
    const n = Math.round(R * R * 0.5);
    const out = { light: [], dark: [] };
    for (let i = 0; i < n; i++) {
      const r = R * Math.sqrt(next());
      const a = 2 * Math.PI * next() + rad(deg || 0);
      const size = 0.25 + 0.4 * next();
      const cx = r * Math.cos(a);
      const cy = r * Math.sin(a);
      const hex = [];
      for (let k = 0; k < 6; k++) hex.push([r3(cx + size * Math.cos(k * Math.PI / 3)), r3(cy + size * Math.sin(k * Math.PI / 3))]);
      (i % 2 ? out.light : out.dark).push(hex);
    }
    return out;
  }

  // Drop shadow offset for a part blurred by `blur`: one light for the whole
  // knob, casting `shadowDist`% of the blur toward `shadowAngle` (90 = down)
  function shadowShift(s, blur) {
    const d = blur * s.body.shadowDist / 100;
    const a = rad(s.body.shadowAngle);
    return [r3(d * Math.cos(a)), r3(d * Math.sin(a))];
  }

  function layout(s) {
    const bodyR = 50;
    const reach = 1 + s.body.shadowDist / 100; // a shadow's blur plus its offset
    const ringOn = ringShown(s);
    const ringIn = Math.max(1, bodyR + s.ring.gap);
    const ringOut = ringIn + s.ring.width;
    const outer = ringOn ? Math.max(bodyR, ringOut) : bodyR;
    const t = s.ticks;
    const tickIn = outer + t.gap;
    const tickOut = tickIn + (t.major > 0 ? Math.max(t.length, t.majorLength) : t.length);
    const labelR = t.labels === 'minmax' ? tickOut + t.labelSize * 1.15 : tickOut + t.labelSize * 0.85;
    const bodyExtent = s.body.on && s.body.shape === 'teardrop' ? Math.max(bodyR * 1.02, s.body.tip) : bodyR;
    const barR = s.bar.on ? maxRadius(bar(s, 0, 0)) : 0;
    let extent = Math.max(outer, s.body.on ? bodyExtent : 0);
    if (t.on) extent = Math.max(extent, tickOut);
    if (labelsOn(s)) extent = Math.max(extent, labelR + t.labelSize * (t.labels === 'minmax' ? 1.2 : 0.8));
    if (s.bar.on) extent = Math.max(extent, barR + s.bar.shadow * reach);
    if (s.pointer.shape !== 'none') extent = Math.max(extent, bodyR - s.pointer.inset);
    // Room for shadows and glow so frames don't clip them
    if (s.body.on && s.body.shadow > 0) extent = Math.max(extent, bodyExtent + s.body.shadow * reach);
    if (s.cap.on && s.cap.shadow > 0) extent = Math.max(extent, s.cap.size / 2 + s.cap.shadow * reach);
    if (ringOn && s.ring.value && s.ring.glow > 0) extent = Math.max(extent, ringOut + s.ring.glow);
    // A 3D knob's walls, shadow and tilt reach further
    if (deep(s)) extent = Math.max(extent, reach3d(s));
    return { bodyR, ringOn, ringIn, ringOut, ringMid: (ringIn + ringOut) / 2, tickIn, tickOut, labelR, barR, extent };
  }

  function ticks(s) {
    const t = s.ticks;
    const n = Math.round(t.count);
    const every = Math.round(t.major);
    // All the way round, the last tick would land on the first
    const last = s.endless ? n : n - 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const major = every > 0 && i % every === 0;
      out.push({ deg: startDeg(s) + sweepDeg(s) * i / last, len: major ? t.majorLength : t.length, major });
    }
    return out;
  }

  // Scale labels, centered on x, y
  function labels(s) {
    const t = s.ticks;
    if (!labelsOn(s)) return [];
    const L = layout(s);
    const at = (text, deg) => {
      const p = turn(L.labelR, 0, deg);
      return { text, x: p[0], y: p[1], size: t.labelSize };
    };
    if (t.labels === 'minmax') return [at('MIN', START), at('MAX', START + SWEEP)];
    const out = [];
    for (let i = 0; i <= 10; i++) out.push(at(String(i), START + SWEEP * i / 10));
    return out;
  }

  // Degrees the value ring covers at v: from 7:30, from 12 o'clock when
  // bipolar, or a short marker at the value when `single`
  function valueSpan(s, v) {
    const a = pointerDeg(s, v);
    if (s.ring.single) return [Math.max(START, a - 5), Math.min(START + SWEEP, a + 5)];
    return s.ring.bipolar ? [Math.min(270, a), Math.max(270, a)] : [START, a];
  }

  function dotAngles(s) {
    const n = Math.round(s.ring.count);
    const last = s.endless ? n : n - 1;
    const out = [];
    for (let i = 0; i < n; i++) out.push(startDeg(s) + sweepDeg(s) * i / last);
    return out;
  }

  // Indexes of the lit dots: those inside the span (Vellum's LED ring
  // rule), or only the nearest one when `single` or endless
  function litDots(s, v) {
    const A = dotAngles(s);
    if (s.endless) return [Math.round(v * A.length) % A.length];
    if (s.ring.single) return [Math.round(v * (A.length - 1))];
    const span = valueSpan(s, v);
    const out = [];
    A.forEach((a, i) => { if (a >= span[0] - 0.01 && a <= span[1] + 0.01) out.push(i); });
    return out;
  }

  // ----- 3D: tilt, height and side walls -----
  // A 3D knob stacks the same layers at heights z (units): the body's top at
  // zB, a raised cap's top at zC, a raised bar's top at zR. The camera tilts
  // by `tilt`, so a face at height z is the flat layer squashed by cos(tilt)
  // and moved by (z - zMid)·sin(tilt): both sides draw faces with their usual
  // code under that mapping (faceMap). Walls are quads between an outline at
  // two heights, lit per quad by one fixed light, so ridges on the wall turn
  // with the knob while the lighting stays put. Positive tilt looks down on
  // the knob and shows the wall above the face; negative looks up from below.
  const LIGHT = (() => {
    const l = [-0.45, -0.75, 0.55];
    const m = Math.hypot(l[0], l[1], l[2]);
    return l.map(x => x / m);
  })();
  const GLOSS = 24;

  const deep = s => !!(s.depth && s.depth.on);

  // Share of the base radius left at height fraction u (0 base, 1 top)
  function bodyAt(s, u) {
    const d = s.depth;
    return 1 + d.flare / 100 * Math.pow(1 - u, d.cone ? 1 : 1.6);
  }
  function capAt(s, u) {
    const t = s.depth.capTaper / 100;
    return s.depth.dome ? 1 - t * (1 - Math.sqrt(Math.max(0, 1 - u * u))) : 1 - t * u;
  }

  function view(s) {
    const d = s.depth;
    const t = rad(d.tilt);
    const capOn = s.cap.on && d.capHeight > 0;
    const barOn = s.bar.on && d.barHeight > 0;
    const zB = Math.max(0.01, d.height);
    const zC = zB + (capOn ? d.capHeight : 0);
    const zBar = capOn ? zC : zB;
    const zR = zBar + (barOn ? d.barHeight : 0);
    const zFace = capOn ? zC : zB;
    const capTop = capOn ? capAt(s, 1) : 1;
    // The pointer sits on the highest face that holds it
    const pr = 50 - s.pointer.inset;
    const host = barOn ? 'bar' : capOn && pr <= capRadius(s, 0) * capTop + 1 ? 'cap' : 'body';
    // The whole knob, base to face, is centered in the ring and ticks
    return { ct: Math.cos(t), st: Math.sin(t), zB, zC, zBar, zR, zFace, zMid: zFace / 2, pk: d.persp * 0.00005, capOn, barOn, capTop, host };
  }

  // Parts nearer the camera draw a little larger
  const grow = (V, z) => 1 + (z - V.zFace) * V.pk;
  function proj(V, x, y, z) {
    const g = grow(V, z);
    return [r3(x * g), r3(y * V.ct * g + (z - V.zMid) * V.st)];
  }
  // A face at height z: unit x, y land at x·sx, y·sy + ty
  function faceMap(V, z) {
    const g = grow(V, z);
    return { sx: g, sy: V.ct * g, ty: (z - V.zMid) * V.st };
  }

  // Colors on a step of 8 so both sides get the same few, and Figma can
  // merge the faces of one color into one vector
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const hexOf = (c, step = 8) => '#' + c.map(x => ('0' + Math.max(0, Math.min(255, Math.round(x / step) * step)).toString(16)).slice(-2)).join('');

  // Stops [t, value] around a turn, sorted, with the value where the last
  // meets the first added at 0 and 1 so the sweep closes; mix(a, b, w)
  function sweepStops(stops, mix) {
    stops.sort((a, b) => a[0] - b[0]);
    const a = stops[stops.length - 1];
    const b = stops[0];
    const gap = 1 - a[0] + b[0];
    const at = mix(a[1], b[1], gap > 0 ? (1 - a[0]) / gap : 0);
    return [[0, at]].concat(stops, [[1, at]]);
  }

  function orient(P) {
    let a = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const q = P[(i + 1) % P.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a >= 0 ? 1 : -1;
  }

  // A wall around outline P (units) from z0 to z1; rAt(u) scales the outline
  // at height fraction u. look: c1 lit, c2 dark, shine, rim, grooves, ao, bands.
  // Returns quads in drawing order (far first), colored by light alone, then
  // shades: one black overlay per band for the shadow near the base and the
  // grooves, and the rim light along the top. Light and shine are stepped, so
  // a wall has few colors and Figma merges the quads of each into one vector.
  // A smooth round wall (look.smooth) is shaded without steps instead: each
  // band is one ring of quads filled by a sweep (a conic gradient around the
  // band's center) through its faces' colors, returned as `rings` with no
  // faces, and its rim light is one sweep along the top (`rimRing`).
  // Sweep stops are [t, value], t the turn clockwise on screen from +x, 0..1.
  function wall(V, P, z0, z1, rAt, look) {
    const sgn = orient(P);
    const n = P.length;
    const grooves = Math.round(look.grooves);
    const bands = grooves ? grooves * 2 + 1 : look.bands;
    const lit = rgbOf(look.c1);
    const dark = rgbOf(look.c2);
    const view3 = [0, -V.st, V.ct];
    const half = [LIGHT[0] + view3[0], LIGHT[1] + view3[1], LIGHT[2] + view3[2]];
    const hm = Math.hypot(half[0], half[1], half[2]);
    const faces = [];
    const shades = [];
    const rings = [];
    const tops = [];
    const turnOf = (pts, C) => {
      const t = Math.atan2((pts[0][1] + pts[2][1]) / 2 - C[1], (pts[0][0] + pts[2][0]) / 2 - C[0]) / (2 * Math.PI);
      return t < 0 ? t + 1 : t;
    };
    for (let j = 0; j < bands; j++) {
      const u0 = j / bands;
      const u1 = (j + 1) / bands;
      const za = z0 + (z1 - z0) * u0;
      const zb = z0 + (z1 - z0) * u1;
      const ra = rAt(u0);
      const rb = rAt(u1);
      const groove = grooves && j % 2 === 1;
      const ao = look.ao * Math.pow(1 - (u0 + u1) / 2, 2);
      // A smooth wall takes the shadow into its own colors instead
      const shade = { alpha: look.smooth ? 0 : Math.round(20 * (1 - (1 - ao) * (groove ? 0.45 : 1))) / 20, polys: [] };
      if (shade.alpha > 0) shades.push(shade);
      const ring = { polys: [], center: proj(V, 0, 0, (za + zb) / 2), stops: [] };
      if (look.smooth) rings.push(ring);
      for (let i = 0; i < n; i++) {
        const p = P[i];
        const q = P[(i + 1) % n];
        const tx = q[0] - p[0];
        const ty = q[1] - p[1];
        const tl = Math.hypot(tx, ty) || 1;
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        // Outward normal, tipped up where the wall narrows toward the top
        let nx = sgn * ty / tl;
        let ny = -sgn * tx / tl;
        let nz = (ra - rb) * (Math.hypot(mx, my) || 1) / Math.max(0.01, zb - za);
        const m = Math.hypot(nx, ny, nz);
        nx /= m; ny /= m; nz /= m;
        if (nx * view3[0] + ny * view3[1] + nz * view3[2] <= 0.001) continue;
        let dif = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        let spec = Math.min(1, Math.pow(Math.max(0, (nx * half[0] + ny * half[1] + nz * half[2]) / hm), GLOSS) * look.shine);
        if (!look.smooth) {
          dif = Math.round(20 * dif) / 20;
          spec = Math.round(16 * spec) / 16;
        }
        const c = mixRgb(mixRgb(dark, lit, Math.min(1, 0.12 + 0.95 * dif)), [255, 255, 255], spec);
        const pts = [proj(V, p[0] * ra, p[1] * ra, za), proj(V, q[0] * ra, q[1] * ra, za), proj(V, q[0] * rb, q[1] * rb, zb), proj(V, p[0] * rb, p[1] * rb, zb)];
        if (shade.alpha > 0) shade.polys.push(pts);
        if (look.smooth) {
          ring.polys.push(pts);
          ring.stops.push([turnOf(pts, ring.center), c.map(x => x * (1 - ao))]);
          if (j === bands - 1) tops.push({ i, pts, dif });
          continue;
        }
        faces.push({
          pts,
          color: hexOf(c),
          depth: mx * view3[0] + my * view3[1] + (za + zb) / 2 * view3[2],
          top: j === bands - 1,
          dif
        });
      }
    }
    if (look.smooth) {
      const out = { faces: [], shades: shades.filter(sh => sh.polys.length), rims: [], rings: [] };
      rings.forEach(R => {
        if (R.polys.length) out.rings.push({ polys: R.polys, center: R.center, stops: sweepStops(R.stops, mixRgb).map(st => [r3(st[0]), hexOf(st[1], 1)]) });
      });
      if (look.rim > 0 && tops.length) {
        // The top edge in runs of neighboring faces, joined round the seam
        const runs = [];
        tops.forEach(f => {
          const run = runs[runs.length - 1];
          if (run && run.last === f.i - 1) {
            run.pts.push(f.pts[2]);
            run.last = f.i;
          } else {
            runs.push({ first: f.i, last: f.i, pts: [f.pts[3], f.pts[2]] });
          }
        });
        if (runs.length > 1 && runs[0].first === 0 && runs[runs.length - 1].last === n - 1) {
          const end = runs.pop();
          runs[0].pts = end.pts.concat(runs[0].pts.slice(1));
        }
        const C = proj(V, 0, 0, z1);
        const stops = sweepStops(tops.map(f => [turnOf(f.pts, C), Math.min(1, look.rim * (0.25 + f.dif))]), (a, b, w) => a + (b - a) * w);
        out.rimRing = { runs: runs.map(r => r.pts), center: C, stops: stops.map(st => [r3(st[0]), r3(st[1])]) };
      }
      return out;
    }
    faces.sort((a, b) => a.depth - b.depth);
    const rims = [];
    if (look.rim > 0) {
      faces.forEach(f => {
        if (f.top) rims.push({ a: f.pts[3], b: f.pts[2], alpha: Math.round(10 * Math.min(1, look.rim * (0.25 + f.dif))) / 10 });
      });
    }
    return { faces: faces.map(f => ({ pts: f.pts, color: f.color })), shades: shades.filter(sh => sh.polys.length), rims: rims.filter(r => r.alpha > 0) };
  }

  // Narrow flat-bottomed slots up the body wall, turning with the knob
  function slotted(s, v) {
    const d = s.depth;
    const count = Math.round(d.slots);
    const w = d.slotWidth / 100;
    const rot = pointerDeg(s, v);
    return radial(u => (Math.abs(frac(u * count) - 0.5) < w / 2 ? 50 - d.slotDepth : 50), count * 48, rot);
  }

  function wallLook(s, part) {
    const d = s.depth;
    // Smooth: a plain round side, shaded in sweeps rather than steps, in
    // more and thinner bands so the shadow fades up it evenly
    if (part === 'cap') {
      const smooth = s.cap.shape === 'circle' && !Math.round(d.capGrooves);
      return { c1: d.capC1, c2: d.capC2, shine: d.capShine / 100, rim: d.capRim / 100, grooves: d.capGrooves, ao: 0.3, bands: d.dome && d.capTaper > 0 ? (smooth ? 14 : 10) : (smooth ? 10 : 6), smooth };
    }
    if (part === 'bar') return { c1: d.barC1, c2: d.barC2, shine: d.barShine / 100, rim: 0.3, grooves: 0, ao: 0.3, bands: 3 };
    const smooth = s.body.shape === 'circle' && !Math.round(d.grooves) && !(d.slots > 0);
    return { c1: d.c1, c2: d.c2, shine: d.shine / 100, rim: d.rim / 100, grooves: d.grooves, ao: 0.55, bands: smooth ? 16 : 8, smooth };
  }

  // Every wall, in projected units: { body, cap, bar }, each { faces, rims } or null
  function walls(s, v) {
    const V = view(s);
    const d = s.depth;
    const out = { body: null, cap: null, bar: null };
    if (s.body.on) {
      const side = d.slots > 0 ? slotted(s, v) : body(s, v);
      const look = wallLook(s, 'body');
      const band = d.band / 100;
      if (band > 0) {
        // A plain ring at the base, set in a little, under the shaped wall
        const inset = 1 - d.bandInset / 50;
        const lo = wall(V, circle(50), 0, V.zB * band, u => inset * bodyAt(s, u * band), Object.assign({}, look, { rim: 0, grooves: 0, bands: 4, smooth: true }));
        const hi = wall(V, side, V.zB * band, V.zB, u => bodyAt(s, band + u * (1 - band)), Object.assign({}, look, { ao: 0.15 }));
        out.body = { faces: lo.faces.concat(hi.faces), shades: lo.shades.concat(hi.shades), rims: hi.rims, rings: (lo.rings || []).concat(hi.rings || []), rimRing: hi.rimRing };
      } else {
        out.body = wall(V, side, 0, V.zB, u => bodyAt(s, u), look);
      }
    }
    if (V.capOn) out.cap = wall(V, cap(s, v, 0), V.zB, V.zC, u => capAt(s, u), wallLook(s, 'cap'));
    if (V.barOn) out.bar = wall(V, bar(s, v, 0), V.zBar, V.zR, () => 1, wallLook(s, 'bar'));
    return out;
  }

  // The shadow the base casts on the panel, and a tight contact shadow, in
  // projected units: blur is a standard deviation, off an [x, y] offset
  function shadows3d(s, v) {
    const V = view(s);
    const b = s.body;
    const k0 = bodyAt(s, 0);
    const base = body(s, v).map(p => proj(V, p[0] * k0, p[1] * k0, 0));
    const blur = b.shadow * s.depth.cast / 100;
    const a = rad(b.shadowAngle);
    const dist = blur * b.shadowDist / 100 + V.zFace * 0.22 * s.depth.cast / 100;
    return {
      base,
      drop: { blur: blur * 0.5, alpha: b.shadowAlpha / 100, off: [r3(dist * Math.cos(a)), r3(dist * Math.sin(a))] },
      contact: { blur: 1.6, alpha: 0.55, off: [0, 0.8] }
    };
  }

  // Where a printed scale is read: at 7:30 like every pointer's start, or at
  // 12 o'clock
  const markDeg = s => (s.print.mark === 'top' ? 270 : START);

  // The panel's index mark: a small triangle just outside the knob at the
  // reading spot, pointing at the number printed on the knob
  function indexMark(s) {
    const V = view(s);
    const a = rad(markDeg(s));
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const k0 = bodyAt(s, 0);
    // The knob's edge in that direction: its base or its top, whichever is farther out
    const edge = [proj(V, 50 * k0 * c, 50 * k0 * sn, 0), proj(V, 50 * c, 50 * sn, V.zB)]
      .reduce((m, q) => Math.max(m, q[0] * c + q[1] * sn), 0);
    const at = (d, w) => [r3((edge + d) * c - w * sn), r3((edge + d) * sn + w * c)];
    return [at(7, -3.2), at(7, 3.2), at(1.8, 0)];
  }

  // Printing that turns with the knob: a scale on the body's top face or its
  // wall (number i sits at the reading spot when v = i / 10; it starts at 0,
  // or at 1 with the 0 spot left blank), a label on the top face, and a
  // stripe down the side under the pointer.
  // Glyphs are { text, size, alpha, m: [a, b, c, d, e, f] }: m maps a glyph
  // drawn centered on 0, 0 at font size `size` (y down) into projected units.
  // Quads are { pts, alpha, color } in projected units. Grouped by the wall
  // or face they're drawn after: bodyWall, bodyFace, capWall, capFace.
  function prints(s, v) {
    const V = view(s);
    const p = s.print;
    const out = { bodyWall: [], bodyFace: [], capWall: [], capFace: [] };
    const sweep = sweepDeg(s);
    const turned = sweep * v;
    const scaleDeg = (i, n) => markDeg(s) - sweep * i / n + turned;
    const first = p.from1 ? 1 : 0;
    const fade = x => Math.round(4 * Math.min(1, x / 0.45)) / 4;
    // A rotation by `a` at x, y on the face at height z
    const onFace = (z, a, x, y) => {
      const F = faceMap(V, z);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      return [F.sx * c, F.sy * sn, -F.sx * sn, F.sy * c, F.sx * x, F.sy * y + F.ty].map(r3);
    };
    const faceQuad = (z, pts) => {
      const F = faceMap(V, z);
      return pts.map(q => [r3(F.sx * q[0]), r3(F.sy * q[1] + F.ty)]);
    };

    // On a round wall of radius R·rAt(u) from z0 to z1
    const onWall = (R, z0, z1, rAt) => {
      const pt = (a, u, lift) => {
        const r = R * rAt(u) + (lift || 0);
        return proj(V, r * Math.cos(a), r * Math.sin(a), z0 + (z1 - z0) * u);
      };
      const frame = (a, u) => {
        const at = pt(a, u);
        const da = 0.01;
        const du = 0.02;
        const pa = pt(a + da, u);
        const pu = pt(a, u + du);
        const r = R * rAt(u);
        const lu = Math.hypot((rAt(u + du) - rAt(u)) * R, (z1 - z0) * du);
        const T = [(pa[0] - at[0]) / (r * da), (pa[1] - at[1]) / (r * da)];
        const U = [(pu[0] - at[0]) / lu, (pu[1] - at[1]) / lu];
        return { at, T, U, vis: T[0] * U[1] - T[1] * U[0] };
      };
      const quad = (a, w, u0, u1, lift) => {
        const h = w / 2 / (R * rAt((u0 + u1) / 2));
        return [pt(a - h, u0, lift), pt(a + h, u0, lift), pt(a + h, u1, lift), pt(a - h, u1, lift)];
      };
      // Text runs against T (T turns clockwise on screen) so it isn't
      // mirrored; glyph up runs up the wall, so its foot sits toward the base
      const glyph = (text, size, f) => ({ text, size, alpha: fade(f.vis), m: [-f.T[0], -f.T[1], -f.U[0], -f.U[1], f.at[0], f.at[1]].map(r3) });
      return { frame, quad, glyph };
    };

    if (s.body.on && p.scale === 'face') {
      for (let i = first; i <= 10; i++) {
        const a = rad(scaleDeg(i, 10));
        // Foot of each number toward the knob's edge
        out.bodyFace.push({ text: String(i), size: p.size, alpha: 1, m: onFace(V.zB, a - Math.PI / 2, p.radius * Math.cos(a), p.radius * Math.sin(a)) });
      }
      if (p.ticks > 0) {
        const r0 = p.radius + p.size * 0.7;
        for (let i = 0; i <= 20; i++) {
          const a = scaleDeg(i, 20);
          const P = [turn(r0, -0.35, a), turn(r0 + p.ticks, -0.35, a), turn(r0 + p.ticks, 0.35, a), turn(r0, 0.35, a)];
          out.bodyFace.push({ pts: faceQuad(V.zB, P), alpha: 1, color: p.color });
        }
      }
    }
    if (s.body.on && p.scale === 'wall') {
      const W = onWall(50, 0, V.zB, u => bodyAt(s, u));
      for (let i = 0; i <= 20; i++) {
        const a = rad(scaleDeg(i, 20));
        const f = W.frame(a, 0.8);
        if (f.vis < 0.12) continue;
        out.bodyWall.push({ pts: W.quad(a, 0.9, i % 2 ? 0.72 : 0.6, 0.97, 0.05), alpha: fade(f.vis), color: p.color });
      }
      for (let i = first; i <= 10; i++) {
        const a = rad(scaleDeg(i, 10));
        const f = W.frame(a, p.at / 100);
        if (f.vis < 0.12) continue;
        out.bodyWall.push(W.glyph(String(i), p.size, f));
      }
    }
    if (p.label) {
      const z = V.capOn ? V.zC : V.zB;
      out[V.capOn ? 'capFace' : 'bodyFace'].push({ text: p.label, size: p.labelSize, alpha: 1, color: p.labelColor, m: onFace(z, rad(turned - sweep / 2), 0, 0) });
    }
    if (p.stripe && (V.capOn || s.body.on)) {
      const a = rad(pointerDeg(s, v));
      const W = V.capOn ? onWall(capRadius(s, 0), V.zB, V.zC, u => capAt(s, u)) : onWall(50, 0, V.zB, u => bodyAt(s, u));
      if (W.frame(a, 0.5).vis > 0.02) out[V.capOn ? 'capWall' : 'bodyWall'].push({ pts: W.quad(a, p.stripeWidth, 0, 1, 0.3), alpha: 1, color: p.stripeColor });
    }
    return out;
  }

  // How far a 3D knob reaches from the frame center, in units. Rotation-proof:
  // each part counts as a circle of its largest radius.
  function reach3d(s) {
    const V = view(s);
    let E = 0;
    const fit = (R, z, pad) => {
      const g = grow(V, z);
      E = Math.max(E, R * g + pad, R * V.ct * g + Math.abs((z - V.zMid) * V.st) + pad);
    };
    if (s.body.on) {
      const R = maxRadius(body(s, 0));
      const pad = s.print.index ? 9 : 1;
      fit(R * bodyAt(s, 0), 0, pad);
      fit(R, V.zB, pad);
      const sh = shadows3d(s, 0);
      if (sh.drop.blur > 0) fit(R * bodyAt(s, 0), 0, Math.hypot(sh.drop.off[0], sh.drop.off[1]) + 4 * sh.drop.blur);
    }
    if (V.capOn) {
      const R = maxRadius(cap(s, 0, 0));
      fit(R, V.zB, 1);
      fit(R * V.capTop, V.zC, 1);
    }
    if (V.barOn) {
      const R = maxRadius(bar(s, 0, 0));
      fit(R, V.zBar, 1);
      fit(R, V.zR, 1);
    }
    return E;
  }

  return {
    START, SWEEP, SEG, BASE, LIMITS, ENUMS, FILLS, BRUSH_STOPS, TEX,
    startDeg, sweepDeg, ringShown, labelsOn, pointerDeg, turns, outline, innerRadius, body, cap, capRadius, capInner, bar, maxRadius, bounds,
    brush, grain, shadowShift, layout, ticks, labels, valueSpan, dotAngles, litDots, deep, markDeg, bodyAt, capAt, view, proj, faceMap, walls, shadows3d, indexMark, prints, reach3d
  };
})();


const KNOB_SPEC_BASE = KnobShapes.BASE;
const KNOB_SPEC_LIMITS = KnobShapes.LIMITS;
const KNOB_SPEC_ENUMS = KnobShapes.ENUMS;

// Fills in defaults and clamps everything, so a bad message can't build a
// broken control. Same rules as SpecTools.normalize() in ui.html.
function normalizeKnobSpec(raw) {
    return normalizeSpec(raw, KNOB_SPEC_BASE, KNOB_SPEC_LIMITS, KNOB_SPEC_ENUMS);
}

function normalizeSpec(raw, BASE, LIMITS, ENUMS) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const clean = (path, def, val) => {
        if (typeof def === 'number') {
            let n = Number(val);
            if (!isFinite(n)) n = def;
            const lim = LIMITS[path];
            return lim ? Math.max(lim[0], Math.min(lim[1], n)) : n;
        }
        if (typeof def === 'boolean') return typeof val === 'boolean' ? val : def;
        if (typeof val !== 'string') return def;
        if (/^#[0-9a-f]{6}$/i.test(def)) return /^#[0-9a-f]{6}$/i.test(val) ? val : def;
        const options = ENUMS[path];
        if (options) return options.indexOf(val) !== -1 ? val : def;
        return val.slice(0, 60);
    };
    const out = {};
    Object.keys(BASE).forEach(key => {
        const def = BASE[key];
        if (def && typeof def === 'object') {
            const src = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
            out[key] = {};
            Object.keys(def).forEach(f => { out[key][f] = clean(key + '.' + f, def[f], src[f]); });
        } else {
            out[key] = clean(key, def, raw[key]);
        }
    });
    if (out.tier !== 'pro') out.tier = 'free';
    return out;
}

function knobSpecLayout(s) {
    return KnobShapes.layout(s);
}

// Width of one frame in px
function knobSpecCellPx(s) {
    return Math.round(s.size);
}

// Px per unit: the knob's full extent fills the frame, less a pixel of air per side
function knobSpecScale(s) {
    return (knobSpecCellPx(s) / 2 - 1) / knobSpecLayout(s).extent;
}

// Degrees (clockwise from 3 o'clock) covered by the value at v
function knobValueSpan(s, v) {
    return KnobShapes.valueSpan(s, v);
}

function knobDotAngles(s) {
    return KnobShapes.dotAngles(s);
}

// Figma gradient transforms map the node's 0..1 box into gradient space.
// `turnDeg` spins the metal bands of a conic fill with the knob.
function knobPaints(fill, c1, c2, angleDeg, turnDeg) {
    if (fill === 'solid') return [{ type: 'SOLID', color: hexToRgb(c1) }];
    const t = angleDeg * Math.PI / 180;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    const a = Object.assign(hexToRgb(c1), { a: 1 });
    const b = Object.assign(hexToRgb(c2), { a: 1 });
    if (fill === 'conic') {
        // Brushed metal: eight alternating bands, symmetric so the start angle doesn't matter
        const stops = [];
        for (let i = 0; i <= 8; i++) stops.push({ position: i / 8, color: i % 2 ? b : a });
        // Rotation about the box center, clockwise by turnDeg
        const r = (turnDeg || 0) * Math.PI / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        return [{ type: 'GRADIENT_ANGULAR', gradientTransform: [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]], gradientStops: stops }];
    }
    if (fill === 'brushed') {
        const mix = t => ({ r: b.r + (a.r - b.r) * t, g: b.g + (a.g - b.g) * t, b: b.b + (a.b - b.b) * t, a: 1 });
        return [{
            type: 'GRADIENT_ANGULAR',
            gradientTransform: [[1, 0, 0], [0, 1, 0]],
            gradientStops: KnobShapes.BRUSH_STOPS.map(st => ({ position: st[0], color: mix(st[1]) }))
        }];
    }
    const stops = [{ position: 0, color: a }, { position: 1, color: b }];
    if (fill === 'radial') {
        // Hot spot pulled toward the light, reaching past the far edge
        const S = 0.5 / 0.72;
        const cx = 0.5 - 0.22 * dx;
        const cy = 0.5 - 0.22 * dy;
        return [{ type: 'GRADIENT_RADIAL', gradientTransform: [[S, 0, 0.5 - S * cx], [0, S, 0.5 - S * cy]], gradientStops: stops }];
    }
    return [{
        type: 'GRADIENT_LINEAR',
        gradientTransform: [[dx, dy, 0.5 - 0.5 * dx - 0.5 * dy], [-dy, dx, 0.5 + 0.5 * dy - 0.5 * dx]],
        gradientStops: stops
    }];
}

function knobSheenPaint(sheen) {
    return {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [[0, 1, 0], [-1, 0, 1]],
        gradientStops: [
            { position: 0, color: { r: 1, g: 1, b: 1, a: sheen / 100 } },
            { position: 0.55, color: { r: 1, g: 1, b: 1, a: 0 } }
        ]
    };
}

// `shift` is the offset in px, [x, y]; straight down by default
function knobShadowEffect(blurPx, alphaPct, shift) {
    const off = shift || [0, blurPx * 0.35];
    return { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: alphaPct / 100 }, offset: { x: off[0], y: off[1] }, radius: blurPx, spread: 0, visible: true, blendMode: 'NORMAL' };
}

// A studio knob part's shadow, cast by the knob's one light
function knobPartShadow(ctx, blur, alphaPct) {
    const sh = KnobShapes.shadowShift(ctx.s, blur);
    return knobShadowEffect(blur * ctx.k, alphaPct, [sh[0] * ctx.k, sh[1] * ctx.k]);
}

function knobGlowEffect(hex, blurPx) {
    return { type: 'DROP_SHADOW', color: Object.assign(hexToRgb(hex), { a: 0.9 }), offset: { x: 0, y: 0 }, radius: blurPx, spread: 0, visible: true, blendMode: 'NORMAL' };
}

function knobSolid(hex) {
    return [{ type: 'SOLID', color: hexToRgb(hex) }];
}

function knobEdge(node, widthPx, hex) {
    if (widthPx > 0) {
        node.strokes = knobSolid(hex);
        node.strokeWeight = widthPx;
        node.strokeAlign = 'INSIDE';
    } else {
        node.strokes = [];
    }
}

// Shape helpers. ctx: { s, f: frame, c: center px, k: px per unit, L: layout,
// map: a 3D knob's tilted face (see knobMapAt), or none for a flat knob }

// Where unit point x, y lands in the frame, in px
function knobPt(ctx, x, y) {
    const m = ctx.map;
    return m ? [m.tx + x * m.sx, m.ty + y * m.sy] : [ctx.c + x * ctx.k, ctx.c + y * ctx.k];
}

// On a tilted face circles become ellipses and turned rectangles become
// slanted, so those parts are built as vectors instead
const knobTilted = ctx => !!ctx.map && ctx.map.sx !== ctx.map.sy;

function knobCircleAt(ctx, name, dist, deg, r) {
    const n = figma.createEllipse();
    ctx.f.appendChild(n);
    n.name = name;
    const t = deg * Math.PI / 180;
    const w = Math.max(0.01, 2 * r * (ctx.map ? ctx.map.sx : ctx.k));
    const h = Math.max(0.01, 2 * r * (ctx.map ? ctx.map.sy : ctx.k));
    n.resize(w, h);
    const p = knobPt(ctx, dist * Math.cos(t), dist * Math.sin(t));
    n.x = p[0] - w / 2;
    n.y = p[1] - h / 2;
    return n;
}

function knobCircle(ctx, name, r) {
    return knobCircleAt(ctx, name, 0, 0, r);
}

// Rectangle along the radius at `deg`, from r0 out to r0 + len, `w` wide
function knobRadialRect(ctx, name, deg, r0, len, w) {
    if (knobTilted(ctx)) {
        const t = deg * Math.PI / 180;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const P = [[r0, -w / 2], [r0 + len, -w / 2], [r0 + len, w / 2], [r0, w / 2]].map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
        return knobVector(ctx, name, [P]);
    }
    const n = figma.createRectangle();
    ctx.f.appendChild(n);
    n.name = name;
    const L = Math.max(0.01, len * ctx.k);
    const W = Math.max(0.01, w * ctx.k);
    n.resize(L, W);
    const t = deg * Math.PI / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const mid = (r0 + len / 2) * ctx.k;
    // Rotate about the rect's own center, then move that center into place
    n.relativeTransform = [
        [cos, -sin, ctx.c + mid * cos - (cos * L / 2 - sin * W / 2)],
        [sin, cos, ctx.c + mid * sin - (sin * L / 2 + cos * W / 2)]
    ];
    return n;
}

// Filled ring segment, like an SVG arc with a butt cap
function knobSector(ctx, name, rIn, rOut, fromDeg, toDeg) {
    const n = knobCircle(ctx, name, rOut);
    n.arcData = {
        startingAngle: fromDeg * Math.PI / 180,
        endingAngle: toDeg * Math.PI / 180,
        innerRadius: Math.max(0, Math.min(0.999, rIn / rOut))
    };
    return n;
}

function knobGroupOf(ctx, name, nodes) {
    nodes = nodes.filter(Boolean);
    if (!nodes.length) return null;
    if (nodes.length === 1) {
        nodes[0].name = name;
        return nodes[0];
    }
    const g = figma.group(nodes, ctx.f);
    g.name = name;
    return g;
}

function knobBuildTicks(ctx) {
    const t = ctx.s.ticks;
    if (!t.on) return null;
    // Width 0 leaves only the labels
    const marks = t.width > 0 ? KnobShapes.ticks(ctx.s) : [];
    const nodes = marks.map((tk, i) => {
        const tick = knobRadialRect(ctx, (tk.major ? 'major_' : 'tick_') + (i + 1), tk.deg, ctx.L.tickIn, tk.len, t.width);
        tick.fills = knobSolid(t.color);
        return tick;
    });
    // Labels need Inter Bold, loaded by the caller; without it they're left out
    if (ctx.font) {
        KnobShapes.labels(ctx.s).forEach(lb => {
            const text = figma.createText();
            ctx.f.appendChild(text);
            text.name = 'label_' + lb.text;
            text.fontName = ctx.font;
            text.fontSize = Math.max(1, lb.size * ctx.k);
            text.characters = lb.text;
            text.textAutoResize = 'WIDTH_AND_HEIGHT';
            text.fills = knobSolid(t.labelColor);
            text.x = ctx.c + lb.x * ctx.k - text.width / 2;
            text.y = ctx.c + lb.y * ctx.k - text.height / 2;
            nodes.push(text);
        });
    }
    return knobGroupOf(ctx, 'ticks', nodes);
}

// Loads the font for scale labels and a 3D knob's printing, or null when
// the knob has neither
function knobLabelFont(s) {
    const labels = s.ticks.on && s.ticks.labels !== 'none';
    const printing = KnobShapes.deep(s) && (s.print.scale !== 'none' || !!s.print.label);
    if (!labels && !printing) return Promise.resolve(null);
    const font = { family: 'Inter', style: 'Bold' };
    return figma.loadFontAsync(font).then(() => font, () => null);
}

// A ring band from one angle to another, with optional round ends
function knobBand(ctx, name, fromDeg, toDeg, hex) {
    const r = ctx.s.ring;
    const L = ctx.L;
    const out = [];
    if (toDeg - fromDeg > 0.01) {
        const arc = knobSector(ctx, name, L.ringIn, L.ringOut, fromDeg, toDeg);
        arc.fills = knobSolid(hex);
        out.push(arc);
    }
    if (r.round) {
        [fromDeg, toDeg].forEach((deg, i) => {
            const end = knobCircleAt(ctx, name + (i ? '_end' : '_start'), L.ringMid, deg, (L.ringOut - L.ringIn) / 2);
            end.fills = knobSolid(hex);
            out.push(end);
        });
    }
    return out;
}

function knobBuildTrack(ctx) {
    const r = ctx.s.ring;
    if (!r.track || !KnobShapes.ringShown(ctx.s)) return null;
    if (r.style === 'dots') {
        return knobGroupOf(ctx, 'track', knobDotAngles(ctx.s).map((deg, i) => {
            const dot = knobCircleAt(ctx, 'dot_' + (i + 1), ctx.L.ringMid, deg, r.width / 2);
            dot.fills = knobSolid(r.trackColor);
            return dot;
        }));
    }
    return knobGroupOf(ctx, 'track', knobBand(ctx, 'track_arc', KnobShapes.START, KnobShapes.START + KnobShapes.SWEEP, r.trackColor));
}

function knobBuildValue(ctx, v) {
    const r = ctx.s.ring;
    if (!r.value || !KnobShapes.ringShown(ctx.s)) return null;
    const span = knobValueSpan(ctx.s, v);
    let nodes;
    if (r.style === 'dots') {
        // Same rule as Vellum's LED ring: a dot lights when its angle is inside the span
        const angles = knobDotAngles(ctx.s);
        nodes = KnobShapes.litDots(ctx.s, v).map(i => {
            const dot = knobCircleAt(ctx, 'lit_' + (i + 1), ctx.L.ringMid, angles[i], r.width / 2);
            dot.fills = knobSolid(r.valueColor);
            return dot;
        });
    } else {
        nodes = knobBand(ctx, 'value_arc', span[0], span[1], r.valueColor);
    }
    if (r.glow > 0) nodes.forEach(n => { n.effects = [knobGlowEffect(r.valueColor, r.glow * ctx.k)]; });
    const g = knobGroupOf(ctx, 'value', nodes);
    if (g && r.opacity < 100) g.opacity = r.opacity / 100;
    return g;
}

// A vector from KnobShapes outlines (units, center origin). The path is
// shifted to start at 0, 0 and the node moved instead, so it lands in the
// same place whether or not Figma re-normalizes the path. `open` leaves the
// paths unclosed (lines); `winding` is NONZERO unless given.
function knobVector(ctx, name, polys, open, winding) {
    let minX = Infinity;
    let minY = Infinity;
    const px = polys.map(P => P.map(p => {
        const q = knobPt(ctx, p[0], p[1]);
        minX = Math.min(minX, q[0]);
        minY = Math.min(minY, q[1]);
        return q;
    }));
    const data = px.map(P => 'M ' + P.map(p => (p[0] - minX).toFixed(3) + ' ' + (p[1] - minY).toFixed(3)).join(' L ') + (open ? '' : ' Z')).join(' ');
    const n = figma.createVector();
    ctx.f.appendChild(n);
    n.name = name;
    n.vectorPaths = [{ windingRule: winding || 'NONZERO', data }];
    // New vectors come with Figma's default black stroke; parts that want
    // an outline set one afterwards
    n.strokes = [];
    n.x = minX;
    n.y = minY;
    return n;
}

// Machined rings and specks over a face, R units out. The rings look the
// same at any angle; the specks turn with the knob at value v.
function knobTexture(ctx, R, brush, grain, v) {
    const T = KnobShapes.TEX;
    const out = [];
    const white = { r: 1, g: 1, b: 1 };
    const black = { r: 0, g: 0, b: 0 };
    if (brush > 0) {
        const B = KnobShapes.brush(R);
        [['brush_light', B.light, white, T.brushLight], ['brush_dark', B.dark, black, T.brushDark]].forEach(([name, polys, color, alpha]) => {
            if (!polys.length) return;
            const n = knobVector(ctx, name, polys);
            n.fills = [];
            n.strokes = [{ type: 'SOLID', color, opacity: alpha * brush / 100 }];
            n.strokeWeight = T.brushWidth * ctx.k;
            n.strokeAlign = 'CENTER';
            out.push(n);
        });
    }
    if (grain > 0) {
        const G = KnobShapes.grain(R, KnobShapes.sweepDeg(ctx.s) * (v || 0));
        [['grain_light', G.light, white, T.grainLight], ['grain_dark', G.dark, black, T.grainDark]].forEach(([name, polys, color, alpha]) => {
            if (!polys.length) return;
            const n = knobVector(ctx, name, polys);
            n.fills = [{ type: 'SOLID', color, opacity: alpha * grain / 100 }];
            out.push(n);
        });
    }
    return out;
}

function knobBuildBody(ctx, v) {
    const s = ctx.s;
    const b = s.body;
    if (!b.on) return null;
    const n = b.shape === 'circle' ? knobCircle(ctx, 'body', 50) : knobVector(ctx, 'body', [KnobShapes.body(s, v)]);
    const fills = knobPaints(b.fill, b.c1, b.c2, b.angle, KnobShapes.sweepDeg(s) * v);
    if (b.sheen > 0) fills.push(knobSheenPaint(b.sheen));
    n.fills = fills;
    knobEdge(n, b.edge * ctx.k, b.edgeColor);
    if (b.shadow > 0) n.effects = [knobPartShadow(ctx, b.shadow, b.shadowAlpha)];
    const tex = knobTexture(ctx, KnobShapes.innerRadius(b.shape, 50, b.teeth, b.depth), b.brush, b.grain, v);
    if (!tex.length) return n;
    n.name = 'body_face';
    return knobGroupOf(ctx, 'body', [n].concat(tex));
}

function knobBuildCap(ctx, v) {
    const s = ctx.s;
    const c = s.cap;
    if (!c.on) return null;
    const bevel = Math.max(0, Math.min(c.bevel, c.size / 2 - 0.5));
    const shapeAt = (name, inset) => (c.shape === 'circle'
        ? knobCircle(ctx, name, KnobShapes.capRadius(s, inset))
        : knobVector(ctx, name, [KnobShapes.cap(s, v, inset)]));
    const outer = shapeAt(bevel > 0 ? 'cap_bevel' : 'cap_face', 0);
    const nodes = [outer];
    knobEdge(outer, c.edge * ctx.k, c.edgeColor);
    if (c.shadow > 0) outer.effects = [knobPartShadow(ctx, c.shadow, 45)];
    if (bevel > 0) {
        // A lit ring, then the face inside it
        outer.fills = knobPaints('linear', c.bevelC1, c.bevelC2, 90);
        const face = shapeAt('cap_face', bevel);
        face.fills = knobPaints(c.fill, c.c1, c.c2, c.angle, KnobShapes.sweepDeg(s) * v);
        nodes.push(face);
    } else {
        outer.fills = knobPaints(c.fill, c.c1, c.c2, c.angle, KnobShapes.sweepDeg(s) * v);
    }
    const R = KnobShapes.capRadius(s, bevel);
    const count = Math.round(c.grooves);
    for (let i = 0; i < count; i++) {
        const rr = count === 1 ? R * 0.62 : R * (0.35 + 0.55 * i / (count - 1));
        const groove = knobCircle(ctx, 'groove_' + (i + 1), rr);
        groove.fills = [];
        groove.strokes = [{ type: 'SOLID', color: hexToRgb(c.grooveColor), opacity: 0.35 }];
        groove.strokeWeight = 0.6 * ctx.k;
        groove.strokeAlign = 'CENTER';
        nodes.push(groove);
    }
    return knobGroupOf(ctx, 'cap', nodes.concat(knobTexture(ctx, KnobShapes.capInner(s, bevel), c.brush, c.grain, v)));
}

// The bar across the knob, with an optional raised face lit the other way
function knobBuildBar(ctx, v) {
    const s = ctx.s;
    const b = s.bar;
    if (!b.on) return null;
    const outer = knobVector(ctx, 'bar_body', [KnobShapes.bar(s, v, 0)]);
    outer.fills = knobPaints(b.fill, b.c1, b.c2, b.angle);
    knobEdge(outer, b.edge * ctx.k, b.edgeColor);
    if (b.shadow > 0) outer.effects = [knobPartShadow(ctx, b.shadow, 45)];
    const nodes = [outer];
    if (b.inset > 0) {
        const face = knobVector(ctx, 'bar_face', [KnobShapes.bar(s, v, b.inset)]);
        face.fills = knobPaints(b.fill, b.c2, b.c1, b.angle);
        nodes.push(face);
    }
    return knobGroupOf(ctx, 'bar', nodes);
}

function knobBuildPointer(ctx, v) {
    const p = ctx.s.pointer;
    if (p.shape === 'none') return null;
    const k = ctx.k;
    const deg = KnobShapes.pointerDeg(ctx.s, v);
    const outer = 50 - p.inset; // the pointer's outer end, in from the rim by `inset`
    if (p.shape === 'dot') {
        const dot = knobCircleAt(ctx, 'pointer', outer - p.width / 2, deg, p.width / 2);
        dot.fills = knobSolid(p.color);
        knobEdge(dot, p.edge * k, p.edgeColor);
        return dot;
    }
    if (p.shape === 'line') {
        // A full-length round line ends in a half circle centered on the pivot
        const len = Math.min(p.length, outer + (p.round ? p.width / 2 : 0));
        const line = knobRadialRect(ctx, 'pointer', deg, outer - len, len, p.width);
        line.fills = knobSolid(p.color);
        if (p.round) line.cornerRadius = p.width * k / 2;
        knobEdge(line, p.edge * k, p.edgeColor);
        return line;
    }
    if (p.shape === 'notch') {
        // A slot cut into the surface: shade falls from the upper wall and
        // the lower lip catches the light. Effects turn with the node, so the
        // offsets are turned back to keep the light fixed as the knob turns.
        const len = Math.min(p.length, outer);
        const slot = knobRadialRect(ctx, 'pointer', deg, outer - len, len, p.width);
        slot.fills = knobSolid(p.color);
        // (On a tilted face the slot is an unturned vector, so straight down is down)
        const t = deg * Math.PI / 180;
        const down = d => (knobTilted(ctx) ? { x: 0, y: d } : { x: d * Math.sin(t), y: d * Math.cos(t) });
        const w = p.width * k;
        slot.effects = [
            { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.75 }, offset: down(w * 0.35), radius: w * 0.5, spread: 0, visible: true, blendMode: 'NORMAL' },
            { type: 'INNER_SHADOW', color: { r: 1, g: 1, b: 1, a: 0.3 }, offset: down(-w * 0.25), radius: w * 0.3, spread: 0, visible: true, blendMode: 'NORMAL' }
        ];
        knobEdge(slot, p.edge * k, p.edgeColor);
        return slot;
    }
    if (p.shape === 'triangle' && knobTilted(ctx)) {
        const len = Math.min(p.length, outer);
        const t = deg * Math.PI / 180;
        const at = (r, w) => [r * Math.cos(t) - w * Math.sin(t), r * Math.sin(t) + w * Math.cos(t)];
        const tri = knobVector(ctx, 'pointer', [[at(outer, 0), at(outer - len, p.width / 2), at(outer - len, -p.width / 2)]]);
        tri.fills = knobSolid(p.color);
        knobEdge(tri, p.edge * k, p.edgeColor);
        return tri;
    }
    if (p.shape === 'triangle') {
        const len = Math.min(p.length, outer);
        const W = p.width * k;
        const H = len * k;
        const tri = figma.createVector();
        ctx.f.appendChild(tri);
        tri.name = 'pointer';
        tri.vectorPaths = [{ windingRule: 'NONZERO', data: `M ${W / 2} 0 L ${W} ${H} L 0 ${H} Z` }];
        // Local +y runs from the tip toward the center; local +x is 90° from it
        const t = deg * Math.PI / 180;
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        const X = [-sin, cos];
        const Y = [-cos, -sin];
        const mid = (outer - len / 2) * k;
        const px = ctx.c + mid * cos;
        const py = ctx.c + mid * sin;
        tri.relativeTransform = [
            [X[0], Y[0], px - (X[0] * W / 2 + Y[0] * H / 2)],
            [X[1], Y[1], py - (X[1] * W / 2 + Y[1] * H / 2)]
        ];
        tri.fills = knobSolid(p.color);
        knobEdge(tri, p.edge * k, p.edgeColor);
        return tri;
    }
    // LED: a dark housing with a lens that glows
    const housingD = p.width * 1.9;
    const rc = outer - housingD / 2;
    const housing = knobCircleAt(ctx, 'led_housing', rc, deg, housingD / 2);
    housing.fills = [{ type: 'SOLID', color: { r: 0.04, g: 0.04, b: 0.04 }, opacity: 0.85 }];
    const lens = knobCircleAt(ctx, 'led', rc, deg, p.width / 2);
    const base = hexToRgb(p.color);
    const hot = { r: base.r + (1 - base.r) * 0.55, g: base.g + (1 - base.g) * 0.55, b: base.b + (1 - base.b) * 0.55, a: 1 };
    lens.fills = [{
        type: 'GRADIENT_RADIAL',
        gradientTransform: [[1, 0, 0], [0, 1, 0]],
        gradientStops: [{ position: 0, color: hot }, { position: 0.65, color: Object.assign({}, base, { a: 1 }) }, { position: 1, color: Object.assign({}, base, { a: 1 }) }]
    }];
    if (p.glow > 0) lens.effects = [knobGlowEffect(p.color, p.glow * k)];
    return knobGroupOf(ctx, 'pointer', [housing, lens]);
}

// ----- 3D knobs -----
// Walls, shadows and printing come from KnobShapes as point lists in
// projected units (the studio draws the same lists); faces are the usual
// builders above, drawn through ctx.map onto the tilted face.

// px per unit and offsets for the face at height z
function knobMapAt(ctx, V, z) {
    const F = KnobShapes.faceMap(V, z);
    return { sx: ctx.k * F.sx, sy: ctx.k * F.sy, tx: ctx.c, ty: ctx.c + ctx.k * F.ty };
}

// One frame's walls and printing, worked out once per frame
function knob3d(ctx, v) {
    if (!ctx.d3) ctx.d3 = { walls: KnobShapes.walls(ctx.s, v), prints: KnobShapes.prints(ctx.s, v) };
    return ctx.d3;
}

// A sweep (KnobShapes wall rings) as an angular gradient on node n, centered
// on unit point C: Figma's angular gradient starts along +x of its unit box
// and turns clockwise, like the studio's conic gradient
function knobSweepPaint(ctx, n, C, stops) {
    const c = knobPt(ctx, C[0], C[1]);
    const R = 2 * Math.max(1, n.width, n.height);
    const cx = c[0] - n.x;
    const cy = c[1] - n.y;
    return {
        type: 'GRADIENT_ANGULAR',
        gradientTransform: [[n.width / R, 0, 0.5 - cx / R], [0, n.height / R, 0.5 - cy / R]],
        gradientStops: stops
    };
}

// A wall: smooth round bands as one vector each, shaded by a sweep; other
// walls' quads merged into one vector per color, in the order the colors
// first appear (far side first); then the rim light along the top
function knobBuildWall(ctx, name, w) {
    if (!w || !(w.faces.length || (w.rings && w.rings.length))) return null;
    const nodes = [];
    (w.rings || []).forEach((R, i) => {
        const n = knobVector(ctx, name + '_band_' + (i + 1), R.polys);
        const paint = knobSweepPaint(ctx, n, R.center, R.stops.map(st => ({ position: st[0], color: Object.assign(hexToRgb(st[1]), { a: 1 }) })));
        n.fills = [paint];
        // Quads share edges; a hairline in the same sweep hides the seams
        n.strokes = [paint];
        n.strokeWeight = 0.6;
        n.strokeAlign = 'CENTER';
        n.strokeJoin = 'ROUND';
        nodes.push(n);
    });
    const byColor = new Map();
    w.faces.forEach(f => {
        if (!byColor.has(f.color)) byColor.set(f.color, []);
        byColor.get(f.color).push(f.pts);
    });
    byColor.forEach((polys, color) => {
        const n = knobVector(ctx, name + '_' + color.slice(1), polys);
        n.fills = knobSolid(color);
        // Quads share edges; a hairline in their own color hides the seams
        n.strokes = knobSolid(color);
        n.strokeWeight = 0.6;
        n.strokeAlign = 'CENTER';
        n.strokeJoin = 'ROUND';
        nodes.push(n);
    });
    // Shadow near the base and the grooves, one overlay per band
    w.shades.forEach((sh, i) => {
        const n = knobVector(ctx, name + '_shade_' + (i + 1), sh.polys);
        n.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: sh.alpha }];
        nodes.push(n);
    });
    const byAlpha = new Map();
    w.rims.forEach(r => {
        if (!byAlpha.has(r.alpha)) byAlpha.set(r.alpha, []);
        byAlpha.get(r.alpha).push([r.a, r.b]);
    });
    byAlpha.forEach((lines, alpha) => {
        const n = knobVector(ctx, name + '_rim', lines, true);
        n.fills = [];
        n.strokes = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: alpha }];
        n.strokeWeight = 1;
        n.strokeCap = 'ROUND';
        nodes.push(n);
    });
    if (w.rimRing) {
        const n = knobVector(ctx, name + '_rim', w.rimRing.runs, true);
        n.fills = [];
        n.strokes = [knobSweepPaint(ctx, n, w.rimRing.center, w.rimRing.stops.map(st => ({ position: st[0], color: { r: 1, g: 1, b: 1, a: st[1] } })))];
        n.strokeWeight = 1;
        n.strokeCap = 'ROUND';
        n.strokeJoin = 'ROUND';
        nodes.push(n);
    }
    return knobGroupOf(ctx, name, nodes);
}

// The shadow the base casts, and the tight one where it meets the panel.
// A canvas blur(σ) looks like a Figma layer blur of about 2σ.
function knobBuild3dShadows(ctx, v) {
    if (!ctx.s.body.on) return null;
    const S = KnobShapes.shadows3d(ctx.s, v);
    const nodes = [];
    [['drop_shadow', S.drop], ['contact_shadow', S.contact]].forEach(([name, d]) => {
        if (!(d.blur > 0 && d.alpha > 0)) return;
        const n = knobVector(ctx, name, [S.base.map(p => [p[0] + d.off[0], p[1] + d.off[1]])]);
        n.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: d.alpha }];
        // Newer Figma wants a blurType on layer blurs; older versions may not know it
        const blur = { type: 'LAYER_BLUR', radius: 2 * d.blur * ctx.k, visible: true };
        try {
            n.effects = [Object.assign({ blurType: 'NORMAL' }, blur)];
        } catch (e) {
            n.effects = [blur];
        }
        nodes.push(n);
    });
    return knobGroupOf(ctx, 'shadows', nodes);
}

function knobBuildIndex(ctx) {
    const s = ctx.s;
    if (!s.body.on || !s.print.index) return null;
    const n = knobVector(ctx, 'index_mark', [KnobShapes.indexMark(s)]);
    n.fills = knobSolid(s.print.indexColor);
    return n;
}

// Text outlines at font size 100, centered on 0, 0 the way the canvas
// centers text (textAlign center, textBaseline middle), as closed polylines
const knobGlyphCache = new Map();
function knobGlyphs(text, font) {
    const key = font.family + '/' + font.style + '/' + text;
    if (knobGlyphCache.has(key)) return knobGlyphCache.get(key);
    const t = figma.createText();
    figma.currentPage.appendChild(t);
    t.fontName = font;
    t.fontSize = 100;
    t.characters = text;
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    t.x = 0;
    t.y = 0;
    const cx = t.width / 2;
    const cy = t.height / 2;
    const vec = figma.flatten([t]);
    const polys = [];
    vec.vectorPaths.forEach(p => knobPathPolys(p.data).forEach(P => polys.push(P.map(q => [q[0] + vec.x - cx, q[1] + vec.y - cy]))));
    vec.remove();
    knobGlyphCache.set(key, polys);
    return polys;
}

// SVG-style path data (M, L, Q, C, Z, absolute) to polylines, curves in 6 steps
function knobPathPolys(data) {
    const tok = String(data).match(/[MLQCZmlqcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    const polys = [];
    let P = null;
    let at = [0, 0];
    let i = 0;
    const num = () => Number(tok[i++]);
    let cmd = '';
    while (i < tok.length) {
        if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
        if (cmd === 'Z') {
            if (P && P.length > 2) polys.push(P);
            P = null;
            continue;
        }
        if (cmd === 'M') {
            if (P && P.length > 2) polys.push(P);
            at = [num(), num()];
            P = [at];
            cmd = 'L';
            continue;
        }
        if (!P) P = [at];
        if (cmd === 'L') at = [num(), num()];
        else if (cmd === 'Q' || cmd === 'C') {
            const pts = [at];
            const n = cmd === 'Q' ? 2 : 3;
            for (let j = 0; j < n; j++) pts.push([num(), num()]);
            for (let s = 1; s <= 6; s++) {
                const t = s / 6;
                let q = pts.slice();
                while (q.length > 1) q = q.slice(1).map((b, j) => [q[j][0] + (b[0] - q[j][0]) * t, q[j][1] + (b[1] - q[j][1]) * t]);
                P.push(q[0]);
            }
            at = pts[pts.length - 1];
            continue;
        } else {
            i++;
            continue;
        }
        P.push(at);
    }
    if (P && P.length > 2) polys.push(P);
    return polys;
}

// Printing: quads, and glyphs (needs ctx.font, else they're left out).
// Each color and opacity becomes one vector.
function knobBuildPrints(ctx, name, items) {
    if (!items || !items.length) return null;
    const groups = new Map();
    const add = (color, alpha, polys) => {
        const key = color + '/' + alpha;
        if (!groups.has(key)) groups.set(key, { color, alpha, polys: [] });
        groups.get(key).polys.push(...polys);
    };
    items.forEach(it => {
        const color = it.color || ctx.s.print.color;
        if (it.pts) { add(color, it.alpha, [it.pts]); return; }
        if (!ctx.font) return;
        const m = it.m;
        const k = it.size / 100;
        add(color, it.alpha, knobGlyphs(it.text, ctx.font).map(P => P.map(q => {
            const x = q[0] * k;
            const y = q[1] * k;
            return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        })));
    });
    const nodes = [];
    groups.forEach(g => {
        // Even-odd keeps the holes in letters whatever way the outlines run
        const n = knobVector(ctx, name, g.polys, false, 'EVENODD');
        n.fills = [{ type: 'SOLID', color: hexToRgb(g.color), opacity: g.alpha }];
        nodes.push(n);
    });
    return knobGroupOf(ctx, name, nodes);
}

// A face: the usual layers drawn onto it through its tilt. The body's top
// carries whatever isn't raised above it; the pointer goes on the highest
// face that holds it (KnobShapes.view's host).
function knobBuildFace(ctx, v, which) {
    const s = ctx.s;
    const V = KnobShapes.view(s);
    const sp = JSON.parse(JSON.stringify(s));
    let z;
    let parts;
    if (which === 'body') {
        sp.body.shadow = 0;
        z = V.zB;
        parts = { body: true, cap: !V.capOn, bar: !V.capOn && !V.barOn, ring: s.ring.over && !V.capOn, pointer: V.host === 'body' };
    } else if (which === 'cap') {
        if (!V.capOn) return null;
        sp.cap.shadow = 0;
        sp.cap.size = s.cap.size * V.capTop;
        sp.cap.bevel = s.cap.bevel * V.capTop;
        z = V.zC;
        parts = { cap: true, bar: !V.barOn, ring: s.ring.over, pointer: V.host === 'cap' };
    } else {
        if (!V.barOn) return null;
        sp.bar.shadow = 0;
        z = V.zR;
        parts = { bar: true, pointer: V.host === 'bar' };
    }
    const fc = Object.assign({}, ctx, { s: sp, map: knobMapAt(ctx, V, z) });
    const nodes = [];
    if (parts.body) nodes.push(knobBuildBody(fc, v));
    if (parts.cap) nodes.push(knobBuildCap(fc, v));
    if (parts.ring) nodes.push(knobBuildTrack(fc), knobBuildValue(fc, v));
    if (parts.bar) nodes.push(knobBuildBar(fc, v));
    if (parts.pointer) nodes.push(knobBuildPointer(fc, v));
    return knobGroupOf(ctx, which + '_top', nodes);
}

// Bottom to top, like KnobCore's render3d. Round walls and the shadow of a
// round base look the same at every angle, so strips clone them.
const KNOB_LAYERS_3D = [
    { fixed: true, build: knobBuildTicks },
    { fixed: true, build: ctx => (ctx.s.ring.over ? null : knobBuildTrack(ctx)) },
    { fixed: false, build: (ctx, v) => (ctx.s.ring.over ? null : knobBuildValue(ctx, v)) },
    { fixed: true, build: knobBuildIndex },
    { fixed: s => s.body.shape === 'circle', build: knobBuild3dShadows },
    { fixed: s => s.body.shape === 'circle' && !(s.depth.slots > 0), build: (ctx, v) => knobBuildWall(ctx, 'body_wall', knob3d(ctx, v).walls.body) },
    { fixed: false, build: (ctx, v) => knobBuildPrints(ctx, 'body_wall_print', knob3d(ctx, v).prints.bodyWall) },
    { fixed: false, build: (ctx, v) => knobBuildFace(ctx, v, 'body') },
    { fixed: false, build: (ctx, v) => knobBuildPrints(ctx, 'body_print', knob3d(ctx, v).prints.bodyFace) },
    { fixed: s => s.cap.shape === 'circle', build: (ctx, v) => knobBuildWall(ctx, 'cap_wall', knob3d(ctx, v).walls.cap) },
    { fixed: false, build: (ctx, v) => knobBuildPrints(ctx, 'cap_wall_print', knob3d(ctx, v).prints.capWall) },
    { fixed: false, build: (ctx, v) => knobBuildFace(ctx, v, 'cap') },
    { fixed: false, build: (ctx, v) => knobBuildPrints(ctx, 'cap_print', knob3d(ctx, v).prints.capFace) },
    { fixed: false, build: (ctx, v) => knobBuildWall(ctx, 'bar_wall', knob3d(ctx, v).walls.bar) },
    { fixed: false, build: (ctx, v) => knobBuildFace(ctx, v, 'bar') }
];

// Bottom to top. Fixed layers look the same in every frame, so strips clone
// them from the first frame instead of rebuilding.
// `fixed` can depend on the spec: shapes that turn with the value rebuild.
// The ring sits under the body, or over the cap when `ring.over` is set.
const KNOB_LAYERS = [
    { fixed: true, build: knobBuildTicks },
    { fixed: true, build: ctx => (ctx.s.ring.over ? null : knobBuildTrack(ctx)) },
    { fixed: false, build: (ctx, v) => (ctx.s.ring.over ? null : knobBuildValue(ctx, v)) },
    // Grain and metal bands turn with the knob, so those parts rebuild even when round
    { fixed: s => !KnobShapes.turns(s.body.shape) && !(s.body.grain > 0) && s.body.fill !== 'conic', build: knobBuildBody },
    { fixed: s => !KnobShapes.turns(s.cap.shape) && !(s.cap.grain > 0) && s.cap.fill !== 'conic', build: knobBuildCap },
    { fixed: true, build: ctx => (ctx.s.ring.over ? knobBuildTrack(ctx) : null) },
    { fixed: false, build: (ctx, v) => (ctx.s.ring.over ? knobBuildValue(ctx, v) : null) },
    { fixed: false, build: knobBuildBar },
    { fixed: false, build: knobBuildPointer }
];

function createSpecKnobFrame(s, v, name, template, font) {
    const C = knobSpecCellPx(s);
    const f = figma.createFrame();
    f.name = name;
    f.resize(C, C);
    f.fills = [];
    f.clipsContent = true;
    const ctx = { s, f, c: C / 2, k: knobSpecScale(s), L: knobSpecLayout(s), font: font || null };
    const fixed = [];
    (KnobShapes.deep(s) ? KNOB_LAYERS_3D : KNOB_LAYERS).forEach((layer, i) => {
        const isFixed = typeof layer.fixed === 'function' ? layer.fixed(s) : layer.fixed;
        let node = null;
        if (isFixed && template) {
            const src = template[i];
            if (src) {
                node = src.clone();
                f.appendChild(node);
                node.x = src.x;
                node.y = src.y;
            }
        } else {
            node = layer.build(ctx, v);
        }
        if (isFixed) fixed[i] = node;
    });
    return { frame: f, fixed };
}

function createSpecKnob(s, value, font) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    const knob = createSpecKnobFrame(s, v, 'Knob · ' + s.name, null, font).frame;
    knob.setPluginData('knobSpec', JSON.stringify(s));
    knob.setPluginData('knobKind', 'knob');
    knob.setPluginData('knobValue', String(v));
    return knob;
}

// Value drawn in frame i. Vellum shows frame round(v * (frames - 1)), so at
// v = 0.5 an even count lands on frame frames/2, which a uniform strip draws
// just past center. Bipolar strips pin that frame to exactly 0.5 and space
// each half evenly, so 64 or 128 frames still get a clean center.
function stripFrameValue(i, frames, bipolar) {
    const last = frames - 1;
    if (!bipolar || frames < 3) return i / last;
    const c = Math.round(last / 2);
    return i <= c ? 0.5 * i / c : 0.5 + 0.5 * (i - c) / (last - c);
}

// A frame of equal cells, frame 0 at the minimum. Named "…_128f" so Vellum
// and the Preview tab read the frame count from the exported file name.
function createSpecKnobStrip(s, frames, gap, axis, font) {
    return runStripSteps(knobStripSteps(s, frames, gap, axis, font));
}

function* knobStripSteps(s, frames, gap, axis, font) {
    frames = Math.max(2, Math.min(256, Math.round(Number(frames) || 128)));
    gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
    axis = axis === 'h' ? 'h' : 'v';
    const C = knobSpecCellPx(s);
    const along = frames * C + (frames - 1) * gap;
    const strip = figma.createFrame();
    // "endless" in the name tells the Tester tab to play it on a loop
    strip.name = (s.endless ? 'knob_endless_sprite_' : 'knob_sprite_') + frames + 'f';
    strip.resize(axis === 'v' ? C : along, axis === 'v' ? along : C);
    strip.fills = [];
    strip.clipsContent = true;
    let template = null;
    for (let i = 0; i < frames; i++) {
        // An endless knob's strip stops one step short of a full turn, so
        // playing it on a loop never shows the same angle twice in a row
        const v = s.endless ? i / frames : stripFrameValue(i, frames, s.ring.bipolar);
        const built = createSpecKnobFrame(s, v, 'frame_' + String(i).padStart(3, '0'), template, font);
        if (!template) template = built.fixed;
        strip.appendChild(built.frame);
        const pos = i * (C + gap);
        built.frame.x = axis === 'v' ? 0 : pos;
        built.frame.y = axis === 'v' ? pos : 0;
        yield { strip, done: i + 1, total: frames };
    }
    strip.setPluginData('knobSpec', JSON.stringify(s));
    strip.setPluginData('knobKind', 'strip');
    strip.setPluginData('knobStrip', JSON.stringify({ frames, gap, axis }));
    return strip;
}

// Gives a studio control or strip a ready-made PNG export preset, so Export
// in Figma's panel writes e.g. "knob_sprite_128f@2x.png". Vellum reads the
// frame count and the @2x from that name and shows it at half its pixels,
// sharp on HiDPI screens. The frame on the canvas keeps its real size.
function applyExportScale(node, x2) {
    const on = x2 !== false;
    node.exportSettings = [{ format: 'PNG', suffix: on ? '@2x' : '', constraint: { type: 'SCALE', value: on ? 2 : 1 } }];
}

// Strip builders are generators that yield after each frame. Add Animation
// Strip runs them straight through; Download PNG pauses between frames.
function runStripSteps(steps) {
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value;
}

// Download PNG: builds the real strip in Figma (so the file is exactly what
// the canvas shows), exports it, then removes it unless asked to keep it.
// Add Animation Strip runs the same job with `place` and skips the export.
// Every 8 frames (or ~60 ms) it pauses to report progress and to let a
// Cancel get in.
let stripExportJob = null;

function exportStudioStrip(msg) {
    return __awaiter(this, void 0, void 0, function* () {
        const job = { id: msg.id, cancel: false };
        stripExportJob = job;
        const say = m => figma.ui.postMessage(Object.assign({ type: 'export-strip-status', id: msg.id }, m));
        const breathe = () => new Promise(res => setTimeout(res, 0));
        const x2 = msg.x2 !== false;
        let strip = null;
        // Off to the right of the view, so the canvas doesn't jump around
        const park = node => {
            const vb = figma.viewport.bounds;
            node.x = Math.round(vb.x + vb.width + 200);
            node.y = Math.round(vb.y);
        };
        try {
            let steps = null;
            if (msg.kind === 'knob') {
                const s = normalizeKnobSpec(msg.spec);
                steps = knobStripSteps(s, msg.frames, msg.gap, msg.axis, yield knobLabelFont(s));
            }
            else if (msg.kind === 'slider') steps = sliderStripSteps(normalizeSliderSpec(msg.spec), msg.frames, msg.gap, msg.axis);
            else if (msg.kind === 'meter') {
                const s = normalizeMeterSpec(msg.spec);
                steps = meterStripSteps(s, msg.frames, msg.gap, msg.axis, yield meterFonts(s));
            }
            else if (msg.kind === 'wheel') steps = wheelStripSteps(normalizeWheelSpec(msg.spec), msg.frames, msg.gap, msg.axis);
            else if (msg.kind === 'button') {
                strip = yield createSpecButtonStrip(normalizeButtonSpec(msg.spec), msg.gap, msg.axis);
                park(strip);
            }
            else throw new Error('This studio has no strip to export.');
            if (steps) {
                let r = steps.next();
                let last = Date.now();
                while (!r.done) {
                    if (!strip) { strip = r.value.strip; park(strip); }
                    if (r.value.done % 8 === 0 || Date.now() - last > 60) {
                        say({ phase: 'build', done: r.value.done, total: r.value.total });
                        yield breathe();
                        last = Date.now();
                        if (job.cancel) {
                            strip.remove();
                            say({ phase: 'cancelled' });
                            return;
                        }
                    }
                    r = steps.next();
                }
                strip = r.value;
            }
            // Add Animation Strip: the same build with progress, then it
            // simply goes on the canvas
            if (msg.place) {
                applyExportScale(strip, x2);
                placeAtViewportCenter(strip);
                figma.currentPage.selection = [strip];
                figma.viewport.scrollAndZoomIntoView([strip]);
                say({ phase: 'done', placed: true, name: strip.name, frames: strip.children.length, width: Math.round(strip.width), height: Math.round(strip.height) });
                return;
            }
            say({ phase: 'export', x2 });
            yield breathe();
            if (job.cancel) {
                strip.remove();
                say({ phase: 'cancelled' });
                return;
            }
            // useAbsoluteBounds: the layout box, not the shadow-inflated one,
            // so frame i starts exactly at i × (cell + gap)
            const bytes = yield strip.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: x2 ? 2 : 1 }, useAbsoluteBounds: true });
            const fileName = strip.name + (x2 ? '@2x' : '') + '.png';
            const w = Math.round(strip.width * (x2 ? 2 : 1)), h = Math.round(strip.height * (x2 ? 2 : 1));
            if (msg.keep) {
                applyExportScale(strip, x2);
                placeAtViewportCenter(strip);
                figma.currentPage.selection = [strip];
                figma.viewport.scrollAndZoomIntoView([strip]);
            } else {
                strip.remove();
            }
            say({ phase: 'done', bytes, fileName, width: w, height: h, kept: !!msg.keep });
        } catch (e) {
            console.error('Error exporting studio strip:', e);
            if (strip && !strip.removed) {
                try { strip.remove(); } catch (err) { /* already gone */ }
            }
            say({ phase: 'error', error: String((e && e.message) || e) });
        } finally {
            if (stripExportJob === job) stripExportJob = null;
        }
    });
}

function placeAtViewportCenter(node) {
    node.x = Math.round(figma.viewport.center.x - node.width / 2);
    node.y = Math.round(figma.viewport.center.y - node.height / 2);
}

// Swap a knob or strip for a rebuilt one in the same spot and layer order
function replaceNode(oldNode, freshNode) {
    const parent = oldNode.parent;
    const index = parent.children.indexOf(oldNode);
    parent.insertChild(index, freshNode);
    freshNode.x = oldNode.x;
    freshNode.y = oldNode.y;
    oldNode.remove();
}

////////////////////////////////////////////////////////////////////////////
// Slider spec: the slider studio's model. A frame (`orient`, `length` and
// `thickness` in px) holding a track, a fill, a cap and optional ticks. Part
// sizes are in units where the frame's thickness is 100. Value 0 is at the
// bottom (vertical) or left (horizontal). A nonzero `curve` bends the travel
// into an arc of that many degrees. Keep in step with SliderCore in ui.html.
////////////////////////////////////////////////////////////////////////////
const SLIDER_SPEC_BASE = {
    name: 'Custom', tier: 'free', orient: 'v', length: 109, thickness: 21, curve: 0,
    track: { on: true, color: '#1C1C20', width: 16, radius: 50, inset: 0, edge: 0, edgeColor: '#000000' },
    fill: { on: true, style: 'bar', color: '#8A5CF6', gradient: false, c2: '#2A1C4A', width: 16, count: 16, gap: 6, opacity: 100, glow: 0, bipolar: false, ramp: 100, align: 'b' },
    cap: { shape: 'rect', width: 100, length: 44, radius: 12, fill: 'linear', c1: '#6A6A72', c2: '#34343A', angle: 90, edge: 0, edgeColor: '#000000', shadow: 0, dent: 0, grooves: 0, grooveColor: '#111111', mark: 'line', markColor: '#FFFFFF', markSize: 6, markInset: 12 },
    ticks: { on: false, count: 11, color: '#8C8898', side: 'both', length: 14, width: 3, gap: 6 }
};
const SLIDER_SPEC_LIMITS = {
    'length': [16, 1024], 'thickness': [6, 400], 'curve': [-150, 150],
    'track.width': [1, 100], 'track.radius': [0, 50], 'track.inset': [0, 200], 'track.edge': [0, 20],
    'fill.width': [1, 100], 'fill.count': [2, 64], 'fill.gap': [0, 40], 'fill.opacity': [0, 100], 'fill.glow': [0, 40], 'fill.ramp': [5, 100],
    'cap.width': [4, 100], 'cap.length': [2, 400], 'cap.radius': [0, 50], 'cap.angle': [0, 360], 'cap.edge': [0, 20],
    'cap.shadow': [0, 40], 'cap.dent': [0, 45], 'cap.grooves': [0, 12], 'cap.markSize': [1, 100], 'cap.markInset': [0, 50],
    'ticks.count': [2, 41], 'ticks.length': [1, 50], 'ticks.width': [0.5, 20], 'ticks.gap': [0, 50]
};
const SLIDER_SPEC_ENUMS = {
    'orient': ['v', 'h'],
    'fill.style': ['bar', 'segments'],
    'fill.align': ['a', 'center', 'b'],
    'cap.shape': ['rect', 'ellipse', 'none'],
    'cap.fill': ['solid', 'linear', 'radial', 'conic'],
    'cap.mark': ['none', 'line', 'dot'],
    'ticks.side': ['both', 'a', 'b']
};

function normalizeSliderSpec(raw) {
    return normalizeSpec(raw, SLIDER_SPEC_BASE, SLIDER_SPEC_LIMITS, SLIDER_SPEC_ENUMS);
}

// Below this many degrees a slider counts as straight
const SLIDER_MIN_CURVE = 0.5;
// Curved ends are round from this `track.radius` up, square below it
const SLIDER_ROUND_FROM = 25;

function sliderFrameSize(s) {
    return sliderGeometry(s).F;
}

// Furthest a box reaches along one axis, u along it and w across, when
// turned by anything from 0 to `turn` radians
function sliderArcReach(u, w, turn) {
    return Math.atan2(w, u) <= turn ? Math.hypot(u, w) : u * Math.cos(turn) + w * Math.sin(turn);
}

// Positions along the slider, in units: a0..a1 is the cap's travel, t0..t1
// the track, with a pixel of air at each end. A curved slider keeps these
// positions and maps them onto an arc whose chord is the frame length; the
// frame grows across to fit the bow. Same as SliderCore.geometry in ui.html.
function sliderGeometry(s) {
    const k = Math.round(s.thickness) / 100;
    const L = Math.round(s.length) / k;
    const pad = 1 / k;
    const capOn = s.cap.shape !== 'none';
    const capLen = capOn ? s.cap.length : 0;
    let t0 = Math.min(L / 2, pad + s.track.inset);
    let t1 = Math.max(L / 2, L - pad - s.track.inset);
    const th = Math.abs(s.curve) * Math.PI / 180;
    if (Math.abs(s.curve) < SLIDER_MIN_CURVE) {
        const F = s.orient === 'v'
            ? { w: Math.round(s.thickness), h: Math.round(s.length) }
            : { w: Math.round(s.length), h: Math.round(s.thickness) };
        let a0 = pad + capLen / 2;
        let a1 = L - pad - capLen / 2;
        if (a1 < a0) a0 = a1 = L / 2;
        return { F, k, L, a0, a1, t0, t1, mid: (a0 + a1) / 2, curved: false };
    }
    const sg = s.curve < 0 ? -1 : 1;
    const R = L / 2 / Math.sin(th / 2);
    const sag = R * (1 - Math.cos(th / 2));
    const cw = capOn ? s.cap.width : 0;
    // Toward the ends the cap is turned by up to th/2, so it reaches further
    const alongExt = sliderArcReach(capLen / 2, cw / 2, th / 2);
    const H = Math.max(50, sliderArcReach(cw / 2, capLen / 2, th / 2));
    const across = Math.max(1, Math.round((sag + 2 * H) * k));
    const F = s.orient === 'v' ? { w: across, h: Math.round(s.length) } : { w: Math.round(s.length), h: across };
    const phi0 = Math.asin(Math.max(-1, Math.min(1, (pad + alongExt - L / 2) / R)));
    let a0 = L * (phi0 / th + 0.5);
    let a1 = L - a0;
    if (a1 < a0) a0 = a1 = L / 2;
    // So does the track's outer corner, on the far side of the bend
    const hw = Math.max(s.track.width, s.fill.width) / 2;
    const phiT = Math.asin(Math.max(-1, Math.min(1, (L / 2 - pad - s.track.inset) / (R + hw))));
    t1 = Math.max(L / 2, L * (phiT / th + 0.5));
    t0 = L - t1;
    const cc = sg * (sag / 2 - R);
    const C = s.orient === 'v' ? { x: F.w / 2 + cc * k, y: F.h / 2 } : { x: F.w / 2, y: F.h / 2 + cc * k };
    const base = (s.orient === 'v' ? 0 : Math.PI / 2) + (sg < 0 ? Math.PI : 0);
    return { F, k, L, a0, a1, t0, t1, mid: (a0 + a1) / 2, curved: true, sg, R, th, C, base, dir: -sg, m: R * th / L };
}

// Screen angle (y down, clockwise), from the circle center, of position a
function sliderArcAngle(G, a) {
    return G.base + G.dir * (a / G.L - 0.5) * G.th;
}

function sliderArcPoint(G, a, c) {
    const psi = sliderArcAngle(G, a);
    const r = (G.R + G.sg * (c || 0)) * G.k;
    return { x: G.C.x + r * Math.cos(psi), y: G.C.y + r * Math.sin(psi), psi, rot: psi - G.base };
}

// A curved band along [a0, a1] and across [c0, c1], in frame px around G.C.
// Round ends of radius hr sit inside the span, like a pill's.
function sliderArcBand(G, a0, a1, c0, c1, round) {
    const rA = (G.R + G.sg * c0) * G.k;
    const rB = (G.R + G.sg * c1) * G.k;
    const rOut = Math.max(rA, rB);
    const rIn = Math.max(0, Math.min(rA, rB));
    const rMid = (rOut + rIn) / 2;
    const hr = round ? (rOut - rIn) / 2 : 0;
    const p = sliderArcAngle(G, a0);
    const q = sliderArcAngle(G, a1);
    let lo = Math.min(p, q);
    let hi = Math.max(p, q);
    if (hr > 0 && rMid > 0) {
        lo += hr / rMid;
        hi -= hr / rMid;
        if (lo > hi) lo = hi = (lo + hi) / 2;
    }
    return { lo, hi, rIn, rOut, rMid, hr };
}

// Figma nodes for a band: a ring sector plus a circle at each round end.
// `inset` px shrinks it evenly, for an edge drawn as a band under a band.
function sliderBandNodes(ctx, name, bd, inset) {
    const G = ctx.G;
    const e = inset || 0;
    const rOut = bd.rOut - e;
    const rIn = Math.min(rOut, bd.rIn + e);
    const hr = bd.hr > 0 ? Math.max(0, bd.hr - e) : 0;
    let lo = bd.lo;
    let hi = bd.hi;
    if (!bd.hr && e > 0 && bd.rMid > 0) {
        lo += e / bd.rMid;
        hi -= e / bd.rMid;
    }
    const out = [];
    if (rOut <= 0) return out;
    if (hi - lo > 0.0001) {
        const n = figma.createEllipse();
        ctx.f.appendChild(n);
        n.name = name;
        n.resize(2 * rOut, 2 * rOut);
        n.x = G.C.x - rOut;
        n.y = G.C.y - rOut;
        n.arcData = { startingAngle: lo, endingAngle: hi, innerRadius: Math.max(0, Math.min(0.999, rIn / rOut)) };
        out.push(n);
    }
    if (hr > 0) {
        [lo, hi].forEach((a, i) => {
            const n = figma.createEllipse();
            ctx.f.appendChild(n);
            n.name = name + (i ? '_end' : '_start');
            n.resize(Math.max(0.01, 2 * hr), Math.max(0.01, 2 * hr));
            n.x = G.C.x + bd.rMid * Math.cos(a) - hr;
            n.y = G.C.y + bd.rMid * Math.sin(a) - hr;
            out.push(n);
        });
    }
    return out;
}

// A track-shaped bar along [a0, a1] and across [c0, c1], as Figma nodes
function sliderBarNodes(ctx, name, a0, a1, c0, c1, r) {
    const s = ctx.s;
    const G = ctx.G;
    if (G.curved) return sliderBandNodes(ctx, name, sliderArcBand(G, a0, a1, c0, c1, s.track.radius >= SLIDER_ROUND_FROM));
    return [sliderShape(ctx, name, sliderBox(s, G, a0, a1, c0, c1), 'rect', r === undefined ? s.track.radius / 100 * (c1 - c0) * G.k : r)];
}

// Across span of segment i: stepped up by fill.ramp, like a volume icon
function sliderSegSpan(s, i, n) {
    return rampSpan(s.fill.ramp, s.fill.align, -s.fill.width / 2, s.fill.width / 2, i, n);
}

// Ramped segments all share one corner radius (px), from the full-size
// segment's shorter side; undefined keeps the track's rule
function sliderSegRadius(s, G, sg) {
    return s.fill.ramp < 100 ? s.track.radius / 100 * Math.min(sg.a1 - sg.a0, s.fill.width) * G.k : undefined;
}

// The cap's dished face: its box inset by cap.dent units, or null
function sliderDentBox(s, b, k) {
    const d = Math.min(s.cap.dent * k, b.w / 2 - 0.5, b.h / 2 - 0.5);
    if (!(s.cap.dent > 0) || d <= 0) return null;
    return { x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d };
}

// Moves nodes drawn where a straight slider's cap would be onto the arc,
// turned with it (same as SliderCore.capPlacement in ui.html)
function sliderCapPlacement(s, G, v) {
    const av = sliderValuePos(G, v);
    const q = sliderArcPoint(G, av);
    const p0 = sliderBox(s, G, av, av, 0, 0);
    const cos = Math.cos(q.rot);
    const sin = Math.sin(q.rot);
    return {
        rot: q.rot, deg: q.rot * 180 / Math.PI,
        place(n) {
            const x = n.x - p0.x;
            const y = n.y - p0.y;
            n.relativeTransform = [
                [cos, -sin, q.x + cos * x - sin * y],
                [sin, cos, q.y + sin * x + cos * y]
            ];
        }
    };
}

function sliderValuePos(G, v) {
    return G.a0 + (G.a1 - G.a0) * v;
}

function sliderSegments(s, G) {
    const n = Math.round(s.fill.count);
    const len = Math.max(0.5, (G.t1 - G.t0 - (n - 1) * s.fill.gap) / n);
    const out = [];
    for (let i = 0; i < n; i++) {
        const a0 = G.t0 + i * (len + s.fill.gap);
        out.push({ a0, a1: a0 + len, mid: a0 + len / 2, t: n === 1 ? 1 : i / (n - 1) });
    }
    return out;
}

function sliderSegmentLit(s, G, seg, v) {
    const av = sliderValuePos(G, v);
    if (s.fill.bipolar) return seg.mid >= Math.min(G.mid, av) - 0.01 && seg.mid <= Math.max(G.mid, av) + 0.01;
    return seg.mid <= av + 0.01;
}

// Frame-px rectangle for along [a0, a1] and across [c0, c1], in units
function sliderBox(s, G, a0, a1, c0, c1) {
    const k = G.k;
    if (s.orient === 'v') return { x: G.F.w / 2 + c0 * k, y: G.F.h - a1 * k, w: (c1 - c0) * k, h: (a1 - a0) * k };
    return { x: a0 * k, y: G.F.h / 2 + c0 * k, w: (a1 - a0) * k, h: (c1 - c0) * k };
}

function sliderTickSpans(s) {
    const t = s.ticks;
    const inner = s.track.width / 2 + t.gap;
    const out = [];
    if (t.side !== 'b') out.push([-(inner + t.length), -inner]);
    if (t.side !== 'a') out.push([inner, inner + t.length]);
    return out;
}

function sliderLerpHex(a, b, t) {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    return { r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t };
}

// Linear gradient from frame-px point p0 (color a) to p1 (color b), on an
// unrotated node. Figma maps the node's 0..1 box into gradient space, where
// the colors run along x.
function sliderLinearPaint(n, p0, p1, a, b) {
    const w = Math.max(0.01, n.width);
    const h = Math.max(0.01, n.height);
    const u0 = { x: (p0.x - n.x) / w, y: (p0.y - n.y) / h };
    const u1 = { x: (p1.x - n.x) / w, y: (p1.y - n.y) / h };
    const dx = u1.x - u0.x;
    const dy = u1.y - u0.y;
    const d2 = Math.max(1e-9, dx * dx + dy * dy);
    const r0 = [dx / d2, dy / d2];
    const r1 = [-dy / d2, dx / d2];
    return {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [
            [r0[0], r0[1], -(r0[0] * u0.x + r0[1] * u0.y)],
            [r1[0], r1[1], 0.5 - (r1[0] * u0.x + r1[1] * u0.y)]
        ],
        gradientStops: [
            { position: 0, color: Object.assign(hexToRgb(a), { a: 1 }) },
            { position: 1, color: Object.assign(hexToRgb(b), { a: 1 }) }
        ]
    };
}

function sliderShape(ctx, name, b, kind, radius) {
    const n = kind === 'ellipse' ? figma.createEllipse() : figma.createRectangle();
    ctx.f.appendChild(n);
    n.name = name;
    n.resize(Math.max(0.01, b.w), Math.max(0.01, b.h));
    n.x = b.x;
    n.y = b.y;
    if (kind !== 'ellipse' && radius > 0) n.cornerRadius = Math.min(radius, b.w / 2, b.h / 2);
    return n;
}

function sliderBuildTicks(ctx) {
    const s = ctx.s;
    if (!s.ticks.on) return null;
    const G = ctx.G;
    const n = Math.round(s.ticks.count);
    const nodes = [];
    for (let i = 0; i < n; i++) {
        const a = G.a0 + (G.a1 - G.a0) * i / (n - 1);
        sliderTickSpans(s).forEach((span, j) => {
            const name = 'tick_' + (i + 1) + (j ? 'b' : 'a');
            let tick;
            if (G.curved) {
                // Along the radius, like a knob's scale
                const bd = sliderArcBand(G, a, a, span[0], span[1], false);
                tick = figma.createRectangle();
                ctx.f.appendChild(tick);
                tick.name = name;
                const len = Math.max(0.01, bd.rOut - bd.rIn);
                const w = Math.max(0.01, s.ticks.width * G.k);
                tick.resize(len, w);
                const cos = Math.cos(bd.lo);
                const sin = Math.sin(bd.lo);
                tick.relativeTransform = [
                    [cos, -sin, G.C.x + bd.rIn * cos + sin * w / 2],
                    [sin, cos, G.C.y + bd.rIn * sin - cos * w / 2]
                ];
            } else {
                tick = sliderShape(ctx, name, sliderBox(s, G, a - s.ticks.width / 2, a + s.ticks.width / 2, span[0], span[1]), 'rect', 0);
            }
            tick.fills = knobSolid(s.ticks.color);
            nodes.push(tick);
        });
    }
    return knobGroupOf(ctx, 'ticks', nodes);
}

function sliderBuildTrack(ctx) {
    const s = ctx.s;
    const t = s.track;
    const G = ctx.G;
    if (!t.on) return null;
    if (s.fill.on && s.fill.style === 'segments') {
        // Unlit segments stand in for the track
        const nodes = [];
        const segs = sliderSegments(s, G);
        segs.forEach((sg, i) => {
            const q = sliderSegSpan(s, i, segs.length);
            sliderBarNodes(ctx, 'segment_' + (i + 1), sg.a0, sg.a1, q[0], q[1], sliderSegRadius(s, G, sg)).forEach(seg => {
                seg.fills = knobSolid(t.color);
                nodes.push(seg);
            });
        });
        return knobGroupOf(ctx, 'track', nodes);
    }
    if (G.curved) {
        // An edge is the same band in the edge color, under a band inset by the edge
        const bd = sliderArcBand(G, G.t0, G.t1, -t.width / 2, t.width / 2, t.radius >= SLIDER_ROUND_FROM);
        const e = Math.min(t.edge * G.k, (bd.rOut - bd.rIn) / 2);
        const nodes = [];
        if (e > 0) sliderBandNodes(ctx, 'track_edge', bd, 0).forEach(n => { n.fills = knobSolid(t.edgeColor); nodes.push(n); });
        sliderBandNodes(ctx, 'track', bd, e).forEach(n => { n.fills = knobSolid(t.color); nodes.push(n); });
        return knobGroupOf(ctx, 'track', nodes);
    }
    const track = sliderShape(ctx, 'track', sliderBox(s, G, G.t0, G.t1, -t.width / 2, t.width / 2), 'rect', t.radius / 100 * t.width * G.k);
    track.fills = knobSolid(t.color);
    knobEdge(track, t.edge * G.k, t.edgeColor);
    return track;
}

function sliderBuildFill(ctx, v) {
    const s = ctx.s;
    const f = s.fill;
    const G = ctx.G;
    if (!f.on) return null;
    const r = s.track.radius / 100 * f.width * G.k;
    let nodes = [];
    if (f.style === 'segments') {
        const segs = sliderSegments(s, G);
        segs.forEach((sg, i) => {
            if (!sliderSegmentLit(s, G, sg, v)) return;
            const color = f.gradient ? sliderLerpHex(f.c2, f.color, sg.t) : hexToRgb(f.color);
            const q = sliderSegSpan(s, i, segs.length);
            sliderBarNodes(ctx, 'lit_' + (i + 1), sg.a0, sg.a1, q[0], q[1], sliderSegRadius(s, G, sg)).forEach(seg => {
                seg.fills = [{ type: 'SOLID', color }];
                nodes.push(seg);
            });
        });
    } else if (G.curved) {
        const av = sliderValuePos(G, v);
        const f0 = f.bipolar ? Math.min(G.mid, av) : G.t0;
        const f1 = f.bipolar ? Math.max(G.mid, av) : av;
        if (f1 - f0 > 0.01) {
            const bd = sliderArcBand(G, f0, f1, -f.width / 2, f.width / 2, s.track.radius >= SLIDER_ROUND_FROM);
            const p0 = sliderArcPoint(G, G.t0);
            const p1 = sliderArcPoint(G, G.t1);
            sliderBandNodes(ctx, 'fill', bd, 0).forEach(n => {
                if (!f.gradient) {
                    n.fills = knobSolid(f.color);
                } else if (n.name === 'fill') {
                    n.fills = [sliderLinearPaint(n, p0, p1, f.c2, f.color)];
                } else {
                    // A round end takes the gradient's color where it sits
                    const cx = n.x + n.width / 2;
                    const cy = n.y + n.height / 2;
                    const dx = p1.x - p0.x;
                    const dy = p1.y - p0.y;
                    const t = Math.max(0, Math.min(1, ((cx - p0.x) * dx + (cy - p0.y) * dy) / Math.max(1e-6, dx * dx + dy * dy)));
                    n.fills = [{ type: 'SOLID', color: sliderLerpHex(f.c2, f.color, t) }];
                }
                nodes.push(n);
            });
        }
    } else {
        const av = sliderValuePos(G, v);
        const f0 = f.bipolar ? Math.min(G.mid, av) : G.t0;
        const f1 = f.bipolar ? Math.max(G.mid, av) : av;
        if (f1 - f0 > 0.01) {
            const bar = sliderShape(ctx, 'fill', sliderBox(s, G, f0, f1, -f.width / 2, f.width / 2), 'rect', r);
            if (f.gradient) {
                // Fixed along the whole track: map the node's box onto the track span
                const T = G.t1 - G.t0;
                const sc = (f1 - f0) / T;
                const o = (f0 - G.t0) / T;
                const m = s.orient === 'v' ? [[0, -sc, o + sc], [1, 0, 0]] : [[sc, 0, o], [0, 1, 0]];
                bar.fills = [{
                    type: 'GRADIENT_LINEAR',
                    gradientTransform: m,
                    gradientStops: [
                        { position: 0, color: Object.assign(hexToRgb(f.c2), { a: 1 }) },
                        { position: 1, color: Object.assign(hexToRgb(f.color), { a: 1 }) }
                    ]
                }];
            } else {
                bar.fills = knobSolid(f.color);
            }
            nodes.push(bar);
        }
    }
    if (f.glow > 0) nodes.forEach(n => { n.effects = [knobGlowEffect(f.color, f.glow * G.k)]; });
    const g = knobGroupOf(ctx, 'fill', nodes);
    if (g && f.opacity < 100) g.opacity = f.opacity / 100;
    return g;
}

function sliderBuildCap(ctx, v) {
    const s = ctx.s;
    const c = s.cap;
    const G = ctx.G;
    if (c.shape === 'none') return null;
    const av = sliderValuePos(G, v);
    // On a curve the cap is built as if straight, then turned onto the arc;
    // the light and shadow are turned back so the lighting stays fixed
    const turn = G.curved ? sliderCapPlacement(s, G, v) : null;
    const b = sliderBox(s, G, av - c.length / 2, av + c.length / 2, -c.width / 2, c.width / 2);
    const body = sliderShape(ctx, 'cap_body', b, c.shape === 'ellipse' ? 'ellipse' : 'rect', c.radius / 100 * Math.min(b.w, b.h));
    body.fills = knobPaints(c.fill, c.c1, c.c2, c.angle - (turn ? turn.deg : 0));
    knobEdge(body, c.edge * G.k, c.edgeColor);
    if (c.shadow > 0) {
        const oy = c.shadow * G.k * 0.35;
        const shift = turn ? [oy * Math.sin(turn.rot), oy * Math.cos(turn.rot)] : undefined;
        body.effects = [knobShadowEffect(c.shadow * G.k, 45, shift)];
    }
    const nodes = [body];
    // A dished top: an inset face with the colors swapped, so it reads as concave
    const db = sliderDentBox(s, b, G.k);
    if (db) {
        const dent = sliderShape(ctx, 'cap_dent', db, c.shape === 'ellipse' ? 'ellipse' : 'rect', c.radius / 100 * Math.min(db.w, db.h));
        dent.fills = knobPaints(c.fill, c.c2, c.c1, c.angle - (turn ? turn.deg : 0));
        nodes.push(dent);
    }
    const n = Math.round(c.grooves);
    const gt = Math.max(1 / G.k, c.length * 0.035);
    for (let i = 0; i < n; i++) {
        const a = av - c.length * 0.35 + c.length * 0.7 * (n === 1 ? 0.5 : i / (n - 1));
        const groove = sliderShape(ctx, 'groove_' + (i + 1), sliderBox(s, G, a - gt / 2, a + gt / 2, -c.width * 0.4, c.width * 0.4), 'rect', 0);
        groove.fills = knobSolid(c.grooveColor);
        nodes.push(groove);
    }
    if (c.mark === 'line') {
        const mb = sliderBox(s, G, av - c.markSize / 2, av + c.markSize / 2, -c.width / 2 + c.markInset, c.width / 2 - c.markInset);
        const mark = sliderShape(ctx, 'cap_mark', mb, 'rect', Math.min(mb.w, mb.h) / 2);
        mark.fills = knobSolid(c.markColor);
        nodes.push(mark);
    } else if (c.mark === 'dot') {
        const mark = sliderShape(ctx, 'cap_mark', sliderBox(s, G, av - c.markSize / 2, av + c.markSize / 2, -c.markSize / 2, c.markSize / 2), 'ellipse', 0);
        mark.fills = knobSolid(c.markColor);
        nodes.push(mark);
    }
    if (turn) nodes.forEach(n => turn.place(n));
    return knobGroupOf(ctx, 'cap', nodes);
}

// Bottom to top; fixed layers are cloned from the first frame of a strip
const SLIDER_LAYERS = [
    { fixed: true, build: sliderBuildTicks },
    { fixed: true, build: sliderBuildTrack },
    { fixed: false, build: sliderBuildFill },
    { fixed: false, build: sliderBuildCap }
];

function createSpecSliderFrame(s, v, name, template) {
    const G = sliderGeometry(s);
    const f = figma.createFrame();
    f.name = name;
    f.resize(G.F.w, G.F.h);
    f.fills = [];
    f.clipsContent = true;
    const ctx = { s, f, G };
    const fixed = [];
    SLIDER_LAYERS.forEach((layer, i) => {
        let node = null;
        if (layer.fixed && template) {
            const src = template[i];
            if (src) {
                node = src.clone();
                f.appendChild(node);
                node.x = src.x;
                node.y = src.y;
            }
        } else {
            node = layer.build(ctx, v);
        }
        if (layer.fixed) fixed[i] = node;
    });
    return { frame: f, fixed };
}

function createSpecSlider(s, value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    const slider = createSpecSliderFrame(s, v, 'Slider · ' + s.name).frame;
    slider.setPluginData('sliderSpec', JSON.stringify(s));
    slider.setPluginData('sliderKind', 'slider');
    slider.setPluginData('sliderValue', String(v));
    return slider;
}

// Frame 0 at the minimum. Named "…_128f" for Vellum and the Preview tab.
function createSpecSliderStrip(s, frames, gap, axis) {
    return runStripSteps(sliderStripSteps(s, frames, gap, axis));
}

function* sliderStripSteps(s, frames, gap, axis) {
    frames = Math.max(2, Math.min(256, Math.round(Number(frames) || 128)));
    gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
    axis = axis === 'h' ? 'h' : 'v';
    const F = sliderFrameSize(s);
    const strip = figma.createFrame();
    strip.name = 'slider_sprite_' + frames + 'f';
    strip.resize(
        axis === 'v' ? F.w : frames * F.w + (frames - 1) * gap,
        axis === 'v' ? frames * F.h + (frames - 1) * gap : F.h
    );
    strip.fills = [];
    strip.clipsContent = true;
    let template = null;
    for (let i = 0; i < frames; i++) {
        const built = createSpecSliderFrame(s, stripFrameValue(i, frames, s.fill.bipolar), 'frame_' + String(i).padStart(3, '0'), template);
        if (!template) template = built.fixed;
        strip.appendChild(built.frame);
        built.frame.x = axis === 'v' ? 0 : i * (F.w + gap);
        built.frame.y = axis === 'v' ? i * (F.h + gap) : 0;
        yield { strip, done: i + 1, total: frames };
    }
    strip.setPluginData('sliderSpec', JSON.stringify(s));
    strip.setPluginData('sliderKind', 'strip');
    strip.setPluginData('sliderStrip', JSON.stringify({ frames, gap, axis }));
    return strip;
}

////////////////////////////////////////////////////////////////////////////
// Button spec: the button studio's model. A `width`×`height` px frame with a
// body, an optional inner face, a sliding thumb, a label (text or a power
// icon) and an LED, drawn off (frame 0) or on (frame 1), the two frames
// Vellum reads from a button skin. Part sizes are in units where the frame's
// shorter side is 100, measured from the frame's center. Keep in step with
// ButtonCore in ui.html.
////////////////////////////////////////////////////////////////////////////
const BUTTON_SPEC_BASE = {
    name: 'Custom', tier: 'free', width: 80, height: 32,
    body: { shape: 'rect', radius: 20, fill: 'linear', c1: '#3A3A42', c2: '#26262C', angle: 90, onChange: true, onC1: '#8A5CF6', onC2: '#6A3FD8', edge: 0, edgeColor: '#111114', shadow: 0, press: 0, glow: 0 },
    face: { on: false, inset: 10, radius: 16, fill: 'linear', c1: '#4A4A52', c2: '#2E2E34', angle: 90, onChange: false, onC1: '#9A70FF', onC2: '#6A3FD8', edge: 0, edgeColor: '#000000', shadow: 0 },
    thumb: { on: false, length: 50, inset: 8, radius: 50, fill: 'linear', c1: '#F2F2F2', c2: '#BDBDC4', angle: 90, edge: 0, edgeColor: '#000000', shadow: 6 },
    label: { kind: 'text', text: 'BYPASS', onText: '', size: 34, bold: true, color: '#B4B0C0', onColor: '#FFFFFF', glow: 0, place: 'center', x: 0, y: 0 },
    led: { on: false, shape: 'dot', pos: 'left', size: 16, length: 50, inset: 18, x: 0, y: 0, offColor: '#3A2A2E', onColor: '#FF4A3D', glow: 8, lens: 0, socket: 0, socketC1: '#5A5A62', socketC2: '#F4F4F6' }
};
const BUTTON_SPEC_LIMITS = {
    'width': [8, 600], 'height': [8, 600],
    'body.radius': [0, 50], 'body.angle': [0, 360], 'body.edge': [0, 20], 'body.shadow': [0, 40], 'body.press': [0, 20], 'body.glow': [0, 40],
    'face.inset': [0, 50], 'face.radius': [0, 50], 'face.angle': [0, 360], 'face.edge': [0, 20], 'face.shadow': [0, 40],
    'thumb.length': [10, 100], 'thumb.inset': [0, 50], 'thumb.radius': [0, 50], 'thumb.angle': [0, 360], 'thumb.edge': [0, 20], 'thumb.shadow': [0, 40],
    'label.size': [4, 200], 'label.glow': [0, 40], 'label.x': [-300, 300], 'label.y': [-300, 300],
    'led.size': [2, 100], 'led.length': [2, 300], 'led.inset': [0, 300], 'led.glow': [0, 40], 'led.lens': [0, 100], 'led.x': [-300, 300], 'led.y': [-300, 300], 'led.socket': [0, 50]
};
const BUTTON_SPEC_ENUMS = {
    'body.shape': ['rect', 'ellipse'],
    'body.fill': ['solid', 'linear', 'radial', 'conic'],
    'face.fill': ['solid', 'linear', 'radial', 'conic'],
    'thumb.fill': ['solid', 'linear', 'radial', 'conic'],
    'label.kind': ['text', 'power', 'none'],
    'label.place': ['center', 'free'],
    'led.shape': ['dot', 'bar'],
    'led.pos': ['left', 'right', 'top', 'bottom', 'center', 'below', 'above', 'leftOf', 'rightOf']
};

function normalizeButtonSpec(raw) {
    return normalizeSpec(raw, BUTTON_SPEC_BASE, BUTTON_SPEC_LIMITS, BUTTON_SPEC_ENUMS);
}

function buttonFrameSize(s) {
    return { w: Math.round(s.width), h: Math.round(s.height) };
}

// Every box is { x, y, w, h } in units from the frame's center. `on` shrinks the
// face and sinks the label by body.press, and slides the thumb to the right.
function buttonGeometry(s, on) {
    const F = buttonFrameSize(s);
    const k = Math.min(F.w, F.h) / 100;
    const hw = F.w / 2 / k;
    const hh = F.h / 2 / k;
    // A pixel of air, plus room for the shadow or glow so frames don't clip them
    const m = 1 / k + Math.max(s.body.shadow, s.body.glow) * 0.9;
    const d = s.led;
    const across = d.pos === 'left' || d.pos === 'right' || d.pos === 'leftOf' || d.pos === 'rightOf';
    const lw = d.shape === 'bar' ? (across ? d.size : d.length) : d.size;
    const lh = d.shape === 'bar' ? (across ? d.length : d.size) : d.size;
    // A panel LED (below, above, left of or right of) sits off the button, so the body gives up a band of the frame to it
    const outside = d.on && ['below', 'above', 'leftOf', 'rightOf'].includes(d.pos);
    // Moving the LED away from the button (Move X/Y) makes room too
    const away = { below: d.y, above: -d.y, leftOf: -d.x, rightOf: d.x }[d.pos] || 0;
    const room = outside ? Math.max(m, d.inset + away + (across ? lw : lh) / 2 + Math.max(d.socket, d.glow * 0.5) + 1 / k) : m;
    const mt = outside && d.pos === 'above' ? room : m;
    const mb = outside && d.pos === 'below' ? room : m;
    const ml = outside && d.pos === 'leftOf' ? room : m;
    const mr = outside && d.pos === 'rightOf' ? room : m;
    const bw = Math.max(1, 2 * hw - ml - mr);
    const bh = Math.max(1, 2 * hh - mt - mb);
    const body = { x: outside ? -hw + ml : -bw / 2, y: outside ? -hh + mt : -bh / 2, w: bw, h: bh };
    const bcx = body.x + bw / 2;
    const bcy = body.y + bh / 2;
    const dy = on ? s.body.press : 0;
    // A pressed face shrinks in place, like it's pushed away from you
    const fi = Math.min(s.face.inset + dy, bw / 2 - 0.5, bh / 2 - 0.5);
    const face = { x: body.x + fi, y: body.y + fi, w: bw - 2 * fi, h: bh - 2 * fi };
    const ti = Math.min(s.thumb.inset, bw / 2 - 0.5, bh / 2 - 0.5);
    const tl = (bw - 2 * ti) * s.thumb.length / 100;
    const thumb = { x: on ? body.x + bw - ti - tl : body.x + ti, y: body.y + ti, w: tl, h: bh - 2 * ti };
    // Label center: the middle, or the middle of the space the thumb leaves
    let lx = bcx;
    if (s.thumb.on && s.label.place === 'free') {
        lx = on ? (body.x + thumb.x) / 2 : (thumb.x + thumb.w + body.x + bw) / 2;
    }
    const label = { cx: lx + s.label.x, cy: bcy + s.label.y + dy };
    // The LED sits on the body, which doesn't move when pressed
    const ledAt = {
        left: [body.x + d.inset, bcy], right: [body.x + bw - d.inset, bcy],
        top: [bcx, body.y + d.inset], bottom: [bcx, body.y + bh - d.inset], center: [bcx, bcy],
        below: [bcx, body.y + bh + d.inset], above: [bcx, body.y - d.inset],
        leftOf: [body.x - d.inset, bcy], rightOf: [body.x + bw + d.inset, bcy]
    }[d.pos];
    const led = { x: ledAt[0] + d.x - lw / 2, y: ledAt[1] + d.y - lh / 2, w: lw, h: lh };
    return { F, k, hw, hh, body, face, thumb, label, led };
}

// Units box → frame px
function buttonPx(G, b) {
    return { x: (b.x + G.hw) * G.k, y: (b.y + G.hh) * G.k, w: b.w * G.k, h: b.h * G.k };
}

// Power symbol: a ring open at the top with round ends, and a bar through the gap
const BUTTON_POWER_GAP = 40; // degrees either side of 12 o'clock
function buttonPowerParts(size) {
    const R = size / 2;
    const sw = size * 0.14;
    return { R, sw, from: 270 + BUTTON_POWER_GAP, to: 270 - BUTTON_POWER_GAP + 360, barTop: -R * 1.08, barBottom: -R * 0.12 };
}

function buttonShapeRadius(b, pct) {
    return pct / 100 * Math.min(b.w, b.h);
}

function buttonBuildBody(ctx) {
    const s = ctx.s, G = ctx.G, b = s.body;
    const box = buttonPx(G, G.body);
    const n = sliderShape(ctx, 'body', box, b.shape === 'ellipse' ? 'ellipse' : 'rect', buttonShapeRadius(box, b.radius));
    const lit = ctx.on && b.onChange;
    n.fills = knobPaints(b.fill, lit ? b.onC1 : b.c1, lit ? b.onC2 : b.c2, b.angle);
    knobEdge(n, b.edge * G.k, b.edgeColor);
    const fx = [];
    const shadow = ctx.on && b.press > 0 ? b.shadow * 0.4 : b.shadow;
    if (shadow > 0) fx.push(knobShadowEffect(shadow * G.k, 45));
    if (ctx.on && b.glow > 0) fx.push(knobGlowEffect(b.onChange ? b.onC1 : b.c1, b.glow * G.k));
    n.effects = fx;
    return n;
}

function buttonBuildFace(ctx) {
    const s = ctx.s, G = ctx.G, f = s.face;
    if (!f.on) return null;
    const box = buttonPx(G, G.face);
    const n = sliderShape(ctx, 'face', box, s.body.shape === 'ellipse' ? 'ellipse' : 'rect', buttonShapeRadius(box, f.radius));
    const lit = ctx.on && f.onChange;
    n.fills = knobPaints(f.fill, lit ? f.onC1 : f.c1, lit ? f.onC2 : f.c2, f.angle);
    knobEdge(n, f.edge * G.k, f.edgeColor);
    const shadow = ctx.on && s.body.press > 0 ? f.shadow * 0.4 : f.shadow;
    if (shadow > 0) n.effects = [knobShadowEffect(shadow * G.k, 45)];
    return n;
}

function buttonBuildThumb(ctx) {
    const s = ctx.s, G = ctx.G, t = s.thumb;
    if (!t.on) return null;
    const box = buttonPx(G, G.thumb);
    const n = sliderShape(ctx, 'thumb', box, 'rect', buttonShapeRadius(box, t.radius));
    n.fills = knobPaints(t.fill, t.c1, t.c2, t.angle);
    knobEdge(n, t.edge * G.k, t.edgeColor);
    if (t.shadow > 0) n.effects = [knobShadowEffect(t.shadow * G.k, 45)];
    return n;
}

// A ring around the LED, dark at the top and light at the bottom, so it reads as sunk in
function buttonBuildLedSocket(ctx) {
    const s = ctx.s, G = ctx.G, d = s.led;
    if (!d.on || d.socket <= 0) return null;
    const led = G.led;
    const box = buttonPx(G, { x: led.x - d.socket, y: led.y - d.socket, w: led.w + 2 * d.socket, h: led.h + 2 * d.socket });
    const n = sliderShape(ctx, 'led_socket', box, d.shape === 'dot' ? 'ellipse' : 'rect', Math.min(box.w, box.h) / 2);
    n.fills = knobPaints('linear', d.socketC1, d.socketC2, 90);
    return n;
}

function buttonBuildLed(ctx) {
    const s = ctx.s, G = ctx.G, d = s.led;
    if (!d.on) return null;
    const box = buttonPx(G, G.led);
    const n = sliderShape(ctx, 'led', box, d.shape === 'dot' ? 'ellipse' : 'rect', Math.min(box.w, box.h) / 2);
    const col = ctx.on ? d.onColor : d.offColor;
    // Lens: a hot spot toward the top, hotter when lit
    n.fills = d.lens > 0 ? knobPaints('radial', meterLerpHex(col, '#FFFFFF', d.lens / 100 * (ctx.on ? 0.75 : 0.35)), col, 90) : knobSolid(col);
    if (ctx.on && d.glow > 0) n.effects = [knobGlowEffect(d.onColor, d.glow * G.k)];
    return n;
}

function buttonBuildLabel(ctx) {
    const s = ctx.s, G = ctx.G, l = s.label;
    const color = ctx.on ? l.onColor : l.color;
    const glow = ctx.on && l.glow > 0 ? [knobGlowEffect(l.onColor, l.glow * G.k)] : [];
    const cx = (G.label.cx + G.hw) * G.k;
    const cy = (G.label.cy + G.hh) * G.k;
    if (l.kind === 'power') {
        const P = buttonPowerParts(l.size);
        const kc = { f: ctx.f, c: 0, k: G.k };
        const nodes = [];
        const ring = knobSector(kc, 'ring', P.R - P.sw, P.R, P.from, P.to);
        nodes.push(ring);
        [P.from, P.to].forEach((deg, i) => nodes.push(knobCircleAt(kc, i ? 'ring_end' : 'ring_start', P.R - P.sw / 2, deg, P.sw / 2)));
        const bar = sliderShape(ctx, 'bar', { x: -P.sw / 2 * G.k, y: P.barTop * G.k, w: P.sw * G.k, h: (P.barBottom - P.barTop) * G.k }, 'rect', P.sw / 2 * G.k);
        nodes.push(bar);
        // knobCircleAt places around ctx.c; shift everything onto the label center
        nodes.forEach(n => {
            n.fills = knobSolid(color);
            n.x += cx;
            n.y += cy;
        });
        const g = knobGroupOf(ctx, 'label', nodes);
        g.effects = glow;
        return g;
    }
    const text = ctx.on && l.onText ? l.onText : l.text;
    if (l.kind !== 'text' || !text || !ctx.font) return null;
    const t = figma.createText();
    ctx.f.appendChild(t);
    t.name = 'label';
    t.fontName = ctx.font;
    t.fontSize = Math.max(1, l.size * G.k);
    t.characters = text;
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    t.textAlignHorizontal = 'CENTER';
    t.fills = knobSolid(color);
    t.effects = glow;
    t.x = cx - t.width / 2;
    t.y = cy - t.height / 2;
    return t;
}

// Bottom to top
const BUTTON_LAYERS = [buttonBuildBody, buttonBuildFace, buttonBuildThumb, buttonBuildLedSocket, buttonBuildLed, buttonBuildLabel];

// Inter ships with Figma; without it the label is left out rather than failing the build
function buttonLoadFont(s) {
    return __awaiter(this, void 0, void 0, function* () {
        const needs = s.label.kind === 'text' && (s.label.text || s.label.onText);
        if (!needs) return null;
        const font = { family: 'Inter', style: s.label.bold ? 'Bold' : 'Regular' };
        try {
            yield figma.loadFontAsync(font);
            return font;
        } catch (e) {
            return null;
        }
    });
}

function createSpecButtonFrame(s, on, name, font) {
    const G = buttonGeometry(s, on);
    const f = figma.createFrame();
    f.name = name;
    f.resize(G.F.w, G.F.h);
    f.fills = [];
    f.clipsContent = true;
    const ctx = { s, f, G, on, font };
    BUTTON_LAYERS.forEach(build => build(ctx));
    return f;
}

function createSpecButton(s, value) {
    return __awaiter(this, void 0, void 0, function* () {
        const on = Number(value) >= 0.5;
        const font = yield buttonLoadFont(s);
        const button = createSpecButtonFrame(s, on, 'Button · ' + s.name, font);
        button.setPluginData('buttonSpec', JSON.stringify(s));
        button.setPluginData('buttonKind', 'button');
        button.setPluginData('buttonValue', on ? '1' : '0');
        return button;
    });
}

// Two frames, off then on, named "…_2f" so Vellum reads it as a button skin
function createSpecButtonStrip(s, gap, axis) {
    return __awaiter(this, void 0, void 0, function* () {
        gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
        axis = axis === 'h' ? 'h' : 'v';
        const F = buttonFrameSize(s);
        const font = yield buttonLoadFont(s);
        const strip = figma.createFrame();
        strip.name = 'button_sprite_2f';
        strip.resize(axis === 'v' ? F.w : 2 * F.w + gap, axis === 'v' ? 2 * F.h + gap : F.h);
        strip.fills = [];
        strip.clipsContent = true;
        [false, true].forEach((on, i) => {
            const frame = createSpecButtonFrame(s, on, on ? 'frame_001_on' : 'frame_000_off', font);
            strip.appendChild(frame);
            frame.x = axis === 'v' ? 0 : i * (F.w + gap);
            frame.y = axis === 'v' ? i * (F.h + gap) : 0;
        });
        strip.setPluginData('buttonSpec', JSON.stringify(s));
        strip.setPluginData('buttonKind', 'strip');
        strip.setPluginData('buttonStrip', JSON.stringify({ frames: 2, gap, axis }));
        return strip;
    });
}

// ===== VuParts: VU needle meters =====
// Duplicated word for word in ui.html (knob-core) and code.js; edit both.
// A meter spec with type 'vu'. Units are px of Vellum's VU drawing, 356 ×
// 206, and the frame keeps that shape: `face.width` px wide. The needle
// turns about a pivot near the bottom, `scale.sweep` degrees end to end, and
// a strip frame at level v shows it at v of the way. The scale marks sit
// where a real VU's do (the needle follows voltage, so 0 VU is ~69% along).
// parts(s, v) lists every piece in frame px, grouped by layer; the canvas
// and Figma both draw that list.
const VuParts = (() => {
  const VW = 356;
  const VH = 206;
  const MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
  const BASE = {
    face: { width: 178, color: '#FFEEA9', glow: 0, vignette: 0, radius: 0, gloss: 0 },
    bezel: { on: false, fill: 'solid', color: '#211E1C', c2: '#000000', width: 10, bevel: 0, shade: 0, screws: false, screwColor: '#8A8A90' },
    scale: { color: '#000000', danger: '#FF0000', radius: 118, sweep: 96, arc: 4.9, tick: 14, tickWidth: 2.6, labels: true, size: 12, title: 'VU', titleSize: 16, signs: true },
    needle: { style: 'solid', color: '#FFFFFF', width: 2.2, length: 140, shadow: 50, pivot: 190, cap: 15, capColor: '#151414' }
  };
  const LIMITS = {
    'face.width': [60, 800], 'face.glow': [0, 100], 'face.vignette': [0, 100], 'face.radius': [0, 60], 'face.gloss': [0, 100],
    'bezel.width': [1, 40], 'bezel.bevel': [0, 20], 'bezel.shade': [0, 100],
    'scale.radius': [40, 180], 'scale.sweep': [30, 140], 'scale.arc': [0, 20], 'scale.tick': [0, 40], 'scale.tickWidth': [0.5, 10], 'scale.size': [4, 40], 'scale.titleSize': [4, 60],
    'needle.width': [0.5, 12], 'needle.length': [20, 220], 'needle.shadow': [0, 100], 'needle.pivot': [100, 260], 'needle.cap': [0, 60]
  };
  const ENUMS = { 'needle.style': ['dashed', 'solid', 'arrow'], 'bezel.fill': ['solid', 'linear'] };

  function lerpHex(a, b, t) {
    const x = parseInt(a.slice(1), 16);
    const y = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((x >> sh) & 255) + (((y >> sh) & 255) - ((x >> sh) & 255)) * t);
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function frameSize(s) {
    const w = Math.round(s.face.width);
    return { w, h: Math.round(w * VH / VW) };
  }

  // Where a dB mark sits along the scale, 0..1 (-20 to +3)
  function markPos(db) {
    const lo = Math.pow(10, -1);
    const hi = Math.pow(10, 3 / 20);
    return (Math.pow(10, db / 20) - lo) / (hi - lo);
  }

  // k: px per unit; oy: the drawing's top in px; pivot in units
  function geometry(s) {
    const F = frameSize(s);
    const k = F.w / VW;
    return { F, k, oy: (F.h - VH * k) / 2, cx: VW / 2, cy: s.needle.pivot };
  }

  // Degrees from straight up, clockwise, at scale position p (0..1)
  const angle = (s, p) => -s.scale.sweep / 2 + Math.max(0, Math.min(1, p)) * s.scale.sweep;

  // The level whose needle points at (x, y) in frame px
  function levelAt(s, x, y) {
    const G = geometry(s);
    const dx = x / G.k - G.cx;
    const dy = (y - G.oy) / G.k - G.cy;
    const deg = Math.atan2(dx, -dy) * 180 / Math.PI;
    return Math.max(0, Math.min(1, (deg + s.scale.sweep / 2) / s.scale.sweep));
  }

  function parts(s, v) {
    const G = geometry(s);
    const k = G.k;
    // Units to frame px, at r units out from the pivot and deg degrees
    const at = (r, deg) => {
      const t = deg * Math.PI / 180;
      return [(G.cx + r * Math.sin(t)) * k, G.oy + (G.cy - r * Math.cos(t)) * k];
    };
    const pivot = at(0, 0);
    const bw = s.bezel.on ? s.bezel.width : 0;
    const faceB = { x: bw * k, y: G.oy + bw * k, w: (VW - 2 * bw) * k, h: (VH - 2 * bw) * k };
    const faceR = s.face.radius * k;
    const out = [];
    const layer = (name, fixed, pieces) => out.push({ layer: name, fixed, pieces });

    // Bezel: a frame (flat, or lit top to bottom like metal or wood), a
    // recessed lip where the face sits in (shaded at the top, lit at the
    // bottom) and a screw in each corner, midway between the rounded outer
    // corner and the face's rounded corner
    const bz = s.bezel;
    const B = [];
    if (bz.on) {
      B.push({
        kind: 'rect', name: 'bezel', b: { x: 0, y: G.oy, w: VW * k, h: VH * k }, r: (s.face.radius + bw) * k,
        paint: bz.fill === 'linear' ? { kind: 'linear', stops: [[0, bz.color, 1], [1, bz.c2, 1]] } : { kind: 'solid', color: bz.color }
      });
      if (bz.bevel > 0) {
        const e = Math.min(bz.bevel, bw) * k;
        B.push({ kind: 'rect', name: 'recess', b: { x: faceB.x - e, y: faceB.y - e, w: faceB.w + 2 * e, h: faceB.h + 2 * e }, r: faceR + e, paint: { kind: 'linear', stops: [[0, '#000000', 0.55], [1, '#FFFFFF', 0.3]] } });
      }
      if (bz.screws) {
        const fr = s.face.radius;
        const lo = (fr + bw) * (1 - Math.SQRT1_2);
        const hi = bw + fr - fr * Math.SQRT1_2;
        const i = (lo + hi) / 2;
        const r = Math.min(bw * 0.4, (hi - lo) * 0.5, 8) * k;
        if (r >= 0.75) {
          [[i, i, 20], [VW - i, i, 110], [i, VH - i, 70], [VW - i, VH - i, 160]].forEach((c, j) => {
            const x = c[0] * k;
            const y = G.oy + c[1] * k;
            const t = c[2] * Math.PI / 180;
            const dx = Math.cos(t) * r * 0.7;
            const dy = Math.sin(t) * r * 0.7;
            B.push({ kind: 'dot', name: 'screw_' + (j + 1), cx: x, cy: y, r, color: bz.screwColor });
            B.push({ kind: 'line', name: 'slot_' + (j + 1), x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy, w: r * 0.35, color: lerpHex(bz.screwColor, '#000000', 0.65), dash: null, shadow: null });
          });
        }
      }
    }
    layer('bezel', true, B);

    const f = s.face;
    layer('face', true, [{
      kind: 'rect', name: 'face', b: faceB, r: faceR,
      paint: f.glow > 0
        ? { kind: 'radial', cx: 0.5, cy: 0.35, rad: 0.75, stops: [[0, lerpHex(f.color, '#FFFFFF', f.glow / 100 * 0.6), 1], [1, f.color, 1]] }
        : { kind: 'solid', color: f.color }
    }]);
    layer('vignette', true, f.vignette > 0
      ? [{ kind: 'rect', name: 'vignette', b: faceB, r: faceR, paint: { kind: 'radial', cx: 0.5, cy: 0.5, rad: 0.75, stops: [[0.55, '#000000', 0], [1, '#000000', f.vignette / 100]] } }]
      : []);

    // Scale: the arc (black up to 0 VU, red after), a tick and number per
    // mark, the − and + at the ends, and the title
    const sc = s.scale;
    const R = sc.radius;
    const p0 = markPos(0);
    const S = [];
    if (sc.arc > 0) {
      const band = (name, a0, a1, color) => ({ kind: 'sector', name, cx: pivot[0], cy: pivot[1], rIn: (R - sc.arc / 2) * k, rOut: (R + sc.arc / 2) * k, a0, a1, color });
      S.push(band('arc', angle(s, 0), angle(s, p0), sc.color));
      S.push(band('arc_red', angle(s, p0), angle(s, 1), sc.danger));
      [['arc_start', 0, sc.color], ['arc_end', 1, sc.danger]].forEach(e => {
        const c = at(R, angle(s, e[1]));
        S.push({ kind: 'dot', name: e[0], cx: c[0], cy: c[1], r: sc.arc / 2 * k, color: e[2] });
      });
    }
    const outer = R + sc.arc / 2;
    MARKS.forEach(db => {
      const deg = angle(s, markPos(db));
      const color = db >= 0 ? sc.danger : sc.color;
      const tag = db < 0 ? 'm' + -db : db > 0 ? 'p' + db : '0';
      if (sc.tick > 0) {
        const a = at(R, deg);
        const b = at(outer + sc.tick, deg);
        S.push({ kind: 'line', name: 'tick_' + tag, x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: sc.tickWidth * k, color, dash: null, shadow: null });
      }
      if (sc.labels) {
        const c = at(outer + sc.tick + 3 + sc.size * 0.6, deg);
        S.push({ kind: 'text', name: 'label_' + tag, text: String(Math.abs(db)), x: c[0], y: c[1], size: sc.size * k, bold: false, color });
      }
    });
    if (sc.signs) {
      const len = sc.size * 0.9;
      const w = Math.max(0.5, sc.size * 0.13) * k;
      const line = (name, c, dx, dy) => ({ kind: 'line', name, x1: c[0] - dx * k, y1: c[1] - dy * k, x2: c[0] + dx * k, y2: c[1] + dy * k, w, color: sc.color, dash: null, shadow: null });
      const minus = at(outer + sc.tick / 2, angle(s, 0) - 9);
      const plus = at(outer + sc.tick / 2, angle(s, 1) + 9);
      S.push(line('minus', minus, len / 2, 0));
      S.push(line('plus_h', plus, len / 2, 0));
      S.push(line('plus_v', plus, 0, len / 2));
    }
    if (sc.title) {
      const c = at(R * 0.52, 0);
      S.push({ kind: 'text', name: 'title', text: sc.title, x: c[0], y: c[1], size: sc.titleSize * k, bold: true, color: sc.color });
    }
    layer('scale', true, S);

    // Needle at level v; its shadow falls down and right
    const n = s.needle;
    const deg = angle(s, v);
    const shadow = n.shadow > 0 ? { dx: 0.8 * k, dy: 0.8 * k, blur: 1.3 * k, alpha: n.shadow / 100 } : null;
    const tip = at(n.length, deg);
    // Starts inside the half-round cover, so its round end and shadow
    // don't poke out below the cover's flat edge
    const root = at(Math.min(n.cap * 0.6, n.length / 2), deg);
    const N = [];
    if (n.style === 'arrow') {
      const head = Math.min(n.length * 0.4, Math.max(12, n.width * 5));
      const hw = Math.max(4.2, n.width * 1.9);
      const b = at(n.length - head, deg);
      const t = deg * Math.PI / 180;
      const px = Math.cos(t) * hw * k;
      const py = Math.sin(t) * hw * k;
      N.push({ kind: 'line', name: 'needle', x1: root[0], y1: root[1], x2: b[0], y2: b[1], w: n.width * k, color: n.color, dash: null, shadow });
      N.push({ kind: 'poly', name: 'needle_head', pts: [tip, [b[0] - px, b[1] - py], [b[0] + px, b[1] + py]], color: n.color, shadow });
    } else {
      const dash = n.style === 'dashed' ? [1.5 * n.width * k, 1.5 * n.width * k] : null;
      N.push({ kind: 'line', name: 'needle', x1: root[0], y1: root[1], x2: tip[0], y2: tip[1], w: n.width * k, color: n.color, dash, shadow });
    }
    layer('needle', false, N);

    layer('cap', true, n.cap > 0 ? [{ kind: 'half', name: 'cap', cx: pivot[0], cy: pivot[1], r: n.cap * k, color: n.capColor }] : []);
    // The bezel's shadow across the top of the face (and the needle)
    layer('shade', true, bz.on && bz.shade > 0
      ? [{ kind: 'rect', name: 'shade', b: faceB, r: faceR, paint: { kind: 'linear', stops: [[0, '#000000', bz.shade / 100], [0.2, '#000000', 0]] } }]
      : []);
    layer('glass', true, f.gloss > 0 ? [{ kind: 'rect', name: 'glass', b: faceB, r: faceR, paint: { kind: 'sheen', alpha: f.gloss / 100 } }] : []);
    return out;
  }

  return { VW, VH, MARKS, BASE, LIMITS, ENUMS, frameSize, markPos, geometry, angle, levelAt, parts };
})();

// Loads Inter for a VU's numbers and title: null for bar meters, or when it
// can't load (the text is left out then)
function meterFonts(s) {
    if (s.type !== 'vu') return Promise.resolve(null);
    const regular = { family: 'Inter', style: 'Regular' };
    const bold = { family: 'Inter', style: 'Bold' };
    return Promise.all([figma.loadFontAsync(regular), figma.loadFontAsync(bold)]).then(() => ({ regular, bold }), () => null);
}

function vuPaints(P) {
    if (P.kind === 'solid') return knobSolid(P.color);
    if (P.kind === 'sheen') return [knobSheenPaint(P.alpha * 100)];
    if (P.kind === 'linear') {
        // Top to bottom, like the sheen
        return [{
            type: 'GRADIENT_LINEAR',
            gradientTransform: [[0, 1, 0], [-1, 0, 1]],
            gradientStops: P.stops.map(st => ({ position: st[0], color: Object.assign(hexToRgb(st[1]), { a: st[2] }) }))
        }];
    }
    // Radial in the box's own 0..1 space: centered on cx, cy, reaching rad
    const S = 0.5 / P.rad;
    return [{
        type: 'GRADIENT_RADIAL',
        gradientTransform: [[S, 0, 0.5 - S * P.cx], [0, S, 0.5 - S * P.cy]],
        gradientStops: P.stops.map(st => ({ position: st[0], color: Object.assign(hexToRgb(st[1]), { a: st[2] }) }))
    }];
}

// One VuParts piece as a Figma node in frame `f`
function vuPieceNode(f, p, fonts) {
    let n;
    if (p.kind === 'rect') {
        n = figma.createRectangle();
        f.appendChild(n);
        n.resize(Math.max(0.01, p.b.w), Math.max(0.01, p.b.h));
        n.x = p.b.x;
        n.y = p.b.y;
        if (p.r > 0) n.cornerRadius = Math.min(p.r, p.b.w / 2, p.b.h / 2);
        n.fills = vuPaints(p.paint);
    } else if (p.kind === 'sector' || p.kind === 'dot' || p.kind === 'half') {
        const r = p.kind === 'sector' ? p.rOut : p.r;
        n = figma.createEllipse();
        f.appendChild(n);
        n.resize(Math.max(0.01, 2 * r), Math.max(0.01, 2 * r));
        n.x = p.cx - r;
        n.y = p.cy - r;
        // Figma arcs run clockwise from 3 o'clock; VuParts angles from 12
        if (p.kind === 'sector') {
            n.arcData = { startingAngle: (p.a0 - 90) * Math.PI / 180, endingAngle: (p.a1 - 90) * Math.PI / 180, innerRadius: Math.max(0, Math.min(0.999, p.rIn / p.rOut)) };
        } else if (p.kind === 'half') {
            n.arcData = { startingAngle: Math.PI, endingAngle: 2 * Math.PI, innerRadius: 0 };
        }
        n.fills = knobSolid(p.color);
    } else if (p.kind === 'line' || p.kind === 'poly') {
        // Path shifted to start at 0, 0 and the node moved instead (like knobVector)
        const pts = p.kind === 'line' ? [[p.x1, p.y1], [p.x2, p.y2]] : p.pts;
        const minX = Math.min.apply(null, pts.map(q => q[0]));
        const minY = Math.min.apply(null, pts.map(q => q[1]));
        const data = 'M ' + pts.map(q => (q[0] - minX).toFixed(3) + ' ' + (q[1] - minY).toFixed(3)).join(' L ') + (p.kind === 'poly' ? ' Z' : '');
        n = figma.createVector();
        f.appendChild(n);
        n.vectorPaths = [{ windingRule: p.kind === 'poly' ? 'NONZERO' : 'NONE', data }];
        n.x = minX;
        n.y = minY;
        if (p.kind === 'line') {
            n.fills = [];
            n.strokes = knobSolid(p.color);
            n.strokeWeight = p.w;
            n.strokeCap = 'ROUND';
            if (p.dash) n.dashPattern = p.dash;
        } else {
            n.fills = knobSolid(p.color);
            n.strokes = [];
        }
    } else if (p.kind === 'text') {
        if (!fonts) return null;
        n = figma.createText();
        f.appendChild(n);
        n.fontName = p.bold ? fonts.bold : fonts.regular;
        n.fontSize = Math.max(1, p.size);
        n.characters = p.text;
        n.textAutoResize = 'WIDTH_AND_HEIGHT';
        n.fills = knobSolid(p.color);
        n.x = p.x - n.width / 2;
        n.y = p.y - n.height / 2;
    } else {
        return null;
    }
    n.name = p.name;
    if (p.shadow) n.effects = [knobShadowEffect(p.shadow.blur, p.shadow.alpha * 100, [p.shadow.dx, p.shadow.dy])];
    return n;
}

function vuBuildLayer(f, L, fonts) {
    const nodes = L.pieces.map(p => vuPieceNode(f, p, fonts)).filter(Boolean);
    if (!nodes.length) return null;
    if (nodes.length === 1) {
        nodes[0].name = L.layer;
        return nodes[0];
    }
    const g = figma.group(nodes, f);
    g.name = L.layer;
    return g;
}

// Fixed layers are cloned from the first frame of a strip, like meters
function createSpecVuFrame(s, v, name, template, fonts) {
    const F = VuParts.frameSize(s);
    const f = figma.createFrame();
    f.name = name;
    f.resize(F.w, F.h);
    f.fills = [];
    f.clipsContent = true;
    const fixed = [];
    VuParts.parts(s, v).forEach((L, i) => {
        let node = null;
        if (L.fixed && template) {
            const src = template[i];
            if (src) {
                node = src.clone();
                f.appendChild(node);
                node.x = src.x;
                node.y = src.y;
            }
        } else {
            node = vuBuildLayer(f, L, fonts);
        }
        if (L.fixed) fixed[i] = node;
    });
    return { frame: f, fixed };
}

////////////////////////////////////////////////////////////////////////////
// Meter spec: the meter studio's model. A frame (`orient`, `length` and
// `thickness` in px) with a housing, a bar that fills to the level (solid,
// blocks or dots; mono or stereo), unlit segments, ticks and a gloss. Part
// sizes are in units where the thickness is 100. Level 0 is at the bottom
// (vertical) or left. meterParts() lists every piece in frame px, the same
// list as MeterCore.parts() in ui.html; keep the two in step.
////////////////////////////////////////////////////////////////////////////
// `type` 'vu' makes it a needle meter instead: VuParts draws it from the
// face/bezel/scale/needle groups, and the bar groups go unused.
const METER_SPEC_BASE = Object.assign({
    name: 'Custom', tier: 'free', type: 'bar', orient: 'v', length: 60, thickness: 24,
    housing: { on: true, fill: 'solid', c1: '#141417', c2: '#26262C', angle: 90, radius: 16, edge: 0, edgeColor: '#000000', gloss: 0 },
    bar: { style: 'blocks', width: 50, inset: 12, count: 16, gap: 5, radius: 20, stereo: false, split: 8, ramp: 100, align: 'b' },
    color: { mode: 'zones', c1: '#3DDC84', c2: '#FFD166', c3: '#FF4D5E', b1: 66, b2: 90, glow: 0 },
    off: { on: true, style: 'tint', color: '#26262B', alpha: 18 },
    ticks: { on: false, count: 7, color: '#6A6A74', side: 'both', length: 10, width: 2, gap: 6 }
}, VuParts.BASE);
const METER_SPEC_LIMITS = Object.assign({
    'length': [16, 1024], 'thickness': [6, 400],
    'housing.angle': [0, 360], 'housing.radius': [0, 50], 'housing.edge': [0, 20], 'housing.gloss': [0, 100],
    'bar.width': [2, 100], 'bar.inset': [0, 200], 'bar.count': [2, 64], 'bar.gap': [0, 40], 'bar.radius': [0, 50], 'bar.split': [0, 60], 'bar.ramp': [5, 100],
    'color.b1': [0, 100], 'color.b2': [0, 100], 'color.glow': [0, 40],
    'off.alpha': [0, 100],
    'ticks.count': [2, 41], 'ticks.length': [1, 50], 'ticks.width': [0.5, 20], 'ticks.gap': [0, 50]
}, VuParts.LIMITS);
const METER_SPEC_ENUMS = Object.assign({}, VuParts.ENUMS, {
    'type': ['bar', 'vu'],
    'orient': ['v', 'h'],
    'housing.fill': ['solid', 'linear', 'radial', 'conic'],
    'bar.style': ['solid', 'blocks', 'dots'],
    'bar.align': ['a', 'center', 'b'],
    'color.mode': ['flat', 'zones', 'gradient'],
    'off.style': ['color', 'tint'],
    'ticks.side': ['both', 'a', 'b']
});

function normalizeMeterSpec(raw) {
    return normalizeSpec(raw, METER_SPEC_BASE, METER_SPEC_LIMITS, METER_SPEC_ENUMS);
}

// Across span of segment i of n when segments ramp up in size: the first is
// `ramp`% of [c0, c1], the last all of it, lined up on `align`. Shared by
// meters and sliders; same as rampSpan in ui.html.
function rampSpan(ramp, align, c0, c1, i, n) {
    const w = (c1 - c0) * (ramp + (100 - ramp) * (n > 1 ? i / (n - 1) : 1)) / 100;
    if (align === 'a') return [c0, c0 + w];
    if (align === 'b') return [c1 - w, c1];
    const m = (c0 + c1) / 2;
    return [m - w / 2, m + w / 2];
}

function meterFrameSize(s) {
    if (s.type === 'vu') return VuParts.frameSize(s);
    return s.orient === 'v'
        ? { w: Math.round(s.thickness), h: Math.round(s.length) }
        : { w: Math.round(s.length), h: Math.round(s.thickness) };
}

// Along the meter in units: t0..t1 is the bar. Across: one span per channel.
function meterGeometry(s) {
    const F = meterFrameSize(s);
    const k = Math.round(s.thickness) / 100;
    const L = Math.round(s.length) / k;
    const t0 = Math.min(L / 2, s.bar.inset);
    const t1 = Math.max(L / 2, L - s.bar.inset);
    const hw = s.bar.width / 2;
    const sp = Math.min(s.bar.split, s.bar.width - 1) / 2;
    const chans = s.bar.stereo ? [[-hw, -sp], [sp, hw]] : [[-hw, hw]];
    return { F, k, L, t0, t1, A: Math.max(0.001, t1 - t0), chans };
}

function meterSegments(s, G) {
    const n = Math.round(s.bar.count);
    const len = Math.max(0.5, (G.A - (n - 1) * s.bar.gap) / n);
    const out = [];
    for (let i = 0; i < n; i++) {
        const a0 = G.t0 + i * (len + s.bar.gap);
        out.push({ a0, a1: a0 + len, mid: a0 + len / 2, t: (len / 2 + i * (len + s.bar.gap)) / G.A });
    }
    return out;
}

// Same as SpecTools.lerpHex in ui.html, so both sides pick identical colors
function meterLerpHex(a, b, t) {
    const x = parseInt(a.slice(1), 16);
    const y = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((x >> sh) & 255) + (((y >> sh) & 255) - ((x >> sh) & 255)) * t);
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function meterColorAt(s, t) {
    const c = s.color;
    if (c.mode === 'zones') return t < c.b1 / 100 ? c.c1 : t < c.b2 / 100 ? c.c2 : c.c3;
    if (c.mode === 'gradient') return t <= 0.5 ? meterLerpHex(c.c1, c.c2, t / 0.5) : meterLerpHex(c.c2, c.c3, (t - 0.5) / 0.5);
    return c.c1;
}

// Gradient stops pinned to the whole bar, for solid bars. Zones get hard
// edges: each break's second stop sits a hair later.
function meterStops(s) {
    const c = s.color;
    let out;
    if (c.mode === 'zones') {
        const b1 = c.b1 / 100, b2 = Math.max(b1, c.b2 / 100), e = 0.0005;
        out = [[0, c.c1], [b1, c.c1], [b1 + e, c.c2], [b2, c.c2], [b2 + e, c.c3], [1, c.c3]];
    } else if (c.mode === 'gradient') {
        out = [[0, c.c1], [0.5, c.c2], [1, c.c3]];
    } else {
        return null;
    }
    let last = 0;
    return out.map(p => { last = Math.min(1, Math.max(last, p[0])); return [last, p[1]]; });
}

function meterBox(s, G, a0, a1, c0, c1) {
    const k = G.k;
    if (s.orient === 'v') return { x: G.F.w / 2 + c0 * k, y: G.F.h - a1 * k, w: (c1 - c0) * k, h: (a1 - a0) * k };
    return { x: a0 * k, y: G.F.h / 2 + c0 * k, w: (a1 - a0) * k, h: (c1 - c0) * k };
}

function meterTickSpans(s) {
    const t = s.ticks;
    const inner = s.bar.width / 2 + t.gap;
    const out = [];
    if (t.side !== 'b') out.push([-(inner + t.length), -inner]);
    if (t.side !== 'a') out.push([inner, inner + t.length]);
    return out;
}

// Every piece of the meter at level v, in frame px
function meterParts(s, v) {
    const G = meterGeometry(s);
    const k = G.k;
    const B = (a0, a1, c0, c1) => meterBox(s, G, a0, a1, c0, c1);
    const out = { housing: null, ticks: [], off: [], lit: [], gloss: 0 };
    const h = s.housing;
    if (h.on) {
        out.housing = { b: { x: 0, y: 0, w: G.F.w, h: G.F.h }, r: h.radius / 100 * Math.min(G.F.w, G.F.h) };
        out.gloss = h.gloss;
    }
    if (s.ticks.on) {
        const n = Math.round(s.ticks.count);
        for (let i = 0; i < n; i++) {
            const a = G.t0 + G.A * i / (n - 1);
            meterTickSpans(s).forEach(span => out.ticks.push(B(a - s.ticks.width / 2, a + s.ticks.width / 2, span[0], span[1])));
        }
    }
    const st = meterStops(s);
    const tint = s.off.style === 'tint';
    const offAlpha = tint ? s.off.alpha / 100 : 1;
    const glow = s.color.glow * k;
    G.chans.forEach(ch => {
        const c0 = ch[0], c1 = ch[1];
        const r = s.bar.radius / 100 * (c1 - c0) * k;
        if (s.bar.style === 'solid') {
            if (s.off.on) {
                out.off.push(tint
                    ? { shape: 'rect', b: B(G.t0, G.t1, c0, c1), r, along: [G.t0, G.t1], color: s.color.c1, stops: st, alpha: offAlpha }
                    : { shape: 'rect', b: B(G.t0, G.t1, c0, c1), r, along: [G.t0, G.t1], color: s.off.color, stops: null, alpha: 1 });
            }
            const f1 = G.t0 + G.A * v;
            if (f1 - G.t0 > 0.01) {
                out.lit.push({ shape: 'rect', b: B(G.t0, f1, c0, c1), r, along: [G.t0, f1], color: s.color.c1, stops: st, alpha: 1, glow, glowColor: meterColorAt(s, v) });
            }
        } else {
            const n = Math.round(v * Math.round(s.bar.count));
            const segs = meterSegments(s, G);
            segs.forEach((sg, i) => {
                const q = rampSpan(s.bar.ramp, s.bar.align, c0, c1, i, segs.length);
                // Ramped segments all share one corner radius, from the full-size
                // segment's shorter side, so none turn into pills or hard boxes
                const r = s.bar.ramp < 100 ? s.bar.radius / 100 * Math.min(sg.a1 - sg.a0, c1 - c0) * k : s.bar.radius / 100 * (c1 - c0) * k;
                let b = B(sg.a0, sg.a1, q[0], q[1]);
                let shape = 'rect';
                if (s.bar.style === 'dots') {
                    const d = Math.min(sg.a1 - sg.a0, q[1] - q[0]);
                    // Align only matters once the dots ramp; otherwise they sit centered
                    const al = s.bar.ramp < 100 ? s.bar.align : 'center';
                    const m = al === 'a' ? q[0] + d / 2 : al === 'b' ? q[1] - d / 2 : (q[0] + q[1]) / 2;
                    b = B(sg.mid - d / 2, sg.mid + d / 2, m - d / 2, m + d / 2);
                    shape = 'ellipse';
                }
                const col = meterColorAt(s, sg.t);
                if (s.off.on) out.off.push({ shape, b, r, color: tint ? col : s.off.color, stops: null, alpha: offAlpha });
                if (i < n) out.lit.push({ shape, b, r, color: col, stops: null, alpha: 1, glow, glowColor: col });
            });
        }
    });
    return out;
}

// A bar piece as a Figma shape: solid, or a gradient fixed along the whole bar
function meterPiece(ctx, name, p) {
    const s = ctx.s, G = ctx.G;
    const n = sliderShape(ctx, name, p.b, p.shape, p.r);
    if (p.stops) {
        const sc = (p.along[1] - p.along[0]) / G.A;
        const o = (p.along[0] - G.t0) / G.A;
        n.fills = [{
            type: 'GRADIENT_LINEAR',
            gradientTransform: s.orient === 'v' ? [[0, -sc, o + sc], [1, 0, 0]] : [[sc, 0, o], [0, 1, 0]],
            gradientStops: p.stops.map(st => ({ position: st[0], color: Object.assign(hexToRgb(st[1]), { a: 1 }) }))
        }];
    } else {
        n.fills = knobSolid(p.color);
    }
    if (p.alpha < 1) n.opacity = p.alpha;
    if (p.glow > 0) n.effects = [knobGlowEffect(p.glowColor, p.glow)];
    return n;
}

function meterBuildHousing(ctx) {
    const h = ctx.s.housing, P = ctx.P;
    if (!P.housing) return null;
    const n = sliderShape(ctx, 'housing', P.housing.b, 'rect', P.housing.r);
    n.fills = knobPaints(h.fill, h.c1, h.c2, h.angle);
    knobEdge(n, h.edge * ctx.G.k, h.edgeColor);
    return n;
}

function meterBuildTicks(ctx) {
    const s = ctx.s;
    return knobGroupOf(ctx, 'ticks', ctx.P.ticks.map((b, i) => {
        const t = sliderShape(ctx, 'tick_' + (i + 1), b, 'rect', 0);
        t.fills = knobSolid(s.ticks.color);
        return t;
    }));
}

function meterBuildOff(ctx) {
    return knobGroupOf(ctx, 'unlit', ctx.P.off.map((p, i) => meterPiece(ctx, 'unlit_' + (i + 1), p)));
}

function meterBuildLit(ctx) {
    return knobGroupOf(ctx, 'lit', ctx.P.lit.map((p, i) => meterPiece(ctx, 'lit_' + (i + 1), p)));
}

function meterBuildGloss(ctx) {
    const P = ctx.P;
    if (!P.housing || P.gloss <= 0) return null;
    const n = sliderShape(ctx, 'gloss', P.housing.b, 'rect', P.housing.r);
    n.fills = [knobSheenPaint(P.gloss)];
    return n;
}

// Bottom to top; fixed layers are cloned from the first frame of a strip
const METER_LAYERS = [
    { fixed: true, build: meterBuildHousing },
    { fixed: true, build: meterBuildTicks },
    { fixed: true, build: meterBuildOff },
    { fixed: false, build: meterBuildLit },
    { fixed: true, build: meterBuildGloss }
];

function createSpecMeterFrame(s, v, name, template, fonts) {
    if (s.type === 'vu') return createSpecVuFrame(s, v, name, template, fonts);
    const G = meterGeometry(s);
    const f = figma.createFrame();
    f.name = name;
    f.resize(G.F.w, G.F.h);
    f.fills = [];
    f.clipsContent = true;
    const ctx = { s, f, G, P: meterParts(s, v) };
    const fixed = [];
    METER_LAYERS.forEach((layer, i) => {
        let node = null;
        if (layer.fixed && template) {
            const src = template[i];
            if (src) {
                node = src.clone();
                f.appendChild(node);
                node.x = src.x;
                node.y = src.y;
            }
        } else {
            node = layer.build(ctx);
        }
        if (layer.fixed) fixed[i] = node;
    });
    return { frame: f, fixed };
}

// "VU Meter · …" so Vellum export makes it Vellum's vumeter widget
function createSpecMeter(s, value, fonts) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    const meter = createSpecMeterFrame(s, v, (s.type === 'vu' ? 'VU Meter · ' : 'Meter · ') + s.name, null, fonts).frame;
    meter.setPluginData('meterSpec', JSON.stringify(s));
    meter.setPluginData('meterKind', 'meter');
    meter.setPluginData('meterValue', String(v));
    return meter;
}

// Frame i shows level i / (frames - 1), the frame Vellum picks for that
// level. Named "meter_sprite_48f" so Vellum reads the frame count; VU strips
// are "vu_sprite_48f".
function createSpecMeterStrip(s, frames, gap, axis, fonts) {
    return runStripSteps(meterStripSteps(s, frames, gap, axis, fonts));
}

function* meterStripSteps(s, frames, gap, axis, fonts) {
    frames = Math.max(2, Math.min(256, Math.round(Number(frames) || 48)));
    gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
    axis = axis === 'h' ? 'h' : 'v';
    const F = meterFrameSize(s);
    const strip = figma.createFrame();
    strip.name = (s.type === 'vu' ? 'vu' : 'meter') + '_sprite_' + frames + 'f';
    strip.resize(
        axis === 'v' ? F.w : frames * F.w + (frames - 1) * gap,
        axis === 'v' ? frames * F.h + (frames - 1) * gap : F.h
    );
    strip.fills = [];
    strip.clipsContent = true;
    let template = null;
    for (let i = 0; i < frames; i++) {
        const built = createSpecMeterFrame(s, stripFrameValue(i, frames, false), 'frame_' + String(i).padStart(3, '0'), template, fonts);
        if (!template) template = built.fixed;
        strip.appendChild(built.frame);
        built.frame.x = axis === 'v' ? 0 : i * (F.w + gap);
        built.frame.y = axis === 'v' ? i * (F.h + gap) : 0;
        yield { strip, done: i + 1, total: frames };
    }
    strip.setPluginData('meterSpec', JSON.stringify(s));
    strip.setPluginData('meterKind', 'strip');
    strip.setPluginData('meterStrip', JSON.stringify({ frames, gap, axis }));
    return strip;
}

////////////////////////////////////////////////////////////////////////////
// Wheel spec: the wheel studio's model, pitch bend and mod wheels. Vellum
// treats both as vertical faders (same skin strips), so these build like
// meters: WheelParts.parts() lists every piece in frame px and each layer
// becomes a Figma node. WheelParts is duplicated word for word in ui.html.
////////////////////////////////////////////////////////////////////////////
// ===== WheelParts: pitch and mod wheels =====
// Duplicated word for word in ui.html (knob-core) and code.js; edit both.
// A wheel frame is `width` × `height` px, always vertical like Vellum's
// pitchwheel and modwheel. Part sizes are in units where the width is 100.
// Along runs from the bottom (0) up. A rolling wheel is a cylinder seen from
// the front: its face spans ±TMAX degrees, and the value turns it by
// (v - 0.5) × travel, so ribs and the grip slide past foreshortened at the
// ends. A sliding wheel moves its grip in a straight line, like a fader cap.
// parts(s, v) lists every piece in frame px, grouped by layer; the canvas
// and Figma both draw that list.
const WheelParts = (() => {
  const FILLS = ['solid', 'linear', 'radial', 'conic'];
  const TMAX = 72;
  const BASE = {
    name: 'Custom', tier: 'free', mode: 'pitch', width: 21, height: 109,
    housing: { on: true, fill: 'linear', c1: '#2C2C31', c2: '#1A1A1E', angle: 90, radius: 12, edge: 0, edgeColor: '#000000' },
    well: { on: true, color: '#0C0C0E', pad: 8, radius: 20, edge: 0, edgeColor: '#000000', depth: 40 },
    wheel: { motion: 'roll', width: 62, inset: 14, radius: 18, c1: '#5A5A60', c2: '#141416', curve: 85, side: 40, edge: 0, edgeColor: '#000000', shadow: 0, travel: 120 },
    ribs: { on: true, style: 'grooves', count: 24, width: 1.6, color: '#0A0A0C', light: '#8A8A92', alpha: 70, phase: 0, shade: 0, depth: 0, round: 30 },
    grip: { on: false, shape: 'rect', length: 26, fit: false, width: 100, fill: 'linear', c1: '#8A8A90', c2: '#3A3A40', angle: 90, radius: 20, edge: 0, edgeColor: '#000000', shadow: 0, glow: 0, line: 0, lineColor: '#FFFFFF', depth: 6 },
    ticks: { on: false, count: 5, color: '#8C8898', side: 'both', length: 10, width: 2, gap: 5 }
  };
  const LIMITS = {
    'width': [8, 400], 'height': [24, 1024],
    'housing.angle': [0, 360], 'housing.radius': [0, 50], 'housing.edge': [0, 20],
    'well.pad': [0, 60], 'well.radius': [0, 50], 'well.edge': [0, 20], 'well.depth': [0, 100],
    'wheel.width': [10, 100], 'wheel.inset': [0, 300], 'wheel.radius': [0, 50], 'wheel.curve': [0, 100], 'wheel.side': [0, 100],
    'wheel.edge': [0, 20], 'wheel.shadow': [0, 40], 'wheel.travel': [20, 170],
    'ribs.count': [4, 90], 'ribs.width': [0.2, 20], 'ribs.alpha': [0, 100], 'ribs.phase': [0, 1], 'ribs.shade': [0, 100], 'ribs.depth': [0, 40], 'ribs.round': [0, 50],
    'grip.length': [2, 400], 'grip.width': [10, 140], 'grip.angle': [0, 360], 'grip.radius': [0, 50], 'grip.edge': [0, 20],
    'grip.shadow': [0, 40], 'grip.glow': [0, 40], 'grip.line': [0, 20], 'grip.depth': [0, 40],
    'ticks.count': [1, 41], 'ticks.length': [1, 60], 'ticks.width': [0.5, 20], 'ticks.gap': [0, 60]
  };
  const ENUMS = {
    'mode': ['pitch', 'mod'],
    'housing.fill': FILLS, 'grip.fill': FILLS,
    'wheel.motion': ['roll', 'slide'],
    'ribs.style': ['grooves', 'teeth'],
    'grip.shape': ['rect', 'ellipse', 'notch'],
    'ticks.side': ['both', 'a', 'b']
  };

  const r3 = x => Math.round(x * 1000) / 1000;
  const rad = d => d * Math.PI / 180;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function lerpHex(a, b, t) {
    const x = parseInt(a.slice(1), 16);
    const y = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((x >> sh) & 255) + (((y >> sh) & 255) - ((x >> sh) & 255)) * t);
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  const frameSize = s => ({ w: Math.round(s.width), h: Math.round(s.height) });

  // Along: the face runs f0..f1 around the middle m; R is the cylinder
  // radius that puts ±TMAX exactly at the face ends. Across: 0 is the middle.
  function geometry(s) {
    const F = frameSize(s);
    const k = F.w / 100;
    const L = F.h / k;
    const inset = Math.min(s.wheel.inset, L / 2 - 1);
    const f0 = inset, f1 = L - inset, m = L / 2;
    const half = (f1 - f0) / 2;
    const R = half / Math.sin(rad(TMAX));
    const ww = s.wheel.width;
    const pad = s.well.pad;
    return { F, k, L, f0, f1, m, half, R, ww, wellHalf: ww / 2 + pad, w0: Math.max(0, f0 - pad), w1: Math.min(L, f1 + pad) };
  }

  function box(G, a0, a1, c0, c1) {
    return { x: r3(G.F.w / 2 + c0 * G.k), y: r3(G.F.h - a1 * G.k), w: r3((c1 - c0) * G.k), h: r3((a1 - a0) * G.k) };
  }
  const round = (s, b, pct) => r3(pct / 100 * Math.min(b.w, b.h));

  // Degrees the wheel has turned at value v. Sliding wheels don't turn.
  const turn = (s, v) => (s.wheel.motion === 'roll' ? (v - 0.5) * s.wheel.travel : 0);
  const rollAt = (G, deg) => G.m + G.R * Math.sin(rad(clamp(deg, -TMAX, TMAX)));

  // Along position of the grip's middle at value v
  function gripAt(s, G, v) {
    if (s.wheel.motion === 'roll') return rollAt(G, turn(s, v));
    const gl = s.grip.on ? s.grip.length : 0;
    const lo = G.f0 + gl / 2, hi = G.f1 - gl / 2;
    return hi > lo ? lo + v * (hi - lo) : G.m;
  }

  function tickSpans(s, G) {
    const t = s.ticks;
    const inner = (s.well.on ? G.wellHalf : G.ww / 2) + t.gap;
    const out = [];
    if (t.side !== 'b') out.push([-1, inner]);
    if (t.side !== 'a') out.push([1, inner]);
    return out;
  }

  const solid = color => ({ kind: 'solid', color });
  const fillOf = p => ({ kind: 'fill', fill: p.fill, c1: p.c1, c2: p.c2, angle: p.angle });
  const piece = (name, b, r, paint, extra) => Object.assign({ name, shape: 'rect', b, r, paint, alpha: 1, edge: null, shadow: 0, glow: null }, extra || {});
  const edgeOf = (w, color, k) => (w > 0 ? [r3(w * k), color] : null);

  // A flat facet at `deg` lit from LIGHT degrees above the middle: a dark
  // overlay as it turns away, a faint shine where it faces the light
  const LIGHT = 20;
  function facet(shade, deg) {
    const b = Math.cos(rad(deg - LIGHT));
    const a = b > 0.97 ? shade / 100 * 0.2 * (b - 0.97) / 0.03 : Math.min(0.9, shade / 100 * (1 - b) * 1.6);
    return a > 0.005 ? [b > 0.97 ? '#FFFFFF' : '#000000', r3(a)] : null;
  }

  // Every piece at value v, bottom to top, grouped by layer. `fixed` layers
  // look the same in every frame; `clip` clips a layer to the wheel face.
  function parts(s, v) {
    const G = geometry(s);
    const k = G.k;
    const B = (a0, a1, c0, c1) => box(G, a0, a1, c0, c1);
    const h = s.housing, wl = s.well, w = s.wheel, rb = s.ribs, g = s.grip, t = s.ticks;
    const layers = [];
    const layer = (id, fixed, pieces, clip) => layers.push({ layer: id, fixed, pieces, clip: clip || null });

    const plate = { x: 0, y: 0, w: G.F.w, h: G.F.h };
    layer('housing', true, h.on ? [piece('housing', plate, round(s, plate, h.radius), fillOf(h), { edge: edgeOf(h.edge, h.edgeColor, k) })] : []);

    const ticks = [];
    if (t.on) {
      const n = Math.round(t.count);
      for (let i = 0; i < n; i++) {
        const tv = n === 1 ? 0.5 : i / (n - 1);
        const a = w.motion === 'roll' ? rollAt(G, (tv - 0.5) * w.travel) : gripAt(s, G, tv);
        const len = t.length * (s.mode === 'pitch' && Math.abs(tv - 0.5) < 1e-9 ? 1.5 : 1);
        tickSpans(s, G).forEach(([side, inner]) => {
          const c0 = side < 0 ? -(inner + len) : inner;
          ticks.push(piece('tick_' + (i + 1) + (side < 0 ? 'a' : 'b'), B(a - t.width / 2, a + t.width / 2, c0, c0 + len), 0, solid(t.color)));
        });
      }
    }
    layer('ticks', true, ticks);

    const wellPieces = [];
    if (wl.on) {
      const wb = B(G.w0, G.w1, -G.wellHalf, G.wellHalf);
      const wr = round(s, wb, wl.radius);
      wellPieces.push(piece('slot', wb, wr, solid(wl.color), { edge: edgeOf(wl.edge, wl.edgeColor, k) }));
      if (wl.depth > 0) {
        const a = r3(wl.depth / 100 * 0.9);
        wellPieces.push(piece('slot_depth', wb, wr, { kind: 'stops', dir: 'v', stops: [[0, '#000000', a], [0.22, '#000000', 0], [0.85, '#000000', 0], [1, '#000000', r3(a * 0.5)]] }));
      }
    }
    layer('well', true, wellPieces);

    // The face darkens toward the ends as the cylinder turns away
    const face = B(G.f0, G.f1, -G.ww / 2, G.ww / 2);
    const faceR = round(s, face, w.radius);
    const shade = [];
    for (let i = 0; i <= 8; i++) {
      const p = i / 8;
      shade.push([r3(p), lerpHex(w.c1, w.c2, Math.pow(Math.abs(2 * p - 1), 2) * w.curve / 100), 1]);
    }
    const wheelPieces = [piece('wheel', face, faceR, { kind: 'stops', dir: 'v', stops: shade }, { edge: edgeOf(w.edge, w.edgeColor, k), shadow: r3(w.shadow * k) })];
    if (w.side > 0) {
      const a = r3(w.side / 100 * 0.85);
      wheelPieces.push(piece('wheel_sides', face, faceR, { kind: 'stops', dir: 'h', stops: [[0, '#000000', a], [0.3, '#000000', 0], [0.7, '#000000', 0], [1, '#000000', a]] }));
    }
    layer('wheel', true, wheelPieces);

    // Ribs. Grooves: a groove and the lit lip under it, thinner and fainter
    // toward the ends. Teeth: raised rounded blocks with wide gaps between.
    const ribs = [];
    const phi = turn(s, v);
    const step = 180 / Math.round(rb.count);
    const gapHalf = (rb.width / 2) / G.R * 180 / Math.PI;
    const teeth = rb.on && rb.style === 'teeth';
    // Walls of raised things show on one side as they turn: below the middle
    // the lit top wall (above the face), above the middle the shaded underside
    const wallOf = (a0, a1, deg, color) => {
      const h = rb.depth * Math.abs(Math.sin(rad(deg)));
      if (h <= 0.01) return null;
      const up = deg < 0;
      return { b: up ? B(a0, a1 + h, -G.ww / 2, G.ww / 2) : B(a0 - h, a1, -G.ww / 2, G.ww / 2), color: lerpHex(color, up ? '#FFFFFF' : '#000000', up ? 0.35 : 0.6) };
    };
    if (rb.on) {
      // phase shifts the ribs by part of a step: at 0.5 the grip sits between two
      const j0 = Math.ceil((-TMAX - phi) / step - rb.phase), j1 = Math.floor((TMAX - phi) / step - rb.phase);
      const degs = [];
      for (let j = j0; j <= j1; j++) degs.push(phi + (j + rb.phase) * step);
      if (teeth) {
        // Each tooth is its own piece between two gaps, lit by the way it
        // faces, standing on the wall that shows as it turns
        const edges = [-TMAX - gapHalf].concat(degs, [TMAX + gapHalf]);
        const alpha = r3(rb.alpha / 100);
        for (let i = 0; i + 1 < edges.length; i++) {
          const lo = Math.max(-TMAX, edges[i] + gapHalf), hi = Math.min(TMAX, edges[i + 1] - gapHalf);
          if (hi - lo < 0.01) continue;
          const t0 = rollAt(G, lo), t1 = rollAt(G, hi), mid = (lo + hi) / 2;
          const tb = B(t0, t1, -G.ww / 2, G.ww / 2);
          const tr = round(s, tb, rb.round);
          const wl = wallOf(t0, t1, mid, rb.light);
          if (wl) ribs.push(piece('tooth_' + (i + 1) + '_wall', wl.b, tr, solid(wl.color), { alpha }));
          const f = rb.shade > 0 ? facet(rb.shade, mid) : null;
          ribs.push(piece('tooth_' + (i + 1), tb, tr, solid(f ? lerpHex(rb.light, f[0], f[1]) : rb.light), { alpha }));
        }
      } else {
        // Facets: each tooth between two ribs takes the light the way it faces,
        // so the shading travels with the teeth as the wheel turns
        if (rb.shade > 0) {
          const edges = [-TMAX].concat(degs, [TMAX]);
          for (let i = 0; i + 1 < edges.length; i++) {
            const lo = edges[i], hi = edges[i + 1];
            const f = hi - lo > 0.01 ? facet(rb.shade, (lo + hi) / 2) : null;
            if (f) ribs.push(piece('tooth_' + (i + 1), B(rollAt(G, lo), rollAt(G, hi), -G.ww / 2, G.ww / 2), 0, solid(f[0]), { alpha: f[1] }));
          }
        }
        let n = 0;
        degs.forEach(deg => {
          const c = Math.cos(rad(deg));
          const a = rollAt(G, deg);
          const th = Math.max(0.05, rb.width * c);
          const alpha = r3(rb.alpha / 100 * c);
          if (alpha <= 0.005) return;
          n++;
          ribs.push(piece('rib_' + n, B(a - th / 2, a + th / 2, -G.ww / 2, G.ww / 2), 0, solid(rb.color), { alpha }));
          ribs.push(piece('rib_' + n + '_lip', B(a - th / 2 - th * 0.7, a - th / 2, -G.ww / 2, G.ww / 2), 0, solid(rb.light), { alpha: r3(alpha * 0.6) }));
          // Tooth walls in the gap: below the middle the tooth under it shows
          // its lit top; above the middle the tooth over it shows its shaded underside
          const wall = Math.min(th, rb.depth * Math.abs(Math.sin(rad(deg))));
          if (wall > 0.01) {
            const up = deg < 0;
            ribs.push(piece('rib_' + n + '_wall', up ? B(a - th / 2, a - th / 2 + wall, -G.ww / 2, G.ww / 2) : B(a + th / 2 - wall, a + th / 2, -G.ww / 2, G.ww / 2),
              0, solid(lerpHex(w.c1, up ? '#FFFFFF' : '#000000', up ? 0.25 : 0.45))));
          }
        });
      }
    }
    layer('ribs', w.motion === 'slide', ribs, { b: face, r: faceR });

    const grip = [];
    if (g.on) {
      const gw = G.ww * g.width / 100;
      let a0, a1, mid = null, lineScale = 1;
      if (w.motion === 'roll') {
        // `fit` sizes the grip to exactly one tooth (with the ribs offset 0.5)
        const gam = g.fit && rb.on ? Math.max(0.01, step / 2 - (teeth ? gapHalf : 0)) : (g.length / 2) / G.R * 180 / Math.PI;
        const lo = Math.max(-TMAX, phi - gam), hi = Math.min(TMAX, phi + gam);
        if (hi - lo > 0.01) { a0 = rollAt(G, lo); a1 = rollAt(G, hi); }
        if (Math.abs(phi) < TMAX) { mid = rollAt(G, phi); lineScale = Math.cos(rad(phi)); }
      } else {
        mid = gripAt(s, G, v);
        a0 = mid - g.length / 2;
        a1 = mid + g.length / 2;
      }
      const glow = g.glow > 0 ? r3(g.glow * k) : 0;
      if (a0 !== undefined) {
        const gb = B(a0, a1, -gw / 2, gw / 2);
        const gr = round(s, gb, g.radius);
        if (g.shape === 'notch') {
          // A groove cut into the wheel, lit from above. Its top edge casts a
          // shadow inside and its bottom edge catches the light. As it turns,
          // one inner wall shows: the lit lower wall below the middle, the
          // shaded upper wall above it, up to most of the notch near the ends.
          const len = a1 - a0;
          grip.push(piece('grip', gb, gr, { kind: 'stops', dir: 'v', stops: [[0, lerpHex(g.c1, '#000000', 0.5), 1], [0.5, g.c1, 1], [1, lerpHex(g.c1, g.c2, 0.3), 1]] }, {
            edge: edgeOf(g.edge, g.edgeColor, k), glow: glow ? [glow, g.c2] : null
          }));
          const wall = Math.min(len * 0.85, g.depth * Math.abs(Math.sin(rad(phi))));
          if (wall > 0.01) {
            const up = phi > 0;
            grip.push(piece('grip_wall', up ? B(a1 - wall, a1, -gw / 2, gw / 2) : B(a0, a0 + wall, -gw / 2, gw / 2), 0, {
              kind: 'stops', dir: 'v',
              stops: up ? [[0, lerpHex(g.c1, '#000000', 0.7), 1], [1, lerpHex(g.c1, '#000000', 0.2), 1]] : [[0, lerpHex(g.c1, g.c2, 0.45), 1], [1, lerpHex(g.c1, g.c2, 0.85), 1]]
            }));
          }
          const rim = Math.max(0.3, len * 0.1);
          grip.push(piece('grip_rim', B(a1 - rim, a1, -gw / 2, gw / 2), 0, solid('#000000'), { alpha: 0.7 }));
          const lip0 = Math.max(G.f0, a0 - rim * 1.5);
          if (a0 - lip0 > 0.01) grip.push(piece('grip_lip', B(lip0, a0, -gw / 2, gw / 2), 0, solid(g.c2), { alpha: 0.85 }));
        } else {
          if (glow && g.shape === 'ellipse') {
            // A soft halo behind a glowing dot or ball
            const hs = Math.max(gw, a1 - a0) / 2 + g.glow * 0.6, gm = (a0 + a1) / 2;
            grip.push(piece('grip_halo', B(gm - hs, gm + hs, -hs, hs), 0, { kind: 'halo', color: g.c1, alpha: 0.55 }, { shape: 'ellipse' }));
          }
          // On a toothed wheel the grip is a raised tooth too, with its wall
          const gwl = teeth && w.motion === 'roll' ? wallOf(a0, a1, phi, g.c1) : null;
          if (gwl) grip.push(piece('grip_wall', { x: gb.x, y: gwl.b.y, w: gb.w, h: gwl.b.h }, gr, solid(gwl.color), { shape: g.shape }));
          grip.push(piece('grip', gb, gr, fillOf(g), {
            shape: g.shape, edge: edgeOf(g.edge, g.edgeColor, k), shadow: r3(g.shadow * k), glow: glow ? [glow, g.c1] : null
          }));
          // A rolling grip takes the same facet light as the teeth
          const f = rb.on && rb.shade > 0 && w.motion === 'roll' ? facet(rb.shade, phi) : null;
          if (f) grip.push(piece('grip_shade', gb, gr, solid(f[0]), { shape: g.shape, alpha: f[1] }));
        }
      }
      if (g.line > 0 && mid !== null) {
        const th = Math.max(0.05, g.line * lineScale);
        grip.push(piece('grip_line', B(mid - th / 2, mid + th / 2, -gw / 2, gw / 2), 0, solid(g.lineColor), { glow: glow ? [glow, g.lineColor] : null }));
      }
    }
    layer('grip', false, grip);
    return layers;
  }

  return { BASE, LIMITS, ENUMS, TMAX, lerpHex, frameSize, geometry, box, turn, gripAt, parts };
})();

function normalizeWheelSpec(raw) {
    return normalizeSpec(raw, WheelParts.BASE, WheelParts.LIMITS, WheelParts.ENUMS);
}

function wheelPaints(P) {
    if (P.kind === 'solid') return knobSolid(P.color);
    if (P.kind === 'fill') return knobPaints(P.fill, P.c1, P.c2, P.angle);
    if (P.kind === 'halo') {
        // Identity transform: centered, fading out at the ellipse's edge
        return [{
            type: 'GRADIENT_RADIAL',
            gradientTransform: [[1, 0, 0], [0, 1, 0]],
            gradientStops: [
                { position: 0, color: Object.assign(hexToRgb(P.color), { a: P.alpha }) },
                { position: 1, color: Object.assign(hexToRgb(P.color), { a: 0 }) }
            ]
        }];
    }
    return [{
        type: 'GRADIENT_LINEAR',
        gradientTransform: P.dir === 'v' ? [[0, 1, 0], [-1, 0, 1]] : [[1, 0, 0], [0, 1, 0]],
        gradientStops: P.stops.map(st => ({ position: st[0], color: Object.assign(hexToRgb(st[1]), { a: st[2] }) }))
    }];
}

// One piece as a rectangle or ellipse inside `parent`, whose top left sits
// at (ox, oy) in frame px
function wheelPieceNode(parent, p, ox, oy) {
    const n = p.shape === 'ellipse' ? figma.createEllipse() : figma.createRectangle();
    parent.appendChild(n);
    n.name = p.name;
    n.resize(Math.max(0.01, p.b.w), Math.max(0.01, p.b.h));
    n.x = p.b.x - ox;
    n.y = p.b.y - oy;
    if (p.shape !== 'ellipse' && p.r > 0) n.cornerRadius = Math.min(p.r, p.b.w / 2, p.b.h / 2);
    n.fills = wheelPaints(p.paint);
    if (p.alpha < 1) n.opacity = p.alpha;
    if (p.edge) knobEdge(n, p.edge[0], p.edge[1]);
    if (p.glow) n.effects = [knobGlowEffect(p.glow[1], p.glow[0])];
    else if (p.shadow > 0) n.effects = [knobShadowEffect(p.shadow, 50)];
    return n;
}

// A layer: one node, a group, or (for ribs) a frame clipped to the wheel face
function wheelBuildLayer(f, L) {
    if (!L.pieces.length) return null;
    if (L.clip) {
        const c = figma.createFrame();
        f.appendChild(c);
        c.name = L.layer;
        c.resize(Math.max(0.01, L.clip.b.w), Math.max(0.01, L.clip.b.h));
        c.x = L.clip.b.x;
        c.y = L.clip.b.y;
        c.fills = [];
        c.clipsContent = true;
        if (L.clip.r > 0) c.cornerRadius = Math.min(L.clip.r, L.clip.b.w / 2, L.clip.b.h / 2);
        L.pieces.forEach(p => wheelPieceNode(c, p, L.clip.b.x, L.clip.b.y));
        return c;
    }
    const nodes = L.pieces.map(p => wheelPieceNode(f, p, 0, 0));
    if (nodes.length === 1) {
        nodes[0].name = L.layer;
        return nodes[0];
    }
    const g = figma.group(nodes, f);
    g.name = L.layer;
    return g;
}

function createSpecWheelFrame(s, v, name, template) {
    const F = WheelParts.frameSize(s);
    const f = figma.createFrame();
    f.name = name;
    f.resize(F.w, F.h);
    f.fills = [];
    f.clipsContent = true;
    const fixed = [];
    WheelParts.parts(s, v).forEach((L, i) => {
        let node = null;
        if (L.fixed && template) {
            const src = template[i];
            if (src) {
                node = src.clone();
                f.appendChild(node);
                node.x = src.x;
                node.y = src.y;
            }
        } else {
            node = wheelBuildLayer(f, L);
        }
        if (L.fixed) fixed[i] = node;
    });
    return { frame: f, fixed };
}

const wheelTitle = s => (s.mode === 'pitch' ? 'Pitch wheel' : 'Mod wheel');

function createSpecWheel(s, value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    const wheel = createSpecWheelFrame(s, v, wheelTitle(s) + ' · ' + s.name).frame;
    wheel.setPluginData('wheelSpec', JSON.stringify(s));
    wheel.setPluginData('wheelKind', 'wheel');
    wheel.setPluginData('wheelValue', String(v));
    return wheel;
}

// Frame i shows value i / (frames - 1). Pitch wheels pin the middle frame to
// exactly 0.5, the resting position. Named "pitchwheel_sprite_128f" or
// "modwheel_sprite_128f": Vellum reads the frame count, and Vellum export
// maps the names to its pitchwheel and modwheel widgets.
function createSpecWheelStrip(s, frames, gap, axis) {
    return runStripSteps(wheelStripSteps(s, frames, gap, axis));
}

function* wheelStripSteps(s, frames, gap, axis) {
    frames = Math.max(2, Math.min(256, Math.round(Number(frames) || 128)));
    gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
    axis = axis === 'h' ? 'h' : 'v';
    const F = WheelParts.frameSize(s);
    const strip = figma.createFrame();
    strip.name = (s.mode === 'pitch' ? 'pitchwheel' : 'modwheel') + '_sprite_' + frames + 'f';
    strip.resize(
        axis === 'v' ? F.w : frames * F.w + (frames - 1) * gap,
        axis === 'v' ? frames * F.h + (frames - 1) * gap : F.h
    );
    strip.fills = [];
    strip.clipsContent = true;
    let template = null;
    for (let i = 0; i < frames; i++) {
        const built = createSpecWheelFrame(s, stripFrameValue(i, frames, s.mode === 'pitch'), 'frame_' + String(i).padStart(3, '0'), template);
        if (!template) template = built.fixed;
        strip.appendChild(built.frame);
        built.frame.x = axis === 'v' ? 0 : i * (F.w + gap);
        built.frame.y = axis === 'v' ? i * (F.h + gap) : 0;
        yield { strip, done: i + 1, total: frames };
    }
    strip.setPluginData('wheelSpec', JSON.stringify(s));
    strip.setPluginData('wheelKind', 'strip');
    strip.setPluginData('wheelStrip', JSON.stringify({ frames, gap, axis }));
    return strip;
}

////////////////////////////////////////////////////////////////////////////
// Panel spec: the panel studio's model. The plugin's background art at full
// size in px: a body (fill, texture, rounding, gloss, edge), side cheeks, a
// header with a title, a footer, a glass screen, a grid of titled sections
// and screws. panelParts() lists every piece in px, the same list as
// PanelCore.parts() in ui.html; keep the two in step.
//
// On the canvas a panel is a frame holding a locked "panel_art" frame at the
// back (pluginData panelArt). Controls go inside the panel frame; Vellum
// export skips the art and embeds it as the background image instead.
////////////////////////////////////////////////////////////////////////////
const PANEL_SPEC_BASE = {
    name: 'Custom', tier: 'free', width: 684, height: 483,
    body: { fill: 'linear', c1: '#2A2A30', c2: '#1C1C21', angle: 90, radius: 0, edge: 0, edgeColor: '#000000', gloss: 0 },
    texture: { on: false, style: 'brushed', color: '#FFFFFF', alpha: 5, spacing: 3 },
    ears: { on: false, width: 26, fill: 'linear', c1: '#7A4E2C', c2: '#4A2C16', angle: 0, edge: 0, edgeColor: '#000000' },
    header: { on: true, height: 44, fill: 'solid', c1: '#1E1E23', c2: '#141417', angle: 90, line: 1, lineColor: '#3A3A42', title: 'SYNTH', size: 18, bold: true, color: '#EDEBF2', align: 'left', inset: 20, tag: '', tagColor: '#8C8898' },
    footer: { on: false, height: 24, fill: 'solid', c1: '#141417', c2: '#0E0E10', angle: 90, line: 1, lineColor: '#2E2E34', text: '', size: 10, color: '#6E6A7A', align: 'right', inset: 16 },
    screen: { on: false, height: 90, width: 60, fill: 'linear', c1: '#0F1D17', c2: '#08110C', angle: 90, radius: 6, edge: 2, edgeColor: '#050807', gloss: 14 },
    sections: { on: true, cols: 3, rows: 1, margin: 16, gap: 12, style: 'fill', c1: '#232329', radius: 8, edge: 1, edgeColor: '#34343C', titles: 'OSC, FILTER, AMP', size: 10, color: '#8C8898', bold: true, align: 'left' },
    screws: { on: false, where: 'corners', size: 9, inset: 10, c1: '#B8B8C0', c2: '#5A5A62', slot: '#2A2A30' }
};
const PANEL_SPEC_LIMITS = {
    'width': [120, 2400], 'height': [80, 1600],
    'body.angle': [0, 360], 'body.radius': [0, 200], 'body.edge': [0, 20], 'body.gloss': [0, 100],
    'texture.alpha': [0, 100], 'texture.spacing': [2, 64],
    'ears.width': [4, 200], 'ears.angle': [0, 360], 'ears.edge': [0, 20],
    'header.height': [8, 300], 'header.angle': [0, 360], 'header.line': [0, 10], 'header.size': [4, 120], 'header.inset': [0, 400],
    'footer.height': [8, 200], 'footer.angle': [0, 360], 'footer.line': [0, 10], 'footer.size': [4, 80], 'footer.inset': [0, 400],
    'screen.height': [10, 1000], 'screen.width': [10, 100], 'screen.angle': [0, 360], 'screen.radius': [0, 100], 'screen.edge': [0, 20], 'screen.gloss': [0, 100],
    'sections.cols': [1, 8], 'sections.rows': [1, 4], 'sections.margin': [0, 200], 'sections.gap': [0, 200], 'sections.radius': [0, 100], 'sections.edge': [0, 20], 'sections.size': [4, 60],
    'screws.size': [3, 40], 'screws.inset': [2, 200]
};
const PANEL_FILLS = ['solid', 'linear', 'radial', 'conic'];
const PANEL_SPEC_ENUMS = {
    'body.fill': PANEL_FILLS, 'ears.fill': PANEL_FILLS, 'header.fill': PANEL_FILLS, 'footer.fill': PANEL_FILLS, 'screen.fill': PANEL_FILLS,
    'texture.style': ['brushed', 'stripes', 'grid', 'diagonal', 'crosshatch', 'dots', 'carbon', 'sandpaper', 'granite', 'triangles'],
    'header.align': ['left', 'center', 'right'], 'footer.align': ['left', 'center', 'right'],
    'sections.style': ['fill', 'outline', 'lines'], 'sections.align': ['left', 'center'],
    'screws.where': ['corners', 'ears']
};

function normalizePanelSpec(raw) {
    return normalizeSpec(raw, PANEL_SPEC_BASE, PANEL_SPEC_LIMITS, PANEL_SPEC_ENUMS);
}

function panelFrameSize(s) {
    return { w: Math.round(s.width), h: Math.round(s.height) };
}

// Integer hashes, so both sides pick the same lines and specks
function panelHash(i) {
    return (Math.imul(i + 1, 2654435761) >>> 0) % 5;
}

function panelRnd(i, j) {
    let h = Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Texture pieces in two shades. A piece is a rect {x, y, w, h}, or with k 'o'
// an ellipse, k 't' a triangle (apex top), turned `a` degrees about (x, y).
// Patterns laid out per cell grow their cell on big panels, so the build
// stays under ~6000 pieces. The patterns come from the old Polisher textures.
function panelTexture(t, W, H) {
    const light = [], dark = [];
    const sp = t.spacing, st = t.style;
    const cell = n => Math.max(sp, Math.sqrt(W * H * n / 6000));
    const cells = (c, fn) => {
        for (let i = 0; i * c < W; i++) for (let j = 0; j * c < H; j++) fn(i * c, j * c, i, j);
    };
    if (st === 'brushed') {
        for (let i = 0; i * sp < H; i++) {
            const k = panelHash(i);
            if (k < 2) light.push({ x: 0, y: i * sp, w: W, h: 1 });
            else if (k === 2) dark.push({ x: 0, y: i * sp, w: W, h: 1 });
        }
    } else if (st === 'stripes' || st === 'grid') {
        for (let i = 1; i * sp < W; i++) light.push({ x: i * sp, y: 0, w: 1, h: H });
        if (st === 'grid') for (let i = 1; i * sp < H; i++) light.push({ x: 0, y: i * sp, w: W, h: 1 });
    } else if (st === 'diagonal' || st === 'crosshatch') {
        // Lines x + y = c (and x - y = c - H), sp apart
        const step = sp * Math.SQRT2, len = H * Math.SQRT2;
        for (let k = 1; k * step < W + H; k++) {
            const c = k * step;
            light.push({ x: c - H, y: H, w: len, h: 1, a: -45 });
            if (st === 'crosshatch') light.push({ x: c - H, y: 0, w: len, h: 1, a: 45 });
        }
    } else if (st === 'dots') {
        const c = cell(1), d = Math.max(1, c / 5);
        cells(c, (x, y) => light.push({ x: x + (c - d) / 2, y: y + (c - d) / 2, w: d, h: d, k: 'o' }));
    } else if (st === 'carbon') {
        // Woven checker: each cell lit on one half, shaded on the other
        const c = cell(2);
        cells(c, (x, y, i, j) => {
            if ((i + j) % 2) {
                light.push({ x, y, w: c / 2, h: c });
                dark.push({ x: x + c / 2, y, w: c / 2, h: c });
            } else {
                light.push({ x, y, w: c, h: c / 2 });
                dark.push({ x, y: y + c / 2, w: c, h: c / 2 });
            }
        });
    } else if (st === 'sandpaper') {
        const c = cell(1);
        cells(c, (x, y, i, j) => {
            const p = { x: x + panelRnd(i, j) * (c - 1), y: y + panelRnd(j, i + 7) * (c - 1), w: 1, h: 1 };
            (panelRnd(i + 3, j + 5) < 0.5 ? light : dark).push(p);
        });
    } else if (st === 'granite') {
        // A bright speck of 1-2 px and a dark one per cell
        const c = cell(2);
        cells(c, (x, y, i, j) => {
            const d = panelRnd(i + 11, j) < 0.3 ? 2 : 1;
            light.push({ x: x + panelRnd(i, j) * (c - d), y: y + panelRnd(j, i + 7) * (c - d), w: d, h: d });
            dark.push({ x: x + panelRnd(i + 5, j + 2) * (c - 1), y: y + panelRnd(j + 9, i) * (c - 1), w: 1, h: 1 });
        });
    } else if (st === 'triangles') {
        const c = cell(1);
        cells(c, (x, y, i, j) => {
            const r = panelRnd(i, j);
            if (r < 0.5) return;
            const up = panelRnd(j, i + 3) < 0.5;
            (r < 0.75 ? light : dark).push(up ? { x, y, w: c, h: c, k: 't' } : { x: x + c, y: y + c, w: c, h: c, k: 't', a: 180 });
        });
    }
    // Edge cells hang over and get clipped; drop specks that land fully outside
    const keep = q => q.a || (q.x < W && q.y < H);
    return { light: light.filter(keep), dark: dark.filter(keep) };
}

// The bands and the content area the screen and sections share
function panelLayout(s) {
    const F = panelFrameSize(s);
    const W = F.w, H = F.h;
    const ew = s.ears.on ? Math.min(s.ears.width, W / 4) : 0;
    const x0 = ew, x1 = W - ew;
    const hh = s.header.on ? Math.min(s.header.height, H / 2) : 0;
    const fh = s.footer.on ? Math.min(s.footer.height, (H - hh) / 2) : 0;
    const m = s.sections.margin;
    const cx0 = x0 + m, cx1 = Math.max(cx0, x1 - m);
    const cy0 = hh + m, cy1 = Math.max(cy0, H - fh - m);
    return { F, W, H, ew, x0, x1, hh, fh, cx0, cx1, cy0, cy1 };
}

// Every piece of the panel in px
function panelParts(s) {
    const L = panelLayout(s);
    const W = L.W, H = L.H, x0 = L.x0, x1 = L.x1, hh = L.hh, fh = L.fh;
    const out = {
        W, H, body: { b: { x: 0, y: 0, w: W, h: H }, r: Math.min(s.body.radius, W / 2, H / 2) },
        header: null, footer: null, texture: null, ears: [], screen: null,
        sections: [], dividers: [], texts: [], screws: [], gloss: s.body.gloss, edge: s.body.edge
    };
    const text = (role, t, x, y, size, bold, color, align) => {
        t = String(t || '').trim();
        if (t) out.texts.push({ role, text: t, x, y, size, bold, color, align });
    };
    const anchor = (align, inset) => (align === 'left' ? x0 + inset : align === 'right' ? x1 - inset : W / 2);

    const h = s.header;
    if (h.on && hh > 0) {
        const line = Math.min(h.line, hh);
        out.header = { b: { x: x0, y: 0, w: x1 - x0, h: hh }, line: line > 0 ? { x: x0, y: hh - line, w: x1 - x0, h: line } : null };
        text('title', h.title, anchor(h.align, h.inset), hh / 2, h.size, h.bold, h.color, h.align);
        const tagAlign = h.align === 'right' ? 'left' : 'right';
        text('tag', h.tag, anchor(tagAlign, h.inset), hh / 2, h.size * 0.6, false, h.tagColor, tagAlign);
    }
    const f = s.footer;
    if (f.on && fh > 0) {
        const line = Math.min(f.line, fh);
        out.footer = { b: { x: x0, y: H - fh, w: x1 - x0, h: fh }, line: line > 0 ? { x: x0, y: H - fh, w: x1 - x0, h: line } : null };
        text('footer', f.text, anchor(f.align, f.inset), H - fh / 2, f.size, false, f.color, f.align);
    }

    if (s.texture.on) out.texture = panelTexture(s.texture, W, H);

    if (L.ew > 0) out.ears.push({ x: 0, y: 0, w: L.ew, h: H }, { x: W - L.ew, y: 0, w: L.ew, h: H });

    let gy0 = L.cy0;
    const sc = s.screen;
    if (sc.on && L.cx1 - L.cx0 > 1 && L.cy1 - L.cy0 > 1) {
        const sw = (L.cx1 - L.cx0) * sc.width / 100;
        const sh = Math.min(sc.height, L.cy1 - L.cy0);
        out.screen = { b: { x: (L.cx0 + L.cx1) / 2 - sw / 2, y: L.cy0, w: sw, h: sh }, r: Math.min(sc.radius, sw / 2, sh / 2) };
        gy0 = L.cy0 + sh + s.sections.gap;
    }

    const S = s.sections;
    if (S.on) {
        const cols = Math.round(S.cols), rows = Math.round(S.rows);
        const cw = (L.cx1 - L.cx0 - (cols - 1) * S.gap) / cols;
        const rh = (L.cy1 - gy0 - (rows - 1) * S.gap) / rows;
        if (cw > 1 && rh > 1) {
            const titles = S.titles.split(',');
            const pad = Math.max(6, S.size * 0.8);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const b = { x: L.cx0 + c * (cw + S.gap), y: gy0 + r * (rh + S.gap), w: cw, h: rh };
                    if (S.style !== 'lines') out.sections.push({ b, r: Math.min(S.radius, cw / 2, rh / 2) });
                    text('section', titles[r * cols + c], S.align === 'center' ? b.x + cw / 2 : b.x + pad, b.y + pad + S.size / 2, S.size, S.bold, S.color, S.align);
                }
            }
            if (S.style === 'lines') {
                const lw = Math.max(1, S.edge);
                for (let c = 1; c < cols; c++) out.dividers.push({ x: L.cx0 + c * (cw + S.gap) - S.gap / 2 - lw / 2, y: gy0, w: lw, h: L.cy1 - gy0 });
                for (let r = 1; r < rows; r++) out.dividers.push({ x: L.cx0, y: gy0 + r * (rh + S.gap) - S.gap / 2 - lw / 2, w: L.cx1 - L.cx0, h: lw });
            }
        }
    }

    const sw = s.screws;
    if (sw.on) {
        const d = sw.size, i = sw.inset;
        const xs = sw.where === 'ears' && L.ew > 0 ? [L.ew / 2, W - L.ew / 2] : [i, W - i];
        [i, H - i].forEach(y => xs.forEach(x => out.screws.push({
            b: { x: x - d / 2, y: y - d / 2, w: d, h: d },
            slot: { x: x - d * 0.35, y: y - d * 0.08, w: d * 0.7, h: d * 0.16 }
        })));
    }
    return out;
}

function panelRect(ctx, name, b, radius, paints) {
    const n = sliderShape(ctx, name, b, 'rect', radius);
    n.fills = paints;
    return n;
}

function panelBuildBody(ctx) {
    const s = ctx.s, P = ctx.P;
    return panelRect(ctx, 'body', P.body.b, P.body.r, knobPaints(s.body.fill, s.body.c1, s.body.c2, s.body.angle));
}

function panelBuildBand(ctx, key) {
    const d = ctx.s[key], part = ctx.P[key];
    if (!part) return null;
    const nodes = [panelRect(ctx, key + '_fill', part.b, 0, knobPaints(d.fill, d.c1, d.c2, d.angle))];
    if (part.line) nodes.push(panelRect(ctx, key + '_line', part.line, 0, knobSolid(d.lineColor)));
    return knobGroupOf(ctx, key, nodes);
}

// One texture piece: rect, ellipse (k 'o') or triangle (k 't'), turned `a` degrees about (x, y)
function panelPiece(ctx, name, p, hex) {
    let n;
    if (p.k === 't') {
        n = figma.createPolygon();
        n.pointCount = 3;
        ctx.f.appendChild(n);
        n.name = name;
        n.resize(Math.max(0.01, p.w), Math.max(0.01, p.h));
        n.x = p.x;
        n.y = p.y;
    } else {
        n = sliderShape(ctx, name, p, p.k === 'o' ? 'ellipse' : 'rect', 0);
    }
    if (p.a) {
        const r = p.a * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
        n.relativeTransform = [[c, -sn, p.x], [sn, c, p.y]];
    }
    n.fills = knobSolid(hex);
    return n;
}

// Pieces as one layer per shade: flattened in Figma, a group elsewhere
function panelLines(ctx, name, list, hex, alpha) {
    if (!list.length) return null;
    const rects = list.map((p, i) => panelPiece(ctx, name + '_' + (i + 1), p, hex));
    const n = typeof figma.flatten === 'function' ? figma.flatten(rects, ctx.f) : knobGroupOf(ctx, name, rects);
    n.name = name;
    n.opacity = alpha;
    return n;
}

function panelBuildTexture(ctx) {
    const t = ctx.s.texture, P = ctx.P;
    if (!P.texture) return null;
    return knobGroupOf(ctx, 'texture', [
        panelLines(ctx, 'texture_light', P.texture.light, t.color, t.alpha / 100),
        panelLines(ctx, 'texture_dark', P.texture.dark, '#000000', t.alpha / 100)
    ]);
}

function panelBuildEars(ctx) {
    const e = ctx.s.ears;
    return knobGroupOf(ctx, 'cheeks', ctx.P.ears.map((b, i) => {
        const n = panelRect(ctx, i ? 'cheek_right' : 'cheek_left', b, 0, knobPaints(e.fill, e.c1, e.c2, e.angle));
        knobEdge(n, e.edge, e.edgeColor);
        return n;
    }));
}

function panelBuildScreen(ctx) {
    const sc = ctx.s.screen, P = ctx.P;
    if (!P.screen) return null;
    const glass = panelRect(ctx, 'screen_glass', P.screen.b, P.screen.r, knobPaints(sc.fill, sc.c1, sc.c2, sc.angle));
    knobEdge(glass, sc.edge, sc.edgeColor);
    const nodes = [glass];
    if (sc.gloss > 0) nodes.push(panelRect(ctx, 'screen_gloss', P.screen.b, P.screen.r, [knobSheenPaint(sc.gloss)]));
    return knobGroupOf(ctx, 'screen_art', nodes);
}

function panelBuildSections(ctx) {
    const S = ctx.s.sections, P = ctx.P;
    const nodes = P.sections.map((x, i) => {
        const n = panelRect(ctx, 'section_' + (i + 1), x.b, x.r, S.style === 'fill' ? knobSolid(S.c1) : []);
        knobEdge(n, S.edge, S.edgeColor);
        return n;
    });
    P.dividers.forEach((b, i) => nodes.push(panelRect(ctx, 'divider_' + (i + 1), b, 0, knobSolid(S.edgeColor))));
    return knobGroupOf(ctx, 'sections', nodes);
}

// Texts sit on their anchor: x by alignment, y centered
function panelBuildTexts(ctx) {
    const nodes = ctx.P.texts.map(t => {
        const font = t.bold ? ctx.fonts.bold : ctx.fonts.regular;
        if (!font) return null;
        const n = figma.createText();
        ctx.f.appendChild(n);
        n.name = t.role + ': ' + t.text;
        n.fontName = font;
        n.fontSize = Math.max(1, t.size);
        n.characters = t.text;
        n.textAutoResize = 'WIDTH_AND_HEIGHT';
        n.textAlignHorizontal = t.align === 'left' ? 'LEFT' : t.align === 'right' ? 'RIGHT' : 'CENTER';
        n.fills = knobSolid(t.color);
        n.x = t.align === 'left' ? t.x : t.align === 'right' ? t.x - n.width : t.x - n.width / 2;
        n.y = t.y - n.height / 2;
        return n;
    });
    return knobGroupOf(ctx, 'titles', nodes);
}

function panelBuildScrews(ctx) {
    const sw = ctx.s.screws;
    return knobGroupOf(ctx, 'screws', ctx.P.screws.map((x, i) => {
        const head = sliderShape(ctx, 'head', x.b, 'ellipse', 0);
        head.fills = knobPaints('radial', sw.c1, sw.c2, 225);
        const slot = panelRect(ctx, 'slot', x.slot, x.slot.h / 2, knobSolid(sw.slot));
        const g = figma.group([head, slot], ctx.f);
        g.name = 'screw_' + (i + 1);
        return g;
    }));
}

function panelBuildGloss(ctx) {
    const P = ctx.P;
    if (P.gloss <= 0) return null;
    return panelRect(ctx, 'gloss', P.body.b, P.body.r, [knobSheenPaint(P.gloss)]);
}

function panelBuildEdge(ctx) {
    const P = ctx.P;
    if (P.edge <= 0) return null;
    const n = panelRect(ctx, 'edge', P.body.b, P.body.r, []);
    knobEdge(n, P.edge, ctx.s.body.edgeColor);
    return n;
}

// Bottom to top
const PANEL_LAYERS = [
    panelBuildBody,
    ctx => panelBuildBand(ctx, 'header'),
    ctx => panelBuildBand(ctx, 'footer'),
    panelBuildTexture, panelBuildEars, panelBuildScreen, panelBuildSections,
    panelBuildTexts, panelBuildScrews, panelBuildGloss, panelBuildEdge
];

// Inter ships with Figma; without it the titles are left out rather than failing the build
function panelLoadFonts(s) {
    return __awaiter(this, void 0, void 0, function* () {
        const P = panelParts(s);
        const load = (want, style) => __awaiter(this, void 0, void 0, function* () {
            if (!want) return null;
            const font = { family: 'Inter', style };
            try {
                yield figma.loadFontAsync(font);
                return font;
            } catch (e) {
                return null;
            }
        });
        return {
            regular: yield load(P.texts.some(t => !t.bold), 'Regular'),
            bold: yield load(P.texts.some(t => t.bold), 'Bold')
        };
    });
}

// The art alone: a clipped frame the size of the panel, exportable at 2x
function createSpecPanelArt(s, fonts) {
    const P = panelParts(s);
    const f = figma.createFrame();
    f.name = 'panel_art';
    f.resize(P.W, P.H);
    f.fills = [];
    f.clipsContent = true;
    f.cornerRadius = P.body.r;
    const ctx = { s, f, P, fonts };
    PANEL_LAYERS.forEach(build => build(ctx));
    f.setPluginData('panelArt', '1');
    f.exportSettings = [{ format: 'PNG', suffix: '@2x', constraint: { type: 'SCALE', value: 2 } }];
    f.locked = true;
    return f;
}

function panelArtOf(panel) {
    return 'children' in panel ? panel.children.find(c => c.getPluginData('panelArt') === '1') || null : null;
}

function createSpecPanel(s) {
    return __awaiter(this, void 0, void 0, function* () {
        const fonts = yield panelLoadFonts(s);
        const F = panelFrameSize(s);
        const panel = figma.createFrame();
        panel.name = 'Panel · ' + s.name;
        panel.resize(F.w, F.h);
        panel.fills = [];
        panel.clipsContent = true;
        panel.cornerRadius = panelParts(s).body.r;
        const art = createSpecPanelArt(s, fonts);
        panel.appendChild(art);
        art.x = 0;
        art.y = 0;
        panel.setPluginData('panelSpec', JSON.stringify(s));
        panel.setPluginData('panelKind', 'panel');
        return panel;
    });
}

// Swaps the art in place, keeping every control placed on the panel
function updateSpecPanel(panel, s) {
    return __awaiter(this, void 0, void 0, function* () {
        const fonts = yield panelLoadFonts(s);
        const F = panelFrameSize(s);
        const old = panelArtOf(panel);
        const art = createSpecPanelArt(s, fonts);
        panel.insertChild(old ? panel.children.indexOf(old) : 0, art);
        art.x = 0;
        art.y = 0;
        if (old) old.remove();
        panel.resize(F.w, F.h);
        panel.cornerRadius = panelParts(s).body.r;
        panel.name = 'Panel · ' + s.name;
        panel.setPluginData('panelSpec', JSON.stringify(s));
        return panel;
    });
}

////////////////////////////////////////////////////////////////////////////
// BYOC: strips from the user's own images (often from an AI tool). The UI
// cleans the images (background, trim, centering) and sends them as PNG
// bytes by role: main (knob, fader cap, button off), on (button on), track
// (fader track), base + cap (a knob turning only its center). The spec holds
// geometry only; byocParts() lists one frame's pieces in px, the same list
// as ByocCore.parts() in ui.html; keep the two in step. Each image is stored
// once and every frame places it, so the strip stays sharp at any export
// scale.
////////////////////////////////////////////////////////////////////////////
const BYOC_SPEC_BASE = {
    name: 'My knob', type: 'knob',
    aspect: { main: 1, on: 0, track: 0 },
    knob: { size: 110, scale: 100, sweep: 270, endless: false, pointer: 0, mode: 'whole', cap: 60, ring: false, ringColor: '#8A5CF6', ringTrack: '#34343C', ringWidth: 7 },
    fader: { orient: 'v', length: 109, thickness: 21, cap: 100, inset: 0, track: 'drawn', trackColor: '#141417', trackWidth: 20 },
    button: { width: 80, height: 32, scale: 100, on: 'glow', glowColor: '#8A5CF6', glow: 12, bright: 35 }
};
const BYOC_SPEC_LIMITS = {
    'aspect.main': [0, 50], 'aspect.on': [0, 50], 'aspect.track': [0, 50],
    'knob.size': [8, 512], 'knob.scale': [20, 150], 'knob.sweep': [30, 360], 'knob.pointer': [-180, 180], 'knob.cap': [10, 95], 'knob.ringWidth': [2, 25],
    'fader.length': [16, 1024], 'fader.thickness': [4, 512], 'fader.cap': [10, 300], 'fader.inset': [0, 200], 'fader.trackWidth': [1, 100],
    'button.width': [8, 512], 'button.height': [8, 512], 'button.scale': [20, 150], 'button.glow': [0, 60], 'button.bright': [0, 100]
};
const BYOC_SPEC_ENUMS = {
    'type': ['knob', 'fader', 'button'], 'knob.mode': ['whole', 'center'],
    'fader.orient': ['v', 'h'], 'fader.track': ['drawn', 'image', 'none'], 'button.on': ['glow', 'bright', 'press', 'image']
};

function normalizeByocSpec(raw) {
    return normalizeSpec(raw, BYOC_SPEC_BASE, BYOC_SPEC_LIMITS, BYOC_SPEC_ENUMS);
}

function byocFrameSize(s) {
    if (s.type === 'knob') return { w: Math.round(s.knob.size), h: Math.round(s.knob.size) };
    if (s.type === 'fader') {
        const L = Math.round(s.fader.length), T = Math.round(s.fader.thickness);
        return s.fader.orient === 'v' ? { w: T, h: L } : { w: L, h: T };
    }
    return { w: Math.round(s.button.width), h: Math.round(s.button.height) };
}

// Largest box of aspect `ar` (w / h) inside w × h, centered on (cx, cy)
function byocContain(w, h, ar, cx, cy) {
    ar = ar > 0 ? ar : 1;
    const bw = Math.min(w, h * ar), bh = bw / ar;
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function byocImg(role, b, rot, glow, exposure) {
    return { kind: 'img', img: role, x: b.x, y: b.y, w: b.w, h: b.h, rot: rot || 0, glow: glow || null, exposure: exposure || 0 };
}

// One frame at value v. Arc angles are degrees clockwise from 3 o'clock;
// `rot` turns an image about its own center.
function byocParts(s, v) {
    const F = byocFrameSize(s), W = F.w, H = F.h;
    const pieces = [];
    if (s.type === 'knob') {
        const k = s.knob;
        let d = W * k.scale / 100;
        // An endless knob has no range to fill, so no value ring
        if (k.ring && !k.endless) {
            const r1 = W / 2, rw = W * k.ringWidth / 100, r0 = r1 - rw;
            const a0 = 270 - k.sweep / 2;
            pieces.push({ kind: 'arc', cx: W / 2, cy: H / 2, r0, r1, a0, a1: a0 + k.sweep, color: k.ringTrack });
            if (v > 0) pieces.push({ kind: 'arc', cx: W / 2, cy: H / 2, r0, r1, a0, a1: a0 + k.sweep * v, color: k.ringColor });
            d = (W - 2 * rw * 1.6) * k.scale / 100;
        }
        // The image's own pointer sits at k.pointer (0 = straight up).
        // Endless knobs start pointing straight up and turn all the way round.
        const rot = k.endless ? 360 * v - k.pointer : -k.sweep / 2 + k.sweep * v - k.pointer;
        const b = { x: (W - d) / 2, y: (H - d) / 2, w: d, h: d };
        if (k.mode === 'center') pieces.push(byocImg('base', b, 0), byocImg('cap', b, rot));
        else pieces.push(byocImg('main', b, rot));
    } else if (s.type === 'fader') {
        const f = s.fader, vert = f.orient === 'v';
        const L = vert ? H : W, T = vert ? W : H;
        if (f.track === 'image' && s.aspect.track > 0) {
            pieces.push(byocImg('track', byocContain(W, H, s.aspect.track, W / 2, H / 2)));
        } else if (f.track === 'drawn') {
            const tw = T * f.trackWidth / 100, len = Math.max(0, L - 2 * f.inset);
            const b = vert ? { x: (T - tw) / 2, y: f.inset, w: tw, h: len } : { x: f.inset, y: (T - tw) / 2, w: len, h: tw };
            pieces.push({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, r: Math.min(b.w, b.h) / 2, color: f.trackColor });
        }
        const am = s.aspect.main > 0 ? s.aspect.main : 1;
        const across = T * f.cap / 100;
        const along = Math.min(L, vert ? across / am : across * am);
        const lo = f.inset + along / 2, hi = L - f.inset - along / 2;
        // Value 0 at the bottom (vertical) or left (horizontal)
        const pos = hi >= lo ? (vert ? hi - (hi - lo) * v : lo + (hi - lo) * v) : L / 2;
        pieces.push(byocImg('main', vert
            ? { x: (T - across) / 2, y: pos - along / 2, w: across, h: along }
            : { x: pos - along / 2, y: (T - across) / 2, w: along, h: across }));
    } else {
        const b = s.button, on = v >= 0.5;
        const role = on && b.on === 'image' && s.aspect.on > 0 ? 'on' : 'main';
        let box = byocContain(W * b.scale / 100, H * b.scale / 100, s.aspect[role], W / 2, H / 2);
        if (on && b.on === 'press') box = byocContain(box.w * 0.94, box.h * 0.94, s.aspect[role], W / 2, H / 2 + box.h * 0.02);
        const glow = on && b.on === 'glow' && b.glow > 0 ? { color: b.glowColor, r: b.glow } : null;
        const exposure = !on ? 0 : b.on === 'bright' ? b.bright / 100 : b.on === 'press' ? -0.25 : 0;
        pieces.push(byocImg(role, box, 0, glow, exposure));
    }
    return { W, H, pieces };
}

function byocFrameCount(s, frames) {
    return s.type === 'button' ? 2 : Math.max(2, Math.min(256, Math.round(Number(frames) || 128)));
}

// Value drawn in frame i of n. An endless knob stops one step short of a
// full turn, so its strip loops without showing an angle twice.
function byocFrameValue(s, i, n) {
    return s.type === 'knob' && s.knob.endless ? i / n : i / (n - 1);
}

function byocStripName(s, frames) {
    const kind = s.type === 'knob' && s.knob.endless ? 'knob_endless' : { knob: 'knob', fader: 'slider', button: 'button' }[s.type];
    return kind + '_sprite_' + byocFrameCount(s, frames) + 'f';
}

// One cell. hashes: { role: imageHash }
function createByocFrame(s, v, name, hashes) {
    const F = byocFrameSize(s);
    const f = figma.createFrame();
    f.name = name;
    f.resize(F.w, F.h);
    f.fills = [];
    f.clipsContent = true;
    byocParts(s, v).pieces.forEach(p => {
        if (p.kind === 'arc') {
            const n = figma.createEllipse();
            f.appendChild(n);
            n.name = 'ring';
            n.resize(2 * p.r1, 2 * p.r1);
            n.x = p.cx - p.r1;
            n.y = p.cy - p.r1;
            n.arcData = { startingAngle: p.a0 * Math.PI / 180, endingAngle: p.a1 * Math.PI / 180, innerRadius: Math.max(0, Math.min(0.999, p.r0 / p.r1)) };
            n.fills = knobSolid(p.color);
        } else if (p.kind === 'rect') {
            const n = figma.createRectangle();
            f.appendChild(n);
            n.name = 'track';
            n.resize(Math.max(0.01, p.w), Math.max(0.01, p.h));
            n.x = p.x;
            n.y = p.y;
            n.cornerRadius = p.r;
            n.fills = knobSolid(p.color);
        } else {
            const n = figma.createRectangle();
            f.appendChild(n);
            n.name = p.img;
            const w = Math.max(0.01, p.w), h = Math.max(0.01, p.h);
            n.resize(w, h);
            const paint = { type: 'IMAGE', scaleMode: 'FILL', imageHash: hashes[p.img] || null };
            if (p.exposure) paint.filters = { exposure: p.exposure };
            n.fills = hashes[p.img] ? [paint] : [];
            // Turn about the piece's center
            const r = p.rot * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
            const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
            n.relativeTransform = [[c, -sn, cx - (c * w / 2 - sn * h / 2)], [sn, c, cy - (sn * w / 2 + c * h / 2)]];
            if (p.glow) n.effects = [knobGlowEffect(p.glow.color, p.glow.r)];
        }
    });
    return f;
}

// A frame of equal cells, frame 0 at the minimum (buttons: off, on)
function createByocStrip(s, frames, gap, axis, hashes) {
    frames = byocFrameCount(s, frames);
    gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
    axis = axis === 'h' ? 'h' : 'v';
    const F = byocFrameSize(s);
    const cell = axis === 'v' ? F.h : F.w;
    const along = frames * cell + (frames - 1) * gap;
    const strip = figma.createFrame();
    strip.name = byocStripName(s, frames);
    strip.resize(axis === 'v' ? F.w : along, axis === 'v' ? along : F.h);
    strip.fills = [];
    strip.clipsContent = true;
    for (let i = 0; i < frames; i++) {
        const fr = createByocFrame(s, byocFrameValue(s, i, frames), 'frame_' + String(i).padStart(3, '0'), hashes);
        strip.appendChild(fr);
        fr.x = axis === 'v' ? 0 : i * (cell + gap);
        fr.y = axis === 'v' ? i * (cell + gap) : 0;
    }
    strip.setPluginData('byocSpec', JSON.stringify(s));
    strip.setPluginData('byocKind', 'strip');
    strip.setPluginData('byocStrip', JSON.stringify({ frames, gap, axis }));
    strip.setPluginData('byocImages', JSON.stringify(hashes));
    return strip;
}

// The images of a BYOC strip, as PNG bytes by role, for loading it back
function byocImageBytes(node) {
    return __awaiter(this, void 0, void 0, function* () {
        let hashes = {};
        try { hashes = JSON.parse(node.getPluginData('byocImages') || '{}'); } catch (e) { hashes = {}; }
        const out = {};
        for (const role of Object.keys(hashes)) {
            const image = hashes[role] ? figma.getImageByHash(hashes[role]) : null;
            if (image) out[role] = yield image.getBytesAsync();
        }
        return out;
    });
}

// Helper function to convert hex to RGB
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
}

// Selection change handler: status bar, "Frames from selected knob", studio Load/Update
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  let hasKnob = false;

  if (selection.length === 1 && selection[0].type === 'GROUP') {
    const selectedGroup = selection[0];

    // Knobs made by the old knob builder (still supported by duplicateKnob)
    const hasRotateKnob = selectedGroup.findOne(node => node.name === "rotate_knob");
    const hasRotateKnobBody = selectedGroup.findOne(node => node.name === "rotate_knob_body");
    const hasRotateIndicator = selectedGroup.findOne(node => node.name === "rotate_indicator");
    
    // Consider it a knob if it has rotate_knob (flattened) OR (rotate_knob_body AND rotate_indicator)
    if (hasRotateKnob || (hasRotateKnobBody && hasRotateIndicator)) {
      hasKnob = true;
    }
  }

  // Knobs and strips built by the studio carry their spec, so the studio can
  // load them back for editing
  let knobSpec = '';
  let knobKind = '';
  let knobStrip = '';
  let sliderSpec = '';
  let sliderKind = '';
  let sliderStrip = '';
  let buttonSpec = '';
  let buttonKind = '';
  let buttonStrip = '';
  let meterSpec = '';
  let meterKind = '';
  let meterStrip = '';
  let wheelSpec = '';
  let wheelKind = '';
  let wheelStrip = '';
  let panelSpec = '';
  let panelKind = '';
  let byocSpec = '';
  let byocKind = '';
  if (selection.length === 1) {
    // The art frame stands for its panel
    const panelNode = selection[0].getPluginData('panelArt') === '1' && selection[0].parent ? selection[0].parent : selection[0];
    panelKind = panelNode.getPluginData ? panelNode.getPluginData('panelKind') : '';
    if (panelKind) panelSpec = panelNode.getPluginData('panelSpec');
    meterKind = selection[0].getPluginData('meterKind');
    if (meterKind) {
      meterSpec = selection[0].getPluginData('meterSpec');
      meterStrip = selection[0].getPluginData('meterStrip');
    }
    wheelKind = selection[0].getPluginData('wheelKind');
    if (wheelKind) {
      wheelSpec = selection[0].getPluginData('wheelSpec');
      wheelStrip = selection[0].getPluginData('wheelStrip');
    }
    buttonKind = selection[0].getPluginData('buttonKind');
    if (buttonKind) {
      buttonSpec = selection[0].getPluginData('buttonSpec');
      buttonStrip = selection[0].getPluginData('buttonStrip');
    }
    knobKind = selection[0].getPluginData('knobKind');
    if (knobKind) {
      knobSpec = selection[0].getPluginData('knobSpec');
      knobStrip = selection[0].getPluginData('knobStrip');
      if (knobKind === 'knob') hasKnob = true;
    }
    sliderKind = selection[0].getPluginData('sliderKind');
    if (sliderKind) {
      sliderSpec = selection[0].getPluginData('sliderSpec');
      sliderStrip = selection[0].getPluginData('sliderStrip');
    }
    byocKind = selection[0].getPluginData('byocKind');
    if (byocKind) byocSpec = selection[0].getPluginData('byocSpec');
  }

  // Send message to UI to update button states
  figma.ui.postMessage({
    type: 'selection-changed',
    selectionName: selection.length === 1 ? selection[0].name : '',
    selectionCount: selection.length,
    hasKnob: hasKnob,
    knobSpec: knobSpec,
    knobKind: knobKind,
    knobStrip: knobStrip,
    sliderSpec: sliderSpec,
    sliderKind: sliderKind,
    sliderStrip: sliderStrip,
    buttonSpec: buttonSpec,
    buttonKind: buttonKind,
    buttonStrip: buttonStrip,
    meterSpec: meterSpec,
    meterKind: meterKind,
    meterStrip: meterStrip,
    wheelSpec: wheelSpec,
    wheelKind: wheelKind,
    wheelStrip: wheelStrip,
    panelSpec: panelSpec,
    panelKind: panelKind,
    byocSpec: byocSpec,
    byocKind: byocKind
  });
});
// Create Inst 3C1 Panel Design
async function createInst3C1Panel() {
  
  // Panel dimensions
  const panelWidth = 684;
  const panelHeight = 483;
  const panelX = 0;
  const panelY = 0;
  
  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Inst 3C1 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]; // White background
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; // Black border
  panel.strokeWeight = 1;
  
  // Create vertical divider lines
  const lineV1 = figma.createLine();
  lineV1.name = "Line V";
  lineV1.x = 228.5;
  lineV1.y = 0;
  lineV1.resize(0, panelHeight);
  lineV1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV1.strokeWeight = 1;
  
  const lineV2 = figma.createLine();
  lineV2.name = "Line V_2";
  lineV2.x = 453.5;
  lineV2.y = 0;
  lineV2.resize(0, panelHeight);
  lineV2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV2.strokeWeight = 1;
  
  // Create knobs
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(110, 110); // r=55, so diameter=110
  knob1.x = 342.5 - 55;
  knob1.y = 378.5 - 55;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;
  
  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(53, 53); // r=26.5, so diameter=53
  knob2.x = 391 - 26.5;
  knob2.y = 135 - 26.5;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;
  
  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(35, 35); // r=17.5, so diameter=35
  knob3.x = 518 - 17.5;
  knob3.y = 132 - 17.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;
  
  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(53, 53); // r=26.5, so diameter=53
  knob4.x = 293 - 26.5;
  knob4.y = 135 - 26.5;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;
  
  // Create buttons
  const button1 = figma.createRectangle();
  button1.name = "Button";
  button1.resize(69, 69);
  button1.x = 494.5;
  button1.y = 284.5;
  button1.fills = [];
  button1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button1.strokeWeight = 1;
  
  const button2 = figma.createRectangle();
  button2.name = "Button_2";
  button2.resize(69, 69);
  button2.x = 494.5;
  button2.y = 362.5;
  button2.fills = [];
  button2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button2.strokeWeight = 1;
  
  const button3 = figma.createRectangle();
  button3.name = "Button_3";
  button3.resize(69, 69);
  button3.x = 572.5;
  button3.y = 284.5;
  button3.fills = [];
  button3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button3.strokeWeight = 1;
  
  const button4 = figma.createRectangle();
  button4.name = "Button_4";
  button4.resize(69, 69);
  button4.x = 572.5;
  button4.y = 362.5;
  button4.fills = [];
  button4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button4.strokeWeight = 1;
  
  // Create small buttons
  const button5 = figma.createRectangle();
  button5.name = "Button_5";
  button5.resize(68, 18);
  button5.x = 42.5;
  button5.y = 34.5;
  button5.fills = [];
  button5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button5.strokeWeight = 1;
  
  const button6 = figma.createRectangle();
  button6.name = "Button_6";
  button6.resize(68, 18);
  button6.x = 118.5;
  button6.y = 34.5;
  button6.fills = [];
  button6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button6.strokeWeight = 1;
  
  const button7 = figma.createRectangle();
  button7.name = "Button_7";
  button7.resize(42, 18);
  button7.x = 496.5;
  button7.y = 34.5;
  button7.fills = [];
  button7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button7.strokeWeight = 1;
  
  const button8 = figma.createRectangle();
  button8.name = "Button_8";
  button8.resize(42, 18);
  button8.x = 547.5;
  button8.y = 34.5;
  button8.fills = [];
  button8.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button8.strokeWeight = 1;
  
  const button9 = figma.createRectangle();
  button9.name = "Button_9";
  button9.resize(42, 18);
  button9.x = 598.5;
  button9.y = 34.5;
  button9.fills = [];
  button9.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button9.strokeWeight = 1;
  
  const button10 = figma.createRectangle();
  button10.name = "Button_10";
  button10.resize(12, 12);
  button10.x = 498.5;
  button10.y = 211.5;
  button10.fills = [];
  button10.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button10.strokeWeight = 1;
  
  const button11 = figma.createRectangle();
  button11.name = "Button_11";
  button11.resize(12, 12);
  button11.x = 525.5;
  button11.y = 211.5;
  button11.fills = [];
  button11.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button11.strokeWeight = 1;
  
  // Create VU Meter
  const vuMeter = figma.createRectangle();
  vuMeter.name = "VU Meter";
  vuMeter.resize(169, 87);
  vuMeter.x = 30.5;
  vuMeter.y = 108.5;
  vuMeter.fills = [];
  vuMeter.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  vuMeter.strokeWeight = 1;
  
  // Create sliders
  const slider1 = figma.createRectangle();
  slider1.name = "Slider";
  slider1.resize(124, 13);
  slider1.x = 279.5;
  slider1.y = 210.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;
  
  const slider2 = figma.createRectangle();
  slider2.name = "Slider_2";
  slider2.resize(124, 13);
  slider2.x = 279.5;
  slider2.y = 258.5;
  slider2.fills = [];
  slider2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider2.strokeWeight = 1;
  
  // Create fader
  const fader = figma.createRectangle();
  fader.name = "Fader";
  fader.resize(21, 109);
  fader.x = 607.5;
  fader.y = 114.5;
  fader.fills = [];
  fader.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader.strokeWeight = 1;
  
  // Create menus
  const menu1 = figma.createRectangle();
  menu1.name = "Menu";
  menu1.resize(167, 18);
  menu1.x = 257.5;
  menu1.y = 34.5;
  menu1.fills = [];
  menu1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  menu1.strokeWeight = 1;
  
  const menu2 = figma.createRectangle();
  menu2.name = "Menu_2";
  menu2.resize(169, 159);
  menu2.x = 30.5;
  menu2.y = 272.5;
  menu2.fills = [];
  menu2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  menu2.strokeWeight = 1;
  
  // Group all elements
  const inst3C1Group = figma.group([
    panel, lineV1, lineV2,
    knob1, knob2, knob3, knob4,
    button1, button2, button3, button4,
    button5, button6, button7, button8, button9, button10, button11,
    vuMeter, slider1, slider2, fader, menu1, menu2
  ], figma.currentPage);
  
  inst3C1Group.name = "Inst 3C1 Panel";
  
  // Center the panel on the canvas
  inst3C1Group.x = figma.viewport.center.x - panelWidth / 2;
  inst3C1Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [inst3C1Group];
  figma.viewport.scrollAndZoomIntoView([inst3C1Group]);
  
  
  return inst3C1Group;
}
async function createInst3C2Panel() {
  const panelWidth = 684;
  const panelHeight = 483;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Inst 3C2 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create vertical lines
  const lineV1 = figma.createLine();
  lineV1.name = "Line V";
  lineV1.x = 230.5;
  lineV1.y = 0;
  lineV1.resize(0, panelHeight);
  lineV1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV1.strokeWeight = 1;

  const lineV2 = figma.createLine();
  lineV2.name = "Line V_2";
  lineV2.x = 455.5;
  lineV2.y = 0;
  lineV2.resize(0, panelHeight);
  lineV2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV2.strokeWeight = 1;

  // Create knobs
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(110, 110);
  knob1.x = 341.5 - 55;
  knob1.y = 186.5 - 55;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(53, 53);
  knob2.x = 65 - 26.5;
  knob2.y = 90 - 26.5;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(35, 35);
  knob3.x = 164 - 17.5;
  knob3.y = 276 - 17.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(35, 35);
  knob4.x = 164 - 17.5;
  knob4.y = 184 - 17.5;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;

  const knob5 = figma.createEllipse();
  knob5.name = "Knob_5";
  knob5.resize(35, 35);
  knob5.x = 65 - 17.5;
  knob5.y = 184 - 17.5;
  knob5.fills = [];
  knob5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob5.strokeWeight = 1;

  const knob6 = figma.createEllipse();
  knob6.name = "Knob_6";
  knob6.resize(53, 53);
  knob6.x = 164 - 26.5;
  knob6.y = 90 - 26.5;
  knob6.fills = [];
  knob6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob6.strokeWeight = 1;

  // Create buttons
  const button1 = figma.createRectangle();
  button1.name = "Button";
  button1.resize(69, 69);
  button1.x = 496.5;
  button1.y = 143.5;
  button1.fills = [];
  button1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button1.strokeWeight = 1;

  const button2 = figma.createRectangle();
  button2.name = "Button_2";
  button2.resize(69, 69);
  button2.x = 496.5;
  button2.y = 63.5;
  button2.fills = [];
  button2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button2.strokeWeight = 1;

  const button3 = figma.createRectangle();
  button3.name = "Button_3";
  button3.resize(69, 69);
  button3.x = 496.5;
  button3.y = 221.5;
  button3.fills = [];
  button3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button3.strokeWeight = 1;

  const button4 = figma.createRectangle();
  button4.name = "Button_4";
  button4.resize(69, 69);
  button4.x = 574.5;
  button4.y = 143.5;
  button4.fills = [];
  button4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button4.strokeWeight = 1;

  const button5 = figma.createRectangle();
  button5.name = "Button_5";
  button5.resize(69, 69);
  button5.x = 574.5;
  button5.y = 63.5;
  button5.fills = [];
  button5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button5.strokeWeight = 1;

  const button6 = figma.createRectangle();
  button6.name = "Button_6";
  button6.resize(69, 69);
  button6.x = 574.5;
  button6.y = 221.5;
  button6.fills = [];
  button6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button6.strokeWeight = 1;

  const button7 = figma.createRectangle();
  button7.name = "Button_7";
  button7.resize(68, 18);
  button7.x = 498.5;
  button7.y = 415.5;
  button7.fills = [];
  button7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button7.strokeWeight = 1;

  const button8 = figma.createRectangle();
  button8.name = "Button_8";
  button8.resize(68, 18);
  button8.x = 574.5;
  button8.y = 415.5;
  button8.fills = [];
  button8.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button8.strokeWeight = 1;

  const button9 = figma.createRectangle();
  button9.name = "Button_9";
  button9.resize(42, 18);
  button9.x = 498.5;
  button9.y = 360.5;
  button9.fills = [];
  button9.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button9.strokeWeight = 1;

  const button10 = figma.createRectangle();
  button10.name = "Button_10";
  button10.resize(42, 18);
  button10.x = 549.5;
  button10.y = 360.5;
  button10.fills = [];
  button10.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button10.strokeWeight = 1;

  const button11 = figma.createRectangle();
  button11.name = "Button_11";
  button11.resize(42, 18);
  button11.x = 600.5;
  button11.y = 360.5;
  button11.fills = [];
  button11.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button11.strokeWeight = 1;

  const button12 = figma.createRectangle();
  button12.name = "Button_12";
  button12.resize(12, 12);
  button12.x = 144.5;
  button12.y = 356.5;
  button12.fills = [];
  button12.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button12.strokeWeight = 1;

  const button13 = figma.createRectangle();
  button13.name = "Button_13";
  button13.resize(12, 12);
  button13.x = 171.5;
  button13.y = 356.5;
  button13.fills = [];
  button13.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button13.strokeWeight = 1;

  // Create slider
  const slider1 = figma.createRectangle();
  slider1.name = "Slider";
  slider1.resize(124, 13);
  slider1.x = 52.5;
  slider1.y = 421.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  // Create menu
  const menu1 = figma.createRectangle();
  menu1.name = "Menu";
  menu1.resize(167, 18);
  menu1.x = 259.5;
  menu1.y = 54.5;
  menu1.fills = [];
  menu1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  menu1.strokeWeight = 1;

  // Create faders
  const fader1 = figma.createRectangle();
  fader1.name = "Fader";
  fader1.resize(21, 109);
  fader1.x = 379.5;
  fader1.y = 326.5;
  fader1.fills = [];
  fader1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader1.strokeWeight = 1;

  const fader2 = figma.createRectangle();
  fader2.name = "Fader_2";
  fader2.resize(21, 109);
  fader2.x = 331.5;
  fader2.y = 326.5;
  fader2.fills = [];
  fader2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader2.strokeWeight = 1;

  const fader3 = figma.createRectangle();
  fader3.name = "Fader_3";
  fader3.resize(21, 109);
  fader3.x = 283.5;
  fader3.y = 326.5;
  fader3.fills = [];
  fader3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader3.strokeWeight = 1;

  const fader4 = figma.createRectangle();
  fader4.name = "Fader_4";
  fader4.resize(21, 109);
  fader4.x = 54.5;
  fader4.y = 260.5;
  fader4.fills = [];
  fader4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader4.strokeWeight = 1;

  // Group all elements
  const inst3C2Group = figma.group([
    panel, lineV1, lineV2,
    knob1, knob2, knob3, knob4, knob5, knob6,
    button1, button2, button3, button4, button5, button6,
    button7, button8, button9, button10, button11, button12, button13,
    slider1, menu1, fader1, fader2, fader3, fader4
  ], figma.currentPage);

  inst3C2Group.name = "Inst 3C2 Panel";
  inst3C2Group.x = figma.viewport.center.x - panelWidth / 2;
  inst3C2Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [inst3C2Group];
  figma.viewport.scrollAndZoomIntoView([inst3C2Group]);
  
  
  return inst3C2Group;
}
async function createInst3C3Panel() {
  const panelWidth = 684;
  const panelHeight = 483;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Inst 3C3 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create vertical lines
  const lineV1 = figma.createLine();
  lineV1.name = "Line V";
  lineV1.x = 229.5;
  lineV1.y = 0;
  lineV1.resize(0, panelHeight);
  lineV1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV1.strokeWeight = 1;

  const lineV2 = figma.createLine();
  lineV2.name = "Line V_2";
  lineV2.x = 454.5;
  lineV2.y = 0;
  lineV2.resize(0, panelHeight);
  lineV2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV2.strokeWeight = 1;

  // Create knobs
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(53, 53);
  knob1.x = 63 - 26.5;
  knob1.y = 90 - 26.5;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(35, 35);
  knob2.x = 164 - 17.5;
  knob2.y = 276 - 17.5;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(35, 35);
  knob3.x = 163 - 17.5;
  knob3.y = 184 - 17.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  // Create Knob_4 (special masked knob)
  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(36, 36);
  knob4.x = 63 - 18;
  knob4.y = 184 - 18;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 2;

  const knob5 = figma.createEllipse();
  knob5.name = "Knob_5";
  knob5.resize(53, 53);
  knob5.x = 163 - 26.5;
  knob5.y = 90 - 26.5;
  knob5.fills = [];
  knob5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob5.strokeWeight = 1;

  // Create buttons
  const button1 = figma.createRectangle();
  button1.name = "Button";
  button1.resize(69, 69);
  button1.x = 496.5;
  button1.y = 143.5;
  button1.fills = [];
  button1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button1.strokeWeight = 1;

  const button2 = figma.createRectangle();
  button2.name = "Button_2";
  button2.resize(69, 69);
  button2.x = 496.5;
  button2.y = 63.5;
  button2.fills = [];
  button2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button2.strokeWeight = 1;

  const button3 = figma.createRectangle();
  button3.name = "Button_3";
  button3.resize(69, 69);
  button3.x = 496.5;
  button3.y = 221.5;
  button3.fills = [];
  button3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button3.strokeWeight = 1;

  const button4 = figma.createRectangle();
  button4.name = "Button_4";
  button4.resize(69, 69);
  button4.x = 574.5;
  button4.y = 143.5;
  button4.fills = [];
  button4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button4.strokeWeight = 1;

  const button5 = figma.createRectangle();
  button5.name = "Button_5";
  button5.resize(69, 69);
  button5.x = 574.5;
  button5.y = 63.5;
  button5.fills = [];
  button5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button5.strokeWeight = 1;

  const button6 = figma.createRectangle();
  button6.name = "Button_6";
  button6.resize(69, 69);
  button6.x = 574.5;
  button6.y = 221.5;
  button6.fills = [];
  button6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button6.strokeWeight = 1;

  const button7 = figma.createRectangle();
  button7.name = "Button_7";
  button7.resize(68, 18);
  button7.x = 498.5;
  button7.y = 415.5;
  button7.fills = [];
  button7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button7.strokeWeight = 1;

  const button8 = figma.createRectangle();
  button8.name = "Button_8";
  button8.resize(68, 18);
  button8.x = 574.5;
  button8.y = 415.5;
  button8.fills = [];
  button8.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button8.strokeWeight = 1;

  const button9 = figma.createRectangle();
  button9.name = "Button_9";
  button9.resize(42, 18);
  button9.x = 498.5;
  button9.y = 360.5;
  button9.fills = [];
  button9.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button9.strokeWeight = 1;

  const button10 = figma.createRectangle();
  button10.name = "Button_10";
  button10.resize(42, 18);
  button10.x = 549.5;
  button10.y = 360.5;
  button10.fills = [];
  button10.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button10.strokeWeight = 1;

  const button11 = figma.createRectangle();
  button11.name = "Button_11";
  button11.resize(42, 18);
  button11.x = 600.5;
  button11.y = 360.5;
  button11.fills = [];
  button11.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button11.strokeWeight = 1;

  const button12 = figma.createRectangle();
  button12.name = "Button_12";
  button12.resize(12, 12);
  button12.x = 142.5;
  button12.y = 356.5;
  button12.fills = [];
  button12.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button12.strokeWeight = 1;

  const button13 = figma.createRectangle();
  button13.name = "Button_13";
  button13.resize(12, 12);
  button13.x = 169.5;
  button13.y = 356.5;
  button13.fills = [];
  button13.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button13.strokeWeight = 1;

  // Create slider
  const slider1 = figma.createRectangle();
  slider1.name = "Slider";
  slider1.resize(124, 13);
  slider1.x = 51.5;
  slider1.y = 421.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  // Create menus
  const menu1 = figma.createRectangle();
  menu1.name = "Menu";
  menu1.resize(167, 157);
  menu1.x = 257.5;
  menu1.y = 276.5;
  menu1.fills = [];
  menu1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  menu1.strokeWeight = 1;

  const menu2 = figma.createRectangle();
  menu2.name = "Menu_2";
  menu2.resize(167, 18);
  menu2.x = 258.5;
  menu2.y = 53.5;
  menu2.fills = [];
  menu2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  menu2.strokeWeight = 1;

  // Create fader
  const fader1 = figma.createRectangle();
  fader1.name = "Fader";
  fader1.resize(21, 109);
  fader1.x = 52.5;
  fader1.y = 260.5;
  fader1.fills = [];
  fader1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader1.strokeWeight = 1;

  // Create VU Meter
  const vuMeter = figma.createRectangle();
  vuMeter.name = "VU Meter";
  vuMeter.resize(167, 87);
  vuMeter.x = 258.5;
  vuMeter.y = 108.5;
  vuMeter.fills = [];
  vuMeter.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  vuMeter.strokeWeight = 1;

  // Group all elements
  const inst3C3Group = figma.group([
    panel, lineV1, lineV2,
    knob1, knob2, knob3, knob4, knob5,
    button1, button2, button3, button4, button5, button6,
    button7, button8, button9, button10, button11, button12, button13,
    slider1, menu1, menu2, fader1, vuMeter
  ], figma.currentPage);

  inst3C3Group.name = "Inst 3C3 Panel";
  inst3C3Group.x = figma.viewport.center.x - panelWidth / 2;
  inst3C3Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [inst3C3Group];
  figma.viewport.scrollAndZoomIntoView([inst3C3Group]);
  
  
  return inst3C3Group;
}
async function createInstKeys1Panel() {
  const panelWidth = 1000;
  const panelHeight = 694;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Inst Keys1 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create horizontal lines (using rectangles for better visibility)
  const lineH1 = figma.createRectangle();
  lineH1.name = "Line H1";
  lineH1.x = 0;
  lineH1.y = 467.5;
  lineH1.resize(panelWidth, 1);
  lineH1.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineH1.strokes = [];
  lineH1.strokeWeight = 0;

  const lineH2 = figma.createRectangle();
  lineH2.name = "Line H2";
  lineH2.x = 0;
  lineH2.y = 670.5;
  lineH2.resize(panelWidth, 1);
  lineH2.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineH2.strokes = [];
  lineH2.strokeWeight = 0;

  const lineH3 = figma.createRectangle();
  lineH3.name = "Line H3";
  lineH3.x = 0;
  lineH3.y = 36.5;
  lineH3.resize(panelWidth, 1);
  lineH3.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineH3.strokes = [];
  lineH3.strokeWeight = 0;

  // Create vertical lines (using rectangles for better visibility)
  const lineV1 = figma.createRectangle();
  lineV1.name = "Line V1";
  lineV1.x = 448.5;
  lineV1.y = 506;
  lineV1.resize(1, 76);
  lineV1.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV1.strokes = [];
  lineV1.strokeWeight = 0;

  const lineV2 = figma.createRectangle();
  lineV2.name = "Line V2";
  lineV2.x = 662.5;
  lineV2.y = 506;
  lineV2.resize(1, 76);
  lineV2.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV2.strokes = [];
  lineV2.strokeWeight = 0;

  const lineV3 = figma.createRectangle();
  lineV3.name = "Line V3";
  lineV3.x = 874.5;
  lineV3.y = 506;
  lineV3.resize(1, 76);
  lineV3.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineV3.strokes = [];
  lineV3.strokeWeight = 0;

  // Create knobs (9 circular knobs)
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(49, 49);
  knob1.x = 75 - 24.5;
  knob1.y = 534 - 24.5;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(49, 49);
  knob2.x = 182 - 24.5;
  knob2.y = 534 - 24.5;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(49, 49);
  knob3.x = 289 - 24.5;
  knob3.y = 534 - 24.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(49, 49);
  knob4.x = 396 - 24.5;
  knob4.y = 534 - 24.5;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;

  const knob5 = figma.createEllipse();
  knob5.name = "Knob_5";
  knob5.resize(49, 49);
  knob5.x = 503 - 24.5;
  knob5.y = 534 - 24.5;
  knob5.fills = [];
  knob5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob5.strokeWeight = 1;

  const knob6 = figma.createEllipse();
  knob6.name = "Knob_6";
  knob6.resize(49, 49);
  knob6.x = 610 - 24.5;
  knob6.y = 534 - 24.5;
  knob6.fills = [];
  knob6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob6.strokeWeight = 1;

  const knob7 = figma.createEllipse();
  knob7.name = "Knob_7";
  knob7.resize(49, 49);
  knob7.x = 717 - 24.5;
  knob7.y = 534 - 24.5;
  knob7.fills = [];
  knob7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob7.strokeWeight = 1;

  const knob8 = figma.createEllipse();
  knob8.name = "Knob_8";
  knob8.resize(49, 49);
  knob8.x = 824 - 24.5;
  knob8.y = 534 - 24.5;
  knob8.fills = [];
  knob8.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob8.strokeWeight = 1;

  const knob9 = figma.createEllipse();
  knob9.name = "Knob_9";
  knob9.resize(49, 49);
  knob9.x = 931 - 24.5;
  knob9.y = 534 - 24.5;
  knob9.fills = [];
  knob9.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob9.strokeWeight = 1;

  // Create buttons (2 small buttons)
  const button1 = figma.createRectangle();
  button1.name = "Button";
  button1.resize(13, 51);
  button1.x = 15.5;
  button1.y = 614.5;
  button1.fills = [];
  button1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button1.strokeWeight = 1;

  const button2 = figma.createRectangle();
  button2.name = "Button_2";
  button2.resize(13, 51);
  button2.x = 41.5;
  button2.y = 614.5;
  button2.fills = [];
  button2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button2.strokeWeight = 1;

  // Create keyboard area
  const keyboard = figma.createRectangle();
  keyboard.name = "Keyboard";
  keyboard.resize(913, 55);
  keyboard.x = 71.5;
  keyboard.y = 612.5;
  keyboard.fills = [];
  keyboard.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  keyboard.strokeWeight = 1;

  // Create display/menu area
  const display = figma.createRectangle();
  display.name = "Display";
  display.resize(229, 15);
  display.x = 387.5;
  display.y = 8.5;
  display.fills = [];
  display.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display.strokeWeight = 1;

  // Group all elements
  const instKeys1Group = figma.group([
    panel, lineH1, lineH2, lineH3, lineV1, lineV2, lineV3,
    knob1, knob2, knob3, knob4, knob5, knob6, knob7, knob8, knob9,
    button1, button2, keyboard, display
  ], figma.currentPage);

  instKeys1Group.name = "Inst Keys1 Panel";
  instKeys1Group.x = figma.viewport.center.x - panelWidth / 2;
  instKeys1Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [instKeys1Group];
  figma.viewport.scrollAndZoomIntoView([instKeys1Group]);
  
  
  return instKeys1Group;
}
async function createInstKeys2Panel() {
  const panelWidth = 1161;
  const panelHeight = 740;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Inst Keys2 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 0.996, b: 0.996 } }]; // #FFFEFE
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create knobs (circular knobs)
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(65, 65);
  knob1.x = 949 - 32.5;
  knob1.y = 89 - 32.5;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(65, 65);
  knob2.x = 949 - 32.5;
  knob2.y = 183 - 32.5;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(65, 65);
  knob3.x = 949 - 32.5;
  knob3.y = 277 - 32.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(65, 65);
  knob4.x = 119 - 32.5;
  knob4.y = 277 - 32.5;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;

  const knob5 = figma.createEllipse();
  knob5.name = "Knob_5";
  knob5.resize(65, 65);
  knob5.x = 119 - 32.5;
  knob5.y = 183 - 32.5;
  knob5.fills = [];
  knob5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob5.strokeWeight = 1;

  const knob6 = figma.createEllipse();
  knob6.name = "Knob_6";
  knob6.resize(65, 65);
  knob6.x = 1039 - 32.5;
  knob6.y = 277 - 32.5;
  knob6.fills = [];
  knob6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob6.strokeWeight = 1;

  const knob7 = figma.createEllipse();
  knob7.name = "Knob_7";
  knob7.resize(65, 65);
  knob7.x = 209 - 32.5;
  knob7.y = 277 - 32.5;
  knob7.fills = [];
  knob7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob7.strokeWeight = 1;

  const knob8 = figma.createEllipse();
  knob8.name = "Knob_8";
  knob8.resize(65, 65);
  knob8.x = 209 - 32.5;
  knob8.y = 183 - 32.5;
  knob8.fills = [];
  knob8.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob8.strokeWeight = 1;

  // Create special knob (path-based)
  const knob9 = figma.createEllipse();
  knob9.name = "Knob_9";
  knob9.resize(65, 65);
  knob9.x = 209 - 32.5;
  knob9.y = 56.5 - 32.5;
  knob9.fills = [];
  knob9.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob9.strokeWeight = 1;

  const knob10 = figma.createEllipse();
  knob10.name = "Knob_10";
  knob10.resize(65, 65);
  knob10.x = 1039 - 32.5;
  knob10.y = 371 - 32.5;
  knob10.fills = [];
  knob10.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob10.strokeWeight = 1;

  const knob11 = figma.createEllipse();
  knob11.name = "Knob_11";
  knob11.resize(65, 65);
  knob11.x = 209 - 32.5;
  knob11.y = 371 - 32.5;
  knob11.fills = [];
  knob11.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob11.strokeWeight = 1;

  // Create bottom row knobs (12 knobs)
  const knob12 = figma.createEllipse();
  knob12.name = "Knob_12";
  knob12.resize(65, 65);
  knob12.x = 1066 - 32.5;
  knob12.y = 553 - 32.5;
  knob12.fills = [];
  knob12.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob12.strokeWeight = 1;

  const knob13 = figma.createEllipse();
  knob13.name = "Knob_13";
  knob13.resize(65, 65);
  knob13.x = 977 - 32.5;
  knob13.y = 553 - 32.5;
  knob13.fills = [];
  knob13.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob13.strokeWeight = 1;

  const knob14 = figma.createEllipse();
  knob14.name = "Knob_14";
  knob14.resize(65, 65);
  knob14.x = 888 - 32.5;
  knob14.y = 553 - 32.5;
  knob14.fills = [];
  knob14.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob14.strokeWeight = 1;

  const knob15 = figma.createEllipse();
  knob15.name = "Knob_15";
  knob15.resize(65, 65);
  knob15.x = 799 - 32.5;
  knob15.y = 553 - 32.5;
  knob15.fills = [];
  knob15.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob15.strokeWeight = 1;

  const knob16 = figma.createEllipse();
  knob16.name = "Knob_16";
  knob16.resize(65, 65);
  knob16.x = 669 - 32.5;
  knob16.y = 553 - 32.5;
  knob16.fills = [];
  knob16.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob16.strokeWeight = 1;

  const knob17 = figma.createEllipse();
  knob17.name = "Knob_17";
  knob17.resize(65, 65);
  knob17.x = 579 - 32.5;
  knob17.y = 553 - 32.5;
  knob17.fills = [];
  knob17.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob17.strokeWeight = 1;

  const knob18 = figma.createEllipse();
  knob18.name = "Knob_18";
  knob18.resize(65, 65);
  knob18.x = 489 - 32.5;
  knob18.y = 553 - 32.5;
  knob18.fills = [];
  knob18.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob18.strokeWeight = 1;

  const knob19 = figma.createEllipse();
  knob19.name = "Knob_19";
  knob19.resize(65, 65);
  knob19.x = 358 - 32.5;
  knob19.y = 553 - 32.5;
  knob19.fills = [];
  knob19.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob19.strokeWeight = 1;

  const knob20 = figma.createEllipse();
  knob20.name = "Knob_20";
  knob20.resize(65, 65);
  knob20.x = 270 - 32.5;
  knob20.y = 553 - 32.5;
  knob20.fills = [];
  knob20.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob20.strokeWeight = 1;

  const knob21 = figma.createEllipse();
  knob21.name = "Knob_21";
  knob21.resize(65, 65);
  knob21.x = 182 - 32.5;
  knob21.y = 553 - 32.5;
  knob21.fills = [];
  knob21.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob21.strokeWeight = 1;

  const knob22 = figma.createEllipse();
  knob22.name = "Knob_22";
  knob22.resize(65, 65);
  knob22.x = 94 - 32.5;
  knob22.y = 553 - 32.5;
  knob22.fills = [];
  knob22.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob22.strokeWeight = 1;

  const knob23 = figma.createEllipse();
  knob23.name = "Knob_23";
  knob23.resize(65, 65);
  knob23.x = 949 - 32.5;
  knob23.y = 371 - 32.5;
  knob23.fills = [];
  knob23.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob23.strokeWeight = 1;

  const knob24 = figma.createEllipse();
  knob24.name = "Knob_24";
  knob24.resize(65, 65);
  knob24.x = 119 - 32.5;
  knob24.y = 371 - 32.5;
  knob24.fills = [];
  knob24.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob24.strokeWeight = 1;

  // Create small knob
  const knob25 = figma.createEllipse();
  knob25.name = "Knob_25";
  knob25.resize(25, 25);
  knob25.x = 1105 - 12.5;
  knob25.y = 702 - 12.5;
  knob25.fills = [];
  knob25.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob25.strokeWeight = 1;

  // Create complex path (simplified as rectangle)
  const complexPath = figma.createRectangle();
  complexPath.name = "Complex Path";
  complexPath.resize(526, 407);
  complexPath.x = 319.705;
  complexPath.y = 35.5;
  complexPath.fills = [];
  complexPath.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  complexPath.strokeWeight = 1;

  // Create buttons
  const button1 = figma.createRectangle();
  button1.name = "Button";
  button1.resize(28, 65);
  button1.x = 94.5;
  button1.y = 56.5;
  button1.fills = [];
  button1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button1.strokeWeight = 1;

  // Create keyboard area
  const keyboard = figma.createRectangle();
  keyboard.name = "Keyboard";
  keyboard.resize(880, 99);
  keyboard.x = 139.5;
  keyboard.y = 639.5;
  keyboard.fills = [];
  keyboard.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  keyboard.strokeWeight = 1;

  // Create small buttons
  const button2 = figma.createRectangle();
  button2.name = "Button_2";
  button2.resize(20, 61);
  button2.x = 33.5;
  button2.y = 660.5;
  button2.fills = [];
  button2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button2.strokeWeight = 1;

  const button3 = figma.createRectangle();
  button3.name = "Button_3";
  button3.resize(20, 61);
  button3.x = 86.5;
  button3.y = 660.5;
  button3.fills = [];
  button3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button3.strokeWeight = 1;

  // Create display areas
  const display1 = figma.createRectangle();
  display1.name = "Display 1";
  display1.resize(344, 96);
  display1.x = 54.5;
  display1.y = 513.5;
  display1.fills = [];
  display1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display1.strokeWeight = 1;
  display1.cornerRadius = 4.5;

  const display2 = figma.createRectangle();
  display2.name = "Display 2";
  display2.resize(344, 96);
  display2.x = 759.5;
  display2.y = 513.5;
  display2.fills = [];
  display2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display2.strokeWeight = 1;
  display2.cornerRadius = 4.5;

  const display3 = figma.createRectangle();
  display3.name = "Display 3";
  display3.resize(95, 90);
  display3.x = 1043.5;
  display3.y = 639.5;
  display3.fills = [];
  display3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display3.strokeWeight = 1;
  display3.cornerRadius = 4.5;

  const display4 = figma.createRectangle();
  display4.name = "Display 4";
  display4.resize(259, 96);
  display4.x = 450.5;
  display4.y = 513.5;
  display4.fills = [];
  display4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display4.strokeWeight = 1;
  display4.cornerRadius = 4.5;


  // Create control panel
  const controlPanel = figma.createRectangle();
  controlPanel.name = "Control Panel";
  controlPanel.resize(61, 159);
  controlPanel.x = 1010.5;
  controlPanel.y = 56.5;
  controlPanel.fills = [];
  controlPanel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  controlPanel.strokeWeight = 1;

  // Create small display rectangles
  const smallDisplay1 = figma.createRectangle();
  smallDisplay1.name = "Small Display 1";
  smallDisplay1.resize(31, 19);
  smallDisplay1.x = 53.5;
  smallDisplay1.y = 492.5;
  smallDisplay1.fills = [];
  smallDisplay1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay1.strokeWeight = 1;

  const smallDisplay2 = figma.createRectangle();
  smallDisplay2.name = "Small Display 2";
  smallDisplay2.resize(31, 19);
  smallDisplay2.x = 451.5;
  smallDisplay2.y = 492.5;
  smallDisplay2.fills = [];
  smallDisplay2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay2.strokeWeight = 1;

  const smallDisplay3 = figma.createRectangle();
  smallDisplay3.name = "Small Display 3";
  smallDisplay3.resize(31, 19);
  smallDisplay3.x = 758.5;
  smallDisplay3.y = 492.5;
  smallDisplay3.fills = [];
  smallDisplay3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay3.strokeWeight = 1;

  const smallDisplay4 = figma.createRectangle();
  smallDisplay4.name = "Small Display 4";
  smallDisplay4.resize(31, 19);
  smallDisplay4.x = 1050.5;
  smallDisplay4.y = 650.5;
  smallDisplay4.fills = [];
  smallDisplay4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay4.strokeWeight = 1;

  const smallDisplay5 = figma.createRectangle();
  smallDisplay5.name = "Small Display 5";
  smallDisplay5.resize(31, 19);
  smallDisplay5.x = 1050.5;
  smallDisplay5.y = 691.5;
  smallDisplay5.fills = [];
  smallDisplay5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay5.strokeWeight = 1;

  const smallDisplay6 = figma.createRectangle();
  smallDisplay6.name = "Small Display 6";
  smallDisplay6.resize(31, 19);
  smallDisplay6.x = 1091.5;
  smallDisplay6.y = 650.5;
  smallDisplay6.fills = [];
  smallDisplay6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay6.strokeWeight = 1;

  const smallDisplay7 = figma.createRectangle();
  smallDisplay7.name = "Small Display 7";
  smallDisplay7.resize(31, 19);
  smallDisplay7.x = 540.5;
  smallDisplay7.y = 492.5;
  smallDisplay7.fills = [];
  smallDisplay7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay7.strokeWeight = 1;

  const smallDisplay8 = figma.createRectangle();
  smallDisplay8.name = "Small Display 8";
  smallDisplay8.resize(31, 19);
  smallDisplay8.x = 630.5;
  smallDisplay8.y = 492.5;
  smallDisplay8.fills = [];
  smallDisplay8.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallDisplay8.strokeWeight = 1;

  // Group all elements
  const instKeys2Group = figma.group([
    panel,
    knob1, knob2, knob3, knob4, knob5, knob6, knob7, knob8, knob9, knob10, knob11,
    knob12, knob13, knob14, knob15, knob16, knob17, knob18, knob19, knob20, knob21, knob22, knob23, knob24, knob25,
    complexPath, button1, keyboard, button2, button3,
    display1, display2, display3, display4,
    controlPanel,
    smallDisplay1, smallDisplay2, smallDisplay3, smallDisplay4, smallDisplay5, smallDisplay6, smallDisplay7, smallDisplay8
  ], figma.currentPage);
  instKeys2Group.name = "Inst Keys2 Panel";
  instKeys2Group.x = figma.viewport.center.x - panelWidth / 2;
  instKeys2Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [instKeys2Group];
  figma.viewport.scrollAndZoomIntoView([instKeys2Group]);
  
  
  return instKeys2Group;
}

async function createInstKeys3Panel() {
  const panelWidth = 950;
  const panelHeight = 533;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Inst Keys3 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create knobs (circular knobs)
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(153, 153);
  knob1.x = 475 - 76.5;
  knob1.y = 293 - 76.5;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(82, 82);
  knob2.x = 172.5 - 41;
  knob2.y = 198.5 - 41;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(82, 82);
  knob3.x = 780.5 - 41;
  knob3.y = 198.5 - 41;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(82, 82);
  knob4.x = 684.5 - 41;
  knob4.y = 357.5 - 41;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;

  const knob5 = figma.createEllipse();
  knob5.name = "Knob_5";
  knob5.resize(45, 45);
  knob5.x = 860 - 22.5;
  knob5.y = 454 - 22.5;
  knob5.fills = [];
  knob5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob5.strokeWeight = 1;

  const knob6 = figma.createEllipse();
  knob6.name = "Knob_6";
  knob6.resize(45, 45);
  knob6.x = 139 - 22.5;
  knob6.y = 454 - 22.5;
  knob6.fills = [];
  knob6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob6.strokeWeight = 1;

  const knob7 = figma.createEllipse();
  knob7.name = "Knob_7";
  knob7.resize(82, 82);
  knob7.x = 255.5 - 41;
  knob7.y = 357.5 - 41;
  knob7.fills = [];
  knob7.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob7.strokeWeight = 1;

  // Create button
  const button1 = figma.createRectangle();
  button1.name = "Button";
  button1.resize(30, 50);
  button1.x = 53.5;
  button1.y = 431.5;
  button1.fills = [];
  button1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  button1.strokeWeight = 1;

  // Create display areas
  const display1 = figma.createRectangle();
  display1.name = "Display 1";
  display1.resize(189, 44);
  display1.x = 383.5;
  display1.y = 96.5;
  display1.fills = [];
  display1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display1.strokeWeight = 1;
  display1.cornerRadius = 22;

  const display2 = figma.createRectangle();
  display2.name = "Display 2";
  display2.resize(248, 22);
  display2.x = 627.5;
  display2.y = 27.5;
  display2.fills = [];
  display2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display2.strokeWeight = 1;

  const display3 = figma.createRectangle();
  display3.name = "Display 3";
  display3.resize(86, 9);
  display3.x = 818.5;
  display3.y = 504.5;
  display3.fills = [];
  display3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display3.strokeWeight = 1;

  const display4 = figma.createRectangle();
  display4.name = "Display 4";
  display4.resize(55, 22);
  display4.x = 553.5;
  display4.y = 27.5;
  display4.fills = [];
  display4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display4.strokeWeight = 1;
  display4.cornerRadius = 4.5;

  // Group all elements
  const instKeys3Group = figma.group([
    panel,
    knob1, knob2, knob3, knob4, knob5, knob6, knob7,
    button1,
    display1, display2, display3, display4
  ], figma.currentPage);

  instKeys3Group.name = "Inst Keys3 Panel";
  instKeys3Group.x = figma.viewport.center.x - panelWidth / 2;
  instKeys3Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [instKeys3Group];
  figma.viewport.scrollAndZoomIntoView([instKeys3Group]);
  
  
  return instKeys3Group;
}
async function createDrumMachine1Panel() {
  const panelWidth = 652;
  const panelHeight = 796;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Drum Machine1 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create main control area
  const controlArea = figma.createRectangle();
  controlArea.name = "Control Area";
  controlArea.resize(491, 771);
  controlArea.x = 147.5;
  controlArea.y = 8.5;
  controlArea.fills = [];
  controlArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  controlArea.strokeWeight = 1;
  controlArea.cornerRadius = 7.5;

  // Create drum pads (6 pads in 2 rows)
  const pad1 = figma.createRectangle();
  pad1.name = "Drum Pad 1";
  pad1.resize(149, 149);
  pad1.x = 162.5;
  pad1.y = 461.5;
  pad1.fills = [];
  pad1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  pad1.strokeWeight = 1;
  pad1.cornerRadius = 2.5;

  const pad2 = figma.createRectangle();
  pad2.name = "Drum Pad 2";
  pad2.resize(149, 149);
  pad2.x = 162.5;
  pad2.y = 617.5;
  pad2.fills = [];
  pad2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  pad2.strokeWeight = 1;
  pad2.cornerRadius = 2.5;

  const pad3 = figma.createRectangle();
  pad3.name = "Drum Pad 3";
  pad3.resize(149, 149);
  pad3.x = 318.5;
  pad3.y = 461.5;
  pad3.fills = [];
  pad3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  pad3.strokeWeight = 1;
  pad3.cornerRadius = 2.5;

  const pad4 = figma.createRectangle();
  pad4.name = "Drum Pad 4";
  pad4.resize(149, 149);
  pad4.x = 318.5;
  pad4.y = 617.5;
  pad4.fills = [];
  pad4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  pad4.strokeWeight = 1;
  pad4.cornerRadius = 2.5;

  const pad5 = figma.createRectangle();
  pad5.name = "Drum Pad 5";
  pad5.resize(149, 149);
  pad5.x = 474.5;
  pad5.y = 461.5;
  pad5.fills = [];
  pad5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  pad5.strokeWeight = 1;
  pad5.cornerRadius = 2.5;

  const pad6 = figma.createRectangle();
  pad6.name = "Drum Pad 6";
  pad6.resize(149, 149);
  pad6.x = 474.5;
  pad6.y = 617.5;
  pad6.fills = [];
  pad6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  pad6.strokeWeight = 1;
  pad6.cornerRadius = 2.5;

  // Create large knob
  const knob1 = figma.createEllipse();
  knob1.name = "Knob";
  knob1.resize(100, 100);
  knob1.x = 76.5 - 50;
  knob1.y = 717.5 - 50;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  // Create faders (vertical sliders)
  const fader1 = figma.createRectangle();
  fader1.name = "Fader 1";
  fader1.resize(19, 587);
  fader1.x = 44.5;
  fader1.y = 43.5;
  fader1.fills = [];
  fader1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader1.strokeWeight = 1;

  const fader2 = figma.createRectangle();
  fader2.name = "Fader 2";
  fader2.resize(19, 587);
  fader2.x = 89.5;
  fader2.y = 43.5;
  fader2.fills = [];
  fader2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  fader2.strokeWeight = 1;

  // Create display area
  const display = figma.createRectangle();
  display.name = "Display";
  display.resize(390, 320);
  display.x = 243.5;
  display.y = 16.5;
  display.fills = [];
  display.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  display.strokeWeight = 1;
  display.cornerRadius = 19.5;

  // Create horizontal lines (using rectangles for better visibility)
  const lineH1 = figma.createRectangle();
  lineH1.name = "Line H1";
  lineH1.x = 146;
  lineH1.y = 345.5;
  lineH1.resize(493, 1);
  lineH1.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineH1.strokes = [];
  lineH1.strokeWeight = 0;

  const lineH2 = figma.createRectangle();
  lineH2.name = "Line H2";
  lineH2.x = 146;
  lineH2.y = 445.5;
  lineH2.resize(493, 1);
  lineH2.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  lineH2.strokes = [];
  lineH2.strokeWeight = 0;

  // Create control knobs (5 knobs)
  const knob2 = figma.createEllipse();
  knob2.name = "Knob_2";
  knob2.resize(59, 59);
  knob2.x = 198 - 29.5;
  knob2.y = 394 - 29.5;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob_3";
  knob3.resize(59, 59);
  knob3.x = 296 - 29.5;
  knob3.y = 394 - 29.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  const knob4 = figma.createEllipse();
  knob4.name = "Knob_4";
  knob4.resize(59, 59);
  knob4.x = 393 - 29.5;
  knob4.y = 394 - 29.5;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;

  const knob5 = figma.createEllipse();
  knob5.name = "Knob_5";
  knob5.resize(59, 59);
  knob5.x = 490 - 29.5;
  knob5.y = 394 - 29.5;
  knob5.fills = [];
  knob5.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob5.strokeWeight = 1;

  const knob6 = figma.createEllipse();
  knob6.name = "Knob_6";
  knob6.resize(59, 59);
  knob6.x = 587 - 29.5;
  knob6.y = 394 - 29.5;
  knob6.fills = [];
  knob6.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob6.strokeWeight = 1;

  // Group all elements
  const drumMachine1Group = figma.group([
    panel, controlArea,
    pad1, pad2, pad3, pad4, pad5, pad6,
    knob1, fader1, fader2, display,
    lineH1, lineH2,
    knob2, knob3, knob4, knob5, knob6
  ], figma.currentPage);

  drumMachine1Group.name = "Drum Machine1 Panel";
  drumMachine1Group.x = figma.viewport.center.x - panelWidth / 2;
  drumMachine1Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [drumMachine1Group];
  figma.viewport.scrollAndZoomIntoView([drumMachine1Group]);
  
  
  return drumMachine1Group;
}

async function createDrumMachine2Panel() {
  const panelWidth = 811;
  const panelHeight = 704;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Drum Machine2 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create 16 drum pads (4x4 grid)
  const pads = [];
  const padPositions = [
    { x: 123.5, y: 248.5 }, { x: 232.5, y: 248.5 }, { x: 340.5, y: 248.5 }, { x: 449.5, y: 248.5 },
    { x: 123.5, y: 353.5 }, { x: 232.5, y: 353.5 }, { x: 340.5, y: 353.5 }, { x: 449.5, y: 353.5 },
    { x: 123.5, y: 458.5 }, { x: 232.5, y: 458.5 }, { x: 340.5, y: 458.5 }, { x: 449.5, y: 458.5 },
    { x: 123.5, y: 563.5 }, { x: 232.5, y: 563.5 }, { x: 340.5, y: 563.5 }, { x: 449.5, y: 563.5 }
  ];

  for (let i = 0; i < 16; i++) {
    const pad = figma.createRectangle();
    pad.name = `Pad ${i + 1}`;
    pad.resize(88, 85);
    pad.x = padPositions[i].x;
    pad.y = padPositions[i].y;
    pad.fills = [];
    pad.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    pad.strokeWeight = 1;
    pad.cornerRadius = 2.5;
    pads.push(pad);
  }

  // Create large knob
  const knobLarge = figma.createEllipse();
  knobLarge.name = "Knob Large";
  knobLarge.resize(101, 101);
  knobLarge.x = 676 - 50.5;
  knobLarge.y = 380 - 50.5;
  knobLarge.fills = [];
  knobLarge.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knobLarge.strokeWeight = 1;

  // Create 5 medium knobs
  const knobPositions = [
    { x: 59.5, y: 374.5 }, { x: 59.5, y: 75.5 }, { x: 59.5, y: 186.5 }, 
    { x: 59.5, y: 280.5 }, { x: 59.5, y: 468.5 }
  ];
  const mediumKnobs = [];

  for (let i = 0; i < 5; i++) {
    const knob = figma.createEllipse();
    knob.name = `Knob Medium ${i + 1}`;
    knob.resize(54, 54);
    knob.x = knobPositions[i].x - 27;
    knob.y = knobPositions[i].y - 27;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    mediumKnobs.push(knob);
  }

  // Create screen
  const screen = figma.createRectangle();
  screen.name = "Screen";
  screen.resize(396, 141);
  screen.x = 132.5;
  screen.y = 34.5;
  screen.fills = [];
  screen.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  screen.strokeWeight = 1;
  screen.cornerRadius = 2.5;

  // Create buttons (many buttons of different sizes)
  const buttons = [];

  // Small buttons (34x16)
  const smallButtonPositions = [
    { x: 621.5, y: 451.5 }, { x: 696.5, y: 451.5 }, { x: 563.5, y: 569.5 },
    { x: 164.5, y: 204.5 }, { x: 223.5, y: 205.5 }, { x: 283.5, y: 205.5 },
    { x: 343.5, y: 205.5 }, { x: 402.5, y: 205.5 }, { x: 463.5, y: 205.5 },
    { x: 611.5, y: 569.5 }, { x: 658.5, y: 569.5 }, { x: 705.5, y: 569.5 }, { x: 753.5, y: 569.5 }
  ];

  for (let i = 0; i < smallButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Button Small ${i + 1}`;
    button.resize(34, 16);
    button.x = smallButtonPositions[i].x;
    button.y = smallButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    button.cornerRadius = 2.5;
    buttons.push(button);
  }

  // Medium buttons (37x22)
  const mediumButtonPositions = [
    { x: 562.5, y: 448.5 }, { x: 752.5, y: 500.5 }, { x: 752.5, y: 448.5 },
    { x: 752.5, y: 396.5 }, { x: 752.5, y: 341.5 }, { x: 753.5, y: 283.5 },
    { x: 753.5, y: 232.5 }, { x: 753.5, y: 181.5 }, { x: 753.5, y: 129.5 },
    { x: 705.5, y: 283.5 }, { x: 705.5, y: 232.5 }, { x: 705.5, y: 181.5 },
    { x: 705.5, y: 129.5 }, { x: 658.5, y: 283.5 }, { x: 658.5, y: 232.5 },
    { x: 658.5, y: 181.5 }, { x: 658.5, y: 129.5 }, { x: 611.5, y: 283.5 },
    { x: 611.5, y: 232.5 }, { x: 611.5, y: 181.5 }, { x: 611.5, y: 129.5 },
    { x: 563.5, y: 283.5 }, { x: 563.5, y: 232.5 }, { x: 563.5, y: 181.5 },
    { x: 563.5, y: 129.5 }, { x: 563.5, y: 368.5 }, { x: 40.5, y: 526.5 }
  ];

  for (let i = 0; i < mediumButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Button Medium ${i + 1}`;
    button.resize(37, 22);
    button.x = mediumButtonPositions[i].x;
    button.y = mediumButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    button.cornerRadius = 2.5;
    buttons.push(button);
  }

  // Transport buttons (37x27)
  const transportButtonPositions = [
    { x: 561.5, y: 620.5 }, { x: 40.5, y: 620.5 }, { x: 40.5, y: 578.5 },
    { x: 561.5, y: 497.5 }, { x: 608.5, y: 620.5 }, { x: 656.5, y: 620.5 },
    { x: 704.5, y: 620.5 }, { x: 751.5, y: 620.5 }
  ];

  for (let i = 0; i < transportButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Button Transport ${i + 1}`;
    button.resize(37, 27);
    button.x = transportButtonPositions[i].x;
    button.y = transportButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    button.cornerRadius = 2.5;
    buttons.push(button);
  }

  // Create navigation arrows area
  const arrowsArea = figma.createRectangle();
  arrowsArea.name = "Arrows";
  arrowsArea.resize(94, 64);
  arrowsArea.x = 628.5;
  arrowsArea.y = 478.5;
  arrowsArea.fills = [];
  arrowsArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  arrowsArea.strokeWeight = 1;
  arrowsArea.cornerRadius = 2.5;

  // Create arrow triangles (using rectangles for simplicity)
  const arrowUp = figma.createRectangle();
  arrowUp.name = "Arrow Up";
  arrowUp.resize(10, 8);
  arrowUp.x = 676 - 5;
  arrowUp.y = 482;
  arrowUp.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  arrowUp.strokes = [];
  arrowUp.strokeWeight = 0;

  const arrowDown = figma.createRectangle();
  arrowDown.name = "Arrow Down";
  arrowDown.resize(10, 8);
  arrowDown.x = 676 - 5;
  arrowDown.y = 540;
  arrowDown.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  arrowDown.strokes = [];
  arrowDown.strokeWeight = 0;

  const arrowLeft = figma.createRectangle();
  arrowLeft.name = "Arrow Left";
  arrowLeft.resize(8, 10);
  arrowLeft.x = 635;
  arrowLeft.y = 511 - 5;
  arrowLeft.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  arrowLeft.strokes = [];
  arrowLeft.strokeWeight = 0;

  const arrowRight = figma.createRectangle();
  arrowRight.name = "Arrow Right";
  arrowRight.resize(8, 10);
  arrowRight.x = 718;
  arrowRight.y = 511 - 5;
  arrowRight.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  arrowRight.strokes = [];
  arrowRight.strokeWeight = 0;

  // Group all elements
  const drumMachine2Group = figma.group([
    panel, screen, knobLarge, arrowsArea,
    ...pads, ...mediumKnobs, ...buttons,
    arrowUp, arrowDown, arrowLeft, arrowRight
  ], figma.currentPage);

  drumMachine2Group.name = "Drum Machine2 Panel";
  drumMachine2Group.x = figma.viewport.center.x - panelWidth / 2;
  drumMachine2Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [drumMachine2Group];
  figma.viewport.scrollAndZoomIntoView([drumMachine2Group]);
  
  
  return drumMachine2Group;
}
async function createEffects1Panel() {
  const panelWidth = 763;
  const panelHeight = 533;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects1 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create header buttons (6 buttons)
  const headerButtons = [];
  const headerButtonPositions = [
    { x: 554.5, y: 34.5, width: 47, height: 22 },
    { x: 47.5, y: 34.5, width: 77, height: 22 },
    { x: 133.5, y: 34.5, width: 77, height: 22 },
    { x: 288.5, y: 34.5, width: 188, height: 22 },
    { x: 611.5, y: 34.5, width: 47, height: 22 },
    { x: 668.5, y: 34.5, width: 47, height: 22 }
  ];

  for (let i = 0; i < headerButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Header Button ${i + 1}`;
    button.resize(headerButtonPositions[i].width, headerButtonPositions[i].height);
    button.x = headerButtonPositions[i].x;
    button.y = headerButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    headerButtons.push(button);
  }

  // Create main display area
  const displayArea = figma.createRectangle();
  displayArea.name = "Display Area";
  displayArea.resize(668, 174);
  displayArea.x = 47.5;
  displayArea.y = 92.5;
  displayArea.fills = [];
  displayArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  displayArea.strokeWeight = 1;

  // Create sliders (3 vertical sliders)
  const slider1 = figma.createRectangle();
  slider1.name = "Slider 1";
  slider1.resize(27, 121);
  slider1.x = 53.5;
  slider1.y = 359.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  const slider2 = figma.createRectangle();
  slider2.name = "Slider 2";
  slider2.resize(20, 123);
  slider2.x = 446.5;
  slider2.y = 357.5;
  slider2.fills = [];
  slider2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider2.strokeWeight = 1;

  const slider3 = figma.createRectangle();
  slider3.name = "Slider 3";
  slider3.resize(20, 123);
  slider3.x = 500.5;
  slider3.y = 357.5;
  slider3.fills = [];
  slider3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider3.strokeWeight = 1;

  // Create horizontal slider
  const horizontalSlider = figma.createRectangle();
  horizontalSlider.name = "Horizontal Slider";
  horizontalSlider.resize(141, 19);
  horizontalSlider.x = 150.5;
  horizontalSlider.y = 469.5;
  horizontalSlider.fills = [];
  horizontalSlider.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  horizontalSlider.strokeWeight = 1;

  // Create knobs (4 knobs of different sizes)
  const knob1 = figma.createEllipse();
  knob1.name = "Knob 1";
  knob1.resize(60, 60);
  knob1.x = 164.5 - 30;
  knob1.y = 388.5 - 30;
  knob1.fills = [];
  knob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob1.strokeWeight = 1;

  const knob2 = figma.createEllipse();
  knob2.name = "Knob 2";
  knob2.resize(60, 60);
  knob2.x = 275.5 - 30;
  knob2.y = 388.5 - 30;
  knob2.fills = [];
  knob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob2.strokeWeight = 1;

  const knob3 = figma.createEllipse();
  knob3.name = "Knob 3";
  knob3.resize(39, 39);
  knob3.x = 382 - 19.5;
  knob3.y = 377 - 19.5;
  knob3.fills = [];
  knob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob3.strokeWeight = 1;

  const knob4 = figma.createEllipse();
  knob4.name = "Knob 4";
  knob4.resize(119, 119);
  knob4.x = 637 - 59.5;
  knob4.y = 419 - 59.5;
  knob4.fills = [];
  knob4.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  knob4.strokeWeight = 1;

  // Create small buttons (2 buttons)
  const smallButton1 = figma.createRectangle();
  smallButton1.name = "Small Button 1";
  smallButton1.resize(15, 15);
  smallButton1.x = 359.5;
  smallButton1.y = 464.5;
  smallButton1.fills = [];
  smallButton1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallButton1.strokeWeight = 1;

  const smallButton2 = figma.createRectangle();
  smallButton2.name = "Small Button 2";
  smallButton2.resize(15, 15);
  smallButton2.x = 389.5;
  smallButton2.y = 464.5;
  smallButton2.fills = [];
  smallButton2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallButton2.strokeWeight = 1;

  // Group all elements
  const effects1Group = figma.group([
    panel, displayArea,
    ...headerButtons,
    slider1, slider2, slider3, horizontalSlider,
    knob1, knob2, knob3, knob4,
    smallButton1, smallButton2
  ], figma.currentPage);

  effects1Group.name = "Effects1 Panel";
  effects1Group.x = figma.viewport.center.x - panelWidth / 2;
  effects1Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects1Group];
  figma.viewport.scrollAndZoomIntoView([effects1Group]);
  
  
  return effects1Group;
}
async function createEffects2Panel() {
  const panelWidth = 984;
  const panelHeight = 520;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects2 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create grid lines (horizontal and vertical)
  const gridLines = [];

  // Horizontal lines
  const horizontalLinePositions = [
    { x: 19, y: 89.5, width: 814, height: 1 },
    { x: 19, y: 54.5, width: 814, height: 1 },
    { x: 19, y: 449.5, width: 814, height: 1 },
    { x: 19, y: 482.5, width: 814, height: 1 }
  ];

  for (let i = 0; i < horizontalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Horizontal Line ${i + 1}`;
    line.resize(horizontalLinePositions[i].width, horizontalLinePositions[i].height);
    line.x = horizontalLinePositions[i].x;
    line.y = horizontalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Vertical lines
  const verticalLinePositions = [
    { x: 179.5, y: 55, width: 1, height: 428 },
    { x: 18.5, y: 55, width: 1, height: 428 },
    { x: 343.5, y: 55, width: 1, height: 428 },
    { x: 507.5, y: 55, width: 1, height: 428 },
    { x: 671.5, y: 55, width: 1, height: 428 },
    { x: 833.5, y: 55, width: 1, height: 428 }
  ];

  for (let i = 0; i < verticalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Vertical Line ${i + 1}`;
    line.resize(verticalLinePositions[i].width, verticalLinePositions[i].height);
    line.x = verticalLinePositions[i].x;
    line.y = verticalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Create knobs (16 knobs total)
  const knobs = [];
  const knobPositions = [
    // Row 1 (top)
    { x: 98, y: 214, radius: 19.5 },
    { x: 261, y: 214, radius: 19.5 },
    { x: 425, y: 214, radius: 19.5 },
    { x: 589, y: 214, radius: 19.5 },
    { x: 753, y: 214, radius: 19.5 },
    // Row 2 (middle)
    { x: 98, y: 299, radius: 19.5 },
    { x: 261, y: 299, radius: 19.5 },
    { x: 425, y: 299, radius: 19.5 },
    { x: 589, y: 299, radius: 19.5 },
    { x: 753, y: 299, radius: 19.5 },
    // Row 3 (bottom)
    { x: 98, y: 398, radius: 19.5 },
    { x: 261, y: 398, radius: 19.5 },
    { x: 425, y: 398, radius: 19.5 },
    { x: 589, y: 398, radius: 19.5 },
    { x: 753, y: 398, radius: 19.5 },
    { x: 908, y: 398, radius: 19.5 }
  ];

  for (let i = 0; i < knobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Knob ${i + 1}`;
    knob.resize(knobPositions[i].radius * 2, knobPositions[i].radius * 2);
    knob.x = knobPositions[i].x - knobPositions[i].radius;
    knob.y = knobPositions[i].y - knobPositions[i].radius;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Create small knobs (5 knobs in header)
  const smallKnobs = [];
  const smallKnobPositions = [
    { x: 149, y: 73, radius: 7.5 },
    { x: 312, y: 73, radius: 7.5 },
    { x: 476, y: 73, radius: 7.5 },
    { x: 640, y: 73, radius: 7.5 },
    { x: 804, y: 73, radius: 7.5 }
  ];

  for (let i = 0; i < smallKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Small Knob ${i + 1}`;
    knob.resize(smallKnobPositions[i].radius * 2, smallKnobPositions[i].radius * 2);
    knob.x = smallKnobPositions[i].x - smallKnobPositions[i].radius;
    knob.y = smallKnobPositions[i].y - smallKnobPositions[i].radius;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    smallKnobs.push(knob);
  }

  // Create buttons (various sizes)
  const buttons = [];

  // Small square buttons (15x15)
  const squareButtonPositions = [
    { x: 26.5, y: 65.5 }, { x: 189.5, y: 65.5 }, { x: 353.5, y: 65.5 },
    { x: 517.5, y: 65.5 }, { x: 681.5, y: 65.5 }
  ];

  for (let i = 0; i < squareButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Square Button ${i + 1}`;
    button.resize(15, 15);
    button.x = squareButtonPositions[i].x;
    button.y = squareButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    buttons.push(button);
  }

  // Rectangular buttons (26x14)
  const rectButtonPositions = [
    { x: 82.5, y: 460.5 }, { x: 245.5, y: 460.5 }, { x: 409.5, y: 460.5 },
    { x: 573.5, y: 460.5 }, { x: 737.5, y: 460.5 }
  ];

  for (let i = 0; i < rectButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Rect Button ${i + 1}`;
    button.resize(26, 14);
    button.x = rectButtonPositions[i].x;
    button.y = rectButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    buttons.push(button);
  }

  // Wide button (88x14)
  const wideButton = figma.createRectangle();
  wideButton.name = "Wide Button";
  wideButton.resize(88, 14);
  wideButton.x = 862.5;
  wideButton.y = 328.5;
  wideButton.fills = [];
  wideButton.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  wideButton.strokeWeight = 1;
  buttons.push(wideButton);

  // Narrow buttons (9x15)
  const narrowButtonPositions = [
    { x: 163.5, y: 65.5 }, { x: 326.5, y: 65.5 }, { x: 490.5, y: 65.5 },
    { x: 654.5, y: 65.5 }, { x: 818.5, y: 65.5 }
  ];

  for (let i = 0; i < narrowButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Narrow Button ${i + 1}`;
    button.resize(9, 15);
    button.x = narrowButtonPositions[i].x;
    button.y = narrowButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    buttons.push(button);
  }

  // Vertical sliders (31x199)
  const slider1 = figma.createRectangle();
  slider1.name = "Vertical Slider 1";
  slider1.resize(31, 199);
  slider1.x = 862.5;
  slider1.y = 94.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  const slider2 = figma.createRectangle();
  slider2.name = "Vertical Slider 2";
  slider2.resize(31, 199);
  slider2.x = 923.5;
  slider2.y = 94.5;
  slider2.fills = [];
  slider2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider2.strokeWeight = 1;

  // Title bar (266x25)
  const titleBar = figma.createRectangle();
  titleBar.name = "Title Bar";
  titleBar.resize(266, 25);
  titleBar.x = 561.5;
  titleBar.y = 17.5;
  titleBar.fills = [];
  titleBar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  titleBar.strokeWeight = 1;

  // Group all elements
  const effects2Group = figma.group([
    panel, titleBar,
    ...gridLines,
    ...knobs, ...smallKnobs,
    ...buttons,
    slider1, slider2
  ], figma.currentPage);

  effects2Group.name = "Effects2 Panel";
  effects2Group.x = figma.viewport.center.x - panelWidth / 2;
  effects2Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects2Group];
  figma.viewport.scrollAndZoomIntoView([effects2Group]);
  
  
  return effects2Group;
}

async function createEffects3Panel() {
  const panelWidth = 870;
  const panelHeight = 423;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects3 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create main display area
  const displayArea = figma.createRectangle();
  displayArea.name = "Display Area";
  displayArea.resize(204, 154);
  displayArea.x = 336.5;
  displayArea.y = 67.5;
  displayArea.fills = [];
  displayArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  displayArea.strokeWeight = 1;

  // Create knobs (various sizes)
  const knobs = [];

  // Large knob (89x89)
  const largeKnob = figma.createEllipse();
  largeKnob.name = "Large Knob";
  largeKnob.resize(89, 89);
  largeKnob.x = 134 - 44.5;
  largeKnob.y = 242 - 44.5;
  largeKnob.fills = [];
  largeKnob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  largeKnob.strokeWeight = 1;
  knobs.push(largeKnob);

  // Medium knobs (65x65)
  const mediumKnobPositions = [
    { x: 309, y: 297 }, { x: 435, y: 297 }, { x: 561, y: 297 },
    { x: 746, y: 297 }, { x: 653, y: 205 }
  ];

  for (let i = 0; i < mediumKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Medium Knob ${i + 1}`;
    knob.resize(65, 65);
    knob.x = mediumKnobPositions[i].x - 32.5;
    knob.y = mediumKnobPositions[i].y - 32.5;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Small knobs (19x19)
  const smallKnobPositions = [
    { x: 818, y: 68 }, { x: 53, y: 68 }, { x: 818, y: 330 }, { x: 53, y: 330 }
  ];

  for (let i = 0; i < smallKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Small Knob ${i + 1}`;
    knob.resize(19, 19);
    knob.x = smallKnobPositions[i].x - 9.5;
    knob.y = smallKnobPositions[i].y - 9.5;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Tiny knobs (17x17)
  const tinyKnobPositions = [
    { x: 245, y: 294 }, { x: 617, y: 294 }, { x: 720, y: 206 }
  ];

  for (let i = 0; i < tinyKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Tiny Knob ${i + 1}`;
    knob.resize(17, 17);
    knob.x = tinyKnobPositions[i].x - 8.5;
    knob.y = tinyKnobPositions[i].y - 8.5;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Create buttons (various sizes)
  const buttons = [];

  // Square buttons (42x42)
  const squareButtonPositions = [
    { x: 174.5, y: 102.5 }, { x: 264.5, y: 353.5 }, { x: 339.5, y: 353.5 },
    { x: 414.5, y: 353.5 }, { x: 489.5, y: 353.5 }, { x: 564.5, y: 353.5 }
  ];

  for (let i = 0; i < squareButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Square Button ${i + 1}`;
    button.resize(42, 42);
    button.x = squareButtonPositions[i].x;
    button.y = squareButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    buttons.push(button);
  }

  // Header buttons
  const headerButtons = [];

  // Wide header button (248x20)
  const wideHeaderButton = figma.createRectangle();
  wideHeaderButton.name = "Wide Header Button";
  wideHeaderButton.resize(248, 20);
  wideHeaderButton.x = 93.5;
  wideHeaderButton.y = 6.5;
  wideHeaderButton.fills = [];
  wideHeaderButton.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  wideHeaderButton.strokeWeight = 1;
  headerButtons.push(wideHeaderButton);

  // Small header buttons (20x20)
  const smallHeaderButtonPositions = [
    { x: 39.5, y: 6.5 }, { x: 350.5, y: 6.5 }, { x: 63.5, y: 6.5 }, { x: 379.5, y: 6.5 }
  ];

  for (let i = 0; i < smallHeaderButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Small Header Button ${i + 1}`;
    button.resize(20, 20);
    button.x = smallHeaderButtonPositions[i].x;
    button.y = smallHeaderButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    headerButtons.push(button);
  }

  // Create grid lines
  const gridLines = [];

  // Horizontal lines
  const horizontalLinePositions = [
    { x: 0, y: 34.5, width: 870, height: 1 },
    { x: 30, y: 407.5, width: 808, height: 1 },
    { x: 30, y: 345.5, width: 808, height: 1 },
    { x: 30, y: 51.5, width: 808, height: 1 }
  ];

  for (let i = 0; i < horizontalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Horizontal Line ${i + 1}`;
    line.resize(horizontalLinePositions[i].width, horizontalLinePositions[i].height);
    line.x = horizontalLinePositions[i].x;
    line.y = horizontalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Vertical lines
  const verticalLinePositions = [
    { x: 30.5, y: 35, width: 1, height: 388 },
    { x: 838.5, y: 35, width: 1, height: 388 }
  ];

  for (let i = 0; i < verticalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Vertical Line ${i + 1}`;
    line.resize(verticalLinePositions[i].width, verticalLinePositions[i].height);
    line.x = verticalLinePositions[i].x;
    line.y = verticalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Group all elements
  const effects3Group = figma.group([
    panel, displayArea,
    ...knobs,
    ...buttons, ...headerButtons,
    ...gridLines
  ], figma.currentPage);

  effects3Group.name = "Effects3 Panel";
  effects3Group.x = figma.viewport.center.x - panelWidth / 2;
  effects3Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects3Group];
  figma.viewport.scrollAndZoomIntoView([effects3Group]);
  
  
  return effects3Group;
}
async function createEffects4Panel() {
  const panelWidth = 595;
  const panelHeight = 837;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects4 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create large circular display
  const circularDisplay = figma.createEllipse();
  circularDisplay.name = "Circular Display";
  circularDisplay.resize(332, 332);
  circularDisplay.x = 297.5 - 166;
  circularDisplay.y = 294.5 - 166;
  circularDisplay.fills = [];
  circularDisplay.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  circularDisplay.strokeWeight = 1;

  // Create vertical sliders
  const slider1 = figma.createRectangle();
  slider1.name = "Vertical Slider 1";
  slider1.resize(14, 266);
  slider1.x = 493.5;
  slider1.y = 144.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  const slider2 = figma.createRectangle();
  slider2.name = "Vertical Slider 2";
  slider2.resize(38, 266);
  slider2.x = 79.5;
  slider2.y = 144.5;
  slider2.fills = [];
  slider2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider2.strokeWeight = 1;

  // Create header bar
  const headerBar = figma.createRectangle();
  headerBar.name = "Header Bar";
  headerBar.resize(228, 31);
  headerBar.x = 184.5;
  headerBar.y = 22.5;
  headerBar.fills = [];
  headerBar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  headerBar.strokeWeight = 1;

  // Create bottom control areas
  const bottomControl1 = figma.createRectangle();
  bottomControl1.name = "Bottom Control 1";
  bottomControl1.resize(261, 36);
  bottomControl1.x = 291.5;
  bottomControl1.y = 633.5;
  bottomControl1.fills = [];
  bottomControl1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  bottomControl1.strokeWeight = 1;

  const bottomControl2 = figma.createRectangle();
  bottomControl2.name = "Bottom Control 2";
  bottomControl2.resize(261, 36);
  bottomControl2.x = 36.5;
  bottomControl2.y = 633.5;
  bottomControl2.fills = [];
  bottomControl2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  bottomControl2.strokeWeight = 1;

  // Create large bottom area
  const largeBottomArea = figma.createRectangle();
  largeBottomArea.name = "Large Bottom Area";
  largeBottomArea.resize(516, 67);
  largeBottomArea.x = 36.5;
  largeBottomArea.y = 705.5;
  largeBottomArea.fills = [];
  largeBottomArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  largeBottomArea.strokeWeight = 1;

  // Create horizontal divider line
  const dividerLine = figma.createRectangle();
  dividerLine.name = "Divider Line";
  dividerLine.resize(595, 1);
  dividerLine.x = 0;
  dividerLine.y = 550.5;
  dividerLine.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  dividerLine.strokes = [];
  dividerLine.strokeWeight = 0;

  // Group all elements
  const effects4Group = figma.group([
    panel, circularDisplay,
    slider1, slider2,
    headerBar,
    bottomControl1, bottomControl2, largeBottomArea,
    dividerLine
  ], figma.currentPage);

  effects4Group.name = "Effects4 Panel";
  effects4Group.x = figma.viewport.center.x - panelWidth / 2;
  effects4Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects4Group];
  figma.viewport.scrollAndZoomIntoView([effects4Group]);
  
  
  return effects4Group;
}
async function createEffects5Panel() {
  const panelWidth = 1685;
  const panelHeight = 844;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects5 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create header bar
  const headerBar = figma.createRectangle();
  headerBar.name = "Header Bar";
  headerBar.resize(680, 29);
  headerBar.x = 520.5;
  headerBar.y = 9.5;
  headerBar.fills = [];
  headerBar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  headerBar.strokeWeight = 1;

  // Create large circular displays
  const circularDisplay1 = figma.createEllipse();
  circularDisplay1.name = "Circular Display 1";
  circularDisplay1.resize(191, 191);
  circularDisplay1.x = 428 - 95.5;
  circularDisplay1.y = 422 - 95.5;
  circularDisplay1.fills = [];
  circularDisplay1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  circularDisplay1.strokeWeight = 1;

  const circularDisplay2 = figma.createEllipse();
  circularDisplay2.name = "Circular Display 2";
  circularDisplay2.resize(191, 191);
  circularDisplay2.x = 1264 - 95.5;
  circularDisplay2.y = 422 - 95.5;
  circularDisplay2.fills = [];
  circularDisplay2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  circularDisplay2.strokeWeight = 1;

  // Create vertical sliders (3 sliders)
  const slider1 = figma.createRectangle();
  slider1.name = "Vertical Slider 1";
  slider1.resize(47, 267);
  slider1.x = 651.5;
  slider1.y = 273.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  const slider2 = figma.createRectangle();
  slider2.name = "Vertical Slider 2";
  slider2.resize(47, 267);
  slider2.x = 818.5;
  slider2.y = 273.5;
  slider2.fills = [];
  slider2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider2.strokeWeight = 1;

  const slider3 = figma.createRectangle();
  slider3.name = "Vertical Slider 3";
  slider3.resize(47, 267);
  slider3.x = 987.5;
  slider3.y = 273.5;
  slider3.fills = [];
  slider3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider3.strokeWeight = 1;

  // Create small control buttons (3 buttons)
  const smallButton1 = figma.createRectangle();
  smallButton1.name = "Small Button 1";
  smallButton1.resize(47, 45);
  smallButton1.x = 651.5;
  smallButton1.y = 607.5;
  smallButton1.fills = [];
  smallButton1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallButton1.strokeWeight = 1;

  const smallButton2 = figma.createRectangle();
  smallButton2.name = "Small Button 2";
  smallButton2.resize(47, 45);
  smallButton2.x = 819.5;
  smallButton2.y = 607.5;
  smallButton2.fills = [];
  smallButton2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallButton2.strokeWeight = 1;

  const smallButton3 = figma.createRectangle();
  smallButton3.name = "Small Button 3";
  smallButton3.resize(47, 45);
  smallButton3.x = 987.5;
  smallButton3.y = 607.5;
  smallButton3.fills = [];
  smallButton3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  smallButton3.strokeWeight = 1;

  // Create bottom control buttons (9 buttons)
  const bottomButtons = [];
  const bottomButtonPositions = [
    { x: 68.5, y: 755.5 }, { x: 209.5, y: 755.5 }, { x: 350.5, y: 755.5 },
    { x: 490.5, y: 755.5 }, { x: 949.5, y: 755.5 }, { x: 1116.5, y: 755.5 },
    { x: 1256.5, y: 755.5 }, { x: 1397.5, y: 755.5 }, { x: 1535.5, y: 755.5 }
  ];

  for (let i = 0; i < bottomButtonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Bottom Button ${i + 1}`;
    button.resize(82, 47);
    button.x = bottomButtonPositions[i].x;
    button.y = bottomButtonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    bottomButtons.push(button);
  }

  // Create center control area
  const centerControlArea = figma.createRectangle();
  centerControlArea.name = "Center Control Area";
  centerControlArea.resize(85, 42);
  centerControlArea.x = 651.5;
  centerControlArea.y = 755.5;
  centerControlArea.fills = [];
  centerControlArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  centerControlArea.strokeWeight = 1;

  // Create center knob
  const centerKnob = figma.createEllipse();
  centerKnob.name = "Center Knob";
  centerKnob.resize(48, 48);
  centerKnob.x = 843.5 - 24;
  centerKnob.y = 778.5 - 24;
  centerKnob.fills = [];
  centerKnob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  centerKnob.strokeWeight = 1;

  // Create grid lines
  const gridLines = [];

  // Horizontal lines
  const horizontalLinePositions = [
    { x: 23, y: 692.5, width: 1640, height: 1 },
    { x: 23, y: 57.5, width: 1640, height: 1 },
    { x: 0, y: 42.5, width: 1684, height: 1 },
    { x: 23, y: 828.5, width: 1640, height: 1 }
  ];

  for (let i = 0; i < horizontalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Horizontal Line ${i + 1}`;
    line.resize(horizontalLinePositions[i].width, horizontalLinePositions[i].height);
    line.x = horizontalLinePositions[i].x;
    line.y = horizontalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Vertical lines
  const verticalLinePositions = [
    { x: 23.5, y: 58, width: 1, height: 771 },
    { x: 1684.5, y: 58, width: 1, height: 771 }
  ];

  for (let i = 0; i < verticalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Vertical Line ${i + 1}`;
    line.resize(verticalLinePositions[i].width, verticalLinePositions[i].height);
    line.x = verticalLinePositions[i].x;
    line.y = verticalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Create vertical divider line
  const verticalDivider = figma.createRectangle();
  verticalDivider.name = "Vertical Divider";
  verticalDivider.resize(1, 48);
  verticalDivider.x = 623.5;
  verticalDivider.y = 755;
  verticalDivider.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  verticalDivider.strokes = [];
  verticalDivider.strokeWeight = 0;

  // Group all elements
  const effects5Group = figma.group([
    panel, headerBar,
    circularDisplay1, circularDisplay2,
    slider1, slider2, slider3,
    smallButton1, smallButton2, smallButton3,
    ...bottomButtons,
    centerControlArea, centerKnob,
    ...gridLines,
    verticalDivider
  ], figma.currentPage);

  effects5Group.name = "Effects5 Panel";
  effects5Group.x = figma.viewport.center.x - panelWidth / 2;
  effects5Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects5Group];
  figma.viewport.scrollAndZoomIntoView([effects5Group]);
  
  
  return effects5Group;
}
async function createEffects6Panel() {
  const panelWidth = 912;
  const panelHeight = 361;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects6 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create knobs (6 knobs total)
  const knobs = [];

  // Small knobs (61x61)
  const smallKnobPositions = [
    { x: 80, y: 123 }, { x: 215, y: 123 }, { x: 80, y: 247 }, { x: 215, y: 247 }
  ];

  for (let i = 0; i < smallKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Small Knob ${i + 1}`;
    knob.resize(61, 61);
    knob.x = smallKnobPositions[i].x - 30.5;
    knob.y = smallKnobPositions[i].y - 30.5;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Medium knobs (61x61) - using path data converted to circles
  const mediumKnob1 = figma.createEllipse();
  mediumKnob1.name = "Medium Knob 1";
  mediumKnob1.resize(61, 61);
  mediumKnob1.x = 576.5 - 30.5;
  mediumKnob1.y = 123 - 30.5;
  mediumKnob1.fills = [];
  mediumKnob1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  mediumKnob1.strokeWeight = 1;
  knobs.push(mediumKnob1);

  const mediumKnob2 = figma.createEllipse();
  mediumKnob2.name = "Medium Knob 2";
  mediumKnob2.resize(61, 61);
  mediumKnob2.x = 576.5 - 30.5;
  mediumKnob2.y = 247 - 30.5;
  mediumKnob2.fills = [];
  mediumKnob2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  mediumKnob2.strokeWeight = 1;
  knobs.push(mediumKnob2);

  const mediumKnob3 = figma.createEllipse();
  mediumKnob3.name = "Medium Knob 3";
  mediumKnob3.resize(61, 61);
  mediumKnob3.x = 694.5 - 30.5;
  mediumKnob3.y = 176 - 30.5;
  mediumKnob3.fills = [];
  mediumKnob3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  mediumKnob3.strokeWeight = 1;
  knobs.push(mediumKnob3);

  // Create vertical sliders (3 sliders)
  const slider1 = figma.createRectangle();
  slider1.name = "Vertical Slider 1";
  slider1.resize(13, 199);
  slider1.x = 800.5;
  slider1.y = 111.5;
  slider1.fills = [];
  slider1.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider1.strokeWeight = 1;

  const slider2 = figma.createRectangle();
  slider2.name = "Vertical Slider 2";
  slider2.resize(13, 199);
  slider2.x = 831.5;
  slider2.y = 111.5;
  slider2.fills = [];
  slider2.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider2.strokeWeight = 1;

  const slider3 = figma.createRectangle();
  slider3.name = "Vertical Slider 3";
  slider3.resize(13, 199);
  slider3.x = 863.5;
  slider3.y = 111.5;
  slider3.fills = [];
  slider3.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  slider3.strokeWeight = 1;

  // Create control button
  const controlButton = figma.createRectangle();
  controlButton.name = "Control Button";
  controlButton.resize(40, 23);
  controlButton.x = 372.5;
  controlButton.y = 82.5;
  controlButton.fills = [];
  controlButton.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  controlButton.strokeWeight = 1;

  // Create main display area
  const displayArea = figma.createRectangle();
  displayArea.name = "Display Area";
  displayArea.resize(174, 170);
  displayArea.x = 314.5;
  displayArea.y = 140.5;
  displayArea.fills = [];
  displayArea.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  displayArea.strokeWeight = 1;

  // Create small knob in header
  const headerKnob = figma.createEllipse();
  headerKnob.name = "Header Knob";
  headerKnob.resize(17, 17);
  headerKnob.x = 27 - 8.5;
  headerKnob.y = 21 - 8.5;
  headerKnob.fills = [];
  headerKnob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  headerKnob.strokeWeight = 1;

  // Create grid lines
  const gridLines = [];

  // Horizontal line
  const horizontalLine = figma.createRectangle();
  horizontalLine.name = "Horizontal Line";
  horizontalLine.resize(912, 1);
  horizontalLine.x = 0;
  horizontalLine.y = 43.5;
  horizontalLine.fills = [{ type: 'SOLID', color: { r: 0.0078, g: 0.0078, b: 0.0078 } }];
  horizontalLine.strokes = [];
  horizontalLine.strokeWeight = 0;
  gridLines.push(horizontalLine);

  // Vertical lines
  const verticalLine1 = figma.createRectangle();
  verticalLine1.name = "Vertical Line 1";
  verticalLine1.resize(1, 44);
  verticalLine1.x = 820.5;
  verticalLine1.y = 0;
  verticalLine1.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  verticalLine1.strokes = [];
  verticalLine1.strokeWeight = 0;
  gridLines.push(verticalLine1);

  const verticalLine2 = figma.createRectangle();
  verticalLine2.name = "Vertical Line 2";
  verticalLine2.resize(1, 44);
  verticalLine2.x = 866.5;
  verticalLine2.y = 0;
  verticalLine2.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  verticalLine2.strokes = [];
  verticalLine2.strokeWeight = 0;
  gridLines.push(verticalLine2);

  // Group all elements
  const effects6Group = figma.group([
    panel, displayArea, controlButton,
    ...knobs, headerKnob,
    slider1, slider2, slider3,
    ...gridLines
  ], figma.currentPage);

  effects6Group.name = "Effects6 Panel";
  effects6Group.x = figma.viewport.center.x - panelWidth / 2;
  effects6Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects6Group];
  figma.viewport.scrollAndZoomIntoView([effects6Group]);
  
  
  return effects6Group;
}
async function createEffects7Panel() {
  const panelWidth = 1096;
  const panelHeight = 902;
  const panelX = 0;
  const panelY = 0;

  // Create main panel background
  const panel = figma.createRectangle();
  panel.name = "Effects7 Panel";
  panel.resize(panelWidth, panelHeight);
  panel.x = panelX;
  panel.y = panelY;
  panel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  panel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  panel.strokeWeight = 1;

  // Create knobs (12 knobs total)
  const knobs = [];

  // Small knobs (94x94)
  const smallKnobPositions = [
    { x: 120.5, y: 532.5 }, { x: 360.5, y: 770.5 }, { x: 736.5, y: 770.5 },
    { x: 287.5, y: 532.5 }, { x: 464.5, y: 532.5 }, { x: 631.5, y: 532.5 },
    { x: 810.5, y: 532.5 }, { x: 975.5, y: 532.5 }
  ];

  for (let i = 0; i < smallKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Small Knob ${i + 1}`;
    knob.resize(94, 94);
    knob.x = smallKnobPositions[i].x - 47;
    knob.y = smallKnobPositions[i].y - 47;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Large knobs (129x129)
  const largeKnobPositions = [
    { x: 548, y: 771 }, { x: 143, y: 200 }, { x: 953, y: 200 }
  ];

  for (let i = 0; i < largeKnobPositions.length; i++) {
    const knob = figma.createEllipse();
    knob.name = `Large Knob ${i + 1}`;
    knob.resize(129, 129);
    knob.x = largeKnobPositions[i].x - 64.5;
    knob.y = largeKnobPositions[i].y - 64.5;
    knob.fills = [];
    knob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    knob.strokeWeight = 1;
    knobs.push(knob);
  }

  // Tiny knob (30x30)
  const tinyKnob = figma.createEllipse();
  tinyKnob.name = "Tiny Knob";
  tinyKnob.resize(30, 30);
  tinyKnob.x = 142.5 - 15;
  tinyKnob.y = 688.5 - 15;
  tinyKnob.fills = [];
  tinyKnob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  tinyKnob.strokeWeight = 1;
  knobs.push(tinyKnob);

  // Medium knob (77x77)
  const mediumKnob = figma.createEllipse();
  mediumKnob.name = "Medium Knob";
  mediumKnob.resize(77, 77);
  mediumKnob.x = 143 - 38.5;
  mediumKnob.y = 771 - 38.5;
  mediumKnob.fills = [];
  mediumKnob.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  mediumKnob.strokeWeight = 1;
  knobs.push(mediumKnob);

  // Create main display area
  const mainDisplay = figma.createRectangle();
  mainDisplay.name = "Main Display";
  mainDisplay.resize(679, 66);
  mainDisplay.x = 208.5;
  mainDisplay.y = 327.5;
  mainDisplay.fills = [];
  mainDisplay.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  mainDisplay.strokeWeight = 1;

  // Create vertical slider
  const verticalSlider = figma.createRectangle();
  verticalSlider.name = "Vertical Slider";
  verticalSlider.resize(35, 112);
  verticalSlider.x = 936.5;
  verticalSlider.y = 720.5;
  verticalSlider.fills = [];
  verticalSlider.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  verticalSlider.strokeWeight = 1;

  // Create large display area
  const largeDisplay = figma.createRectangle();
  largeDisplay.name = "Large Display";
  largeDisplay.resize(514, 122);
  largeDisplay.x = 287.5;
  largeDisplay.y = 122.5;
  largeDisplay.fills = [];
  largeDisplay.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  largeDisplay.strokeWeight = 1;

  // Create control buttons (6 buttons)
  const controlButtons = [];
  const buttonPositions = [
    { x: 302.5, y: 258.5 }, { x: 484.5, y: 258.5 }, { x: 671.5, y: 258.5 },
    { x: 371.5, y: 258.5 }, { x: 553.5, y: 258.5 }, { x: 740.5, y: 258.5 }
  ];

  for (let i = 0; i < buttonPositions.length; i++) {
    const button = figma.createRectangle();
    button.name = `Control Button ${i + 1}`;
    button.resize(56, 37);
    button.x = buttonPositions[i].x;
    button.y = buttonPositions[i].y;
    button.fills = [];
    button.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    button.strokeWeight = 1;
    controlButtons.push(button);
  }

  // Create grid lines
  const gridLines = [];

  // Horizontal lines
  const horizontalLinePositions = [
    { x: 0, y: 69.5, width: 1096, height: 1 },
    { x: 0, y: 413.5, width: 1096, height: 1 },
    { x: 0, y: 644.5, width: 1096, height: 1 }
  ];

  for (let i = 0; i < horizontalLinePositions.length; i++) {
    const line = figma.createRectangle();
    line.name = `Horizontal Line ${i + 1}`;
    line.resize(horizontalLinePositions[i].width, horizontalLinePositions[i].height);
    line.x = horizontalLinePositions[i].x;
    line.y = horizontalLinePositions[i].y;
    line.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    line.strokes = [];
    line.strokeWeight = 0;
    gridLines.push(line);
  }

  // Group all elements
  const effects7Group = figma.group([
    panel, mainDisplay, verticalSlider, largeDisplay,
    ...knobs,
    ...controlButtons,
    ...gridLines
  ], figma.currentPage);

  effects7Group.name = "Effects7 Panel";
  effects7Group.x = figma.viewport.center.x - panelWidth / 2;
  effects7Group.y = figma.viewport.center.y - panelHeight / 2;
  
  // Select the created panel
  figma.currentPage.selection = [effects7Group];
  figma.viewport.scrollAndZoomIntoView([effects7Group]);


  return effects7Group;
}

////////////////////////////////////////////////////////////////////////////
////////////////////////// STRIP PREVIEW ///////////////////////
////////////////////////////////////////////////////////////////////////////
// Reads an animation strip on the canvas (knob_sprite, slider/meter filmstrips,
// button state sprites) and exports it as PNG with its exact frame geometry,
// so the UI previewer never has to guess frame count or gap.

const STRIP_PREVIEW_MAX_PX = 30000; // keep the decoded PNG within browser limits

// A strip is a group of equal-size frames laid out in one row or column
function describeStrip(node) {
    if (!('children' in node)) return null;
    const cells = node.children
        .filter(c => c.visible !== false && c.absoluteBoundingBox)
        .map(c => c.absoluteBoundingBox);
    if (cells.length < 2) return null;
    const cw = cells[0].width;
    const ch = cells[0].height;
    if (!cells.every(b => Math.abs(b.width - cw) <= 1 && Math.abs(b.height - ch) <= 1)) return null;
    const sameX = cells.every(b => Math.abs(b.x - cells[0].x) <= 1);
    const sameY = cells.every(b => Math.abs(b.y - cells[0].y) <= 1);
    if (sameX === sameY) return null; // stacked on top of each other, or a grid
    const axis = sameX ? 'v' : 'h';
    const pos = b => axis === 'v' ? b.y : b.x;
    const sorted = cells.slice().sort((a, b) => pos(a) - pos(b));
    const step = (pos(sorted[sorted.length - 1]) - pos(sorted[0])) / (sorted.length - 1);
    const cell = axis === 'v' ? ch : cw;
    return {
        frames: cells.length,
        axis: axis,
        gutter: Math.max(0, Math.round(step - cell)),
        cellW: Math.round(cw),
        cellH: Math.round(ch)
    };
}

async function exportStripPreview() {
    const selection = figma.currentPage.selection;
    if (selection.length !== 1) {
        return { ok: false, error: 'Select one animation strip — e.g. the knob_sprite group made by Create Animation Frames.' };
    }
    const node = selection[0];
    const strip = describeStrip(node);
    if (!strip) {
        return { ok: false, error: `"${node.name}" isn't an animation strip. Select a group of equal-size frames laid out in a row or column.` };
    }
    const bb = node.absoluteBoundingBox;
    const scale = Math.min(2, STRIP_PREVIEW_MAX_PX / Math.max(bb.width, bb.height));
    // useAbsoluteBounds: export the layout box, not the shadow-inflated render
    // box, so frame i starts exactly at i * (cell + gutter)
    const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale },
        useAbsoluteBounds: true
    });
    return Object.assign({ ok: true, bytes: bytes, name: node.name, scale: scale }, strip);
}

////////////////////////////////////////////////////////////////////////////
////////////////////////// VELLUM EXPORT ///////////////////////
////////////////////////////////////////////////////////////////////////////
// Turns the selected panel (group or frame) into a Vellum layout XML that
// Vellum's Import XML loads straight into Wireframe mode. Widget types and
// default sizes mirror Vellum's REGISTRY, so the gallery panels map 1:1.
//
// Naming convention (layer names, case-insensitive):
//   - Matched by keyword: knob/dial, fader, slider, button/switch/pad, menu,
//     display/screen/lcd, vu, meter, keyboard/keys, xy pad, mod/pitch wheel,
//     visualizer/scope, label/title, line/divider (-> guide), bar/area (-> shape)
//   - Explicit tag wins over keywords: "Cutoff [knob-primary]", "Logo [image]",
//     "[skip]" to leave a layer out, "[guide]" to force a guide line.
//   - Knob tier comes from size: >=80px hero, >=44px knob, else mini knob.
//   - Unnamed groups/frames are walked into; a matched group counts as one widget.

const VELLUM_LAYOUT_VERSION = 2;

const VELLUM_TYPES = [
    'knob-primary', 'knob-secondary', 'knob-tertiary', 'button', 'fader', 'pitchwheel', 'modwheel',
    'keys', 'menu', 'lcd-screen', 'fx-rack', 'slider-h', 'label', 'meter', 'vumeter', 'visualizer',
    'image', 'chart', 'sequencer', 'drumseq', 'samplegalaxy', 'midiplayer', 'chordgen', 'arpeggiator',
    'chordshift', 'chordmap', 'xypad', 'camtracker', 'gamepad', 'morphblob',
    'shape-rect', 'shape-circle', 'shape-triangle'
];

// Interactive controls — overlaps between these are almost always a layout mistake
const VELLUM_CONTROL_TYPES = [
    'knob-primary', 'knob-secondary', 'knob-tertiary', 'button', 'fader', 'pitchwheel', 'modwheel',
    'keys', 'menu', 'slider-h', 'meter', 'vumeter', 'xypad'
];

function vellumKnobTier(w, h) {
    const s = Math.max(w, h);
    if (s >= 80) return 'knob-primary';
    if (s >= 44) return 'knob-secondary';
    return 'knob-tertiary';
}

function vellumShapeFor(node) {
    return node.type === 'ELLIPSE' ? 'shape-circle' : node.type === 'POLYGON' ? 'shape-triangle' : 'shape-rect';
}

// Returns { type } | { guide } | { skip, reason } | null (no match)
function vellumClassify(node, w, h) {
    const raw = node.name || '';
    const tag = /\[([a-z0-9-]+)\]/i.exec(raw);
    if (tag) {
        const t = tag[1].toLowerCase();
        if (t === 'skip' || t === 'ignore') return { skip: true, reason: 'tagged [skip]' };
        if (t === 'guide') return { guide: true };
        if (t === 'knob') return { type: vellumKnobTier(w, h) };
        if (t === 'slider') return { type: w >= h ? 'slider-h' : 'fader' };
        if (t === 'shape') return { type: vellumShapeFor(node) };
        if (VELLUM_TYPES.indexOf(t) !== -1) return { type: t };
    }
    if (node.type === 'LINE') return { guide: true };
    const n = raw.toLowerCase().replace(/[_\-]+/g, ' ');
    if (/sprite|filmstrip|animation|knob frame|^frame \d/.test(n)) return { skip: true, reason: 'animation strip' };
    if (node.type === 'TEXT') return { type: 'label', text: node.characters };
    if (/\bline\b|divider/.test(n) && Math.min(w, h) <= 3) return { guide: true };
    if (/xy ?pad/.test(n)) return { type: 'xypad' };
    if (/mod ?wheel/.test(n)) return { type: 'modwheel' };
    if (/pitch ?(wheel|bend)/.test(n)) return { type: 'pitchwheel' };
    if (/knob|dial|rotary|encoder/.test(n)) return { type: vellumKnobTier(w, h) };
    if (/fader/.test(n)) return { type: 'fader' };
    if (/slider/.test(n)) return { type: w >= h ? 'slider-h' : 'fader' };
    if (/\bvu\b/.test(n)) return { type: 'vumeter' };
    if (/meter|\bpeak\b/.test(n)) return { type: 'meter' };
    if (/keyboard|\bkeys\b|piano|klavier/.test(n)) return { type: 'keys' };
    if (/visuali[sz]er|scope|waveform|spectrum|analy[sz]er/.test(n)) return { type: 'visualizer' };
    if (/menu|dropdown|combo|preset/.test(n)) return { type: 'menu' };
    if (/circular display|round display/.test(n)) return { type: 'shape-circle' };
    if (/display|screen|\blcd\b|readout/.test(n)) return { type: 'lcd-screen' };
    if (/button|\bbtn\b|switch|toggle|\bpad\b|rocker|\barrow\b|power|\bled\b/.test(n)) return { type: 'button' };
    if (/\blogo\b|\bimage\b|\bicon\b/.test(n)) return { type: 'image' };
    if (/\blabel\b|\btitle\b(?! bar)|caption/.test(n)) return { type: 'label' };
    if (/\bline\b|divider|\bbar\b|\barea\b|section|\bpanel\b|background|\bbg\b|path|container|\bbox\b|arrows/.test(n)) {
        return { type: vellumShapeFor(node) };
    }
    return null;
}

function vellumSolidHex(node) {
    if (!node || !('fills' in node) || !Array.isArray(node.fills)) return null;
    const fill = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
    if (!fill) return null;
    const to2 = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return '#' + to2(fill.color.r) + to2(fill.color.g) + to2(fill.color.b);
}

// Frames are their own artboard. Groups (like the gallery panels) use the big
// background rectangle behind everything; failing that, the group's bounds.
function vellumFindArtboard(root) {
    const bb = root.absoluteBoundingBox;
    if (root.type === 'FRAME' || root.type === 'COMPONENT' || root.type === 'INSTANCE') {
        return { node: null, box: bb, fill: vellumSolidHex(root) };
    }
    let best = null;
    root.children.forEach(c => {
        if (c.type !== 'RECTANGLE' || !c.absoluteBoundingBox) return;
        const b = c.absoluteBoundingBox;
        const area = b.width * b.height;
        if (!best || area > best.area) best = { node: c, box: b, area: area };
    });
    if (best && best.area >= bb.width * bb.height * 0.6) {
        return { node: best.node, box: best.box, fill: vellumSolidHex(best.node) };
    }
    return { node: null, box: bb, fill: null };
}

function vellumWalk(node, ctx) {
    if (node.visible === false || node === ctx.artboardNode) return;
    // A studio panel's art is the background image, not controls
    if (node.getPluginData && node.getPluginData('panelArt') === '1') {
        ctx.art = node;
        return;
    }
    const bb = node.absoluteBoundingBox;
    if (!bb) return;
    const x = bb.x - ctx.ox;
    const y = bb.y - ctx.oy;
    const w = bb.width;
    const h = bb.height;
    const isContainer = 'children' in node && node.type !== 'BOOLEAN_OPERATION';
    let cls = vellumClassify(node, w, h);
    if (!cls) {
        if (isContainer) {
            node.children.forEach(c => vellumWalk(c, ctx));
            return;
        }
        cls = { type: vellumShapeFor(node), fallback: true };
    }
    if (cls.skip) {
        ctx.skipped.push(`${node.name} (${cls.reason})`);
        return;
    }
    if (cls.guide) {
        if (h >= w) {
            ctx.guides.push({ orient: 'v', pos: Math.round(x + w / 2), start: Math.round(y), end: Math.round(y + h), name: node.name });
        } else {
            ctx.guides.push({ orient: 'h', pos: Math.round(y + h / 2), start: Math.round(x), end: Math.round(x + w), name: node.name });
        }
        return;
    }
    const name = (node.name || '').replace(/\[[a-z0-9-]+\]/gi, '').trim() || cls.type;
    const widget = {
        type: cls.type,
        name: name,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(1, Math.round(w)),
        h: Math.max(1, Math.round(h))
    };
    if (cls.text) widget.text = cls.text;
    if (cls.fallback) ctx.fallbacks.push(name);
    if ('rotation' in node && Math.abs(node.rotation) > 0.5) ctx.rotated.push(name);
    ctx.widgets.push(widget);
}

function vellumGuessPluginType(name) {
    const n = (name || '').toLowerCase();
    if (/midi/.test(n)) return 'midifx';
    if (/effect|\bfx\b/.test(n)) return 'effect';
    return 'instrument';
}

function vellumValidate(layout) {
    const warnings = [];
    const W = layout.artboardW;
    const H = layout.artboardH;
    const list = (arr, max) => arr.slice(0, max || 6).join(', ') + (arr.length > (max || 6) ? `, +${arr.length - (max || 6)} more` : '');

    const outside = layout.widgets.filter(w => w.x < -1 || w.y < -1 || w.x + w.w > W + 1 || w.y + w.h > H + 1).map(w => w.name);
    if (outside.length) warnings.push(`${outside.length} widget(s) extend past the ${W}×${H} artboard: ${list(outside)}`);

    const controls = layout.widgets.filter(w => VELLUM_CONTROL_TYPES.indexOf(w.type) !== -1);
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
            const a = controls[i], b = controls[j];
            const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ix <= 0 || iy <= 0) continue;
            const smaller = Math.min(a.w * a.h, b.w * b.h);
            if (ix * iy > smaller * 0.25) overlaps.push(`${a.name} ↔ ${b.name}`);
        }
    }
    if (overlaps.length) warnings.push(`${overlaps.length} overlapping control pair(s): ${list(overlaps, 4)}`);

    const oddKnobs = layout.widgets.filter(w => w.type.indexOf('knob-') === 0 && Math.abs(w.w - w.h) > 2).map(w => `${w.name} (${w.w}×${w.h})`);
    if (oddKnobs.length) warnings.push(`${oddKnobs.length} knob(s) aren't square — Vellum draws knobs in a square cell: ${list(oddKnobs)}`);

    const tiny = layout.widgets.filter(w => w.w < 8 || w.h < 8).map(w => w.name);
    if (tiny.length) warnings.push(`${tiny.length} widget(s) under 8px will be hard to grab in Vellum: ${list(tiny)}`);

    if (layout.fallbacks.length) warnings.push(`${layout.fallbacks.length} layer(s) had no recognizable name and were exported as plain shapes — rename or tag them (e.g. "[button]") to make them controls: ${list(layout.fallbacks)}`);
    if (layout.rotated.length) warnings.push(`${layout.rotated.length} rotated layer(s) exported by bounding box: ${list(layout.rotated)}`);
    return warnings;
}

function vellumXmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mirrors the shape of Vellum's own buildLayoutXml(): a <screens> block plus the
// legacy root-level copy of screen 1, so older Vellum builds read it too.
function buildVellumXml(layout) {
    const esc = vellumXmlEscape;
    const widgetLine = (w, i, pad) => {
        const attrs = [`id="w${i}"`, `type="${w.type}"`, `name="${esc(w.name)}"`, `x="${w.x}"`, `y="${w.y}"`, `w="${w.w}"`, `h="${w.h}"`];
        if (w.text) attrs.push(`text="${esc(w.text)}"`);
        return `${pad}<widget ${attrs.join(' ')}></widget>`;
    };
    const guideLine = (g, pad) => `${pad}<line orient="${g.orient}" pos="${g.pos}" start="${g.start}" end="${g.end}"/>`;
    const bg = layout.background;
    const bgAttrs = [];
    if (bg) bgAttrs.push(`file="${esc(bg.file)}"`, `naturalW="${bg.w}"`, `naturalH="${bg.h}"`);
    if (layout.bgColor) bgAttrs.push(`color="${esc(layout.bgColor)}"`);
    const bgLine = pad => bgAttrs.length ? `${pad}<background ${bgAttrs.join(' ')}/>` : `${pad}<background/>`;
    const filesXml = bg
        ? `    <file name="${esc(bg.file)}" usedBy="s1-background">\n      <data>${bg.data}</data>\n    </file>`
        : `    <!-- wireframe only: no skin files -->`;
    const block = (items, fn, pad, empty) => items.length ? items.map(fn).join('\n') : `${pad}<!-- ${empty} -->`;

    const guides2 = block(layout.guides, g => guideLine(g, '    '), '    ', 'none');
    const widgets2 = block(layout.widgets, (w, i) => widgetLine(w, i, '    '), '    ', 'empty');
    const guides6 = block(layout.guides, g => guideLine(g, '        '), '        ', 'none');
    const widgets6 = block(layout.widgets, (w, i) => widgetLine(w, i, '        '), '        ', 'empty');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Exported from VST GUI Pro ${VERSION} (Figma) — "${esc(layout.sourceName)}" -->
<vellum version="${VELLUM_LAYOUT_VERSION}">
  <plugin type="${layout.pluginType}"/>
  <artboard width="${layout.artboardW}" height="${layout.artboardH}"/>
${bgLine('  ')}
  <guides>
${guides2}
  </guides>
  <widgets>
${widgets2}
  </widgets>
  <screens>
    <screen id="s1" name="${esc(layout.screenName)}">
${bgLine('      ')}
      <guides>
${guides6}
      </guides>
      <widgets>
${widgets6}
      </widgets>
      <paramOverrides>
        <!-- none -->
      </paramOverrides>
    </screen>
  </screens>
  <globalWidgets>
    <widgets>
      <!-- empty -->
    </widgets>
  </globalWidgets>
  <files>
${filesXml}
  </files>
</vellum>
`;
}

// A studio panel's art rides along as the background image, at 2x
function exportVellumLayout(options) {
    return __awaiter(this, void 0, void 0, function* () {
    const selection = figma.currentPage.selection;
    if (selection.length !== 1) {
        return { ok: false, error: selection.length ? 'Select just one panel (a group or frame) to export.' : 'Select a panel (a group or frame) to export.' };
    }
    let root = selection[0];
    if (root.getPluginData('panelArt') === '1' && root.parent && root.parent.type !== 'PAGE') root = root.parent;
    if (!('children' in root) || !root.absoluteBoundingBox) {
        return { ok: false, error: `"${root.name}" is a single layer. Select the panel group or frame that contains your controls.` };
    }

    const artboard = vellumFindArtboard(root);
    const ctx = {
        artboardNode: artboard.node,
        ox: artboard.box.x,
        oy: artboard.box.y,
        widgets: [],
        guides: [],
        skipped: [],
        fallbacks: [],
        rotated: []
    };
    root.children.forEach(c => vellumWalk(c, ctx));

    if (!ctx.widgets.length && !ctx.guides.length && !ctx.art) {
        return { ok: false, error: `Nothing exportable found inside "${root.name}".` };
    }

    let background = null;
    if (ctx.art) {
        const bytes = yield ctx.art.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
        const slug = (root.name || 'panel').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'panel';
        background = {
            file: slug + '-background@2x.png',
            w: Math.round(ctx.art.width * 2),
            h: Math.round(ctx.art.height * 2),
            data: figma.base64Encode(bytes)
        };
    }

    // Shapes are backdrops: draw them first so controls stay clickable on top
    const isShape = w => w.type.indexOf('shape-') === 0;
    ctx.widgets = ctx.widgets.filter(isShape).concat(ctx.widgets.filter(w => !isShape(w)));

    const sourceName = root.name || 'Panel';
    const layout = {
        sourceName: sourceName,
        screenName: sourceName.replace(/\s*panel$/i, '').trim() || 'Screen 1',
        pluginType: options.pluginType === 'auto' ? vellumGuessPluginType(sourceName) : options.pluginType,
        artboardW: Math.round(artboard.box.width),
        artboardH: Math.round(artboard.box.height),
        bgColor: options.includeBgColor ? artboard.fill : null,
        background,
        widgets: ctx.widgets,
        guides: ctx.guides,
        fallbacks: ctx.fallbacks,
        rotated: ctx.rotated
    };

    const counts = {};
    layout.widgets.forEach(w => { counts[w.type] = (counts[w.type] || 0) + 1; });

    return {
        ok: true,
        xml: buildVellumXml(layout),
        fileName: sourceName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.vellum.xml',
        layout: {
            artboardW: layout.artboardW,
            artboardH: layout.artboardH,
            pluginType: layout.pluginType,
            widgets: layout.widgets,
            guides: layout.guides,
            bgData: background ? background.data : null
        },
        counts: counts,
        warnings: vellumValidate(layout),
        skipped: ctx.skipped
    };
    });
}
