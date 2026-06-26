export default {
    name: 'ping',
    cmd: 'ping',
    category: 'main',
    desc: 'Check bot response delay speed. (Cek kecepatan delay respon bot.)',
    owner: false, 

    run: async ({ sock, from, m }) => {
        // Calculate the difference between current time and message timestamp
        // (Hitung selisih antara waktu sekarang dengan timestamp pesan masuk)
        const now = Date.now();
        const msgTime = m.messageTimestamp * 1000; // Convert to milliseconds (Ubah ke milidetik)
        const delay = (now - msgTime) / 1000; // Convert to seconds (Ubah ke detik)

        // If the calculation is too fast or slightly negative due to system clock desync, safe guard to 0
        // (Jika perhitungan terlalu cepat atau sedikit negatif karena desinkronisasi jam sistem, amankan ke 0)
        const finalDelay = delay < 0 ? 0 : delay;

        await sock.sendMessage(from, { 
            text: `Pong! 🚀\nDelay: *${finalDelay.toFixed(3)}* seconds (detik).` 
        }, { quoted: m });
    }
};
