import { writeFileSync as create, readFileSync as read, unlinkSync as remove } from 'fs';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';

export default {
    name: 'brat',
    cmd: 'brat',
    category: 'maker',
    desc: 'Create a brat-style text sticker. (Membuat stiker teks bergaya brat.)',
    owner: false,

    run: async ({ sock, from, m, args }) => {
        const text = args.join(' ').trim();

        if (!text) {
            return await sock.sendMessage(from, {
                text: '👉 Example (Contoh): .brat i love you'
            }, { quoted: m });
        }

        if (text.length > 150) {
            return await sock.sendMessage(from, {
                text: '🚩 Max 150 character. (Maksimal 150 karakter.)'
            }, { quoted: m });
        }

        await sock.sendMessage(from, { text: '🕒 Generating brat sticker... (Membuat stiker...)' }, { quoted: m });

        const randomName = Math.random().toString(36).substring(7);
        const tempInput = path.join(tmpdir(), `${randomName}_brat.jpg`);
        const tempOutput = path.join(tmpdir(), `${randomName}_brat.webp`);

        try {
            // Generated locally via direct request, no paid Api used
            // (Digenerate secara lokal lewat request langsung, tanpa Api berbayar)
            const res = await fetch(`https://aqul-brat.hf.space/?text=${encodeURIComponent(text)}`);
            if (!res.ok) throw new Error('Failed to fetch brat image.');
            const imageBuffer = Buffer.from(await res.arrayBuffer());

            create(tempInput, imageBuffer);

            exec(`ffmpeg -y -i ${tempInput} -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:-1:-1:color=#00000000" -c:v libwebp -lossless 0 -quality 80 -compression_level 6 ${tempOutput}`, async (err) => {
                if (fs.existsSync(tempInput)) remove(tempInput);

                if (err) {
                    console.error('Error inside .brat command (ffmpeg):', err);
                    if (fs.existsSync(tempOutput)) remove(tempOutput);
                    return sock.sendMessage(from, { text: '❌ Failed to convert sticker. Make sure ffmpeg is installed. (Gagal mengonversi stiker. Pastikan ffmpeg terinstal.)' }, { quoted: m });
                }

                const stickerBuffer = read(tempOutput);
                await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
                if (fs.existsSync(tempOutput)) remove(tempOutput);
            });
        } catch (error) {
            console.error('Error inside .brat command:', error);
            if (fs.existsSync(tempInput)) remove(tempInput);
            if (fs.existsSync(tempOutput)) remove(tempOutput);
            await sock.sendMessage(from, { text: '❌ Failed to generate brat sticker. (Gagal membuat stiker brat.)' }, { quoted: m });
        }
    }
};
