import makeWASocket, { useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { normalizePairingCode } from '../lib/pairing-code.js';

if (!global.conns) global.conns = new Map();
if (!global.jadibotStopped) global.jadibotStopped = new Set();

async function startJadibotSession({ targetNumber, notifyJid, notifySock, plugins, isReconnect = false }) {
    const sessionPath = path.join(process.cwd(), 'session_jadibot', targetNumber);

    try {
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }
    } catch (e) {
        console.error(e);
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const client = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Ubuntu', 'Chrome', '110.0.0.0']
        });

        global.conns.set(targetNumber, client);

        client.ev.on('creds.update', async () => {
            try { await saveCreds(); } catch (_) {}
        });

        client.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`\x1b[32m[ JADIBOT ] Clone bot @${targetNumber} BERHASIL TERHUBUNG!\x1b[0m`);
                if (notifySock) {
                    try {
                        await notifySock.sendMessage(notifyJid, { text: `✅ Berhasil! Akun @${targetNumber} sekarang aktif mendampingi bot utama.`, mentions: [`${targetNumber}@s.whatsapp.net`] });
                    } catch (e) {
                        console.error(`\x1b[31m[ JADIBOT ] Gagal mengirim notifikasi sukses untuk @${targetNumber} (koneksi notifySock mungkin sudah putus):\x1b[0m`, e?.message || e);
                    }
                }
            }

            if (connection === 'close') {
                global.conns.delete(targetNumber);

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = statusCode === DisconnectReason.loggedOut;

                if (loggedOut) {
                    console.log(`\x1b[31m[ JADIBOT ] Sesi @${targetNumber} logout (dihapus dari HP). Sesi dihentikan permanen.\x1b[0m`);
                    return;
                }

                if (global.jadibotStopped.has(targetNumber)) {
                    global.jadibotStopped.delete(targetNumber);
                    console.log(`\x1b[33m[ JADIBOT ] Sesi @${targetNumber} dihentikan manual, tidak reconnect.\x1b[0m`);
                    return;
                }

                console.log(`\x1b[33m[ JADIBOT ] Sesi @${targetNumber} terputus, mencoba menyambung ulang...\x1b[0m`);
                await delay(3000);
                startJadibotSession({ targetNumber, notifyJid, notifySock, plugins, isReconnect: true });
            }
        });

        client.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;

            try {
                const { messageHandler } = await import('../handler.js');
                await messageHandler(client, msg, plugins);
            } catch (e) {
                console.error(`\x1b[31m[ JADIBOT ] Error saat handle pesan untuk @${targetNumber}:\x1b[0m`, e?.message || e);
            }
        });

        if (!isReconnect && !client.authState.creds.registered) {
            await delay(5000);

            const targetCode = normalizePairingCode(process.env.JADIBOT_PAIRING_CODE || '12345678');

            const code = await client.requestPairingCode(targetNumber, targetCode);
            const formattedCode = (code || targetCode).match(/.{1,4}/g)?.join('-') || (code || targetCode);

            let infoText = `╔══════════════════╗\n`;
            infoText += `║  🤖 *JADIBOT PAIRING* ║\n`;
            infoText += `╚══════════════════╝\n\n`;
            infoText += `👤 *Target Nomor:* @${targetNumber}\n`;
            infoText += `🔑 *Kode Pairing:* *${formattedCode}*\n\n`;
            infoText += `_Silakan masuk ke WhatsApp > Perangkat Tertaut, lalu masukkan kode di atas._`;

            if (notifySock) {
                try {
                    await notifySock.sendMessage(notifyJid, { text: infoText, mentions: [`${targetNumber}@s.whatsapp.net`] });
                } catch (e) {
                    console.error(`\x1b[31m[ JADIBOT ] Gagal mengirim kode pairing untuk @${targetNumber} (koneksi notifySock mungkin sudah putus):\x1b[0m`, e?.message || e);
                }
            }
        }
    } catch (error) {
        console.error(error);
        global.conns.delete(targetNumber);
    }
}

async function stopJadibotSession(targetNumber) {
    const client = global.conns.get(targetNumber);
    if (!client) return false;

    global.jadibotStopped.add(targetNumber);

    try {
        client.end(new Error('Dihentikan manual oleh owner'));
    } catch (e) {
        console.error(e);
    }

    global.conns.delete(targetNumber);
    return true;
}

async function activateAllJadibot({ notifyJid, notifySock, plugins }) {
    const baseDir = path.join(process.cwd(), 'session_jadibot');
    if (!fs.existsSync(baseDir)) return [];

    const folders = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    const activated = [];
    for (const targetNumber of folders) {
        if (global.conns.has(targetNumber)) continue;

        const credsPath = path.join(baseDir, targetNumber, 'creds.json');
        if (!fs.existsSync(credsPath)) continue;

        await startJadibotSession({ targetNumber, notifyJid, notifySock, plugins, isReconnect: true });
        activated.push(targetNumber);
        await delay(1000);
    }

    return activated;
}

export { startJadibotSession, stopJadibotSession, activateAllJadibot };

export default {
    name: 'jadibot',
    cmd: 'jadibot',
    category: 'owner',
    desc: 'Menumpang menjadi bot dengan kode pairing kustom.',
    owner: false,

    run: async ({ sock, from, m, args, plugins }) => {
        let targetNumber = args[0] ? args[0].replace(/[^0-9]/g, '') : m.key.participant || from;
        targetNumber = targetNumber.split('@')[0];

        if (!targetNumber || targetNumber.length < 9) {
            return await sock.sendMessage(from, { text: '❌ Nomor tidak valid! Masukkan kode negara (628xxx).' }, { quoted: m });
        }

        if (global.conns.has(targetNumber)) {
            return await sock.sendMessage(from, { text: `⚠️ Sesi untuk @${targetNumber} sudah aktif!`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `⏳ Menginisialisasi sesi untuk @${targetNumber}...`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });

        await startJadibotSession({ targetNumber, notifyJid: from, notifySock: sock, plugins });
    }
};