export default {
    name: 'menu',
    cmd: 'menu',
    category: 'main',
    desc: 'Display all available commands. (Menampilkan semua perintah yang tersedia.)',
    owner: false,

    run: async ({ sock, from, m, plugins }) => {
        // Object to store commands grouped by category
        // (Objek untuk menyimpan perintah yang dikelompokkan berdasarkan kategori)
        const categories = {};

        // Loop through all registered plugins
        // (Lakukan perulangan pada semua plugin yang terdaftar)
        plugins.forEach((plugin) => {
            const cat = plugin.category || 'unassigned (tanpa kategori)';
            if (!categories[cat]) {
                categories[cat] = [];
            }
            // Avoid duplicate commands if they have aliases
            // (Hindari duplikasi perintah jika memiliki alias)
            if (!categories[cat].includes(plugin.cmd)) {
                categories[cat].push({
                    cmd: plugin.cmd,
                    desc: plugin.desc || 'No description. (Tidak ada deskripsi.)'
                });
            }
        });

        // Build the menu text template
        // (Menyusun template teks menu)
        let textMenu = `*Simple Bot Menu* 🤖\n\n`;

        for (const category in categories) {
            // Capitalize category header
            // (Membuat huruf kapital pada judul kategori)
            textMenu += `*┌── [ ${category.toUpperCase()} ]*\n`;
            
            categories[category].forEach((item) => {
                textMenu += `*│* .${item.cmd} \n*│* _${item.desc}_\n*│*\n`;
            });
            
            textMenu += `*└───*\n\n`;
        }

        textMenu += `_Bot runs super light without extra external libs._\n`;
        textMenu += `_(Bot berjalan super ringan tanpa lib eksternal tambahan.)_`;

        await sock.sendMessage(from, { text: textMenu }, { quoted: m });
    }
};
