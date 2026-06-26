export default {
    name: 'eval',
    cmd: 'eval',
    category: 'owner',
    desc: 'Run javascript code via chat. (Menjalankan kode javascript via chat.)',
    owner: true, // Otomatis ditolak oleh handler jika bukan owner
    
    run: async ({ sock, from, m, args }) => {
        // Logika perintah eval kamu di sini...
        await sock.sendMessage(from, { text: 'Success! (Berhasil!)' }, { quoted: m });
    }
};
