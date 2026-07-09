import fs from 'fs';
import path from 'path';
import initListenersExtra, { getAccountKey } from './lib/listeners-extra.js';

const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const TARGET = '6285161098098@s.whatsapp.net';
const DB_PATH = path.join(process.cwd(), 'database_pesan.json');

// Helper: Menulis data ke database JSON lokal (Fungsi ini wajib ada di paling atas)
// PENTING: struktur database di-nest per akun (accountKey -> msgId -> msgData),
// SAMA PERSIS dengan cara listeners-extra.js membacanya lewat ambilPesanDariDB().
// Sebelumnya ini nulis flat (db[msgId] = ...), jadi listeners-extra.js yang
// membaca db[accountKey][msgId] tidak pernah menemukan datanya — itu sebabnya
// anti-delete kelihatan tidak jalan sama sekali.
const simpanKeDatabase = (accountKey, msgId, msgData) => {
    try {
        let db = {};
        if (fs.existsSync(DB_PATH)) {
            db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        }

        if (!db[accountKey]) db[accountKey] = {};
        db[accountKey][msgId] = msgData;

        // Batasi ukuran database PER AKUN agar file tidak membengkak
        // (Maksimal 2000 pesan terakhir per akun, bukan global)
        const keys = Object.keys(db[accountKey]);
        if (keys.length > 2000) {
            delete db[accountKey][keys[0]];
        }

        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('Gagal menulis database pesan:', e);
    }
};

export async function messageHandler(sock, m, plugins) {
    // Daftarkan listener tambahan (antidelete, auto-reject call, welcome/leave)
    // sekali saja, begitu handler ini pertama kali jalan dan sudah pegang `sock`.
    initListenersExtra(sock);

    if (!m.message) return;

    const from = m.key.remoteJid;
    if (!from) return; 

    const isGroup = from.endsWith('@g.us');
    const isStatus = from === 'status@broadcast';

    // ─── LANGKAH 1: REKAM SEMUA PESAN MASUK KE BLACKBOX ───
    const isDeleteAction = m.message?.protocolMessage && m.message.protocolMessage.type === 3;
    if (!isDeleteAction) {
        simpanKeDatabase(getAccountKey(sock), m.key.id, m);
    }

    // ─── LANGKAH 2: FILTER & DETEKSI JENIS KONTEN UNTUK LOG TERMINAL ───
    const msgType = Object.keys(m.message)[0];
    
    // Abaikan kode enkripsi / internal Baileys agar tidak mengotori terminal
    if ([
        'senderKeyDistributionMessage', 
        'protocolMessage', 
        'clientNotifiedMessage', 
        'reactionMessage'
    ].includes(msgType)) return;

    let body = '';
    if (msgType === 'conversation') body = m.message.conversation;
    else if (msgType === 'extendedTextMessage') body = m.message.extendedTextMessage.text;
    else if (m.message[msgType]?.caption) body = m.message[msgType].caption;
    else body = `\x1b[36m[${msgType.replace('Message', '').toUpperCase()}]\x1b[0m`;

    // Ambil nomor pengirim murni angka dengan pertahanan fallback anti-null
    const senderNumber = m.key.fromMe ? (sock.user?.id || '') : (isGroup ? (m.key.participant || '') : (from || ''));
    const cleanSender = String(senderNumber).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    
    const pushName = m.pushName || 'User';
    const msgTime = new Date().toLocaleTimeString();

    const isMe = m.key.fromMe;
    
    // Deteksi owner super ketat dari config.json maupun dari diri sendiri (isMe)
    const isOwner = isMe || config.owners?.some(owner => {
        const cleanOwner = String(owner).replace(/[^0-9]/g, '');
        return cleanOwner === cleanSender || (sock.user?.id && sock.user.id.includes(cleanOwner));
    });

    // Log Terminal tetap dicetak agar kamu tahu ada pesan masuk
    if (isGroup) {
        let groupName = 'Grup Tidak Diketahui';
        try {
            const groupMeta = await sock.groupMetadata(from);
            groupName = groupMeta?.subject || 'Grup';
        } catch (_) { groupName = 'Grup'; }
        console.log(`\x1b[34m[${groupName} - ${msgTime}]\x1b[0m \x1b[33m${pushName}\x1b[0m (${cleanSender}): ${body}`);
    } else if (isStatus) {
        console.log(`\x1b[35m[STATUS STORY - ${msgTime}]\x1b[0m \x1b[33m${pushName}\x1b[0m (${cleanSender})`);
    } else {
        console.log(`\x1b[32m[PRIVAT - ${msgTime}]\x1b[0m \x1b[33m${pushName}\x1b[0m (${cleanSender}): ${body}`);
    }

    // ─── LANGKAH 3: JALANKAN BACKGROUND LISTENERS (ANTI-DELETE, DLL) ───
    plugins.forEach(async (plugin) => {
        if (plugin.listen) {
            try { await plugin.run({ sock, from, m, isOwner, isMe, plugins, isGroup }); } catch (err) {}
        }
    });

    // ─── LANGKAH 4: PARSING PERINTAH COMMAND & FILTER SELF MODE ───
    const rawText = m.message.conversation || m.message.extendedTextMessage?.text || m.message[msgType]?.caption || '';
    const prefix = /^[./!#]/;
    if (!prefix.test(rawText)) return;

    const args = rawText.trim().split(/ +/);
    const command = args.shift().toLowerCase().replace(prefix, '');

    if (plugins.has(command)) {
        const plugin = plugins.get(command);
        
        // Interseptor Self Mode di gerbang eksekusi command
        if (config.self && !isOwner) return;

        if (plugin.owner && !isOwner) {
            return await sock.sendMessage(from, { text: '❌ Perintah ini khusus untuk Owner bot!' }, { quoted: m });
        }
        
        try {
            await plugin.run({ sock, from, m, args, body: rawText, isOwner, isMe, command, plugins, isGroup });
        } catch (err) {
            console.error(err);
        }
    }
}
