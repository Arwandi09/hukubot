import { searchVideos } from '../lib/youtube.js';

export default {
    name: 'ytsearch',
    cmd: 'yts',
    category: 'downloader',
    desc: 'Cari video YouTube berdasarkan kata kunci. (Search YouTube videos by keyword.)',
    owner: false,

    run: async ({ sock, from, m, args, body }) => {
        const query = args.join(' ').trim();
        if (!query) {
            return await sock.sendMessage(from, {
                text: '❌ Masukkan kata kunci pencarian!\nContoh: *.ytsearch tulus hujan bulan juni*'
            }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `🔎 Mencari "${query}" di YouTube...` }, { quoted: m });

        try {
            const results = await searchVideos(query, 5);

            if (!results.length) {
                return await sock.sendMessage(from, { text: `❌ Tidak ada hasil untuk "${query}".` }, { quoted: m });
            }

            let text = `╔═══════════════════╗\n║   🔎 *HASIL PENCARIAN*   ║\n╚═══════════════════╝\n\n`;
            results.forEach((v, i) => {
                text += `*${i + 1}. ${v.title}*\n`;
                text += `👤 ${v.author}  ⏱ ${v.durationLabel}  👁 ${v.views}\n`;
                text += `🔗 ${v.url}\n\n`;
            });
            text += `_Salin salah satu link di atas lalu pakai:_\n*.yta <link>* → download audio\n*.ytv <link>* → download video`;

            // Kirim thumbnail hasil teratas sebagai preview visual
            await sock.sendMessage(from, {
                image: { url: results[0].thumbnail },
                caption: text
            }, { quoted: m });

        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: `❌ Gagal mencari video: ${err.message || err}` }, { quoted: m });
        }
    }
};