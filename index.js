import makeWASocket, { useMultiFileAuthState, delay } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { messageHandler } from './handler.js';

// Read config.json 
// (Membaca config.json)
const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !config.pairing.state,
        auth: state,
        browser: config.pairing.browser || ['Ubuntu', 'Chrome', '110.0.0.0']
    });

    // Custom Static Pairing Code System 
    // (Sistem Kustom Kode Pairing Statis)
    if (config.pairing.state && !sock.authState.creds.registered) {
        console.clear();
        console.log(`\x1b[35m┌────────────────────────────────────────────────────────┐\x1b[0m`);
        console.log(`\x1b[35m│\x1b[0m            \x1b[1;36mNEOXR-BOT CUSTOM PAIRING SYSTEM\x1b[0m             \x1b[35m│\x1b[0m`);
        console.log(`\x1b[35m└────────────────────────────────────────────────────────┘\x1b[0m\n`);
        
        const phoneNumber = String(config.pairing.number).replace(/[^0-9]/g, '');
        if (!phoneNumber) {
            console.log('\x1b[31m[!] Phone number in config.json is invalid! (Nomor di config.json tidak valid!)\x1b[0m');
            process.exit(0);
        }

        console.log(`\x1b[33m[?] Requesting pairing for (Meminta pairing untuk): ${phoneNumber}\x1b[0m`);
        console.log('\x1b[36m[... ] Injecting custom pairing code... (Menyuntikkan kode kustom...)\x1b[0m');
        await delay(3000); 

        try {
            // Ambil kode custom dari config.json
            // (Fetch custom code from config.json)
            let targetCode = String(config.pairing.code || '12345678').toUpperCase();

            // WhatsApp mewajibkan kode pairing custom persis 8 karakter (huruf/angka).
            // (WhatsApp requires the custom pairing code to be exactly 8 characters)
            if (targetCode.length !== 8) {
                console.log(`\x1b[31m[!] Kode di config.json harus 8 karakter, dipotong/di-pad otomatis. (Code in config.json must be 8 chars, auto-adjusted.)\x1b[0m`);
                targetCode = (targetCode + '12345678').slice(0, 8);
            }

            // Kode custom WAJIB dikirim sebagai argumen kedua requestPairingCode,
            // bukan lewat sock.authState.creds (itu diabaikan oleh Baileys).
            // (The custom code MUST be passed as requestPairingCode's 2nd argument,
            // not via sock.authState.creds — Baileys ignores that field.)
            const code = await sock.requestPairingCode(phoneNumber, targetCode);
            
            console.clear();
            console.log(`\n\x1b[32m┌────────────────────────────────────────┐\x1b[0m`);
            console.log(`\x1b[32m│\x1b[0m    \x1b[1;33mPAIRING CODE INJECTED SUCCESS\x1b[0m       \x1b[32m│\x1b[0m`);
            console.log(`\x1b[32m├────────────────────────────────────────┤\x1b[0m`);
            console.log(`\x1b[32m│\x1b[0m  Your Code (Kode Anda) : \x1b[1;36m${targetCode.match(/.{1,4}/g)?.join('-') || targetCode}\x1b[0m  \x1b[32m│\x1b[0m`);
            console.log(`\x1b[32m└────────────────────────────────────────┘\x1b[0m\n`);
            console.log('\x1b[33m[!] You can now link using the code above. (Sekarang Anda bisa menautkan perangkat pakai kode di atas.)\x1b[0m\n');
        } catch (error) {
            console.error('\x1b[31m[-] Failed to inject custom code (Gagal menyuntikkan kode kustom).\x1b[0m', error);
            process.exit(1);
        }
    }

    // Automatic Plugins Loader 
    // (Loader Plugins Otomatis)
    const plugins = new Map();
    const pluginsDir = path.join(process.cwd(), 'plugins');
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);
    
    const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
    for (const file of pluginFiles) {
        try {
            const filePath = path.join(pluginsDir, file);
            const fileUrl = pathToFileURL(filePath).href;
            const plugin = await import(fileUrl);
            if (plugin.default && plugin.default.cmd) {
                plugins.set(plugin.default.cmd, plugin.default);
            }
        } catch (err) {
            console.error(`Failed to load plugin (Gagal memuat plugin) ${file}:`, err);
        }
    }
    console.log(`\x1b[36m[ SYSTEM ] ${plugins.size} Plugins loaded successfully (Plugins berhasil dimuat).\x1b[0m`);

    // WhatsApp Connection Status 
    // (Status Koneksi WhatsApp)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('\x1b[31m[ CONNECTION ] Disconnected, reconnecting... (Terputus, mencoba menghubungkan kembali...)\x1b[0m');
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('\x1b[32m[ CONNECTION ] Bot connected to WhatsApp successfully! (Bot berhasil terhubung!)\x1b[0m');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Forward incoming messages to handler.js 
    // (Oper pesan masuk langsung ke handler.js)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        await messageHandler(sock, messages[0], plugins);
    });
}

startBot();
