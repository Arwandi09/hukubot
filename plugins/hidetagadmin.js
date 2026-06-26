export default {
    name: 'tagadmin',
    cmd: 'tagadmin',
    category: 'group',
    desc: 'Tag seluruh admin grup secara senyap tanpa memunculkan daftar nomor.',
    owner: false,

    run: async ({ sock, from, m, args, isGroup }) => {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Perintah ini hanya dapat digunakan di dalam grup!' }, { quoted: m });

        try {
            // Ambil data metadata grup terbaru
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;
            
            // Masukkan pesan tambahan dari user jika ada
            const textToDeliver = args.join(' ') || '📢 Panggilan penting untuk seluruh jajaran admin!';

            // Saring anggota yang hanya memiliki status 'admin' atau 'superadmin'
            const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
            
            if (admins.length === 0) return await sock.sendMessage(from, { text: '❌ Tidak dapat menemukan admin di grup ini.' }, { quoted: m });

            // Ambil semua JID admin untuk disuntikkan ke parameter mentions
            const adminMentions = admins.map(a => a.id);

            // Kirim pesan hidetag khusus admin secara bersih
            await sock.sendMessage(from, { text: textToDeliver, mentions: adminMentions });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: '❌ Gagal menjalankan perintah tagadmin.' }, { quoted: m });
        }
    }
};
