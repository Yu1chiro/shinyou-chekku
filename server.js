const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper function untuk OCR
const rateLimitStore = new Map();
const cooldownStore = new Map();

// Konfigurasi rate limiting
const RATE_LIMIT_CONFIG = {
    maxRequests: 3,        //max 3 request         
    windowMs: 30 * 1000,      //15 detik       
    cooldownMs: 30* 1000,          //10 detik cooldown  
    blockDurationMs: 120 * 1000       
};


// Whitelist IP yang diizinkan (opsional - untuk keamanan ekstra)
const ALLOWED_IPS = [
    // '192.168.1.100', // Contoh IP yang diizinkan
    // '10.0.0.1',      // Tambahkan IP yang diizinkan
];

// Fungsi untuk mendapatkan IP client
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           req.ip;
}

// Middleware rate limiting
function rateLimitMiddleware(req, res, next) {
    const clientIP = getClientIP(req);
    const now = Date.now();
    
    console.log(`Rate limit check untuk IP: ${clientIP}`);
    
    // Cek whitelist IP jika diaktifkan
    if (ALLOWED_IPS.length > 0 && !ALLOWED_IPS.includes(clientIP)) {
        console.log(`IP ${clientIP} tidak dalam whitelist`);
        return res.status(403).json({
            success: false,
            error: 'Akses ditolak: IP tidak diizinkan',
            code: 'IP_NOT_ALLOWED'
        });
    }
    
    // Cek apakah IP sedang dalam cooldown
    const cooldownEnd = cooldownStore.get(clientIP);
    if (cooldownEnd && now < cooldownEnd) {
        const remainingMs = cooldownEnd - now;
        const remainingSec = Math.ceil(remainingMs / 1000);
        
        console.log(`IP ${clientIP} masih dalam cooldown, sisa: ${remainingSec} detik`);
        return res.status(429).json({
            success: false,
            error: `Silakan tunggu ${remainingSec} detik sebelum request berikutnya`,
            code: 'COOLDOWN_ACTIVE',
            retryAfter: remainingSec
        });
    }
    
    // Ambil data rate limit untuk IP ini
    let ipData = rateLimitStore.get(clientIP);
    
    if (!ipData) {
        // IP baru, buat data baru
        ipData = {
            count: 0,
            firstRequest: now,
            blocked: false,
            blockEnd: 0
        };
    }
    
    // Cek apakah IP sedang diblokir
    if (ipData.blocked && now < ipData.blockEnd) {
        const remainingMs = ipData.blockEnd - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        
        console.log(`IP ${clientIP} sedang diblokir, sisa: ${remainingMin} menit`);
        return res.status(429).json({
            success: false,
            error: `IP Anda diblokir karena melebihi batas. Coba lagi dalam ${remainingMin} menit`,
            code: 'IP_BLOCKED',
            retryAfter: remainingMs / 1000
        });
    }
    
    // Reset counter jika window sudah expired
    if (now - ipData.firstRequest > RATE_LIMIT_CONFIG.windowMs) {
        ipData.count = 0;
        ipData.firstRequest = now;
        ipData.blocked = false;
        ipData.blockEnd = 0;
    }
    
    // Increment counter
    ipData.count++;
    
    // Cek apakah melebihi limit
    if (ipData.count > RATE_LIMIT_CONFIG.maxRequests) {
        // Blokir IP
        ipData.blocked = true;
        ipData.blockEnd = now + RATE_LIMIT_CONFIG.blockDurationMs;
        rateLimitStore.set(clientIP, ipData);
        
        console.log(`IP ${clientIP} diblokir karena melebihi batas (${ipData.count} requests)`);
        return res.status(429).json({
            success: false,
            error: 'Terlalu banyak request. IP Anda diblokir sementara',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: RATE_LIMIT_CONFIG.blockDurationMs / 1000
        });
    }
    
    // Update store
    rateLimitStore.set(clientIP, ipData);
    
    // Tambahkan info ke response header
    res.set({
        'X-RateLimit-Limit': RATE_LIMIT_CONFIG.maxRequests,
        'X-RateLimit-Remaining': Math.max(0, RATE_LIMIT_CONFIG.maxRequests - ipData.count),
        'X-RateLimit-Reset': new Date(ipData.firstRequest + RATE_LIMIT_CONFIG.windowMs).toISOString()
    });
    
    console.log(`Rate limit OK untuk IP ${clientIP}: ${ipData.count}/${RATE_LIMIT_CONFIG.maxRequests}`);
    next();
}

// Fungsi untuk set cooldown setelah OCR selesai
function setCooldown(clientIP) {
    const cooldownEnd = Date.now() + RATE_LIMIT_CONFIG.cooldownMs;
    cooldownStore.set(clientIP, cooldownEnd);
    console.log(`Cooldown 30 detik diset untuk IP: ${clientIP}`);
    
    // Auto cleanup cooldown setelah expired
    setTimeout(() => {
        cooldownStore.delete(clientIP);
        console.log(`Cooldown cleared untuk IP: ${clientIP}`);
    }, RATE_LIMIT_CONFIG.cooldownMs);
}

// OCR function dengan error handling yang lebih baik
async function performOCR(base64ImageWithPrefix, apiKey) {
    try {
        // Pastikan format base64 lengkap dengan prefix
        let fullBase64Image = base64ImageWithPrefix;
        
        // Jika tidak ada prefix, tambahkan default
        if (!base64ImageWithPrefix.startsWith('data:')) {
            fullBase64Image = `data:image/jpeg;base64,${base64ImageWithPrefix}`;
        }

        console.log('Sending OCR request with image format:', fullBase64Image.substring(0, 50) + '...');

        const formData = new URLSearchParams();
        formData.append('apikey', apiKey);
        formData.append('base64Image', fullBase64Image);
        formData.append('language', 'jpn');
        formData.append('isOverlayRequired', 'false');
        formData.append('detectOrientation', 'true');
        formData.append('scale', 'true');
        formData.append('filetype', 'auto');

        const response = await axios.post('https://api.ocr.space/parse/image', formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000 // 30 second timeout
        });

        console.log('OCR Response received');

        if (response.data.IsErroredOnProcessing) {
            throw new Error(response.data.ErrorMessage || response.data.ErrorDetails || 'OCR processing failed');
        }

        if (!response.data.ParsedResults || response.data.ParsedResults.length === 0) {
            throw new Error('No text found in image');
        }

        return response.data.ParsedResults[0].ParsedText;
    } catch (error) {
        console.error('OCR Error Details:', error.response?.data || error.message);
        throw new Error(`OCR Error: ${error.message}`);
    }
}

// Endpoint dengan rate limiting
app.post('/analyze-product', rateLimitMiddleware, async (req, res) => {
    const clientIP = getClientIP(req);
    
    try {
        const { image } = req.body;
        
        if (!image) {
            return res.status(400).json({
                success: false,
                error: 'Gambar tidak ditemukan'
            });
        }

        // Validasi format base64
        if (!image.startsWith('data:image/')) {
            return res.status(400).json({
                success: false,
                error: 'Format gambar tidak valid. Pastikan gambar dalam format base64 yang benar.'
            });
        }

        // Validasi ukuran gambar (opsional, untuk mencegah abuse)
        const imageSizeKB = (image.length * 0.75) / 1024; // Estimasi ukuran dalam KB
        if (imageSizeKB > 5000) { // Maksimal 5MB
            return res.status(400).json({
                success: false,
                error: 'Ukuran gambar terlalu besar. Maksimal 5MB.'
            });
        }

        console.log(`Memulai OCR untuk IP: ${clientIP}`);

        // Perform OCR dengan image lengkap (termasuk prefix)
        const ocrText = await performOCR(image, process.env.OCR_API_KEY);
        console.log('OCR selesai, text length:', ocrText.length);

        if (!ocrText || ocrText.trim().length === 0) {
            throw new Error('Tidak ada teks yang dapat diekstrak dari gambar');
        }

        // Analyze with Gemini
        const analysis = await analyzeProductWithGemini(ocrText, process.env.GEMINI_API_KEY);

        // Set cooldown setelah OCR berhasil
        setCooldown(clientIP);

        res.json({
            success: true,
            data: {
                ocr_text: ocrText,
                analysis: analysis
            },
            message: 'Analisis berhasil. Cooldown 30 detik dimulai.'
        });

    } catch (error) {
        console.error('Error untuk IP', clientIP, ':', error.message);
        
        // Set cooldown juga untuk error OCR (mencegah spam error)
        if (error.message.includes('OCR Error')) {
            setCooldown(clientIP);
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint untuk cek status rate limit (opsional)
app.get('/rate-limit-status', (req, res) => {
    const clientIP = getClientIP(req);
    const ipData = rateLimitStore.get(clientIP);
    const cooldownEnd = cooldownStore.get(clientIP);
    const now = Date.now();
    
    res.json({
        ip: clientIP,
        rateLimit: {
            count: ipData?.count || 0,
            limit: RATE_LIMIT_CONFIG.maxRequests,
            remaining: Math.max(0, RATE_LIMIT_CONFIG.maxRequests - (ipData?.count || 0)),
            resetTime: ipData ? new Date(ipData.firstRequest + RATE_LIMIT_CONFIG.windowMs).toISOString() : null,
            blocked: ipData?.blocked || false
        },
        cooldown: {
            active: cooldownEnd && now < cooldownEnd,
            remaining: cooldownEnd && now < cooldownEnd ? Math.ceil((cooldownEnd - now) / 1000) : 0
        }
    });
});

// Cleanup function untuk membersihkan data lama (jalankan berkala)
function cleanupRateLimitData() {
    const now = Date.now();
    
    // Cleanup rate limit data
    for (const [ip, data] of rateLimitStore.entries()) {
        if (now - data.firstRequest > RATE_LIMIT_CONFIG.windowMs && !data.blocked) {
            rateLimitStore.delete(ip);
        } else if (data.blocked && now > data.blockEnd) {
            rateLimitStore.delete(ip);
        }
    }
    
    // Cleanup cooldown data
    for (const [ip, endTime] of cooldownStore.entries()) {
        if (now > endTime) {
            cooldownStore.delete(ip);
        }
    }
    
    console.log(`Cleanup completed. Active IPs: ${rateLimitStore.size}, Cooldowns: ${cooldownStore.size}`);
}

// Jalankan cleanup setiap 5 menit
setInterval(cleanupRateLimitData, 5 * 60 * 1000);

// Helper function untuk Gemini AI
async function analyzeProductWithGemini(productText, apiKey) {
    try {
const prompt = ` 
Berdasarkan teks produk Jepang berikut: "${productText}"

Tugas Anda:
1. Identifikasi nama produk yang tepat
2. Cari dan verifikasi informasi produk ini langsung dari website resmi https://lohaco.yahoo.co.jp/
3. Sajikan hasil dalam format JSON berikut:

{
    "product_name": "nama produk yang jelas website resmi https://lohaco.yahoo.co.jp/ hanya nyatakan harga tanpa tambahan teks apapun contoh, "1080 JPY". Tidak boleh menebak-nebak atau memprediksi harga secara asal!",
    "price_yen": "sumber harga wajib merujuk ke ",
    "price_idr": "konversi ke rupiah (gunakan rate 1 JPY = 105 IDR)",
    "ingredients": "SALIN LENGKAP teks 原材料名 (daftar bahan) dari 商品仕様/スペック produk asli di lohaco.yahoo.co.jp",
    "contains_pork": "true/false — TIDAK BOLEH DITEBAK atau DIASUMSIKAN, hanya ditentukan berdasarkan *INTRUKSI KHUSUS & WAJIB* di bawah",
    "pork_analysis": "WAJIB menyebutkan bahan dengan kanji aslinya jika ditemukan. Jika mengandung 豚肉 atau turunannya, wajib tulis: 'Mengandung Babi (contoh: 豚肉, ラード)', jangan ubah atau lunakkan bahasa",
    "halal_status": "Langsung nyatakan 'tidak halal' jika mengandung babi atau turunannya. nyatakan 'Halal' jika tidak mengandung babi. Tidak boleh menebak-nebak atau menunda kesimpulan",
    "additional_info": "tambahan dari halaman produk asli jika ada"
}

**INTRUKSI KHUSUS & WAJIB (TIDAK BOLEH DILANGGAR):**
- Cek dan ambil data langsung dari halaman resmi lohaco.yahoo.co.jp. Jangan membuat asumsi.
- Jika ditemukan salah satu dari kata/kanji berikut di bagian 原材料名 (ingredients), maka *contains_pork* = *true* tanpa pengecualian:
  - 豚
  - 豚肉
  - 豚脂
  - 豚油
  - ポークエキス
  - ラード
  - 豚肉エキス
  - ポークブイヨン
- Jika salah satu dari di atas muncul, Anda wajib nyatakan:
  - "contains_pork": true
  - "pork_analysis": Sebutkan bahan secara eksplisit, contoh: "mengandung 豚肉 dan ラード"
  - "halal_status": tidak halal
- Jangan pernah menyatakan "tidak mengandung babi" jika bahan tersebut muncul. Kesalahan seperti ini dianggap pelanggaran fatal dalam analisis kehalalan.
- Hindari spekulasi seperti "mungkin", "kemungkinan besar tidak", atau "tergantung merek" — jawab berdasarkan data riil yang Anda temukan dari situs resmi.
- Tujuan utama Anda adalah **validasi dan keakuratan**, bukan asumsi atau kesimpulan menghibur.

‼️ Jika produk di situs resmi mengandung 豚肉, maka semua kesimpulan Anda wajib mengikuti itu. Jangan bertentangan dengan data asli.

`;

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
            {
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const responseText = response.data.candidates[0].content.parts[0].text;
        
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Format respons tidak valid dari Gemini');
        }
    } catch (error) {
        throw new Error(`Gemini API Error: ${error.message}`);
    }
}

// Route untuk halaman utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Route untuk upload dan analisis gambar

// Route untuk testing OCR
app.post('/test-ocr', async (req, res) => {
    try {
        const { image } = req.body;
        
        if (!image) {
            return res.status(400).json({
                success: false,
                error: 'Gambar tidak ditemukan'
            });
        }

        
        const ocrText = await performOCR(image, process.env.OCR_API_KEY);
        
        res.json({
            success: true,
            data: {
                ocr_text: ocrText,
                text_length: ocrText.length
            }
        });

    } catch (error) {
        console.error('OCR Test Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route untuk testing
app.get('/test', (req, res) => {
    res.json({
        message: 'server as running',
         });
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});