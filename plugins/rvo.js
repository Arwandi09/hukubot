import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { readFileSync as read, unlinkSync as remove, writeFileSync as create } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { tmpdir } from 'os';
import fs from 'fs';

export default {
    name: 'rvo',
    cmd: 'rvo',
    category: 'group',
    desc: 'Download and resend View Once media. (Mengunduh dan mengirim kembali media View Once.)',
    owner: false,

    run: async ({ sock, from, m }) => {
        // 1. Check if the user is replying to a message
        // (1. Periksa apakah pengguna membalas sebuah pesan)
        const quotedKey = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedKey) {
            return await sock.sendMessage(from, { 
                text: '🚩 Please reply to a View Once message. (Silakan balas pesan View Once.)' 
            }, { quoted: m });
        }

        // 2. Advanced Deep Search for View Once Media Structure
        // (2. Pencarian Mendalam Tingkat Lanjut untuk Struktur Media View Once)
        let mediaType = '';
        let mediaMessage = null;

        // Extract the real message even if it is wrapped in viewOnceMessage layers
        // (Ekstrak pesan asli meskipun dibungkus dalam lapisan viewOnceMessage)
        const rawMessage = quotedKey.viewOnceMessageV2?.message || 
                            quotedKey.viewOnceMessage?.message || 
                            quotedKey;

        if (rawMessage.imageMessage) {
            mediaType = 'image';
            mediaMessage = rawMessage.imageMessage;
        } else if (rawMessage.videoMessage) {
            mediaType = 'video';
            mediaMessage = rawMessage.videoMessage;
        } else if (rawMessage.audioMessage) {
            mediaType = 'audio';
            mediaMessage = rawMessage.audioMessage;
        }

        // 3. Final Validation: Ensure it is a valid View Once message
        // (3. Validasi Akhir: Pastikan ini adalah pesan View Once yang valid)
        // Some WA versions just inject 'viewOnce: true' inside the standard message object
        const isViewOnce = quotedKey.viewOnceMessageV2 || quotedKey.viewOnceMessage || mediaMessage?.viewOnce;

        if (!mediaMessage || !isViewOnce) {
            return await sock.sendMessage(from, { 
                text: '🚩 That is not a View Once message! (Itu bukan pesan View Once!)' 
            }, { quoted: m });
        }

        // Send a temporary processing alert
        // (Kirim pemberitahuan proses sementara)
        await sock.sendMessage(from, { text: '🕒 Processing media, please wait... (Memproses media, mohon tunggu...)' }, { quoted: m });

        try {
            // 4. Download the encrypted media content
            // (4. Unduh konten media yang terenkripsi)
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            const caption = mediaMessage.caption || '';

            // 5. Handle Image and Video sending
            // (5. Tangani pengiriman Gambar dan Video)
            if (mediaType === 'image') {
                await sock.sendMessage(from, { image: buffer, caption: caption }, { quoted: m });
            } else if (mediaType === 'video') {
                await sock.sendMessage(from, { video: buffer, caption: caption }, { quoted: m });
            } 
            // 6. Handle Audio converting via ffmpeg
            // (6. Tangani konversi Audio via ffmpeg)
            else if (mediaType === 'audio') {
                const randomName = Math.random().toString(36).substring(7);
                const tempMedia = path.join(tmpdir(), `${randomName}_input.mp3`);
                const tempResult = path.join(tmpdir(), `${randomName}_output.mp3`);
                
                create(tempMedia, buffer);

                exec(`ffmpeg -i ${tempMedia} -vn -ar 44100 -ac 2 -b:a 128k ${tempResult}`, async (err) => {
                    if (fs.existsSync(tempMedia)) remove(tempMedia);
                    
                    if (err) {
                        if (fs.existsSync(tempResult)) remove(tempResult);
                        return sock.sendMessage(from, { text: '❌ Conversion failed. Make sure ffmpeg is installed. (Konversi gagal. Pastikan ffmpeg terinstal.)' }, { quoted: m });
                    }

                    const audioBuffer = read(tempResult);
                    await sock.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/mp4', ptt: true }, { quoted: m });
                    
                    if (fs.existsSync(tempResult)) remove(tempResult);
                });
            }
        } catch (error) {
            console.error('Error inside .rvo command:', error);
            await sock.sendMessage(from, { text: '❌ Failed to process View Once media. (Gagal memproses media View Once.)' }, { quoted: m });
        }
    }
};
