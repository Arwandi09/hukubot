import fs from 'fs';
import { resolveVideo, downloadAudio, formatDuration } from '../lib/youtube.js';

// Batas aman ukuran file supaya tidak gagal kirim / kelamaan upload di WhatsApp.
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export default {
    name: 'yta',
    cmd: 'yta',
    category: 'downloader',
    desc: 'Download audio/musik dari YouTube. (Download YouTube audio.)',
    owner: false,

    run: async ({ sock, from, m, args }) => {
        const input = args.join(' ').trim();
        if (!input) {
            return await sock.sendMessage(from, {
                text: '❌ Masukkan link atau judul lagu!\nContoh:\n*.yta https://youtu.be/xxxxx*\n*.yta tulus hujan bulan juni*'
            }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `⏳ Memproses "${input}"...` }, { quoted: m });

        let filePath = null;
        try {
            const video = await resolveVideo(input);
            if (!video) {
                return await sock.sendMessage(from, { text: `❌ Video tidak ditemukan untuk "${input}".` }, { quoted: m });
            }

            const audio = await downloadAudio(video.url);
            filePath = audio.filePath;

            if (audio.sizeBytes > MAX_SIZE_BYTES) {
                return await sock.sendMessage(from, {
                    text: `❌ Ukuran file terlalu besar (~${(audio.sizeBytes / 1024 / 1024).toFixed(1)}MB). Coba video lain yang lebih pendek.`
                }, { quoted: m });
            }

            await sock.sendMessage(from, {
                audio: fs.readFileSync(filePath),
                mimetype: audio.mimetype,
                fileName: `${video.title}.m4a`,
                ptt: false
            }, { quoted: m });

            await sock.sendMessage(from, {
                text: `✅ *${video.title}*\n👤 ${video.author}  ⏱ ${formatDuration(video.durationSeconds)}`
            }, { quoted: m });

        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: `❌ Gagal download audio: ${err.message || err}` }, { quoted: m });
        } finally {
            // Selalu bersihkan file temp, baik berhasil maupun gagal kirim,
            // supaya storage server/HP tidak menumpuk file bekas download.
            if (filePath) {
                fs.unlink(filePath, () => {});
            }
        }
    }
};