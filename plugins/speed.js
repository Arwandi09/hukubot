export default {
    name: 'speed',
    cmd: 'speed',
    category: 'info',
    desc: 'Check bot execution speed. (Cek kecepatan eksekusi bot.)',
    owner: false, 
    
    run: async ({ sock, from, m }) => {
        // Calculate timestamp response 
        // (Menghitung jeda waktu respon)
        await sock.sendMessage(from, { text: 'Running fast! (Berjalan cepat!)' }, { quoted: m });
    }
};
