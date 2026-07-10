// lib/youtube.js
//
// PERUBAHAN BESAR: berhenti pakai '@distube/ytdl-core' dan 'yt-search'.
// Alasan: repo distubejs/ytdl-core SUDAH DI-ARCHIVE oleh pemiliknya
// (16 Agustus 2025) — artinya tidak akan ada lagi update/perbaikan.
// Setiap kali YouTube mengubah skema enkripsi player mereka (rutin terjadi),
// library itu bakal rusak permanen dan tidak akan pernah diperbaiki lagi.
//
// Solusinya: pakai binary command-line 'yt-dlp' (bukan package npm) yang
// di-maintain sangat aktif oleh komunitas besar, biasanya rilis update
// dalam hitungan jam setelah YouTube berubah. yt-dlp juga sudah punya
// fitur pencarian bawaan (prefix 'ytsearch:'), jadi kita tidak perlu lagi
// dependency 'yt-search' terpisah.
//
// WAJIB diinstall dulu di server/HP sebelum plugin .yta/.ytv/.ytsearch bisa
// jalan:
//   Termux : pkg install yt-dlp
//   Linux  : pip install -U yt-dlp   (atau: pip install --break-system-packages -U yt-dlp)
//
// Cek sudah terpasang atau belum dengan: yt-dlp --version

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// Kalau binary yt-dlp di servermu punya nama/path lain, set env YTDLP_PATH
// (misalnya YTDLP_PATH=/usr/local/bin/yt-dlp) tanpa perlu edit kode ini.
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';

const YT_URL_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function isYoutubeUrl(text) {
    return YT_URL_REGEX.test(text);
}

// Terjemahkan error mentah dari proses yt-dlp jadi pesan yang gampang dipahami.
function wrapYtdlpError(e) {
    const raw = (e?.stderr || e?.message || String(e)).toString();

    if (/ENOENT|not recognized|command not found/i.test(raw)) {
        return new Error('yt-dlp belum terpasang di server. Install dulu: "pkg install yt-dlp" (Termux) atau "pip install -U yt-dlp" (Linux), lalu coba lagi.');
    }
    if (/Video unavailable/i.test(raw)) {
        return new Error('Video tidak tersedia (mungkin sudah dihapus / private / dibatasi wilayah).');
    }
    if (/Sign in to confirm/i.test(raw)) {
        return new Error('YouTube meminta verifikasi login untuk video ini, tidak bisa didownload lewat bot.');
    }

    const firstLine = raw.split('\n').find(l => l.trim()) || raw;
    return new Error(`yt-dlp gagal: ${firstLine.trim()}`);
}

async function ytdlpDumpJson(target, extraArgs = []) {
    try {
        const { stdout } = await execFileAsync(YTDLP_BIN, [
            '--dump-json',
            '--no-warnings',
            '--no-playlist',
            ...extraArgs,
            target
        ], { maxBuffer: 1024 * 1024 * 20 });

        const firstLine = stdout.trim().split('\n')[0];
        return firstLine ? JSON.parse(firstLine) : null;
    } catch (e) {
        throw wrapYtdlpError(e);
    }
}

// Menerima input bebas (URL ATAU kata kunci) -> satu video beserta metadatanya.
export async function resolveVideo(input) {
    const target = isYoutubeUrl(input) ? input : `ytsearch1:${input}`;
    const d = await ytdlpDumpJson(target);
    if (!d) return null;

    return {
        title: d.title,
        url: d.webpage_url || `https://www.youtube.com/watch?v=${d.id}`,
        videoId: d.id,
        thumbnail: d.thumbnail,
        durationSeconds: Number(d.duration || 0),
        author: d.uploader || d.channel || '-',
        views: d.view_count || 0
    };
}

// Cari beberapa hasil sekaligus, dipakai oleh .ytsearch
export async function searchVideos(query, limit = 5) {
    try {
        const { stdout } = await execFileAsync(YTDLP_BIN, [
            '--dump-json',
            '--no-warnings',
            '--flat-playlist',
            `ytsearch${limit}:${query}`
        ], { maxBuffer: 1024 * 1024 * 20 });

        const lines = stdout.trim().split('\n').filter(Boolean);
        return lines.map(line => {
            const d = JSON.parse(line);
            return {
                title: d.title,
                url: d.url || d.webpage_url || `https://www.youtube.com/watch?v=${d.id}`,
                videoId: d.id,
                thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
                durationLabel: formatDuration(d.duration),
                author: d.uploader || d.channel || '-',
                views: d.view_count || 0
            };
        });
    } catch (e) {
        throw wrapYtdlpError(e);
    }
}

function guessMime(filename) {
    const ext = path.extname(filename).toLowerCase();
    const map = {
        '.m4a': 'audio/mp4',
        '.webm': 'audio/webm',
        '.mp3': 'audio/mpeg',
        '.opus': 'audio/ogg',
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska'
    };
    return map[ext] || 'application/octet-stream';
}

// Download ke file sementara (folder temp OS), balikin path file + metadata.
// PENTING: pemanggil (plugin) WAJIB hapus file ini setelah selesai dikirim,
// supaya storage HP/server tidak numpuk file bekas download.
async function downloadWithFormat(target, formatSelector) {
    const tmpDir = os.tmpdir();
    const uniqueName = `yt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const outTemplate = path.join(tmpDir, `${uniqueName}.%(ext)s`);

    try {
        await execFileAsync(YTDLP_BIN, [
            '-f', formatSelector,
            '--no-warnings',
            '--no-playlist',
            '-o', outTemplate,
            target
        ], { maxBuffer: 1024 * 1024 * 20 });
    } catch (e) {
        throw wrapYtdlpError(e);
    }

    // yt-dlp otomatis mengganti %(ext)s dengan ekstensi asli hasil download,
    // jadi kita cari file yang namanya diawali uniqueName di folder temp.
    const matches = fs.readdirSync(tmpDir).filter(f => f.startsWith(uniqueName));
    if (!matches.length) {
        throw new Error('File hasil download yt-dlp tidak ditemukan setelah proses selesai.');
    }

    const filePath = path.join(tmpDir, matches[0]);
    const stat = fs.statSync(filePath);

    return {
        filePath,
        sizeBytes: stat.size,
        mimetype: guessMime(matches[0])
    };
}

export async function downloadAudio(videoUrlOrQuery) {
    const target = isYoutubeUrl(videoUrlOrQuery) ? videoUrlOrQuery : `ytsearch1:${videoUrlOrQuery}`;
    // PENTING: selector 'bestaudio' polos sering memilih format .webm (codec
    // Opus) karena kualitasnya tertinggi — tapi WhatsApp TIDAK mendukung
    // audio webm sebagai lampiran biasa (pesan "terkirim" tapi medianya
    // tidak muncul/diputar di penerima). Jadi kita WAJIB prioritaskan format
    // .m4a (AAC), yang hampir selalu tersedia di semua video YouTube dan
    // didukung penuh oleh WhatsApp.
    return downloadWithFormat(target, 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio');
}

export async function downloadVideo(videoUrlOrQuery) {
    const target = isYoutubeUrl(videoUrlOrQuery) ? videoUrlOrQuery : `ytsearch1:${videoUrlOrQuery}`;
    // Pilih format yang SUDAH tergabung video+audio (tanpa perlu ffmpeg untuk
    // merge). Batasi <=480p biar ukuran file wajar untuk dikirim ke WhatsApp.
    return downloadWithFormat(target, 'best[height<=480][ext=mp4]/best[ext=mp4]/best');
}

export function formatDuration(seconds) {
    seconds = Math.floor(seconds || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}