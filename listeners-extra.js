// lib/listeners-extra.js
//
// Struktur file ini dibikin semirip mungkin dengan versi @neoxr/wb (lihat
// lib/listeners-extra.js.bak): urutan helper di atas, lalu satu blok
// registrasi listener dengan early-return guard di baris pertama, try/catch
// yang sama, dan urutan langkah yang sama persis (ambil waktu -> tentukan
// pengirim -> susun caption -> kirim -> forward pesan asli).
//
// BEDA WAJIB dari versi @neoxr/wb (bukan soal gaya, tapi soal keterbatasan
// Baileys mentah):
//   1. @neoxr/wb: `ctx.message` di event 'message.delete' SUDAH berisi pesan
//      asli, karena frameworknya punya message-store internal sendiri.
//      Baileys mentah: event REVOKE cuma berisi ID pesan yang dihapus, TANPA
//      isinya. Makanya di sini WAJIB ada database_pesan.json sebagai
//      pengganti message-store itu — kalau dihapus, fitur ini tidak akan
//      pernah bisa menampilkan isi pesan yang terhapus.
//   2. @neoxr/wb: client.register() sudah otomatis anti-dobel-panggil dan
//      punya debounce internal. Baileys mentah: kita bikin sendiri lewat
//      WeakSet (guard per-socket) + Map dengan TTL manual (debounce).
//   3. sock.copyNForward() tidak ada di Baileys polos (method custom
//      @neoxr/wb), jadi ada fallback ke sock.relayMessage().
//
// Dipasang (di-init) dari handler.js, BUKAN dari index.js.

import fs from 'fs'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'database_pesan.json')
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

// Helper: identitas unik per akun, harus SAMA dengan yang dipakai handler.js
// Diexport supaya handler.js bisa pakai fungsi yang PERSIS SAMA saat menulis
// ke database_pesan.json — kalau dua tempat ini pakai logika beda, data yang
// ditulis dan yang dibaca tidak akan pernah ketemu (itu bug yang sebelumnya bikin
// anti-delete tidak work sama sekali).
export const getAccountKey = sock => {
   const id = sock.user?.id || 'main'
   return String(id).split(':')[0].split('@')[0]
}

// Helper: ambil pesan asli dari database_pesan.json (per akun) — pengganti
// message-store internal yang di @neoxr/wb sudah otomatis ada.
const ambilPesanDariDB = (accountKey, msgId) => {
   try {
      if (!fs.existsSync(DB_PATH)) return null
      const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
      return db?.[accountKey]?.[msgId] || null
   } catch (e) {
      return null
   }
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
         const original = ambilPesanDariDB(getAccountKey(sock), deletedId)
         if (!original || !original.message || Object.keys(original.message).length < 1) return

         const { date, time } = getFormattedTime()
         const senderNumber = resolveSenderNumber(original.key)
         const senderName = original.pushName || 'Tidak diketahui'

         // Susun caption
         let caption = `╔══════════════════╗\n`
         caption += `║  🗑️ *PESAN TERHAPUS*  ║\n`
         caption += `╚══════════════════╝\n\n`
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
