const { spawn } = require('child_process');
const { resolveFfmpegPath, resolveFfprobePath } = require('./paths');

/**
 * Lists subtitle streams from a video file using ffprobe JSON output.
 */
function getSubtitleTracks(videoPath) {
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
                resolve([]);
            } else {
                reject(err);
            }
        });

        child.on('close', (code) => {
            if (code !== 0) {
                resolve([]);
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
                        label: `${title} (${lang})`
                    };
                });
                resolve(tracks);
            } catch {
                resolve([]);
            }
        });
    });
}

module.exports = { getSubtitleTracks };
