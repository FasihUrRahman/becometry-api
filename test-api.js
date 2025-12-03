const axios = require('axios');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwiaXNBZG1pbiI6dHJ1ZSwiaWF0IjoxNzY0NzU4NzM5LCJleHAiOjE3NjQ4NDUxMzl9.ew-N-iMafRe49KkqaofT3yQcLKUFrfJrcoyTH40m5iU';

(async () => {
  try {
    const response = await axios.get('http://localhost:5001/api/admin/profiles', {
      params: {
        page: 1,
        limit: 12
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('API Response:');
    console.log('=============');
    console.log('Success:', response.data.success);
    console.log('Total profiles:', response.data.pagination?.total);
    console.log('\nFirst profile:');
    console.log(JSON.stringify(response.data.data.profiles[0], null, 2));

    // Check image URLs
    const profilesWithImages = response.data.data.profiles.filter(p => p.image_url);
    const profilesWithoutImages = response.data.data.profiles.filter(p => !p.image_url);

    console.log('\n=============');
    console.log(`Profiles with images in response: ${profilesWithImages.length}`);
    console.log(`Profiles without images in response: ${profilesWithoutImages.length}`);

    if (profilesWithImages.length > 0) {
      console.log('\nSample profile with image:');
      console.log(`Name: ${profilesWithImages[0].name}`);
      console.log(`Image URL: ${profilesWithImages[0].image_url}`);
    }

    if (profilesWithoutImages.length > 0) {
      console.log('\nSample profile without image:');
      console.log(`Name: ${profilesWithoutImages[0].name}`);
      console.log(`Image URL: ${profilesWithoutImages[0].image_url || 'null'}`);
    }

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
})();
