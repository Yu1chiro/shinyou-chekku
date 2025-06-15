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
        formData.append('filetype', 'auto'); // Tambah parameter filetype

        const response = await axios.post('https://api.ocr.space/parse/image', formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000 // 30 second timeout
        });

        console.log('OCR Response:', JSON.stringify(response.data, null, 2));

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
app.post('/analyze-product', async (req, res) => {
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

        // Perform OCR dengan image lengkap (termasuk prefix)
        const ocrText = await performOCR(image, process.env.OCR_API_KEY);
        console.log('OCR selesai, text length:', ocrText.length);
        console.log('OCR text preview:', ocrText.substring(0, 200) + '...');

        if (!ocrText || ocrText.trim().length === 0) {
            throw new Error('Tidak ada teks yang dapat diekstrak dari gambar');
        }

        // Analyze with Gemini
        const analysis = await analyzeProductWithGemini(ocrText, process.env.GEMINI_API_KEY);

        res.json({
            success: true,
            data: {
                ocr_text: ocrText,
                analysis: analysis
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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
        message: 'Server berjalan dengan baik',
        environment: {
            gemini_api: process.env.GEMINI_API_KEY ? 'Configured' : 'Not configured',
            ocr_api: process.env.OCR_API_KEY ? 'Configured' : 'Not configured'
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});