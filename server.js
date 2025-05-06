require('dotenv').config();
const express = require('express');
const https = require('https');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API endpoint to get an ephemeral key for OpenAI Realtime API
app.post('/api/session', async (req, res) => {
  try {
    console.log('Creating OpenAI Realtime session...');
    
    // Make a request to OpenAI's API
    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/realtime/sessions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const apiRequest = https.request(options, (apiResponse) => {
      let data = '';
      
      apiResponse.on('data', (chunk) => {
        data += chunk;
      });
      
      apiResponse.on('end', () => {
        try {
          console.log('Response received from OpenAI');
          const parsedData = JSON.parse(data);
          
          if (!parsedData.client_secret?.value) {
            console.error('No client_secret.value in the response:', parsedData);
            return res.status(500).json({ 
              error: 'No ephemeral key provided by the server',
              details: parsedData 
            });
          }
          
          console.log('Session created successfully with ID:', parsedData.id);
          res.json(parsedData);
        } catch (e) {
          console.error('Error parsing OpenAI response:', e);
          res.status(500).json({ 
            error: 'Failed to parse OpenAI response',
            details: e.message
          });
        }
      });
    });
    
    apiRequest.on('error', (error) => {
      console.error('Error making request to OpenAI:', error);
      res.status(500).json({ 
        error: 'Failed to connect to OpenAI API',
        details: error.message
      });
    });
    
    // Send request with the model specified
    apiRequest.write(JSON.stringify({
      model: "gpt-4o-realtime-preview"
    }));
    
    apiRequest.end();
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ 
      error: 'Failed to create session',
      details: error.message
    });
  }
});

// Optional endpoint for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});