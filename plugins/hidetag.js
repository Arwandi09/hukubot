export default {
    name: 'hidetag',
    cmd: 'hidetag',
    category: 'group',
    desc: 'Tag seluruh anggota grup secara senyap tanpa memunculkan daftar nomor.',
    owner: false,

    run: async ({ sock, from, m, args, isGroup }) => {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Perintah ini hanya dapat digunakan di dalam grup!' }, { quoted: m });

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;
            
            // Ambil pesan yang ingin disampaikan
            const textToDeliver = args.join(' ');
            if (!textToDeliver) return await sock.sendMessage(from, { text: '❌ Silakan masukkan pesan setelah perintah! Contoh: .hidetag info penting' }, { quoted: m });

            // Ambil semua ID partisipan untuk disuntikkan ke parameter mentions
            const mentions = participants.map(p => p.id);

            // Kirim pesan hidetag bersih
            await sock.sendMessage(from, { text: textToDeliver, mentions: mentions });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: '❌ Gagal menjalankan hidetag.' }, { quoted: m });
        }
    }
};
