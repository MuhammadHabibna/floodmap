# BUILD BRIEF — Flood Decision Support System (DSS) Dashboard

> **Untuk: AI Agent pembangun dashboard.**
> **Proyek:** DOLANAN DATA NEXUS 2026 — Sistem Pendukung Keputusan Prioritas Penanganan Banjir berbasis segmentasi citra udara/drone (model SegFormer-B4, 10 kelas).
> **Tujuan dokumen:** Spesifikasi lengkap & deterministik agar agent dapat membangun dashboard tanpa menebak. Gunakan HANYA resource yang tersedia (didefinisikan di Bagian 3). Jangan mengarang data lapangan baru.

---

## 1. Ringkasan Produk

Dashboard web **single-page** yang mengubah output model segmentasi banjir menjadi **peta prioritas wilayah** + **rekomendasi aksi**. Bukan sekadar visualisasi model — ini alat bantu keputusan untuk BNPB/BPBD/Basarnas: "wilayah mana yang harus diprioritaskan saat banjir?".

**Alur inti:**
```
submission.csv (prediksi RLE 10 kelas / 447 citra)
  -> decode RLE -> hitung luas piksel per kelas per citra
  -> hitung 3 indikator per citra (Inundation, InfraDamage, AccessLoss)
  -> skor FSPI per citra -> agregasi ke unit wilayah (dummy kecamatan/desa)
  -> data ringkas (regions.json + ranking.json) -> render peta + feed keputusan
```

**Prinsip desain:** Formal, otoritatif, data-forward, "calm under crisis". Tema: **Govtech Crisis Command Center**.

---

## 2. Tech Stack (wajib)

| Lapisan | Pilihan | Catatan |
|---|---|---|
| Framework | **Next.js (App Router) + React + TypeScript** | |
| Styling | **Tailwind CSS** | pakai design tokens di Bagian 6 |
| Peta | **Mapbox GL JS** (atau MapLibre GL bila tanpa token) | choropleth + layer toggle |
| Chart | **Recharts** (atau ECharts) | render dari training_history.json |
| Ikon | **lucide-react** | gaya garis, formal |
| Deploy | **Vercel** (statis) | TANPA GPU/back-end saat demo |

**Batasan penting:** Semua data sudah PRE-COMPUTED jadi file statis. Dashboard TIDAK menjalankan model di browser. `best_model.pth` tidak pernah dimuat klien.

---

## 3. Resource Data — Dari Mana & Bentuknya

Semua artefak ini adalah output pipeline training/inferensi yang sudah dimiliki tim. Agent menerimanya di folder `/public/data/raw/`.

| # | File | Ukuran | Asal | Dipakai untuk |
|---|---|---|---|---|
| 1 | `submission.csv` | ~14.8 MB | Output inferensi (Cell 22-24 notebook) | **SUMBER UTAMA** peta FSPI, KPI, distribusi kelas test |
| 2 | `training_history.json` | kecil | Output training loop (Cell 7) | Chart performa model (Loss/mIoU/mDice per epoch) |
| 3 | `per_class_iou.png` | gambar | Output evaluasi (Cell 9) | Fallback gambar; idealnya render ulang dari nilai IoU |
| 4 | `training_curves.png` | gambar | Output (Cell 8) | Fallback gambar kurva |
| 5 | `best_model.pth` | ~230 MB | Checkpoint terbaik | TIDAK dimuat di web; hanya disebut di teks (arsitektur) |
| 6 | `eda/*.json` atau `eda/*.png` | — | Notebook EDA (terpisah) | Section Data Understanding |
| 7 | `ColorPalette-Values.xlsx` | kecil | Panitia | Warna overlay 10 kelas (lihat 6.B) |

### 3.1 Format `submission.csv`
- Kolom: `id`, `encoded_pixels`.
- 4470 baris = **447 citra × 10 kelas**. `id` berformat `<image_id>_<class_id>`, mis. `10163_0` (class 0 = background) s/d `10163_9`.
- `encoded_pixels` = RLE **column-major (order='F')** atas mask berukuran **480 (tinggi) × 640 (lebar)**. Kosong/NaN = kelas tidak ada di citra itu.
- Indeks kelas: `0 background, 1 building_flooded, 2 building_non_flooded, 3 grass, 4 pool, 5 road_flooded, 6 road_non_flooded, 7 tree, 8 vehicle, 9 water`.
- Catatan: background (class 0) hampir selalu kosong (by design model) — abaikan untuk indikator.

### 3.2 Format `training_history.json`
Objek dengan array sejajar per epoch:
```json
{
  "train_loss": [...], "val_loss": [...],
  "train_miou": [...], "val_miou": [...],
  "train_mdice": [...], "val_mdice": [...]
}
```
Render 3 line chart: Loss, mIoU, mDice (train vs val) dengan sumbu-x = epoch (index+1).

---

## 4. Pipeline Pra-pemrosesan (script Node/Python di build-time)

Agent harus membuat script `scripts/preprocess.(ts|py)` yang menghasilkan file ringkas di `/public/data/derived/`. Frontend HANYA membaca file derived (jangan parse CSV 14.8 MB di browser).

### 4.1 Decode RLE -> luas piksel per kelas per citra
```
fungsi rle_decode(rle_str, H=480, W=640):
    jika kosong/NaN -> return mask nol
    angka = parse int list dari rle_str
    pasangan (start, length); start berbasis-1 pada array flatten order='F'
    set piksel -> 1; reshape (H, W) order='F'
luas_kelas[c] = jumlah piksel kelas c (cukup hitung total run-length, tak perlu reshape untuk luas)
```
Untuk indikator, cukup **jumlah piksel per kelas** = total panjang run pada baris `<img>_<c>`. Total piksel per citra = 480*640 = 307200.

### 4.2 Tiga indikator per citra (nilai 0..1)
```
INUNDATION  = (px[water] + px[road_flooded] + px[building_flooded]) / 307200
INFRA_DMG   = px[building_flooded] / max(px[building_flooded] + px[building_non_flooded], 1)
ACCESS_LOSS = px[road_flooded]     / max(px[road_flooded]     + px[road_non_flooded], 1)
```

### 4.3 Skor FSPI per citra (0..100)
```
FSPI_raw = w1*INUNDATION + w2*INFRA_DMG + w3*ACCESS_LOSS
bobot default: w1=0.40, w2=0.30, w3=0.30   (HARUS bisa diubah via slider What-if)
FSPI = round(FSPI_raw * 100, 1)
status:
    FSPI >= 60 -> "KRITIS"
    40..59.9   -> "TINGGI"
    20..39.9   -> "SEDANG"
    < 20       -> "RENDAH"
```

### 4.4 Agregasi ke unit wilayah (DEMO)
Test set tidak punya koordinat asli. Untuk demo yang jujur:
- Buat **mapping dummy** `image_id -> region_id` (mis. bagi 447 citra ke ~12-20 "kecamatan" fiktif bernama realistis untuk konteks Sumatra/!! beri label jelas "data wilayah ilustratif").
- Sediakan `regions.geojson` (boundary dummy/sample admin Indonesia dari GADM/level kecamatan; jika tak ada, pakai grid poligon sederhana sebagai placeholder).
- FSPI region = rata-rata FSPI citra anggotanya; indikator region = rata-rata indikator anggotanya.
- **WAJIB beri disclaimer di UI**: "Pemetaan wilayah bersifat ilustratif; pada produksi memakai citra ber-geotag nyata."

### 4.5 Output file derived (KONTRAK DATA)
**`/public/data/derived/regions.json`**
```json
[
  {
    "region_id": "kec-01",
    "name": "Kecamatan A",
    "fspi": 72.4,
    "status": "KRITIS",
    "indicators": { "inundation": 0.61, "infra_damage": 0.65, "access_loss": 0.78 },
    "n_images": 23,
    "recommendation": "Akses 78% terputus -> prioritaskan evakuasi jalur air."
  }
]
```
**`/public/data/derived/ranking.json`** = array region terurut `fspi` desc (untuk Decision Feed).
**`/public/data/derived/kpi.json`**
```json
{
  "total_regions": 16,
  "critical_regions": 4,
  "avg_inundation_pct": 23.7,
  "est_buildings_flooded_px": 1234567,
  "roads_cut_regions": 6
}
```
**`/public/data/derived/class_distribution_test.json`** = total piksel per kelas di seluruh test (untuk EDA "distribusi kelas di test").
**`/public/data/derived/regions.geojson`** = boundary + properti `region_id`, `fspi`, `status`.

### 4.6 Rekomendasi otomatis (rule-based)
```
jika access_loss >= 0.6 -> "Akses {round(access_loss*100)}% terputus -> prioritaskan evakuasi jalur air/udara."
jika infra_damage >= 0.5 -> "Kerusakan bangunan tinggi -> dahulukan tim SAR & shelter darurat."
jika inundation >= 0.5 -> "Genangan luas -> kirim logistik perahu & pompa."
gabungkan kalimat yang aktif; jika tidak ada -> "Pantau berkala."
```

---

## 5. Struktur Halaman (Sitemap)

Single-page, navigasi anchor di header. Urutan section dari atas:

```
HEADER  (logo, judul, toggle Light/Dark, nav anchor)
+-- (A) KPI STRIP            <- kpi.json
+-- (B) PETA PRIORITAS FSPI  <- regions.geojson + regions.json   [JANTUNG]
|     side-panel klik wilayah <- regions.json + recommendation
+-- (C) DECISION FEED        <- ranking.json   [Actionability]
+-- (D) BUKTI VISUAL         <- contoh citra + overlay mask (palet 6.B)
+-- (E) PERFORMA MODEL       <- training_history.json + per_class IoU
+-- (F) DATA UNDERSTANDING   <- class_distribution_test.json + EDA assets
+-- FOOTER (disclaimer ilustratif + kredit + arsitektur model)
```

---

## 6. Design System

### 6.A Tema
- **Default: Dark theme** (command-center). Sediakan **Light variant** (toggle) untuk versi cetak/laporan.
- Sudut kartu: radius 12px. Bayangan halus. Garis tipis 1px `border`.
- Animasi minimal (fade/slide 150-200ms). Tidak ada efek norak.

### 6.B Token Warna

**UI Chrome — Dark:**
```
bg-base      #0B1220
bg-surface   #141E33
bg-elevated  #1C2942
border       #2A3850
text-primary #E8EEF7
text-secondary #94A3B8
brand        #1F6FEB
brand-accent #2DBFD6
```
**UI Chrome — Light:**
```
bg-base #F5F8FC | bg-surface #FFFFFF | bg-elevated #EAF2FB
border #CBD6E2 | text-primary #0B1220 | text-secondary #5B6B7B
brand #1F6FEB | brand-accent #2DBFD6
```
**Status FSPI (escalation ramp) — konsisten di seluruh app:**
```
RENDAH  #2ECC71   SEDANG #F1C40F   TINGGI #E67E22   KRITIS #C0392B
```
**Overlay segmentasi 10 kelas (palet resmi dataset — JANGAN diubah):**
```
background #000000 | building_flooded #FF0000 | building_non_flooded #B47878
road_flooded #A09614 | road_non_flooded #8C8C8C | water #3DE6FA
tree #0052FF | vehicle #FF00F5 | pool #FFEB00 | grass #04FA07
```
> ATURAN: warna status (hijau->merah) hanya untuk keputusan/FSPI; warna kelas hanya untuk overlay teknis di section Bukti Visual. Jangan dicampur.

### 6.C Tipografi
```
Heading : "Plus Jakarta Sans" (700/600)
Body    : "Inter" (400/500)
Angka   : tabular-nums (Inter) atau "IBM Plex Mono"
Skala   : H1 32 / H2 22 / section 16 / body 14 / caption 12 (px)
```

---

## 7. Spesifikasi Komponen (per section)

### (A) KPI Strip
- 5 kartu sejajar (grid responsif). Tiap kartu: label kecil (text-secondary) + angka besar (tabular-nums) + ikon lucide.
- Kartu "Wilayah KRITIS" memakai warna status KRITIS pada angka.
- Sumber: `kpi.json`.

### (B) Peta Prioritas (jantung)
- Mapbox GL, basemap gelap. Layer fill choropleth dari `regions.geojson`, warna = status FSPI (data-driven `fill-color` by `status`).
- Kontrol: toggle layer **Genangan / Kerusakan Infrastruktur / Akses Jalan** (ganti metrik pewarnaan).
- **Slider What-if**: ubah bobot w1/w2/w3 -> hitung ulang FSPI region di klien (dari indikator yang sudah ada di regions.json) -> warna & ranking update real-time.
- Klik region -> side-panel: nama, FSPI, 3 indikator (bar mini), rekomendasi, jumlah citra.
- Legend status selalu tampil.

### (C) Decision Feed (Actionability — bobot nilai tertinggi)
- Tabel/daftar kartu dari `ranking.json`, urut FSPI desc.
- Tiap baris: nama wilayah, badge status (warna ramp), skor FSPI, rekomendasi ringkas.
- Tombol **"Export Laporan PDF"** (boleh client-side print-to-PDF) berisi ranking + rekomendasi.

### (D) Bukti Visual (Defensibility QnA)
- Komponen before/after slider: **citra asli** vs **overlay mask 10 kelas** (palet 6.B), opacity slider.
- Sediakan 4-6 contoh citra (pilih yang FSPI tinggi & rendah).
- Legend kelas (chip warna + nama).

### (E) Performa Model
- 3 line chart (Recharts) dari `training_history.json`: Loss, mIoU, mDice (train vs val), hover tooltip nilai/epoch.
- Bar chart per-class IoU. **Anotasi otomatis**: kelas IoU terendah (mis. tree, vehicle) diberi catatan "objek kecil & langka -> lebih sulit" -> bahan jawaban QnA.
- Kartu metrik: Best Val mIoU, mDice akhir.
- Jika nilai IoU per kelas tak tersedia numerik, tampilkan `per_class_iou.png` sebagai fallback.

### (F) Data Understanding (EDA)
- Donut/bar **distribusi kelas test** dari `class_distribution_test.json`.
- Bar **long-tail train** (gunakan angka EDA: water 56.41%, road_non_flooded 17.46%, road_flooded 10.94%, pool 5.52%, building_non_flooded 3.25%, grass 2.75%, background 1.72%, building_flooded 1.56%, vehicle 0.20%, tree 0.18%).
- (Opsional) co-occurrence heatmap & histogram distribution-shift train/val/test bila aset EDA tersedia.
- Narasi singkat: jelaskan imbalance -> motivasi class weighting & loss; jelaskan gap Val~0.64 vs Public~0.47 sebagai generalization gap.

### Footer
- Disclaimer: "Pemetaan wilayah bersifat ilustratif untuk demonstrasi; produksi memakai citra ber-geotag nyata."
- Kredit tim + arsitektur model: "SegFormer-B4 (nvidia/mit-b4), Triple Loss (CE+Lovasz+Focal), input 480x640, 4x TTA."

---

## 8. Struktur Folder yang Diharapkan
```
/app
  /page.tsx                (single page; rakit semua section)
  /components
    KpiStrip.tsx
    PriorityMap.tsx
    WhatIfControls.tsx
    DecisionFeed.tsx
    EvidenceSlider.tsx
    ModelPerformance.tsx
    EdaSection.tsx
    ThemeToggle.tsx
  /lib/fspi.ts             (hitung ulang FSPI dari bobot di klien)
/scripts/preprocess.ts     (CSV -> derived JSON/GeoJSON)
/public/data/raw/          (submission.csv, training_history.json, *.png, eda/)
/public/data/derived/      (regions.json, ranking.json, kpi.json, class_distribution_test.json, regions.geojson)
/styles/tokens.css         (design tokens 6.B)
```

---

## 9. Kriteria Penerimaan (Definition of Done)
1. `npm run build` sukses; halaman render tanpa error di Vercel.
2. Semua angka berasal dari file derived (bukan hard-code), kecuali angka EDA train yang memang statis (7.F).
3. Peta mewarnai wilayah sesuai status FSPI; klik wilayah menampilkan detail + rekomendasi.
4. Slider What-if mengubah warna peta & urutan Decision Feed secara real-time.
5. Chart performa terbaca dari `training_history.json`.
6. Toggle Light/Dark berfungsi; tipografi & token warna sesuai Bagian 6.
7. Disclaimer ilustratif tampil. `best_model.pth` tidak pernah dimuat ke klien.
8. Responsif (desktop utama; layar kecil tetap terbaca).

---

## 10. Catatan untuk Agent
- Jika `regions.geojson` admin asli tak tersedia offline, buat grid poligon sederhana sebagai placeholder DAN beri disclaimer.
- Jangan menambah klaim/statistik bencana baru di UI selain yang ada di brief; jaga kejujuran data.
- Prioritaskan kejelasan Decision Feed (Actionability) dan Bukti Visual (Defensibility) — keduanya bernilai tertinggi pada penjurian.
- Semua teks UI dalam Bahasa Indonesia formal.
