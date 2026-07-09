import { activateAllJadibot } from './jadibot.js';

export default {
    name: 'aktifkanjadibot',
    cmd: 'aktifkanjadibot',
    category: 'owner',
    desc: 'Mengaktifkan kembali seluruh sesi jadibot yang tersimpan.',
    owner: true,

    run: async ({ sock, from, m, plugins }) => {
        await sock.sendMessage(from, { text: '⏳ Mengaktifkan seluruh sesi jadibot yang tersimpan...' }, { quoted: m });

        const activated = await activateAllJadibot({ notifyJid: from, notifySock: sock, plugins });

        if (activated.length === 0) {
            return await sock.sendMessage(from, { text: '⚠️ Tidak ada sesi baru untuk diaktifkan (mungkin semua sudah aktif atau belum ada sesi tersimpan).' }, { quoted: m });
        }

        const list = activated.map(n => `• @${n}`).join('\n');
        await sock.sendMessage(from, {
            text: `✅ Berhasil mengaktifkan ${activated.length} sesi jadibot:\n${list}`,
            mentions: activated.map(n => `${n}@s.whatsapp.net`)
        }, { quoted: m });
    }
};
