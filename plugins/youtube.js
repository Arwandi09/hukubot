// lib/youtube.js
// Helper bersama untuk .ytsearch, .yta, .ytv
// Pakai 'yt-search' buat pencarian dan '@distube/ytdl-core' buat ambil link
// download langsung (fork ytdl-core yang masih aktif di-maintain).

import yts from 'yt-search';
import ytdl from '@distube/ytdl-core';

// Regex simpel buat deteksi apakah input dari user itu sudah berupa URL YouTube
// atau masih berupa kata kunci pencarian.
const YT_URL_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function isYoutubeUrl(text) {
    return YT_URL_REGEX.test(text);
}

// Menerima input bebas (URL ATAU kata kunci), selalu balikin satu video
// yang dituju beserta metadatanya (title, url, thumbnail, durasi, dst).
export async function resolveVideo(input) {
    if (isYoutubeUrl(input)) {
        const info = await ytdl.getBasicInfo(input);
        const d = info.videoDetails;
        return {
            title: d.title,
            url: `https://www.youtube.com/watch?v=${d.videoId}`,
            videoId: d.videoId,
            thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url,
            durationSeconds: Number(d.lengthSeconds || 0),
            author: d.author?.name || '-',
            views: d.viewCount || '0'
        };
    }

    // Bukan URL -> anggap kata kunci, cari lewat yt-search dan ambil hasil teratas
    const search = await yts(input);
    const video = search.videos?.[0];
    if (!video) return null;

    return {
        title: video.title,
        url: video.url,
        videoId: video.videoId,
        thumbnail: video.thumbnail,
        durationSeconds: video.seconds || 0,
        author: video.author?.name || '-',
        views: video.views || 0
    };
}

// Cari beberapa hasil sekaligus, dipakai oleh .ytsearch
export async function searchVideos(query, limit = 5) {
    const search = await yts(query);
    return (search.videos || []).slice(0, limit).map(v => ({
        title: v.title,
        url: v.url,
        videoId: v.videoId,
        thumbnail: v.thumbnail,
        durationLabel: v.timestamp || '-',
        author: v.author?.name || '-',
        views: v.views || 0,
        ago: v.ago || '-'
    }));
}

function formatBaseMime(mimeType) {
    // mimeType dari ytdl contohnya: audio/mp4; codecs="mp4a.40.2"
    return (mimeType || '').split(';')[0].trim();
}

// Ambil format audio-only dengan kualitas terbaik yang tersedia
export async function getAudioFormat(videoUrl) {
    const info = await ytdl.getInfo(videoUrl);
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    if (!format) return null;

    return {
        url: format.url,
        mimetype: formatBaseMime(format.mimeType) || 'audio/mp4',
        title: info.videoDetails.title,
        approxSizeBytes: Number(format.contentLength || 0)
    };
}

// Ambil format video+audio dengan kualitas paling rendah yang masih punya audio,
// supaya ukuran file tidak kebesaran untuk dikirim lewat WhatsApp.
export async function getVideoFormat(videoUrl) {
    const info = await ytdl.getInfo(videoUrl);
    const format = ytdl.chooseFormat(info.formats, { quality: 'lowestvideo', filter: 'videoandaudio' })
        || ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });
    if (!format) return null;

    return {
        url: format.url,
        mimetype: formatBaseMime(format.mimeType) || 'video/mp4',
        title: info.videoDetails.title,
        approxSizeBytes: Number(format.contentLength || 0)
    };
}

export function formatDuration(seconds) {
    seconds = Math.floor(seconds || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}