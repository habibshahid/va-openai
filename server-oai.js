// server.js - Updated with function calling integration
require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// Import our new function configuration and processor
const { createAgentConfig } = require('./openai-function-config');
const { initializeFunctionProcessor, processFunctionCall } = require('./function-processor');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable debugging if environment variable is set
const DEBUG = process.env.DEBUG;

function debug(message, data) {
    if (DEBUG) {
        if (data) {
            console.log(`[SERVER] ${message}`, typeof data === 'object' ? JSON.stringify(data) : data);
        } else {
            console.log(`[SERVER] ${message}`);
        }
    }
}

// Check for API key
if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY environment variable');
    process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Load restaurant data
function loadRestaurantData() {
    try {
        const restaurantDataPath = path.join(__dirname, 'public', 'restaurant-data.js');
        const fileContent = fs.readFileSync(restaurantDataPath, 'utf8');
        
        // Create a mock window object to receive the data
        const mockWindow = {};
        
        // Create a context for running the JS file
        const context = { window: mockWindow };
        
        // Execute the script in the mocked context
        vm.runInNewContext(fileContent, context);
        
        // Get the data from the mock window
        const data = mockWindow.restaurantData;
        
        if (data) {
            debug('Restaurant data loaded successfully');
            
            // Preprocess the data for easier access
            // Combine all menu items into a single array for easier searching
            data.allMenuItems = [];
            
            if (data.menu) {
                for (const category of ['pizzas', 'sides', 'drinks', 'desserts']) {
                    if (data.menu[category]) {
                        data.allMenuItems.push(...data.menu[category]);
                    }
                }
            }
            
            return data;
        } else {
            console.error('Failed to extract restaurant data from file');
            return null;
        }
    } catch (error) {
        console.error('Error loading restaurant data:', error);
        return null;
    }
}

// Load restaurant data
const restaurantData = loadRestaurantData();

// API endpoint to get a session token for OpenAI Realtime API
app.post('/api/session', async (req, res) => {
    try {
        debug('Creating OpenAI Realtime session...');
        
        // Get agent configuration with functions
        const agentConfig = restaurantData ? createAgentConfig(restaurantData) : null;
        
        // Create the request body
        const requestBody = {
            model: "gpt-4o-realtime-preview-2024-12-17"
        };
        
        // Log the request
        debug('Sending session creation request to OpenAI:', requestBody);
        
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
                    debug('Response received from OpenAI');
                    const parsedData = JSON.parse(data);
                    
                    if (!parsedData.client_secret?.value) {
                        console.error('No client_secret.value in the response:', parsedData);
                        return res.status(500).json({ 
                            error: 'No ephemeral key provided by the server',
                            details: parsedData 
                        });
                    }
                    
                    debug('Session created successfully with ID:', parsedData.id);
                    
                    // Add agent configuration to the response
                    if (agentConfig) {
                        parsedData.agentConfig = agentConfig;
                    }
                    
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
        apiRequest.write(JSON.stringify(requestBody));
        
        apiRequest.end();
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ 
            error: 'Failed to create session',
            details: error.message
        });
    }
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    debug('Client connected to WebSocket server');
    
    // Initialize function processor with this client connection
    initializeFunctionProcessor(ws, restaurantData);
    
    // Send initial status to client
    try {
        ws.send(JSON.stringify({
            type: 'status',
            status: 'connected',
            message: 'Connected to server. Waiting for initialization.'
        }));
        debug('Sent initial status message to client');
    } catch (error) {
        console.error('Error sending initial status:', error);
    }
    
    // Handle messages from the client
    ws.on('message', async (message) => {
        try {
            // Try to determine if this is binary audio data or a text command
            if (message instanceof Buffer) {
                // Check if it looks like JSON (starts with '{')
                const firstByte = message[0];
                if (firstByte === 123) { // 123 is ASCII code for '{'
                    // This is likely a text message received as buffer
                    const textMessage = message.toString();
                    debug('Received text message as buffer');
                    
                    try {
                        const command = JSON.parse(textMessage);
                        debug('Parsed JSON command:', command);
                        
                        // Handle action responses from client
                        if (command.type === 'action_response') {
                            debug('Received action response from client:', command);
                            // No need to forward to OpenAI, just log it
                        } 
                        // Handle other commands
                        else {
                            debug('Forwarding command to client handler:', command.type);
                        }
                    } catch (parseError) {
                        console.error('Error parsing JSON command:', parseError);
                    }
                } else {
                    // Regular binary audio data, no processing needed at server level
                    // This is forwarded directly to OpenAI by the client
                }
            } else {
                // It's already a string
                debug('Received string message');
                
                try {
                    const command = JSON.parse(message);
                    debug('Parsed JSON command:', command);
                    
                    // Handle special command types if needed
                    if (command.type === 'function_call') {
                        // Process function call from OpenAI
                        const result = await processFunctionCall(command.function);
                        
                        // Send result back to client
                        ws.send(JSON.stringify({
                            type: 'function_call_result',
                            function_name: command.function.name,
                            result: result
                        }));
                    }
                } catch (parseError) {
                    console.error('Error parsing JSON message:', parseError);
                }
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Server error: ${error.message}`
                }));
            } catch (sendError) {
                console.error('Error sending error message to client:', sendError);
            }
        }
    });
    
    // Handle WebSocket close
    ws.on('close', () => {
        debug('Client disconnected');
    });
    
    // Handle WebSocket errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});