/**
 * Extracts anime episode number (01–100) from a video file name for the output folder.
 * Prefers numbers after "-" and avoids resolution/codec noise (1080p, x264, etc.).
 */
(function attachEpisodeParser(global) {
    const MAX_EPISODE = 100;

    // Resolution / codec tokens stripped before generic number scan
    const RESOLUTION_RE = /\b(2160|1440|1280|1080|900|720|576|540|480|360|240)\s*p?\b/gi;
    const CODEC_RE = /\bx\s*26[45]\b/gi;

    function padEpisode(n) {
        return String(n).padStart(2, '0');
    }

    function isEpisodeNumber(n) {
        return Number.isInteger(n) && n >= 1 && n <= MAX_EPISODE;
    }

    function tryEpisodeFromMatch(match) {
        if (!match) {
            return null;
        }
        const n = parseInt(match[1], 10);
        return isEpisodeNumber(n) ? padEpisode(n) : null;
    }

    /**
     * @param {string} fileName - Video file name with or without extension
     * @returns {string|null} Folder name like "01", or null if not detected
     */
    function extractEpisodeFolderName(fileName) {
        const base = fileName.replace(/\.[^.]+$/, '');

        // 1) Episode after dash: "Anime - 01", "Show-12", "Title – 7"
        const afterDash = base.match(/[-–—]\s*0*(\d{1,3})(?=\D|$)/);
        const fromDash = tryEpisodeFromMatch(afterDash);
        if (fromDash) {
            return fromDash;
        }

        // 2) Explicit tags: E01, EP12, Episode 5
        const tagged = base.match(
            /(?:^|[\s._\[\(-])(?:e|ep|episode)[.\s_-]*0*(\d{1,3})\b/i
        );
        const fromTag = tryEpisodeFromMatch(tagged);
        if (fromTag) {
            return fromTag;
        }

        // 3) Fallback: last valid 1–100 number after removing quality/codec/year chunks
        const cleaned = base
            .replace(RESOLUTION_RE, ' ')
            .replace(CODEC_RE, ' ')
            .replace(/\b(?:19|20)\d{2}\b/, ' ');
        const numbers = [...cleaned.matchAll(/\b0*(\d{1,3})\b/g)];
        const episodes = numbers
            .map((m) => parseInt(m[1], 10))
            .filter(isEpisodeNumber);

        if (episodes.length === 0) {
            return null;
        }

        return padEpisode(episodes[episodes.length - 1]);
    }

    globalThis.extractEpisodeFolderName = extractEpisodeFolderName;
})(globalThis);
