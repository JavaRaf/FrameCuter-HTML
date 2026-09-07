const { spawn } = require('child_process');
const { resolveFfmpegPath, resolveFfprobePath } = require('./paths');

/**
 * Lists subtitle streams from a video file using ffprobe JSON output.
 */
function getSubtitleStreams(videoPath) {
    const ffmpegPath = resolveFfmpegPath();
    const ffprobePath = resolveFfprobePath(ffmpegPath);

    const args = [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        '-select_streams',
        's',
        videoPath
    ];

    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const child = spawn(ffprobePath, args, { windowsHide: true });

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(
                    new Error(
                        'ffprobe not found. Install ffmpeg/ffprobe and add it to PATH, or place it in resources/ffmpeg/.'
                    )
                );
            } else {
                reject(err);
            }
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `Failed to read subtitle tracks${stderr ? `: ${stderr.trim().split('\n').slice(-3).join('\n')}` : ''}`
                    )
                );
                return;
            }

            try {
                const data = JSON.parse(stdout);
                const streams = data.streams || [];
                // index = subtitle stream index for ffmpeg subtitles filter si=
                const tracks = streams.map((stream, idx) => {
                    const lang = stream.tags?.language || 'und';
                    const title = stream.tags?.title || `Track ${idx + 1}`;
                    return {
                        index: idx,
                        codec: stream.codec_name || 'unknown',
                        label: `${title} (${lang})`
                    };
                });
                resolve(tracks);
            } catch {
                reject(new Error('Could not parse subtitle track information.'));
            }
        });
    });
}

/**
 * Returns the display-friendly subtitle tracks (index + label) for the UI.
 */
function getSubtitleTracks(videoPath) {
    return getSubtitleStreams(videoPath).then((streams) =>
        streams.map(({ index, label }) => ({ index, label }))
    );
}

/**
 * Returns the codec name of a given subtitle stream, or null when not found.
 */
async function getSubtitleCodec(videoPath, subtitleIndex) {
    const streams = await getSubtitleStreams(videoPath);
    const found = streams.find((s) => s.index === subtitleIndex);
    return found ? found.codec : null;
}

module.exports = { getSubtitleTracks, getSubtitleCodec };