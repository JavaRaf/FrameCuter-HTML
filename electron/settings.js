const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

// Keys the renderer is allowed to persist
const ALLOWED_KEYS = ['lastOutputDir', 'fps', 'quality', 'filename', 'zeropad', 'format'];

/**
 * Loads persisted UI settings (last output folder, etc.).
 */
function loadSettings() {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE(), 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * Merges partial settings into the saved JSON file.
 */
function saveSettings(partial) {
    const current = loadSettings();
    const clean = {};
    for (const key of ALLOWED_KEYS) {
        if (partial && key in partial) {
            clean[key] = partial[key];
        }
    }
    const next = { ...current, ...clean };

    const file = SETTINGS_FILE();
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Atomic write: avoid corrupting settings on crash mid-write
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return next;
}

module.exports = { loadSettings, saveSettings };
