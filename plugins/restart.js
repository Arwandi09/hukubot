export default {
    name: 'restart',
    cmd: 'restart',
    category: 'owner',
    desc: 'Restart the bot system. (Mereset ulang sistem bot.)',
    owner: true, // Only owners can execute (Hanya owner yang bisa mengeksekusi)

    run: async ({ sock, from, m }) => {
        await sock.sendMessage(from, { 
            text: '🔄 Restarting the bot... Please wait a moment. (Sedang merestart bot... Mohon tunggu sejenak.)' 
        }, { quoted: m });

        // Give a slight delay so the WhatsApp message is completely sent before shutting down
        // (Berikan sedikit jeda agar pesan WhatsApp selesai terkirim sebelum sistem mati)
        setTimeout(() => {
            process.exit(1); 
        }, 2000);
    }
};
