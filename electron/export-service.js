const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { resolveFfmpegPath } = require('./paths');

// Active ffmpeg child process (only one export at a time)
let activeProcess = null;
let activeCanceled = false;

// Throttle IPC progress updates to reduce overhead
let lastProgressEmit = 0;
const PROGRESS_THROTTLE = 500; // ms

/**
 * Builds the output filename pattern for ffmpeg (e.g. frame_%04d.jpg).
 */
function buildOutputPattern(outputDir, baseName, zeropad, format) {
    const safeName = (baseName || '').replace(/[<>:"/\\|?*]/g, '_');
    const pattern = `${safeName}${zeropad}.${format}`;
    return path.join(outputDir, pattern);
}

/**
 * Maps UI quality (1–31) to ffmpeg -q:v (2 = best, 31 = worst).
 */
function mapQuality(quality) {
    const q = Math.round(parseFloat(String(quality).replace(',', '.')) || 2);
    if (Number.isNaN(q)) {
        return 2;
    }
    return Math.min(31, Math.max(2, q));
}

/**
 * Runs ffmpeg to extract frames. Sends progress events via callback.
 */
function startExport(options, onProgress) {
    if (activeProcess) {
        throw new Error('An export is already running.');
    }

    const ffmpegPath = resolveFfmpegPath();
    const outputPattern = buildOutputPattern(
        options.outputDir,
        options.filename,
        options.zeropad,
        options.format
    );

    fs.mkdirSync(options.outputDir, { recursive: true });

    const fpsValue = parseFloat(String(options.fps).replace(',', '.')) || 2;
    const fps = Math.max(1, Math.min(60, fpsValue));
    
    // Build optimized ffmpeg arguments for faster frame extraction
    const args = [
        '-hwaccel', 'auto',                             // Try to use hardware acceleration if available
        '-threads', '0',                                // Use all available CPU cores
        '-thread_type', 'frame',                        // Parallelize frame processing (better multi-core usage)
        '-i', options.videoPath,                        // Input video file
        '-an',                                          // Disable audio stream (not needed for frame extraction)
        '-vsync', '0',                                  // Disable frame synchronization (faster, direct frame extraction)
    ];

    // Build video filter with optional subtitle burn-in
    let videoFilter = `fps=${fps}`;
    if (options.subtitleIndex != null && options.subtitleIndex >= 0) {
        const subPath = options.videoPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        videoFilter = `fps=${fps},subtitles='${subPath}':si=${options.subtitleIndex}`;
    } else {
        // Only disable subtitles if not doing burn-in
        args.push('-sn');
    }

    args.push(
        '-vf', videoFilter,                             // FPS filter to extract frames at specified rate
        '-c:v', 'mjpeg',                                // Use MJPEG codec explicitly (faster JPEG encoding)
        '-pix_fmt', 'yuvj420p'                          // Pixel format optimized for JPEG (faster conversion)
    );

    if (options.format === 'jpg') {
        args.push('-q:v', String(mapQuality(options.quality)));
    }

    args.push(
        '-f', 'image2',                                 // Force image2 format (explicit output format)
        '-y',                                           // Overwrite output files without asking
        outputPattern                                   // Output frames path
    );

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        console.log('\n=== FFmpeg Export Start ===');
        console.log(`Input: ${options.videoPath}`);
        console.log(`Output Dir: ${options.outputDir}`);
        console.log(`FPS: ${fps}, Format: ${options.format}, Quality: ${options.format === 'jpg' ? mapQuality(options.quality) : 'N/A'}`);
        console.log(`FFmpeg Command: ${resolveFfmpegPath()} ${args.join(' ')}`);
        console.log('===========================\n');

        const child = spawn(ffmpegPath, args, { windowsHide: true });
        activeProcess = child;

        let stderrBuffer = '';

        child.stderr.on('data', (chunk) => {
            stderrBuffer += chunk.toString();
            const timeMatch = stderrBuffer.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/g);
            if (timeMatch && onProgress) {
                const now = Date.now();
                if (now - lastProgressEmit > PROGRESS_THROTTLE) {
                    const last = timeMatch[timeMatch.length - 1];
                    onProgress({ type: 'time', value: last.replace('time=', '') });
                    lastProgressEmit = now;
                }
            }
        });

        child.on('error', (err) => {
            activeProcess = null;
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✗ FFmpeg error after ${duration}s: ${err.message}\n`);
            if (err.code === 'ENOENT') {
                reject(
                    new Error(
                        'ffmpeg not found. Install ffmpeg and add it to PATH, or place it in resources/ffmpeg/.'
                    )
                );
            } else {
                reject(err);
            }
        });

        child.on('close', (code) => {
            if (activeProcess === child) {
                activeProcess = null;
            }
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            if (activeCanceled) {
                const err = new Error('Export canceled.');
                err.cancelled = true;
                reject(err);
            } else if (code === 0) {
                console.log(`✓ Export completed in ${duration}s\n`);
                resolve({ outputDir: options.outputDir, pattern: outputPattern });
            } else {
                console.log(`✗ FFmpeg exited with code ${code} after ${duration}s\n`);
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });
    });
}

/**
 * Extracts subtitle track to a separate file using ffmpeg.
 */
function extractSubtitle(videoPath, subtitleIndex, outputDir) {
    const ffmpegPath = resolveFfmpegPath();
    const subtitleDir = path.join(outputDir, 'subtitle');
    fs.mkdirSync(subtitleDir, { recursive: true });

    // Get subtitle format from stream info (srt, ass, etc.)
    const args = [
        '-y',
        '-i', videoPath,
        '-map', `0:s:${subtitleIndex}`,
        path.join(subtitleDir, 'subtitle.ass')
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });

        child.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(
                    new Error(
                        'ffmpeg not found. Install ffmpeg and add it to PATH, or place it in resources/ffmpeg/.'
                    )
                );
            } else {
                reject(err);
            }
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ subtitleDir });
            } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });
    });
}

/**
 * Kills the running ffmpeg process, if any.
 */
function cancelExport() {
    if (activeProcess) {
        console.log('⊗ Export cancelled by user\n');
        activeCanceled = true;
        activeProcess.kill('SIGTERM');
        return true;
    }
    return false;
}

module.exports = { startExport, cancelExport, extractSubtitle };