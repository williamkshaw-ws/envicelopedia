import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { SCRAPED_BALLS } from "./src/constants";
import { CatalogItem } from "./src/types";

const _filename = typeof __filename !== "undefined"
  ? __filename
  : typeof import.meta !== "undefined" && import.meta.url
    ? fileURLToPath(import.meta.url)
    : "";
const _dirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(_filename);

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: "50mb" })); // Allow large image payloads
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Local database file paths
const DATA_DIR = path.join(_dirname, "data");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const PRESERVED_IMAGES_FILE = path.join(DATA_DIR, "preserved_images.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper database read/write operations
function loadCatalog(): CatalogItem[] {
  if (!fs.existsSync(CATALOG_FILE)) return [];
  try {
    const data = fs.readFileSync(CATALOG_FILE, "utf8");
    return JSON.parse(data) || [];
  } catch (e) {
    console.error("Failed to read catalog file:", e);
    return [];
  }
}

function saveCatalog(catalog: CatalogItem[]) {
  try {
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write catalog file:", e);
  }
}

// Auto-seed catalog if empty on start
const initialCatalog = loadCatalog();
if (initialCatalog.length === 0) {
  console.log("Local catalog.json is empty. Seeding with default scraped golf balls...");
  saveCatalog(SCRAPED_BALLS);
}

// Initialize Firebase Admin if configuration exists
let isFirebaseAdminInitialized = false;
let dbAdmin: FirebaseFirestore.Firestore | null = null;
const SERVICE_ACCOUNT_FILE = path.join(_dirname, "service-account.json");

if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    dbAdmin = admin.firestore();
    isFirebaseAdminInitialized = true;
    console.log("Firebase Admin SDK successfully initialized with service-account.json");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
  }
} else if (process.env.FIREBASE_PROJECT_ID) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    dbAdmin = admin.firestore();
    isFirebaseAdminInitialized = true;
    console.log("Firebase Admin SDK successfully initialized with Application Default Credentials");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK with default credentials:", error);
  }
} else {
  console.log("No service-account.json or environment credentials found. Operating in local JSON file mode.");
}

// Sync Firestore database with local catalog on startup
if (isFirebaseAdminInitialized && dbAdmin) {
  (async () => {
    try {
      const catalogRef = dbAdmin!.collection("catalog");
      const catalogSnap = await catalogRef.get();
      
      if (catalogSnap.empty) {
        console.log("Firestore catalog collection is empty. Seeding Firestore with default catalog...");
        const batch = dbAdmin!.batch();
        SCRAPED_BALLS.forEach(item => {
          const docRef = catalogRef.doc(item.id);
          batch.set(docRef, item);
        });
        await batch.commit();
        console.log("Seeded default catalog to Firestore successfully.");
      }
    } catch (e) {
      console.error("Failed to sync Firestore catalog on startup:", e);
    }
  })();
}

// ID Generator / Sanitizer
function sanitizeId(model: string, color: string, name?: string, variation?: string): string {
  const clean = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const modelPart = clean(model);
  const colorPart = clean(color);
  const namePart = name ? clean(name) : "";
  const varPart = variation ? clean(variation) : "";
  
  let base = modelPart;
  if (namePart) base += `-${namePart}`;
  base += `-${colorPart}`;
  if (varPart) base += `-${varPart}`;
  return base;
}

// --- API ENDPOINTS ---

// GET: Fetch catalog items
app.get("/api/catalog", async (req, res) => {
  if (isFirebaseAdminInitialized && dbAdmin) {
    try {
      const snapshot = await dbAdmin.collection("catalog").get();
      const items: CatalogItem[] = [];
      snapshot.forEach(doc => {
        items.push({ id: doc.id, ...doc.data() } as CatalogItem);
      });
      return res.json(items);
    } catch (e: any) {
      console.error("Failed to fetch from Firestore:", e);
      return res.status(500).json({ error: e.message || "Failed to fetch catalog specs from Firestore" });
    }
  } else {
    return res.json(loadCatalog());
  }
});

// POST: Add new catalog item
app.post("/api/catalog", async (req, res) => {
  const { model, name, color, variation, year, notes, groupColor, groupVariation, customImage, customImageSleeve, customImageBox, bundleItems } = req.body;
  if (!model || !name || !color) {
    return res.status(400).json({ error: "Model, Name, and Color specifications are required." });
  }

  const newId = sanitizeId(model, color, name, variation || notes);
  const newItem: CatalogItem = {
    id: newId,
    model: model.trim(),
    name: name.trim(),
    color: color.trim(),
    variation: variation ? variation.trim() : (notes ? notes.trim() : undefined),
    year: year ? year.trim() : undefined,
    groupColor: groupColor !== undefined ? !!groupColor : undefined,
    groupVariation: groupVariation !== undefined ? !!groupVariation : undefined,
    customImage,
    customImageSleeve,
    customImageBox,
    bundleItems: bundleItems || []
  };

  if (isFirebaseAdminInitialized && dbAdmin) {
    try {
      await dbAdmin.collection("catalog").doc(newId).set(newItem, { merge: true });
      return res.status(201).json(newItem);
    } catch (e: any) {
      console.error("Failed to save to Firestore:", e);
      return res.status(500).json({ error: e.message || "Failed to save specs to Firestore" });
    }
  } else {
    const catalog = loadCatalog();
    const existingIndex = catalog.findIndex(item => item.id === newId);
    if (existingIndex > -1) {
      catalog[existingIndex] = newItem;
    } else {
      catalog.unshift(newItem);
    }
    saveCatalog(catalog);
    return res.status(201).json(newItem);
  }
});

// PUT: Update existing catalog item
app.put("/api/catalog/:id", async (req, res) => {
  const { id } = req.params;
  const fieldsToUpdate = req.body;

  if (isFirebaseAdminInitialized && dbAdmin) {
    try {
      await dbAdmin.collection("catalog").doc(id).set(fieldsToUpdate, { merge: true });
      return res.json({ success: true });
    } catch (e: any) {
      console.error("Failed to update in Firestore:", e);
      return res.status(500).json({ error: e.message || "Failed to update specs in Firestore" });
    }
  } else {
    const catalog = loadCatalog();
    const index = catalog.findIndex(item => item.id === id);
    if (index > -1) {
      catalog[index] = { ...catalog[index], ...fieldsToUpdate };
      saveCatalog(catalog);
      return res.json({ success: true });
    } else {
      return res.status(404).json({ error: "Item not found" });
    }
  }
});

// DELETE: Remove catalog item
app.delete("/api/catalog/:id", async (req, res) => {
  const { id } = req.params;

  if (isFirebaseAdminInitialized && dbAdmin) {
    try {
      await dbAdmin.collection("catalog").doc(id).delete();
      return res.json({ success: true });
    } catch (e: any) {
      console.error("Failed to delete from Firestore:", e);
      return res.status(500).json({ error: e.message || "Failed to delete from Firestore" });
    }
  } else {
    const catalog = loadCatalog();
    const filtered = catalog.filter(item => item.id !== id);
    if (filtered.length < catalog.length) {
      saveCatalog(filtered);
      return res.json({ success: true });
    } else {
      return res.status(404).json({ error: "Item not found" });
    }
  }
});

// POST: Bulk catalog upload
app.post("/api/catalog/bulk", async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "An array of items is required under the 'items' key." });
  }

  const parsedItems: CatalogItem[] = items.map(item => {
    const { model, name, color, variation, year, groupColor, groupVariation, customImage, customImageSleeve, customImageBox, bundleItems } = item;
    const newId = sanitizeId(model, color, name, variation);
    return {
      id: newId,
      model: model.trim(),
      name: name ? name.trim() : "",
      color: color.trim(),
      variation: variation ? variation.trim() : undefined,
      year: year ? year.trim() : undefined,
      groupColor: !!groupColor,
      groupVariation: !!groupVariation,
      customImage,
      customImageSleeve,
      customImageBox,
      bundleItems: bundleItems || []
    };
  });

  if (isFirebaseAdminInitialized && dbAdmin) {
    try {
      const batch = dbAdmin.batch();
      parsedItems.forEach(newItem => {
        const docRef = dbAdmin!.collection("catalog").doc(newItem.id);
        batch.set(docRef, newItem, { merge: true });
      });
      await batch.commit();
      return res.json({ success: true, count: parsedItems.length, items: parsedItems });
    } catch (e: any) {
      console.error("Firestore bulk catalog save failed:", e);
      return res.status(500).json({ error: e.message || "Failed to bulk save in Firestore" });
    }
  } else {
    const catalog = loadCatalog();
    parsedItems.forEach(newItem => {
      const idx = catalog.findIndex(c => c.id === newItem.id);
      if (idx > -1) {
        catalog[idx] = newItem;
      } else {
        catalog.unshift(newItem);
      }
    });
    saveCatalog(catalog);
    return res.json({ success: true, count: parsedItems.length, items: parsedItems });
  }
});

// GET: Admin status
app.get("/api/admin/status", (req, res) => {
  res.json({
    isFirebaseAdminInitialized,
    hasServiceAccount: fs.existsSync(SERVICE_ACCOUNT_FILE),
    envBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || "none"
  });
});

// Serve compiled static files in production / use Vite middleware in dev
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server running at container port ${PORT}`);
  });
}

startServer();
