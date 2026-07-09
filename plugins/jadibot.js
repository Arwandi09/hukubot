import makeWASocket, { useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { normalizePairingCode } from '../lib/pairing-code.js';

if (!global.conns) global.conns = new Map();
// Menandai nomor yang sedang di-stop secara manual (.stopjadibot / .stopsemuajadibot),
// supaya event 'connection.update' close TIDAK memicu auto-reconnect untuk nomor itu.
if (!global.jadibotStopped) global.jadibotStopped = new Set();

// Bikin/hubungkan sesi clone jadibot. Dipisah jadi fungsi sendiri (bukan
// ditaruh langsung di run()) supaya bisa dipanggil ulang otomatis saat
// koneksi putus tanpa perlu user ketik ulang command `.jadibot`.
async function startJadibotSession({ targetNumber, notifyJid, notifySock, plugins, isReconnect = false }) {
    // Folder sesi jadibot SELALU terpisah dari folder sesi bot utama ('session'),
    // jadi pembuatan/penghapusan sesi jadibot tidak pernah menyentuh file bot utama.
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
                    await notifySock.sendMessage(notifyJid, { text: `✅ Berhasil! Akun @${targetNumber} sekarang aktif mendampingi bot utama.`, mentions: [`${targetNumber}@s.whatsapp.net`] });
                }
            }

            if (connection === 'close') {
                global.conns.delete(targetNumber);

                // Tidak ada fs.rmSync() yang menghapus paksa folder sessions —
                // cuma mematikan instance koneksi mati di memori, file tetap aman.

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = statusCode === DisconnectReason.loggedOut;

                if (loggedOut) {
                    console.log(`\x1b[31m[ JADIBOT ] Sesi @${targetNumber} logout (dihapus dari HP). Sesi dihentikan permanen.\x1b[0m`);
                    return;
                }

                // Kalau close ini hasil stop manual, jangan reconnect otomatis.
                // File sesi tetap utuh, cuma koneksinya yang dimatikan.
                if (global.jadibotStopped.has(targetNumber)) {
                    global.jadibotStopped.delete(targetNumber);
                    console.log(`\x1b[33m[ JADIBOT ] Sesi @${targetNumber} dihentikan manual, tidak reconnect.\x1b[0m`);
                    return;
                }

                // Reconnect otomatis khusus untuk sesi jadibot ini saja — TIDAK memanggil
                // ulang startBot() punya bot utama, jadi bot utama tidak ikut ter-restart.
                console.log(`\x1b[33m[ JADIBOT ] Sesi @${targetNumber} terputus, mencoba menyambung ulang...\x1b[0m`);
                await delay(3000);
                startJadibotSession({ targetNumber, notifyJid, notifySock, plugins, isReconnect: true });
            }
        });

        client.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;

            const { messageHandler } = await import('../handler.js');
            await messageHandler(client, msg, plugins);
        });

        // Kode pairing cuma diminta kalau sesi ini BENAR-BENAR baru (belum registered).
        // Saat reconnect, creds sudah tersimpan di sessionPath sehingga baris ini dilewati.
        if (!isReconnect && !client.authState.creds.registered) {
            await delay(5000);

            // Pakai helper yang sama dengan index.js, supaya perilaku custom pairing
            // code jadibot identik dengan bot utama (dan sama-sama benar).
            const targetCode = normalizePairingCode(process.env.JADIBOT_PAIRING_CODE || '12345678');

            // Kode custom WAJIB lewat argumen kedua requestPairingCode(),
            // bukan lewat client.authState.creds (itu diabaikan Baileys).
            const code = await client.requestPairingCode(targetNumber, targetCode);
            const formattedCode = (code || targetCode).match(/.{1,4}/g)?.join('-') || (code || targetCode);

            let infoText = `╔══════════════════╗\n`;
            infoText += `║  🤖 *JADIBOT PAIRING* ║\n`;
            infoText += `╚══════════════════╝\n\n`;
            infoText += `👤 *Target Nomor:* @${targetNumber}\n`;
            infoText += `🔑 *Kode Pairing:* *${formattedCode}*\n\n`;
            infoText += `_Silakan masuk ke WhatsApp > Perangkat Tertaut, lalu masukkan kode di atas._`;

            if (notifySock) {
                await notifySock.sendMessage(notifyJid, { text: infoText, mentions: [`${targetNumber}@s.whatsapp.net`] });
            }
        }
    } catch (error) {
        console.error(error);
        global.conns.delete(targetNumber);
    }
}

// Menghentikan satu sesi jadibot yang sedang berjalan.
// Pakai client.end(), BUKAN client.logout() — end() cuma memutus koneksi socket,
// tidak mengirim request logout ke WA, jadi file sesi di session_jadibot/ tetap aman.
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

// Mengaktifkan ulang semua sesi yang tersimpan di folder session_jadibot/,
// tanpa menyentuh/menghapus file apa pun. Hanya folder yang punya creds.json
// (berarti pernah berhasil pairing) yang dicoba disambungkan.
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
        await delay(1000); // jeda antar koneksi biar tidak sekaligus semua
    }

    return activated;
}

// Fungsi-fungsi di atas (startJadibotSession, stopJadibotSession, activateAllJadibot)
// diexport supaya bisa dipakai bersama oleh stopjadibot.js, aktifkanjadibot.js,
// dan stopsemuajadibot.js — jadi 1 file ini TETAP export default SATU object command,
// sesuai format yang dibaca loader plugin (plugin.cmd, plugin.run, dst).
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
