import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const destination = new URL('../demo/public/media/', import.meta.url);
mkdirSync(destination, { recursive: true });
const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-g', '24', '-c:a', 'aac', '-b:a', '64k'];
execFileSync('ffmpeg', [...input, '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', new URL('segment-%02d.ts', destination).pathname, new URL('sample.m3u8', destination).pathname]);
execFileSync('ffmpeg', [...input, '-f', 'flv', '-flvflags', 'add_keyframe_index', new URL('sample.flv', destination).pathname]);
console.log('Generated original 4-second HLS and FLV fixtures using FFmpeg test sources.');
