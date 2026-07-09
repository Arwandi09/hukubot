// lib/pairing-code.js
// Helper bersama biar index.js dan plugins/jadibot.js pakai logika
// yang sama persis untuk kode pairing kustom (tidak duplikat, tidak beda perilaku).

/**
 * Normalisasi kode pairing custom supaya selalu 8 karakter uppercase,
 * sesuai syarat WhatsApp untuk custom pairing code.
 * @param {string} raw - kode mentah dari config.json (atau sumber lain)
 * @param {string} fallback - dipakai untuk padding kalau raw kurang dari 8 karakter
 * @returns {string} kode 8 karakter siap dipakai di requestPairingCode()
 */
export function normalizePairingCode(raw, fallback = '12345678') {
   let code = String(raw || fallback).toUpperCase().replace(/[^A-Z0-9]/g, '')
   if (code.length !== 8) {
      code = (code + fallback).slice(0, 8)
   }
   return code
}