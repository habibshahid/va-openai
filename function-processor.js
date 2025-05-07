// function-processor.js - Handle function calls from the OpenAI voice agent

// Track client WebSocket connection
let clientWebSocket = null;
let restaurantData = null;

/**
 * Initialize the function processor with a client WebSocket connection and restaurant data
 * @param {WebSocket} ws - Client WebSocket connection
 * @param {Object} data - Restaurant data
 */
function initializeFunctionProcessor(ws, data) {
    console.log('Initializing function processor with client WebSocket');
    clientWebSocket = ws;
    restaurantData = data;
}

/**
 * Process a function call from the OpenAI agent
 * @param {Object} functionCall - Function call details from OpenAI
 * @returns {Promise<Object>} Function call result
 */
async function processFunctionCall(functionCall) {
    console.log('Processing function call:', functionCall);
    
    if (!clientWebSocket) {
        console.error('No client WebSocket connection available');
        return { error: 'No client connection available' };
    }
    
    try {
        // Extract function details from OpenAI's format
        const functionName = functionCall.name;
        let functionArgs;
        
        try {
            functionArgs = JSON.parse(functionCall.arguments);
        } catch (parseError) {
            console.error('Error parsing function arguments:', parseError);
            return { error: 'Invalid function arguments format' };
        }
        
        console.log(`Processing function ${functionName} with args:`, functionArgs);
        
        // Format the action for the client
        const action = {
            type: functionName,
            ...functionArgs
        };
        
        // Generate a unique ID for this function call
        const functionId = `fn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Send the action to the client and wait for response
        const result = await sendActionToClient(action, functionId, functionName);
        
        console.log(`Function ${functionName} completed with result:`, result);
        return result;
    } catch (error) {
        console.error('Error processing function call:', error);
        return { 
            error: error.message || 'Unknown error processing function call'
        };
    }
}

/**
 * Send an action to the client and wait for the response
 * @param {Object} action - Action to send to client
 * @param {string} functionId - Unique ID for this function call
 * @param {string} functionName - Name of the function being called
 * @returns {Promise<Object>} Client response
 */
function sendActionToClient(action, functionId, functionName) {
    return new Promise((resolve, reject) => {
        if (!clientWebSocket) {
            return reject(new Error('No client WebSocket connection available'));
        }
        
        // Add function ID to the action
        const actionWithId = {
            ...action,
            function_call_id: functionId,
            function_name: functionName
        };
        
        try {
            // Send the action to the client
            clientWebSocket.send(JSON.stringify({
                type: 'actions',
                actions: [actionWithId]
            }));
            
            console.log(`Sent ${action.type} action to client:`, actionWithId);
            
            // Set up a temporary event listener to wait for the response
            const responseHandler = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    
                    // Check if this is a response to our function call
                    if (response.type === 'action_response' && 
                        response.function_call_id === functionId) {
                        
                        // Remove the event listener
                        clientWebSocket.removeEventListener('message', responseHandler);
                        
                        // Resolve the promise with the response
                        resolve(response.output || { success: true });
                    }
                } catch (error) {
                    // Ignore errors in parsing responses
                }
            };
            
            // Add the event listener
            clientWebSocket.addEventListener('message', responseHandler);
            
            // Set a timeout to prevent hanging if the client doesn't respond
            setTimeout(() => {
                clientWebSocket.removeEventListener('message', responseHandler);
                resolve({ success: true, warning: 'Client did not respond in time' });
            }, 5000);
        } catch (error) {
            console.error('Error sending action to client:', error);
            reject(error);
        }
    });
}

/**
 * Handle a response from the client for a function call
 * @param {Object} response - Response from the client
 * @returns {Object} Formatted response for OpenAI
 */
function handleActionResponse(response) {
    console.log('Handling action response:', response);
    
    // Format the response for OpenAI
    return {
        success: true,
        ...response
    };
}

module.exports = {
    initializeFunctionProcessor,
    processFunctionCall,
    handleActionResponse
};