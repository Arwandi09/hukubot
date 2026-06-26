export default {
    name: 'tagall',
    cmd: 'tagall',
    category: 'group',
    desc: 'Mention semua anggota grup dengan mendaftar mereka di teks.',
    owner: false,

    run: async ({ sock, from, m, args, isGroup }) => {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Perintah ini hanya dapat digunakan di dalam grup!' }, { quoted: m });

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;
            
            // Ambil teks tambahan dari user jika ada (misal: .tagall ada info penting!)
            const messageText = args.join(' ') || 'Halo semua, admin memanggil kalian!';
            
            let txt = `╔══════════════════╗\n`;
            txt += `║ 📢  *TAG ALL MEMBER*  ║\n`;
            txt += `╚══════════════════╝\n\n`;
            txt += `📝 *Pesan:* ${messageText}\n\n`;

            const mentions = [];
            for (let mem of participants) {
                txt += `🔘 @${mem.id.split('@')[0]}\n`;
                mentions.push(mem.id);
            }

            txt += `\n*Total:* ${participants.length} Anggota`;

            await sock.sendMessage(from, { text: txt, mentions: mentions }, { quoted: m });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: '❌ Gagal mengambil data grup.' }, { quoted: m });
        }
    }
};
