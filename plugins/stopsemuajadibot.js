import { stopJadibotSession } from './jadibot.js';

export default {
    name: 'stopsemuajadibot',
    cmd: 'stopsemuajadibot',
    category: 'owner',
    desc: 'Menghentikan seluruh sesi jadibot yang sedang aktif (file sesi tidak dihapus).',
    owner: true,

    run: async ({ sock, from, m }) => {
        const activeNumbers = Array.from(global.conns.keys());

        if (activeNumbers.length === 0) {
            return await sock.sendMessage(from, { text: '⚠️ Tidak ada sesi jadibot yang sedang aktif.' }, { quoted: m });
        }

        const stoppedList = [];
        for (const targetNumber of activeNumbers) {
            if (await stopJadibotSession(targetNumber)) stoppedList.push(targetNumber);
        }

        const list = stoppedList.map(n => `• @${n}`).join('\n');
        await sock.sendMessage(from, {
            text: `🛑 ${stoppedList.length} sesi jadibot dihentikan:\n${list}\n\nSemua file sesi tetap aman.`,
            mentions: stoppedList.map(n => `${n}@s.whatsapp.net`)
        }, { quoted: m });
    }
};
