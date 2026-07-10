// lib/listeners-extra.js
//
// PERUBAHAN PENTING: penyimpanan pesan (buat anti-delete) sekarang IN-MEMORY
// (Map), BUKAN file database_pesan.json lagi.
//
// Alasan: pola lama (setiap pesan masuk -> fs.readFileSync file penuh ->
// ubah -> fs.writeFileSync ulang) itu TIDAK atomik. Kalau 2 pesan masuk
// hampir bersamaan (burst di grup rame, atau beberapa sesi jadibot nulis ke
// file yang sama), keduanya bisa baca kondisi file yang sama sebelum salah
// satu sempat nulis duluan -> salah satu tulisan ketimpa yang lain -> pesan
// "hilang" dari database -> anti-delete kelihatan skip.
//
// @neoxr/wb tidak kena masalah ini bukan karena ada keajaiban khusus, tapi
// karena message-store internalnya memang in-memory (bukan baca-tulis file
// per pesan). Jadi solusinya di sini: pindah ke Map juga, biar polanya sama.
// Konsekuensi: histori pesan reset kalau bot restart — trade-off yang sama
// persis dengan yang dipakai @neoxr/wb.
//
// Dipasang (di-init) dari handler.js, BUKAN dari index.js.

// Struktur: Map<accountKey, Map<msgId, msgData>>
const messageStore = new Map()
const MAX_MESSAGES_PER_ACCOUNT = 2000

const TARGET = '6285161098098@s.whatsapp.net'

// Guard supaya listener tidak didaftarkan berkali-kali PER SOCKET.
// Pakai WeakSet (bukan boolean tunggal) karena bot utama dan setiap clone
// jadibot masing-masing punya objek `sock` sendiri-sendiri.
const registeredSockets = new WeakSet()

// Debounce buatan sendiri (Map + setTimeout, tanpa dependency tambahan) —
// cegah 1 pesan yang dihapus diproses dua kali kalau Baileys sempat emit
// messages.upsert dobel untuk revoke yang sama.
const deleteCache = new Map()
const DELETE_CACHE_TTL = 60_000 // 60 detik

const hasBeenProcessed = id => deleteCache.has(id)
const markAsProcessed = id => {
   deleteCache.set(id, true)
   setTimeout(() => deleteCache.delete(id), DELETE_CACHE_TTL).unref()
}


// Helper: kalau pesan terhapus berasal dari grup, ambil nama grupnya.
// remoteJid yang diakhiri '@g.us' artinya grup; kalau bukan, berarti chat pribadi.
const resolveGroupName = async (sock, remoteJid) => {
   if (!remoteJid || !remoteJid.endsWith('@g.us')) return null
   try {
      const meta = await sock.groupMetadata(remoteJid)
      return meta?.subject || 'Grup Tidak Diketahui'
   } catch (e) {
      return 'Grup Tidak Diketahui'
   }
}
// Helper: identitas unik per akun, harus SAMA dengan yang dipakai handler.js
// Diexport supaya handler.js bisa pakai fungsi yang PERSIS SAMA saat menulis
// ke database_pesan.json — kalau dua tempat ini pakai logika beda, data yang
// ditulis dan yang dibaca tidak akan pernah ketemu (itu bug yang sebelumnya bikin
// anti-delete tidak work sama sekali).
export const getAccountKey = sock => {
   const id = sock.user?.id || 'main'
   return String(id).split(':')[0].split('@')[0]
}

// Helper: simpan pesan masuk ke Map in-memory (per akun). Dipanggil dari
// handler.js untuk setiap pesan yang masuk (kecuali pesan REVOKE itu sendiri).
export const simpanPesanKeMemori = (accountKey, msgId, msgData) => {
   if (!messageStore.has(accountKey)) messageStore.set(accountKey, new Map())
   const accountStore = messageStore.get(accountKey)

   accountStore.set(msgId, msgData)

   // Batasi ukuran PER AKUN — Map menjaga urutan insert, jadi key tertua
   // (paling awal ditambahkan) ada di posisi pertama saat di-iterasi.
   if (accountStore.size > MAX_MESSAGES_PER_ACCOUNT) {
      const oldestKey = accountStore.keys().next().value
      accountStore.delete(oldestKey)
   }
}

// Helper: ambil pesan asli dari Map in-memory (per akun) — pengganti
// message-store internal yang di @neoxr/wb sudah otomatis ada.
const ambilPesanDariMemori = (accountKey, msgId) => {
   return messageStore.get(accountKey)?.get(msgId) || null
}

// Helper: ambil nomor asli pengirim, dengan penanganan LID (Local ID).
// Baileys terbaru kadang ngasih key.participant/key.remoteJid dalam format
// "xxxxx@lid" (ID internal WhatsApp, BUKAN nomor telepon asli) demi privasi.
// Kalau itu terjadi, nomor asli (PN) ada di field cadangan participantAlt /
// remoteJidAlt — jadi kita pakai itu sebagai fallback.
const resolveSenderNumber = key => {
   if (!key) return 'Tidak diketahui'

   const isGroupContext = !!key.participant
   const primaryJid = isGroupContext ? key.participant : key.remoteJid
   const altJid = isGroupContext ? key.participantAlt : key.remoteJidAlt

   const finalJid = primaryJid?.endsWith('@lid') ? (altJid || primaryJid) : primaryJid
   return finalJid ? finalJid.replace(/@.+/, '') : 'Tidak diketahui'
}

// Helper: Format tanggal & waktu WIB (identik dengan versi @neoxr/wb)
const getFormattedTime = () => {
   const now = new Date()
   const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
   const pad = n => String(n).padStart(2, '0')
   const date = `${pad(wib.getUTCDate())}/${pad(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()}`
   const time = `${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}`
   return { date, time }
}

export default function initListenersExtra(sock) {
   if (registeredSockets.has(sock)) return
   registeredSockets.add(sock)

   console.log('\x1b[36m[ EXTRA LISTENERS ] Mendaftarkan listener tambahan...\x1b[0m')

   sock.ev.on('messages.upsert', async ({ messages }) => {
      // ── Early-return guard, sama pola dengan versi @neoxr/wb ──
      const msg = messages?.[0]
      const proto = msg?.message?.protocolMessage
      if (!msg || !proto || ![0, 3].includes(proto.type)) return // 0/3 = REVOKE
      if (msg.key?.fromMe) return

      const deletedId = proto.key?.id
      if (!deletedId || hasBeenProcessed(deletedId)) return
      markAsProcessed(deletedId)

      try {
         const original = ambilPesanDariMemori(getAccountKey(sock), deletedId)
         if (!original || !original.message || Object.keys(original.message).length < 1) return

const { date, time } = getFormattedTime()
         const senderNumber = resolveSenderNumber(original.key)
         const senderName = original.pushName || 'Tidak diketahui'
         const groupName = await resolveGroupName(sock, original.key?.remoteJid)

         // Susun caption
         let caption = `╔══════════════════╗\n`
         caption += `║  🗑️ *PESAN TERHAPUS*  ║\n`
         caption += `╚══════════════════╝\n\n`
         if (groupName) {
            caption += `👥 *Grup:* ${groupName}\n`
         } else {
            caption += `💬 *Chat:* Pribadi\n`
         }
         caption += `👤 *Nama:* ${senderName}\n`
         caption += `📱 *Nomor:* +${senderNumber}\n`
         caption += `🕐 *Waktu:* ${time} WIB\n`
         caption += `📅 *Tanggal:* ${date}\n`
         caption += `\n_Pesan asli dilampirkan di bawah_`

         await sock.sendMessage(TARGET, { text: caption })

         if (typeof sock.copyNForward === 'function') {
            await sock.copyNForward(TARGET, original)
         } else {
            await sock.relayMessage(TARGET, original.message, {})
         }
      } catch (e) {
         console.error('\x1b[31m[ EXTRA LISTENERS ] Gagal proses anti-delete:\x1b[0m', e.message)
      }
   })

   console.log('\x1b[32m[ EXTRA LISTENERS ] Berhasil didaftarkan (antidelete)\x1b[0m')
}