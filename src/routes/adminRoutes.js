const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminController = require('../controllers/adminController');
const adminAuthController = require('../controllers/adminAuthController');
const adminAuth = require('../middleware/adminAuth');

// Configure multer for CSV upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/csv/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profiles-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Configure multer for image upload
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/images/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

//======================
// AUTHENTICATION (Public routes)
//======================
router.post('/auth/login', adminAuthController.login);

// Protected routes (require authentication)
router.get('/auth/verify', adminAuth, adminAuthController.verify);

//======================
// CATEGORIES (Protected)
//======================
router.get('/categories', adminAuth, adminController.getCategories);
router.post('/categories', adminAuth, adminController.createCategory);
router.put('/categories/:id', adminAuth, adminController.updateCategory);
router.delete('/categories/:id', adminAuth, adminController.deleteCategory);

//======================
// SUBCATEGORIES (Protected)
//======================
router.get('/subcategories', adminAuth, adminController.getSubcategories);
router.post('/subcategories', adminAuth, adminController.createSubcategory);
router.put('/subcategories/:id', adminAuth, adminController.updateSubcategory);
router.delete('/subcategories/:id', adminAuth, adminController.deleteSubcategory);

//======================
// IMAGE UPLOAD (Protected)
//======================
router.post('/upload-image', adminAuth, imageUpload.single('image'), adminController.uploadImage);

//======================
// PROFILES (Protected)
//======================
router.get('/profiles', adminAuth, adminController.getAllProfiles);
router.post('/profiles', adminAuth, adminController.createProfile);
router.put('/profiles/:id', adminAuth, adminController.updateProfile);
router.delete('/profiles/:id', adminAuth, adminController.deleteProfile);

//======================
// TAG MANAGEMENT (Protected)
//======================
router.get('/tags/analyze', adminAuth, adminController.analyzeTags);
router.put('/tags/:id/approve', adminAuth, adminController.approveTagClassification);
router.put('/tags/:id/reject', adminAuth, adminController.rejectTagClassification);
router.put('/tags/:id/force', adminAuth, adminController.forceTagClassification);

//======================
// DASHBOARD STATS (Protected)
//======================
router.get('/stats', adminAuth, adminController.getStats);

//======================
// CSV UPLOAD (Protected)
//======================
router.post('/upload-csv', adminAuth, upload.single('file'), adminController.uploadCSV);

//======================
// IMAGE EXTRACTION (Protected)
//======================
router.post('/profiles/:id/extract-image', adminAuth, adminController.extractProfileImage);
router.post('/profiles/extract-all-images', adminAuth, adminController.extractAllProfileImages);

module.exports = router;
