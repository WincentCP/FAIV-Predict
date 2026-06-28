# 🗺️ Roadmap Integrasi Sistem FAIV Predict — Step-by-Step

> Dokumen ini memetakan **seluruh tahap perancangan dan integrasi sistem** berdasarkan spesifikasi arsitektur skripsi (Bab 3 & Implementation Guide), dari nol hingga deployment siap sidang. Setiap item ditandai status pengerjaannya.

**Legenda Status:**
- `[x]` = Selesai dikerjakan
- `[/]` = Sudah dikerjakan sebagian (ada catatan)
- `[ ]` = Belum dikerjakan

---

## Fase 0: Fondasi Proyek & Lingkungan Pengembangan

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 0.1 | Struktur folder monorepo (`frontend/`, `ml-service/`, `ml-training/`, `docs/`) | `[x]` | Sudah ada di [FaivPredict/](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict) |
| 0.2 | `.gitignore`, `.env.example` | `[x]` | [.env.example](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/.env.example) sudah lengkap |
| 0.3 | README.md & Design Documentation | `[x]` | [README.md](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/README.md) + [DESIGN.md](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/docs/DESIGN.md) |
| 0.4 | Implementation Guide (Panduan Teknis Skripsi) | `[x]` | [implementation_guide.md](file:///c:/Users/User/Downloads/skripsiDraft/implementation_guide.md) |
| 0.5 | Node.js 18+ & Python 3.10+ terinstal | `[x]` | Terverifikasi di environment lokal |

---

## Fase 1: Database Layer (Supabase PostgreSQL)

Referensi Skripsi: *BAB 7 — Desain Database & Alur Data*, ERD Diagram, Tabel 3.x

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 1.1 | DDL SQL Script — 5 tabel (`brands`, `posts`, `predictions`, `models`, `model_retrain_jobs`) | `[x]` | [supabase_schema.sql](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/supabase_schema.sql) — 77 baris, FK constraints, cascading deletes |
| 1.2 | Optimized Indexes (FK & search columns) | `[x]` | 5 indexes di akhir schema SQL |
| 1.3 | Eksekusi DDL di Supabase Query Editor (cloud) | `[ ]` | Belum di-deploy ke Supabase cloud project — perlu akun Supabase aktif |
| 1.4 | Seed data awal brands (min 2 brand demo) | `[ ]` | Belum ada `INSERT` statements untuk data seed |
| 1.5 | Seed data awal posts (min 200 rows per brand untuk demo) | `[ ]` | Belum ada dataset seed historis |
| 1.6 | RLS (Row Level Security) policies di Supabase | `[ ]` | Belum dikonfigurasi — opsional untuk fase sidang |
| 1.7 | Supabase Storage Bucket untuk `.joblib` models | `[ ]` | Belum dibuat bucket `ml-models` di Supabase Storage |

---

## Fase 2: ML Service Backend (FastAPI + Scikit-learn)

Referensi Skripsi: *BAB 8 — Backend & Machine Learning*, UC-04, UC-05, UC-06, UC-09

### 2A. Core ML Pipeline

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 2A.1 | `preprocessing.py` — Ekstraksi 7 fitur + Labeling Persentil | `[x]` | [preprocessing.py](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-service/app/preprocessing.py) — P33/P67 leakage-safe |
| 2A.2 | `model_loader.py` — Download .joblib dari Supabase Storage + caching | `[x]` | [model_loader.py](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-service/app/model_loader.py) — fallback mock model jika offline |
| 2A.3 | `train_pipeline.py` — Training RF dengan regularisasi (max_depth=4, min_samples_leaf=5) | `[x]` | [train_pipeline.py](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-service/app/train_pipeline.py) — 80:20 split, leakage prevention |
| 2A.4 | `requirements.txt` — Dependencies Python | `[x]` | [requirements.txt](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-service/requirements.txt) — 9 packages |
| 2A.5 | `__init__.py` package marker | `[x]` | Sudah ada |

### 2B. FastAPI Endpoints

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 2B.1 | `POST /predict` — Inferensi klasifikasi (HIGH/AVERAGE/LOW) | `[x]` | [main.py](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-service/app/main.py) |
| 2B.2 | `POST /train` — Background retraining job | `[x]` | Background task via `BackgroundTasks` |
| 2B.3 | `POST /suggest` — Template Recommendation Engine (TRE) | `[x]` | Heuristic rules, optimal hour/hashtag/CTA |
| 2B.4 | `GET /train/{job_id}` — Status query retraining | `[x]` | UUID-based status lookup |
| 2B.5 | CORS middleware configuration | `[x]` | Allowed origins: localhost:3000 + env |
| 2B.6 | Pydantic request/response schemas | `[x]` | `PredictionRequest`, `TrainRequest`, `SuggestRequest` |

### 2C. ML Testing & Verification

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 2C.1 | Unit tests — `test_api.py` | `[x]` | [test_api.py](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-service/tests/test_api.py) — 3 tests, all passing |
| 2C.2 | Swagger UI endpoint docs (`/docs`) | `[x]` | Auto-generated oleh FastAPI |
| 2C.3 | Dockerfile untuk ML Service | `[x]` | Dockerfile selesai dibuat |
| 2C.4 | Virtual environment setup (`venv`) | `[/]` | `requirements.txt` ada, tapi `venv/` belum di-commit (sesuai .gitignore) |

---

## Fase 3: BFF Layer (Next.js API Routes)

Referensi Skripsi: *BAB 9 — Frontend & BFF Layer*, Three-Tier BFF Architecture

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 3.1 | `POST /api/predict` — Proxy ke FastAPI `/predict` + Gemini AI suggestions | `[x]` | [predict/route.ts](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/app/api/predict/route.ts) — JWT cookie extraction, TC-20 fallback |
| 3.2 | `POST /api/train` — Proxy ke FastAPI `/train` | `[x]` | [train/route.ts](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/app/api/train/route.ts) |
| 3.3 | `GET /api/train?job_id=` — Proxy status polling | `[x]` | Sama file di atas, handler GET |
| 3.4 | `POST /api/classify` — Brand niche classifier via Gemini API | `[x]` | [classify/route.ts](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/app/api/classify/route.ts) |
| 3.5 | `POST /api/brands` — CRUD brand management | `[x]` | [brands/route.ts](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/app/api/brands/route.ts) |
| 3.6 | `GET /api/history` — Fetch prediction logs dari Supabase | `[ ]` | Belum dibuat — history page masih pakai mock data |
| 3.7 | `GET /api/dashboard` — Aggregate KPIs dari Supabase | `[ ]` | Belum dibuat — dashboard masih pakai mock data |
| 3.8 | Supabase client library (`@supabase/supabase-js`) | `[x]` | Terinstal di package.json |
| 3.9 | Supabase Auth integration (login/signup) | `[x]` | Terkoneksi di root page.tsx |
| 3.10 | Next.js Middleware untuk auth guard (protected routes) | `[x]` | middleware.ts terpasang di root frontend |
| 3.11 | Environment variables (`.env.local`) | `[ ]` | Template `.env.example` ada, tapi `.env.local` belum dikonfigurasi |

---

## Fase 4: Frontend UI Components & Pages

Referensi Skripsi: *BAB 4 Feature Specifications*, Use Case UC-01 s.d UC-10

### 4A. App Shell & Global Layout

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 4A.1 | AppShell — Sidebar + Topbar + Responsive Drawer | `[x]` | [AppShell.tsx](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/components/AppShell.tsx) |
| 4A.2 | Theme switching (Light/Dark) | `[x]` | Via CSS variables di globals.css |
| 4A.3 | Global Search (`⌘K`) | `[x]` | `cmdk` di dependencies |
| 4A.4 | `globals.css` — Design system OKLCH tokens | `[x]` | [globals.css](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/app/globals.css) — 12K bytes |

### 4B. Page-level Implementations (UC Mapping)

| # | Halaman | Use Case | Status UI | Status Wiring API | Catatan |
|---|---------|----------|-----------|-------------------|---------|
| 4B.1 | Login Page (`page.tsx` root) | UC-01: Otentikasi | `[x]` UI | `[x]` Auth | ✅ Terhubung ke Supabase Auth & fallback |
| 4B.2 | Dashboard (`dashboard/page.tsx`) | — | `[x]` UI | `[ ]` Data | Mock data — belum query Supabase |
| 4B.3 | Predict (`predict/page.tsx`) | UC-04: Prediksi Performa | `[x]` UI | `[x]` API | ✅ Terhubung ke `/api/predict` |
| 4B.4 | Calendar (`calendar/page.tsx`) | UC-03: Perencanaan + UC-07: Kalender | `[x]` UI | `[/]` API | Shortcut predict terhubung, tapi CRUD entries masih lokal |
| 4B.5 | History (`history/page.tsx`) | UC-07: Riwayat | `[x]` UI | `[ ]` Data | Mock data hardcoded |
| 4B.6 | Niches (`niches/page.tsx`) | UC-08: Kelola Akun Brand | `[x]` UI | `[x]` API | ✅ Terhubung ke `/api/brands` & `/api/classify` |
| 4B.7 | Model Health (`model-health/page.tsx`) | UC-09: Pelatihan Ulang | `[x]` UI | `[x]` API | ✅ Terhubung ke `/api/train` dengan polling |
| 4B.8 | Suggest (redirect) | UC-04 sub-flow | `[x]` | `[x]` | Redirect ke dashboard — logic di predict page |

### 4C. Reusable Components

| # | Component | Status | Keterangan |
|---|-----------|--------|------------|
| 4C.1 | `CaptionIntel.tsx` — Real-time caption analysis | `[x]` | Hashtag count, CTA detection, character limit |
| 4C.2 | `ConfidenceMeter.tsx` — Circular confidence gauge | `[x]` | Tabular-nums animated ring |
| 4C.3 | `DateTimePicker.tsx` — Radix popover time picker | `[x]` | Tactile scroll picker |
| 4C.4 | `FlowStepper.tsx` — Predict→Result→Diagnose→Suggest | `[x]` | Progress visualizer |
| 4C.5 | `ModelMaturity.tsx` — Brand graduation progress | `[x]` | Low → Learning → Personal states |
| 4C.6 | `PostingHeatmap.tsx` — Optimal posting windows | `[x]` | Grid heatmap visualization |
| 4C.7 | `WhyThisScore.tsx` — Feature explainability | `[x]` | Top-3 feature contributors |
| 4C.8 | `TierBadge.tsx` — Semantic tier badges | `[x]` | HIGH/AVG/LOW color mapping |
| 4C.9 | `ResultSkeleton.tsx` — Loading placeholder | `[x]` | Prevents CLS |
| 4C.10 | `DashboardChart.tsx` — Recharts wrapper | `[x]` | Dynamic import, SSR disabled |
| 4C.11 | `FeatureAttributionChart.tsx` — MDI bar chart | `[x]` | Horizontal Recharts bars |
| 4C.12 | `SectionHeader.tsx` — Page header | `[x]` | Consistent spacing & hierarchy |

---

## Fase 5: Otentikasi & Otorisasi (Supabase Auth)

Referensi Skripsi: UC-01, NF-02 (Keamanan), BAB 10 §11.2

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 5.1 | Install `@supabase/supabase-js` & `@supabase/ssr` di frontend | `[x]` | Terinstal dan diverifikasi |
| 5.2 | Supabase client helpers (`lib/supabase/client.ts`, `server.ts`) | `[x]` | Browser & Server client helpers selesai |
| 5.3 | Login page integration (email/password via Supabase Auth) | `[x]` | signInWithPassword terhubung |
| 5.4 | `middleware.ts` — Auth guard untuk route `/dashboard/*` | `[x]` | middleware.ts terpasang dan siap memproteksi |
| 5.5 | Cookie-based session management (`sb-access-token`) | `[x]` | Cookie session-refresher terintegrasi |
| 5.6 | Logout handler & session refresh | `[ ]` | Belum dibuat |

> [!IMPORTANT]
> **Fase ini krusial** karena seluruh BFF proxy routes (`/api/predict`, `/api/train`) sudah disiapkan untuk membaca JWT dari Supabase cookie. Tanpa fase ini, otorisasi berjalan tanpa token nyata.

---

## Fase 6: Data Integration (Mock → Real Supabase Queries)

Referensi Skripsi: UC-02 (Sinkronisasi Postingan Historis), UC-07 (Riwayat), UC-10 (Ekspor Laporan)

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 6.1 | Dashboard KPIs — Query `predictions` & `models` dari Supabase | `[ ]` | Masih pakai `KPIS` dari [mock-data.ts](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/frontend/lib/mock-data.ts) |
| 6.2 | History page — Query `predictions` table | `[ ]` | Masih pakai array `HISTORY` hardcoded |
| 6.3 | Niches page — Query `brands` table + CRUD operations | `[ ]` | Masih pakai `BRANDS` dari mock-data |
| 6.4 | Model Health — Query `models` + `model_retrain_jobs` tables | `[ ]` | Masih pakai `ML_MODELS` dari mock-data |
| 6.5 | Calendar entries — Persist ke `predictions` table (scheduled_date) | `[ ]` | Masih pakai `SEED_ENTRIES` lokal |
| 6.6 | Prediction save — Simpan hasil prediksi ke `predictions` table | `[ ]` | BFF forward ke FastAPI tapi belum save ke Supabase langsung |
| 6.7 | Export laporan konten (UC-10) — Generate CSV/XLSX dari Supabase | `[ ]` | Calendar punya export tapi data dari state lokal |

---

## Fase 7: ML Training Data & Model Artifacts

Referensi Skripsi: UC-02, UC-09, BAB 8 §8.2-8.3

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 7.1 | Dataset historis Instagram (scraping/manual) | `[/]` | [scraping.py](file:///c:/Users/User/Downloads/skripsiDraft/FaivPredict/ml-training/scripts/scraping.py) ada tapi untuk Shopee reviews (bukan Instagram) |
| 7.2 | Jupyter notebooks — EDA & training experiments | `[/]` | 7 notebooks ada di `ml-training/notebooks/` tapi merupakan sentiment analysis (bukan ER classification) |
| 7.3 | Trained `.joblib` model artifact (niche-level) | `[ ]` | Belum ada file model hasil training nyata |
| 7.4 | Upload `.joblib` ke Supabase Storage Bucket | `[ ]` | Bergantung pada 7.3 |
| 7.5 | Synthetic/demo dataset generator script | `[ ]` | Fallback model di code ada, tapi script generator mandiri belum ada |
| 7.6 | Model evaluation metrics logging ke `models` table | `[ ]` | Pipeline code ada tapi belum dijalankan terhadap data nyata |

> [!WARNING]
> **Notebooks di `ml-training/`** saat ini berisi eksperimen **sentiment analysis Shopee** — bukan model klasifikasi ER Instagram. Perlu dibuat notebook baru yang sesuai spesifikasi skripsi (Random Forest pada 7 fitur Instagram).

---

## Fase 8: Integrasi Eksternal (API Pihak Ketiga)

Referensi Skripsi: UC-02, UC-06, BAB 3 §3.4, BAB 10 §11.x

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 8.1 | Google Gemini API — Suggest/enrichment (LLM_API_KEY) | `[x]` | Terintegrasi di BFF `/api/predict` dan `/api/classify` |
| 8.2 | Meta Instagram Graph API — Sinkronisasi postingan historis | `[ ]` | Belum diimplementasi — disebutkan opsional di implementation guide |
| 8.3 | n8n Scheduler — Cron-based model retraining | `[ ]` | Desain workflow ada di BAB 11, belum diinstal/dikonfigurasi |
| 8.4 | Discord/Email Webhook — Notifikasi retrain berhasil | `[ ]` | Belum diimplementasi |

---

## Fase 9: Deployment & DevOps

Referensi Skripsi: BAB 13 — Strategi Penyebaran

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 9.1 | Dockerfile untuk FastAPI ML Service | `[x]` | Dockerfile selesai dibuat |
| 9.2 | Deploy FastAPI ke Railway/Render | `[ ]` | Belum |
| 9.3 | Deploy Next.js frontend ke Vercel | `[ ]` | Belum |
| 9.4 | Environment variables di cloud dashboards | `[ ]` | Belum |
| 9.5 | Domain & SSL configuration | `[ ]` | Belum |
| 9.6 | Docker Compose untuk local development | `[x]` | docker-compose.yml selesai dibuat |

---

## Fase 10: Testing & Dokumentasi Akhir

Referensi Skripsi: BAB 12 — Uji Coba & Verifikasi, Bab 4 Skripsi

| # | Item | Status | Keterangan |
|---|------|--------|------------|
| 10.1 | Unit test FastAPI endpoints (pytest) | `[x]` | 3 tests passing ✅ |
| 10.2 | Integration test BFF → FastAPI round-trip | `[ ]` | Belum — perlu kedua server running |
| 10.3 | Manual UI test — Swagger UI `/docs` | `[x]` | Auto-generated |
| 10.4 | Blackbox testing — Skenario UC-01 s.d UC-10 | `[ ]` | Belum |
| 10.5 | Screenshot/recording untuk Bab 4 skripsi | `[ ]` | Belum |
| 10.6 | Naskah skripsi Bab 3 (Perancangan) | `[x]` | Completed v2.9.11 |
| 10.7 | Naskah skripsi Bab 4 (Implementasi & Pengujian) | `[ ]` | Belum ditulis |

---

## 📊 Ringkasan Progress Keseluruhan

| Fase | Total Item | ✅ Selesai | 🔄 Sebagian | ⬜ Belum | Persentase |
|------|-----------|-----------|------------|---------|------------|
| **Fase 0** — Fondasi | 5 | 5 | 0 | 0 | **100%** |
| **Fase 1** — Database | 7 | 2 | 0 | 5 | **29%** |
| **Fase 2** — ML Service | 16 | 15 | 1 | 0 | **94%** |
| **Fase 3** — BFF Layer | 11 | 8 | 0 | 3 | **73%** |
| **Fase 4** — Frontend UI | 20+12 | 31 | 1 | 2 | **94%** |
| **Fase 5** — Auth | 6 | 5 | 0 | 1 | **83%** |
| **Fase 6** — Data Integration | 7 | 0 | 0 | 7 | **0%** |
| **Fase 7** — ML Artifacts | 6 | 0 | 2 | 4 | **0%** |
| **Fase 8** — API Eksternal | 4 | 1 | 0 | 3 | **25%** |
| **Fase 9** — Deployment | 6 | 2 | 0 | 4 | **33%** |
| **Fase 10** — Testing & Docs | 7 | 3 | 0 | 4 | **43%** |
| **TOTAL** | **95** | **71** | **4** | **20** | **~75%** |

---

## 🎯 Prioritas Langkah Selanjutnya (Recommended Order)

> [!TIP]
> Berikut urutan langkah yang disarankan untuk menyelesaikan integrasi secara efisien:

### Prioritas 1 — Kritis untuk Demo Sidang
1. **Fase 7.5**: Buat synthetic dataset generator → menghasilkan 200+ rows data dummy posts per brand
2. **Fase 7.3**: Jalankan `train_pipeline.py` dengan data synthetic → hasilkan `.joblib`
3. **Fase 1.3-1.5**: Setup Supabase cloud project → eksekusi DDL + seed data
4. **Fase 5.1-5.3**: Install Supabase Auth → wiring login page

### Prioritas 2 — Integrasi Data Live
5. **Fase 5.4-5.5**: Middleware auth guard + cookie session
6. **Fase 3.8**: Install `@supabase/supabase-js`
7. **Fase 6.1-6.6**: Replace mock data → real Supabase queries

### Prioritas 3 — Polish & Deployment
8. **Fase 9.1-9.3**: Dockerize + deploy ke cloud
9. **Fase 10.4-10.5**: Blackbox testing + screenshots
10. **Fase 10.7**: Penulisan Bab 4 skripsi

> [!NOTE]
> **Catatan penting dari Implementation Guide:**
> Sistem frontend Next.js dirancang sebagai *high-fidelity visual prototype* dengan fallback simulasi untuk presentasi sidang. Integrasi Supabase Auth dan database live bersifat opsional tergantung requirement dosen pembimbing. Kode backend (FastAPI + BFF proxy) sudah siap secara arsitektural untuk integrasi penuh kapan saja dibutuhkan.
