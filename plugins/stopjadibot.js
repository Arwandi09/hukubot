import { stopJadibotSession } from './jadibot.js';

export default {
    name: 'stopjadibot',
    cmd: 'stopjadibot',
    category: 'owner',
    desc: 'Menghentikan sesi jadibot tertentu (file sesi tidak dihapus).',
    owner: true,

    run: async ({ sock, from, m, args }) => {
        const targetNumber = args[0] ? args[0].replace(/[^0-9]/g, '') : '';

        if (!targetNumber || targetNumber.length < 9) {
            return await sock.sendMessage(from, { text: '❌ Masukkan nomor yang valid! Contoh: .stopjadibot 628xxx' }, { quoted: m });
        }

        const stopped = await stopJadibotSession(targetNumber);

        if (!stopped) {
            return await sock.sendMessage(from, { text: `⚠️ Tidak ada sesi aktif untuk @${targetNumber}.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `🛑 Sesi @${targetNumber} dihentikan. File sesi tetap aman, pakai .aktifkanjadibot untuk mengaktifkan lagi.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });
    }
};
