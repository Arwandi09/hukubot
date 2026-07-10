import fs from 'fs';
import { resolveVideo, downloadVideo, formatDuration } from '../lib/youtube.js';

// Batas aman ukuran file supaya tidak gagal kirim / kelamaan upload di WhatsApp.
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export default {
    name: 'ytv',
    cmd: 'ytv',
    category: 'downloader',
    desc: 'Download video dari YouTube. (Download YouTube video.)',
    owner: false,

    run: async ({ sock, from, m, args }) => {
        const input = args.join(' ').trim();
        if (!input) {
            return await sock.sendMessage(from, {
                text: '❌ Masukkan link atau judul video!\nContoh:\n*.ytv https://youtu.be/xxxxx*\n*.ytv tutorial masak nasi goreng*'
            }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `⏳ Memproses "${input}"...` }, { quoted: m });

        let filePath = null;
        try {
            const video = await resolveVideo(input);
            if (!video) {
                return await sock.sendMessage(from, { text: `❌ Video tidak ditemukan untuk "${input}".` }, { quoted: m });
            }

            const vid = await downloadVideo(video.url);
            filePath = vid.filePath;

            if (vid.sizeBytes > MAX_SIZE_BYTES) {
                return await sock.sendMessage(from, {
                    text: `❌ Ukuran file terlalu besar (~${(vid.sizeBytes / 1024 / 1024).toFixed(1)}MB). Coba video lain yang lebih pendek.`
                }, { quoted: m });
            }

            await sock.sendMessage(from, {
                video: fs.readFileSync(filePath),
                mimetype: vid.mimetype,
                fileName: `${video.title}.mp4`,
                caption: `✅ *${video.title}*\n👤 ${video.author}  ⏱ ${formatDuration(video.durationSeconds)}`
            }, { quoted: m });

        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: `❌ Gagal download video: ${err.message || err}` }, { quoted: m });
        } finally {
            // Selalu bersihkan file temp, baik berhasil maupun gagal kirim,
            // supaya storage server/HP tidak menumpuk file bekas download.
            if (filePath) {
                fs.unlink(filePath, () => {});
            }
        }
    }
};