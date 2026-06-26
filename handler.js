import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const TARGET = '6285161098098@s.whatsapp.net';

export async function messageHandler(sock, m, plugins, messageStorage) {
    if (!m.message) return;

    const from = m.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const isStatus = from === 'status@broadcast';

    // 1. INTERSEPTOR ANTI-DELETE
    const isDelete = m.message?.protocolMessage && m.message.protocolMessage.type === 3;
    if (isDelete) {
        try {
            const targetId = m.message.protocolMessage.key.id;
            const cachedMsg = messageStorage.get(targetId);
            
            if (cachedMsg) {
                const senderJid = cachedMsg.key.participant || cachedMsg.key.remoteJid || '';
                const senderNumber = senderJid.replace(/@.+/, '') || 'Tidak diketahui';
                const senderName = cachedMsg.pushName || 'User';

                const now = new Date();
                const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
                const pad = (n) => String(n).padStart(2, '0');
                const date = `${pad(wib.getUTCDate())}/${pad(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()}`;
                const time = `${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}`;

                let chatSource = isStatus ? '📢 *Status / Broadcast*' : isGroup ? `👥 *Grup:* ${from}` : `💬 *Chat Pribadi*`;
                if (isGroup) {
                    try {
                        const meta = await sock.groupMetadata(from);
                        chatSource = `👥 *Grup:* ${meta?.subject || from}`;
                    } catch (_) {}
                }

                let caption = `╔══════════════════╗\n`;
                caption += `║  🗑️ *PESAN DIHAPUS*  ║\n`;
                caption += `╚══════════════════╝\n\n`;
                caption += `${chatSource}\n`;
                caption += `👤 *Dari:* ${senderName} (+${senderNumber})\n`;
                caption += `📅 *Tanggal:* ${date}\n`;
                caption += `🕐 *Waktu:* ${time} WIB\n\n`;
                caption += `_Pesan asli dilampirkan di bawah_`;

                await sock.sendMessage(TARGET, { text: caption });
                await sock.sendMessage(TARGET, { forward: cachedMsg }, { quoted: cachedMsg });
                messageStorage.delete(targetId);
            }
            return;
        } catch (err) {
            console.error('Anti-Delete Error:', err);
        }
    }

    // 2. DETEKSI SEMUA JENIS KONTEN UNTUK LOG TERMINAL (TANPA TERKECUALI)
    const msgType = Object.keys(m.message)[0];
    let body = '';

    if (msgType === 'conversation') body = m.message.conversation;
    else if (msgType === 'extendedTextMessage') body = m.message.extendedTextMessage.text;
    else if (m.message[msgType]?.caption) body = m.message[msgType].caption;
    else {
        // Jika tidak ada teks/caption (misal stiker, kontak, VN, lokasi, dll), beri label tipenya
        body = `\x1b[36m[${msgType.replace('Message', '').toUpperCase()}]\x1b[0m`;
    }

    const senderNumber = isGroup ? (m.key.participant || '') : from;
    const cleanSender = senderNumber.split('@')[0];
    const pushName = m.pushName || 'User';
    const msgTime = new Date().toLocaleTimeString();

    const isMe = m.key.fromMe;
    const isOwner = isMe || config.owners?.some(owner => String(owner).includes(cleanSender));

    // Filter Self Mode
    if (config.self && !isOwner) return;

    // Cetak Log ke Terminal (Semua pesan masuk akan tercetak di sini)
    if (isGroup) {
        console.log(`\x1b[34m[GC - ${msgTime}]\x1b[0m \x1b[33m${pushName}\x1b[0m (${cleanSender}): ${body}`);
    } else {
        console.log(`\x1b[32m[PC - ${msgTime}]\x1b[0m \x1b[33m${pushName}\x1b[0m: ${body}`);
    }

    // 3. LISTENERS BACKGROUND RUNNER
    plugins.forEach(async (plugin) => {
        if (plugin.listen) {
            try { await plugin.run({ sock, from, m, isOwner, isMe, plugins }); } catch (err) {}
        }
    });

    // 4. PARSING PERINTAH (COMMAND)
    const rawText = m.message.conversation || m.message.extendedTextMessage?.text || m.message[msgType]?.caption || '';
    const prefix = /^[./!#]/;
    const isCmd = prefix.test(rawText);
    if (!isCmd) return;

    const args = rawText.trim().split(/ +/);
    const command = args.shift().toLowerCase().replace(prefix, '');

    if (plugins.has(command)) {
        const plugin = plugins.get(command);
        
        if (plugin.owner && !isOwner) {
            return await sock.sendMessage(from, { text: `❌ Perintah ini khusus Owner.` }, { quoted: m });
        }

        try {
            console.log(`   \x1b[35m➔ Menjalankan perintah: .${command}\x1b[0m`);
            await plugin.run({ sock, from, m, args, body: rawText, isOwner, isMe, command, plugins, isGroup });
        } catch (err) {
            console.error(`Error pada plugin .${command}:`, err);
        }
    }
}
