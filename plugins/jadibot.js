import makeWASocket, { useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

if (!global.conns) global.conns = new Map();

export default {
    name: 'jadibot',
    cmd: 'jadibot',
    category: 'owner',
    desc: 'Menumpang menjadi bot dengan kode pairing kustom statis.',
    owner: false,

    run: async ({ sock, from, m, args, plugins, messageStorage }) => {
        // 1. Ambil nomor target murni angka
        let targetNumber = args[0] ? args[0].replace(/[^0-9]/g, '') : m.key.participant || from;
        targetNumber = targetNumber.split('@')[0];

        if (!targetNumber || targetNumber.length < 9) {
            return await sock.sendMessage(from, { text: '❌ Nomor telepon tidak valid! Pastikan menyertakan kode negara (misal: 628xxx).' }, { quoted: m });
        }

        if (global.conns.has(targetNumber)) {
            return await sock.sendMessage(from, { text: `⚠️ Sesi untuk @${targetNumber} sudah aktif berjalan!`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `⏳ Menginisialisasi sesi untuk @${targetNumber}. Harap tunggu sebentar...`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });

        const sessionPath = path.join(process.cwd(), 'session_jadibot', targetNumber);
        
        // PERBAIKAN: Memastikan folder dibuat secara sinkron dan aman di Android/SDCard
        try {
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }
        } catch (folderErr) {
            console.error('Gagal membuat folder sesi jadibot:', folderErr);
            return await sock.sendMessage(from, { text: '❌ Gagal menyiapkan ruang penyimpanan sesi pada storage.' }, { quoted: m });
        }

        try {
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            
            const client = makeWASocket({
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: state,
                browser: ['Ubuntu', 'Chrome', '110.0.0.0']
            });

            // Langsung daftarkan ke Map global agar tidak terjadi double init
            global.conns.set(targetNumber, client);

            // 2. Pasang semua Event Listeners TERLEBIH DAHULU sebelum meminta kode
            // PERBAIKAN: Proteksi try-catch pada saat penulisan file kredensial berkala
            client.ev.on('creds.update', async () => {
                try {
                    await saveCreds();
                } catch (credsErr) {
                    console.error('Gagal menyimpan creds.json:', credsErr);
                }
            });

            client.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log(`\x1b[32m[ JADIBOT ] Clone bot @${targetNumber} BERHASIL TERHUBUNG!\x1b[0m`);
                    await sock.sendMessage(from, { text: `✅ Berhasil! Akun @${targetNumber} sekarang sudah aktif mendampingi bot utama.`, mentions: [`${targetNumber}@s.whatsapp.net`] });
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    console.log(`\x1b[31m[ JADIBOT ] Sesi @${targetNumber} terputus. Mengubungkan kembali: ${shouldReconnect}\x1b[0m`);
                    global.conns.delete(targetNumber);

                    if (shouldReconnect) {
                        // Panggil rekursif helper jika hanya DC jaringan
                        setTimeout(() => {
                            structJadiBot(targetNumber, sessionPath, sock, from, m, plugins, messageStorage);
                        }, 5000);
                    } else {
                        await sock.sendMessage(from, { text: `❌ Sesi jadibot @${targetNumber} telah dikeluarkan (Logged Out) atau kedaluwarsa.`, mentions: [`${targetNumber}@s.whatsapp.net`] });
                        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
                    }
                }
            });

            client.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                const msg = messages[0];
                if (!msg.message) return;

                // Alirkan ke handler.js utama kamu
                const { messageHandler } = await import('../handler.js');
                await messageHandler(client, msg, plugins, messageStorage);
            });

            // 3. Request Pairing Code secara aman setelah state internal Baileys siap
            if (!client.authState.creds.registered) {
                // Beri jeda agar koneksi engine Baileys stabil
                await delay(5000); 
                
                const targetCode = "12345678"; 
                client.authState.creds.pairingCode = targetCode;
                
                // Trigger pendaftaran kode ke server WhatsApp
                const code = await client.requestPairingCode(targetNumber);
                
                // Gunakan kode respon asli dari Baileys jika override internal gagal, atau paksa visual targetCode
                const finalCode = code || targetCode;
                const formattedCode = finalCode.match(/.{1,4}/g)?.join('-') || finalCode;

                let infoText = `╔══════════════════╗\n`;
                infoText += `║  🤖 *JADIBOT PAIRING* ║\n`;
                infoText += `╚══════════════════╝\n\n`;
                infoText += `👤 *Target Nomor:* @${targetNumber}\n`;
                infoText += `🔑 *Kode Pairing:* *${formattedCode}*\n\n`;
                infoText += `_Silakan buka WhatsApp > Perangkat Tertaut > Tautkan dengan Kode Telepon, lalu masukkan kode di atas._`;

                await sock.sendMessage(from, { text: infoText, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: m });
            }

        } catch (error) {
            console.error(`Error initialization jadibot untuk ${targetNumber}:`, error);
            await sock.sendMessage(from, { text: `❌ Gagal memproses jadibot untuk @${targetNumber}.` }, { quoted: m });
            global.conns.delete(targetNumber);
        }
    }
};

// Helper Reconnect Engine
async function structJadiBot(targetNumber, sessionPath, sock, from, m, plugins, messageStorage) {
    if (global.conns.has(targetNumber)) return;
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
            try {
                await saveCreds();
            } catch (_) {}
        });
        
        client.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') console.log(`\x1b[32m[ JADIBOT ] Reconnected successfully: ${targetNumber}\x1b[0m`);
            if (update.connection === 'close') {
                global.conns.delete(targetNumber);
                if (update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    setTimeout(() => structJadiBot(targetNumber, sessionPath, sock, from, m, plugins, messageStorage), 5000);
                } else {
                    try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
                }
            }
        });

        client.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const { messageHandler } = await import('../handler.js');
            await messageHandler(client, messages[0], plugins, messageStorage);
        });
    } catch (e) { console.error(e); }
}
