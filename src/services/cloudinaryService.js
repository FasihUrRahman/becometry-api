const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'digps9enm',
  api_key: '263476231646953',
  api_secret: 'w7DTp_ZH76WgZdEE73OzmYvvV_E'
});

class CloudinaryService {
  /**
   * Upload image from URL to Cloudinary
   */
  async uploadFromUrl(imageUrl, options = {}) {
    try {
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder: 'becometry/profile-images',
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto:best' }
        ],
        ...options
      });

      return {
        success: true,
        url: result.secure_url,
        public_id: result.public_id
      };
    } catch (error) {
      console.error('Cloudinary upload error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload image from local file path
   */
  async uploadFromFile(filePath, options = {}) {
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'becometry/profile-images',
        resource_type: 'image',
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto:best' }
        ],
        ...options
      });

      return {
        success: true,
        url: result.secure_url,
        public_id: result.public_id
      };
    } catch (error) {
      console.error('Cloudinary upload error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Download image temporarily and upload to Cloudinary
   */
  async downloadAndUpload(imageUrl, username) {
    try {
      // Create temp directory
      const tempDir = path.join(__dirname, '../../temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempFilePath = path.join(tempDir, `${username}_${Date.now()}.jpg`);

      // Download image
      const response = await axios({
        method: 'GET',
        url: imageUrl,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://www.instagram.com/'
        },
        timeout: 30000
      });

      // Save temporarily
      await fs.writeFile(tempFilePath, response.data);

      // Upload to Cloudinary
      const result = await this.uploadFromFile(tempFilePath, {
        public_id: `profile_${username}_${Date.now()}`
      });

      // Delete temp file
      try {
        await fs.unlink(tempFilePath);
      } catch (e) {
        // Ignore cleanup errors
      }

      return result;
    } catch (error) {
      console.error('Download and upload error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete image from Cloudinary
   */
  async deleteImage(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      return result.result === 'ok';
    } catch (error) {
      console.error('Cloudinary delete error:', error.message);
      return false;
    }
  }
}

module.exports = new CloudinaryService();
