        // Optimized JavaScript client untuk upload gambar dan OCR
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const uploadArea = document.getElementById('upload-area');
const imagePreview = document.getElementById('image-preview');
const previewImg = document.getElementById('preview-img');
const analyzeBtn = document.getElementById('analyze-btn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const error = document.getElementById('error');
const toggleOcr = document.getElementById('toggle-ocr');
const ocrContent = document.getElementById('ocr-content');
const ocrArrow = document.getElementById('ocr-arrow');
const cancelBtn = document.getElementById('cancel-btn');
const retryBtn = document.getElementById('retry-btn');
const guideBtn = document.getElementById('guide-btn');
const guideModal = document.getElementById('guide-modal');
const closeGuide = document.getElementById('close-guide');
const demoBtns = document.querySelectorAll('.demo-btn');

let selectedImage = null;
let isAnalyzing = false;

// Fungsi untuk kompres gambar sebelum upload (untuk performa lebih baik)
function compressImage(file, maxWidth = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
            // Hitung dimensi baru dengan mempertahankan aspect ratio
            const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            
            // Gambar ulang dengan ukuran baru
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Konversi ke base64
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedBase64);
        };
        
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// Validasi file dengan lebih ketat
function validateFile(file) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    if (!allowedTypes.includes(file.type)) {
        throw new Error('Format file tidak didukung. Gunakan JPG, PNG, atau WebP');
    }
    
    if (file.size > maxSize) {
        throw new Error('Ukuran file terlalu besar (maksimal 10MB)');
    }
    
    return true;
}

// Upload button click
uploadBtn.addEventListener('click', () => {
    if (!isAnalyzing) {
        fileInput.click();
    }
});

// Drag and drop dengan validasi
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!isAnalyzing) {
        uploadArea.classList.add('border-blue-400', 'bg-blue-50');
    }
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('border-blue-400', 'bg-blue-50');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('border-blue-400', 'bg-blue-50');
    
    if (isAnalyzing) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

// File input change
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0 && !isAnalyzing) {
        handleFile(e.target.files[0]);
    }
});

// Handle file selection dengan error handling yang lebih baik
async function handleFile(file) {
    try {
        // Validasi file
        validateFile(file);
        
        // Tampilkan loading sementara untuk kompresi
        showLoadingMessage('Memproses gambar...');
        
        // Kompres gambar untuk performa lebih baik
        const compressedImage = await compressImage(file);
        
        selectedImage = compressedImage;
        previewImg.src = selectedImage;
        imagePreview.classList.remove('hidden');
        hideError();
        hideLoadingMessage();
        
        console.log('Gambar berhasil diproses, ukuran:', Math.round(compressedImage.length / 1024), 'KB');
        
    } catch (err) {
        console.error('Error handling file:', err);
        showError(err.message);
        hideLoadingMessage();
    }
}

// Analyze button dengan retry logic dan timeout handling
analyzeBtn.addEventListener('click', async () => {
    if (!selectedImage) {
        showError('Pilih gambar terlebih dahulu');
        return;
    }
    
    if (isAnalyzing) {
        return; // Prevent multiple simultaneous requests
    }
    
    await performAnalysis();
});

// Fungsi analisis terpisah untuk retry
async function performAnalysis(retryCount = 0) {
    const maxRetries = 2;
    
    try {
        isAnalyzing = true;
        showLoadingMessage('Menganalisis gambar...');
        results.classList.add('hidden');
        hideError();
        analyzeBtn.disabled = true;
        
        // Buat controller untuk timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 detik timeout
        
        const response = await fetch('/analyze-product', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: selectedImage
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            displayResults(data.data);
            console.log('Analisis berhasil completed');
        } else {
            throw new Error(data.error || 'Analisis gagal');
        }
        
    } catch (err) {
        console.error('Analysis error:', err);
        
        if (err.name === 'AbortError') {
            showError('Analisis timeout. Coba lagi dengan gambar yang lebih kecil.');
        } else if (retryCount < maxRetries && !err.message.includes('timeout')) {
            // Retry otomatis untuk error tertentu
            console.log(`Retry attempt ${retryCount + 1}/${maxRetries}`);
            showLoadingMessage(`Mencoba lagi... (${retryCount + 1}/${maxRetries})`);
            setTimeout(() => performAnalysis(retryCount + 1), 2000);
            return;
        } else {
            showError('Gagal menganalisis gambar: ' + err.message);
        }
        
    } finally {
        if (retryCount === 0) { // Hanya reset jika bukan retry
            isAnalyzing = false;
            hideLoadingMessage();
            analyzeBtn.disabled = false;
        }
    }
}

// Toggle OCR content
toggleOcr.addEventListener('click', () => {
    const isHidden = ocrContent.classList.contains('hidden');
    if (isHidden) {
        ocrContent.classList.remove('hidden');
        ocrArrow.classList.add('rotate-180');
    } else {
        ocrContent.classList.add('hidden');
        ocrArrow.classList.remove('rotate-180');
    }
});

// Cancel button
cancelBtn.addEventListener('click', () => {
    if (!isAnalyzing) {
        selectedImage = null;
        imagePreview.classList.add('hidden');
        fileInput.value = '';
        results.classList.add('hidden');
        hideError();
    }
});

// Retry button
retryBtn.addEventListener('click', () => {
    hideError();
    if (selectedImage) {
        performAnalysis();
    }
});

// Guide modal
guideBtn.addEventListener('click', () => {
    guideModal.classList.remove('hidden');
});

closeGuide.addEventListener('click', () => {
    guideModal.classList.add('hidden');
});

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    if (e.target === guideModal) {
        guideModal.classList.add('hidden');
    }
});

// Demo buttons
    demoBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const exampleNum = e.target.closest('button').getAttribute('data-example');

            // Cari elemen <img> dalam card yang sama
            const card = e.target.closest('.card-hover');
            const img = card.querySelector('img');
            const imgUrl = img.getAttribute('src');

            // Ekstrak nama file dari URL
            const filename = imgUrl.split('/').pop();

            // Buat elemen <a> untuk download
            const link = document.createElement('a');
            link.href = imgUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    });

// Display results dengan formatting yang lebih baik
function displayResults(data) {
    try {
        const analysis = data.analysis;
        
        // Populate data dengan fallback values
        document.getElementById('product-name').textContent = analysis.product_name || 'Tidak ditemukan';
        document.getElementById('price-yen').textContent = analysis.price_yen || 'Tidak tersedia';
        document.getElementById('price-idr').textContent = analysis.price_idr || 'Tidak tersedia';
        
        // Halal status dengan color coding
        const halalStatusElement = document.getElementById('halal-status');
        const halalStatus = analysis.halal_status || 'Perlu dikonfirmasi';
        halalStatusElement.textContent = halalStatus;
        
        // Reset classes
        halalStatusElement.className = 'text-lg font-semibold mt-1';
        
        if (halalStatus.toLowerCase().includes('Halal') && !halalStatus.toLowerCase().includes('tidak')) {
            halalStatusElement.classList.add('text-green-600');
        } else if (halalStatus.toLowerCase().includes('tidak halal') || halalStatus.toLowerCase().includes('haram')) {
            halalStatusElement.classList.add('text-red-600');
        } else {
            halalStatusElement.classList.add('text-yellow-600');
        }
        
        // Contains pork status
        const containsPork = document.getElementById('contains-pork');
        const porkStatus = analysis.contains_pork;
        
        containsPork.className = 'text-lg font-semibold mt-1';
        
        if (porkStatus === true || porkStatus === 'true') {
            containsPork.textContent = 'Haram di Konsumsi ❌';
            containsPork.classList.add('text-red-600');
        } else if (porkStatus === false || porkStatus === 'false') {
            containsPork.textContent = 'Halal di Konsumsi ✅';
            containsPork.classList.add('text-green-600');
        } else {
            containsPork.textContent = 'Status Tidak Jelas ⚠️';
            containsPork.classList.add('text-yellow-600');
        }
        
        // Ingredients dengan formatting
        const ingredientsElement = document.getElementById('ingredients');
        const ingredients = analysis.ingredients || 'Tidak ditemukan';
        ingredientsElement.textContent = ingredients;
        
        // Pork analysis
        document.getElementById('pork-analysis').textContent = analysis.pork_analysis || 'Tidak ada analisis';
        
        // Additional info
        document.getElementById('additional-info').textContent = analysis.additional_info || 'Tidak ada informasi tambahan';
        
        // Source
        document.getElementById('source').textContent = analysis.source || 'lohaco.yahoo.co.jp';
        
        // OCR content
        document.getElementById('ocr-content').textContent = data.ocr_text || 'Tidak ada teks OCR';
        
        results.classList.remove('hidden');
        
        // Scroll ke hasil
        results.scrollIntoView({ behavior: 'smooth' });
        
    } catch (err) {
        console.error('Error displaying results:', err);
        showError('Gagal menampilkan hasil analisis');
    }
}

// Show error dengan styling yang lebih baik
function showError(message) {
    document.getElementById('error-message').textContent = message;
    error.classList.remove('hidden');
    
    // Auto hide error setelah 10 detik
    setTimeout(() => {
        if (!error.classList.contains('hidden')) {
            hideError();
        }
    }, 10000);
}

// Hide error
function hideError() {
    error.classList.add('hidden');
}

// Show loading message
function showLoadingMessage(message = 'Memproses...') {
    const loadingText = document.querySelector('#loading .text-lg');
    if (loadingText) {
        loadingText.textContent = message;
    }
    loading.classList.remove('hidden');
}

// Hide loading message
function hideLoadingMessage() {
    loading.classList.add('hidden');
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'v') {
            // Paste from clipboard (if supported)
            navigator.clipboard.read().then(items => {
                for (const item of items) {
                    if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
                        item.getType('image/png').then(blob => {
                            handleFile(blob);
                        });
                        break;
                    }
                }
            }).catch(() => {
                // Clipboard API not supported or no image
            });
        }
    }
});

// Check server status on load
window.addEventListener('load', async () => {
    try {
        const response = await fetch('/test');
        const data = await response.json();
        console.log('Server status:', data);
    } catch (err) {
        console.warn('Server health check failed:', err);
        showError('Koneksi ke server bermasalah. Refresh halaman dan coba lagi.');
    }
});
