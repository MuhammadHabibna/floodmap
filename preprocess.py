"""
Preprocessing Script: submission.csv -> derived JSON files for dashboard
Generates: regions.json, ranking.json, kpi.json, class_distribution_test.json, regions.geojson
"""
import pandas as pd
import numpy as np
import json
from pathlib import Path
import random

# --- PATHS ---
BASE = Path(r"d:\Draft Perlombaan UNESA\DOLANAN DATA - TELU\FINAL DOLANAN DATA")
SUBMISSION_CSV = BASE / "datasets" / "submission_ground_truth.csv"
DASHBOARD_DIR = BASE / "Web Dashboard"
DATA_DIR = DASHBOARD_DIR / "data"
DATA_DIR.mkdir(exist_ok=True, parents=True)

# --- CONSTANTS ---
H, W = 480, 640
TOTAL_PX = H * W  # 307200

CLASS_NAMES = [
    'background', 'building-flooded', 'building-non-flooded',
    'grass', 'pool', 'road-flooded', 'road-non-flooded',
    'tree', 'vehicle', 'water'
]

# Dummy region names (realistic Indonesian kecamatan names for demo in Sumatra)
REGION_NAMES = [
    "Kecamatan Sungai Liat", "Kecamatan Muara Baru", "Kecamatan Tanjung Harapan",
    "Kecamatan Rawa Indah", "Kecamatan Pantai Cermin", "Kecamatan Bandar Setia",
    "Kecamatan Air Tawar", "Kecamatan Kampung Melayu", "Kecamatan Pelabuhan Ratu",
    "Kecamatan Teluk Dalam", "Kecamatan Sumber Jaya", "Kecamatan Padang Bulan",
    "Kecamatan Tegal Sari", "Kecamatan Cempaka Putih", "Kecamatan Karang Anyar",
    "Kecamatan Ujung Pandang"
]

FSPI_WEIGHTS = {'w1': 0.40, 'w2': 0.30, 'w3': 0.30}

print("Loading submission CSV...")
df = pd.read_csv(SUBMISSION_CSV)
print(f"  Rows: {len(df)}")

# --- STEP 1: Parse pixel counts per image per class ---
print("Parsing pixel counts per image...")
image_class_pixels = {}

for _, row in df.iterrows():
    img_cls = row['id']
    rle = row['encoded_pixels']
    
    parts = img_cls.rsplit('_', 1)
    img_id = parts[0]
    class_id = int(parts[1])
    
    if img_id not in image_class_pixels:
        image_class_pixels[img_id] = {c: 0 for c in range(10)}
    
    if pd.isna(rle) or not str(rle).strip():
        continue
    
    # Count total pixels from RLE (sum of lengths)
    s = str(rle).split()
    lengths = [int(s[i]) for i in range(1, len(s), 2)]
    image_class_pixels[img_id][class_id] = sum(lengths)

image_ids = sorted(image_class_pixels.keys())
print(f"  Unique images: {len(image_ids)}")

# --- STEP 2: Compute indicators per image ---
print("Computing FSPI indicators per image...")
image_data = []

for img_id in image_ids:
    px = image_class_pixels[img_id]
    
    inundation = (px[9] + px[5] + px[1]) / TOTAL_PX  # water + road-flooded + building-flooded
    infra_dmg = px[1] / max(px[1] + px[2], 1)         # building-flooded / (building-flooded + building-non-flooded)
    access_loss = px[5] / max(px[5] + px[6], 1)        # road-flooded / (road-flooded + road-non-flooded)
    
    fspi_raw = FSPI_WEIGHTS['w1'] * inundation + FSPI_WEIGHTS['w2'] * infra_dmg + FSPI_WEIGHTS['w3'] * access_loss
    fspi = round(fspi_raw * 100, 1)
    
    if fspi >= 60:
        status = "KRITIS"
    elif fspi >= 40:
        status = "TINGGI"
    elif fspi >= 20:
        status = "SEDANG"
    else:
        status = "RENDAH"
    
    image_data.append({
        'img_id': img_id,
        'px': px,
        'inundation': round(inundation, 4),
        'infra_damage': round(infra_dmg, 4),
        'access_loss': round(access_loss, 4),
        'fspi': fspi,
        'status': status
    })

# --- STEP 3: Assign images to regions (dummy mapping) ---
print("Creating dummy region mapping...")
random.seed(42)
n_regions = len(REGION_NAMES)
random.shuffle(image_data)

images_per_region = len(image_data) // n_regions
remainder = len(image_data) % n_regions

regions = []
idx = 0
for r in range(n_regions):
    n = images_per_region + (1 if r < remainder else 0)
    region_images = image_data[idx:idx+n]
    idx += n
    
    avg_inundation = np.mean([d['inundation'] for d in region_images])
    avg_infra = np.mean([d['infra_damage'] for d in region_images])
    avg_access = np.mean([d['access_loss'] for d in region_images])
    avg_fspi = round(np.mean([d['fspi'] for d in region_images]), 1)
    
    if avg_fspi >= 60:
        status = "KRITIS"
    elif avg_fspi >= 40:
        status = "TINGGI"
    elif avg_fspi >= 20:
        status = "SEDANG"
    else:
        status = "RENDAH"
    
    # Generate recommendation based on ACTUAL LABELS from Kaggle dataset
    recs = []
    
    # Let's find the top 3 classes (excluding background and water, though water is important) for this region
    class_totals = {c: 0 for c in CLASS_NAMES if c not in ['background', 'water']}
    for d in region_images:
        for i, c_name in enumerate(CLASS_NAMES):
            if c_name in class_totals:
                class_totals[c_name] += d['px'][i]
                
    # Sort classes by pixel count
    top_classes = sorted(class_totals.items(), key=lambda item: item[1], reverse=True)[:3]
    top_class_names = [f"#{c[0]}" for c in top_classes if c[1] > 0]
    
    if avg_fspi >= 60:
        recs.append(f"Fokus evakuasi! Anomali piksel terdeteksi signifikan pada label: {', '.join(top_class_names)}.")
    elif avg_fspi >= 40:
        recs.append(f"Siaga infrastruktur. AI mendeteksi rasio tinggi pada label {', '.join(top_class_names)}.")
    elif avg_fspi >= 20:
        recs.append(f"Kondisi terpantau. Temuan label dominan selain genangan normal: {', '.join(top_class_names)}.")
    else:
        recs.append(f"Relatif aman. Label terdeteksi: {', '.join(top_class_names)}.")
        
    # Also provide specific insights for specific labels
    if avg_infra >= 0.5:
        recs.append("Insight: Rasio pixel `building-flooded` terhadap total bangunan sangat tinggi.")
    if avg_access >= 0.6:
        recs.append("Insight: Akses terisolasi akibat sebaran pixel `road-flooded` yang mendominasi.")
        
    top_classes_list = [{"label": c[0], "count": c[1]} for c in top_classes if c[1] > 0]

    regions.append({
        'region_id': f'sec-{r+1:02d}',
        'name': REGION_NAMES[r],
        'fspi': avg_fspi,
        'status': status,
        'indicators': {
            'inundation': round(avg_inundation, 4),
            'infra_damage': round(avg_infra, 4),
            'access_loss': round(avg_access, 4)
        },
        'n_images': len(region_images),
        'top_labels': top_classes_list,
        'recommendation': " ".join(recs)
    })

# --- STEP 4: Generate GeoJSON (Dummy Sumatra Map) ---
print("Generating Dummy GeoJSON grid for Sumatra...")
base_lat, base_lng = -2.5, 104.8  # Near Palembang, Sumatra
cell_size = 0.08

features = []
for r_idx, region in enumerate(regions):
    row = r_idx // 4
    col = r_idx % 4
    
    lat0 = base_lat + row * cell_size
    lat1 = lat0 + cell_size
    lng0 = base_lng + col * cell_size
    lng1 = lng0 + cell_size
    
    features.append({
        'type': 'Feature',
        'properties': {
            'region_id': region['region_id'],
            'name': region['name'],
            'fspi': region['fspi'],
            'status': region['status']
        },
        'geometry': {
            'type': 'Polygon',
            'coordinates': [[[lng0, lat0], [lng1, lat0], [lng1, lat1], [lng0, lat1], [lng0, lat0]]]
        }
    })

geojson = {
    'type': 'FeatureCollection',
    'features': features
}

# --- STEP 5: Compute KPI ---
print("Computing KPI...")
critical = sum(1 for r in regions if r['status'] == 'KRITIS')
high = sum(1 for r in regions if r['status'] == 'TINGGI')
avg_inundation_pct = round(np.mean([r['indicators']['inundation'] for r in regions]) * 100, 1)

total_building_flooded_px = sum(d['px'][1] for d in image_data)
roads_cut = sum(1 for r in regions if r['indicators']['access_loss'] >= 0.4)

kpi = {
    'total_regions': len(regions),
    'critical_regions': critical,
    'high_regions': high,
    'avg_inundation_pct': avg_inundation_pct,
    'est_buildings_flooded_px': total_building_flooded_px,
    'roads_cut_regions': roads_cut
}

# --- STEP 6: Class distribution test ---
print("Computing class distribution...")
total_class_px = {CLASS_NAMES[c]: 0 for c in range(10)}
for d in image_data:
    for c in range(10):
        total_class_px[CLASS_NAMES[c]] += d['px'][c]

class_dist = {
    'total_pixels': len(image_ids) * TOTAL_PX,
    'classes': total_class_px
}

# --- STEP 7: Training history from notebook outputs ---
print("Creating training history JSON...")
training_history = {
    'train_loss': [0.5090, 0.4061, 0.3478, 0.3201, 0.3079, 0.2888],
    'val_loss': [0.5100, 0.3519, 0.3537, 0.3138, 0.2921, 0.2801],
    'train_miou': [0.4084, 0.5082, 0.5687, 0.5958, 0.6070, 0.6233],
    'val_miou': [0.4007, 0.5588, 0.5689, 0.6116, 0.6119, 0.6414],
    'train_mdice': [0.5088, 0.6793, 0.6842, 0.7225, 0.7207, 0.7443],
    'val_mdice': [0.5088, 0.6793, 0.6842, 0.7225, 0.7207, 0.7443]
}

# Per-class IoU
per_class_iou = {
    'background': 0.0000,
    'building-flooded': 0.6372,
    'building-non-flooded': 0.8219,
    'grass': 0.5386,
    'pool': 0.8266,
    'road-flooded': 0.6646,
    'road-non-flooded': 0.8186,
    'tree': 0.5941,
    'vehicle': 0.6435,
    'water': 0.8687
}

# --- WRITE ALL FILES ---
print("Writing derived files...")

ranking = sorted(regions, key=lambda r: r['fspi'], reverse=True)

with open(DATA_DIR / 'regions.json', 'w', encoding='utf-8') as f:
    json.dump(regions, f, indent=2, ensure_ascii=False)

with open(DATA_DIR / 'ranking.json', 'w', encoding='utf-8') as f:
    json.dump(ranking, f, indent=2, ensure_ascii=False)

with open(DATA_DIR / 'kpi.json', 'w', encoding='utf-8') as f:
    json.dump(kpi, f, indent=2)

with open(DATA_DIR / 'class_distribution_test.json', 'w', encoding='utf-8') as f:
    json.dump(class_dist, f, indent=2)

with open(DATA_DIR / 'regions.geojson', 'w', encoding='utf-8') as f:
    json.dump(geojson, f, indent=2, ensure_ascii=False)

with open(DATA_DIR / 'training_history.json', 'w', encoding='utf-8') as f:
    json.dump(training_history, f, indent=2)

with open(DATA_DIR / 'per_class_iou.json', 'w', encoding='utf-8') as f:
    json.dump(per_class_iou, f, indent=2)

print(f"\nAll derived files written to: {DATA_DIR}")
print("DONE!")
